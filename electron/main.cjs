const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  clipboard,
  Notification,
  Tray,
  Menu,
  nativeImage,
  shell,
} = require("electron");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);
const { Store, text, nextRun } = require("./core.cjs");
const { BrainService } = require("./service.cjs");
const { stopAll } = require("./codex.cjs");
const { DEFAULT_MODEL, modelOptions } = require("./models.cjs");
const { installGnomeShortcuts } = require("./shortcuts.cjs");
const { trackLocalManager } = require("./local-manager.cjs");
const { randomUUID } = require("node:crypto");
const BUBBLE_SIZE = 66;
let main,
  bubble,
  tray,
  store,
  service,
  timer,
  bubbleDrag,
  bubbleDragTimer,
  controlServer,
  stopLocalManagerTracking,
  shortcutStatus = {},
  shortcutBackend = "Starting",
  shortcutError = "",
  quitting = false;
app.setName("Second Brain");
if (process.env.BRAIN_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.BRAIN_DATA_DIR));
// Select Ozone before native platform initialization; appendSwitch here is too late.
const needsX11 =
  process.platform === "linux" &&
  app.commandLine.getSwitchValue("ozone-platform") !== "x11";
if (process.platform === "linux") app.disableHardwareAcceleration();
if (needsX11) {
  app.relaunch({
    args: [
      ...process.argv
        .slice(1)
        .filter((arg) => !arg.startsWith("--ozone-platform=")),
      "--ozone-platform=x11",
    ],
  });
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--brain-capture")) void capture();
    else if (argv.includes("--brain-toggle")) toggle();
    else if (argv.includes("--background")) revealBubble();
    else {
      showMain();
      revealBubble();
    }
  });
  app.whenReady().then(async () => {
    const dir = app.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    store = new Store(path.join(dir, "brain.sqlite"));
    service = new BrainService(store, dir, changed, notify);
    if (process.platform === "linux")
      app.setDesktopName("second-brain.desktop");
    createWindows();
    if (!process.env.BRAIN_DATA_DIR)
      stopLocalManagerTracking = trackLocalManager();
    await startShortcutControl();
    void registerShortcuts();
    createTray();
    if (process.argv.includes("--brain-capture")) void capture();
    timer = setInterval(() => service.tick(), 10000);
    service.tick();
    for (const r of store.all("SELECT id FROM records WHERE status='pending'"))
      void service.processRecord(r.id);
    screen.on("display-removed", () => placeBubble());
    screen.on("display-metrics-changed", () => placeBubble());
  });
  app.on("window-all-closed", () => {});
  app.on("activate", () => showMain());
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(timer);
    globalShortcut.unregisterAll();
    stopAll();
    try {
      stopLocalManagerTracking?.();
    } catch (error) {
      console.warn(error.message);
    }
    clearInterval(bubbleDragTimer);
    controlServer?.close();
  });
}
function changed() {
  for (const w of [main, bubble])
    if (w && !w.isDestroyed()) w.webContents.send("brain:changed");
}
function notify(title, body) {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body });
    n.on("click", showMain);
    n.show();
  }
}
function load(win, hash) {
  if (process.env.BRAIN_DEV === "1")
    win.loadURL(`http://127.0.0.1:5173/#${hash}`);
  else win.loadFile(path.join(__dirname, "../dist/index.html"), { hash });
}
function createWindows() {
  const prefs = {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
  main = new BrowserWindow({
    width: 1240,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#f6f7f9",
    title: "Second Brain",
    autoHideMenuBar: true,
    webPreferences: prefs,
  });
  main.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt)
      return;
    const increase = ["+", "=", "Add"].includes(input.key);
    const decrease = ["-", "Subtract"].includes(input.key);
    if (increase || decrease) {
      event.preventDefault();
      main.webContents.send("brain:font-adjust", increase ? 1 : -1);
    }
  });
  main.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      main.hide();
    }
  });
  main.once("ready-to-show", () => {
    if (
      !process.argv.includes("--brain-capture") &&
      !process.argv.includes("--background")
    )
      main.show();
  });
  load(main, "app");
  bubble = new BrowserWindow({
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    useContentSize: true,
    title: "Second Brain Bubble",
    type: process.platform === "linux" ? "dock" : undefined,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: { ...prefs, partition: "persist:brain-bubble" },
  });
  bubble.webContents.on("did-finish-load", () => {
    bubble.webContents.setZoomFactor(1);
    void bubble.webContents
      .setVisualZoomLevelLimits(1, 1)
      .catch((error) => console.error("Bubble zoom setup:", error.message));
  });
  bubble.webContents.on("before-input-event", (event, input) => {
    if (
      (input.control || input.meta) &&
      ["+", "-", "=", "0"].includes(input.key)
    )
      event.preventDefault();
  });
  bubble.setAlwaysOnTop(true, "floating");
  bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubble.webContents.on("page-title-updated", (event) =>
    event.preventDefault(),
  );
  bubble.webContents.on("context-menu", () => {
    finishBubbleDrag(false);
    Menu.buildFromTemplate([
      { label: "Open Second Brain", click: showMain },
      { type: "separator" },
      { label: "Quit Second Brain", click: () => app.quit() },
    ]).popup({ window: bubble });
  });
  bubble.once("ready-to-show", () => revealBubble());
  placeBubble();
  load(bubble, "bubble");
  bubble.on("moved", () => {
    const [x, y] = bubble.getPosition();
    if (!bubbleDrag) store.setSetting("bubblePosition", { x, y });
  });
  for (const win of [main, bubble]) {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
  }
}
function revealBubble(reset = false) {
  if (!bubble || bubble.isDestroyed()) return;
  if (reset) {
    const area = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).workArea;
    placeBubble({ x: area.x + area.width - 110, y: area.y + 110 });
  } else placeBubble();
  bubble.setAlwaysOnTop(true, "floating");
  bubble.showInactive();
  bubble.moveTop();
}
function showMain() {
  if (!main || main.isDestroyed()) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
}
function toggle() {
  revealBubble();
  if (main.isVisible() && !main.isMinimized()) main.hide();
  else showMain();
}
function placeBubble(position, persist = true) {
  const saved = position || store.setting("bubblePosition", null);
  const area = saved
    ? screen.getDisplayNearestPoint(saved).bounds
    : screen.getPrimaryDisplay().bounds;
  const x = Math.min(
    Math.max(saved?.x ?? area.x + area.width - 100, area.x),
    area.x + area.width - BUBBLE_SIZE,
  );
  const y = Math.min(
    Math.max(saved?.y ?? area.y + area.height - 150, area.y),
    area.y + area.height - BUBBLE_SIZE,
  );
  // Always supply the intended size: setPosition can round-trip inflated dimensions
  // through the XWayland fractional-scale conversion and grow a transparent overlay.
  bubble.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
  });
  if (persist)
    store.setSetting("bubblePosition", { x: Math.round(x), y: Math.round(y) });
}
function updateBubbleDrag() {
  if (!bubbleDrag || !bubble || bubble.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - bubbleDrag.cursor.x;
  const dy = cursor.y - bubbleDrag.cursor.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) bubbleDrag.moved = true;
  if (
    !bubbleDrag.moved ||
    (cursor.x === bubbleDrag.last.x && cursor.y === bubbleDrag.last.y)
  )
    return;
  bubbleDrag.last = cursor;
  placeBubble(
    { x: bubbleDrag.position.x + dx, y: bubbleDrag.position.y + dy },
    false,
  );
}
function startBubbleDrag() {
  clearInterval(bubbleDragTimer);
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = bubble.getPosition();
  bubbleDrag = {
    cursor,
    last: cursor,
    position: { x, y },
    moved: false,
    started: Date.now(),
  };
  bubbleDragTimer = setInterval(() => {
    if (!bubbleDrag || Date.now() - bubbleDrag.started > 30000) {
      finishBubbleDrag(false);
      return;
    }
    updateBubbleDrag();
  }, 16);
}
function finishBubbleDrag(toggleIfClick = true) {
  if (!bubbleDrag) return;
  updateBubbleDrag();
  const moved = bubbleDrag.moved;
  bubbleDrag = null;
  clearInterval(bubbleDragTimer);
  bubbleDragTimer = null;
  const [x, y] = bubble.getPosition();
  store.setSetting("bubblePosition", { x, y });
  if (!moved && toggleIfClick) toggle();
}
function shortcutSocket() {
  return path.join(app.getPath("userData"), "desktop-shortcuts.sock");
}
async function startShortcutControl() {
  if (process.platform !== "linux") return;
  const socket = shortcutSocket();
  try {
    fs.unlinkSync(socket);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  controlServer = net.createServer((connection) => {
    let command = "";
    connection.setTimeout(2000, () => connection.destroy());
    connection.on("error", () => {});
    connection.on("data", (chunk) => {
      command += chunk.toString();
      if (command.length > 32) connection.destroy();
    });
    connection.on("end", () => {
      if (command === "toggle") toggle();
      else if (command === "capture") void capture();
    });
  });
  await new Promise((resolve, reject) => {
    controlServer.once("error", reject);
    controlServer.listen(socket, resolve);
  });
  fs.chmodSync(socket, 0o600);
}
async function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutStatus = {};
  shortcutError = "";
  const gnome =
    process.platform === "linux" &&
    /gnome|ubuntu/i.test(process.env.XDG_CURRENT_DESKTOP || "");
  if (gnome && !process.env.BRAIN_DATA_DIR) {
    try {
      shortcutStatus = await installGnomeShortcuts(
        process.execPath,
        shortcutSocket(),
      );
      shortcutBackend = "GNOME desktop";
      changed();
      return;
    } catch (error) {
      shortcutError = error.message;
    }
  }
  shortcutBackend = "Electron";
  for (const [label, keys, fn] of [
    ["toggle", ["Control+Shift+?", "Control+Shift+/"], toggle],
    ["capture", ["Control+Shift+>", "Control+Shift+."], () => void capture()],
  ]) {
    shortcutStatus[label] = false;
    for (const key of keys)
      try {
        if (globalShortcut.register(key, fn)) shortcutStatus[label] = true;
      } catch {}
  }
  changed();
}
function createTray() {
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const inside = (x - 16) ** 2 + (y - 16) ** 2 < 190;
      pixels[i] = inside ? 130 : 0;
      pixels[i + 1] = inside ? 80 : 0;
      pixels[i + 2] = inside ? 70 : 0;
      pixels[i + 3] = inside ? 255 : 0;
    }
  tray = new Tray(
    nativeImage.createFromBuffer(pixels, { width: 32, height: 32 }),
  );
  tray.setToolTip("Second Brain");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Second Brain", click: showMain },
      { label: "Capture clipboard", click: () => capture(true) },
      { label: "Show / reset brain bubble", click: () => revealBubble(true) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", toggle);
}
async function capture(useClipboard = false) {
  try {
    let selected = "";
    if (useClipboard) selected = clipboard.readText();
    else if (process.platform === "linux") {
      if (process.env.WAYLAND_DISPLAY) {
        try {
          selected = (
            await execFileAsync("wl-paste", ["--primary", "--no-newline"], {
              timeout: 2000,
              maxBuffer: 500000,
            })
          ).stdout;
        } catch {
          throw new Error(
            "Selection unavailable. Install wl-clipboard, or copy text and use Capture clipboard in Records.",
          );
        }
      } else selected = clipboard.readText("selection");
    } else {
      const saved = clipboard
        .availableFormats()
        .map((format) => [format, clipboard.readBuffer(format)]);
      const marker = `second-brain-${randomUUID()}`;
      clipboard.writeText(marker);
      try {
        if (process.platform === "darwin")
          await execFileAsync(
            "osascript",
            [
              "-e",
              'tell application "System Events" to keystroke "c" using command down',
            ],
            { timeout: 3000 },
          );
        else
          await execFileAsync(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')",
            ],
            { timeout: 3000 },
          );
        await new Promise((r) => setTimeout(r, 180));
        selected = clipboard.readText();
        if (selected === marker) selected = "";
      } finally {
        clipboard.clear();
        for (const [format, buffer] of saved)
          clipboard.writeBuffer(format, buffer);
      }
    }
    if (!selected.trim())
      throw new Error(
        "No selected text was found. Copy text and use Capture clipboard in Records.",
      );
    const id = service.saveRecord({ content: text(selected), images: [] });
    changed();
    notify(
      "Captured to your brain",
      "Your selection was saved and is being connected.",
    );
    return id;
  } catch (e) {
    showMain();
    main.webContents.send("brain:notice", e.message);
    return null;
  }
}
function handler(name, fn) {
  ipcMain.handle(`brain:${name}`, async (event, ...args) => {
    if (
      ![main?.webContents.id, bubble?.webContents.id].includes(event.sender.id)
    )
      throw new Error("Unknown sender.");
    return fn(...args);
  });
}
handler("snapshot", () => ({
  ...store.snapshot(),
  settings: service.settings(),
  models: modelOptions(),
  system: {
    shortcuts: shortcutStatus,
    shortcutBackend,
    shortcutError,
    platform: process.platform,
    workspaceVisible: main.isVisible(),
    bubble: {
      visible: bubble.isVisible(),
      bounds: bubble.getBounds(),
      nativeHandle: bubble.getNativeWindowHandle().toString("hex"),
    },
    dataPath: app.getPath("userData"),
  },
}));
handler("toggle", toggle);
handler("resetBubble", () => revealBubble(true));
handler("quit", () => app.quit());
handler("collapse", () => main.hide());
handler("beginBubbleDrag", startBubbleDrag);
handler("endBubbleDrag", finishBubbleDrag);
handler("moveBubble", (p) => {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  placeBubble(p);
});
handler("bubblePosition", () => {
  const [x, y] = bubble.getPosition();
  return { x, y };
});
handler("capture", () => capture(true));
handler("saveRecord", (input) => {
  const id = service.saveRecord(input);
  changed();
  return id;
});
handler("deleteRecord", (id) => {
  store.deleteRecord(text(id, 100));
  changed();
});
handler("retryRecord", (id) => service.processRecord(text(id, 100)));
handler("image", (name) => {
  const file = service.imagePaths([name])[0];
  return "data:image/png;base64," + fs.readFileSync(file).toString("base64");
});
handler("parseSchedule", (prompt) => service.parseSchedule(prompt));
handler("saveTask", (input) => {
  const id = store.saveTask(input);
  changed();
  return id;
});
handler("toggleTask", (id) => {
  const t = store.get("SELECT * FROM tasks WHERE id=?", id);
  if (!t) throw new Error("Task no longer exists.");
  const enabled = !t.enabled;
  store.run(
    "UPDATE tasks SET enabled=?,next_run=? WHERE id=?",
    Number(enabled),
    enabled ? nextRun(JSON.parse(t.schedule)) : t.next_run,
    id,
  );
  changed();
});
handler("deleteTask", (id) => {
  store.run("DELETE FROM tasks WHERE id=?", text(id, 100));
  changed();
});
handler("runTask", (id) => service.runTask(text(id, 100), true));
handler("messages", (id) =>
  store
    .all(
      "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at",
      text(id, 100),
    )
    .map((m) => ({ ...m, citations: JSON.parse(m.citations) })),
);
handler("chat", (id, prompt) => service.chat(id, prompt));
handler("deleteConversation", (id) => {
  store.run("DELETE FROM conversations WHERE id=?", text(id, 100));
  changed();
});
handler("newGuide", (input) => {
  const topic = text(input.topic, 500);
  if (!topic.trim()) throw new Error("Enter a topic to learn.");
  const id = randomUUID();
  store.run(
    "INSERT INTO guides(id,topic,technical,status,created_at) VALUES(?,?,?,'processing',?)",
    id,
    topic,
    Number(!!input.technical),
    new Date().toISOString(),
  );
  void service.generateGuide(id);
  changed();
  return id;
});
handler("retryGuide", (id) => service.generateGuide(text(id, 100)));
handler("renameGuide", (id, topic) => {
  text(topic, 500);
  if (!topic.trim()) throw new Error("Enter a topic.");
  store.run("UPDATE guides SET topic=? WHERE id=?", topic, text(id, 100));
  changed();
});
handler("deleteGuide", (id) => {
  store.run("DELETE FROM guides WHERE id=?", text(id, 100));
  changed();
});
handler("saveCard", (input) => {
  store.run(
    "UPDATE cards SET title=?,body=?,done=? WHERE id=?",
    text(input.title, 250),
    text(input.body, 12000),
    Number(!!input.done),
    text(input.id, 100),
  );
  changed();
});
handler("deleteCard", (id) => {
  store.run("DELETE FROM cards WHERE id=?", text(id, 100));
  changed();
});
handler("settings", (input) => {
  store.setSetting("preferences", {
    codexPath: text(input.codexPath, 1000) || "codex",
    model: text(input.model, 200) || DEFAULT_MODEL,
  });
  changed();
});
handler("setModel", (model) => {
  store.setSetting("preferences", {
    ...service.settings(),
    model: text(model, 200) || DEFAULT_MODEL,
  });
  changed();
});
handler("repairShortcuts", registerShortcuts);
handler("checkCodex", async () => {
  try {
    const { stdout } = await execFileAsync(
      service.settings().codexPath || "codex",
      ["--version"],
      { timeout: 10000 },
    );
    const auth = await execFileAsync(
      service.settings().codexPath || "codex",
      ["login", "status"],
      { timeout: 10000 },
    );
    return `${stdout.trim()} · ${(auth.stdout + auth.stderr).trim()}`;
  } catch (e) {
    throw new Error(e.stderr || e.message);
  }
});
handler("openExternal", (url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url))
    return shell.openExternal(url);
  throw new Error("Only web links can be opened.");
});
handler("openData", () => shell.openPath(app.getPath("userData")));
