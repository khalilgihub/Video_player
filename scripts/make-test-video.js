const cp = require('child_process');
const ffmpeg = require('ffmpeg-static');
const path = require('path');

const outPath = path.join(__dirname, '../test-sample.mp4');
cp.execFileSync(ffmpeg, [
  '-f', 'lavfi',
  '-i', 'testsrc=duration=15:size=1280x720:rate=30',
  '-f', 'lavfi',
  '-i', 'sine=frequency=440:duration=15',
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-y',
  outPath
]);
console.log('Video generated at:', outPath);
