const { spawn } = require('child_process');
const path = require('path');

const mpv = path.join(__dirname, 'mpv', 'mpv.exe');
const url = 'https://youtu.be/F2nc-J1GBf8?si=8l5-gxCwvTrJCGwV';
const ytdlp = path.join(__dirname, 'mpv', 'yt-dlp.exe');

const args = [
  '--ytdl=yes',
  `--script-opts=ytdl_hook-ytdl_path=${ytdlp.replace(/\\/g, '/')}`,
  '--idle=yes',
  url
];

console.log('Running mpv:', mpv, args.join(' '));
const proc = spawn(mpv, args);

proc.stdout.on('data', data => console.log('STDOUT:', data.toString().trim()));
proc.stderr.on('data', data => console.log('STDERR:', data.toString().trim()));

setTimeout(() => {
  console.log('Terminating mpv...');
  proc.kill();
}, 10000);
