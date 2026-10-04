import { NextRequest, NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
// Plain ESM, shared with scripts/ which runs outside the Next.js build.
import { parseKontoauszug } from '@/lib/kontoauszug.mjs';

export const maxDuration = 120;

type Entry = { date: string; kind: string; text: string; amount: number };

/**
 * Settling the ledger against the official Kontoauszug.
 *
 * The CSV exports are a convenience and they lie in one specific way: they
 * carry payments the bank has only earmarked. Those appear again in a later
 * export under their real booking date, and the ledger ends up holding the
 * same money twice — 25.975,58 € of it in September alone. Only the statement
 * says which bookings happened, and on what day.
 *
 * POST with the PDF to preview; add ?apply=1 to carry the changes out. The
 * preview and the application run the same comparison, so nothing is applied
 * that was not shown.
 */
export async function POST(req: NextRequest) {
  const apply = req.nextUrl.searchParams.get('apply') === '1';

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach the Kontoauszug PDF as "file".' }, { status: 400 });
  }

  let parsed;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    parsed = parseKontoauszug(text) as {
      entries: Entry[]; from: string | null; to: string | null; number: string | null;
      openingBalance: number | null; closingBalance: number | null;
      net: number; balanced: boolean | null;
    };
  } catch (e) {
    return NextResponse.json({ error: `Could not read the PDF: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 400 });
  }

  const { entries, from, to, number, balanced, openingBalance, closingBalance } = parsed;
  if (!entries.length || !from || !to) {
    return NextResponse.json({ error: 'No bookings found — is this a Sparkasse Kontoauszug?' }, { status: 400 });
  }
  /* The statement proves its own reading: opening and closing balances must be
     exactly the bookings apart. A parse that cannot show that has dropped or
     invented a booking, and must not be allowed to change the ledger. */
  if (balanced === false) {
    return NextResponse.json({
      error: `Could not read this statement reliably: its bookings come to ${parsed.net.toFixed(2)} €, `
        + `but it runs from ${openingBalance?.toFixed(2)} € to ${closingBalance?.toFixed(2)} €. Nothing has been changed.`,
    }, { status: 422 });
  }

  const admin = getSupabaseAdmin();

  /**
   * Keep the statement, not just what it said.
   *
   * It was read and thrown away, which left the Steuerberater's folder without
   * the one document everything else is reconciled against — and nine uploads
   * had already gone that way. Stored under the month it covers, so the
   * Monatsabschluss page finds it without anyone looking for it again.
   */
  if (apply && from) {
    const month = from.slice(0, 7);
    const path = `monatsabschluss/${month}/kontoauszug_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const stored = await admin.storage.from('cashflow-files')
      .upload(path, await file.arrayBuffer(), { contentType: 'application/pdf', upsert: true });
    if (stored.error) {
      console.warn(`[statement] could not keep the PDF: ${stored.error.message}`);
    } else {
      /* The balances travel with the document: the cash flow statement opens
         and closes on the bank's own figures so that it and the ledger can
         disagree and be seen to. */
      const row = {
        kind: 'kontoauszug', month: `${month}-01`, filename: file.name,
        file_path: path, bucket: 'cashflow-files', byte_size: file.size,
        opening_balance: openingBalance, closing_balance: closingBalance,
      };
      let { error } = await admin.from('month_documents').upsert(row, { onConflict: 'kind,month' });
      if (error && /opening_balance|closing_balance/.test(error.message)) {
        /* Columns arrive with supabase/add_month_balances.sql. */
        const { opening_balance: _o, closing_balance: _c, ...basic } = row;
        void _o; void _c;
        ({ error } = await admin.from('month_documents').upsert(basic, { onConflict: 'kind,month' }));
      }
      /* The table arrives with supabase/add_month_documents.sql; until it has
         been run the statement still applies, it just is not filed. */
      if (error) console.warn(`[statement] month_documents not available: ${error.message}`);
    }
  }

  const rows: { id: string; date: string; direction: string; counterparty: string | null; amount_cents: number; bill_id: string | null }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await admin.from('cashflow_transactions')
      .select('id, date, direction, counterparty, amount_cents, bill_id')
      .gte('date', from).lte('date', to).order('id')
      .range(page * 500, page * 500 + 499);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < 500) break;
  }

  const { data: linkRows } = await admin.from('transaction_bill_links').select('transaction_id');
  const linked = new Set<string>([
    ...(linkRows ?? []).map(l => l.transaction_id as string),
    ...rows.filter(r => r.bill_id).map(r => r.id),
  ]);

  const signed = (r: (typeof rows)[number]) => (r.direction === 'in' ? 1 : -1) * Math.abs(r.amount_cents);
  const ours = new Map<number, typeof rows>();
  for (const r of rows) ours.set(signed(r), [...(ours.get(signed(r)) ?? []), r]);
  const bank = new Map<number, Entry[]>();
  for (const e of entries) {
    const c = Math.round(e.amount * 100);
    bank.set(c, [...(bank.get(c) ?? []), e]);
  }

  const remove: typeof rows = [];
  const redate: { row: (typeof rows)[number]; to: string }[] = [];
  for (const [cents, mine] of ours) {
    const booked = bank.get(cents) ?? [];
    if (mine.length <= booked.length) continue;
    /* Keep what the bank booked, preferring rows that carry bill links so no
       link is broken, then rows whose date already agrees. */
    const ranked = [...mine].sort((a, b) =>
      (linked.has(b.id) ? 1 : 0) - (linked.has(a.id) ? 1 : 0)
      || (booked.some(e => e.date === a.date) ? -1 : 1));
    ranked.slice(0, booked.length).forEach((r, i) => {
      if (booked[i] && r.date !== booked[i].date) redate.push({ row: r, to: booked[i].date });
    });
    remove.push(...ranked.slice(booked.length));
  }

  /* Bookings the bank made that never reached us — a CSV that was never

     uploaded, or one that stopped short. */
  const missing: Entry[] = [];
  for (const [cents, booked] of bank) {
    const extra = booked.length - (ours.get(cents)?.length ?? 0);
    if (extra > 0) missing.push(...booked.slice(0, extra));
  }

  const describe = (r: (typeof rows)[number]) => ({
    id: r.id, date: r.date, counterparty: r.counterparty,
    amount: (r.direction === 'in' ? 1 : -1) * Math.abs(r.amount_cents) / 100,
    hasBill: linked.has(r.id),
  });
  const result = {
    statement: {
      number, from, to, bookings: entries.length, balanced, openingBalance, closingBalance,
      net: Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100,
    },
    ours: rows.length,
    remove: remove.map(describe),
    redate: redate.map(x => ({ ...describe(x.row), newDate: x.to })),
    missing: missing.map(e => ({ date: e.date, amount: e.amount, text: e.text.slice(0, 120) })),
    applied: false,
  };

  if (!apply) return NextResponse.json(result);

  for (const x of redate) {
    const { error } = await admin.from('cashflow_transactions').update({ date: x.to }).eq('id', x.row.id);
    if (error) return NextResponse.json({ ...result, error: error.message }, { status: 500 });
  }
  if (remove.length) {
    const { error } = await admin.from('cashflow_transactions').delete().in('id', remove.map(r => r.id));
    if (error) return NextResponse.json({ ...result, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ...result, applied: true });
}
