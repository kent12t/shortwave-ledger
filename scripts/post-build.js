const fs = require("fs");
const path = require("path");

const sourceDir = ".open-next";
const destDir = path.join(sourceDir, "assets");

const workerSrc = path.join(sourceDir, "worker.js");
const workerDest = path.join(destDir, "_worker.js");

if (fs.existsSync(workerSrc)) {
  fs.renameSync(workerSrc, workerDest);
  console.log("Moved worker.js to assets/_worker.js");
} else {
  console.warn("Warning: worker.js not found in .open-next/");
}

const dirsToMove = ["cloudflare", "middleware", "server-functions", ".build"];

for (const dir of dirsToMove) {
  const src = path.join(sourceDir, dir);
  const dest = path.join(destDir, dir);

  if (!fs.existsSync(src)) {
    console.warn(`Warning: Directory ${src} does not exist.`);
    continue;
  }

  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.cpSync(src, dest, { recursive: true });
  console.log(`Copied ${dir} to assets/${dir}`);
}
