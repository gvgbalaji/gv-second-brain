const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const DEFAULT_MODEL = "gpt-6-luna";
function modelOptions() {
  const defaults = [
    { id: DEFAULT_MODEL, name: "Luna" },
    { id: "gpt-6.1-sol", name: "Sol" },
    { id: "gpt-6.1-terra", name: "Terra" },
    { id: "gpt-6-astra", name: "Astra" },
  ];
  try {
    const cache = JSON.parse(
      fs.readFileSync(
        path.join(
          process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
          "models_cache.json",
        ),
        "utf8",
      ),
    );
    const options = cache.models
      .filter((m) => m.visibility === "list")
      .map((m) => ({
        id: m.slug,
        name:
          m.slug === DEFAULT_MODEL ? "Luna (GPT-6)" : m.display_name || m.slug,
      }));
    if (options.length)
      return [
        { id: DEFAULT_MODEL, name: "Luna (GPT-6)" },
        ...options.filter((m) => m.id !== DEFAULT_MODEL),
      ];
  } catch {}
  return defaults;
}
module.exports = { DEFAULT_MODEL, modelOptions };
