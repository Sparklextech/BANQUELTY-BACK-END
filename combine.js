const fs = require('fs');
const path = require('path');

const baseDir = './';
const includeDirs = ['gateway', 'services'];
const outputFile = 'completecode.txt';

const outputStream = fs.createWriteStream(outputFile);

function collectJSFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectJSFiles(fullPath); // Recurse
    } else if (entry.isFile() && fullPath.endsWith('.js')) {
      const relativePath = path.relative(baseDir, fullPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      outputStream.write(`\n\n// ===== FILE: ${relativePath} =====\n`);
      outputStream.write(content);
    }
  }
}

// Only walk `gateway` and `services` folders
includeDirs.forEach((dirName) => {
  const fullPath = path.join(baseDir, dirName);
  if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
    collectJSFiles(fullPath);
  }
});

outputStream.end(() => {
  console.log(`✅ Combined all .js files from 'gateway' and 'services' into '${outputFile}'`);
});
