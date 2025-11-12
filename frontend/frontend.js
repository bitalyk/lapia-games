const API = "http://localhost:3000";
let user = null;
let timerInterval;

async function register() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  alert("Registered! You can now log in.");
}

async function login() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  user = await res.json();
  if (!user.username) return alert(user.message);
  document.getElementById("auth").style.display = "none";
  document.getElementById("game").style.display = "block";
  document.getElementById("user-name").textContent = user.username;
  updateUI();
  startTimer();
}

function updateUI() {
  document.getElementById("coins").textContent = Math.floor(user.coins);
  document.getElementById("birds").innerHTML = Object.keys(user.birds)
    .map(c => `<div>${c}: ${user.birds[c]}</div>`).join("");
  document.getElementById("eggs").innerHTML = Object.keys(user.eggs)
    .map(c => `<div>${c}: ${Math.floor(user.eggs[c])}</div>`).join("");
}

async function collect() {
  const res = await fetch(`${API}/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username }),
  });
  user = await res.json();
  if (user.message) return alert(user.message);
  updateUI();
}

async function sell() {
  const res = await fetch(`${API}/sell`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username }),
  });
  user = await res.json();
  updateUI();
}

async function redeem() {
  const code = document.getElementById("code").value.trim();
  if (!code) return;
  const res = await fetch(`${API}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, code }),
  });
  user = await res.json();
  if (user.message) alert(user.message);
  updateUI();
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!user.lastCollect) {
      document.getElementById("timer").textContent = "Ready";
      return;
    }
    const diff = (Date.now() - new Date(user.lastCollect).getTime()) / 1000;
    const remaining = 6 * 3600 - diff;
    if (remaining > 0) {
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      const s = Math.floor(remaining % 60);
      document.getElementById("timer").textContent = `${h}h ${m}m ${s}s`;
    } else {
      document.getElementById("timer").textContent = "Ready!";
    }

    // Simulate live egg count
    for (const color in user.birds) {
      if (remaining < 0) continue; // stop generating after 6h
      const birdCount = user.birds[color];
      const eggRate = { red:1,orange:2,yellow:5,green:10,blue:20,purple:50 }[color];
      user.eggs[color] += birdCount * eggRate / 10; // update every 0.1s worth
    }
    updateUI();
  }, 1000);
}
