import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
if (process.platform !== "linux")
  throw new Error("This installer is only for Linux with AppArmor.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (/["\n\r{}]/.test(root))
  throw new Error("Unsupported project path for AppArmor attachment.");
const abi = fs.existsSync("/etc/apparmor.d/abi/5.0") ? "5.0" : "4.0";
const profile = `# Allow Electron to create its own sandbox on Ubuntu with restricted user namespaces.\n# This applies only to Second Brain's development and packaged executables.\nabi <abi/${abi}>,\ninclude <tunables/global>\n\nprofile second-brain "${root}/{node_modules/electron/dist/electron,release/linux-unpacked/gv-second-brain}" flags=(unconfined) {\n  userns,\n}\n`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "second-brain-apparmor-"));
try {
  const source = path.join(temp, "second-brain");
  fs.writeFileSync(source, profile, { mode: 0o600 });
  const check = spawnSync(
    "/usr/sbin/apparmor_parser",
    ["--skip-kernel-load", "--skip-read-cache", source],
    { stdio: "inherit" },
  );
  if (check.status !== 0)
    throw new Error("AppArmor profile validation failed.");
  console.log(
    "Installing /etc/apparmor.d/second-brain. Authenticate in the system dialog.",
  );
  console.log(profile);
  const install = spawnSync(
    "/usr/bin/pkexec",
    [
      "/bin/sh",
      "-c",
      'set -eu\n/usr/bin/install -m 0644 -- "$1" /etc/apparmor.d/second-brain\n/usr/sbin/apparmor_parser -r /etc/apparmor.d/second-brain',
      "second-brain-setup",
      source,
    ],
    { stdio: "inherit" },
  );
  if (install.status !== 0)
    throw new Error(
      "Administrator authentication was not completed; the sandbox profile is not installed.",
    );
  console.log("Second Brain sandbox profile installed and loaded.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
