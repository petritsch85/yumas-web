import { NextRequest, NextResponse } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  MANIFEST, monthRange, monthLabel, documentName, isSubstituteRecord,
  manifestSummary, type ItemStatus,
} from '@/lib/month-folder';

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
type Doc = { path: string; bucket: string; name: string };

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
async function gather(admin: Admin, key: string, month: string): Promise<{ docs: Doc[]; missingFiles: number; detail?: string }> {
  const { from, to } = monthRange(month);

  if (key === 'eingangsrechnungen') {
    const bills = await page<Record<string, unknown>>((a, b) => admin.from('bills')
      .select('invoice_date,supplier_name,invoice_number,file_path,notes')
      .gte('invoice_date', from).lte('invoice_date', to).order('invoice_date').range(a, b));
    const withFile = bills.filter(x => x.file_path);
    /* The rent Ersatzbelege never had an original — see isSubstituteRecord. */
    const substitutes = bills.filter(x => !x.file_path && isSubstituteRecord(x.notes as string));
    const reallyMissing = bills.length - withFile.length - substitutes.length;
    return {
      missingFiles: reallyMissing,
      detail: `${bills.length} Rechnungen`
        + (substitutes.length ? ` · ${substitutes.length} Ersatzbelege (Mietverträge liegen vor)` : ''),
      docs: withFile.map(x => ({
        bucket: 'bills', path: String(x.file_path),
        name: documentName({ date: x.invoice_date as string, party: x.supplier_name as string,
          number: x.invoice_number as string, fallback: String(x.file_path) }) + '.pdf',
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
      docs: withFile.map(x => ({
        bucket: 'bills', path: String(x.file_path),
        name: documentName({ date: x.invoice_date as string, party: x.customer_name as string,
          number: x.invoice_number as string, fallback: String(x.file_path) }) + '.pdf',
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

async function statuses(admin: Admin, month: string): Promise<(ItemStatus & { docs: Doc[] })[]> {
  const out: (ItemStatus & { docs: Doc[] })[] = [];
  for (const item of MANIFEST) {
    const { docs, missingFiles, detail } = await gather(admin, item.key, month);
    out.push({ item, count: docs.length, missingFiles, detail, docs });
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
      items: st.map(({ item, count, missingFiles, detail }) => ({
        key: item.key, label: item.label, folder: item.folder, source: item.source,
        required: item.required, note: item.note, count, missingFiles, detail,
      })),
      summary: manifestSummary(st),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}

/** The checklist that travels with the folder, so gaps are visible on paper. */
function checklist(month: string, st: (ItemStatus & { docs: Doc[] })[]): string {
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
