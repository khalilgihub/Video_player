/**
 * Hybrid Player - Toast Notifications
 */

class Toast {
  constructor() {
    this.container = document.getElementById('toastContainer');
    this._activeToasts = [];
  }

  show(message, duration = 2000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    
    this.container.appendChild(toast);
    this._activeToasts.push(toast);

    // Remove after duration
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => {
        toast.remove();
        this._activeToasts = this._activeToasts.filter(t => t !== toast);
      }, 250);
    }, duration);

    // Limit active toasts
    if (this._activeToasts.length > 3) {
      const oldest = this._activeToasts.shift();
      oldest?.remove();
    }
  }
}

window.HybridToast = new Toast();
