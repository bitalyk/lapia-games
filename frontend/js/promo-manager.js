(function() {
  class PromoRedeemWidget {
    constructor(options = {}) {
      this.gameId = options.gameId || '';
      this.inputSelector = options.inputSelector;
      this.buttonSelector = options.buttonSelector;
      this.historySelector = options.historySelector;
      const providedLimit = Number(options.historyLimit);
      if (Number.isFinite(providedLimit) && providedLimit > 0) {
        this.historyLimit = Math.floor(providedLimit);
      } else {
        this.historyLimit = 10;
      }
      this.onResult = typeof options.onResult === 'function' ? options.onResult : null;
      this.onError = typeof options.onError === 'function' ? options.onError : null;
      this.button = null;
      this.input = null;
      this.historyContainer = null;
      this.isLoading = false;
    }

    init() {
      this.input = this.query(this.inputSelector);
      this.button = this.query(this.buttonSelector);
      this.historyContainer = this.query(this.historySelector);

      if (!this.input || !this.button) {
        console.warn('[PromoRedeemWidget] Missing input or button for game:', this.gameId);
        return;
      }

      this.button.addEventListener('click', () => this.handleRedeem());
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.handleRedeem();
        }
      });

      this.renderHistoryPlaceholder();
      this.loadHistory();
    }

    query(selector) {
      if (!selector) return null;
      return document.querySelector(selector);
    }

    getUsername() {
      return window.authManager?.currentUser?.username || '';
    }

    showMessage(message, type = 'info') {
      const text = message || 'Promo update available.';
      if (window.toastManager) {
        window.toastManager.show(text, type);
      } else if (typeof window.showToast === 'function') {
        window.showToast(text, type, 3500);
      }
    }

    setLoading(state) {
      this.isLoading = state;
      if (this.button) {
        this.button.disabled = state;
        this.button.classList.toggle('is-loading', state);
      }
    }

    async handleRedeem() {
      if (this.isLoading) return;
      const username = this.getUsername();
      if (!username) {
        this.showMessage('Please log in to redeem codes.', 'error');
        return;
      }

      const code = (this.input?.value || '').trim().toUpperCase();
      if (!code) {
        this.showMessage('Enter a promo code first.', 'error');
        return;
      }

      try {
        this.setLoading(true);
        const response = await fetch('/api/promo/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, code })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          const errorMessage = data?.error || 'Failed to redeem promo code.';
          this.showMessage(errorMessage, 'error');
          if (this.onError) this.onError(errorMessage);
          return;
        }

        if (this.onResult) {
          this.onResult(data);
        } else {
          this.showMessage(data.message || 'Promo applied!', 'success');
        }

        if (this.input) {
          this.input.value = '';
        }

        this.loadHistory();
      } catch (error) {
        console.error('[PromoRedeemWidget] Redeem failed:', error);
        const message = 'Network error while redeeming code.';
        this.showMessage(message, 'error');
        if (this.onError) this.onError(message);
      } finally {
        this.setLoading(false);
      }
    }

    async loadHistory() {
      const username = this.getUsername();
      if (!username || !this.historyContainer) {
        return;
      }

      try {
        const response = await fetch(`/api/promo/history/${encodeURIComponent(username)}`);
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.entries)) {
          this.renderHistoryPlaceholder('No history available.');
          return;
        }

        const filtered = data.entries
          .filter(entry => {
            if (!entry || entry.success !== true) {
              return false;
            }
            if (!this.gameId) {
              return true;
            }
            return entry.game === this.gameId || entry.game === 'global';
          })
          .slice(0, this.historyLimit);

        this.renderHistory(filtered);
      } catch (error) {
        console.warn('[PromoRedeemWidget] Failed to load promo history:', error);
        this.renderHistoryPlaceholder('Unable to load history.');
      }
    }

    renderHistory(entries) {
      if (!this.historyContainer) return;
      this.historyContainer.innerHTML = '';

      if (!entries.length) {
        this.renderHistoryPlaceholder('No codes redeemed yet.');
        return;
      }

      const fragment = document.createDocumentFragment();
      entries.forEach(entry => {
        const item = document.createElement('li');
        item.className = `history-item ${entry.success ? 'success' : 'error'}`;

        const code = document.createElement('span');
        code.className = 'history-code';
        code.textContent = entry.code;

        const info = document.createElement('span');
        info.className = 'history-message';
        info.textContent = entry.message || entry.action || 'Promo applied';

        const time = document.createElement('time');
        time.className = 'history-time';
        if (entry.redeemedAt) {
          const date = new Date(entry.redeemedAt);
          time.textContent = date.toLocaleString();
        }

        item.appendChild(code);
        item.appendChild(info);
        item.appendChild(time);
        fragment.appendChild(item);
      });

      this.historyContainer.appendChild(fragment);
    }

    renderHistoryPlaceholder(text = 'No promo history yet.') {
      if (!this.historyContainer) return;
      this.historyContainer.innerHTML = '';
      const placeholder = document.createElement('li');
      placeholder.className = 'history-item empty';
      placeholder.textContent = text;
      this.historyContainer.appendChild(placeholder);
    }
  }

  window.PromoRedeemWidget = PromoRedeemWidget;
})();
