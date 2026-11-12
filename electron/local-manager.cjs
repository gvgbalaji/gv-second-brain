const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
function registerRuntime(directory, pid, pgid) {
  // LocalAM stops a whole process group. Never claim a group shared with another app.
  if (pid !== pgid) return () => {};
  const config = path.join(directory, "apps.json");
  if (!fs.existsSync(config)) return () => {};
  const apps = JSON.parse(fs.readFileSync(config, "utf8"));
  const entry = apps.find(
    (app) =>
      app.appType === "desktop" &&
      app.name === "Second Brain" &&
      app.command.includes("gv-second-brain"),
  );
  if (!entry) return () => {};
  const statePath = path.join(directory, "state.json");
  const read = () =>
    fs.existsSync(statePath)
      ? JSON.parse(fs.readFileSync(statePath, "utf8"))
      : {};
  const write = (state) => {
    const temp = statePath + "." + pid + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(temp, statePath);
  };
  const state = read();
  state[entry.id] = { pid, pgid, startedAt: new Date().toISOString() };
  write(state);
  return () => {
    const latest = read();
    if (latest[entry.id]?.pid === pid) {
      delete latest[entry.id];
      write(latest);
    }
  };
}
function trackLocalManager() {
  try {
    if (process.platform !== "linux") return () => {};
    const directory = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "LocalAM",
    );
    const pgid = Number(
      execFileSync("/usr/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], {
        encoding: "utf8",
        timeout: 2000,
      }).trim(),
    );
    return registerRuntime(directory, process.pid, pgid);
  } catch (error) {
    console.warn("LocalAM status integration:", error.message);
    return () => {};
  }
}
module.exports = { trackLocalManager, registerRuntime };
