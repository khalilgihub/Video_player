/**
 * Hybrid Player - Preferences Service
 * Centralized preference management
 */

class PreferencesService {
  constructor() {
    this._defaults = {
      theme: 'dark',
      accentColor: '#e50914',
      language: 'en',
      autoResume: true,
      defaultSpeed: 1.0,
      hwAccel: true,
      volume: 1.0,
      subtitleFont: 'Segoe UI',
      subtitleSize: 28,
      subtitleColor: '#ffffff',
      subtitleBg: 'rgba(0,0,0,0.6)',
      subtitleSyncOffset: 0,
      equalizerPreset: 'flat',
      equalizerBands: [0,0,0,0,0,0,0,0,0,0],
      volumeNormalization: false,
      cacheSize: 150,
      debugLogs: false
    };
  }

  async get(key) {
    const val = await window.hybridAPI.db.getPreference(key);
    return val !== undefined ? val : this._defaults[key];
  }

  async set(key, value) {
    return window.hybridAPI.db.setPreference(key, value);
  }

  async getAll() {
    const prefs = await window.hybridAPI.db.getAllPreferences();
    return { ...this._defaults, ...prefs };
  }

  async reset() {
    return window.hybridAPI.db.saveAllPreferences(this._defaults);
  }
}

window.HybridPrefs = new PreferencesService();
