const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { now, text, nextRun } = require("./core.cjs");
const { DEFAULT_MODEL } = require("./models.cjs");
const { runCodex } = require("./codex.cjs");
class BrainService {
  constructor(store, dir, changed, notify) {
    this.store = store;
    this.dir = dir;
    this.changed = changed;
    this.notify = notify;
    this.busy = new Set();
    this.chatBusy = new Set();
    fs.mkdirSync(path.join(dir, "codex-workspace"), { recursive: true });
    fs.mkdirSync(path.join(dir, "images"), { recursive: true });
  }
  settings() {
    const saved = this.store.setting("preferences", {});
    return {
      ...saved,
      codexPath: saved.codexPath || "codex",
      model: saved.model || DEFAULT_MODEL,
    };
  }
  async ask(prompt, options) {
    return runCodex(
      this.settings(),
      path.join(this.dir, "codex-workspace"),
      prompt,
      options,
    );
  }
  imagePaths(images) {
    return images.map((image) => {
      if (!/^[a-f0-9-]+\.png$/.test(image))
        throw new Error("Invalid image reference.");
      const file = path.join(this.dir, "images", image);
      if (!fs.existsSync(file)) throw new Error("Image no longer exists.");
      return file;
    });
  }
  saveImages(images) {
    if (!Array.isArray(images) || images.length > 6)
      throw new Error("Attach up to 6 images.");
    return images.map((image) => {
      if (typeof image !== "string") throw new Error("Invalid image.");
      if (/^[a-f0-9-]+\.png$/.test(image)) {
        this.imagePaths([image]);
        return image;
      }
      if (!/^data:image\/png;base64,/.test(image) || image.length > 14000000)
        throw new Error("Use PNG images up to 10 MB.");
      const buffer = Buffer.from(image.split(",")[1], "base64");
      if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
        throw new Error("Invalid PNG image.");
      const name = `${randomUUID()}.png`;
      fs.writeFileSync(path.join(this.dir, "images", name), buffer);
      return name;
    });
  }
  async processRecord(id) {
    if (this.busy.has(id)) return;
    const r = this.store.get("SELECT * FROM records WHERE id=?", id);
    if (!r) return;
    this.busy.add(id);
    const version = r.updated_at;
    this.store.run(
      "UPDATE records SET status='processing',error='' WHERE id=?",
      id,
    );
    this.changed();
    try {
      const catalog = this.store
        .records()
        .filter((v) => v.id !== id)
        .slice(0, 200)
        .map((v) => ({
          id: v.id,
          title: v.title,
          summary: v.summary || v.content.slice(0, 500),
          tags: v.tags,
        }));
      const { data } = await this.ask(
        `Understand the following record and attached images. Return a descriptive title, short summary, up to 6 lowercase tags, and links to genuinely related existing record IDs, with a short explanation of each relationship. Never invent IDs. Record: ${JSON.stringify({ title: r.title, content: r.content })}\nExisting catalog: ${JSON.stringify(catalog)}`,
        { schema: "record", images: this.imagePaths(JSON.parse(r.images)) },
      );
      if (
        !this.store.get(
          "SELECT id FROM records WHERE id=? AND updated_at=?",
          id,
          version,
        )
      )
        return;
      this.store.transaction(() => {
        this.store.run(
          "UPDATE records SET title=?,summary=?,tags=?,status='ready',error='' WHERE id=?",
          text(data.title, 200),
          text(data.summary),
          JSON.stringify(data.tags.slice(0, 6).map((t) => text(t, 80))),
          id,
        );
        this.store.run("DELETE FROM links WHERE source=? OR target=?", id, id);
        for (const link of data.links.slice(0, 20))
          if (
            link.id !== id &&
            this.store.get("SELECT id FROM records WHERE id=?", link.id)
          )
            this.store.run(
              "INSERT OR REPLACE INTO links VALUES(?,?,?)",
              ...[id, link.id].sort(),
              text(link.reason, 1000),
            );
        this.store.index(id);
      });
    } catch (e) {
      this.store.run(
        "UPDATE records SET status='error',error=? WHERE id=? AND updated_at=?",
        e.message,
        id,
        version,
      );
    } finally {
      this.busy.delete(id);
      this.changed();
      const current = this.store.get(
        "SELECT status FROM records WHERE id=?",
        id,
      );
      if (current?.status === "pending") void this.processRecord(id);
    }
  }
  saveRecord(input) {
    const images = this.saveImages(input.images || []);
    const id = this.store.saveRecord({ ...input, images });
    void this.processRecord(id);
    return id;
  }
  async parseSchedule(prompt) {
    const { data } = await this.ask(
      `Convert the user's request into a schedule and command for a personal assistant. Current local datetime: ${new Date().toString()}, timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. kind interval uses minutes, daily uses HH:mm, weekly uses HH:mm and day 0 Sunday to 6 Saturday, once uses an ISO timestamp with timezone. Fill unused fields with null. Keep the actual task instruction in command without the scheduling language. Request: ${text(prompt, 10000)}`,
      { schema: "schedule" },
    );
    const schedule = {
      kind: data.kind,
      minutes: data.minutes,
      time: data.time,
      day: data.day,
      at: data.at,
    };
    nextRun(schedule);
    return { title: data.title, command: data.command, schedule };
  }
  async runTask(id, manual = false) {
    const t = this.store.get("SELECT * FROM tasks WHERE id=?", id);
    if (!t || t.running || (!manual && !t.enabled)) return;
    const runId = randomUUID(),
      schedule = JSON.parse(t.schedule);
    this.store.transaction(() => {
      this.store.run("UPDATE tasks SET running=1 WHERE id=?", id);
      this.store.run(
        "INSERT INTO runs(id,task_id,status,started_at) VALUES(?,?,'running',?)",
        runId,
        id,
        now(),
      );
      if (!manual) {
        if (schedule.kind === "once")
          this.store.run(
            "UPDATE tasks SET enabled=0,next_run=NULL WHERE id=?",
            id,
          );
        else
          this.store.run(
            "UPDATE tasks SET next_run=? WHERE id=?",
            nextRun(schedule),
            id,
          );
      }
    });
    this.changed();
    try {
      const { data } = await this.ask(
        `Execute this saved personal assistant task as a text response. Research using web search when helpful. Any command requesting a side effect must be explained as instructions rather than claimed as completed. Task: ${t.command}\nRelevant saved memories: ${JSON.stringify(this.store.context(t.command))}`,
        { research: true },
      );
      this.store.run(
        "UPDATE runs SET status='success',output=?,finished_at=? WHERE id=?",
        data,
        now(),
        runId,
      );
      this.notify(t.title, "Your scheduled result is ready.");
    } catch (e) {
      this.store.run(
        "UPDATE runs SET status='error',output=?,finished_at=? WHERE id=?",
        e.message,
        now(),
        runId,
      );
    } finally {
      this.store.run("UPDATE tasks SET running=0 WHERE id=?", id);
      this.changed();
    }
  }
  tick() {
    const available = Math.max(
      0,
      2 - this.store.get("SELECT count(*) AS n FROM tasks WHERE running=1").n,
    );
    for (const task of this.store.all(
      "SELECT id FROM tasks WHERE enabled=1 AND running=0 AND next_run<=? ORDER BY next_run LIMIT ?",
      now(),
      available,
    ))
      void this.runTask(task.id);
  }
  async chat(conversationId, prompt) {
    text(prompt, 20000);
    if (!prompt.trim()) throw new Error("Write a message first.");
    if (
      conversationId &&
      !this.store.get("SELECT id FROM conversations WHERE id=?", conversationId)
    )
      throw new Error("Conversation no longer exists.");
    const id = conversationId || randomUUID();
    if (this.chatBusy.has(id))
      throw new Error("Wait for the current response.");
    this.chatBusy.add(id);
    if (!conversationId)
      this.store.run(
        "INSERT INTO conversations VALUES(?,?,?)",
        id,
        prompt.slice(0, 70),
        now(),
      );
    this.store.run(
      "INSERT INTO messages VALUES(?,?,?,?,?,?)",
      randomUUID(),
      id,
      "user",
      prompt,
      "[]",
      now(),
    );
    this.changed();
    try {
      const history = this.store
        .all(
          "SELECT role,content FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 16",
          id,
        )
        .reverse();
      const context = this.store.context(prompt);
      const { data } = await this.ask(
        `Answer the user using relevant saved records. State clearly when records do not contain an answer. Cite titles in prose and return the exact supporting record IDs in recordIds. Do not invent memories. Conversation: ${JSON.stringify(history)}\nRetrieved records (subset of the library): ${JSON.stringify(context)}`,
        { schema: "chat" },
      );
      const citations = [...new Set(data.recordIds)].filter((ref) =>
        context.some((r) => r.id === ref),
      );
      if (this.store.get("SELECT id FROM conversations WHERE id=?", id))
        this.store.run(
          "INSERT INTO messages VALUES(?,?,?,?,?,?)",
          randomUUID(),
          id,
          "assistant",
          text(data.answer),
          JSON.stringify(citations),
          now(),
        );
      return id;
    } catch (e) {
      e.message = `${e.message} Your message has been saved.`;
      throw e;
    } finally {
      this.chatBusy.delete(id);
      this.changed();
    }
  }
  async generateGuide(id) {
    if (this.busy.has(id)) return;
    const g = this.store.get("SELECT * FROM guides WHERE id=?", id);
    if (!g) return;
    this.busy.add(id);
    this.store.run(
      "UPDATE guides SET status='processing',error='' WHERE id=?",
      id,
    );
    this.changed();
    try {
      const result = await this.ask(
        `Build a learning guide for: ${g.topic}. Use live web search to find reliable primary sources. ${g.technical ? "This is technical: use Context7 MCP resolve-library-id and query-docs for current official library documentation as well as web search. If Context7 is unavailable, continue with official web documentation and disclose this in a card." : ""} Return 6 to 10 concise, progressive Twitter-style cards, each with a title and 50 to 100 words, a practical idea or example, and source links to pages actually consulted. Begin with foundations and end with a practical exercise. Do not fabricate sources.`,
        { schema: "learning", research: true, technical: !!g.technical },
      );
      if (!Array.isArray(result.data.cards) || !result.data.cards.length)
        throw new Error("No learning cards were returned. Retry generation.");
      if (!result.provenance.web)
        throw new Error(
          "No completed web search was observed. Retry to generate a guide with verified web research.",
        );
      if (!this.store.get("SELECT id FROM guides WHERE id=?", id)) return;
      this.store.transaction(() => {
        this.store.run("DELETE FROM cards WHERE guide_id=?", id);
        result.data.cards.slice(0, 15).forEach((card, i) => {
          const sources = card.sources.filter((s) =>
            /^https?:\/\//i.test(s.url),
          );
          this.store.run(
            "INSERT INTO cards(id,guide_id,position,title,body,sources) VALUES(?,?,?,?,?,?)",
            randomUUID(),
            id,
            i,
            text(card.title, 250),
            text(card.body, 12000),
            JSON.stringify(sources),
          );
        });
        this.store.run(
          "UPDATE guides SET status='ready',provenance=? WHERE id=?",
          JSON.stringify(result.provenance),
          id,
        );
      });
    } catch (e) {
      this.store.run(
        "UPDATE guides SET status='error',error=? WHERE id=?",
        e.message,
        id,
      );
    } finally {
      this.busy.delete(id);
      this.changed();
    }
  }
}
module.exports = { BrainService };
