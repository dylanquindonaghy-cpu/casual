import { createHash } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { UPLOAD_MAX_STORED_BYTES } from "../db/schema";
import { WEB_IMPORT_MAX_BYTES } from "../office/import-limits";

// A photo or certificate image as it arrives (docs/office-v2.md 5.5; D3; 12F.2). The phone has
// already made it a JPEG of 1,600px at most (src/app/profile/upload-form.tsx), but nothing from a
// phone is trusted:
// - its real type is read from its first bytes, never its name or the browser's word: JPEG, PNG
//   or WebP only (no SVG, PDF, HEIC or anything else);
// - more than UPLOAD_MAX_BYTES is refused before it's decoded (Next's server-action body limit is
//   1 MB, the same room as the web import's);
// - it's decoded with a pixel limit (a small file can claim a huge picture), turned upright from
//   its orientation tag, and re-encoded by sharp as a JPEG of 1,600px at most. Re-encoding keeps
//   only the pixels: location (GPS), camera details, comments and every other tag are dropped;
// - the result is checked against the stored limit (1 MB, uploads_size_check) and fingerprinted
//   (sha256, the fingerprint the exports carry).
// No face matching and no reading of the text on a card, ever (docs/compliance.md).

export const UPLOAD_MAX_BYTES = WEB_IMPORT_MAX_BYTES;
export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_MAX_PIXELS = 40_000_000;
const JPEG_QUALITY = 82;

export type ImageType = "jpeg" | "png" | "webp";

const startsWith = (bytes: Uint8Array, at: number, sig: readonly number[]) =>
  bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);

// The type from the first bytes (the "magic number"), or null for anything else.
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // "RIFF", four bytes of length, "WEBP".
  if (
    startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "webp";
  }
  return null;
}

export type CleanImage =
  | { status: "ok"; data: Buffer; size: number; sha256: string; width: number; height: number }
  | { status: "empty" | "too_big" | "not_an_image" };

export async function cleanImage(bytes: Uint8Array): Promise<CleanImage> {
  if (bytes.length === 0) return { status: "empty" };
  if (bytes.length > UPLOAD_MAX_BYTES) return { status: "too_big" };
  const type = sniffImageType(bytes);
  if (!type) return { status: "not_an_image" };
  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(bytes, { failOn: "error", limitInputPixels: IMAGE_MAX_PIXELS })
      .rotate()
      .resize({
        width: IMAGE_MAX_SIDE,
        height: IMAGE_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch {
    // Not decodable as what its first bytes say, broken, or too many pixels.
    return { status: "not_an_image" };
  }
  if (out.data.length > UPLOAD_MAX_STORED_BYTES) return { status: "too_big" };
  return {
    status: "ok",
    data: out.data,
    size: out.data.length,
    sha256: createHash("sha256").update(out.data).digest("hex"),
    width: out.info.width,
    height: out.info.height,
  };
}
