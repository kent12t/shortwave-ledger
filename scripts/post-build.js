const fs = require('fs');
const path = require('path');

const sourceDir = '.open-next';
const destDir = path.join(sourceDir, 'assets');

// Move worker.js to assets/_worker.js
const workerSrc = path.join(sourceDir, 'worker.js');
const workerDest = path.join(destDir, '_worker.js');

if (fs.existsSync(workerSrc)) {
  fs.renameSync(workerSrc, workerDest);
  console.log('Moved worker.js to assets/_worker.js');
} else {
  console.warn('Warning: worker.js not found in .open-next/');
}

// Directories to move into assets
const dirsToMove = ['cloudflare', 'middleware', 'server-functions', '.build'];

dirsToMove.forEach(dir => {
  const src = path.join(sourceDir, dir);
  const dest = path.join(destDir, dir);
  
  if (fs.existsSync(src)) {
    // Check if dest exists, if so, remove it first to avoid conflicts or merge issues
    if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
    }
    
    // Use cpSync for copying directory contents recursively
    fs.cpSync(src, dest, { recursive: true });
    console.log(`Copied ${dir} to assets/${dir}`);
  } else {
    console.warn(`Warning: Directory ${src} does not exist.`);
  }
});
