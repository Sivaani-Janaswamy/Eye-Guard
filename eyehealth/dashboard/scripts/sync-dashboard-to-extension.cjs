// scripts/sync-dashboard-to-extension.cjs
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../dist');
const dest = path.resolve(__dirname, '../../extension/dist/dashboard');

function copyRecursiveSync(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  for (const item of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Clean old dashboard build
if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
// Copy new build
copyRecursiveSync(src, dest);

console.log('Dashboard build synced to extension.');
