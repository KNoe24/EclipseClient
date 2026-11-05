const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));

const productName = pkg.build?.productName || pkg.productName || pkg.name;
const version = pkg.version;
const outputDir = path.join(root, pkg.build?.directories?.output || "dist");

const pattern = pkg.build?.portable?.artifactName || "${productName}-${version}-portable.${ext}";
const fileName = pattern
  .replace(/\$\{productName\}/g, productName)
  .replace(/\$\{version\}/g, version)
  .replace(/\$\{ext\}/g, "exe");

const filePath = path.join(outputDir, fileName);

if (!fs.existsSync(filePath)) {
  console.error(`Portable build not found: ${filePath}`);
  console.error("Run the portable build first (npm run build:portable).");
  process.exit(1);
}

const hash = crypto.createHash("sha512");
const stream = fs.createReadStream(filePath);

stream.on("data", (chunk) => hash.update(chunk));

stream.on("end", () => {
  const manifest = {
    version,
    file: fileName,
    sha512: hash.digest("hex"),
    size: fs.statSync(filePath).size,
    releaseDate: new Date().toISOString(),
  };

  const manifestPath = path.join(outputDir, "latest-portable.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Wrote ${manifestPath}`);
  console.log(`Upload "${fileName}" and "latest-portable.json" to the launcher update folder.`);
});

stream.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
