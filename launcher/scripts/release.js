const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projectDir = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipBuild = args.includes("--skip-build");
const force = args.includes("--force");

const releaseConfig = pkg.release || {};
const updatesRepo = process.env.RELEASE_REPO || releaseConfig.updatesRepo;
const branch = process.env.RELEASE_BRANCH || releaseConfig.branch || "launcher";
const workDir = path.join(projectDir, "release", "eclipse-updates");
const distDir = path.join(projectDir, pkg.build?.directories?.output || "dist");

const productName = pkg.build?.productName || pkg.productName || pkg.name;
const version = pkg.version;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function fail(message) {
  console.error(`\nRelease stopped: ${message}`);
  process.exit(1);
}

function run(command, cwd = projectDir, options = {}) {
  console.log(`\n> ${command}`);

  return execSync(command, {
    cwd,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: true,
  });
}

function compareVersions(a, b) {
  const pa = String(a || "0")
    .split("-")[0]
    .split(".")
    .map((part) => Number(part) || 0);
  const pb = String(b || "0")
    .split("-")[0]
    .split(".")
    .map((part) => Number(part) || 0);

  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] || 0) - (pb[index] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function prepareUpdatesRepo() {
  if (!fs.existsSync(path.join(workDir, ".git"))) {
    fs.mkdirSync(path.dirname(workDir), { recursive: true });
    fs.rmSync(workDir, { recursive: true, force: true });
    run(`git clone --branch ${branch} "${updatesRepo}" "${workDir}"`);
    return;
  }

  run(`git remote set-url origin "${updatesRepo}"`, workDir);
  run(`git fetch origin ${branch}`, workDir);
  run(`git checkout ${branch}`, workDir);
  run(`git reset --hard origin/${branch}`, workDir);
  run("git clean -fd", workDir);
}

function publishedVersions() {
  const result = {};
  const ymlPath = path.join(workDir, "latest.yml");
  const portablePath = path.join(workDir, "latest-portable.json");

  if (fs.existsSync(ymlPath)) {
    const match = fs.readFileSync(ymlPath, "utf8").match(/^version:\s*['"]?([^'"\s]+)/m);
    if (match) result.installer = match[1];
  }

  if (fs.existsSync(portablePath)) {
    try {
      result.portable = JSON.parse(fs.readFileSync(portablePath, "utf8")).version;
    } catch {
      result.portable = undefined;
    }
  }

  return result;
}

function releaseFiles() {
  const ymlPath = path.join(distDir, "latest.yml");

  if (!fs.existsSync(ymlPath)) fail(`${ymlPath} not found. The Windows build did not finish.`);

  const yml = fs.readFileSync(ymlPath, "utf8");
  const ymlVersion = (yml.match(/^version:\s*['"]?([^'"\s]+)/m) || [])[1];
  const installer = (yml.match(/^path:\s*['"]?(.+?)['"]?\s*$/m) || [])[1];

  if (ymlVersion !== version) {
    fail(`dist/latest.yml is for ${ymlVersion}, but package.json says ${version}. Build again.`);
  }

  if (!installer) fail("Could not find the installer name in dist/latest.yml.");

  const portableManifestPath = path.join(distDir, "latest-portable.json");
  if (!fs.existsSync(portableManifestPath)) fail("dist/latest-portable.json not found.");

  const portableManifest = JSON.parse(fs.readFileSync(portableManifestPath, "utf8"));

  if (portableManifest.version !== version) {
    fail(
      `dist/latest-portable.json is for ${portableManifest.version}, but package.json says ${version}.`
    );
  }

  const files = [
    installer,
    `${installer}.blockmap`,
    portableManifest.file,
    "latest.yml",
    "latest-portable.json",
  ].filter((name) => fs.existsSync(path.join(distDir, name)));

  for (const required of [installer, portableManifest.file]) {
    if (!files.includes(required)) fail(`dist/${required} not found.`);
  }

  for (const name of files) {
    const size = fs.statSync(path.join(distDir, name)).size;

    if (size > MAX_FILE_BYTES) {
      fail(`${name} is ${Math.round(size / 1048576)} MB. GitHub rejects files over 100 MB.`);
    }
  }

  return files;
}

function removeOldBuilds(keep) {
  const isBuild = (name) =>
    name.endsWith(".exe") || name.endsWith(".exe.blockmap") || name.endsWith(".exe.update");

  for (const name of fs.readdirSync(workDir)) {
    if (isBuild(name) && !keep.includes(name)) {
      console.log(`Removing old build: ${name}`);
      fs.rmSync(path.join(workDir, name), { force: true });
    }
  }
}

function main() {
  if (!updatesRepo) {
    fail('Set "release.updatesRepo" in package.json (the eclipse-updates git URL).');
  }

  console.log(`Releasing ${productName} ${version} to ${updatesRepo} (branch "${branch}")`);
  if (dryRun) console.log("Dry run: nothing will be pushed.");

  prepareUpdatesRepo();

  const published = publishedVersions();
  const newest = [published.installer, published.portable]
    .filter(Boolean)
    .sort(compareVersions)
    .pop();

  console.log(
    `\nOn the "${branch}" branch now: installer ${published.installer || "none"}, portable ${
      published.portable || "none"
    }`
  );

  if (newest && compareVersions(version, newest) <= 0 && !force) {
    fail(
      `version ${version} is not higher than ${newest}. Raise "version" in package.json first (or use --force).`
    );
  }

  if (!skipBuild) {
    run("npm run build:win");
  }

  const files = releaseFiles();

  removeOldBuilds(files);

  for (const name of files) {
    fs.copyFileSync(path.join(distDir, name), path.join(workDir, name));
    console.log(`Copied ${name}`);
  }

  run("git add -A", workDir);

  const status = run("git status --porcelain", workDir, { capture: true });

  if (!String(status).trim()) {
    console.log("\nNothing changed on the updates branch.");
    return;
  }

  run(`git commit -m "Launcher ${version}"`, workDir);

  if (dryRun) {
    console.log(`\nDry run finished. The commit is ready in ${workDir} but was not pushed.`);
    return;
  }

  run(`git push origin ${branch}`, workDir);

  console.log(
    `\nReleased ${version}. Launchers will see it on their next start (GitHub may cache for a few minutes).`
  );
}

try {
  main();
} catch (error) {
  fail(error.message || String(error));
}
