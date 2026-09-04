const path = require('path');

const ROMAN_NUMERAL_MAP = {
  'I': 1,
  'II': 2,
  'III': 3,
  'IV': 4,
  'V': 5,
  'VI': 6,
  'VII': 7,
  'VIII': 8,
  'IX': 9,
  'X': 10,
};

const ORDINAL_MAP = {
  '1st': 1, 'first': 1,
  '2nd': 2, 'second': 2,
  '3rd': 3, 'third': 3,
  '4th': 4, 'fourth': 4,
  '5th': 5, 'fifth': 5,
};

const GENERIC_PARENT_FOLDERS = new Set([
  'downloads', 'desktop', 'videos', 'video', 'vid', 'movies', 'series', 'anime',
  'temp', 'tmp', 'media', 'files', 'hybrid-player', 'screenshots', 'new volume'
]);

/**
 * Sanitizes a string for use as a Windows directory or filename.
 * Removes / replaces illegal characters: < > : " / \ | ? *
 * @param {string} str
 * @returns {string}
 */
function sanitizeWindowsName(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[:|]/g, ' - ')
    .replace(/[\\/]/g, ' - ')
    .replace(/[<>?"*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ - [- ]+/g, ' - ')
    .trim()
    .replace(/^[ -]+|[. -]+$/g, '')
    .substring(0, 80);
}

/**
 * Converts a string to Title Case while preserving acronyms and Roman numerals.
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  if (!str) return '';
  return str.replace(/\b[a-zA-Z0-9']+\b/g, (txt) => {
    const upper = txt.toUpperCase();
    if (ROMAN_NUMERAL_MAP[upper] || ['OVA', 'OAD', 'SP', 'PV', 'MV', 'OP', 'ED', 'II', 'III', 'IV', 'TV', 'HD', '4K'].includes(upper)) {
      return upper;
    }
    return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
  });
}

/**
 * Strips release group tags, technical quality tags, and CRC hashes.
 * e.g., "[Judas] Show Name [1080p][x265][A1B2C3D4]" -> "Show Name"
 * @param {string} raw
 * @returns {string}
 */
function stripBracketTags(raw) {
  if (!raw) return '';
  let cleaned = String(raw).slice(0, 300);

  // 1. Strip all leading bracket tags: [Judas] [SubsPlease]
  cleaned = cleaned.replace(/^(\s*\[[^\]]+\]|\s*\((?!\d{4}\))[^\)]+\))+/g, '');

  // 2. Strip trailing bracket tags: [1080p] [HEVC x265], but PRESERVE (YYYY) release year!
  cleaned = cleaned.replace(/\s*\[[^\]]+\]$/g, '');
  cleaned = cleaned.replace(/\s*\((?!\d{4}\))[^\)]+\)$/g, '');

  // 3. Strip standalone CRC32 hashes like [7F8A1B2C] anywhere inside
  cleaned = cleaned.replace(/\[[0-9a-fA-F]{8}\]/g, '');

  // 4. Strip common scene resolution and codec tags
  cleaned = cleaned.replace(/\b(1080p|720p|480p|2160p|4k|hevc|x264|x265|bluray|web-dl|aac|flac|dual-audio|multi-subs)\b/gi, '');

  return cleaned.trim();
}

/**
 * Resolves smart screenshot subfolder from file path or stream metadata.
 * @param {Object} options
 * @param {string} [options.filePath] - Absolute file path or stream URL
 * @param {string} [options.mediaTitle] - mpv media-title property (especially for streams)
 * @returns {string} Relative subfolder path (e.g. "Mob Psycho 100/Season 3") or "" for root
 */
