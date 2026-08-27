import { spawn } from "node:child_process";

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit", env: process.env });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const backupCode = await run("scripts/send-daily-backup.mjs");
const briefCode = await run("scripts/trigger-boss-daily-brief.mjs");
if (backupCode || briefCode) process.exitCode = 1;
