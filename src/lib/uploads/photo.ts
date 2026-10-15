import { daysUntil, EXPIRING_SOON_DAYS } from "../credentials/expiry";
import type { UploadStatus } from "../db/schema";

// A casual's staff photo (docs/office-v2.md 3.7, 4.6, 5.5; D3; 12F.2). Pure: her photo uploads and
// today in, the photo and its status out.
// - The current photo is the latest approved one. A waiting one never replaces it: it's shown, and
//   counts, only once a named office person approves it.
// - Renew by: photo.renewal_months (36, the SIA licence's three years) after the current one was
//   uploaded. "Due soon" from EXPIRING_SOON_DAYS (30) before that day, "Overdue" the day after it.
// - Status: Waiting for check while one she sent is waiting (her part is done; the office's is
//   not), otherwise Missing (none approved), Overdue, Due soon or Up to date.

export const PHOTO_RENEWAL_MONTHS = 36;

export type PhotoStatus = "up_to_date" | "due_soon" | "overdue" | "missing" | "waiting";

export interface PhotoUpload {
  id: string;
  status: UploadStatus;
  uploadedAt: Date; // the order they came in
  uploadedOn: string; // yyyy-mm-dd, the firm's calendar
}

export interface StaffPhoto {
  status: PhotoStatus;
  current: { id: string; uploadedOn: string; renewBy: string } | null;
  waiting: { id: string; uploadedOn: string } | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

// yyyy-mm-dd plus whole months; a day the month hasn't got becomes its last (29 Feb + 12 months is
// 28 Feb).
export function addMonths(day: string, months: number): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

const newest = (a: PhotoUpload, b: PhotoUpload) =>
  b.uploadedAt.getTime() - a.uploadedAt.getTime() || b.id.localeCompare(a.id);

export function staffPhoto(
  uploads: readonly PhotoUpload[],
  today: string,
  renewalMonths: number = PHOTO_RENEWAL_MONTHS,
): StaffPhoto {
  const approved = uploads.filter((u) => u.status === "approved").sort(newest)[0];
  const sent = uploads.filter((u) => u.status === "waiting").sort(newest)[0];
  const current = approved
    ? {
        id: approved.id,
        uploadedOn: approved.uploadedOn,
        renewBy: addMonths(approved.uploadedOn, renewalMonths),
      }
    : null;
  const waiting = sent ? { id: sent.id, uploadedOn: sent.uploadedOn } : null;
  const status: PhotoStatus = waiting
    ? "waiting"
    : !current
      ? "missing"
      : today > current.renewBy
        ? "overdue"
        : daysUntil(today, current.renewBy) <= EXPIRING_SOON_DAYS
          ? "due_soon"
          : "up_to_date";
  return { status, current, waiting };
}
