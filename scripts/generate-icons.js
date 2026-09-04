const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const ffmpeg = path.join(projectRoot, 'node_modules/ffmpeg-static/ffmpeg.exe');
const sourcePng = path.join(projectRoot, 'assets/icons/icon.png');
const outIco = path.join(projectRoot, 'assets/icons/icon.ico');
const outVideoIco = path.join(projectRoot, 'assets/icons/video.ico');
const tempDir = path.join(projectRoot, 'assets/icons/.temp_ico');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Windows standard sizes for taskbar, start menu, tray, alt-tab, desktop
const sizes = [16, 20, 24, 30, 32, 36, 40, 48, 64, 72, 96, 128, 256];
const entries = [];

for (const size of sizes) {
  const icoPath = path.join(tempDir, `ico_${size}.ico`);
  // Generate native DIB/BMP ICO using ffmpeg
  execSync(`"${ffmpeg}" -y -i "${sourcePng}" -vf "scale=${size}:${size}:flags=lanczos" "${icoPath}"`, { stdio: 'ignore' });
  const buf = fs.readFileSync(icoPath);
  
  // buf structure:
  // 0..5: header (6 bytes)
  // 6..21: dir entry (16 bytes)
  // 22..end: image data (size bytes)
  const dirEntry = Buffer.from(buf.subarray(6, 22));
  const imgData = Buffer.from(buf.subarray(22));
  
  entries.push({
    size,
    dirEntry,
    imgData
  });
}

// Clean temp directory
for (const size of sizes) {
  try { fs.unlinkSync(path.join(tempDir, `ico_${size}.ico`)); } catch (_) {}
}
try { fs.rmdirSync(tempDir); } catch (_) {}

// Build unified multi-resolution DIB ICO file
const count = entries.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = 1 (ICO)
header.writeUInt16LE(count, 4); // image count

const headerAndDirSize = 6 + count * 16;
let currentOffset = headerAndDirSize;

const finalDirEntries = [];
const finalDataBuffers = [];

for (const item of entries) {
  const entry = Buffer.from(item.dirEntry);
  // Update data offset at byte 12 (4 bytes)
  entry.writeUInt32LE(currentOffset, 12);
  // Ensure size is correctly recorded
  entry.writeUInt32LE(item.imgData.length, 8);
  
  finalDirEntries.push(entry);
  finalDataBuffers.push(item.imgData);
  currentOffset += item.imgData.length;
}

const multiIco = Buffer.concat([header, ...finalDirEntries, ...finalDataBuffers]);
fs.writeFileSync(outIco, multiIco);
fs.writeFileSync(outVideoIco, multiIco);

console.log(`Successfully generated native Windows DIB ICO: ${outIco} (${multiIco.length} bytes, ${count} resolutions)`);
