const { execFile } = require('child_process');
const path = require('path');

const ytdlp = path.join(__dirname, 'mpv', 'yt-dlp.exe');
const url = 'https://youtu.be/F2nc-J1GBf8?si=8l5-gxCwvTrJCGwV';

console.log('Running yt-dlp on:', url);
execFile(ytdlp, ['-J', '--no-warnings', '--no-playlist', url], { maxBuffer: 25 * 1024 * 1024 }, (err, stdout, stderr) => {
  if (err) {
    console.error('Error running yt-dlp:', err);
    return;
  }
  
  const payload = JSON.parse(stdout);
  console.log('Total format count:', payload.formats.length);
  
  const heights = new Set();
  const formatDetails = [];
  
  for (const f of payload.formats) {
    formatDetails.push({
      format_id: f.format_id,
      ext: f.ext,
      height: f.height,
      vcodec: f.vcodec,
      acodec: f.acodec,
      resolution: f.resolution
    });
    if (!f || f.vcodec === 'none') continue;
    const value = Number(f.height);
    if (Number.isFinite(value) && value > 0) {
      heights.add(Math.round(value));
    }
  }
  
  console.log('All unique heights parsed using main.js logic:', Array.from(heights).sort((a,b)=>b-a));
  console.log('First 10 format structures:', formatDetails.slice(0, 10));
  console.log('Formats with height > 1080:', formatDetails.filter(f => f.height > 1080));
});
