import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
if (process.platform !== "linux")
  throw new Error("This startup installer supports Linux graphical login.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(path.join(root, "dist/index.html")))
  throw new Error("Build the app with npm run build first.");
const quote = (value) => '"' + value.replace(/[\\"`$]/g, "\\$&") + '"';
const directory = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "autostart",
);
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, "second-brain.desktop");
fs.writeFileSync(
  file,
  `[Desktop Entry]\nType=Application\nName=Second Brain\nComment=Keep the Second Brain bubble available after login\nExec=${quote(electron)} --ozone-platform=x11 ${quote(root)} --background\nIcon=${path.join(root, "assets/brain.svg")}\nTerminal=false\nStartupNotify=false\nX-GNOME-Autostart-enabled=true\nX-GNOME-Autostart-Delay=5\n`,
  { mode: 0o755 },
);
console.log(`Enabled Second Brain at graphical login: ${file}`);
