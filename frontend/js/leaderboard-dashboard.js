const TAB_CONFIG = [
  { id: "total-coins", label: "🏆 Total Coins", endpoint: "/total-coins" },
  { id: "happybirds", label: "🐦 Happy Birds", endpoint: "/game/happybirds" },
  { id: "richgarden", label: "🌳 Rich Garden", endpoint: "/game/richgarden" },
  { id: "goldenmine", label: "⛏️ Golden Mine", endpoint: "/game/goldenmine" },
  { id: "catchess", label: "🐱 Cat Chess", endpoint: "/game/catchess" },
  { id: "fishes", label: "🐠 Fishes", endpoint: "/game/fishes" },
  { id: "lpa", label: "💎 LPA Earned", endpoint: "/lpa" }
];

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export class LeaderboardDashboard {
  constructor({ authManager }) {
    this.authManager = authManager;
    const origin = typeof window !== "undefined" && window.location?.origin
      ? window.location.origin.replace(/\/$/, "")
      : "http://localhost:3000";
    this.apiBase = `${origin}/api/leaderboards`;
    this.root = document.getElementById("leaderboard-dashboard");
    this.activeTab = "total-coins";
    this.cache = new Map();
    this.userStats = null;
    this.currentUsername = null;
    this.isReady = false;
  }

  init() {
    if (!this.root) {
      return;
    }

    this.renderSkeleton();
    this.bindEvents();
    this.isReady = true;

    if (this.authManager?.isAuthenticated?.() && this.authManager.currentUser?.username) {
      this.handleLogin({ username: this.authManager.currentUser.username });
    }
  }

  bindEvents() {
    window.addEventListener("platformLogin", (event) => {
      this.handleLogin(event?.detail?.user || {});
    });

    window.addEventListener("platformLogout", () => {
      this.handleLogout();
    });

    this.root.addEventListener("click", (event) => {
      const tabButton = event.target.closest("[data-tab-id]");
      if (tabButton) {
        const tabId = tabButton.getAttribute("data-tab-id");
        this.setActiveTab(tabId);
        return;
      }

      if (event.target.matches("[data-role='refresh-board']")) {
        this.refreshActiveLeaderboard();
      }

      if (event.target.matches("[data-role='refresh-user']")) {
        this.loadUserPanel(true);
      }
    });
  }

  handleLogin(user) {
    if (!this.isReady) {
      return;
    }
    const username = user?.username || this.authManager?.currentUser?.username;
    if (!username) {
      return;
    }
    this.currentUsername = username;
    this.root.hidden = false;
    this.root.classList.remove("leaderboard-dashboard--empty");
    this.loadUserPanel();
    this.loadActiveLeaderboard(true);
  }

  handleLogout() {
    this.currentUsername = null;
    this.cache.clear();
    this.userStats = null;
    this.updateLeaderboardContent({ state: "empty", message: "Sign in to view live leaderboards." });
    this.updateUserPanelPlaceholder();
    this.root.hidden = true;
  }

  setActiveTab(tabId) {
    if (!TAB_CONFIG.some((tab) => tab.id === tabId)) {
      return;
    }
    this.activeTab = tabId;
    this.root.querySelectorAll(".leaderboard-tabs button").forEach((button) => {
      const matches = button.getAttribute("data-tab-id") === tabId;
      button.classList.toggle("active", matches);
    });
    this.loadActiveLeaderboard();
  }

  refreshActiveLeaderboard() {
    this.loadActiveLeaderboard(true);
  }

  getActiveTabConfig() {
    return TAB_CONFIG.find((tab) => tab.id === this.activeTab) || TAB_CONFIG[0];
  }

  async loadActiveLeaderboard(force = false) {
    const tab = this.getActiveTabConfig();
    if (!tab) {
      return;
    }

    if (!this.currentUsername) {
      this.updateLeaderboardContent({ state: "empty", message: "Log in to explore leaderboard data." });
      return;
    }

    const cacheKey = `${tab.id}`;
    if (!force && this.cache.has(cacheKey)) {
      this.renderLeaderboard(this.cache.get(cacheKey));
      return;
    }

    this.updateLeaderboardContent({ state: "loading" });
    try {
      const data = await this.fetchJson(`${this.apiBase}${tab.endpoint}?limit=10`);
      if (!data?.success) {
        throw new Error(data?.error || "Failed to load leaderboard");
      }
      this.cache.set(cacheKey, data);
      this.renderLeaderboard(data);
    } catch (error) {
      console.error("Leaderboard fetch failed", error);
      this.updateLeaderboardContent({ state: "error", message: "Unable to load leaderboard right now." });
      window.toastManager?.show?.("Failed to load leaderboard", "error");
    }
  }

  async loadUserPanel(force = false) {
    if (!this.currentUsername) {
      this.updateUserPanelPlaceholder();
      return;
    }

    if (!force && this.userStats) {
      this.renderUserPanel();
      return;
    }

    this.updateUserPanelPlaceholder("Loading your stats…");
    try {
      const data = await this.fetchJson(`${this.apiBase}/user/${encodeURIComponent(this.currentUsername)}`);
      if (!data?.success) {
        throw new Error(data?.error || "Failed to load user stats");
      }
      this.userStats = data;
      this.renderUserPanel();
    } catch (error) {
      console.error("User panel fetch failed", error);
      window.toastManager?.show?.("Failed to load player stats", "error");
      this.updateUserPanelPlaceholder("Stats unavailable. Try again later.");
    }
  }

  async fetchJson(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  renderSkeleton() {
    this.root.innerHTML = `
      <div class="leaderboard-card">
        <div class="leaderboard-head">
          <div>
            <p class="leaderboard-eyebrow">Top 10 Dashboards</p>
            <h2>Lifetime Leaderboards</h2>
          </div>
          <div class="leaderboard-actions">
            <button type="button" class="ghost" data-role="refresh-board">Refresh</button>
          </div>
        </div>
        <div class="leaderboard-tabs">
          ${TAB_CONFIG.map((tab) => `
            <button type="button" data-tab-id="${tab.id}" class="${tab.id === this.activeTab ? "active" : ""}">
              ${tab.label}
            </button>
          `).join("")}
        </div>
        <div class="leaderboard-content" data-role="leaderboard-content">
          ${this.renderPlaceholderRows("Loading leaderboards…")}
        </div>
        <div class="leaderboard-user-panel" data-role="user-panel">
          <div class="leaderboard-user-placeholder">Sign in to see your rank across every game.</div>
        </div>
      </div>
    `;
  }

  renderLeaderboard(data) {
    if (!data?.leaderboard || data.leaderboard.length === 0) {
      this.updateLeaderboardContent({ state: "empty", message: "No entries yet. Be the first to place!" });
      return;
    }

    const content = data.leaderboard.map((entry) => {
      const isCurrentUser = entry.username?.toLowerCase() === this.currentUsername?.toLowerCase();
      return `
        <div class="leaderboard-row ${isCurrentUser ? "current" : ""}">
          <div class="rank">#${entry.rank || "-"}</div>
          <div class="player">
            <span class="username">${entry.username}</span>
            ${entry.firstName ? `<span class="name">${entry.firstName}</span>` : ""}
          </div>
          <div class="value">${NUMBER_FORMATTER.format(entry.value || 0)}</div>
        </div>
      `;
    }).join("");

    const footer = data.userRank?.rank
      ? `<p class="leaderboard-footnote">You are currently #${NUMBER_FORMATTER.format(data.userRank.rank)} on this board.</p>`
      : "";

    const container = this.root.querySelector("[data-role='leaderboard-content']");
    if (container) {
      container.innerHTML = `${content}${footer}`;
    }
  }

  updateLeaderboardContent({ state, message }) {
    const container = this.root.querySelector("[data-role='leaderboard-content']");
    if (!container) {
      return;
    }

    if (state === "loading") {
      container.innerHTML = this.renderPlaceholderRows("Loading leaderboards…");
      return;
    }

    const displayMessage = message || "Nothing to display.";
    container.innerHTML = `<div class="leaderboard-state">${displayMessage}</div>`;
  }

  renderPlaceholderRows(message) {
    return `
      <div class="leaderboard-state">${message}</div>
      <div class="leaderboard-skeleton"></div>
    `;
  }

  renderUserPanel() {
    const panel = this.root.querySelector("[data-role='user-panel']");
    if (!panel || !this.userStats?.summary) {
      this.updateUserPanelPlaceholder();
      return;
    }

    const { summary, ranks } = this.userStats;
    const info = [
      { label: "Total Coins", value: NUMBER_FORMATTER.format(summary.totalCoins || 0), rank: ranks?.totalCoins?.rank },
      { label: "Total LPA", value: NUMBER_FORMATTER.format(summary.totalLpa || 0), rank: ranks?.lpa?.rank }
    ];

    const perGame = Object.entries(summary.games || {}).map(([slug, value]) => {
      const rank = ranks?.perGame?.[slug]?.rank || null;
      return `
        <div class="stat-line">
          <span>${this.getGameLabel(slug)}</span>
          <span>${NUMBER_FORMATTER.format(value || 0)}${rank ? ` · #${NUMBER_FORMATTER.format(rank)}` : ""}</span>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="user-panel-head">
        <div>
          <p class="leaderboard-eyebrow">Your Progress</p>
          <h3>${summary.username}</h3>
          <p class="timestamp">Updated ${this.formatRelativeTime(summary.lastUpdated)}</p>
        </div>
        <button type="button" class="ghost" data-role="refresh-user">Refresh</button>
      </div>
      <div class="user-stat-grid">
        ${info.map((item) => `
          <div class="stat-pill">
            <p>${item.label}</p>
            <strong>${item.value}</strong>
            ${item.rank ? `<span class="rank-chip">#${NUMBER_FORMATTER.format(item.rank)}</span>` : ""}
          </div>
        `).join("")}
      </div>
      <div class="user-game-breakdown">
        <h4>Per-game totals</h4>
        ${perGame}
      </div>
    `;
  }

  updateUserPanelPlaceholder(message = "Sign in to see your rank across every game.") {
    const panel = this.root.querySelector("[data-role='user-panel']");
    if (!panel) {
      return;
    }
    panel.innerHTML = `<div class="leaderboard-user-placeholder">${message}</div>`;
  }

  getGameLabel(slug) {
    const tab = TAB_CONFIG.find((item) => item.id === slug);
    if (!tab) {
      return slug;
    }
    return tab.label.replace(/^[^\w]+\s*/, "");
  }

  formatRelativeTime(value) {
    if (!value) {
      return "just now";
    }
    const timestamp = typeof value === "string" ? Date.parse(value) : value;
    if (Number.isNaN(timestamp)) {
      return "recently";
    }
    const diff = Date.now() - timestamp;
    if (diff < 60 * 1000) {
      return "just now";
    }
    if (diff < 60 * 60 * 1000) {
      const mins = Math.round(diff / (60 * 1000));
      return `${mins} min ago`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.round(diff / (60 * 60 * 1000));
      return `${hours} hr ago`;
    }
    const days = Math.round(diff / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }
}
