import { extractText, getDocumentProxy } from "unpdf";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 8000;

export type PdfOutcome = { ok: true; text: string } | { ok: false; reason: "too-large" | "empty" | "parse-error" };

export async function extractPdfText(bytes: Uint8Array): Promise<PdfOutcome> {
  if (bytes.byteLength > MAX_PDF_BYTES) return { ok: false, reason: "too-large" };
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const joined = (Array.isArray(text) ? text.join(" ") : String(text)).trim();
    if (!joined) return { ok: false, reason: "empty" };
    return { ok: true, text: joined.slice(0, MAX_TEXT_CHARS) };
  } catch (err) {
    console.error("[agent] PDF extract failed:", err);
    return { ok: false, reason: "parse-error" };
  }
}
