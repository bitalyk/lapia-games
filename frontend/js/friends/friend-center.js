const DEFAULT_EMPTY_STATE = 'No friends yet. Invite someone and sync your progress.';

function formatDate(value) {
  if (!value) return 'never';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'recently';
    }
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return 'recently';
  }
}

function formatRelative(value) {
  if (!value) return 'a while ago';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return 'a while ago';
  }
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  return `${Math.floor(diffMs / day)}d ago`;
}

export class FriendCenter {
  constructor({ authManager, apiBase } = {}) {
    this.authManager = authManager || window.authManager || null;
    this.apiBase = apiBase || this.resolveApiBase();
    this.elements = {};
    this.state = {
      stats: null,
      inviteLink: null,
      friends: []
    };
    this.initialized = false;
    this.listenersBound = false;
    this.boundRoot = null;
  }

  resolveApiBase() {
    const origin = (typeof window !== 'undefined' && window.location?.origin)
      ? window.location.origin.replace(/\/$/, '')
      : '';
    return `${origin}/api`;
  }

  init() {
    if (!this.listenersBound) {
      this.bindGlobalListeners();
      this.listenersBound = true;
    }
    this.attachToMenu();
  }

  bindGlobalListeners() {
    window.addEventListener('platformLogin', () => {
      this.attachToMenu();
      this.refreshAll();
    });

    window.addEventListener('platformLogout', () => {
      this.reset();
    });

    window.addEventListener('achievementStatusUpdated', (event) => {
      const friendSnapshot = event.detail?.status?.friendInvites;
      if (friendSnapshot) {
        this.updateLedgerFromStatus(friendSnapshot);
      }
    });
  }

  attachToMenu() {
    this.cacheElements();
    if (!this.elements.root) {
      this.initialized = false;
      this.boundRoot = null;
      return;
    }

    const rootChanged = this.boundRoot !== this.elements.root;
    if (!this.initialized || rootChanged) {
      this.bindUiEvents();
      this.initialized = true;
      this.boundRoot = this.elements.root;
    }

    if (this.authManager?.isAuthenticated()) {
      this.refreshAll();
    } else {
      this.renderEmpty();
    }
  }

  cacheElements() {
    const root = document.querySelector('[data-friend-center]');
    this.elements = { root };
    if (!root) {
      return;
    }

    this.elements.generateBtn = root.querySelector('[data-action="generate-invite"]');
    this.elements.invitePanel = root.querySelector('[data-friend-invite-panel]');
    this.elements.inviteLink = root.querySelector('[data-friend-invite-link]');
    this.elements.inviteHint = root.querySelector('[data-friend-invite-hint]');
    this.elements.copyBtn = root.querySelector('[data-action="copy-invite"]');
    this.elements.telegramShare = root.querySelector('[data-action="share-telegram"]');
    this.elements.genericShare = root.querySelector('[data-action="share-generic"]');
    this.elements.stats = root.querySelector('[data-friend-stats]');
    this.elements.statSuccess = root.querySelector('[data-friend-stat-success]');
    this.elements.statPending = root.querySelector('[data-friend-stat-pending]');
    this.elements.statActive = root.querySelector('[data-friend-stat-active]');
    this.elements.statAlerts = root.querySelector('[data-friend-stat-alerts]');
    this.elements.statLast = root.querySelector('[data-friend-stat-last]');
    this.elements.statLpa = root.querySelector('[data-friend-stat-lpa]');
    this.elements.statRate = root.querySelector('[data-friend-stat-rate]');
    this.elements.friendList = root.querySelector('[data-friend-list]');
    this.elements.refreshBtn = root.querySelector('[data-action="refresh-friends"]');
  }

  bindUiEvents() {
    if (!this.elements.root) return;

    this.elements.generateBtn?.addEventListener('click', () => {
      this.handleGenerateInvite();
    });

    this.elements.copyBtn?.addEventListener('click', () => {
      this.copyInviteLink();
    });

    this.elements.telegramShare?.addEventListener('click', (event) => {
      event.preventDefault();
      this.shareOnTelegram();
    });

    this.elements.genericShare?.addEventListener('click', () => {
      this.shareGeneric();
    });

    this.elements.refreshBtn?.addEventListener('click', () => {
      this.refreshFriendList();
    });
  }

