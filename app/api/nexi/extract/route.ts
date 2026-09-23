import { NextResponse } from 'next/server';
import { getDocumentProxy } from 'unpdf';
import { unzipSync } from 'fflate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseNexiStatement, NexiParseError } from '@/lib/nexi-statement';
import type { NexiStatement, NexiLine } from '@/lib/nexi-statement';

// pdf text extraction needs the Node runtime, not the edge one.
export const runtime = 'nodejs';

/** One statement, read and saved, as the upload panel reports it. */
export interface NexiImportResult {
  source:   string;
  data?:    Omit<NexiStatement, 'payouts'> & { payoutCount: number };
  /** Bank credits this import tied to a transfer. */
  matched?: number;
  /** Whether the fee direct debit was found in the bank. */
  feeMatched?: boolean;
  /** Transfers the statement lists that no credit in the bank carries yet. */
  unmatched?: number;
  warnings: string[];
  error?:   string;
}

/**
 * Reads the text of a PDF as lines, keeping each item's position.
 *
 * The settlement's columns interleave when the page is flattened to a text
 * dump — a payout would end up paired with another day's date — so the rows
 * are rebuilt from the coordinates instead.
 */
async function readLines(bytes: Uint8Array): Promise<NexiLine[]> {
  const pdf = await getDocumentProxy(bytes);
  const lines: NexiLine[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as { str?: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      rows.set(y, [...(rows.get(y) ?? []), { x: Math.round(it.transform[4]), s: it.str.trim() }]);
    }
    for (const [y, items] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push({ y, items: items.sort((a, b) => a.x - b.x) });
    }
  }
  return lines;
}

