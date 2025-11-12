// frontend/script.js
const API = "http://localhost:3000/api";

const BIRDS = {
  red:    { cost: 1000,   eps: 1,  eggsPerCoin: 100, label: "Red" },
  orange: { cost: 2500,   eps: 2,  eggsPerCoin: 80,  label: "Orange" },
  yellow: { cost: 10000,  eps: 5,  eggsPerCoin: 50,  label: "Yellow" },
  green:  { cost: 25000,  eps: 10, eggsPerCoin: 40,  label: "Green" },
  blue:   { cost: 100000, eps: 20, eggsPerCoin: 20,  label: "Blue" },
  purple: { cost: 500000, eps: 50, eggsPerCoin: 10,  label: "Purple" },
};

let username = "";
let state = null; // latest server state

// --- remove early DOM queries (they run before DOM exists) ---
// elements will be resolved on DOMContentLoaded
let registerBtn, loginBtn, authMsg, collectBtn, sellBtn, redeemBtn;
let coinsEl, birdsEl, eggsEl, nextCollectEl;

// extract handlers from top-level onclicks into functions
async function handleRegister() {
  const uEl = document.getElementById("username");
  const pEl = document.getElementById("password");
  const u = uEl ? uEl.value.trim() : "";
  const p = pEl ? pEl.value : "";
  if (!u || !p) {
    if (authMsg) { authMsg.textContent = "enter username & password"; authMsg.style.color = "red"; }
    return;
  }
  try {
    const res = await fetch(`${API}/users/register`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (data.success) {
      if (authMsg) { authMsg.style.color = "green"; authMsg.textContent = "Registered — you can log in now"; }
      showToast("Registered — you can log in now", "success");
    } else {
      if (authMsg) { authMsg.style.color = "red"; authMsg.textContent = data.error || "Register failed"; }
      showToast(data.error || "Register failed", "error");
    }
  } catch (err) {
    console.error("register error", err);
    showToast("Register failed", "error");
  }
}

async function handleLogin() {
  const uEl = document.getElementById("username");
  const pEl = document.getElementById("password");
  const u = uEl ? uEl.value.trim() : "";
  const p = pEl ? pEl.value : "";
  if (!u || !p) {
    if (authMsg) { authMsg.textContent = "enter username & password"; authMsg.style.color = "red"; }
    return;
  }
  try {
    const res = await fetch(`${API}/users/login`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (data.success) {
      // persist and enter game
      setLoggedIn(u);
      showToast("Welcome back", "success");
    } else {
      if (authMsg) { authMsg.style.color = "red"; authMsg.textContent = data.error || "Login failed"; }
      showToast(data.error || "Login failed", "error");
    }
  } catch (err) {
    console.error("login error", err);
    showToast("Login failed", "error");
  }
}

async function startGame() {
  await refreshState();
  renderUI();
  // poll server every 3s for status changes
  setInterval(refreshState, 3000);
  // update UI every second (live eggs & timer)
  setInterval(renderUI, 1000);
}

async function refreshState() {
  if (!username) return;
  try {
    const res = await fetch(`${API}/game/status/${encodeURIComponent(username)}`);
    if (res.status !== 200) {
      // user may be missing or server error
      console.error("status fetch failed", res.status);
      return;
    }
    state = await res.json();
  } catch (err) {
    console.error("refresh error", err);
  }
}

// compute live produced eggs (produced since productionStart, capped to 6h)
function computeLiveProduced() {
  if (!state) return {};
  const start = new Date(state.productionStart).getTime();
  let seconds = Math.floor((Date.now() - start) / 1000);
  if (seconds < 0) seconds = 0;
  const max = 6 * 60 * 60;
  const used = Math.min(seconds, max);
  const produced = {};
  for (const c of Object.keys(BIRDS)) {
    const count = (state.birds && state.birds[c]) ? state.birds[c] : 0;
    produced[c] = Math.floor(count * BIRDS[c].eps * used);
  }
  return { produced, seconds: Math.min(seconds, max), rawSeconds: seconds };
}

function renderUI() {
  if (!state) return;
  coinsEl.textContent = state.coins;

  // birds grid
  birdsEl.innerHTML = "";
  for (const c of Object.keys(BIRDS)) {
    const count = state.birds?.[c] || 0;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div><strong style="text-transform:capitalize">${BIRDS[c].label} (${c})</strong></div>
      <div>Count: <span>${count}</span></div>
      <div>Cost: ${BIRDS[c].cost} coins</div>
      <div>Production: ${BIRDS[c].eps} eggs/sec</div>
      <div><button class="buyBtn" data-type="${c}">Buy</button></div>
    `;
    birdsEl.appendChild(card);
  }
  // attach buy handlers
  document.querySelectorAll(".buyBtn").forEach(b => {
    b.onclick = async (e) => {
      const type = e.currentTarget.dataset.type;
      await buyBird(type);
    };
  });

  // eggs grid + live produced
  const { produced, seconds, rawSeconds } = computeLiveProduced();
  eggsEl.innerHTML = "";
  for (const c of Object.keys(BIRDS)) {
    const inv = state.eggs?.[c] || 0;
    const prod = produced?.[c] || 0;
    const producedSince = prod; // produced amount (capped)
    const generatedActive = rawSeconds < (6*60*60); // true if still generating (before 6h)
    const producedDisplay = producedSince;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div><strong style="text-transform:capitalize">${BIRDS[c].label} eggs</strong></div>
      <div>Inventory: <span id="inv-${c}">${inv}</span></div>
      <div>Produced (this cycle): <span id="prod-${c}">${producedDisplay}</span></div>
      <div>Eggs per 1 coin: ${BIRDS[c].eggsPerCoin}</div>
    `;
    eggsEl.appendChild(card);
  }

  // next collect timer / status
  const prodStart = new Date(state.productionStart).getTime();
  const elapsed = Math.floor((Date.now() - prodStart) / 1000);
  const max = 6 * 60 * 60;
  if (elapsed >= max) {
    nextCollectEl.textContent = "Ready to collect!";
  } else {
    const remain = max - elapsed;
    nextCollectEl.textContent = formatSeconds(remain);
  }
}

function formatSeconds(sec) {
  if (sec <= 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function pad(n) { return n.toString().padStart(2, "0"); }

// actions
async function buyBird(type) {
  if (!username) return alert("Login first");
  const res = await fetch(`${API}/game/buy`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ username, type })
  });
  const data = await res.json();
  if (data.success) {
    await refreshState();
    renderUI();
  } else {
    alert(data.error || data.message || "Cannot buy");
  }
}

/**
 * showToast(message, type='info', duration=3000)
 * type: 'info' | 'success' | 'error'
 */
function showToast(message, type = "info", duration = 3000) {
  try {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      document.body.appendChild(container);
    }

    const el = document.createElement("div");
    el.className = "toast " + (type || "info");
    el.textContent = message;
    container.appendChild(el);

    // force reflow then show
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight;
    el.classList.add("show");

    // hide after duration
    const hideTimeout = setTimeout(() => {
      el.classList.remove("show");
      el.classList.add("hide");
      // remove after transition
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 420);
    }, duration);

    // allow click to dismiss early
    el.addEventListener("click", () => {
      clearTimeout(hideTimeout);
      el.classList.remove("show");
      el.classList.add("hide");
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    });
  } catch (e) {
    // fallback to native alert if anything goes wrong
    console.error("toast failed", e);
    window.__native_alert__?.(message) ?? window.alert(message);
  }
}

