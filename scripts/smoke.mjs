// Isolated Electron integration check. Uses a deterministic Codex fixture, never your real library.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import electron from "electron";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-electron-smoke-"));
const port = 9300 + Math.floor(Math.random() * 1000);
const fake = path.join(dir, "codex-fixture.cjs");
fs.writeFileSync(
  fake,
  `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(path.join(dir, "last-call.json"))},JSON.stringify(args));let prompt='';process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',()=>{const schemaIndex=args.indexOf('--output-schema');let result='Completed scheduled reflection.';if(schemaIndex>=0){const schema=JSON.parse(fs.readFileSync(args[schemaIndex+1]));if(schema.properties.summary)result={title:'SQLite learning note',summary:'Learn transactions and durable storage.',tags:['sqlite'],links:[]};else if(schema.properties.answer)result={answer:'Your note is about SQLite transactions.',recordIds:[...prompt.matchAll(/"id":"([a-f0-9-]+)"/g)].map(m=>m[1]).slice(0,1)};else if(schema.properties.kind)result={title:'Review notes',command:'Review SQLite notes',kind:'interval',minutes:60,time:null,day:null,at:null};else result={cards:[{title:'Atomic transactions',body:'Use a transaction to commit related changes together.',sources:[{title:'SQLite documentation',url:'https://www.sqlite.org/lang_transaction.html'}]}]};}fs.writeFileSync(args[args.indexOf('-o')+1],typeof result==='string'?result:JSON.stringify(result));console.log(JSON.stringify({type:'item.completed',item:{type:'web_search'}}));console.log(JSON.stringify({type:'item.completed',item:{type:'mcp_tool_call',server:'context7',status:'completed'}}));});`,
  { mode: 0o755 },
);
const child = spawn(
  electron,
  [
    ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
    ".",
    `--remote-debugging-port=${port}`,
  ],
  {
    env: { ...process.env, BRAIN_DATA_DIR: dir },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let logs = "";
child.stderr.on("data", (d) => (logs += d));
let ws;
let seq = 0;
const pending = new Map();
const errors = [];
async function waitFor(fn, label) {
  for (let i = 0; i < 100; i++) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out: ${label}\n${logs.slice(-2000)}`);
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text,
    );
  return result.result.value;
}
const invoke = (method, ...args) =>
  evaluate(
    `window.brain[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );
try {
  const pages = await waitFor(async () => {
    const p = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    return p.find((v) => v.url.endsWith("#app"));
  }, "Electron debug connection");
  ws = new WebSocket(pages.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (e) => {
    const message = JSON.parse(e.data);
    if (message.id) {
      const task = pending.get(message.id);
      if (task) {
        pending.delete(message.id);
        message.error
          ? task.reject(message.error)
          : task.resolve(message.result);
      }
    } else if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params);
  });
  await call("Runtime.enable");
  await waitFor(
    () =>
      evaluate(
        '!!window.brain && document.body.innerText.includes("Saved records")',
      ),
    "renderer ready",
  );
  await waitFor(
    async () => (await invoke("snapshot")).system.bubble.visible,
    "bubble visible",
  );
  if (process.platform === "linux") {
    const bubble = (await invoke("snapshot")).system.bubble;
    const xid =
      "0x" +
      Buffer.from(bubble.nativeHandle, "hex").readUInt32LE().toString(16);
    const info = execFileSync("xwininfo", ["-id", xid], { encoding: "utf8" });
    assert.match(
      info,
      /Map State: IsViewable/,
      "Bubble must be mapped on the real desktop",
    );
    assert.match(info, /Second Brain/);
  }
  await invoke("resetBubble");
  if (process.platform === "linux") {
    await invoke("collapse");
    execFileSync(
      electron,
      [
        "-e",
        'const s=require("node:net").createConnection(process.argv[1]);s.on("connect",()=>s.end("toggle"));s.on("error",()=>process.exit(1));',
        "--",
        path.join(dir, "desktop-shortcuts.sock"),
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 5000 },
    );
    await waitFor(
      () => evaluate('document.visibilityState === "visible"'),
      "desktop shortcut relay opens app",
    );
  }
  const chord = async (key, code, virtualKey) => {
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      modifiers: 2,
      windowsVirtualKeyCode: virtualKey,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      modifiers: 2,
      windowsVirtualKeyCode: virtualKey,
    });
  };
  await chord("e", "KeyE", 69);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.app').classList.contains('sidebar-collapsed')`,
      ),
    "Ctrl+E collapses sidebar",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')`,
    ),
    "false",
  );
  await evaluate(`document.querySelector('.sidebar-toggle').click()`);
  assert.equal(
    await evaluate(
      `document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')`,
    ),
    "true",
  );
  for (const [number, section] of [
    ["1", "Records"],
    ["2", "Chat"],
    ["3", "Scheduler"],
    ["4", "Learning guide"],
    ["1", "Records"],
  ]) {
    await chord(number, "Digit" + number, 48 + Number(number));
    await waitFor(
      () =>
        evaluate(
          `document.querySelector('h1')?.textContent === ${JSON.stringify(section)}`,
        ),
      "Ctrl+" + number + " opens " + section,
    );
  }
  const rootFont = await evaluate(
    `parseFloat(getComputedStyle(document.documentElement).fontSize)`,
  );
  assert.ok(
    Math.abs(rootFont - (14 + (2 * 96) / 72)) < 0.02,
    "Default font increased by two points",
  );
  const bubblePage = (
    await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  ).find((p) => p.url.endsWith("#bubble"));
  const bubbleWS = new WebSocket(bubblePage.webSocketDebuggerUrl);
  await new Promise((resolve) => bubbleWS.addEventListener("open", resolve));
  const inspectBubble = () =>
    new Promise((resolve) => {
      bubbleWS.addEventListener(
        "message",
        (event) => resolve(JSON.parse(event.data).result.result.value),
        { once: true },
      );
      bubbleWS.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: `(()=>{const e=document.querySelector('.brain-bubble'),r=e.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y,viewportWidth:innerWidth,viewportHeight:innerHeight,opacity:getComputedStyle(e).opacity};})()`,
            returnByValue: true,
          },
        }),
      );
    });
  const dimensions = await inspectBubble();
  assert.ok(
    Math.abs(dimensions.width - 49.6) < 0.1,
    "Bubble diameter reduced by 20 percent",
  );
  assert.equal(Number(dimensions.opacity), 0.7);
  assert.ok(
    dimensions.x >= 6 &&
      dimensions.y >= 6 &&
      dimensions.x + dimensions.width <= dimensions.viewportWidth - 6 &&
      dimensions.y + dimensions.height <= dimensions.viewportHeight - 6,
    "Bubble fits the native viewport with padding",
  );
  // Zooming the main page must not zoom or clip the separate bubble session.
  await call("Emulation.setPageScaleFactor", { pageScaleFactor: 1.5 });
  assert.deepEqual(await inspectBubble(), dimensions);
  await call("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  bubbleWS.close();
  await invoke("settings", { codexPath: fake, model: "" });
  assert.equal((await invoke("snapshot")).settings.model, "gpt-6-luna");
  const id = await invoke("saveRecord", {
    title: "SQLite",
    content: "Learn SQLite transactions",
    images: [],
  });
  await waitFor(
    async () => (await invoke("snapshot")).records[0]?.status === "ready",
    "record processing",
  );
  await waitFor(
    () => evaluate('!!document.querySelector(".record-card")'),
    "record UI",
  );
  await evaluate('document.querySelector(".record-card").click()');
  assert.equal(
    await evaluate('!!document.querySelector(".record-detail")'),
    true,
  );
  await evaluate('document.querySelector(".modal-head button").click()');
  assert.ok(
    JSON.parse(fs.readFileSync(path.join(dir, "last-call.json"))).includes(
      "gpt-6-luna",
    ),
  );
  // Clipboard Files use a blob URL during decoding; test the actual editor path.
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New record').click()`,
  );
  await evaluate(`document.querySelector('.form-body textarea').focus()`);
  await call("Input.insertText", {
    text: "A pasted diagram with original text preserved.",
  });
  await evaluate(
    `(()=>{const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;canvas.getContext('2d').fillRect(0,0,24,24);const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'clipboard.png',{type:'image/png'}));document.querySelector('.form-body textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`,
  );
  await waitFor(
    () =>
      evaluate(
        `(()=>{const img=document.querySelector('.image-previews img');return !!img && img.complete && img.naturalWidth===24;})()`,
      ),
    "pasted clipboard image decodes and previews",
  );
  assert.equal(
    await evaluate(`document.querySelector('.form-body textarea').value`),
    "A pasted diagram with original text preserved.",
  );
  await evaluate(`document.querySelector('.form-actions .primary').click()`);
  await waitFor(
    async () =>
      (await invoke("snapshot")).records.some(
        (r) => r.images.length === 1 && r.status === "ready",
      ),
    "pasted image saved and understood",
  );
  const imageRecord = (await invoke("snapshot")).records.find(
    (r) => r.images.length,
  );
  const storedImage = await invoke("image", imageRecord.images[0]);
  assert.ok(storedImage.startsWith("data:image/png;base64,"));
  assert.ok(
    JSON.parse(fs.readFileSync(path.join(dir, "last-call.json"))).includes(
      "--image",
    ),
    "Codex receives the saved image attachment",
  );
  await waitFor(
    () =>
      evaluate(
        `!!document.querySelector('.record-detail .record-images img')?.naturalWidth`,
      ),
    "saved attachment reloads from the image store",
  );
  await evaluate(
    `document.querySelector('[aria-label="Edit record"]').click()`,
  );
  await waitFor(
    () =>
      evaluate(`!!document.querySelector('.image-previews img')?.naturalWidth`),
    "existing record shows its saved image in the editor",
  );
  await evaluate(
    `document.querySelector('[aria-label="Remove image"]').click()`,
  );
  assert.equal(
    await evaluate(
      `!!document.querySelector('.form-body textarea') && document.querySelectorAll('.image-previews img').length===0`,
    ),
    true,
    "Removing an attachment does not submit the record",
  );
  assert.equal(
    (await invoke("snapshot")).records.find((r) => r.id === imageRecord.id)
      .images.length,
    1,
    "Unsaved attachment edits do not change stored data",
  );
  await evaluate(`document.querySelector('.modal-head button').click()`);
  await invoke("deleteRecord", imageRecord.id);
  await invoke("setModel", "gpt-6.1-sol");
  const parsed = await invoke("parseSchedule", "Review my notes every hour");
  assert.equal(parsed.schedule.minutes, 60);
  assert.ok(
    JSON.parse(fs.readFileSync(path.join(dir, "last-call.json"))).includes(
      "gpt-6.1-sol",
    ),
  );
  await invoke("setModel", "gpt-6-luna");
  const task = await invoke("saveTask", parsed);
  await invoke("runTask", task);
  assert.equal((await invoke("snapshot")).runs[0].status, "success");
  const chat = await invoke("chat", null, "What am I learning?");
  const messages = await invoke("messages", chat);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1].citations, [id]);
  // Exercise the renderer send path, including the scroll effect between updates.
  await evaluate(
    `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('Chat')).click()`,
  );
  await evaluate(`document.querySelector('.chat-compose textarea').focus()`);
  await call("Input.insertText", { text: "Explain my SQLite note again" });
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.message').length === 2 && !document.querySelector('.thinking')`,
      ),
    "Enter submits chat and renders the reply without crashing",
  );
  assert.equal(
    await evaluate(
      `!!document.querySelector('nav') && !!document.querySelector('.chat-compose')`,
    ),
    true,
  );
  const uiChat = (await invoke("snapshot")).conversations.find(
    (c) => c.id !== chat,
  ).id;
  await evaluate(`document.querySelector('.chat-compose textarea').focus()`);
  await call("Input.insertText", { text: "And what should I try next?" });
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.message').length === 4 && !document.querySelector('.thinking')`,
      ),
    "follow-up Enter keeps the conversation usable",
  );
  await evaluate(`document.querySelector('.chat-compose textarea').focus()`);
  await call("Input.insertText", { text: "Summarize the next step" });
  await evaluate(
    `document.querySelector('[aria-label="Send message"]').click()`,
  );
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll('.message').length === 6 && !document.querySelector('.thinking')`,
      ),
    "send button works after repeated Enter submissions",
  );
  await invoke("deleteConversation", uiChat);
  const guide = await invoke("newGuide", {
    topic: "SQLite transactions",
    technical: true,
  });
  await waitFor(
    async () => (await invoke("snapshot")).guides[0]?.status === "ready",
    "guide generation",
  );
  let snapshot = await invoke("snapshot");
  assert.equal(snapshot.guides[0].provenance.context7, true);
  let card = snapshot.guides[0].cards[0];
  await invoke("saveCard", { ...card, done: true });
  assert.equal((await invoke("snapshot")).guides[0].cards[0].done, 1);
  for (const section of ["Scheduler", "Chat", "Learning guide", "Records"]) {
    await evaluate(
      `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes(${JSON.stringify(section)})).click()`,
    );
    assert.equal(
      await evaluate('document.querySelector("h1").textContent'),
      section,
    );
  }
  await invoke("renameGuide", guide, "SQLite fundamentals");
  await invoke("deleteCard", card.id);
  await invoke("deleteGuide", guide);
  await invoke("deleteConversation", chat);
  await invoke("deleteTask", task);
  await invoke("deleteRecord", id);
  snapshot = await invoke("snapshot");
  assert.equal(
    snapshot.records.length +
      snapshot.tasks.length +
      snapshot.guides.length +
      snapshot.conversations.length,
    0,
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(
    "Electron integration passed: pasted-image preview, persistence, Codex attachment, safe removal, records, scheduler, chat, learning, navigation, and no renderer exceptions.",
  );
} finally {
  ws?.close();
  child.kill();
  await delay(400);
  fs.rmSync(dir, { recursive: true, force: true });
}
