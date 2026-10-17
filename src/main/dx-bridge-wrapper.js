/**
 * Hybrid Player - DirectX Texture Bridge Wrapper
 * 
 * Manages the native C++ dx_bridge addon:
 * - Initializes D3D11 / WGL OpenGL interop pipeline with libmpv
 * - Bridges hardware-rendered video frames to Electron's sharedTexture API
 * - Enforces zero-copy GPU VRAM surface transfers to the renderer process
 */

const path = require('path');
const fs = require('fs');
const { app, sharedTexture } = require('electron');

let nativeAddon = null;

function resolveAddonPath() {
  const candidates = [
    path.join(__dirname, '../native/dx_bridge/build/Release/vidplayer-dxbridge.node'),
    path.join(__dirname, '../native/dx_bridge/build/Debug/vidplayer-dxbridge.node'),
    path.join(__dirname, 'bin/vidplayer-dxbridge.node'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked/src/native/dx_bridge/build/Release/vidplayer-dxbridge.node') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'bin/vidplayer-dxbridge.node') : null,
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

function getNativeAddon() {
  if (nativeAddon) return nativeAddon;
  const addonPath = resolveAddonPath();
  if (!addonPath) {
    throw new Error('vidplayer-dxbridge.node native addon not found');
  }
  nativeAddon = require(addonPath);
  return nativeAddon;
}

class DxBridgeManager {
  constructor() {
    this.addon = null;
    this.initialized = false;
    this.targetWindow = null;
    this.rendererReady = false;
    this.currentWidth = 1280;
    this.currentHeight = 720;
    this._inFlightImports = new Map();
  }

  isSupported() {
    if (process.platform !== 'win32') return false;
    try {
      const addon = getNativeAddon();
      return !!(addon && typeof addon.init === 'function');
    } catch (e) {
      console.warn('[DxBridgeManager] Native addon not available:', e.message);
      return false;
    }
  }

  setTargetWindow(win) {
    this.targetWindow = win;
  }

  setRendererReady(ready = true) {
    this.rendererReady = ready;
  }

  init(mpvHandlePtr, width = 1280, height = 720) {
    if (this.initialized) return true;
    try {
      this.addon = getNativeAddon();

      const ptr = typeof mpvHandlePtr === 'bigint' ? mpvHandlePtr : BigInt(mpvHandlePtr);
      this.currentWidth = width;
      this.currentHeight = height;

      const ok = this.addon.init({
        mpvHandle: ptr,
        width,
        height,
        flipY: 0,
        onFrame: (bufferIndex, w, h) => {
          this.onFrameReady(bufferIndex, w, h);
        }
      });

      if (ok) {
        this.initialized = true;
      }
      return !!ok;
    } catch (e) {
      console.warn('[DxBridgeManager] init failed:', e?.message || e);
      return false;
    }
  }

  async onFrameReady(bufferIndex, width, height) {
    if (!this.initialized || !this.targetWindow || this.targetWindow.isDestroyed()) {
      if (this.addon) this.addon.releaseBuffer(bufferIndex);
      return;
    }

    if (!this.rendererReady || !sharedTexture || typeof sharedTexture.importSharedTexture !== 'function') {
      if (this.addon) this.addon.releaseBuffer(bufferIndex);
      return;
    }

    let imported = null;
    let releasedManually = false;
    try {
      const ntHandleBuffer = this.addon.getNtHandle(bufferIndex);
      if (!ntHandleBuffer || ntHandleBuffer.length < 8) {
        releasedManually = true;
        if (this.addon) this.addon.releaseBuffer(bufferIndex);
        return;
      }

      imported = sharedTexture.importSharedTexture({
        textureInfo: {
          handle: { ntHandle: ntHandleBuffer },
          codedSize: { width, height },
          pixelFormat: 'rgba',
          visibleRect: { x: 0, y: 0, width, height }
        },
        allReferencesReleased: () => {
          if (this.addon) {
            this.addon.releaseBuffer(bufferIndex);
          }
        }
      });

      const frame = this.targetWindow.webContents?.mainFrame;
      if (frame && !this.targetWindow.isDestroyed()) {
        await sharedTexture.sendSharedTexture({
          frame,
          importedSharedTexture: imported
        });
      }
    } catch (err) {
      console.error('[DxBridgeManager] onFrameReady error:', err?.message || err);
    } finally {
      if (imported) {
        imported.release();
      } else if (!releasedManually) {
        if (this.addon) {
          this.addon.releaseBuffer(bufferIndex);
        }
      }
    }
  }

  resize(width, height) {
    if (!this.initialized || !this.addon) return false;
    if (width <= 0 || height <= 0) return false;
    this.currentWidth = width;
    this.currentHeight = height;
    return this.addon.resize(width, height);
  }

  destroy() {
    this.rendererReady = false;
    this.targetWindow = null;
    if (this.initialized && this.addon) {
      try {
        this.addon.destroy();
      } catch {}
      this.initialized = false;
    }
  }
}

const dxBridgeManager = new DxBridgeManager();

module.exports = {
  DxBridgeManager,
  dxBridgeManager,
};