// keep a reference to native alert in case we need it
if (!window.__native_alert__) window.__native_alert__ = window.alert.bind(window);
// override global alert to use toasts so existing code works without edits
window.alert = function (msg) {
  showToast(String(msg), "info", 3000);
};

// helper: show/hide containers
function showLoginUI() {
  const lc = document.getElementById("login-container");
  const gc = document.getElementById("game-container");
  const logoutBtn = document.getElementById("logout-btn");
  if (lc) lc.style.display = "";
  if (gc) gc.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "none";
}
function showGameUI() {
  const lc = document.getElementById("login-container");
  const gc = document.getElementById("game-container");
  const logoutBtn = document.getElementById("logout-btn");
  if (lc) lc.style.display = "none";
  if (gc) gc.style.display = "";
  if (logoutBtn) logoutBtn.style.display = "";
}

// set logged in state (store and switch UI)
function setLoggedIn(user) {
  if (!user) return;
  localStorage.setItem("clicker_user", user);
  // keep both the module-global and window-scoped username in sync
  username = user;
  window.currentUsername = user;
  showGameUI();
  // startGame may expect username or use window.currentUsername; try both
  if (typeof startGame === "function") {
    try { startGame(user); } catch (e) { try { startGame(); } catch (e2) { console.warn("startGame failed", e, e2); } }
  } else if (typeof refreshState === "function") {
    try { refreshState(user); } catch (e) { console.warn("refreshState failed", e); }
  }
}