  requireAuth() {
    if (!this.authManager) {
      return true;
    }
    if (this.authManager.isAuthenticated()) {
      return true;
    }
    window.toastManager?.show('Log in through Telegram to use invites.', 'info');
    return false;
  }

  toggleInviteLoading(isLoading) {
    if (!this.elements.invitePanel) return;
    this.elements.invitePanel.classList.toggle('is-loading', Boolean(isLoading));
  }

  async handleGenerateInvite() {
    if (!this.requireAuth()) return;
    this.toggleInviteLoading(true);
    try {
      const data = await this.fetchJson('/friends/invite', { method: 'POST' });
      this.state.inviteLink = data.inviteLink;
      this.renderInviteLink(data);
      window.toastManager?.show('Invite link generated.', 'success');
      await this.refreshStats({ silent: true });
    } catch (error) {
      window.toastManager?.show(error.message || 'Unable to generate invite.', 'error');
    } finally {
      this.toggleInviteLoading(false);
    }
  }

  renderInviteLink(data) {
    if (!this.elements.invitePanel || !this.elements.inviteLink) return;
    this.elements.invitePanel.hidden = false;
    this.elements.inviteLink.textContent = data.inviteLink;
    if (this.elements.inviteHint) {
      const expiresAt = data.expiresAt ? formatDate(data.expiresAt) : '7 days';
      this.elements.inviteHint.textContent = `Expires ${expiresAt}. Share only with friends you trust.`;
    }
    if (this.elements.telegramShare) {
      const url = new URL('https://t.me/share/url');
      url.searchParams.set('url', data.inviteLink);
      url.searchParams.set('text', 'Join me in Lapia Games via Telegram.');
      this.elements.telegramShare.href = url.toString();
    }
  }

