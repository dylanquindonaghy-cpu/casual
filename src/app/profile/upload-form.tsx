"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { muted, staffBtn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { isOnline } from "@/lib/portal/copy";
import { sendUploadText, type SendUploadOutcome } from "@/lib/portal/upload-copy";
import { WEB_IMPORT_MAX_BYTES } from "@/lib/office/import-limits";
import { sendUploadAction } from "./upload-actions";

// "Upload a new photo" / "Take or choose a photo" (docs/office-v2.md 4.6, 5.5; 12F.2): one tap opens
// the camera (the front one for a staff photo) or the phone's photos. The phone makes the picture a
// JPEG of 1,600px at most before sending it, so it stays under the 1 MB limit; the server checks
// and re-encodes it anyway (src/lib/uploads/image.ts). A picture the phone can't read is sent as it
// is, for the server to answer. Waits for the page (docs/ui-design.md "Forms wait for the page").

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
  const busy = pending || !ready;

  const send = (file: File) =>
    startTransition(async () => {
      if (!isOnline()) {
        setMessage({ text: sendUploadText({ status: "no_signal" }), ok: false });
        return;
      }
      const picture = await shrink(file);
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
      if (result.status === "sent") router.refresh();
    });

  return (
    <div className="mt-4">
      <p className={muted} id={`${id}-guidance`}>
        {guidance}
      </p>
      {/* The label is the button: a tap opens the camera or photos. The input stays focusable. */}
      <label
        className={`${staffBtn.secondary} mt-3 cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:outline-offset-2`}
      >
        {pending ? "Sending…" : button}
        <input
          type="file"
          accept="image/*"
          capture={camera}
          className="sr-only"
          aria-describedby={`${id}-guidance`}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // the same picture can be chosen again
            if (file) send(file);
          }}
        />
      </label>
      <p
        role="status"
        className={`mt-3 text-base ${message && !message.ok ? "font-semibold text-urgent-ink" : ""}`}
      >
        {message?.text}
      </p>
    </div>
  );
}