// logout: clear storage, stop intervals and show login
function logout() {
  localStorage.removeItem("clicker_user");
  window.currentUsername = null;
  // if your code uses an interval, try to clear it if stored as window.gameInterval (modify if different)
  if (window.gameInterval) {
    clearInterval(window.gameInterval);
    window.gameInterval = null;
  }
  // stop any other intervals you created in startGame (if you named them, clear them here)
  showLoginUI();
  showToast("Logged out", "info", 1500);
}

// remove any top-level .onclick assignments and replace with guarded bindings + delegation

// helper to safely bind a handler to an element id
function safeOn(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[script.js] missing element #${id}`);
    return null;
  }
  el.addEventListener(event, handler);
  return el;
}

// delegation for dynamic buy buttons inside birdsEl
function bindDelegation() {
  if (!birdsEl) {
    console.warn("[script.js] bindDelegation: birdsEl not found");
    return;
  }

  // Remove previous handler if present to avoid duplicates
  birdsEl._buyHandler && birdsEl.removeEventListener("click", birdsEl._buyHandler);

  const handler = (e) => {
    const btn = e.target.closest && e.target.closest(".buy-btn");
    if (!btn) return;
    const type = btn.dataset.type;
    if (!type) return;
    buyBird(type);
  };

  birdsEl.addEventListener("click", handler);
  birdsEl._buyHandler = handler;
}

// central binding for static controls
function bindStaticUI() {
  safeOn("registerBtn", "click", handleRegister);
  safeOn("loginBtn", "click", handleLogin);
  safeOn("logout-btn", "click", logout);

  // collect/sell/redeem buttons (may be null until DOM contains them)
  safeOn("collectBtn", "click", async () => {
    if (!window.currentUsername) return showToast("Login first", "info");
    await fetch(`${API}/game/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: window.currentUsername }),
    })
      .then((r) => r.json())
      .then(async (data) => {
        if (data && data.success) showToast("Collected eggs into inventory.", "success");
        else if (data && data.error === "not_ready") showToast(`Not ready. ${data.remainingSeconds}s`, "info");
        else showToast(data.error || "Collect failed", "error");
        await refreshState();
        renderUI();
      })
      .catch((err) => {
        console.error("collect error", err);
        showToast("Collect failed", "error");
      });
  });

  safeOn("sellBtn", "click", async () => {
    if (!window.currentUsername) return showToast("Login first", "info");
    try {
      const res = await fetch(`${API}/game/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: window.currentUsername }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.gained > 0) showToast(`Sold eggs for ${data.gained} coins`, "success");
        else showToast("No eggs to sell", "info");
        await refreshState();
        renderUI();
      } else {
        showToast(data.error || "Sell failed", "error");
      }
    } catch (err) {
      console.error("sell error", err);
      showToast("Sell failed", "error");
    }
  });

  safeOn("redeemBtn", "click", async () => {
    if (!window.currentUsername) return showToast("Login first", "info");
    const codeInput = document.getElementById("codeInput");
    const code = codeInput ? codeInput.value.trim() : "";
    if (!code) return showToast("Enter code", "info");
    try {
      const res = await fetch(`${API}/game/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: window.currentUsername, code }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || "Redeemed", "success");
        await refreshState();
        renderUI();
      } else {
        showToast(data.error || data.message || "Redeem failed", "error");
      }
    } catch (err) {
      console.error("redeem error", err);
      showToast("Redeem failed", "error");
    }
  });
}

// call bindings after DOM ready and after UI re-renders (so dynamic buttons are wired)
document.addEventListener("DOMContentLoaded", () => {
  console.log("[Happy Birds] DOM ready - binding UI");
  // resolve a few commonly used elements so other code can use them
  coinsEl = document.getElementById("coins");
  birdsEl = document.getElementById("birds");
  eggsEl = document.getElementById("eggs");
  nextCollectEl = document.getElementById("nextCollect");

  bindStaticUI();
  bindDelegation();

  const saved = localStorage.getItem("clicker_user");
  if (saved) setLoggedIn(saved);
  else showLoginUI();
});

// ensure renderUI calls bindDelegation() after it writes birdsEl HTML
// update renderUI to call bindDelegation() at the end (if you control renderUI implementation)
const _oldRenderUI = renderUI;
renderUI = function () {
  try {
    _oldRenderUI();
  } finally {
    // rebind delegation so buy buttons work after re-render
    birdsEl = document.getElementById("birds");
    bindDelegation();
  }
};

// quick debug: confirm script loaded
console.log("[Happy Birds] script.js loaded");
