const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store, nextRun } = require("./core.cjs");
test("intervals and calendar schedules validate and advance correctly", () => {
  const from = new Date(2026, 10, 12, 10, 30);
  assert.equal(
    new Date(nextRun({ kind: "interval", minutes: 15 }, from)).getTime(),
    from.getTime() + 900000,
  );
  const daily = new Date(nextRun({ kind: "daily", time: "09:00" }, from));
  assert.equal(daily.getDate(), 13);
  assert.equal(daily.getHours(), 9);
  const weekly = new Date(
    nextRun({ kind: "weekly", day: 4, time: "10:30" }, from),
  );
  assert.equal(weekly.getDate(), 19);
  assert.throws(() => nextRun({ kind: "interval", minutes: 0 }, from));
  assert.throws(() => nextRun({ kind: "weekly", day: 9, time: "09:00" }, from));
  assert.throws(() => nextRun({ kind: "once", at: "2020-01-01" }, from));
  assert.throws(() => nextRun({ kind: "daily", time: "25:00" }, from));
});
test("records, full text search, bidirectional links, updates and deletes persist in SQLite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-store-test-"));
  let store;
  try {
    const file = path.join(dir, "brain.sqlite");
    store = new Store(file);
    const a = store.saveRecord({
      title: "React rendering",
      content: "Components and reconciliation",
      images: [],
    });
    const b = store.saveRecord({
      title: "Performance",
      content: "Rendering can be optimized",
      images: [],
    });
    store.run(
      "INSERT INTO links VALUES(?,?,?)",
      a,
      b,
      "Related rendering concepts",
    );
    assert.equal(store.records("reconcil")[0].id, a);
    assert.equal(store.records().find((r) => r.id === b).links[0].id, a);
    assert.equal(store.records('" OR invalid:([]').length, 0);
    store.saveRecord({
      id: a,
      title: "Changed",
      content: "SQLite durable storage",
      images: [],
    });
    assert.equal(store.records("reconcil").length, 0);
    assert.equal(store.records("durable")[0].id, a);
    assert.equal(store.records().find((r) => r.id === b).links.length, 0);
    store.db.close();
    store = new Store(file);
    assert.equal(store.records().length, 2);
    store.deleteRecord(a);
    assert.equal(store.records("durable").length, 0);
    assert.equal(store.records().length, 1);
  } finally {
    store?.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("transactions roll back and interrupted background work is recoverable", () => {
  const store = new Store(":memory:");
  assert.throws(() =>
    store.transaction(() => {
      store.saveTask({
        title: "First",
        command: "Review notes",
        schedule: { kind: "interval", minutes: 10 },
      });
      throw new Error("abort");
    }),
  );
  assert.equal(store.snapshot().tasks.length, 0);
  store.db.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-restart-test-"));
  const file = path.join(dir, "brain.sqlite");
  let s = new Store(file);
  const id = s.saveTask({
    title: "Review",
    command: "Review notes",
    schedule: { kind: "interval", minutes: 5 },
  });
  s.run("UPDATE tasks SET running=1 WHERE id=?", id);
  s.run(
    "INSERT INTO runs(id,task_id,status,started_at) VALUES('run',?,'running',?)",
    id,
    new Date().toISOString(),
  );
  s.db.close();
  s = new Store(file);
  assert.equal(s.snapshot().tasks[0].running, 0);
  assert.equal(s.snapshot().runs[0].status, "interrupted");
  s.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("LocalAM runtime adoption preserves other apps and refuses shared process groups", () => {
  const { registerRuntime } = require("./local-manager.cjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "brain-localam-"));
  try {
    fs.writeFileSync(
      path.join(directory, "apps.json"),
      JSON.stringify([
        {
          id: "brain",
          name: "Second Brain",
          appType: "desktop",
          command: "cd /projects/gv-second-brain && npm start",
        },
      ]),
    );
    const other = { pid: 123, pgid: 123, startedAt: "earlier" };
    fs.writeFileSync(
      path.join(directory, "state.json"),
      JSON.stringify({ other }),
    );
    registerRuntime(directory, 500, 400)();
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directory, "state.json"))),
      { other },
    );
    const cleanup = registerRuntime(directory, 500, 500);
    let state = JSON.parse(fs.readFileSync(path.join(directory, "state.json")));
    assert.equal(state.brain.pid, 500);
    assert.deepEqual(state.other, other);
    state.brain.pid = 600;
    fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify(state));
    cleanup();
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, "state.json"))).brain.pid,
      600,
    );
    registerRuntime(directory, 700, 700)();
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directory, "state.json"))),
      { other },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