  async copyInviteLink() {
    const link = this.state.inviteLink || this.elements.inviteLink?.textContent;
    if (!link) {
      window.toastManager?.show('Generate a link first.', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      window.toastManager?.show('Invite link copied to clipboard.', 'success');
    } catch (error) {
      window.toastManager?.show('Unable to copy link.', 'error');
    }
  }

  async shareOnTelegram() {
    if (!this.state.inviteLink) {
      await this.handleGenerateInvite();
    }
    const link = this.state.inviteLink;
    if (!link) return;
    const url = new URL('https://t.me/share/url');
    url.searchParams.set('url', link);
    url.searchParams.set('text', 'Join me in Lapia Games! Telegram deep link inside.');
    window.open(url.toString(), '_blank', 'noopener');
  }

  async shareGeneric() {
    if (!this.state.inviteLink) {
      await this.handleGenerateInvite();
    }

    const link = this.state.inviteLink || this.elements.inviteLink?.textContent;
    if (!link) {
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Lapia Games invite',
          text: 'Join me on the Lapia Games platform!',
          url: link
        });
        return;
      } catch (error) {
        // fall back to copy
      }
    }

    this.copyInviteLink();
  }

  async refreshAll() {
    if (!this.authManager?.isAuthenticated()) {
      return;
    }
    await Promise.all([
      this.refreshStats({ silent: true }),
      this.refreshFriendList({ silent: true })
    ]);
  }

  async refreshStats(options = {}) {
    if (!this.elements.root) return;
    try {
      const stats = await this.fetchJson('/friends/stats');
      this.state.stats = stats;
      this.renderStats(stats);
      return stats;
    } catch (error) {
      if (!options.silent) {
        window.toastManager?.show(error.message || 'Unable to load invite stats.', 'error');
      }
      return null;
    }
  }

  renderStats(stats) {
    if (!stats || !this.elements.root) return;
    const ledger = stats.inviteLedger || {};
    if (this.elements.statSuccess) {
      this.elements.statSuccess.textContent = stats.successfulInvites ?? ledger.trackedSuccessfulInvites ?? 0;
    }
    if (this.elements.statPending) {
      const pending = stats.pendingInvites ?? ledger.trackedPendingInvites ?? 0;
      this.elements.statPending.textContent = pending;
    }
    if (this.elements.statActive) {
      this.elements.statActive.textContent = stats.friendsWhoAreActive ?? 0;
    }
    if (this.elements.statAlerts) {
      this.elements.statAlerts.textContent = stats.fraudAlerts ?? 0;
    }
    if (this.elements.statLast) {
      const label = ledger.lastInviteSentAt ? `Last invite — ${formatRelative(ledger.lastInviteSentAt)}` : 'Last invite — never';
      this.elements.statLast.textContent = label;
    }
    if (this.elements.statLpa) {
      const earned = stats.totalLPAEarned ?? 0;
      this.elements.statLpa.textContent = `+${earned} LPA earned`;
    }
    if (this.elements.statRate) {
      const rate = typeof stats.conversionRate === 'number' ? `${(stats.conversionRate * 100).toFixed(0)}% conversion` : '0% conversion';
      this.elements.statRate.textContent = rate;
    }
  }

  updateLedgerFromStatus(friendSnapshot) {
    if (!friendSnapshot || !this.elements.statSuccess) return;
    if (typeof friendSnapshot.successfulInvites === 'number') {
      this.elements.statSuccess.textContent = friendSnapshot.successfulInvites;
    }
    if (typeof friendSnapshot.pendingInvites === 'number' && this.elements.statPending) {
      this.elements.statPending.textContent = friendSnapshot.pendingInvites;
    }
    if (friendSnapshot.lastInviteSentAt && this.elements.statLast) {
      this.elements.statLast.textContent = `Last invite — ${formatRelative(friendSnapshot.lastInviteSentAt)}`;
    }
  }

  async refreshFriendList(options = {}) {
    if (!this.elements.root) return;
    try {
      const friends = await this.fetchJson('/friends');
      this.state.friends = Array.isArray(friends) ? friends : [];
      this.renderFriendList(this.state.friends);
      if (!options.silent) {
        window.toastManager?.show('Friend list updated.', 'success');
      }
      return friends;
    } catch (error) {
      if (!options.silent) {
        window.toastManager?.show(error.message || 'Unable to load friends.', 'error');
      }
      return null;
    }
  }

  renderFriendList(friends) {
    if (!this.elements.friendList) return;
    if (!friends || friends.length === 0) {
      this.elements.friendList.innerHTML = `<li class="friend-empty">${DEFAULT_EMPTY_STATE}</li>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    friends.forEach((friend) => {
      const li = document.createElement('li');
      const username = friend.username || 'Unknown player';
      const telegram = friend.telegramUsername ? `@${friend.telegramUsername}` : null;
      const lastActivity = friend.lastActivity ? formatRelative(friend.lastActivity) : 'inactive';
      const statusClass = friend.isOnline ? 'friend-status-pill' : 'friend-status-pill offline';
      const statusLabel = friend.isOnline ? 'Online now' : 'Offline';

      li.innerHTML = `
        <div class="friend-meta">
          <strong>${username}</strong>
          <span>${telegram || 'Telegram hidden'} · Last activity ${lastActivity}</span>
        </div>
        <span class="${statusClass}">${statusLabel}</span>
      `;
      fragment.appendChild(li);
    });

    this.elements.friendList.innerHTML = '';
    this.elements.friendList.appendChild(fragment);
  }

  renderEmpty() {
    if (this.elements.friendList) {
      this.elements.friendList.innerHTML = `<li class="friend-empty">${DEFAULT_EMPTY_STATE}</li>`;
    }
    if (this.elements.statSuccess) {
      this.elements.statSuccess.textContent = '0';
    }
    if (this.elements.statPending) {
      this.elements.statPending.textContent = '0';
    }
    if (this.elements.statActive) {
      this.elements.statActive.textContent = '0';
    }
    if (this.elements.statAlerts) {
      this.elements.statAlerts.textContent = '0';
    }
    if (this.elements.statLast) {
      this.elements.statLast.textContent = 'Last invite — never';
    }
    if (this.elements.statLpa) {
      this.elements.statLpa.textContent = '+0 LPA earned';
    }
    if (this.elements.statRate) {
      this.elements.statRate.textContent = '0% conversion';
    }
    if (this.elements.invitePanel) {
      this.elements.invitePanel.hidden = true;
    }
  }

  reset() {
    this.state = { stats: null, inviteLink: null, friends: [] };
    this.renderEmpty();
  }

  async fetchJson(path, options = {}) {
    const url = `${this.apiBase}${path}`;
    const opts = { ...options };
    opts.headers = { ...(options.headers || {}) };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
      if (!opts.headers['Content-Type']) {
        opts.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, opts);
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const message = payload?.error || `Request failed (${response.status})`;
      throw new Error(message);
    }

    return payload || {};
  }
}
