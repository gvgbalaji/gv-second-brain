import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Brain,
  Layers,
  CalendarClock,
  MessageCircle,
  BookOpen,
  Plus,
  Search,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Settings,
  Minus,
  X,
  Trash2,
  Pencil,
  Link2,
  ImagePlus,
  Clipboard,
  Send,
  Play,
  Pause,
  RefreshCw,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Command,
  Loader2,
  Grip,
  MoreHorizontal,
  FolderOpen,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type {
  Snapshot,
  Memory,
  Task,
  Schedule,
  Guide,
  Card,
  Message,
  Run,
} from "./types";
import "./style.css";
const api = window.brain;
const date = (v: string) =>
  new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const datetime = (v: string | null) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Completed";
function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) void api.openExternal(href);
              }}
            >
              {children}
              <ExternalLink size={12} />
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
function IconButton({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const el = ref.current;
    const focusable = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, [tabindex="0"]',
        ) || [],
      ).filter((v) => !v.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (
        Array.from(document.querySelectorAll(".modal")).at(-1) !== ref.current
      )
        return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const all = focusable(),
          first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Brain;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={30} />
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
function Bubble() {
  return (
    <div className="bubble-shell">
      <button
        className="brain-bubble"
        aria-label="Open or collapse Second Brain. Drag to move. Right-click for the quit menu."
        title="Second Brain · Click to open · Drag to move · Right-click to quit"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          void api.beginBubbleDrag();
        }}
        onPointerUp={() => {
          void api.endBubbleDrag(true);
        }}
        onPointerCancel={() => {
          void api.endBubbleDrag(false);
        }}
        onLostPointerCapture={() => {
          void api.endBubbleDrag(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void api.toggle();
          }
        }}
      >
        <Brain size={25.6} strokeWidth={1.6} />
        <span className="bubble-dot" />
      </button>
    </div>
  );
}
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Workspace error:", error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <div className="loading" role="alert">
          <Brain size={36} />
          <h1>The workspace ran into a problem</h1>
          <p>Your saved records and conversations are still available.</p>
          <button
            className="primary"
            onClick={() => this.setState({ error: null })}
          >
            Reopen workspace
          </button>
        </div>
      );
    return this.props.children;
  }
}
function App() {
  const [data, setData] = useState<Snapshot | null>(null),
    [tab, setTab] = useState("Records"),
    [query, setQuery] = useState(""),
    [fontPoints, setFontPoints] = useState(() => {
      const saved = localStorage.getItem("brain.fontPoints");
      const value = saved === null ? 3 : Number(saved);
      return Number.isFinite(value) ? Math.min(12, Math.max(0, value)) : 3;
    }),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => localStorage.getItem("brain.sidebarCollapsed") === "true",
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [editing, setEditing] = useState<Memory | "new" | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [taskEdit, setTaskEdit] = useState<Task | "new" | null>(null),
    [settings, setSettings] = useState(false),
    [guideNew, setGuideNew] = useState(false),
    [guideId, setGuideId] = useState<string | null>(null),
    [cardEdit, setCardEdit] = useState<Card | null>(null),
    [conversationId, setConversationId] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [chatText, setChatText] = useState(""),
    [chatting, setChatting] = useState(false),
    [run, setRun] = useState<Run | null>(null),
    [renameGuide, setRenameGuide] = useState<Guide | null>(null),
    [confirm, setConfirm] = useState<{
      title: string;
      action: () => Promise<any>;
    } | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    localStorage.setItem("brain.fontPoints", String(fontPoints));
  }, [fontPoints]);
  useEffect(
    () =>
      api.onFontAdjust((direction) =>
        setFontPoints((current) =>
          Math.min(12, Math.max(0, current + direction)),
        ),
      ),
    [],
  );
  useEffect(() => {
    localStorage.setItem("brain.sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        ["+", "=", "-"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        setFontPoints((current) =>
          Math.min(12, Math.max(0, current + (event.key === "-" ? -1 : 1))),
        );
        return;
      }
      if (
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        event.stopPropagation();
        setSidebarCollapsed((value) => !value);
        return;
      }
      const section = (
        {
          "1": "Records",
          "2": "Chat",
          "3": "Scheduler",
          "4": "Learning guide",
        } as Record<string, string>
      )[event.key];
      if (section) {
        event.preventDefault();
        event.stopPropagation();
        setTab(section);
        setQuery("");
        setSelected(null);
      }
    };
    window.addEventListener("keydown", shortcuts, true);
    return () => window.removeEventListener("keydown", shortcuts, true);
  }, []);
  const refresh = useCallback(async () => {
    try {
      setData(await api.snapshot());
    } catch (e) {
      setNotice(String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const off = api.onChange(() => void refresh()),
      offNotice = api.onNotice(setNotice);
    return () => {
      off();
      offNotice();
    };
  }, [refresh]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 9000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    let active = true;
    if (conversationId) {
      void api
        .messages(conversationId)
        .then((result) => {
          if (active) setMessages(result);
        })
        .catch((error) => {
          if (active) setNotice((error as Error).message);
        });
    } else setMessages([]);
    return () => {
      active = false;
    };
  }, [conversationId, data]);
  useEffect(() => {
    // Chromium can return a Promise here. React effects must only return a cleanup function.
    void chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatting]);
  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (e) {
      setNotice((e as Error).message);
      return undefined;
    } finally {
      setBusy("");
    }
  };
  const records = (data?.records || []).filter((r) =>
    [r.title, r.content, r.summary, ...r.tags]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const record = data?.records.find((r) => r.id === selected);
  const guide = data?.guides.find((g) => g.id === guideId);
  useEffect(() => {
    if (!selected) return;
    const listener = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        ) ||
        editing ||
        confirm
      )
        return;
      const index = records.findIndex((r) => r.id === selected);
      if (e.key === "ArrowRight" && index < records.length - 1)
        setSelected(records[index + 1].id);
      if (e.key === "ArrowLeft" && index > 0)
        setSelected(records[index - 1].id);
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [selected, records, editing, confirm]);
  const navigate = (name: string) => {
    setTab(name);
    setQuery("");
    setSelected(null);
  };
  const remove = (title: string, action: () => Promise<any>) =>
    setConfirm({ title, action });
  const send = async (prompt = chatText) => {
    if (!prompt.trim() || chatting) return;
    setChatText("");
    setChatting(true);
    try {
      const id = await api.chat(conversationId, prompt);
      setConversationId(id);
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
      setChatText(prompt);
      await refresh();
    } finally {
      setChatting(false);
    }
  };
  if (!data)
    return (
      <div className="loading">
        <Loader2 className="spin" />
        Opening your brain…{notice && <p>{notice}</p>}
      </div>
    );
  const activeTasks = data.tasks.filter((t) => t.enabled).length,
    linkCount = data.records.reduce((n, r) => n + r.links.length, 0) / 2;
  const titles: Record<string, string> = {
    Records: "A little less to remember.",
    Scheduler: "Make room for what matters.",
    Chat: "Think out loud.",
    "Learning guide": "Follow your curiosity.",
  };
  return (
    <div
      className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      style={{ "--font-increase": `${fontPoints}pt` } as React.CSSProperties}
    >
      <aside
        className="sidebar"
        id="workspace-sidebar"
        aria-label="Workspace sidebar"
      >
        <div className="brand">
          <div className="brand-icon">
            <Brain size={24} />
          </div>
          <div>
            second brain<span>A SPACE FOR YOUR MIND</span>
          </div>
        </div>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {[
            { name: "Records", icon: Layers, count: data.records.length },
            { name: "Chat", icon: MessageCircle, count: null },
            { name: "Scheduler", icon: CalendarClock, count: activeTasks },
            {
              name: "Learning guide",
              icon: BookOpen,
              count: data.guides.length,
            },
          ].map(({ name, icon: Icon, count }, index) => (
            <button
              key={name}
              title={`${name} · Ctrl+${index + 1}`}
              aria-label={`${name} (Ctrl+${index + 1})`}
              aria-keyshortcuts={`Control+${index + 1}`}
              className={`nav-item ${tab === name ? "active" : ""}`}
              onClick={() => navigate(name)}
              aria-current={tab === name ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{name}</span>
              {count !== null && <small>{count}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-orbit">
            <Brain size={26} />
            <span />
            <i />
          </div>
          <h3>Your mind, connected.</h3>
          <p>Capture a thought. Find a connection. Keep growing.</p>
          <div className="local-label">
            <span className="green-dot" />
            Stored on this device
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className="settings-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => setSettings(true)}
          >
            <Settings size={18} />{" "}
            <span className="settings-label">Settings</span>{" "}
            <span className="settings-key">⌘</span>
          </button>
          <div className="profile">
            <span>GV</span>
            <div>
              Personal workspace<small>Powered by Codex</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button sidebar-toggle"
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              title={
                sidebarCollapsed
                  ? "Expand sidebar · Ctrl+E"
                  : "Collapse sidebar · Ctrl+E"
              }
              aria-expanded={!sidebarCollapsed}
              aria-controls="workspace-sidebar"
              aria-keyshortcuts="Control+E"
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={19} />
              ) : (
                <PanelLeftClose size={19} />
              )}
            </button>
            <Brain size={15} />
            <span>My workspace</span>
            <ChevronRight size={14} />
            <strong>{tab}</strong>
          </div>
          <div className="window-actions">
            <label className="model-selector">
              Model
              <select
                aria-label="Codex model"
                value={data.settings.model}
                disabled={busy === "model"}
                onChange={(e) =>
                  void act("model", () => api.setModel(e.target.value))
                }
              >
                {data.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                {!data.models.some((m) => m.id === data.settings.model) && (
                  <option value={data.settings.model}>
                    {data.settings.model}
                  </option>
                )}
              </select>
            </label>
            <span className="keyboard-hint">Ctrl + ? to tuck away</span>
            <IconButton
              label="Collapse to brain bubble"
              onClick={() => void api.collapse()}
            >
              <Minus size={18} />
            </IconButton>
          </div>
        </header>
        <main className={tab === "Chat" ? "chat-main" : ""}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {tab === "Records"
                  ? "CAPTURE. CONNECT. RECALL."
                  : tab === "Scheduler"
                    ? "A LITTLE HELP FROM YOUR FUTURE SELF"
                    : tab === "Chat"
                      ? "A CONVERSATION WITH YOUR KNOWLEDGE"
                      : "ONE IDEA AT A TIME"}
              </div>
              <h1>{tab}</h1>
              <p>{titles[tab]}</p>
            </div>
            {tab === "Records" ? (
              <button className="primary" onClick={() => setEditing("new")}>
                <Plus size={17} />
                New record
              </button>
            ) : tab === "Scheduler" ? (
              <button className="primary" onClick={() => setTaskEdit("new")}>
                <Plus size={17} />
                New task
              </button>
            ) : tab === "Learning guide" ? (
              <button className="primary" onClick={() => setGuideNew(true)}>
                <Plus size={17} />
                Explore a topic
              </button>
            ) : (
              <button
                className="secondary"
                disabled={chatting}
                onClick={() => {
                  setConversationId(null);
                  setMessages([]);
                }}
              >
                <Plus size={16} />
                New conversation
              </button>
            )}
          </div>
          {tab === "Records" && (
            <>
              <div className="stats">
                <div>
                  <span className="stat-icon lavender">
                    <Layers size={20} />
                  </span>
                  <div>
                    <strong>{data.records.length}</strong>
                    <span>Saved records</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon peach">
                    <Link2 size={20} />
                  </span>
                  <div>
                    <strong>{linkCount}</strong>
                    <span>Connections made</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon mint">
                    <Sparkles size={20} />
                  </span>
                  <div>
                    <strong>
                      {data.records.filter((r) => r.status === "ready").length}
                    </strong>
                    <span>Thoughts understood</span>
                  </div>
                </div>
                <div className="capture-tip">
                  <Command size={18} />
                  <p>
                    A thought worth keeping?
                    <br />
                    <span>
                      Select text anywhere. Press <kbd>Ctrl + &gt;</kbd>
                    </span>
                  </p>
                </div>
              </div>
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search records"
                    placeholder="Find a thought, topic, or connection…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <IconButton
                      label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={15} />
                    </IconButton>
                  )}
                </div>
                <button
                  className="secondary"
                  onClick={() => void act("capture", () => api.capture())}
                >
                  <Clipboard size={16} />
                  Capture clipboard
                </button>
                <span className="count-label">{records.length} records</span>
              </div>
              {records.length ? (
                <div className="record-grid">
                  {records.map((r, i) => (
                    <button
                      className="record-card"
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                    >
                      <div className="record-card-top">
                        <span className={`record-symbol color-${i % 4}`}>
                          <Layers size={18} />
                        </span>
                        <span>{date(r.created_at)}</span>
                        <ArrowUpRight size={16} />
                      </div>
                      <h2>{r.title}</h2>
                      <p>
                        {r.summary ||
                          r.content ||
                          "An image worth remembering."}
                      </p>
                      <div className="tags">
                        {r.tags.slice(0, 3).map((t) => (
                          <span key={t}>#{t}</span>
                        ))}
                        {r.images.length > 0 && (
                          <span>
                            <ImagePlus size={12} />
                            {r.images.length} image
                            {r.images.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <div className="record-card-bottom">
                        <span>
                          {r.status === "processing" ? (
                            <>
                              <Loader2 size={13} className="spin" />
                              Understanding…
                            </>
                          ) : r.status === "error" ? (
                            <>
                              <RefreshCw size={13} />
                              Needs a retry
                            </>
                          ) : (
                            <>
                              <Link2 size={13} />
                              {r.links.length} connection
                              {r.links.length !== 1 ? "s" : ""}
                            </>
                          )}
                        </span>
                        <span>
                          Open record <ArrowRight size={13} />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={Layers}
                  title={
                    query ? "No matching thoughts" : "Give your thoughts a home"
                  }
                  body={
                    query
                      ? "Try another word or clear your search."
                      : "Save a note, paste an image, or capture a selection. Your brain will find the connections."
                  }
                  action={
                    !query && (
                      <button
                        className="primary"
                        onClick={() => setEditing("new")}
                      >
                        <Plus size={17} />
                        Save your first record
                      </button>
                    )
                  }
                />
              )}
              <div className="page-foot">
                <span>
                  <CheckCircle2 size={14} />
                  Your thoughts stay with you. Saved locally in SQLite.
                </span>
                <span>Small thoughts. Bigger picture.</span>
              </div>
            </>
          )}
          {tab === "Scheduler" && (
            <>
              <div className="info-strip">
                <CalendarClock size={20} />
                <div>
                  <strong>A rhythm for your ideas</strong>
                  <p>
                    Schedule a Codex prompt by interval, day, or a specific
                    time. Results are saved here.
                  </p>
                </div>
                <span>{activeTasks} active</span>
              </div>
              <div className="section-row">
                <h2>
                  Your tasks <small>{data.tasks.length}</small>
                </h2>
                <span>
                  Runs while Second Brain is open ·{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </span>
              </div>
              {data.tasks.length ? (
                <div className="task-list">
                  {data.tasks.map((t) => (
                    <article className="task-card" key={t.id}>
                      <div className={`task-glyph ${t.enabled ? "" : "muted"}`}>
                        <CalendarClock size={23} />
                      </div>
                      <div className="task-description">
                        <div>
                          <h3>{t.title}</h3>
                          <span
                            className={`status ${t.running ? "working" : t.enabled ? "" : "paused"}`}
                          >
                            {t.running
                              ? "Running"
                              : t.enabled
                                ? "Active"
                                : "Paused"}
                          </span>
                        </div>
                        <p>{t.command}</p>
                        <span>
                          <Clock size={13} />
                          {scheduleLabel(t.schedule)} · Next:{" "}
                          {datetime(t.next_run)}
                        </span>
                        {data.runs
                          .filter((r) => r.task_id === t.id)
                          .slice(0, 1)
                          .map((r) => (
                            <button
                              className="text-button run-link"
                              key={r.id}
                              onClick={() => setRun(r)}
                            >
                              Last run: {r.status} · {datetime(r.started_at)}{" "}
                              <ArrowUpRight size={13} />
                            </button>
                          ))}
                      </div>
                      <div className="task-actions">
                        <IconButton
                          label="Run now"
                          disabled={!!t.running}
                          onClick={() =>
                            void act(t.id, () => api.runTask(t.id))
                          }
                        >
                          <Play size={16} />
                        </IconButton>
                        <IconButton
                          label={t.enabled ? "Pause task" : "Resume task"}
                          onClick={() =>
                            void act("task", () => api.toggleTask(t.id))
                          }
                        >
                          {t.enabled ? <Pause size={16} /> : <Play size={16} />}
                        </IconButton>
                        <IconButton
                          label="Edit task"
                          onClick={() => setTaskEdit(t)}
                        >
                          <Pencil size={16} />
                        </IconButton>
                        <IconButton
                          label="Delete task"
                          onClick={() =>
                            remove(
                              "Delete this task and its run history?",
                              () => api.deleteTask(t.id),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={CalendarClock}
                  title="Let your brain take the next step"
                  body="Try “Summarize my recent notes every Friday at 5 pm” or set an interval yourself."
                  action={
                    <button
                      className="primary"
                      onClick={() => setTaskEdit("new")}
                    >
                      <Plus size={17} />
                      Schedule a task
                    </button>
                  }
                />
              )}
              <div className="section-row">
                <h2>Run history</h2>
              </div>
              {data.runs.length ? (
                <div className="history-list">
                  {data.runs.map((r) => (
                    <button key={r.id} onClick={() => setRun(r)}>
                      <span
                        className={`status ${r.status === "error" ? "error" : ""}`}
                      >
                        {r.status}
                      </span>
                      <strong>
                        {data.tasks.find((t) => t.id === r.task_id)?.title ||
                          "Task"}
                      </strong>
                      <span>{datetime(r.started_at)}</span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted-text">
                  Completed results and errors will appear here.
                </p>
              )}
            </>
          )}
          {tab === "Chat" && (
            <div className="chat-layout">
              <aside className="conversation-list">
                <div className="workspace-label">CONVERSATIONS</div>
                {data.conversations.length ? (
                  data.conversations.map((c) => (
                    <div
                      key={c.id}
                      className={
                        conversationId === c.id ? "selected-conversation" : ""
                      }
                    >
                      <button
                        disabled={chatting}
                        onClick={() => setConversationId(c.id)}
                      >
                        <MessageCircle size={15} />
                        <span>{c.title}</span>
                      </button>
                      <IconButton
                        label="Delete conversation"
                        disabled={chatting}
                        onClick={() =>
                          remove("Delete this conversation?", async () => {
                            await api.deleteConversation(c.id);
                            if (c.id === conversationId)
                              setConversationId(null);
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  ))
                ) : (
                  <p className="muted-text">Your conversations live here.</p>
                )}
              </aside>
              <div className="chat-panel">
                <div className="chat-messages">
                  {!messages.length ? (
                    <div className="chat-welcome">
                      <div className="welcome-brain">
                        <Brain size={38} />
                      </div>
                      <h2>What’s on your mind?</h2>
                      <p>
                        Ask a question. Connect a few dots.
                        <br />
                        Your saved knowledge is part of the conversation.
                      </p>
                      <div className="suggestions">
                        {[
                          "What have I been thinking about recently?",
                          "Find connections across my records",
                          "Help me turn my notes into next steps",
                        ].map((p) => (
                          <button
                            disabled={chatting}
                            key={p}
                            onClick={() => void send(p)}
                          >
                            {p}
                            <ArrowUpRight size={15} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((m) => (
                      <article className={`message ${m.role}`} key={m.id}>
                        <div className="message-avatar">
                          {m.role === "user" ? "GV" : <Brain size={18} />}
                        </div>
                        <div>
                          <strong>
                            {m.role === "user" ? "You" : "Second Brain"}
                          </strong>
                          <Markdown>{m.content}</Markdown>
                          {m.citations.length > 0 && (
                            <div className="citation-list">
                              {m.citations.map((id) => {
                                const r = data.records.find((r) => r.id === id);
                                return r ? (
                                  <button
                                    key={id}
                                    onClick={() => {
                                      setTab("Records");
                                      setSelected(id);
                                    }}
                                  >
                                    <Layers size={12} />
                                    {r.title}
                                    <ArrowUpRight size={12} />
                                  </button>
                                ) : null;
                              })}
                            </div>
                          )}
                        </div>
                      </article>
                    ))
                  )}
                  {chatting && (
                    <div className="thinking">
                      <Loader2 className="spin" size={16} />
                      Connecting your thoughts…
                    </div>
                  )}
                  <div ref={chatEnd} />
                </div>
                <form
                  className="chat-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    aria-label="Message your second brain"
                    placeholder="Ask your second brain…"
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    className="primary send"
                    aria-label="Send message"
                    disabled={chatting || !chatText.trim()}
                  >
                    <Send size={18} />
                  </button>
                </form>
                <div className="chat-disclaimer">
                  Answers draw from relevant saved records · Shift + Enter for a
                  new line
                </div>
              </div>
            </div>
          )}
          {tab === "Learning guide" && (
            <>
              {guide ? (
                <>
                  <button
                    className="text-button back"
                    onClick={() => setGuideId(null)}
                  >
                    <ArrowLeft size={15} />
                    All learning guides
                  </button>
                  <div className="guide-header">
                    <div>
                      <h2>{guide.topic}</h2>
                      <p>
                        {guide.cards.filter((c) => c.done).length} of{" "}
                        {guide.cards.length} ideas explored ·{" "}
                        {date(guide.created_at)}
                      </p>
                      <div className="tags">
                        <span>
                          {guide.technical
                            ? "Technical topic"
                            : "General topic"}
                        </span>
                        <span>
                          {guide.provenance.web
                            ? "Web researched"
                            : "Awaiting web research"}
                        </span>
                        {!!guide.technical && (
                          <span>
                            {guide.provenance.context7
                              ? "Context7 consulted"
                              : "Context7 not confirmed"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="actions">
                      <IconButton
                        label="Rename guide"
                        onClick={() => setRenameGuide(guide)}
                      >
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton
                        label="Regenerate guide"
                        disabled={guide.status === "processing"}
                        onClick={() =>
                          void act("guide", () => api.retryGuide(guide.id))
                        }
                      >
                        <RefreshCw size={16} />
                      </IconButton>
                      <IconButton
                        label="Delete guide"
                        onClick={() =>
                          remove(
                            "Delete this guide and all its cards?",
                            async () => {
                              await api.deleteGuide(guide.id);
                              setGuideId(null);
                            },
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                  {guide.status === "processing" && (
                    <div className="info-strip">
                      <Loader2 className="spin" size={20} />
                      <p>
                        Researching sources and building your learning cards.
                        You can come back anytime.
                      </p>
                    </div>
                  )}
                  {guide.error && (
                    <div className="error-box">
                      {guide.error}
                      <button
                        onClick={() =>
                          void act("guide", () => api.retryGuide(guide.id))
                        }
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  <div className="learning-feed">
                    {guide.cards.map((c, i) => (
                      <article
                        className={`learning-card ${c.done ? "completed" : ""}`}
                        key={c.id}
                      >
                        <div className="feed-line">
                          <span className="feed-avatar">
                            <Brain size={20} />
                          </span>
                          <div>
                            <strong>
                              Second Brain <CheckCircle2 size={13} />
                            </strong>
                            <span>
                              {guide.topic} · {i + 1}/{guide.cards.length}
                            </span>
                          </div>
                          <span className="card-number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                        </div>
                        <div className="learning-content">
                          <h3>{c.title}</h3>
                          <Markdown>{c.body}</Markdown>
                          <div className="source-list">
                            {c.sources.map((s, j) => (
                              <button
                                key={j}
                                onClick={() => void api.openExternal(s.url)}
                              >
                                <ExternalLink size={12} />
                                {s.title || new URL(s.url).hostname}
                              </button>
                            ))}
                          </div>
                          <div className="learning-actions">
                            <button
                              className={c.done ? "learned" : ""}
                              onClick={() =>
                                void act("card", () =>
                                  api.saveCard({ ...c, done: !c.done }),
                                )
                              }
                            >
                              <CheckCircle2 size={16} />
                              {c.done ? "Explored" : "Mark as explored"}
                            </button>
                            <IconButton
                              label="Edit card"
                              onClick={() => setCardEdit(c)}
                            >
                              <Pencil size={15} />
                            </IconButton>
                            <IconButton
                              label="Delete card"
                              onClick={() =>
                                remove("Delete this learning card?", () =>
                                  api.deleteCard(c.id),
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="learning-intro">
                    <div>
                      <span className="eyebrow">A SMALL STEP, EVERY DAY</span>
                      <h2>Big topics. Bite-sized ideas.</h2>
                      <p>
                        Pick a topic. Get a trail of clear, useful cards,
                        <br />
                        researched from the web and ready when you are.
                      </p>
                      <button
                        className="primary"
                        onClick={() => setGuideNew(true)}
                      >
                        What do you want to learn? <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="intro-illustration">
                      <div>
                        <BookOpen size={38} />
                        <span>Stay curious.</span>
                      </div>
                      <i />
                      <b />
                    </div>
                  </div>
                  <div className="section-row">
                    <h2>
                      Your learning shelf <small>{data.guides.length}</small>
                    </h2>
                    <span>Pick up where you left off</span>
                  </div>
                  {data.guides.length ? (
                    <div className="guide-grid">
                      {data.guides.map((g) => (
                        <button
                          className="guide-tile"
                          key={g.id}
                          onClick={() => setGuideId(g.id)}
                        >
                          <span className="stat-icon peach">
                            <BookOpen size={22} />
                          </span>
                          <span className="eyebrow">
                            {g.technical ? "TECHNOLOGY" : "EXPLORATION"}
                          </span>
                          <h3>{g.topic}</h3>
                          <p>
                            {g.status === "processing"
                              ? "Researching your topic…"
                              : g.status === "error"
                                ? "Needs a retry"
                                : `${g.cards.length} ideas to explore`}
                          </p>
                          <div className="progress">
                            <span
                              style={{
                                width: `${g.cards.length ? (g.cards.filter((c) => c.done).length / g.cards.length) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <div className="tile-foot">
                            <span>
                              {g.cards.filter((c) => c.done).length} explored
                            </span>
                            <ArrowUpRight size={17} />
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={BookOpen}
                      title="Your next rabbit hole starts here"
                      body="From distributed systems to the history of jazz. Keep what you learn, one card at a time."
                    />
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <IconButton
            label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </IconButton>
        </div>
      )}
      {editing && (
        <RecordEditor
          record={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          busy={busy === "save-record"}
          onSave={async (input) => {
            const id = await act("save-record", () => api.saveRecord(input));
            if (id) {
              setEditing(null);
              setSelected(id);
            }
          }}
        />
      )}
      {record && !editing && (
        <Modal title="Your record" wide onClose={() => setSelected(null)}>
          <div className="record-detail">
            <div className="detail-meta">
              <span>{date(record.created_at)}</span>
              <span className="status">{record.status}</span>
              <div className="actions">
                <IconButton
                  label="Edit record"
                  onClick={() => setEditing(record)}
                >
                  <Pencil size={16} />
                </IconButton>
                <IconButton
                  label="Delete record"
                  onClick={() =>
                    remove(
                      "Delete this record and its connections?",
                      async () => {
                        await api.deleteRecord(record.id);
                        setSelected(null);
                      },
                    )
                  }
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </div>
            <h1>{record.title}</h1>
            <div className="tags">
              {record.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
            {record.summary && (
              <div className="summary">
                <Sparkles size={17} />
                <p>{record.summary}</p>
              </div>
            )}
            {record.error && (
              <div className="error-box">
                {record.error}
                <button
                  onClick={() =>
                    void act("retry", () => api.retryRecord(record.id))
                  }
                >
                  Retry understanding
                </button>
              </div>
            )}
            <Markdown>{record.content}</Markdown>
            <div className="record-images">
              {record.images.map((image) => (
                <StoredImage name={image} key={image} />
              ))}
            </div>
            <div className="connections">
              <h3>
                <Link2 size={16} />
                Connected thoughts <span>{record.links.length}</span>
              </h3>
              {record.links.length ? (
                record.links.map((l) => (
                  <button key={l.id} onClick={() => setSelected(l.id)}>
                    <Layers size={17} />
                    <div>
                      <strong>{l.title}</strong>
                      <p>{l.reason}</p>
                    </div>
                    <ArrowUpRight size={16} />
                  </button>
                ))
              ) : (
                <p className="muted-text">
                  Related records will appear here as your brain grows.
                </p>
              )}
            </div>
            <div className="record-nav">
              <button
                className="secondary"
                disabled={records.findIndex((r) => r.id === record.id) <= 0}
                onClick={() =>
                  setSelected(
                    records[records.findIndex((r) => r.id === record.id) - 1]
                      .id,
                  )
                }
              >
                <ArrowLeft size={15} />
                Previous
              </button>
              <span>Use ← → to explore</span>
              <button
                className="secondary"
                disabled={
                  records.findIndex((r) => r.id === record.id) < 0 ||
                  records.findIndex((r) => r.id === record.id) >=
                    records.length - 1
                }
                onClick={() =>
                  setSelected(
                    records[records.findIndex((r) => r.id === record.id) + 1]
                      .id,
                  )
                }
              >
                Next
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {taskEdit && (
        <TaskEditor
          task={taskEdit === "new" ? undefined : taskEdit}
          onClose={() => setTaskEdit(null)}
          onSave={async (input) => {
            const id = await act("save-task", () => api.saveTask(input));
            if (id) setTaskEdit(null);
          }}
          onError={setNotice}
        />
      )}
      {settings && (
        <SettingsDialog
          data={data}
          onClose={() => setSettings(false)}
          onSave={async (input) => {
            await act("settings", () => api.settings(input));
            setSettings(false);
          }}
        />
      )}
      {guideNew && (
        <GuideEditor
          onClose={() => setGuideNew(false)}
          onSave={async (input) => {
            const id = await act("guide", () => api.newGuide(input));
            if (id) {
              setGuideId(id);
              setGuideNew(false);
            }
          }}
        />
      )}
      {renameGuide && (
        <RenameGuide
          guide={renameGuide}
          onClose={() => setRenameGuide(null)}
          onSave={async (topic) => {
            await act("rename", () => api.renameGuide(renameGuide.id, topic));
            setRenameGuide(null);
          }}
        />
      )}
      {cardEdit && (
        <CardEditor
          card={cardEdit}
          onClose={() => setCardEdit(null)}
          onSave={async (c) => {
            await act("card", () => api.saveCard(c));
            setCardEdit(null);
          }}
        />
      )}
      {run && (
        <Modal title="Task result" wide onClose={() => setRun(null)}>
          <div className="form-body">
            <p className="muted-text">
              {datetime(run.started_at)} · {run.status}
            </p>
            <Markdown>
              {data.runs.find((r) => r.id === run.id)?.output ||
                run.output ||
                "Task is running…"}
            </Markdown>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal title="Delete entry" onClose={() => setConfirm(null)}>
          <div className="form-body">
            <p>{confirm.title}</p>
            <div className="form-actions">
              <button className="secondary" onClick={() => setConfirm(null)}>
                Keep it
              </button>
              <button
                className="danger"
                onClick={() =>
                  void act("delete", confirm.action).then(() =>
                    setConfirm(null),
                  )
                }
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function StoredImage({ name }: { name: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    void api
      .image(name)
      .then((v) => {
        if (live) setSrc(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [name]);
  return src ? (
    <img src={src} alt="Attached record image" />
  ) : (
    <span className="muted-text">Loading image…</span>
  );
}
function RecordEditor({
  record,
  onClose,
  onSave,
  busy,
}: {
  record?: Memory;
  onClose: () => void;
  onSave: (input: any) => Promise<void>;
  busy: boolean;
}) {
  const [title, setTitle] = useState(record?.title || ""),
    [content, setContent] = useState(record?.content || ""),
    [images, setImages] = useState<string[]>(record?.images || []),
    [pendingImages, setPendingImages] = useState(0),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setPendingImages((value) => value + 1);
    try {
      if (files.length + images.length > 6)
        throw new Error("Attach up to 6 images.");
      const converted = await Promise.all(
        files.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              if (!file.type.startsWith("image/"))
                return reject(new Error("Please select an image."));
              if (file.size > 10000000)
                return reject(new Error("Images must be under 10 MB."));
              const image = new Image(),
                url = URL.createObjectURL(file);
              image.onload = () => {
                try {
                  const canvas = document.createElement("canvas");
                  const ratio = Math.min(
                    1,
                    2400 / Math.max(image.naturalWidth, image.naturalHeight),
                  );
                  canvas.width = Math.max(
                    1,
                    Math.round(image.naturalWidth * ratio),
                  );
                  canvas.height = Math.max(
                    1,
                    Math.round(image.naturalHeight * ratio),
                  );
                  const context = canvas.getContext("2d");
                  if (!context)
                    throw new Error(
                      "Could not prepare the image. Please try again.",
                    );
                  context.drawImage(image, 0, 0, canvas.width, canvas.height);
                  resolve(canvas.toDataURL("image/png"));
                } catch (error) {
                  reject(error);
                } finally {
                  URL.revokeObjectURL(url);
                }
              };
              image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Could not read that image."));
              };
              image.src = url;
            }),
        ),
      );
      setImages((prev) => [...prev, ...converted].slice(0, 6));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPendingImages((value) => value - 1);
    }
  };
  return (
    <Modal
      title={record ? "Edit record" : "Capture a thought"}
      onClose={onClose}
    >
      <form
        className="form-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pendingImages && !busy)
            void onSave({ id: record?.id, title, content, images });
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
      >
        <p className="form-intro">
          A note, an idea, a screenshot. Your brain will make the connections.
        </p>
        <label>
          Title <span>(optional)</span>
          <input
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give this thought a name"
          />
        </label>
        <label>
          Your thought
          <textarea
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Start writing, or paste an image…"
            maxLength={100000}
          />
        </label>
        <div className="attachment-row">
          <button
            type="button"
            className="secondary"
            disabled={pendingImages > 0}
            onClick={() => input.current?.click()}
          >
            <ImagePlus size={16} />
            Add image
          </button>
          <span aria-live="polite">
            {pendingImages ? "Reading image…" : "Paste images with Ctrl + V"}
          </span>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </div>
        <div className="image-previews">
          {images.map((image, i) => (
            <div key={i}>
              {image.startsWith("data:") ? (
                <img src={image} alt={`Attachment ${i + 1}`} />
              ) : (
                <StoredImage name={image} />
              )}
              <IconButton
                label="Remove image"
                onClick={() => setImages(images.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </IconButton>
            </div>
          ))}
        </div>
        {error && <p className="error-box">{error}</p>}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              busy || pendingImages > 0 || (!content.trim() && !images.length)
            }
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            Save & connect
          </button>
        </div>
      </form>
    </Modal>
  );
}
function scheduleLabel(s: Schedule) {
  if (s.kind === "interval")
    return `Every ${s.minutes} minute${s.minutes === 1 ? "" : "s"}`;
  if (s.kind === "once") return `Once · ${datetime(s.at || null)}`;
  if (s.kind === "daily") return `Daily at ${s.time}`;
  return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.day || 0]} at ${s.time}`;
}
function TaskEditor({
  task,
  onClose,
  onSave,
  onError,
}: {
  task?: Task;
  onClose: () => void;
  onSave: (input: any) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(task?.title || ""),
    [command, setCommand] = useState(task?.command || ""),
    [schedule, setSchedule] = useState<Schedule>(
      task?.schedule || {
        kind: "interval",
        minutes: 60,
        time: "09:00",
        day: 1,
        at: "",
      },
    ),
    [prompt, setPrompt] = useState(""),
    [parsing, setParsing] = useState(false),
    [saving, setSaving] = useState(false),
    [parsed, setParsed] = useState(false);
  const change = (key: string, value: any) =>
    setSchedule({ ...schedule, [key]: value });
  return (
    <Modal
      title={task ? "Edit scheduled task" : "Schedule a task"}
      onClose={onClose}
    >
      <form
        className="form-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave({ id: task?.id, title, command, schedule });
          setSaving(false);
        }}
      >
        <div className="prompt-box">
          <label>
            Describe your schedule
            <input
              placeholder="e.g. Review my notes every Friday at 5 pm"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!prompt.trim() || parsing}
            onClick={async () => {
              setParsing(true);
              try {
                const result = await api.parseSchedule(prompt);
                setTitle(result.title);
                setCommand(result.command);
                setSchedule(result.schedule);
                setParsed(true);
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setParsing(false);
              }
            }}
          >
            {parsing ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            Set from prompt
          </button>
          {parsed && (
            <small>Schedule filled in. Review the details, then save.</small>
          )}
        </div>
        <label>
          Task name
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weekly reflection"
          />
        </label>
        <label>
          What should your brain do?
          <textarea
            required
            rows={4}
            maxLength={20000}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Summarize my recent records and suggest next steps."
          />
        </label>
        <div className="form-columns">
          <label>
            Repeat
            <select
              value={schedule.kind}
              onChange={(e) => change("kind", e.target.value)}
            >
              <option value="interval">At an interval</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="once">Just once</option>
            </select>
          </label>
          {schedule.kind === "interval" && (
            <label>
              Interval in minutes
              <input
                type="number"
                min={1}
                max={525600}
                required
                value={schedule.minutes ?? 60}
                onChange={(e) => change("minutes", Number(e.target.value))}
              />
            </label>
          )}
          {["daily", "weekly"].includes(schedule.kind) && (
            <label>
              Time
              <input
                required
                type="time"
                value={schedule.time ?? "09:00"}
                onChange={(e) => change("time", e.target.value)}
              />
            </label>
          )}
          {schedule.kind === "weekly" && (
            <label>
              Day
              <select
                value={schedule.day ?? 1}
                onChange={(e) => change("day", Number(e.target.value))}
              >
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((d, i) => (
                  <option value={i} key={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          {schedule.kind === "once" && (
            <label>
              Date and time
              <input
                required
                type="datetime-local"
                value={schedule.at ? localDatetime(schedule.at) : ""}
                onChange={(e) =>
                  change(
                    "at",
                    e.target.value
                      ? new Date(e.target.value).toISOString()
                      : "",
                  )
                }
              />
            </label>
          )}
        </div>
        <p className="muted-text">
          Uses this device’s timezone. Missed recurring runs execute once when
          the app reopens. Commands produce saved Codex responses.
        </p>
        <div className="form-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving || parsing}>
            {saving ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <CalendarClock size={16} />
            )}
            Save schedule
          </button>
        </div>
      </form>
    </Modal>
  );
}
function localDatetime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function GuideEditor({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: any) => Promise<void>;
}) {
  const [topic, setTopic] = useState(""),
    [technical, setTechnical] = useState(false),
    [saving, setSaving] = useState(false);
  return (
    <Modal title="Follow a new curiosity" onClose={onClose}>
      <form
        className="form-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave({ topic, technical });
          setSaving(false);
        }}
      >
        <p className="form-intro">
          A topic becomes a collection of small, useful ideas with sources you
          can follow.
        </p>
        <label>
          What would you like to learn?
          <input
            required
            maxLength={500}
            placeholder="e.g. Building reliable distributed systems"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              if (
                /react|python|typescript|programming|javascript|api|sql|rust|docker|kubernetes|code|software|distributed|machine learning/i.test(
                  e.target.value,
                )
              )
                setTechnical(true);
            }}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={technical}
            onChange={(e) => setTechnical(e.target.checked)}
          />
          <div>
            Technical topic
            <span>Consult Context7 for current library documentation.</span>
          </div>
        </label>
        <div className="info-strip">
          <BookOpen size={20} />
          <p>
            Researched from the web. Saved on your device. Ready to explore at
            your pace.
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving || !topic.trim()}>
            <Sparkles size={16} />
            Create learning guide
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RenameGuide({
  guide,
  onClose,
  onSave,
}: {
  guide: Guide;
  onClose: () => void;
  onSave: (topic: string) => Promise<void>;
}) {
  const [topic, setTopic] = useState(guide.topic);
  return (
    <Modal title="Rename learning guide" onClose={onClose}>
      <form
        className="form-body"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(topic);
        }}
      >
        <label>
          Guide name
          <input
            required
            maxLength={500}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save name</button>
        </div>
      </form>
    </Modal>
  );
}
function CardEditor({
  card,
  onClose,
  onSave,
}: {
  card: Card;
  onClose: () => void;
  onSave: (card: Card) => Promise<void>;
}) {
  const [title, setTitle] = useState(card.title),
    [body, setBody] = useState(card.body);
  return (
    <Modal title="Edit learning card" onClose={onClose}>
      <form
        className="form-body"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({ ...card, title, body });
        }}
      >
        <label>
          Title
          <input
            required
            value={title}
            maxLength={250}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Idea
          <textarea
            rows={10}
            required
            value={body}
            maxLength={12000}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button className="primary">Save card</button>
        </div>
      </form>
    </Modal>
  );
}
function SettingsDialog({
  data,
  onClose,
  onSave,
}: {
  data: Snapshot;
  onClose: () => void;
  onSave: (input: any) => Promise<void>;
}) {
  const [path, setPath] = useState(data.settings.codexPath),
    [model, setModel] = useState(data.settings.model),
    [customModel, setCustomModel] = useState(
      !data.models.some((m) => m.id === data.settings.model),
    ),
    [status, setStatus] = useState(""),
    [checking, setChecking] = useState(false);
  return (
    <Modal title="Your brain, your setup" onClose={onClose}>
      <form
        className="form-body"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({ codexPath: path, model });
        }}
      >
        <label>
          Codex executable
          <input
            value={path}
            placeholder="codex or /absolute/path/to/codex"
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <label>
          Default model
          <select
            value={customModel ? "__custom__" : model}
            onChange={(e) => {
              setCustomModel(e.target.value === "__custom__");
              setModel(e.target.value === "__custom__" ? "" : e.target.value);
            }}
          >
            {data.models.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
                {m.id === "gpt-6-luna" ? " · default" : ""}
              </option>
            ))}
            <option value="__custom__">Custom model ID…</option>
          </select>
        </label>
        {customModel && (
          <label>
            Custom model ID
            <input
              value={model}
              maxLength={200}
              placeholder="Enter a model supported by your Codex account"
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
        )}
        <p className="muted-text">
          Used for records, chat, scheduled tasks, and learning guides. Changes
          apply to new requests. Luna is the default.
        </p>
        <p className="muted-text">
          Uses your existing Codex login. Run <code>codex login</code> in a
          terminal to sign in. Save changes before checking the connection.
        </p>
        <button
          type="button"
          className="secondary"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            try {
              setStatus(await api.checkCodex());
            } catch (e) {
              setStatus((e as Error).message);
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? (
            <Loader2 className="spin" size={15} />
          ) : (
            <CheckCircle2 size={15} />
          )}
          Check saved connection
        </button>
        {status && (
          <p className="connection-status" role="status">
            {status}
          </p>
        )}
        <div className="settings-shortcuts">
          <h3>Workspace shortcuts</h3>
          <p>
            <span>Increase / decrease text size</span>
            <kbd>Ctrl++ / Ctrl+-</kbd>
          </p>
          <p>
            <span>Toggle sidebar</span>
            <kbd>Ctrl + E</kbd>
          </p>
          <p>
            <span>Records / Chat / Scheduler / Learning</span>
            <kbd>Ctrl + 1 / 2 / 3 / 4</kbd>
          </p>
          <small>Workspace shortcuts work while this app is focused.</small>
          <h3>Global shortcuts · {data.system.shortcutBackend}</h3>
          <p>
            <span>Expand / collapse</span>
            <kbd>Ctrl + Shift + /</kbd>
            <span>
              {data.system.shortcuts.toggle ? "Ready" : "Unavailable"}
            </span>
          </p>
          <p>
            <span>Capture selected text</span>
            <kbd>Ctrl + Shift + .</kbd>
            <span>
              {data.system.shortcuts.capture ? "Registered" : "Unavailable"}
            </span>
          </p>
          <small>
            Use Ctrl + Shift + / (Ctrl + ?) to toggle, and Ctrl + Shift + .
            (Ctrl + &gt;) to capture. GNOME desktop shortcuts work across native
            Wayland and X11 applications.
          </small>
          {data.system.shortcutError && (
            <p className="error-box">{data.system.shortcutError}</p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              try {
                await api.repairShortcuts();
                setStatus("Shortcut registration refreshed.");
              } catch (e) {
                setStatus((e as Error).message);
              }
            }}
          >
            <RefreshCw size={15} />
            Repair shortcuts
          </button>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void api.openData()}
        >
          <FolderOpen size={15} />
          Open local data folder
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void api.resetBubble()}
          style={{ marginLeft: 8 }}
        >
          <Brain size={15} />
          Show / reset bubble
        </button>
        <p className="data-path">{data.system.dataPath}</p>
        <div className="form-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => void api.quit()}
          >
            Quit Second Brain
          </button>
          <button className="primary">Save settings</button>
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(
  !api ? (
    <div className="loading">
      <Brain size={40} />
      <h1>Second Brain is a desktop app</h1>
      <p>
        Launch with <code>npm run dev</code> or <code>npm start</code> to
        connect to your local brain.
      </p>
    </div>
  ) : location.hash === "#bubble" ? (
    <Bubble />
  ) : (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  ),
);
