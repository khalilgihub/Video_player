/**
 * Shared YouTube / yt-dlp helpers.
 *
 * Used by main.js (quality & metadata probe, playlist extraction) and
 * mpv-process.js (ytdl_hook configuration) so the extractor-args string
 * only lives in one place.
 */

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

// yt-dlp's maintained default client priority is more reliable than any
// hardcoded list; forcing clients here breaks whenever YouTube deprecates
// one. Even skipping the webpage request (`player_skip=webpage`) pushes
// extraction onto API-only clients that YouTube bot-gates aggressively, so
// no extractor-args are passed at all. Verified against yt-dlp 2026.10.21:
// defaults extract fine where forced client lists and webpage-skip fail.
const YTDLP_EXTRACTOR_ARGS = '';

function normalizeYoutubeUrl(value) {
  const target = typeof value === 'string' ? value.trim() : '';
  if (!target || target.length > 4096) return null;

  try {
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function extractYoutubeId(value) {
  const normalized = normalizeYoutubeUrl(value);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }

    const vParam = parsed.searchParams.get('v');
    if (vParam) return vParam;

    // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
    const segments = parsed.pathname.split('/').filter(Boolean);
    const markerIndex = segments.findIndex((seg) => ['embed', 'shorts', 'live', 'v'].includes(seg));
    if (markerIndex !== -1 && segments[markerIndex + 1]) {
      return segments[markerIndex + 1];
    }

    return null;
  } catch {
    return null;
  }
}

function extractYoutubePlaylistId(value) {
  const normalized = normalizeYoutubeUrl(value);
  if (!normalized) return null;

  try {
    return new URL(normalized).searchParams.get('list') || null;
  } catch {
    return null;
  }
}

// yt-dlp CLI fragment shared by every extraction call. Empty when yt-dlp
// defaults are used so callers can skip the flag entirely.
function extractorArgPair() {
  return YTDLP_EXTRACTOR_ARGS ? ['--extractor-args', YTDLP_EXTRACTOR_ARGS] : [];
}

module.exports = {
  YOUTUBE_HOSTS,
  YTDLP_EXTRACTOR_ARGS,
  normalizeYoutubeUrl,
  extractYoutubeId,
  extractYoutubePlaylistId,
  extractorArgPair,
};
