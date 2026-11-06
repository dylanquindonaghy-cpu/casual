"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { muted, staffBtn } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { useHydrated } from "@/app/use-hydrated";
import { isOnline } from "@/lib/portal/copy";
import { CHECK_PREVIEW, sendUploadText, type SendUploadOutcome } from "@/lib/portal/upload-copy";
import { WEB_IMPORT_MAX_BYTES } from "@/lib/office/import-limits";
import { sendUploadAction } from "./upload-actions";

// "Upload a new photo" / "Take or choose a photo" (docs/office-v2.md 4.6, 5.5; 12F.2; 28.11): one
// tap opens the camera (the front one for a staff photo) or the phone's photos. The picture then
// shows first, with "Send this photo" and "Take another": nothing leaves the phone until she sends
// it (28.11: a blurred or wrong picture went straight to the office's check). The picture is shown
// from the phone itself (an object URL: never sent, never cached, never in the copy kept for no
// signal) and let go once sent, replaced or left. On "Send this photo" the phone makes it a JPEG of
// 1,600px at most, so it stays under the 1 MB limit; the server checks and re-encodes it anyway
// (src/lib/uploads/image.ts). A picture the phone can't read is sent as it is, for the server to
// answer. A refusal keeps the picture there, to send again or take another. Waits for the page
// (docs/ui-design.md "Forms wait for the page").

const MAX_SIDE = 1600;
const failed = { status: "error" as const };

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.85),
    );
  } catch {
    return file;
  }
}

// The label is the button: a tap opens the camera or photos. The input stays focusable.
const pickButton = `${staffBtn.secondary} cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:outline-offset-2`;

export function UploadForm({
  kind,
  type,
  camera,
  button,
  guidance,
}: {
  kind: "photo" | "certificate";
  type?: string;
  camera: "user" | "environment";
  button: string;
  guidance: string;
}) {
  const router = useRouter();
  const id = useId();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  // The picture she chose, shown from the phone until she sends it.
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const shown = useRef<string | null>(null);
  const busy = pending || !ready;

  // Let the shown picture go: when it's replaced, sent, or the page is left.
  const show = (next: { file: File; url: string } | null) => {
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = next?.url ?? null;
    setPicked(next);
  };
  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );

  const choose = (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    show({ file, url: URL.createObjectURL(file) });
  };

  const send = () =>
    startTransition(async () => {
      if (!picked) return;
      if (!isOnline()) {
        setMessage({ text: sendUploadText({ status: "no_signal" }), ok: false });
        return;
      }
      const picture = await shrink(picked.file);
      if (picture.size > WEB_IMPORT_MAX_BYTES) {
        setMessage({ text: sendUploadText({ status: "too_big" }), ok: false });
        return;
      }
      const form = new FormData();
      form.set("kind", kind);
      if (type) form.set("type", type);
      form.set("file", picture, "picture");
      const result: SendUploadOutcome = await sendUploadAction(form).catch(() => failed);
      if (result.status === "logged_out") return router.replace("/login");
      setMessage({ text: sendUploadText(result), ok: result.status === "sent" });
      if (result.status === "sent") {
        show(null);
        router.refresh();
      }
    });

  // One file input, inside its label-button ("Upload a new photo", or "Take another").
  const input = (describedBy?: string) => (
    <input
      type="file"
      accept="image/*"
      capture={camera}
      className="sr-only"
      aria-describedby={describedBy}
      disabled={busy}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = ""; // the same picture can be chosen again
        choose(file);
      }}
    />
  );

  return (
    <div className="mt-4">
      {picked ? (
        <div data-preview="">
          <p id={`${id}-check`}>{CHECK_PREVIEW}</p>
          {/* From the phone itself (an object URL), so next/image has nothing to fetch. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={picked.url}
            alt="The photo you chose"
            className="glass-tile mt-3 max-h-80 w-full rounded-row object-contain"
          />
          <button
            type="button"
            disabled={busy}
            onClick={send}
            aria-describedby={`${id}-check`}
            className={`${staffBtn.primary} mt-3`}
          >
            {pending ? "Sending…" : "Send this photo"}
          </button>
          <label className={`${pickButton} mt-3`}>
            Take another
            {input()}
          </label>
        </div>
      ) : (
        <>
          <p className={muted} id={`${id}-guidance`}>
            {guidance}
          </p>
          <label className={`${pickButton} mt-3`}>
            {button}
            {input(`${id}-guidance`)}
          </label>
        </>
      )}
      {/* There from the start, so the answer is read out when it comes. */}
      <div role="status" className="mt-3">
        {message && (
          <Slip tone={message.ok ? "done" : "urgent"}>
            <p>{message.text}</p>
          </Slip>
        )}
      </div>
    </div>
  );
}
