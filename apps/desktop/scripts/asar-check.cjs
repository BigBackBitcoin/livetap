// Verifies that the packaged app.asar contains the real renderer bundle (not the placeholder).
const path = require('node:path');
const asar = require('@electron/asar');

const archive = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');
const files = asar.listPackage(archive).map((f) => f.split(path.sep).join('/'));
const renderer = files.filter((f) => f.includes('dist/renderer/'));
const assets = renderer.filter((f) => f.includes('dist/renderer/assets/'));
console.log(`renderer files in asar: ${renderer.length} (assets: ${assets.length})`);
console.log(renderer.slice(0, 5).join('\n'));
if (assets.length === 0) {
  console.error('FAIL: renderer assets missing from app.asar (placeholder packaged?)');
  process.exit(1);
}
console.log('PASS');
