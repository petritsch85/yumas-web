import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * "Check Out": the month's whole folder as one PDF, in print order.
 *
 * Built in the browser from the plan the server hands out (GET
 * /api/month-folder?plan=1): a checklist page first, then the sections in the
 * order set under "Sequencing" — the Kontoauszug with every incoming invoice
 * filed behind the page its payment is on, the outgoing invoices, the monthly
 * statements. Whoever receives it presses print once.
 *
 * Documents arrive one at a time through signed links, so the size of the
 * month does not matter. A file that cannot be read is not skipped silently:
 * it is listed on a last page, so the gap shows on paper.
 */

type Part = {
  section: string; label: string;
  bucket?: string; path?: string;
  generated?: { kind: 'wolt-summary' | 'lieferando' | 'webshop'; store?: string };
  firstPageOnly?: boolean;
  behindPage?: number;
};
type Plan = { month: string; label: string; checklist: string; parts: Part[] };

const A4: [number, number] = [595.28, 841.89];

/* The standard fonts speak WinAnsi only; anything else becomes "?" rather than
   stopping the whole folder on one checkmark. */
const WIN_ANSI = /[^\x20-\x7E -ÿ€–—‘’‚“”„•…]/g;
const safe = (s: string) => s.replace(/\t/g, '  ').replace(WIN_ANSI, '?');

