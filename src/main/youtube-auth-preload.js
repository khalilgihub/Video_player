/**
 * Preload for the YouTube sign-in window ONLY.
 *
 * Runs with contextIsolation:true and nodeIntegration:false; the patch is injected into
 * the page's main world via webFrame.executeJavaScript (page scripts get no Node access) and patches
 * the browser-identity surface Google's login heuristics probe beyond the
 * User-Agent string: navigator.plugins/mimeTypes (empty in embedded engines)
 * and navigator.userAgentData (Client Hints brands/version).
 *
 * This is best-effort: Google can tighten detection at any time; when the
 * block page appears the main process notifies the user to retry sign-in.
 */

function patchIdentity() {
  try {
    const CHROME_VERSION = '132';
    const CHROME_FULL_VERSION = '132.0.6834.160';

    // ── navigator.plugins / mimeTypes (Chrome's PDF viewer set) ──
    const mimeDescriptors = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];
    const pluginNames = ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'];

    const fakeMimes = mimeDescriptors.map((m) => Object.assign(Object.create(MimeType.prototype), m));
    const fakePlugins = pluginNames.map((name, i) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: name },
        description: { value: 'Portable Document Format' },
        filename: { value: 'internal-pdf-viewer' },
        length: { value: fakeMimes.length },
        item: { value: (index) => fakeMimes[index % fakeMimes.length] || null },
        namedItem: { value: (typeName) => fakeMimes.find((m) => m.type === typeName) || null },
        0: { value: fakeMimes[i % fakeMimes.length], enumerable: true },
      });
      return plugin;
    });

    const pluginArrayLike = Object.create(PluginArray.prototype);
    fakePlugins.forEach((p, i) => {
      pluginArrayLike[i] = p;
      pluginArrayLike[p.name] = p;
    });
    Object.defineProperties(pluginArrayLike, {
      length: { value: fakePlugins.length },
      item: { value: (index) => fakePlugins[index] || null },
      namedItem: { value: (name) => fakePlugins.find((p) => p.name === name) || null },
      refresh: { value: () => {} },
    });
    Object.defineProperty(Navigator.prototype, 'plugins', {
      get: () => pluginArrayLike,
      configurable: true,
    });

    const mimeArrayLike = Object.create(MimeTypeArray.prototype);
    fakeMimes.forEach((m, i) => {
      mimeArrayLike[i] = m;
      mimeArrayLike[m.type] = m;
    });
    Object.defineProperties(mimeArrayLike, {
      length: { value: fakeMimes.length },
      item: { value: (index) => fakeMimes[index] || null },
      namedItem: { value: (type) => fakeMimes.find((m) => m.type === type) || null },
    });
    Object.defineProperty(Navigator.prototype, 'mimeTypes', {
      get: () => mimeArrayLike,
      configurable: true,
    });

    // ── navigator.userAgentData (Client Hints) ──
    const brands = [
      { brand: 'Not.A/Brand', version: '99' },
      { brand: 'Google Chrome', version: CHROME_VERSION },
      { brand: 'Chromium', version: CHROME_VERSION },
    ];
    const fullVersionList = [
      { brand: 'Not.A/Brand', version: '99.0.0.0' },
      { brand: 'Google Chrome', version: CHROME_FULL_VERSION },
      { brand: 'Chromium', version: CHROME_FULL_VERSION },
    ];
    const userAgentData = {
      brands,
      mobile: false,
      platform: 'Windows',
      toJSON() {
        return { brands, mobile: false, platform: 'Windows' };
      },
      async getHighEntropyValues(hints) {
        const list = Array.isArray(hints) ? hints : [];
        const out = {};
        for (const hint of list) {
          if (hint === 'uaFullVersion') out[hint] = CHROME_FULL_VERSION;
          else if (hint === 'fullVersionList') out[hint] = fullVersionList;
          else if (hint === 'platformVersion') out[hint] = '10.0.0';
          else if (hint === 'architecture') out[hint] = 'x86';
          else if (hint === 'bitness') out[hint] = '64';
          else if (hint === 'model') out[hint] = '';
          else if (hint === 'platform') out[hint] = 'Windows';
          else if (hint === 'wow64') out[hint] = false;
          else if (hint === 'formFactors') out[hint] = ['Desktop'];
          else out[hint] = '';
        }
        return out;
      },
    };
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => userAgentData,
      configurable: true,
    });
  } catch (_) {
    // Never break page load over a cosmetic identity patch.
  }
}

try {
  const { webFrame } = require('electron');
  if (webFrame && typeof webFrame.executeJavaScript === 'function') {
    webFrame.executeJavaScript(`(${patchIdentity.toString()})();`).catch(() => {});
  } else {
    patchIdentity();
  }
} catch (_) {
  patchIdentity();
}
