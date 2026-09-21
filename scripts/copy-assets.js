const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'assets');
const dest = path.resolve(__dirname, '..', 'public', 'assets');

async function copyRecursive(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) {
    console.log('No assets directory to copy.');
    return;
  }
  await fs.promises.mkdir(destPath, { recursive: true });
  const entries = await fs.promises.readdir(srcPath, { withFileTypes: true });
  for (const entry of entries) {
    const srcEntry = path.join(srcPath, entry.name);
    const destEntry = path.join(destPath, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcEntry, destEntry);
    } else {
      await fs.promises.copyFile(srcEntry, destEntry);
    }
  }
}

copyRecursive(src, dest).then(() => {
  console.log('Assets copied to public/assets');
}).catch(err => {
  console.error('Failed to copy assets:', err);
  process.exit(0);
});
