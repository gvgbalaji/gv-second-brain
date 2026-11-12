const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const SCHEMA = "org.gnome.settings-daemon.plugins.media-keys";
const PREFIX =
  "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/second-brain-";
const quoteVariant = (value) =>
  "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const quoteCommand = (value) => '"' + value.replace(/[\\"`$]/g, "\\$&") + '"';
async function installGnomeShortcuts(executable, socketPath) {
  // Run only the Node runtime: invoking Chromium from gsd-media-keys can fail
  // Linux sandbox initialization before the second-instance event is delivered.
  const relay =
    'const s=require("node:net").createConnection(process.argv[1]);s.on("connect",()=>s.end(process.argv[2]));s.on("error",()=>process.exit(1));s.setTimeout(3000,()=>s.destroy());';
  const command = [
    "/usr/bin/env",
    "ELECTRON_RUN_AS_NODE=1",
    executable,
    "-e",
    relay,
    "--",
    socketPath,
  ]
    .map(quoteCommand)
    .join(" ");
  const get = (schema, key) =>
    run("gsettings", ["get", schema, key], { timeout: 4000 });
  const set = (schema, key, value) =>
    run("gsettings", ["set", schema, key, value], { timeout: 4000 });
  const existing = (await get(SCHEMA, "custom-keybindings")).stdout;
  // Paths in this GSettings array cannot contain quotes or escapes.
  const paths = [...existing.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const binding of [
    {
      id: "toggle",
      name: "Second Brain: expand or collapse",
      key: "<Control><Shift>slash",
      action: "toggle",
    },
    {
      id: "capture",
      name: "Second Brain: capture selection",
      key: "<Control><Shift>period",
      action: "capture",
    },
  ]) {
    const location = PREFIX + binding.id + "/";
    const schema = SCHEMA + ".custom-keybinding:" + location;
    await set(schema, "name", quoteVariant(binding.name));
    await set(schema, "command", quoteVariant(command + " " + binding.action));
    await set(schema, "binding", quoteVariant(binding.key));
    if (!paths.includes(location)) paths.push(location);
  }
  await set(
    SCHEMA,
    "custom-keybindings",
    "[" + paths.map(quoteVariant).join(", ") + "]",
  );
  return { toggle: true, capture: true };
}
module.exports = { installGnomeShortcuts };
