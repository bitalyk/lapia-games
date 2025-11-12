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

// elements
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const authMsg = document.getElementById("authMsg");
const collectBtn = document.getElementById("collectBtn");
const sellBtn = document.getElementById("sellBtn");
const redeemBtn = document.getElementById("redeemBtn");
const coinsEl = document.getElementById("coins");
const birdsEl = document.getElementById("birds");
const eggsEl = document.getElementById("eggs");
const nextCollectEl = document.getElementById("nextCollect");

registerBtn.onclick = async () => {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value;
  if (!u || !p) { authMsg.textContent = "enter username & password"; return; }
  const res = await fetch(`${API}/users/register`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();
  if (data.success) {
    authMsg.style.color = "green";
    authMsg.textContent = "Registered — you can log in now";
  } else {
    authMsg.style.color = "red";
    authMsg.textContent = data.error || "Register failed";
  }
};

loginBtn.onclick = async () => {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value;
  if (!u || !p) { authMsg.textContent = "enter username & password"; return; }
  const res = await fetch(`${API}/users/login`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();
  if (data.success) {
    username = u;
    document.getElementById("auth").style.display = "none";
    document.getElementById("game").style.display = "block";
    startGame();
  } else {
    authMsg.style.color = "red";
    authMsg.textContent = data.error || "Login failed";
  }
};

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

collectBtn.onclick = async () => {
  if (!username) return alert("Login first");
  const res = await fetch(`${API}/game/collect`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ username })
  });
  const data = await res.json();
  if (res.status === 200 && data.success) {
    alert("Collected eggs into inventory.");
    await refreshState();
    renderUI();
  } else {
    if (data && data.error === "not_ready") {
      alert(`Not ready. Next collect in: ${formatSeconds(data.remainingSeconds)}`);
    } else {
      alert(data.message || data.error || "Collect failed");
    }
    await refreshState();
    renderUI();
  }
};

sellBtn.onclick = async () => {
  if (!username) return alert("Login first");
  const res = await fetch(`${API}/game/sell`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ username })
  });
  const data = await res.json();
  if (data.success) {
    if (data.gained > 0) alert(`Sold eggs for ${data.gained} coins`);
    else alert("No eggs to sell");
    await refreshState();
    renderUI();
  } else {
    alert(data.error || "Sell failed");
  }
};

redeemBtn.onclick = async () => {
  if (!username) return alert("Login first");
  const code = document.getElementById("codeInput").value.trim();
  if (!code) return alert("Enter code");
  const res = await fetch(`${API}/game/redeem`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ username, code })
  });
  const data = await res.json();
  if (data.success) {
    alert(data.message || "Redeemed");
    await refreshState();
    renderUI();
  } else {
    alert(data.error || data.message || "Redeem failed");
  }
};

// helper to auto-login if username left in field? no — explicit login only
// initial UI render will wait for login
