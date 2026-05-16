const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/*
  Usage:
    node scripts/make-client-manifest.js ./client-branch-folder 1.0.0

  It scans the folder, computes sha256 hashes, and writes manifest.json.
  Run this on a local copy of your GitHub `client` branch.
*/

const rootDir = path.resolve(process.argv[2] || ".");
const clientVersion = process.argv[3] || "1.0.0";
const manifestPath = path.join(rootDir, "manifest.json");

const EXCLUDE = new Set(["manifest.json", ".git", ".gitignore", "README.md", "readme.md"]);

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function walk(dir, base = dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      files.push(...walk(fullPath, base));
    } else if (entry.isFile()) {
      files.push({
        path: relativePath,
        sha256: sha256File(fullPath),
      });
    }
  }

  return files;
}

const files = walk(rootDir).sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  name: "Default",
  clientVersion,
  minecraftVersion: "1.21.1",
  versionType: "release",
  loaderType: "custom",
  customVersionId: "eclipse-client",
  updateMode: "keep",
  memory: {
    min: "2G",
    max: "4G",
  },
  files,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${manifestPath}`);
console.log(`Files in manifest: ${files.length}`);
