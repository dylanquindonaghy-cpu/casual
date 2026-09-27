// `npm run dev`: the web app and the job worker together (logging in needs both: the worker
// sends the login link). The worker restarts when its files change. Ctrl+C stops both.
import { spawn } from "node:child_process";

const children = [
  spawn("npx", ["next", "dev", ...process.argv.slice(2)], { stdio: "inherit" }),
  spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "--import", "tsx", "--watch", "src/worker/index.ts"],
    { stdio: "inherit" },
  ),
];

let stopping = false;
const stopAll = (signal) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
};
process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
for (const child of children) {
  child.on("exit", (code) => {
    stopAll("SIGTERM");
    process.exitCode ??= code ?? 0;
  });
}