function textPages(out: PDFDocument, font: PDFFont, title: string, lines: string[]) {
  const size = 8, lh = 10.5, margin = 40;
  const perPage = Math.floor((A4[1] - 2 * margin - 24) / lh);
  const maxChars = 110;
  const wrapped = lines.flatMap(l => {
    const s = safe(l);
    if (s.length <= maxChars) return [s];
    const parts: string[] = [];
    for (let i = 0; i < s.length; i += maxChars) parts.push(s.slice(i, i + maxChars));
    return parts;
  });
  for (let i = 0; i < Math.max(1, wrapped.length); i += perPage) {
    const page = out.addPage(A4);
    page.drawText(safe(title), { x: margin, y: A4[1] - margin, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
    wrapped.slice(i, i + perPage).forEach((l, j) =>
      page.drawText(l, { x: margin, y: A4[1] - margin - 24 - j * lh, size, font, color: rgb(0.15, 0.15, 0.15) }));
  }
}

async function fetchBytes(part: Part, month: string): Promise<{ bytes: Uint8Array; type: string }> {
  if (part.generated) {
    const q = new URLSearchParams({ generated: part.generated.kind, month, ...(part.generated.store ? { store: part.generated.store } : {}) });
    const r = await fetch(`/api/month-folder/file?${q}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), type: 'application/pdf' };
  }
  const r = await fetch(`/api/month-folder/file?${new URLSearchParams({ bucket: part.bucket!, path: part.path! })}`);
  const j = await r.json();
  if (!r.ok || !j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
  const f = await fetch(j.url);
  if (!f.ok) throw new Error(`Download HTTP ${f.status}`);
  return { bytes: new Uint8Array(await f.arrayBuffer()), type: f.headers.get('content-type') ?? '' };
}

/**
 * An encrypted PDF, as pictures of its pages.
 *
 * Hills protects its invoices with an owner password. They open normally, but
 * pdf-lib copies the still-encrypted contents across without decrypting them,
 * and every page came out blank. pdf.js can read them, so the pages are drawn
 * from there, at a resolution that prints sharply.
 */
const ENCRYPTED_DPI = 200;
async function flattenEncrypted(bytes: Uint8Array): Promise<PDFDocument> {
  const { getDocumentProxy, renderPageAsImage } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes.slice());
  const flat = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
    const png = await renderPageAsImage(bytes.slice(), i, { scale: ENCRYPTED_DPI / 72 });
    const img = await flat.embedPng(new Uint8Array(png));
    flat.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
  }
  return flat;
}

/**
 * Till receipts print at about their real width, not across a whole A4 sheet.
 *
 * A receipt is told by its shape: longer than any paper format (A4 is 1.41).
 * A long one continues in the next column, repeating a line so that the cut
 * never falls through the text; two columns fit on a sheet.
 */
const RECEIPT_RATIO = 1.55;
const RECEIPT_WIDTH = 80 * 72 / 25.4; // 80 mm till roll
const RECEIPT_GAP = 24, RECEIPT_MARGIN = 28, RECEIPT_OVERLAP = 12;
const isReceiptShape = (w: number, h: number) => h / w >= RECEIPT_RATIO;

async function addReceipts(out: PDFDocument, pages: PDFPage[]) {
  const usable = A4[1] - 2 * RECEIPT_MARGIN;
  let sheet: PDFPage | null = null, col = 2;
  for (const page of pages) {
    const box = page.getMediaBox();
    const s = RECEIPT_WIDTH / box.width;
    const step = (usable - RECEIPT_OVERLAP) / s;
    const bottom = box.y, top = box.y + box.height;
    for (let at = top; ; at -= step) {
      const low = Math.max(bottom, at - usable / s);
      if (col === 2) { sheet = out.addPage(A4); col = 0; }
      const part = await out.embedPage(page, { left: box.x, right: box.x + box.width, bottom: low, top: at });
      const height = (at - low) * s;
      sheet!.drawPage(part, {
        x: RECEIPT_MARGIN + col * (RECEIPT_WIDTH + RECEIPT_GAP),
        y: A4[1] - RECEIPT_MARGIN - height,
        width: RECEIPT_WIDTH, height,
      });
      col++;
      if (low <= bottom) break;
    }
  }
}

/** Appends one document; images become a page of their own, scaled to A4. */
export async function append(out: PDFDocument, bytes: Uint8Array, type: string, name: string, firstPageOnly = false, pages?: number[]) {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  if (isPdf || /pdf/i.test(type)) {
    let src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (src.isEncrypted) src = await flattenEncrypted(bytes);
    const idx = pages ?? (firstPageOnly ? [0] : src.getPageIndices());
    /* In document order: runs of receipts share sheets, anything else stays as it is. */
    let run: PDFPage[] = [];
    const flush = async () => { if (run.length) await addReceipts(out, run); run = []; };
    for (const i of idx) {
      const page = src.getPage(i);
      const { width, height } = page.getSize();
      if (page.getRotation().angle === 0 && isReceiptShape(width, height)) { run.push(page); continue; }
      await flush();
      const [copy] = await out.copyPages(src, [i]);
      out.addPage(copy);
    }
    await flush();
    return;
  }
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpg) throw new Error(`kein PDF/Bild (${type || name})`);
  const img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
  if (isReceiptShape(img.width, img.height)) {
    const tmp = await PDFDocument.create();
    const pic = isPng ? await tmp.embedPng(bytes) : await tmp.embedJpg(bytes);
    const page = tmp.addPage([img.width, img.height]);
    page.drawImage(pic, { x: 0, y: 0, width: img.width, height: img.height });
    await addReceipts(out, [page]);
    return;
  }
  const page = out.addPage(A4);
  const m = 28, s = Math.min((A4[0] - 2 * m) / img.width, (A4[1] - 2 * m) / img.height);
  page.drawImage(img, { x: (A4[0] - img.width * s) / 2, y: A4[1] - m - img.height * s, width: img.width * s, height: img.height * s });
}

export async function buildCheckoutPdf(month: string, onProgress: (done: number, total: number, label: string) => void): Promise<{ blob: Blob; failed: string[]; pages: number }> {
  const r = await fetch(`/api/month-folder?month=${month}&plan=1`);
  const plan = await r.json() as Plan & { error?: string };
  if (!r.ok) throw new Error(plan.error ?? `HTTP ${r.status}`);

  const out = await PDFDocument.create();
  const mono = await out.embedFont(StandardFonts.Courier);
  textPages(out, mono, `Monatsabschluss ${plan.label} — Inhalt`, plan.checklist.split('\n'));

  const failed: string[] = [];
  const total = plan.parts.length;
  let done = 0;
  const tick = (label: string) => onProgress(++done, total, label);
  const add = async (p: Part, pages?: number[]) => {
    try {
      const { bytes, type } = await fetchBytes(p, month);
      await append(out, bytes, type, p.label, p.firstPageOnly, pages);
    } catch (e) {
      failed.push(`${p.section} · ${p.label}: ${e instanceof Error ? e.message : 'Fehler'}`);
    }
  };

  /* The statement, page by page, each followed by what it paid. */
  const isStatementSection = (p: Part) => p.section.startsWith('1 ');
  const statementSection = async () => {
    const statement = plan.parts.find(p => p.label === 'Kontoauszug');
    const invoices = plan.parts.filter(p => isStatementSection(p) && p !== statement);
    if (!statement) {
      for (const inv of invoices) { await add(inv); tick(inv.label); }
      return;
    }
    let src: PDFDocument | null = null;
    try {
      const { bytes } = await fetchBytes(statement, month);
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (e) {
      failed.push(`Kontoauszug: ${e instanceof Error ? e.message : 'Fehler'}`);
    }
    tick('Kontoauszug');
    const pageCount = src?.getPageCount() ?? 0;
    for (let i = 0; i < pageCount; i++) {
      const [pg] = await out.copyPages(src!, [i]);
      out.addPage(pg);
      for (const inv of invoices.filter(x => x.behindPage === i + 1)) { await add(inv); tick(inv.label); }
    }
    /* Paid in no booking of this month, or on a page the statement does not have. */
    for (const inv of invoices.filter(x => !x.behindPage || x.behindPage > pageCount)) { await add(inv); tick(inv.label); }
  };

  /* Everything in the plan's order, which is the one set under "Sequencing". */
  let statementDone = false;
  for (const p of plan.parts) {
    if (isStatementSection(p)) {
      if (!statementDone) { statementDone = true; await statementSection(); }
      continue;
    }
    await add(p); tick(p.label);
  }

  if (failed.length) textPages(out, mono, 'Nicht eingefügt — bitte von Hand ergänzen', failed);
  const bytes = await out.save();
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), failed, pages: out.getPageCount() };
}
