import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("includes Cairo date, plain-text rule, confirm-gate rule, and bilingual note", () => {
    const p = buildSystemPrompt(new Date("2026-06-14T12:00:00+03:00"));
    expect(p).toMatch(/Bistro Cloud/);
    expect(p).toMatch(/2026-06-14/); // injected Cairo date
    expect(p).toMatch(/confirm/i); // mutating tools need a tap
    expect(p).toMatch(/plain text/i); // no markdown
    expect(p).toMatch(/Arabic|English/i); // bilingual
  });

  it("renders the Cairo date even when the instant is a UTC day earlier", () => {
    // 2026-06-14T23:30Z is 2026-06-15 ~01:30 in Cairo (UTC+3) → must show the 15th.
    const p = buildSystemPrompt(new Date("2026-06-14T23:30:00Z"));
    expect(p).toMatch(/2026-06-15/);
  });
});
