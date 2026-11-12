export type Link = { id: string; title: string; reason: string };
export type Memory = {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  images: string[];
  status: string;
  error: string;
  created_at: string;
  links: Link[];
};
export type Schedule = {
  kind: string;
  minutes?: number | null;
  time?: string | null;
  day?: number | null;
  at?: string | null;
};
export type Task = {
  id: string;
  title: string;
  command: string;
  schedule: Schedule;
  enabled: number;
  running: number;
  next_run: string | null;
};
export type Run = {
  id: string;
  task_id: string;
  status: string;
  output: string;
  started_at: string;
  finished_at: string;
};
export type Card = {
  id: string;
  title: string;
  body: string;
  sources: { title: string; url: string }[];
  done: number;
};
export type Guide = {
  id: string;
  topic: string;
  technical: number;
  status: string;
  error: string;
  provenance: { web?: boolean; context7?: boolean };
  cards: Card[];
  created_at: string;
};
export type Conversation = { id: string; title: string };
export type Message = {
  id: string;
  role: string;
  content: string;
  citations: string[];
};
export type Snapshot = {
  records: Memory[];
  tasks: Task[];
  runs: Run[];
  guides: Guide[];
  conversations: Conversation[];
  settings: { codexPath: string; model: string };
  models: { id: string; name: string }[];
  system: {
    shortcuts: Record<string, boolean>;
    shortcutBackend: string;
    shortcutError: string;
    platform: string;
    dataPath: string;
  };
};
declare global {
  interface Window {
    brain: Record<string, (...args: any[]) => Promise<any>> & {
      onFontAdjust: (callback: (direction: number) => void) => () => void;
      onChange: (callback: () => void) => () => void;
      onNotice: (callback: (message: string) => void) => () => void;
    };
  }
}
