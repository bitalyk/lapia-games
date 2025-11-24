// frontend/script.js - УПРОЩЕННАЯ ВЕРСИЯ

// Вспомогательные функции
function showAuthMessage(message, type = "info") {
  const authMsg = document.getElementById("authMsg");
  if (authMsg) {
    authMsg.textContent = message;
    authMsg.style.color = type === "error" ? "#e74c3c" : 
                         type === "success" ? "#27ae60" : "#333";
  }
}

// Обновляем старые функции для совместимости
function setLoggedIn(user) {
  // Теперь используем authManager
  if (typeof user === 'string' && window.authManager) {
    window.authManager.login(user, '').catch(console.error);
  }
}

function showLoginUI() {
  if (window.authManager) {
    window.authManager.logout();
  }
}

function logout() {
  if (window.authManager) {
    window.authManager.logout();
  }
}

// Toast функция (оставляем для совместимости)
function showToast(message, type = "info", duration = 3000) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);

  // Force reflow then show
  el.offsetHeight;
  el.classList.add("show");

  const hideTimeout = setTimeout(() => {
    el.classList.remove("show");
    el.classList.add("hide");
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 420);
  }, duration);

  el.addEventListener("click", () => {
    clearTimeout(hideTimeout);
    el.classList.remove("show");
    el.classList.add("hide");
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 220);
  });
}

// Совместимость со старой системой
if (!window.__native_alert__) window.__native_alert__ = window.alert.bind(window);
window.alert = function (msg) {
  showToast(String(msg), "info", 3000);
};

// Привязка событий после загрузки DOM
document.addEventListener("DOMContentLoaded", () => {
  console.log("🎮 Lapia Games Platform - Initializing");
  
  // Привязываем кнопки аутентификации
  const registerBtn = document.getElementById("registerBtn");
  const loginBtn = document.getElementById("loginBtn");

  if (registerBtn) {
    registerBtn.addEventListener("click", async () => {
      const usernameInput = document.getElementById("username");
      const passwordInput = document.getElementById("password");
      
      const username = usernameInput.value.trim();
      const password = passwordInput.value;

      if (!username || !password) {
        showAuthMessage("Please enter username and password", "error");
        return;
      }

      if (window.authManager) {
        const result = await window.authManager.register(username, password);
        
        if (result.success) {
          showAuthMessage("Registration successful! Welcome to Lapia Games!", "success");
          showToast("🎉 Welcome to Lapia Games Platform!", "success");
        } else {
          showAuthMessage(result.error || "Registration failed", "error");
        }
      } else {
        showAuthMessage("Authentication system not ready", "error");
      }
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const usernameInput = document.getElementById("username");
      const passwordInput = document.getElementById("password");
      
      const username = usernameInput.value.trim();
      const password = passwordInput.value;

      if (!username || !password) {
        showAuthMessage("Please enter username and password", "error");
        return;
      }

      if (window.authManager) {
        const result = await window.authManager.login(username, password);
        
        if (result.success) {
          showAuthMessage("Login successful!", "success");
          showToast(`Welcome back, ${username}!`, "success");
        } else {
          showAuthMessage(result.error || "Login failed", "error");
        }
      } else {
        showAuthMessage("Authentication system not ready", "error");
      }
    });
  }

  // Добавляем обработку Enter в полях ввода
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  if (usernameInput && passwordInput) {
    const handleEnter = (event) => {
      if (event.key === "Enter") {
        if (loginBtn) loginBtn.click();
      }
    };

    usernameInput.addEventListener("keypress", handleEnter);
    passwordInput.addEventListener("keypress", handleEnter);
  }

  // Проверяем начальное состояние аутентификации
  setTimeout(() => {
    if (window.authManager && !window.authManager.isAuthenticated()) {
      showAuthMessage("Enter your credentials to access the platform", "info");
    }
  }, 1000);
});