const readline = require("readline");
const { execSync, spawn } = require("child_process");
const path = require("path");

const projectDir = path.resolve(__dirname, "..");
const shouldStart = process.argv.includes("--start");

function run(command, cwd = projectDir) {
  console.log(`\n> ${command}`);
  execSync(command, {
    cwd,
    stdio: "inherit",
    shell: true,
  });
}

function getGitRoot() {
  return execSync("git rev-parse --show-toplevel", {
    cwd: projectDir,
    encoding: "utf8",
    shell: true,
  }).trim();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Commit message: ", (message) => {
  rl.close();

  message = message.trim();

  if (!message) {
    console.log("Commit cancelled. You must enter a commit message.");
    process.exit(1);
  }

  try {
    const gitRoot = getGitRoot();

    run("git status", gitRoot);
    run("git add .", gitRoot);
    run(`git commit -m "${message.replace(/"/g, '\\"')}"`, gitRoot);
    run("git push", gitRoot);

    console.log("\nPush complete.");

    if (shouldStart) {
      console.log("\nStarting app...\n");

      const child = spawn("npm", ["start"], {
        cwd: projectDir,
        stdio: "inherit",
        shell: true,
      });

      child.on("exit", (code) => {
        process.exit(code);
      });
    }
  } catch (error) {
    console.error("\nSomething failed.");
    process.exit(1);
  }
});
