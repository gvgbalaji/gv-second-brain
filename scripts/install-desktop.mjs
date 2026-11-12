import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
if (process.platform !== "linux")
  throw new Error(
    "This launcher installer is for Linux. Use npm start on this platform.",
  );
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(path.join(root, "dist/index.html")))
  throw new Error("Run npm run build first.");
const quote = (value) => '"' + value.replace(/[\\"`$]/g, "\\$&") + '"';
const applications = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
  "applications",
);
fs.mkdirSync(applications, { recursive: true });
const file = path.join(applications, "second-brain.desktop");
fs.writeFileSync(
  file,
  `[Desktop Entry]\nType=Application\nName=Second Brain\nComment=Your personal memory, scheduler, and learning companion\nExec=${quote(electron)} --ozone-platform=x11 ${quote(root)}\nIcon=${path.join(root, "assets/brain.svg")}\nTerminal=false\nCategories=Office;Utility;\nStartupWMClass=Second Brain\n`,
  { mode: 0o755 },
);
console.log(`Installed launcher: ${file}`);
