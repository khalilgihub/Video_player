/**
 * Hybrid Player - Database Service
 * Local storage abstraction for the renderer process
 */

class DatabaseService {
  constructor() {
    this._cache = {};
  }

  async getPreference(key) {
    return window.hybridAPI.db.getPreference(key);
  }

  async setPreference(key, value) {
    return window.hybridAPI.db.setPreference(key, value);
  }

  async getAllPreferences() {
    if (!this._cache.prefs) {
      this._cache.prefs = await window.hybridAPI.db.getAllPreferences();
    }
    return this._cache.prefs;
  }

  invalidateCache() {
    this._cache = {};
  }
}

window.HybridDB = new DatabaseService();
