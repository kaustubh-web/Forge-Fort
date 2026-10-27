import { describe, it, expect } from "vitest";
import { timeAgo } from "@/lib/time";

const now = new Date("2026-10-27T12:00:00Z").getTime();
const ago = (ms) => new Date(now - ms).toISOString();

describe("timeAgo", () => {
  it("formats recent times", () => {
    expect(timeAgo(ago(10_000), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5m ago");
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe("2d ago");
  });
});
