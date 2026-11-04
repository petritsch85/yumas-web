import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

/** Amex: page 1 is the Abrechnung; the pages behind it only list its transactions. */
export async function firstPage(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (src.getPageCount() <= 1) return bytes;
  const out = await PDFDocument.create();
  const [p] = await out.copyPages(src, [0]);
  out.addPage(p);
  return out.save();
}

/**
 * The Webshop Monatsbericht goes into the folder without its order lists.
 *
 * The summary per restaurant carries the figures the Steuerberater needs; the
 * Einzelbestellungen behind it are pages of single orders. The whole report
 * stays stored as uploaded, only the printed copy is cut. A report with no such
 * section, or nothing before it, is left whole rather than guessed at.
 */
const HEADING = /einzelbestellungen/i;

export async function webshopSummary(bytes: Uint8Array): Promise<Uint8Array> {
  const { text } = await extractText(await getDocumentProxy(bytes.slice()));
  const at = text.findIndex(t => HEADING.test(t));
  if (at < 0) return bytes;
  /* A heading partway down its page shares that page with the summary, which stays. */
  const keep = /^\s*einzelbestellungen/i.test(text[at]) ? at : at + 1;
  if (keep === 0) return bytes;
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, Array.from({ length: keep }, (_, i) => i))) out.addPage(p);
  return out.save();
}
