const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const now = () => new Date().toISOString();
function text(value, max = 100000) {
  if (typeof value !== "string" || value.length > max)
    throw new Error("Invalid text or text is too long.");
  return value;
}
function nextRun(schedule, from = new Date()) {
  const kind = schedule.kind;
  if (kind === "interval") {
    const minutes = Number(schedule.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600)
      throw new Error("Interval must be between 1 minute and 1 year.");
    return new Date(from.getTime() + minutes * 60000).toISOString();
  }
  if (kind === "once") {
    const date = new Date(schedule.at);
    if (!Number.isFinite(date.getTime()) || date <= from)
      throw new Error("Choose a future date and time.");
    return date.toISOString();
  }
  if (
    !["daily", "weekly"].includes(kind) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time || "")
  )
    throw new Error("Choose a valid schedule and time.");
  const [h, m] = schedule.time.split(":").map(Number);
  const date = new Date(from);
  date.setHours(h, m, 0, 0);
  if (kind === "weekly") {
    const day = Number(schedule.day);
    if (!Number.isInteger(day) || day < 0 || day > 6)
      throw new Error("Choose a weekday.");
    date.setDate(date.getDate() + ((day - date.getDay() + 7) % 7));
    if (date <= from) date.setDate(date.getDate() + 7);
  } else if (date <= from) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',tags TEXT NOT NULL DEFAULT '[]',images TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'pending',error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS links(source TEXT REFERENCES records(id) ON DELETE CASCADE,target TEXT REFERENCES records(id) ON DELETE CASCADE,reason TEXT NOT NULL,PRIMARY KEY(source,target),CHECK(source != target));
      CREATE VIRTUAL TABLE IF NOT EXISTS record_search USING fts5(id UNINDEXED,title,content,summary,tags);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,command TEXT NOT NULL,schedule TEXT NOT NULL,next_run TEXT,enabled INTEGER NOT NULL DEFAULT 1,running INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,status TEXT NOT NULL,output TEXT NOT NULL DEFAULT '',started_at TEXT NOT NULL,finished_at TEXT);
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,citations TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS guides(id TEXT PRIMARY KEY,topic TEXT NOT NULL,technical INTEGER NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',provenance TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY,guide_id TEXT REFERENCES guides(id) ON DELETE CASCADE,position INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,sources TEXT NOT NULL DEFAULT '[]',done INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.db
      .prepare(
        "UPDATE runs SET status='interrupted',output='App stopped before this run completed.',finished_at=? WHERE status='running'",
      )
      .run(now());
    this.db.exec("UPDATE tasks SET running=0");
    this.db.exec(
      "UPDATE records SET status='error',error='Processing interrupted. Retry to finish understanding this record.' WHERE status='processing'; UPDATE guides SET status='error',error='Generation interrupted. Retry to continue.' WHERE status='processing'",
    );
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(fn) {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  setting(key, fallback) {
    const row = this.get("SELECT value FROM settings WHERE key=?", key);
    return row ? JSON.parse(row.value) : fallback;
  }
  setSetting(key, value) {
    this.run(
      "INSERT OR REPLACE INTO settings VALUES(?,?)",
      key,
      JSON.stringify(value),
    );
  }
  index(id) {
    this.run("DELETE FROM record_search WHERE id=?", id);
    const r = this.get("SELECT * FROM records WHERE id=?", id);
    if (r)
      this.run(
        "INSERT INTO record_search VALUES(?,?,?,?,?)",
        r.id,
        r.title,
        r.content,
        r.summary,
        r.tags,
      );
  }
  records(query = "") {
    const terms = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12);
    const rows = terms?.length
      ? this.all(
          "SELECT records.* FROM records JOIN record_search ON records.id=record_search.id WHERE record_search MATCH ? ORDER BY rank LIMIT 200",
          terms.map((t) => `"${t}"*`).join(" OR "),
        )
      : this.all("SELECT * FROM records ORDER BY created_at DESC");
    return rows.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags),
      images: JSON.parse(r.images),
      links: this.all(
        "SELECT r.id,r.title,l.reason FROM links l JOIN records r ON r.id=CASE WHEN l.source=? THEN l.target ELSE l.source END WHERE l.source=? OR l.target=?",
        r.id,
        r.id,
        r.id,
      ),
    }));
  }
  saveRecord(input) {
    const content = text(input.content),
      title = text(input.title || content.slice(0, 70) || "Image capture", 200);
    if (!content.trim() && !input.images?.length)
      throw new Error("Add text or an image first.");
    const id = input.id || randomUUID(),
      stamp = now();
    if (input.id && !this.get("SELECT id FROM records WHERE id=?", id))
      throw new Error("Record no longer exists.");
    this.transaction(() => {
      this.run(
        `INSERT INTO records(id,title,content,images,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,images=excluded.images,status='pending',error='',updated_at=excluded.updated_at`,
        id,
        title,
        content,
        JSON.stringify(input.images || []),
        stamp,
        stamp,
      );
      this.run("DELETE FROM links WHERE source=? OR target=?", id, id);
      this.index(id);
    });
    return id;
  }
  deleteRecord(id) {
    this.transaction(() => {
      this.run("DELETE FROM records WHERE id=?", id);
      this.index(id);
    });
  }
  context(query) {
    const matches = this.records(query).slice(0, 12);
    const ids = new Set(matches.map((r) => r.id));
    for (const r of matches)
      for (const l of r.links) if (ids.size < 18) ids.add(l.id);
    const all = this.records();
    for (const r of all.slice(0, 6)) if (ids.size < 18) ids.add(r.id);
    return all
      .filter((r) => ids.has(r.id))
      .map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content.slice(0, 8000),
        summary: r.summary,
        tags: r.tags,
      }));
  }
  saveTask(input) {
    const title = text(input.title, 200),
      command = text(input.command, 20000);
    if (!title.trim() || !command.trim())
      throw new Error("Give the task a title and command.");
    const next = nextRun(input.schedule),
      id = input.id || randomUUID();
    if (input.id && !this.get("SELECT id FROM tasks WHERE id=?", id))
      throw new Error("Task no longer exists.");
    this.run(
      `INSERT INTO tasks(id,title,command,schedule,next_run,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,command=excluded.command,schedule=excluded.schedule,next_run=excluded.next_run`,
      id,
      title,
      command,
      JSON.stringify(input.schedule),
      next,
      now(),
    );
    return id;
  }
  snapshot() {
    return {
      records: this.records(),
      tasks: this.all("SELECT * FROM tasks ORDER BY created_at DESC").map(
        (t) => ({ ...t, schedule: JSON.parse(t.schedule) }),
      ),
      runs: this.all("SELECT * FROM runs ORDER BY started_at DESC LIMIT 100"),
      conversations: this.all(
        "SELECT * FROM conversations ORDER BY created_at DESC",
      ),
      guides: this.all("SELECT * FROM guides ORDER BY created_at DESC").map(
        (g) => ({
          ...g,
          provenance: JSON.parse(g.provenance),
          cards: this.all(
            "SELECT * FROM cards WHERE guide_id=? ORDER BY position",
            g.id,
          ).map((c) => ({ ...c, sources: JSON.parse(c.sources) })),
        }),
      ),
    };
  }
}
module.exports = { Store, nextRun, text, now };
