import { describe, expect, it } from "vitest";
import { waitText } from "@/app/too-many-tries";

describe("how long to wait, in plain words", () => {
  it.each([
    [1, "1 minute"],
    [12, "12 minutes"],
    [59, "59 minutes"],
    [60, "1 hour"],
    [61, "2 hours"],
    [847, "15 hours"],
    [1440, "24 hours"],
  ])("%i minutes reads as '%s'", (minutes, text) => {
    expect(waitText(minutes)).toBe(text);
  });
});
