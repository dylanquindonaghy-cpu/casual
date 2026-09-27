import { maskText, redact } from "./mask";

// Structured logging: one JSON object per line, personal data masked (see mask.ts).
// Web requests carry a requestId (set by src/proxy.ts); jobs carry jobId, queue and firmId.

export type Level = "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

export type Write = (line: string, level: Level) => void;

const defaultWrite: Write = (line, level) => {
  (level === "info" ? process.stdout : process.stderr).write(`${line}\n`);
};

export function createLogger(
  options: { write?: Write; bindings?: Fields; now?: () => Date } = {},
): Logger {
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  const emit = (level: Level, msg: string, fields: Fields = {}) => {
    const extra = redact({ ...bindings, ...fields }) as Fields;
    // ts, level and msg always come first and can't be overwritten by fields.
    for (const key of ["ts", "level", "msg"]) delete extra[key];
    write(JSON.stringify({ ts: now().toISOString(), level, msg: maskText(msg), ...extra }), level);
  };

  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (more) => createLogger({ write, now, bindings: { ...bindings, ...more } }),
  };
}

export const log: Logger = createLogger();
