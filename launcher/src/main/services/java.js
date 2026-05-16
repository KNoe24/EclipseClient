const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function unique(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!value) continue;

    const key = path.resolve(value).toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(value);
  }

  return result;
}

function javaExecutableName() {
  return process.platform === "win32" ? "java.exe" : "java";
}

function javacExecutableName() {
  return process.platform === "win32" ? "javac.exe" : "javac";
}

function javaInHome(home) {
  if (!home) return "";
  return path.join(home, "bin", javaExecutableName());
}

function javacInHome(home) {
  if (!home) return "";
  return path.join(home, "bin", javacExecutableName());
}

function javaHomeFromJavaPath(javaPath) {
  return path.resolve(javaPath, "..", "..");
}

function readDirs(root) {
  try {
    if (!root || !fs.existsSync(root)) return [];

    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function findWindowsJavaCandidates() {
  const roots = [
    process.env.JAVA_HOME,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Java"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Java"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Eclipse Adoptium"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Eclipse Adoptium"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Amazon Corretto"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Zulu"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Eclipse Adoptium"),
    process.env.APPDATA && path.join(process.env.APPDATA, ".minecraft", "runtime")
  ].filter(Boolean);

  const candidates = [];

  if (process.env.JAVA_HOME) {
    candidates.push(javaInHome(process.env.JAVA_HOME));
  }

  for (const root of roots) {
    for (const dir of readDirs(root)) {
      candidates.push(javaInHome(dir));

      for (const child of readDirs(dir)) {
        candidates.push(javaInHome(child));

        for (const grandchild of readDirs(child)) {
          candidates.push(javaInHome(grandchild));
        }
      }
    }
  }

  return candidates;
}

function findMacJavaCandidates() {
  const candidates = [];

  if (process.env.JAVA_HOME) {
    candidates.push(javaInHome(process.env.JAVA_HOME));
  }

  const roots = [
    "/Library/Java/JavaVirtualMachines",
    path.join(process.env.HOME || "", "Library", "Java", "JavaVirtualMachines")
  ];

  for (const root of roots) {
    for (const dir of readDirs(root)) {
      candidates.push(path.join(dir, "Contents", "Home", "bin", "java"));
    }
  }

  candidates.push("/usr/bin/java");

  return candidates;
}

function findLinuxJavaCandidates() {
  const candidates = [];

  if (process.env.JAVA_HOME) {
    candidates.push(javaInHome(process.env.JAVA_HOME));
  }

  candidates.push("/usr/bin/java");
  candidates.push("/usr/local/bin/java");

  for (const dir of readDirs("/usr/lib/jvm")) {
    candidates.push(javaInHome(dir));
  }

  return candidates;
}

function findJavaCandidates() {
  if (process.platform === "win32") return findWindowsJavaCandidates();
  if (process.platform === "darwin") return findMacJavaCandidates();
  return findLinuxJavaCandidates();
}

function readJavaVersion(javaPath) {
  try {
    return execFileSync(javaPath, ["-version"], {
      encoding: "utf8",
      timeout: 3500,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : "";
    const stderr = error.stderr ? String(error.stderr) : "";
    return `${stdout}\n${stderr}`.trim();
  }
}

function readJavaReleaseFile(javaPath) {
  const home = javaHomeFromJavaPath(javaPath);
  const releasePath = path.join(home, "release");

  if (!exists(releasePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(releasePath, "utf8");
    const result = {};

    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
      if (match) {
        result[match[1]] = match[2];
      }
    }

    return result;
  } catch {
    return {};
  }
}

function parseJavaVersion(output, javaPath) {
  const text = String(output || "");
  const firstLine = text.split(/\r?\n/).find(Boolean) || "Java";

  const release = readJavaReleaseFile(javaPath);

  const versionMatch =
    firstLine.match(/version\s+"([^"]+)"/i) ||
    firstLine.match(/openjdk\s+version\s+"([^"]+)"/i) ||
    firstLine.match(/openjdk\s+([\w.+-]+)/i) ||
    firstLine.match(/java\s+([\w.+-]+)/i);

  const version = release.JAVA_VERSION || (versionMatch ? versionMatch[1] : "unknown");

  let major = 0;

  if (version.startsWith("1.")) {
    major = Number(version.split(".")[1] || 0);
  } else {
    major = Number((version.match(/^\d+/) || [0])[0]);
  }

  const home = javaHomeFromJavaPath(javaPath);
  const hasJavac = exists(javacInHome(home));

  const implementor =
    release.IMPLEMENTOR ||
    release.VENDOR ||
    detectVendorFromText(`${firstLine} ${home}`);

  const kind = hasJavac ? "JDK" : "JRE";

  return {
    version,
    major,
    kind,
    implementor,
    raw: firstLine
  };
}

function detectVendorFromText(text) {
  const lower = String(text || "").toLowerCase();

  if (lower.includes("temurin") || lower.includes("adoptium")) return "Eclipse Temurin";
  if (lower.includes("zulu")) return "Azul Zulu";
  if (lower.includes("corretto")) return "Amazon Corretto";
  if (lower.includes("microsoft")) return "Microsoft";
  if (lower.includes("oracle")) return "Oracle";
  if (lower.includes("graalvm")) return "GraalVM";
  if (lower.includes("openjdk")) return "OpenJDK";

  return "Java";
}

async function listInstalledJava() {
  const candidates = unique(findJavaCandidates()).filter(exists);
  const results = [];

  for (const candidate of candidates) {
    const parsed = parseJavaVersion(readJavaVersion(candidate), candidate);

    results.push({
      path: candidate,
      version: parsed.version,
      major: parsed.major,
      kind: parsed.kind,
      implementor: parsed.implementor,
      label: `${parsed.implementor} ${parsed.kind} ${parsed.version} (${candidate})`,
      raw: parsed.raw
    });
  }

  results.sort((a, b) => {
    if (b.major !== a.major) return b.major - a.major;
    return a.path.localeCompare(b.path);
  });

  return results;
}

module.exports = {
  listInstalledJava
};