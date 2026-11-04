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
 * Monthly reports go into the folder without their lists of single orders.
 *
 * What the Steuerberater needs comes first — the Webshop's summary per
 * restaurant; Too Good To Go's overview and invoice, three pages in both months
 * so far — and the orders follow under a heading of their own. Cutting at that
 * heading rather than at a page count keeps a longer invoice whole. The full
 * report stays stored as uploaded, only the printed copy is cut. A report with
 * no such section, or nothing before it, is left whole rather than guessed at.
 */
const ORDER_LISTS: Record<string, string> = {
  webshop: 'einzelbestellungen',
  toogoodtogo: 'bestellübersicht',
};

export const hasOrderLists = (key: string) => key in ORDER_LISTS;

export async function withoutOrderLists(key: string, bytes: Uint8Array): Promise<Uint8Array> {
  const heading = ORDER_LISTS[key];
  if (!heading) return bytes;
  const { text } = await extractText(await getDocumentProxy(bytes.slice()));
  const at = text.findIndex(t => t.toLowerCase().includes(heading));
  if (at < 0) return bytes;
  /* A heading partway down its page shares that page with the summary, which stays. */
  const keep = text[at].trim().toLowerCase().startsWith(heading) ? at : at + 1;
  if (keep === 0) return bytes;
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, Array.from({ length: keep }, (_, i) => i))) out.addPage(p);
  return out.save();
}
