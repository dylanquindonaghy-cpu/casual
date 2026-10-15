import type { UploadKind } from "../db/schema";
import { shortDate } from "../rules/reasons";
import type { PhotoStatus, StaffPhoto } from "../uploads/photo";

// Photos and certificate images in plain words (docs/office-v2.md 3.7, 4.6; 12F.2), for the
// casual's Profile and upload page and the office's Casuals pages. Pure, so the browser can use it.

// What she reads after sending one (src/lib/uploads/save.ts), and the page's own answers.
export type SendUploadOutcome =
  | { status: "sent"; kind: UploadKind }
  | { status: "empty" | "too_big" | "not_an_image" | "not_needed" | "not_active" }
  | { status: "logged_out" | "error" | "no_signal" };

export function sendUploadText(o: SendUploadOutcome): string {
  switch (o.status) {
    case "sent":
      return o.kind === "photo"
        ? "Sent. The office will check your photo."
        : "Sent. The office will check it.";
    case "empty":
      return "That file is empty. Try again.";
    case "too_big":
      return "That photo is too big. Take it again, or choose a smaller one.";
    case "not_an_image":
      return "We can't use that file. Take a photo, or choose a JPEG, PNG or WebP picture.";
    case "not_needed":
      return "You can't upload this one here. Ask the office.";
    case "not_active":
      return "You can't upload anything right now. Ask the office.";
    case "logged_out":
      return "Log in again to upload it.";
    case "no_signal":
      return "No signal. Try again when you have signal.";
    case "error":
      return "Something went wrong. Try again.";
  }
}

// One line of the SIA's photo guidance, under "Upload a new photo".
export const PHOTO_GUIDANCE =
  "Face the camera against a plain, light background, with nothing covering your face.";
// Under a certificate's upload.
export const CARD_GUIDANCE =
  "Take a clear photo of the front, with all four corners showing and nothing covering it.";

// The staff photo's status: in her words, and the office's.
export const PHOTO_WORDS: Record<PhotoStatus, string> = {
  up_to_date: "Up to date",
  due_soon: "Due soon",
  overdue: "Overdue",
  missing: "Missing",
  waiting: "Waiting for the office to check",
};
export const OFFICE_PHOTO_WORDS: Record<PhotoStatus, string> = {
  ...PHOTO_WORDS,
  waiting: "Waiting for check",
};
export const PHOTO_TONES: Record<PhotoStatus, "urgent" | "attention" | "done" | "quiet"> = {
  up_to_date: "done",
  due_soon: "attention",
  overdue: "urgent",
  missing: "attention",
  waiting: "quiet",
};

// "Last uploaded 3 Aug 2024 · renew by 3 Aug 2027", or that there isn't one yet.
export function photoDates(photo: StaffPhoto, year: number): string {
  if (!photo.current) return "No photo yet.";
  return `Last uploaded ${shortDate(photo.current.uploadedOn, year)} · renew by ${shortDate(
    photo.current.renewBy,
    year,
  )}`;
}

// What the office approves or rejects: "Staff photo", or the qualification's name.
export const uploadWhat = (kind: UploadKind, name: string | null) =>
  kind === "photo" ? "Staff photo" : (name ?? "Certificate");

// The office's check, answered in place (src/lib/uploads/check.ts).
export type CheckOutcome =
  | { status: "approved" | "rejected" | "recorded" | "not_waiting" | "invalid" }
  | { status: "date_passed" | "date_needed" | "not_confirmed" | "not_allowed" }
  | { status: "logged_out" | "error" };

export function checkText(o: CheckOutcome): string {
  switch (o.status) {
    case "approved":
      return "Approved. It counts from now.";
    case "rejected":
      return "Not accepted. They'll see why on their profile.";
    case "recorded":
      return "Recorded. It counts from now.";
    case "not_waiting":
      return "Someone has already checked this one.";
    case "invalid":
      return "Check the date (no more than 10 years ahead) and the number, then try again.";
    case "date_passed":
      return "That date has passed. Reject it as expired instead.";
    case "date_needed":
      return "Type the expiry date on the card, or tick that it has none.";
    case "not_confirmed":
      return "Confirm it's under your own CSAS scheme first.";
    case "not_allowed":
      return "You can't check uploads.";
    case "logged_out":
      return "Log in again to do this.";
    case "error":
      return "Something went wrong. Try again.";
  }
}

// The GOV.UK register for checking an SIA licence by hand (there's no official SIA API).
export const SIA_REGISTER_URL = "https://www.gov.uk/check-a-private-security-licence";
export const isSiaType = (type: string) => type.startsWith("SIA_");
