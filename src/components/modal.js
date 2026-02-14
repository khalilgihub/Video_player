/**
 * Hybrid Player - Modal System
 * Lightweight modal management
 */

class ModalManager {
  constructor() {
    this._init();
  }

  _init() {
    // ESC to close topmost modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal-overlay:not([hidden])');
        if (modals.length > 0) {
          modals[modals.length - 1].hidden = true;
        }
      }
    });
  }

  open(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.hidden = false;
      modal.focus();
    }
  }

  close(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.hidden = true;
    }
  }

  closeAll() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.hidden = true);
  }

  isOpen(modalId) {
    const modal = document.getElementById(modalId);
    return modal && !modal.hidden;
  }
}

window.HybridModal = new ModalManager();
