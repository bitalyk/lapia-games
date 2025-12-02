(function () {
    class ToastManager {
        constructor() {
            this.container = null;
            this.activeTimeout = null;
            this.currentToast = null;
            this.defaultDuration = 4000;
        }

        ensureContainer() {
            if (this.container && document.body.contains(this.container)) {
                return this.container;
            }

            let container = document.getElementById('toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toast-container';
                document.body.appendChild(container);
            }

            this.container = container;
            return container;
        }

        dismissCurrentToast() {
            if (!this.currentToast) {
                return;
            }

            if (this.activeTimeout) {
                clearTimeout(this.activeTimeout);
                this.activeTimeout = null;
            }

            const toast = this.currentToast;
            toast.classList.remove('toast--visible');
            toast.classList.add('toast--hiding');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 250);
            this.currentToast = null;
        }

        show(message, type = 'info', options = {}) {
            const container = this.ensureContainer();
            const { duration = this.defaultDuration, replace = true } = options;

            if (replace) {
                this.dismissCurrentToast();
            }

            const toast = document.createElement('div');
            toast.className = `toast toast--${type}`;
            toast.textContent = String(message);
            container.appendChild(toast);

            requestAnimationFrame(() => {
                toast.classList.add('toast--visible');
            });

            const clear = () => {
                toast.classList.remove('toast--visible');
                toast.classList.add('toast--hiding');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 220);
                if (this.currentToast === toast) {
                    this.currentToast = null;
                }
                if (this.activeTimeout === timeout) {
                    this.activeTimeout = null;
                }
            };

            const timeout = setTimeout(clear, Math.max(1000, duration));

            toast.addEventListener('click', () => {
                clearTimeout(timeout);
                clear();
            });

            this.currentToast = toast;
            this.activeTimeout = timeout;
            return toast;
        }
    }

    if (!window.toastManager) {
        window.toastManager = new ToastManager();
    }

    window.showToast = function showToast(message, type = 'info', duration) {
        const opts = {};
        if (typeof duration === 'number') {
            opts.duration = duration;
        }
        window.toastManager.show(message, type, opts);
    };
})();
