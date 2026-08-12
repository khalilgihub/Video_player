const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const bin = path.join(__dirname, 'mpv', 'yt-dlp.exe');
const url = 'https://youtu.be/F2nc-J1GBf8?si=8l5-gxCwvTrJCGwV';
const args = ['-J', '--no-warnings', '--no-playlist', url];

console.log('Binary exists:', fs.existsSync(bin));
console.log('Running:', bin, args.join(' '));

execFile(bin, args, { maxBuffer: 25 * 1024 * 1024 }, (err, stdout, stderr) => {
  if (err) {
    console.error('Error:', err);
  }
  console.log('Stdout length:', stdout ? stdout.length : 0);
  console.log('Stderr:', stderr);
  try {
    if (stdout) {
      const data = JSON.parse(stdout);
      console.log('Title:', data.title);
      console.log('Formats count:', data.formats ? data.formats.length : 0);
    }
  } catch (e) {
    console.error('Parse error:', e);
  }
});
