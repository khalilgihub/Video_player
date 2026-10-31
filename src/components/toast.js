/**
 * Hybrid Player - Toast Notifications
 */

class Toast {
  constructor() {
    this.container = document.getElementById('toastContainer');
    this._activeToasts = [];
  }

  clear() {
    if (this.container) {
      this.container.innerHTML = '';
    }
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

  showError(message, { actions = [], duration = 12000 } = {}) {
    const toast = document.createElement('div');
    toast.className = 'toast toast-update-pill toast-error';

    const label = document.createElement('span');
    label.className = 'toast-update-label';
    label.textContent = message;

    toast.appendChild(label);

    const dismiss = () => {
      toast.classList.add('hiding');
      setTimeout(() => {
        toast.remove();
        this._activeToasts = this._activeToasts.filter(t => t !== toast);
      }, 250);
    };

    actions.slice(0, 2).forEach(({ label: actionLabel, onClick }) => {
      if (typeof actionLabel !== 'string' || typeof onClick !== 'function') return;
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'btn-toast-update';
      actionBtn.innerHTML = `<span>${actionLabel}</span>`;
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { onClick(); } catch (_) {}
        dismiss();
      });
      toast.appendChild(actionBtn);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
    toast.appendChild(closeBtn);

    this.container.appendChild(toast);
    this._activeToasts.push(toast);
    setTimeout(dismiss, duration);

    if (this._activeToasts.length > 3) {
      const oldest = this._activeToasts.shift();
      oldest?.remove();
    }
  }

  showUpdatePrompt(info, onUpdate) {
    if (!info?.latestVersion) return;
    const existing = this.container.querySelector('.toast-update-pill');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast toast-update-pill';

    const iconBadge = document.createElement('div');
    iconBadge.className = 'toast-icon-badge';
    iconBadge.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span class="toast-indicator-dot toast-pulse-dot"></span>`;

    const textGroup = document.createElement('div');
    textGroup.className = 'toast-text-group';

    const label = document.createElement('span');
    label.className = 'toast-update-label';
    label.textContent = 'yt-dlp update available';

    const verTag = document.createElement('span');
    verTag.className = 'toast-version-tag';
    verTag.textContent = `v${info.latestVersion}`;

    textGroup.append(label, verTag);

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'btn-toast-update';
    updateBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Update Now</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;

    toast.append(iconBadge, textGroup, updateBtn, closeBtn);
    this.container.appendChild(toast);
    this._activeToasts.push(toast);

    let dismissTimer = setTimeout(() => {
      dismiss();
    }, 14000);

    const dismiss = () => {
      clearTimeout(dismissTimer);
      toast.classList.add('hiding');
      setTimeout(() => {
        toast.remove();
        this._activeToasts = this._activeToasts.filter(t => t !== toast);
      }, 250);
    };

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });

    updateBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      clearTimeout(dismissTimer);
      updateBtn.disabled = true;
      updateBtn.classList.add('loading');
      updateBtn.innerHTML = `<span class="toast-spinner"></span><span>Updating...</span>`;

      try {
        let result;
        if (typeof onUpdate === 'function') {
          result = await onUpdate();
        } else {
          result = await window.hybridAPI?.ytdlp?.update?.();
        }

        if (result?.success) {
          const newVer = result.newVersion || info.latestVersion;
          toast.classList.add('toast-success');
          iconBadge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
          label.textContent = `yt-dlp updated to v${newVer}!`;
          verTag.remove();
          updateBtn.remove();
          closeBtn.remove();

          if (window.HybridApp?.settingsModule) {
            window.HybridApp.settingsModule._refreshYtdlpStatus?.({ checkRemote: false });
          }

          setTimeout(() => dismiss(), 3000);
        } else {
          toast.classList.add('toast-error');
          label.textContent = `Update failed: ${result?.error || 'Check settings'}`;
          updateBtn.remove();
          setTimeout(() => dismiss(), 4000);
        }
      } catch (err) {
        toast.classList.add('toast-error');
        label.textContent = 'Update failed. Check settings.';
        updateBtn.remove();
        setTimeout(() => dismiss(), 4000);
      }
    });
  }
}

window.HybridToast = new Toast();
