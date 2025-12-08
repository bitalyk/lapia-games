import crypto from "node:crypto";
import authConfig from "../config/auth-config.js";
import Invitation from "../models/invitation.js";
import Friendship from "../models/friendship.js";
import FriendActivity from "../models/friend-activity.js";
import FraudAlert from "../models/fraud-alert.js";
import RegistrationLog from "../models/registration-log.js";
import UserGameplayStats from "../models/user-gameplay-stats.js";
import User from "../models/user.js";
import AchievementManager from "./achievement-manager.js";

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const FRIEND_LIMIT = 100;
const RAPID_INVITE_WINDOW_MS = 5 * 60 * 1000;
const RAPID_INVITE_THRESHOLD = 10;
const MIN_PLAYTIME_MS = 30 * 60 * 1000;

const telegramBotUsername = authConfig.telegram?.botUsername || "";

const clampCounter = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function prepareInviteState(user) {
  if (!user) return null;
  AchievementManager.prepareUser(user);
  return user.friendInvites;
}

async function incrementPendingInvite(inviter) {
  if (!inviter) return;
  const invites = prepareInviteState(inviter);
  if (!invites) return;
  invites.pendingInvites = clampCounter(invites.pendingInvites) + 1;
  invites.lastInviteSentAt = new Date();
  inviter.markModified?.("friendInvites");
  await inviter.save();
}

async function markInvitationAccepted(inviter, invitedUser) {
  if (!inviter) return;
  const invites = prepareInviteState(inviter);
  if (!invites) return;
  AchievementManager.recordFriendInvite(inviter, invitedUser?.username || null);
  inviter.markModified?.("friendInvites");
  await inviter.save();
}

