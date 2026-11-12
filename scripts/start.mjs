import { spawn } from "node:child_process";
import electron from "electron";
// Ozone must be selected on the command line, before Electron initializes its native platform.
const args = process.platform === "linux" ? ["--ozone-platform=x11"] : [];
const child = spawn(electron, [...args, ".", ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
