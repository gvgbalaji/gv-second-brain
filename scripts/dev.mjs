import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
const server = await createServer();
await server.listen();
const child = spawn(
  electron,
  [...(process.platform === "linux" ? ["--ozone-platform=x11"] : []), "."],
  {
    stdio: "inherit",
    env: { ...process.env, BRAIN_DEV: "1" },
  },
);
const stop = async () => {
  child.kill();
  await server.close();
};
child.on("exit", async (code) => {
  await server.close();
  process.exit(code || 0);
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
