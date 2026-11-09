"use client";

import { useEffect, useRef, useState } from "react";
import { btn } from "../ui/classes";

// The tours' welcome window (Phase 33.2; docs/screens.md "## Phase 33"): the tour's short video in
// a native modal dialog over the page (the whole screen on a phone), its words, then "Start the
// walkthrough", "Skip the video" and "Not now". The video is muted with its captions on: it plays
// by itself only muted (never with less motion asked for), and its sound comes on only when the
// person asks ("Turn the sound on", or the player's own button). Until it can play (no file yet,
// a browser that can't play it) its space shows its first words instead, never a broken picture.
// Esc is "Not now". Shared by the office's tour and the casuals' (33.3, `shape="tall"`).

export interface WelcomeCopy {
  title: string;
  intro: string;
  posterTop: string;
  posterBottom: string;
  videoLabel: string;
  soundOn: string;
  start: string;
  skipVideo: string;
  notNow: string;
}

export function TourWelcome({
  copy,
  video,
  shape = "wide",
  onStart,
  onNotNow,
}: {
  copy: WelcomeCopy;
  video: { src: string; poster: string; captions: string };
  shape?: "wide" | "tall"; // the casuals' video is portrait (9:16)
  onStart: () => void; // the walkthrough (after the video, or skipping it)
  onNotNow: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const [plays, setPlays] = useState(false); // the file loaded and can be shown
  const [muted, setMuted] = useState(true);
  const tall = shape === "tall";

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    const v = player.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    for (const t of v.textTracks) t.mode = "showing";
    if (v.canPlayType("video/mp4") === "") return;
    const ok = () => setPlays(true);
    const volume = () => setMuted(v.muted);
    v.addEventListener("loadeddata", ok);
    v.addEventListener("volumechange", volume);
    if (v.readyState >= 2) ok();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      void v.play().catch(() => undefined);
    return () => {
      v.removeEventListener("loadeddata", ok);
      v.removeEventListener("volumechange", volume);
      v.pause();
    };
  }, []);

  const leave = (then: () => void) => {
    player.current?.pause();
    dialog.current?.close();
    then();
  };

  return (
    <dialog
      ref={dialog}
      data-tour-welcome=""
      aria-labelledby="tour-welcome-title"
      onCancel={(e) => {
        e.preventDefault();
        leave(onNotNow);
      }}
      data-shape={shape}
      className={`glass-float m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto p-4 text-base text-ink backdrop:bg-scrim/60 sm:m-auto sm:h-fit sm:max-h-[calc(100dvh-2rem)] sm:max-w-[calc(100vw-2rem)] sm:rounded-card sm:p-6 ${tall ? "sm:w-184" : "sm:w-160"}`}
    >
      <div className={`flex flex-col gap-4 ${tall ? "sm:flex-row sm:items-center sm:gap-6" : ""}`}>
        {/* A portrait video (the casuals') is drawn 9:16 at a height that leaves room for the
            words and buttons: above them on a phone, beside them from 640px. */}
        <div
          data-tour-video=""
          className={`glass-tile relative grid shrink-0 place-items-center overflow-hidden rounded-card ${tall ? "aspect-[9/16] h-[min(54dvh,34rem)] max-w-full self-center sm:h-[min(70dvh,35rem)]" : "aspect-video w-full"}`}
        >
          {/* The video's first words: what shows until it plays. */}
          <p
            data-tour-poster=""
            className="flex flex-col items-center p-6 text-center text-3xl leading-tight font-semibold text-ink"
          >
            <span>{copy.posterTop}</span>
            <span className="text-on-hivis">{copy.posterBottom}</span>
          </p>
          <video
            ref={player}
            aria-label={copy.videoLabel}
            poster={video.poster}
            controls
            playsInline
            muted
            preload="metadata"
            hidden={!plays}
            className="absolute inset-0 size-full object-contain"
          >
            <source src={video.src} type="video/mp4" onError={() => setPlays(false)} />
            <track default kind="captions" srcLang="en" label="English" src={video.captions} />
          </video>
          {plays && muted && (
            <button
              type="button"
              onClick={() => {
                const v = player.current;
                if (!v) return;
                v.muted = false;
                void v.play().catch(() => undefined);
              }}
              className={`${btn.secondary} absolute top-3 right-3`}
            >
              {copy.soundOn}
            </button>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <h2 id="tour-welcome-title" className="text-2xl font-semibold text-ink">
            {copy.title}
          </h2>
          <p className="text-ink-muted">{copy.intro}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => leave(onStart)} className={btn.primary}>
              {copy.start}
            </button>
            <button type="button" onClick={() => leave(onStart)} className={btn.secondary}>
              {copy.skipVideo}
            </button>
            <span aria-hidden="true" className="flex-1" />
            <button type="button" onClick={() => leave(onNotNow)} className={btn.text}>
              {copy.notNow}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