/**
 * Reads Nexi settlements, saves them, and ties each transfer to the credit it
 * produced in the bank.
 *
 * Matching is on the amount and a short window after the statement's own date:
 * Nexi values a transfer on the day it sends it and the bank books it the same
 * day or the next. An amount that appears twice in the window is left alone
 * rather than guessed at.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart upload.' }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files were uploaded.' }, { status: 400 });
  }

  const pdfs: { name: string; bytes: Uint8Array }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) {
      let entries: Record<string, Uint8Array>;
      try { entries = unzipSync(bytes); } catch {
        return NextResponse.json({ error: `"${file.name}" could not be opened as a zip.` }, { status: 400 });
      }
      for (const [entryName, data] of Object.entries(entries)) {
        if (!/\.pdf$/i.test(entryName) || entryName.startsWith('__MACOSX/')) continue;
        pdfs.push({ name: entryName.split('/').pop() ?? entryName, bytes: data });
      }
    } else if (/\.pdf$/i.test(file.name)) {
      pdfs.push({ name: file.name, bytes });
    }
  }
  if (pdfs.length === 0) {
    return NextResponse.json({ error: 'No PDFs found — drop the Nexi settlement PDFs.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const results: NexiImportResult[] = [];

  for (const pdf of pdfs) {
    let data: NexiStatement;
    try {
      data = parseNexiStatement(await readLines(pdf.bytes));
    } catch (e) {
      results.push({
        source: pdf.name, warnings: [],
        error: e instanceof NexiParseError ? e.message : 'The PDF could not be read.',
      });
      continue;
    }

    // ── Save the statement and its transfers ──
    const { data: stmt, error: stmtErr } = await admin.from('nexi_statements').upsert({
      invoice_number:  data.invoiceNumber,
      invoice_date:    data.invoiceDate,
      period_start:    data.periodStart,
      period_end:      data.periodEnd,
      merchant_number: data.merchantNumber,
      account_iban:    data.accountIban,
      payouts_total:   data.payoutsTotal,
      fees_net:        data.feesNet,
      fees_vat:        data.feesVat,
      fees_gross:      data.feesGross,
      brands:          data.brands,
      debit_date:      data.debitDate,
      debit_amount:    data.debitAmount,
      source_file:     pdf.name,
    }, { onConflict: 'invoice_number' }).select('id').single();
    if (stmtErr || !stmt) {
      results.push({ source: pdf.name, warnings: data.warnings, error: stmtErr?.message ?? 'The statement could not be saved.' });
      continue;
    }

    const { error: payErr } = await admin.from('nexi_payouts').upsert(
      data.payouts.map(p => ({
        statement_id:       stmt.id,
        merchant_number:    data.merchantNumber,
        payment_number:     p.paymentNumber,
        payout_date:        p.date,
        transaction_amount: p.transactionAmount,
        amount:             p.amount,
      })),
      { onConflict: 'merchant_number,payment_number' },
    );
    if (payErr) {
      results.push({ source: pdf.name, warnings: data.warnings, error: payErr.message });
      continue;
    }

    // ── Tie each transfer to the credit it produced ──
    const { data: rows } = await admin
      .from('nexi_payouts')
      .select('id, payment_number, payout_date, amount')
      .eq('merchant_number', data.merchantNumber)
      .in('payment_number', data.payouts.map(p => p.paymentNumber));
    const saved = rows ?? [];

    const first = data.payouts[0].date;
    const last  = data.payouts[data.payouts.length - 1].date;
    const plus = (d: string, days: number) => {
      const t = new Date(d + 'T12:00:00Z');
      t.setUTCDate(t.getUTCDate() + days);
      return t.toISOString().slice(0, 10);
    };
    const { data: txRows } = await admin
      .from('cashflow_transactions')
      .select('id, date, counterparty, amount_cents, nexi_payout_id')
      .eq('direction', 'in')
      .ilike('counterparty', '%nexi%')
      .gte('date', plus(first, -2))
      .lte('date', plus(last, 6));
    const txs = txRows ?? [];

    const warnings = [...data.warnings];
    const taken = new Set(txs.filter(t => t.nexi_payout_id).map(t => t.nexi_payout_id as string));
    const used  = new Set<string>();
    let matched = 0;

    for (const p of saved) {
      if (taken.has(p.id)) { matched++; continue; }
      const cents = Math.round(Number(p.amount) * 100);
      const candidates = txs.filter(t =>
        !t.nexi_payout_id && !used.has(t.id) &&
        Math.abs(t.amount_cents) === cents &&
        t.date >= p.payout_date && t.date <= plus(p.payout_date, 4));
      if (candidates.length === 0) continue;
      /* Two credits of the same amount in the window cannot be told apart, so
         neither is claimed — a wrong link is worse than none. */
      if (candidates.length > 1) {
        warnings.push(`Transfer ${p.payment_number} (${Number(p.amount).toFixed(2)} €) matches ${candidates.length} credits — left for you to link.`);
        continue;
      }
      const { error } = await admin
        .from('cashflow_transactions')
        .update({ nexi_payout_id: p.id })
        .eq('id', candidates[0].id);
      if (error) { warnings.push(`Transfer ${p.payment_number}: ${error.message}`); continue; }
      used.add(candidates[0].id);
      matched++;
    }

    /*
     * The fees are collected separately, by direct debit a day or two after
     * the statement. That debit is evidenced by this same document, so it is
     * tied to the statement rather than to any one transfer.
     */
    let feeMatched = false;
    if (data.debitAmount != null && data.debitDate) {
      const feeCents = Math.round(data.debitAmount * 100);
      const { data: feeRows } = await admin
        .from('cashflow_transactions')
        .select('id, amount_cents, nexi_statement_id')
        .eq('direction', 'out')
        .ilike('counterparty', '%nexi%')
        .gte('date', plus(data.debitDate, -3))
        .lte('date', plus(data.debitDate, 10));
      const hits = (feeRows ?? []).filter(t =>
        Math.abs(t.amount_cents) === feeCents &&
        (!t.nexi_statement_id || t.nexi_statement_id === stmt.id));
      if (hits.length === 1) {
        const { error } = await admin
          .from('cashflow_transactions')
          .update({ nexi_statement_id: stmt.id })
          .eq('id', hits[0].id);
        if (error) warnings.push(`Fee debit: ${error.message}`);
        else feeMatched = true;
      } else if (hits.length > 1) {
        warnings.push(`The fee debit of ${data.debitAmount.toFixed(2)} € matches ${hits.length} transactions — left for you to link.`);
      } else {
        warnings.push(`The fee debit of ${data.debitAmount.toFixed(2)} € (${data.debitDate}) is not in the bank data yet.`);
      }
    }

    const { payouts, ...rest } = data;
    results.push({
      source: pdf.name,
      data: { ...rest, payoutCount: payouts.length },
      matched,
      feeMatched,
      unmatched: saved.length - matched,
      warnings,
    });
  }

  return NextResponse.json({ results });
}
