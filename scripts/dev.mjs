import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

function runService(name, args, color) {
  const child = spawn(npmCmd, args, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
    env: process.env
  });

  child.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write(`${color}[${name}]\x1b[0m ${line}\n`);
      }
    }
  });

  child.stderr?.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        process.stderr.write(`${color}[${name}]\x1b[0m ${line}\n`);
      }
    }
  });

  child.on("error", (err) => {
    console.error(`[${name}] Error:`, err);
  });

  return child;
}

console.log("\x1b[36m[Blitzkrieg]\x1b[0m Launching both Backend (port 4000) and Frontend (port 5173)...");

const backend = runService("backend", ["run", "dev:backend"], "\x1b[35m");
const frontend = runService("frontend", ["run", "dev:frontend"], "\x1b[32m");

function shutdown() {
  console.log("\n\x1b[36m[Blitzkrieg]\x1b[0m Shutting down services...");
  try {
    if (isWindows) {
      if (backend.pid) spawn("taskkill", ["/pid", backend.pid.toString(), "/f", "/t"]);
      if (frontend.pid) spawn("taskkill", ["/pid", frontend.pid.toString(), "/f", "/t"]);
    } else {
      backend.kill("SIGTERM");
      frontend.kill("SIGTERM");
    }
  } catch {
    // Ignore cleanup errors
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