function buildInviteLink(inviteCode) {
  if (telegramBotUsername) {
    const encoded = encodeURIComponent(inviteCode);
    return `https://t.me/${telegramBotUsername}?startapp=${encoded}&start=${encoded}`;
  }
  const baseUrl = process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || "";
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}/?invite=${inviteCode}`;
  }
  return inviteCode;
}

function inviteExpirationDate() {
  return new Date(Date.now() + INVITE_LIFETIME_MS);
}

async function logFraudPattern(inviterUserId, pattern, metadata = {}) {
  if (!inviterUserId) return;
  await FraudAlert.create({
    inviterUserId,
    patternTypes: Array.isArray(pattern) ? pattern : [pattern],
    metadata,
    flaggedAt: new Date()
  });
}

async function ensureFriendLimit(userId) {
  const friendCount = await Friendship.countFriends(userId);
  if (friendCount >= FRIEND_LIMIT) {
    throw new Error("Inviter has reached maximum friends limit");
  }
}

export async function generateInviteLink(inviterUserId) {
  if (!inviterUserId) {
    throw new Error("Inviter is required");
  }

  const inviter = await User.findById(inviterUserId);
  if (!inviter || !inviter.isActive) {
    throw new Error("Inviter is not an active player");
  }

  await ensureFriendLimit(inviterUserId);

  const now = Date.now();
  const recentInvites = await Invitation.countDocuments({
    inviterUserId,
    createdAt: { $gt: new Date(now - RAPID_INVITE_WINDOW_MS) }
  });

  if (recentInvites > RAPID_INVITE_THRESHOLD) {
    await logFraudPattern(inviterUserId, "rapid_invitations", { recentInvites });
    throw new Error("Invite rate limit exceeded. Try again later.");
  }

  const inviteCode = crypto.randomBytes(16).toString("hex");
  const expiresAt = inviteExpirationDate();

  const invitation = await Invitation.create({
    inviteCode,
    inviterUserId,
    expiresAt,
    status: "pending",
    metadata: {}
  });

  await incrementPendingInvite(inviter);

  return {
    inviteCode,
    inviteLink: buildInviteLink(inviteCode),
    expiresAt: invitation.expiresAt
  };
}

async function createFriendshipPair(inviterId, invitedId, inviteCode) {
  const now = new Date();
  const basePayload = {
    invitedAt: now,
    inviteCodeUsed: inviteCode,
    mutual: true,
    status: "active",
    lastInteraction: now
  };

  await Friendship.create([
    { userId: inviterId, friendId: invitedId, ...basePayload },
    { userId: invitedId, friendId: inviterId, ...basePayload }
  ]);
}

async function recordFriendActivity(userId, friendId, activityType, activityData = {}) {
  const friendship = await Friendship.findOne({ userId, friendId, status: "active" });
  if (!friendship) return;
  await FriendActivity.create({
    friendshipId: friendship._id,
    userId,
    activityType,
    activityData,
    createdAt: new Date()
  });
}

export async function isLegitimateUser(userId, existingUser = null) {
  const user = existingUser || await User.findById(userId);
  if (!user) {
    return false;
  }

  if (user.telegramProfile?.createdAt) {
    const ageMs = Date.now() - new Date(user.telegramProfile.createdAt).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      await logFraudPattern(userId, "new_telegram_account");
      return false;
    }
  }

  if (user.registrationIp) {
    const registrations = await RegistrationLog.countDocuments({
      ipAddress: user.registrationIp,
      createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) }
    });
    if (registrations > 3) {
      await logFraudPattern(userId, "multiple_registrations_same_ip", { count: registrations });
      return false;
    }
  }

  const gameplayStats = await UserGameplayStats.findOne({ userId });
  if (gameplayStats && gameplayStats.totalPlayTime < 5 * 60 * 1000) {
    await logFraudPattern(userId, "low_playtime_invited_user", { totalPlayTime: gameplayStats.totalPlayTime });
    return false;
  }

  return true;
}

async function detectInvitationFraud(inviterId, invitedIds = []) {
  const now = Date.now();
  const patterns = [];

  const recentInvites = await Invitation.find({
    inviterUserId: inviterId,
    createdAt: { $gt: new Date(now - RAPID_INVITE_WINDOW_MS) }
  });

  if (recentInvites.length > RAPID_INVITE_THRESHOLD) {
    patterns.push("rapid_invitations");
  }

  const uniqueInvited = new Set(invitedIds.map(String));
  if (uniqueInvited.size !== invitedIds.length) {
    patterns.push("duplicate_invitations");
  }

  const newAccounts = await User.find({
    _id: { $in: invitedIds },
    createdAt: { $gt: new Date(now - 60 * 60 * 1000) }
  });

  if (invitedIds.length > 0 && newAccounts.length > invitedIds.length * 0.5) {
    patterns.push("inviting_new_accounts");
  }

  if (patterns.length > 0) {
    await logFraudPattern(inviterId, patterns, { invitedIds });
    return false;
  }

  return true;
}

export async function processInvitation(inviteCode, newUserId) {
  if (!inviteCode) {
    throw new Error("Invitation code is required");
  }

  const invitation = await Invitation.findOne({ inviteCode, status: "pending" });
  if (!invitation) {
    throw new Error("Invalid or expired invitation code");
  }

  if (invitation.expiresAt.getTime() < Date.now()) {
    invitation.status = "expired";
    await invitation.save();
    throw new Error("Invitation link has expired");
  }

  if (String(invitation.inviterUserId) === String(newUserId)) {
    throw new Error("Cannot invite yourself");
  }

  const inviter = await User.findById(invitation.inviterUserId);
  if (!inviter || !inviter.isActive) {
    throw new Error("Inviter is not an active player");
  }

  const invitedUser = await User.findById(newUserId);
  if (!invitedUser) {
    throw new Error("Invited user not found");
  }

  await ensureFriendLimit(invitation.inviterUserId);

  const isLegit = await isLegitimateUser(newUserId, invitedUser);
  if (!isLegit) {
    throw new Error("User validation failed");
  }

  const existingFriendship = await Friendship.findOne({
    userId: invitation.inviterUserId,
    friendId: newUserId
  });
  if (existingFriendship) {
    throw new Error("Already friends with this user");
  }

  await detectInvitationFraud(invitation.inviterUserId, [newUserId]);

  await createFriendshipPair(invitation.inviterUserId, newUserId, inviteCode);

  invitation.status = "accepted";
  invitation.invitedUserId = newUserId;
  invitation.acceptedAt = new Date();
  await invitation.save();

  invitedUser.invitedBy = invitation.inviterUserId;
  invitedUser.registrationType = "invited";
  invitedUser.invitationMetadata = {
    inviteCode,
    acceptedAt: invitation.acceptedAt
  };
  await invitedUser.save();

  await recordFriendActivity(invitation.inviterUserId, newUserId, "friend_invited", { inviteCode });
  await recordFriendActivity(newUserId, invitation.inviterUserId, "friend_invited", { inviteCode });

  await markInvitationAccepted(inviter, invitedUser);

  return { inviterUsername: inviter.username, inviteCode };
}

function resolvePlaytime(stats, fallback = 0) {
  if (!stats) return fallback;
  if (typeof stats.totalPlayTime === "number") {
    return stats.totalPlayTime;
  }
  return fallback;
}

export async function addOrganicFriend(userId, friendIdentifier) {
  if (!userId) throw new Error("User is required");

  const [user, friend] = await Promise.all([
    User.findById(userId),
    typeof friendIdentifier === "string" && friendIdentifier.match(/^[0-9a-fA-F]{24}$/)
      ? User.findById(friendIdentifier)
      : User.findOne({ username: friendIdentifier })
  ]);

  if (!user || !friend) {
    throw new Error("Invalid users");
  }

  if (String(user._id) === String(friend._id)) {
    throw new Error("Cannot add yourself as friend");
  }

  if (!user.isActive || !friend.isActive) {
    throw new Error("Invalid users");
  }

  const [userStats, friendStats] = await Promise.all([
    UserGameplayStats.findOne({ userId: user._id }),
    UserGameplayStats.findOne({ userId: friend._id })
  ]);

  const userPlaytime = resolvePlaytime(userStats);
  const friendPlaytime = resolvePlaytime(friendStats);

  if (userPlaytime > 0 && friendPlaytime > 0) {
    if (userPlaytime < MIN_PLAYTIME_MS || friendPlaytime < MIN_PLAYTIME_MS) {
      throw new Error("Both users need minimum playtime to add friends");
    }
  }

  const existing = await Friendship.findOne({
    $or: [
      { userId: user._id, friendId: friend._id },
      { userId: friend._id, friendId: user._id }
    ]
  });

  if (existing) {
    throw new Error("Already friends");
  }

  await ensureFriendLimit(user._id);
  await ensureFriendLimit(friend._id);

  await createFriendshipPair(user._id, friend._id, null);

  await recordFriendActivity(user._id, friend._id, "friend_added_organic", { method: "organic" });
  await recordFriendActivity(friend._id, user._id, "friend_added_organic", { method: "organic" });

  return { success: true };
}

export async function getFriendsForUser(userId) {
  const friendships = await Friendship.find({ userId, status: "active" })
    .populate("friendId", "username platformStats lastActive telegramProfile currencyByGame")
    .sort({ lastInteraction: -1 });

  return friendships.map((friendship) => {
    const friend = friendship.friendId;
    const lastActive = friend?.lastActive ? new Date(friend.lastActive) : null;
    const isOnline = lastActive ? (Date.now() - lastActive.getTime()) < 5 * 60 * 1000 : false;
    return {
      id: friend?._id,
      username: friend?.username,
      lastActivity: friend?.platformStats?.lastLogin || friend?.lastActive,
      isOnline,
      mutual: friendship.mutual,
      lastInteraction: friendship.lastInteraction,
      inviteCodeUsed: friendship.inviteCodeUsed,
      currencyByGame: friend?.currencyByGame || {},
      telegramUsername: friend?.telegramProfile?.username || null
    };
  });
}

export async function getInvitationStats(userId) {
  const [totalSent, successfulInvites, pendingInvites, activeFriends, totalFraudAlerts, userDoc] = await Promise.all([
    Invitation.countDocuments({ inviterUserId: userId }),
    Invitation.countDocuments({ inviterUserId: userId, status: "accepted" }),
    Invitation.countDocuments({ inviterUserId: userId, status: "pending" }),
    Friendship.countFriends(userId),
    FraudAlert.countDocuments({ inviterUserId: userId, status: { $in: ["pending", "under_review"] } }),
    User.findById(userId).select("friendInvites achievementProgress")
  ]);

  const friendInvites = userDoc?.friendInvites || {};
  const inviteLedger = {
    invitedCount: friendInvites.invitedCount || 0,
    trackedSuccessfulInvites: friendInvites.successfulInvites || 0,
    trackedPendingInvites: friendInvites.pendingInvites || 0,
    lastInviteSentAt: friendInvites.lastInviteSentAt || null,
    lastRewardedAt: friendInvites.lastRewardedAt || null
  };

  const totalLPAEarned = userDoc?.achievementProgress?.friendInviter ? 1 : 0;

  return {
    totalInvitesSent: totalSent,
    successfulInvites,
    pendingInvites,
    friendsWhoAreActive: activeFriends,
    conversionRate: totalSent > 0 ? Number((successfulInvites / totalSent).toFixed(2)) : 0,
    fraudAlerts: totalFraudAlerts,
    inviteLedger,
    totalLPAEarned
  };
}

export async function getInvitationAnalytics(userId) {
  const stats = await getInvitationStats(userId);
  return {
    ...stats
  };
}

export default {
  generateInviteLink,
  processInvitation,
  getFriendsForUser,
  addOrganicFriend,
  getInvitationStats,
  getInvitationAnalytics,
  isLegitimateUser
};
