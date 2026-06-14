import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ totalPages: 2, text: ["Hello ", "world"] })),
}));
import { extractPdfText } from "./docs";
import { extractText } from "unpdf";

afterEach(() => vi.restoreAllMocks());

describe("extractPdfText", () => {
  it("joins page text and returns it", async () => {
    const r = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("Hello");
  });
  it("rejects oversize input without parsing", async () => {
    const r = await extractPdfText(new Uint8Array(10 * 1024 * 1024 + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-large");
  });
  it("returns empty when the PDF has no extractable text", async () => {
    vi.mocked(extractText).mockResolvedValueOnce({ totalPages: 1, text: ["  ", ""] } as never);
    const r = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });
  it("returns parse-error when unpdf throws", async () => {
    vi.mocked(extractText).mockRejectedValueOnce(new Error("corrupt pdf"));
    const r = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse-error");
  });
  it("truncates very long extracted text to the cap", async () => {
    vi.mocked(extractText).mockResolvedValueOnce({ totalPages: 1, text: ["x".repeat(20000)] } as never);
    const r = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text.length).toBeLessThanOrEqual(8000);
  });
});