function resolveScreenshotSubfolder({ filePath = '', mediaTitle = '' } = {}) {
  const isUrl = typeof filePath === 'string' && /^(https?|rtmp|ytdl):/i.test(filePath.trim());

  // ── Case A: Web Streams / YouTube ───────────────────────
  if (isUrl) {
    const rawTitle = (mediaTitle && typeof mediaTitle === 'string' ? mediaTitle : '').trim();
    if (!rawTitle) {
      return 'Streams';
    }

    // Strip YouTube channel suffix if present (e.g., "Title | Channel" or "Title - YouTube")
    let cleanTitle = rawTitle.replace(/\s*[-|]\s*(YouTube|Crunchyroll|Netflix|Funimation)\s*$/i, '');

    // Check if the stream title represents an anime series (e.g. "Mob Psycho 100 Season 3 - Official Trailer")
    const streamSeriesMatch = cleanTitle.match(/^(.+?)\s+[-_:]?\s*(?:Season\s*(\d+)|S(\d+)|(2nd|3rd|4th|final)\s+Season)\s*(?:[-_:]\s*(.+))?$/i);
    if (streamSeriesMatch) {
      const showName = sanitizeWindowsName(toTitleCase(stripBracketTags(streamSeriesMatch[1])));
      const seasonNum = streamSeriesMatch[2] || streamSeriesMatch[3] || ORDINAL_MAP[streamSeriesMatch[4]?.toLowerCase()];
      const extra = streamSeriesMatch[5] || '';
      const isTrailer = /\b(trailer|pv|teaser|preview)\b/i.test(extra) || /\b(trailer|pv|teaser|preview)\b/i.test(cleanTitle);

      if (showName) {
        if (isTrailer) {
          return path.join(showName, 'Trailers');
        }
        if (seasonNum) {
          const seasonFolder = typeof seasonNum === 'number' || /^\d+$/.test(seasonNum) ? `Season ${parseInt(seasonNum, 10)}` : seasonNum;
          return path.join(showName, seasonFolder);
        }
        return showName;
      }
    }

    // General YouTube video or stream: sanitize and place into YouTube/
    const safeTitle = sanitizeWindowsName(cleanTitle);
    return safeTitle ? path.join('YouTube', safeTitle) : 'YouTube';
  }

  // ── Case B: Local Media Files ───────────────────────────
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  const cleanFilePath = filePath.trim();
  const parsedPath = path.parse(cleanFilePath);
  const rawFileName = parsedPath.name; // without extension
  const parentFolder = path.basename(parsedPath.dir);

  // If filename looks like a generic recording (e.g. VID_20260902_142030, capture, test)
  if (/^(VID_\d|recording_\d|capture_\d|screenshot|image|video_\d|output)/i.test(rawFileName)) {
    return '';
  }

  // 1. Examine filename
  let workingName = stripBracketTags(rawFileName);

  // Replace dots with spaces if whole title uses dot separators (e.g. Mob.Psycho.100.S03E01)
  if (workingName.includes('.') && !workingName.includes(' ')) {
    workingName = workingName.replace(/\./g, ' ');
  }

  // Detect OVA / Movie / Specials
  const isSpecial = /\b(OVA|OAD|SP\d*|Special\b|NCOP|NCED)\b/i.test(rawFileName);
  const isMovie = /\b(Movie|The Movie|Film)\b/i.test(rawFileName);

  // Detect Season from filename
  let detectedSeason = null;
  let cleanShowName = '';

  // Pattern 1: Standard Code S01E03, S1E02, S01E01-E02, S03E01v2
  const codeMatch = workingName.match(/^(.*?)[-_\s]+S0*(\d{1,2})(?:E\d+|(?:-|_)?(?:v\d+)|\b)(.*)$/i);
  if (codeMatch) {
    cleanShowName = codeMatch[1].trim();
    detectedSeason = parseInt(codeMatch[2], 10);
  }

  // Pattern 2: Word notation "season 1 episode 2", "Season 02"
  if (!detectedSeason) {
    const wordMatch = workingName.match(/^(.*?)[-_\s]+(?:season|series)\s*0*(\d{1,2})(?:[-_\s]+(?:episode|ep)\s*\d+)?(.*)$/i);
    if (wordMatch) {
      cleanShowName = wordMatch[1].trim();
      detectedSeason = parseInt(wordMatch[2], 10);
    }
  }

  // Pattern 3: Roman numerals at end of title (e.g. "Mob Psycho 100 III - 01", "Overlord IV")
  if (!detectedSeason) {
    const romanMatch = workingName.match(/^(.*?)\s+(I{1,3}|IV|V|VI)\s*[-_:]?\s*(?:\d+.*)?$/i);
    if (romanMatch) {
      cleanShowName = romanMatch[1].trim();
      detectedSeason = ROMAN_NUMERAL_MAP[romanMatch[2].toUpperCase()] || null;
    }
  }

  // Pattern 4: Ordinal suffix ("2nd Season", "3rd Season", "Final Season")
  if (!detectedSeason) {
    const ordinalMatch = workingName.match(/^(.*?)[-_\s]+(1st|2nd|3rd|4th|5th|final)\s+season\b(.*)$/i);
    if (ordinalMatch) {
      cleanShowName = ordinalMatch[1].trim();
      const ordKey = ordinalMatch[2].toLowerCase();
      detectedSeason = ORDINAL_MAP[ordKey] || null;
    }
  }

  // Pattern 5: Simple hyphen episode number (e.g. "[SubsPlease] Show Name - 01 (1080p)")
  if (!detectedSeason) {
    const epMatch = workingName.match(/^(.*?)[-_\s]+(?:E|EP|Episode|#)?\s*\d{1,3}(?:v\d+)?$/i);
    if (epMatch) {
      cleanShowName = epMatch[1].trim();
      // Check if parent directory specifies season (e.g. Season 2 or [Judas] Show Name (Season 3))
      const parentClean = stripBracketTags(parentFolder);
      const parentSeasonMatch = parentClean.match(/\b(?:Season|S)\s*0*(\d{1,2})\b/i);
      if (parentSeasonMatch) {
        detectedSeason = parseInt(parentSeasonMatch[1], 10);
      } else {
        detectedSeason = 1; // Default to Season 1 for single-season shows
      }
    }
  }

  // Fallback: If show name couldn't be extracted from filename, check parent directory
  if (!cleanShowName && parentFolder) {
    const cleanParent = stripBracketTags(parentFolder);
    const parentLower = cleanParent.toLowerCase();

    if (!GENERIC_PARENT_FOLDERS.has(parentLower)) {
      // Check if parent folder has (Season X)
      const seasonInParent = cleanParent.match(/^(.*?)\s*[-_:(]?\s*(?:Season\s*(\d+)|S(\d+))\)?/i);
      if (seasonInParent) {
        cleanShowName = seasonInParent[1].trim();
        detectedSeason = detectedSeason || parseInt(seasonInParent[2] || seasonInParent[3], 10);
      } else {
        cleanShowName = cleanParent;
      }
    }
  }

  // Clean and sanitize show name
  let finalShowName = sanitizeWindowsName(toTitleCase(stripBracketTags(cleanShowName || workingName)));

  // If no identifiable show name or too short, return root
  if (!finalShowName || finalShowName.length < 2) {
    return '';
  }

  // Standalone Movie detection: e.g. "Inception (2010)"
  const movieYearMatch = finalShowName.match(/^(.+?\s*\(\d{4}\))$/);
  if (movieYearMatch && !detectedSeason) {
    return movieYearMatch[1].trim();
  }

  // If special / OVA
  if (isSpecial) {
    const baseMatch = finalShowName.match(/^(.*?)\s*[-:]\s*.+$/);
    const baseShow = baseMatch ? baseMatch[1].trim() : finalShowName;
    return path.join(baseShow, 'Specials');
  }
  if (isMovie) {
    const baseMatch = finalShowName.match(/^(.*?)\s*[-:]\s*.+$/);
    const baseShow = baseMatch ? baseMatch[1].trim() : finalShowName;
    return path.join(baseShow, 'Movies');
  }

  // If series season detected
  if (detectedSeason) {
    const seasonFolderName = typeof detectedSeason === 'number'
      ? `Season ${detectedSeason}`
      : String(detectedSeason);
    return path.join(finalShowName, seasonFolderName);
  }

  return finalShowName;
}

module.exports = {
  resolveScreenshotSubfolder,
  sanitizeWindowsName,
  toTitleCase,
  stripBracketTags,
};
