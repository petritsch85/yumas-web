import { NextRequest, NextResponse } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
// Plain ESM, shared with scripts/ which runs outside the Next.js build.
import { parseKontoauszug } from '@/lib/kontoauszug.mjs';
import {
  MANIFEST, monthRange, monthLabel, documentName, isSubstituteRecord,
  manifestSummary, type ItemStatus,
} from '@/lib/month-folder';
import { findGaps, type Gap } from '@/lib/missing-invoices';

export const maxDuration = 300;

/**
 * The month's folder for the Steuerberater.
 *
 * GET says what the month has and what it is still missing. POST builds the
 * zip: one numbered folder per manifest item, in the order they are meant to be
 * printed, with a checklist at the front saying what is inside and what is not.
 *
 * Nothing is sent anywhere — the zip is downloaded and handed over.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;
type Doc = { path: string; bucket: string; name: string; seq?: number; page?: number };

/**
 * Where each booking sits in the printed statement.
 *
 * The folder is assembled by hand: the statement is printed and each invoice
 * filed behind the page that shows its payment. Sorted any other way that is a
 * search through 134 PDFs per page; sorted this way it is a single pass. So the
 * statement's own order is read back out of it and every invoice is numbered by
 * the booking that paid it.
 *
 * Keyed on date and signed amount, which is what reconciled the month exactly.
 */
type Booking = { seq: number; page: number };
async function bookingOrder(admin: Admin, month: string): Promise<Map<string, Booking>> {
  const order = new Map<string, Booking>();
  const { data: doc } = await admin.from('month_documents')
    .select('file_path,bucket').eq('kind', 'kontoauszug').eq('month', `${month}-01`).maybeSingle();
  if (!doc?.file_path) return order;

  try {
    const { data: file } = await admin.storage.from(doc.bucket || 'cashflow-files').download(doc.file_path);
    if (!file) return order;
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    const parsed = parseKontoauszug(text) as { entries: { date: string; amount: number; page: number }[] };
    parsed.entries.forEach((e, i) => {
      const key = `${e.date}|${Math.round(e.amount * 100)}`;
      /* First occurrence wins: two identical bookings on a day are filed in the
         order they print, and the second invoice takes the later slot anyway. */
      if (!order.has(key)) order.set(key, { seq: i + 1, page: e.page });
    });
  } catch { /* an unreadable statement just means no ordering */ }
  return order;
}

/** The bookings that settled a bill, as keys into the order map. */
async function paymentKeys(admin: Admin): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const add = (billId: string, key: string) =>
    out.set(billId, [...(out.get(billId) ?? []), key]);

  const tx = await page<Record<string, unknown>>((a, b) => admin.from('cashflow_transactions')
    .select('id,date,amount_cents,direction,bill_id,outgoing_bill_id').order('id').range(a, b));
  const links = await page<Record<string, unknown>>((a, b) => admin.from('transaction_bill_links')
    .select('transaction_id,bill_id').order('transaction_id').range(a, b));

  const keyOf = (t: Record<string, unknown>) => {
    const signed = (t.direction === 'in' ? 1 : -1) * Math.abs(Number(t.amount_cents ?? 0));
    return `${String(t.date).slice(0, 10)}|${signed}`;
  };
  const byId = new Map(tx.map(t => [String(t.id), t]));
  for (const t of tx) {
    if (t.bill_id) add(String(t.bill_id), keyOf(t));
    if (t.outgoing_bill_id) add(String(t.outgoing_bill_id), keyOf(t));
  }
  for (const l of links) {
    const t = byId.get(String(l.transaction_id));
    if (t) add(String(l.bill_id), keyOf(t));
  }
  return out;
}

/**
 * Name the files so a file browser sorts them into filing order.
 *
 * `S03_041_…` is page three of the statement, forty-first booking. Printed in
 * that order the pile goes behind the statement page by page without anybody
 * searching. What no booking paid for — invoices still open, or settled in
 * another month — is prefixed ZZ and lands at the end, together, rather than
 * being silently dropped or scattered through the sequence.
 */
