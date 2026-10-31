import type { ReactNode } from "react";
import { textLink } from "./classes";

// Words with their links back to the firm's own address made tappable (the Demo phone, 16.1; the
// casual's Messages, Phase 25.6): anything else stays text, so a link someone typed elsewhere can't
// pass for the firm's. A full stop or comma right after a link ends the sentence, not the link.
// Hook-free, imports nothing from src/lib.
// `wrap`: how a long link breaks: anywhere (the Demo phone's cards), or only where it must, so a
// link that fits on its own line goes whole to the next (a chat bubble).
export function withLinks(
  body: string,
  linkOrigin: string,
  wrap: "anywhere" | "as_needed" = "anywhere",
): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    const start = match.index;
    if (start > last) parts.push(body.slice(last, start));
    let ours = false;
    try {
      ours = new URL(url).origin === linkOrigin;
    } catch {
      ours = false;
    }
    parts.push(
      ours ? (
        <a
          key={start}
          href={url}
          className={`${textLink} ${wrap === "anywhere" ? "break-all" : "[overflow-wrap:anywhere]"} font-semibold`}
        >
          {url}
        </a>
      ) : (
        url
      ),
    );
    last = start + url.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}
