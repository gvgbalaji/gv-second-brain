const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "snapshot",
  "toggle",
  "resetBubble",
  "quit",
  "collapse",
  "moveBubble",
  "beginBubbleDrag",
  "endBubbleDrag",
  "bubblePosition",
  "capture",
  "saveRecord",
  "deleteRecord",
  "retryRecord",
  "image",
  "parseSchedule",
  "saveTask",
  "toggleTask",
  "deleteTask",
  "runTask",
  "messages",
  "chat",
  "deleteConversation",
  "newGuide",
  "retryGuide",
  "renameGuide",
  "deleteGuide",
  "saveCard",
  "deleteCard",
  "settings",
  "setModel",
  "repairShortcuts",
  "checkCodex",
  "openExternal",
  "openData",
];
const api = Object.fromEntries(
  methods.map((name) => [
    name,
    (...args) => ipcRenderer.invoke(`brain:${name}`, ...args),
  ]),
);
api.onChange = (callback) => {
  const fn = () => callback();
  ipcRenderer.on("brain:changed", fn);
  return () => ipcRenderer.removeListener("brain:changed", fn);
};
api.onNotice = (callback) => {
  const fn = (_event, message) => callback(message);
  ipcRenderer.on("brain:notice", fn);
  return () => ipcRenderer.removeListener("brain:notice", fn);
};
api.onFontAdjust = (callback) => {
  const fn = (_event, direction) => callback(direction);
  ipcRenderer.on("brain:font-adjust", fn);
  return () => ipcRenderer.removeListener("brain:font-adjust", fn);
};
contextBridge.exposeInMainWorld("brain", api);
