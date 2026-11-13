"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import type { AnswerChannel } from "@/lib/answers/switches";
import {
  answerSwitchResultText,
  channelSwitchResultText,
  type AnswerSwitchResult,
  type ChannelSwitchResult,
} from "@/lib/office/answers-copy";
import { SwitchTrack } from "../../events/showing-switch";
import { resultBox } from "../../shifts/shift-tones";
import { setChannelSwitchAction, switchAnswerAction } from "./actions";

// Automatic answers' switches (Phase 35.3): a button with the switch role, 44px square, its track
// and knob as Events & sessions' "show to casuals" switch (../../events/showing-switch.tsx): green
// when on, grey when off. Its name says what it switches; the answer to a press stays under it
// (golden rule 11), and the page reads its data again. Waits for the page (docs/ui-design.md
// "Forms wait for the page").

function SwitchButton({
  on,
  label,
  disabled,
  onFlip,
  describedBy,
}: {
  on: boolean;
  label: string;
  disabled: boolean;
  onFlip: () => void;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onFlip}
      className="press relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
    >
      <SwitchTrack on={on} />
    </button>
  );
}

const failed = { status: "error" as const };

// One of the three channels: its switch, its name and how many it answered, and the answer.
export function ChannelSwitch({
  channel,
  on,
  label,
  line,
}: {
  channel: AnswerChannel;
  on: boolean;
  label: string; // "App messages"
  line: string; // "41 answered in the last 7 days"
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const flip = () =>
    startTransition(async () => {
      const result: ChannelSwitchResult = await setChannelSwitchAction(channel, !on).catch(
        () => failed,
      );
      setMessage(channelSwitchResultText(channel, result));
      if (result.status === "saved" || result.status === "unchanged") router.refresh();
    });
  return (
    <div className="flex flex-col gap-2" data-channel={channel}>
      <div className="flex items-center gap-3">
        <SwitchButton
          on={on}
          label={`Answer ${label.toLowerCase()} automatically`}
          disabled={pending || !ready}
          onFlip={flip}
        />
        <p className="min-w-0">
          <span className="font-semibold">{label}</span>{" "}
          <span className="text-sm text-ink-muted">· {line}</span>
        </p>
      </div>
      {message && (
        <p role="status" className={`${resultBox} self-start text-sm`}>
          {message}
        </p>
      )}
    </div>
  );
}

// An answer's own switch, beside its name. `canGo`: whether the firm's answers can go by any
// channel (answersCanGo, w1-06); its words say so when they can't.
export function AnswerSwitch({
  id,
  name,
  on,
  canGo,
}: {
  id: string;
  name: string;
  on: boolean;
  canGo: boolean;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const flip = () =>
    startTransition(async () => {
      const result: AnswerSwitchResult = await switchAnswerAction(id, !on).catch(() => failed);
      setMessage(answerSwitchResultText(name, result, canGo));
      if (result.status === "switched" || result.status === "unchanged") router.refresh();
    });
  return (
    <>
      <SwitchButton on={on} label={`Use “${name}”`} disabled={pending || !ready} onFlip={flip} />
      {message && (
        <p role="status" className={`${resultBox} basis-full text-sm`}>
          {message}
        </p>
      )}
    </>
  );
}
