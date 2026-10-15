import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { UPLOAD_MAX_STORED_BYTES } from "@/lib/db/schema";
import { cleanImage, IMAGE_MAX_SIDE, sniffImageType, UPLOAD_MAX_BYTES } from "@/lib/uploads/image";

// Photo and certificate images on the server (12F.2; docs/office-v2.md 5.5): the type from the
// first bytes, the size limit, and re-encoding that keeps the pixels and drops location data.

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } });

// A JPEG carrying a camera's tags, its location (GPS) among them, and an orientation.
const withLocation = () =>
  picture(800, 600)
    .jpeg()
    .withExif({
      IFD0: { Make: "Phone Maker", Model: "Phone 1", Copyright: "made-up" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "53/1 48/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "1/1 33/1 0/1",
      },
    })
    .toBuffer();

describe("the type comes from the first bytes", () => {
  it("JPEG, PNG and WebP", async () => {
    expect(sniffImageType(await picture(4, 4).jpeg().toBuffer())).toBe("jpeg");
    expect(sniffImageType(await picture(4, 4).png().toBuffer())).toBe("png");
    expect(sniffImageType(await picture(4, 4).webp().toBuffer())).toBe("webp");
  });

  it("nothing else, whatever it's called", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImageType(await picture(4, 4).gif().toBuffer())).toBeNull();
    expect(sniffImageType(await picture(4, 4).tiff().toBuffer())).toBeNull();
    expect(sniffImageType(enc("%PDF-1.7\n"))).toBeNull();
    expect(sniffImageType(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(enc("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImageType(enc("RIFF\0\0\0\0WAVE"))).toBeNull(); // RIFF, but sound
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull(); // too short
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("a file that isn't what its first bytes say is refused", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    expect(await cleanImage(fake)).toEqual({ status: "not_an_image" });
    expect(await cleanImage(Buffer.from("<html>not a picture</html>"))).toEqual({
      status: "not_an_image",
    });
    expect(await cleanImage(await picture(20, 20).gif().toBuffer())).toEqual({
      status: "not_an_image",
    });
    expect(await cleanImage(new Uint8Array())).toEqual({ status: "empty" });
  });
});

describe("the size limit", () => {
  it("is under 1 MB, and the stored limit is 1 MB", () => {
    expect(UPLOAD_MAX_BYTES).toBeLessThan(1_000_000);
    expect(UPLOAD_MAX_STORED_BYTES).toBe(1_000_000);
  });

  it("refuses one byte over before reading it, and takes a picture under it", async () => {
    const over = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(UPLOAD_MAX_BYTES - 2),
    ]);
    expect(over.length).toBe(UPLOAD_MAX_BYTES + 1);
    expect(await cleanImage(over)).toEqual({ status: "too_big" });
    const fine = await picture(1200, 900).jpeg({ quality: 90 }).toBuffer();
    expect(fine.length).toBeLessThan(UPLOAD_MAX_BYTES);
    expect((await cleanImage(fine)).status).toBe("ok");
  });

  it("refuses a small file that claims a huge picture", async () => {
    const huge = await sharp({
      create: { width: 8000, height: 6000, channels: 3, background: "white" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(huge.length).toBeLessThan(UPLOAD_MAX_BYTES);
    expect(await cleanImage(huge)).toEqual({ status: "not_an_image" });
  });
});

describe("re-encoded by the server", () => {
  it("location data and the camera's tags are gone", async () => {
    const sent = await withLocation();
    const before = await sharp(sent).metadata();
    expect(before.exif?.includes(Buffer.from("Phone Maker"))).toBe(true);
    const result = await cleanImage(sent);
    if (result.status !== "ok") throw new Error(result.status);
    const after = await sharp(result.data).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(result.data.includes(Buffer.from("Exif"))).toBe(false);
    expect(result.data.includes(Buffer.from("Phone Maker"))).toBe(false);
    expect(result.data.includes(Buffer.from("GPS"))).toBe(false);
  });

  it("always a JPEG, 1,600px at most on its longest side, never enlarged", async () => {
    const wide = await cleanImage(await picture(2400, 1000).png().toBuffer());
    if (wide.status !== "ok") throw new Error(wide.status);
    expect(sniffImageType(wide.data)).toBe("jpeg");
    expect([wide.width, wide.height]).toEqual([IMAGE_MAX_SIDE, 667]);
    const meta = await sharp(wide.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1600, 667]);
    const small = await cleanImage(await picture(300, 400).webp().toBuffer());
    if (small.status !== "ok") throw new Error(small.status);
    expect([small.width, small.height]).toEqual([300, 400]);
  });

  it("turned upright from its orientation tag before the tag goes", async () => {
    const sideways = await picture(800, 600).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);
    const result = await cleanImage(sideways);
    if (result.status !== "ok") throw new Error(result.status);
    expect([result.width, result.height]).toEqual([600, 800]);
    expect((await sharp(result.data).metadata()).orientation).toBeUndefined();
  });

  it("fingerprinted: the sha256 of what's stored", async () => {
    const { createHash } = await import("node:crypto");
    const result = await cleanImage(await picture(50, 50).png().toBuffer());
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.sha256).toBe(createHash("sha256").update(result.data).digest("hex"));
    expect(result.size).toBe(result.data.length);
  });
});