function inStatementOrder(docs: Doc[]): Doc[] {
  const placed = docs.filter(d => d.seq !== undefined).sort((a, b) => a.seq! - b.seq!);
  const rest   = docs.filter(d => d.seq === undefined).sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...placed.map(d => ({ ...d,
      name: `S${String(d.page).padStart(2, '0')}_${String(d.seq).padStart(3, '0')}_${d.name}` })),
    ...rest.map(d => ({ ...d, name: `ZZ_ohne_Zahlung_im_Monat_${d.name}` })),
  ];
}

/** The earliest booking that settled this bill, if any did. */
function placeOf(billId: string, keys: Map<string, string[]>, order: Map<string, Booking>): Booking | null {
  const found = (keys.get(billId) ?? [])
    .map(k => order.get(k)).filter((b): b is Booking => !!b)
    .sort((a, b) => a.seq - b.seq);
  return found[0] ?? null;
}

const page = async <T,>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
  const out: T[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await build(p * 1000, p * 1000 + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

/** The documents behind one manifest item, and what is missing from it. */
async function gather(
  admin: Admin, key: string, month: string,
  order: Map<string, Booking>, keys: Map<string, string[]>,
): Promise<{ docs: Doc[]; missingFiles: number; detail?: string }> {
  const { from, to } = monthRange(month);

  if (key === 'eingangsrechnungen') {
    /**
     * The same accounting basis as the outgoing side, and for the same reason
     * twice over.
     *
     * An invoice dated in September with a fortnight's terms is paid in
     * October, and an August invoice is paid in September: 90 of those for
     * 09/2026. Taking invoice date alone leaves 90 bookings in the statement
     * with nothing to file behind them, which is exactly the search this is
     * meant to spare whoever assembles the folder.
     */
    const all = await page<Record<string, unknown>>((a, b) => admin.from('bills')
      .select('id,invoice_date,supplier_name,invoice_number,file_path,notes')
      .order('invoice_date').range(a, b));
    const bills = all.filter(x => {
      const dated = String(x.invoice_date ?? '').slice(0, 10);
      if (dated >= from && dated <= to) return true;
      return placeOf(String(x.id), keys, order) !== null;
    });
    const withFile = bills.filter(x => x.file_path);
    /* The rent Ersatzbelege never had an original — see isSubstituteRecord. */
    const substitutes = bills.filter(x => !x.file_path && isSubstituteRecord(x.notes as string));
    const reallyMissing = bills.length - withFile.length - substitutes.length;
    return {
      missingFiles: reallyMissing,
      detail: `${bills.length} Rechnungen`
        + (() => {
          const later = bills.filter(x => !(String(x.invoice_date ?? '') >= from && String(x.invoice_date ?? '') <= to));
          return later.length ? ` · davon ${later.length} aus Vormonaten, hier bezahlt` : '';
        })()
        + (substitutes.length ? ` · ${substitutes.length} Ersatzbelege (Mietverträge liegen vor)` : ''),
      docs: inStatementOrder(withFile.map(x => {
        const at = placeOf(String(x.id), keys, order);
        return {
          bucket: 'bills', path: String(x.file_path), seq: at?.seq, page: at?.page,
          name: documentName({ date: x.invoice_date as string, party: x.supplier_name as string,
            number: x.invoice_number as string, fallback: String(x.file_path) }) + '.pdf',
        };
      })),
    };
  }

  if (key === 'ausgangsrechnungen') {
    /**
     * On an accounting basis, not a cash one.
     *
     * A September folder owes every invoice dated in September whether or not
     * the customer has paid, and also the older invoices the customer settled
     * in September — six of those for 09/2026, dated July and August. Taking
     * invoice date alone would drop them; taking payment alone would drop the
     * eleven September invoices still outstanding.
     */
    const all = await page<Record<string, unknown>>((a, b) => admin.from('outgoing_bills')
      .select('id,invoice_date,customer_name,invoice_number,file_path')
      .order('invoice_date').range(a, b));
    const paid = await page<Record<string, unknown>>((a, b) => admin.from('cashflow_transactions')
      .select('outgoing_bill_id,date').not('outgoing_bill_id', 'is', null)
      .gte('date', from).lte('date', to).order('id').range(a, b));
    const paidThisMonth = new Set(paid.map(p => String(p.outgoing_bill_id)));

    const bills = all.filter(x => {
      const dated = String(x.invoice_date ?? '').slice(0, 10);
      return (dated >= from && dated <= to) || paidThisMonth.has(String(x.id));
    });
    const later = bills.filter(x => !(String(x.invoice_date ?? '') >= from && String(x.invoice_date ?? '') <= to));
    const withFile = bills.filter(x => x.file_path);
    return {
      missingFiles: bills.length - withFile.length,
      detail: `${bills.length} Rechnungen`
        + (later.length ? ` · davon ${later.length} aus Vormonaten, hier bezahlt` : ''),
      docs: inStatementOrder(withFile.map(x => {
        const at = placeOf(String(x.id), keys, order);
        return {
          bucket: 'bills', path: String(x.file_path), seq: at?.seq, page: at?.page,
          name: documentName({ date: x.invoice_date as string, party: x.customer_name as string,
            number: x.invoice_number as string, fallback: String(x.file_path) }) + '.pdf',
        };
      })),
    };
  }

  /* Everything else is uploaded against the month. */
  const { data } = await admin.from('month_documents')
    .select('filename,file_path,bucket').eq('kind', key).eq('month', from);
  const rows = (data ?? []) as { filename: string; file_path: string; bucket: string }[];
  return {
    missingFiles: 0,
    docs: rows.map(r => ({ bucket: r.bucket || 'cashflow-files', path: r.file_path, name: r.filename })),
  };
}

/**
 * Payments in the month that no invoice explains.
 *
 * Counted once and hung on the Eingangsrechnungen position, because that is
 * what they are missing from: a booking on the statement with nothing to file
 * behind it.
 */
async function gapsFor(admin: Admin, month: string, order: Map<string, Booking>): Promise<Gap[]> {
  const { from, to } = monthRange(month);
  const tx = await page<Record<string, unknown>>((a, b) => admin.from('cashflow_transactions')
    .select('id,date,direction,counterparty,description,amount_cents,bill_id')
    .gte('date', from).lte('date', to).order('id').range(a, b));
  const links = await page<Record<string, unknown>>((a, b) => admin.from('transaction_bill_links')
    .select('transaction_id').order('transaction_id').range(a, b));
  const linked = new Set<string>([
    ...links.map(l => String(l.transaction_id)),
    ...tx.filter(t => t.bill_id).map(t => String(t.id)),
  ]);
  return findGaps(
    tx as unknown as Parameters<typeof findGaps>[0], linked,
    (date, cents) => order.get(`${date}|${cents}`),
  );
}

async function statuses(admin: Admin, month: string): Promise<(ItemStatus & { docs: Doc[]; gaps?: Gap[] })[]> {
  const [order, keys] = await Promise.all([bookingOrder(admin, month), paymentKeys(admin)]);
  const gaps = await gapsFor(admin, month, order);
  const out: (ItemStatus & { docs: Doc[]; gaps?: Gap[] })[] = [];
  for (const item of MANIFEST) {
    const { docs, missingFiles, detail } = await gather(admin, item.key, month, order, keys);
    const unplaced = docs.filter(d => d.seq === undefined).length;
    out.push({
      item, count: docs.length, missingFiles, docs,
      gaps: item.key === 'eingangsrechnungen' ? gaps : undefined,
      detail: detail && item.source === 'collected'
        ? detail + (order.size === 0
            ? ' · Reihenfolge erst nach Upload des Kontoauszugs'
            : unplaced ? ` · ${unplaced} ohne Zahlung in diesem Monat` : ' · nach Kontoauszug sortiert')
        : detail,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must look like 2026-09' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  try {
    const st = await statuses(admin, month);
    return NextResponse.json({
      month, label: monthLabel(month),
      items: st.map(({ item, count, missingFiles, detail, gaps }) => ({
        key: item.key, label: item.label, folder: item.folder, source: item.source,
        required: item.required, note: item.note, count, missingFiles, detail,
        gaps: gaps ?? [],
        gapTotal: (gaps ?? []).reduce((s, g) => s + g.amount, 0),
      })),
      summary: {
        ...manifestSummary(st),
        /* A month with every position filled is still not ready while payments
           sit unexplained, which is what the tick used to claim. */
        gaps: st.reduce((n, s) => n + (s.gaps?.length ?? 0), 0),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}

/** The checklist that travels with the folder, so gaps are visible on paper. */
function checklist(month: string, st: (ItemStatus & { docs: Doc[]; gaps?: Gap[] })[]): string {
  const s = manifestSummary(st);
  const lines = [
    `MONATSABSCHLUSS ${monthLabel(month).toUpperCase()}`,
    `Yumas GmbH · Feuerbachstr. 46 · 60325 Frankfurt am Main`,
    `Erstellt am ${new Date().toLocaleDateString('de-DE')} · ${s.documents} Dokumente`,
    '',
    'INHALT',
    '',
  ];
  for (const x of st) {
    const mark = x.count > 0 ? '[x]' : x.item.required ? '[ ] FEHLT' : '[ ] —';
    lines.push(`${mark}  ${x.item.folder.padEnd(22)} ${x.item.label}`);
    lines.push(`     ${x.item.note}`);
    lines.push(`     ${x.count} Datei(en)${x.detail ? ` · ${x.detail}` : ''}`
      + (x.missingFiles > 0 ? ` · ${x.missingFiles} ohne Beleg-PDF` : ''));
    lines.push('');
  }
  if (!s.ready) {
    lines.push('NOCH OFFEN', '');
    for (const m of s.missing) lines.push(`  - ${m.item.label} fehlt vollständig`);
  }
  if (s.partial.length) {
    lines.push('', 'BELEGE OHNE PDF', '');
    for (const p of s.partial) lines.push(`  - ${p.item.label}: ${p.missingFiles} Vorgang/Vorgänge ohne Datei`);
  }

  /* The gaps belong in the folder itself: a page of the statement with nothing
     filed behind it is easier to accept than to rediscover. */
  const gaps = st.flatMap(x => x.gaps ?? []);
  if (gaps.length) {
    const total = gaps.reduce((t, g) => t + g.amount, 0);
    lines.push('', '', `ZAHLUNGEN OHNE RECHNUNG — ${gaps.length} Stück, ${total.toFixed(2)} EUR`, '',
      'Diese Buchungen stehen im Kontoauszug, es liegt aber keine Rechnung dazu vor.',
      'Lohn, Krankenkassen, Finanzamt und Darlehen sind hier nicht aufgefuehrt — dafuer',
      'gibt es keine Rechnung.', '');
    for (const g of gaps) {
      const where = g.page ? `S${String(g.page).padStart(2, '0')}/${String(g.seq).padStart(3, '0')}` : '  —   ';
      lines.push(`  ${where}  ${g.date}  ${g.amount.toFixed(2).padStart(10)} EUR  ${g.counterparty.slice(0, 40)}`);
      if (g.description) lines.push(`${' '.repeat(42)}${g.description.slice(0, 70)}`);
    }
  }
  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must look like 2026-09' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  let st: (ItemStatus & { docs: Doc[] })[];
  try { st = await statuses(admin, month); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }

  const files: Record<string, Uint8Array> = {};
  files['00_Checkliste.txt'] = strToU8(checklist(month, st));

  const failed: string[] = [];
  for (const x of st) {
    /* Names repeat — two invoices from one supplier on one day — so a counter
       is added rather than letting one silently overwrite the other. */
    const used = new Map<string, number>();
    for (const d of x.docs) {
      const { data, error } = await admin.storage.from(d.bucket).download(d.path);
      if (error || !data) { failed.push(`${x.item.folder}/${d.name}`); continue; }
      const n = (used.get(d.name) ?? 0) + 1;
      used.set(d.name, n);
      const name = n === 1 ? d.name : d.name.replace(/(\.[^.]+)?$/, `_${n}$1`);
      files[`${x.item.folder}/${name}`] = new Uint8Array(await data.arrayBuffer());
    }
  }
  if (failed.length) {
    files['00_Checkliste.txt'] = strToU8(
      checklist(month, st) + '\n\nNICHT LESBAR\n\n' + failed.map(f => `  - ${f}`).join('\n'));
  }

  const zip = zipSync(files, { level: 6 });
  return new NextResponse(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Yumas_Monatsabschluss_${month}.zip"`,
    },
  });
}
