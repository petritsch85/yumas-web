import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Finds the credits that paid our own outstanding invoices.
 *
 * A customer transfer names the invoice more often than not, so the strongest
 * signal is the invoice number appearing in the bank's reference. The next is
 * the customer's name, which arrives from the bank in upper case, without
 * punctuation and often without its legal form — "APPLE RETAIL GERMANY B V CO
 * KG" for "Apple Retail Germany B.V. & Co. KG" — so both sides are reduced to
 * their significant words before being compared.
 *
 * The amount has to match to the cent either way. Two invoices of the same
 * amount are common enough (a recurring corporate booking), which is why an
 * amount alone is reported but never ticked: that one is for a person.
 */

export interface PaymentMatch {
  billId: string;
  invoiceNumber: string | null;
  customerName: string;
  invoiceDate: string | null;
  amount: number;
  txId: string;
  txDate: string;
  txCounterparty: string;
  txDescription: string;
  daysAfter: number;
  /** What made this a match, in the order it was found. */
  reasons: string[];
  /** Ticked by default, or left for a person to judge. */
  confident: boolean;
  /** What arrived, where that is not what was invoiced. */
  paidAmount?: number;
  /** Switched to paid by hand earlier; applying only ties the credit to it. */
  alreadyPaid: boolean;
}

/** Legal forms carry no information about who the customer is. */
const NOISE = new Set([
  'gmbh', 'ag', 'kg', 'co', 'mbh', 'mbb', 'bv', 'se', 'ohg', 'gbr', 'ug', 'ltd',
  'deutschland', 'germany', 'partnerschaftsgesellschaft', 'rechtsanwaelte',
  'steuerberater', 'und', 'the', 'group', 'retail', 'business', 'solutions',
]);

const words = (raw: string) =>
  (raw ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w.length > 3 && !NOISE.has(w));

/** "144-26" also arrives as "144 26", "14426" or "RG144/26". */
const refVariants = (invoiceNumber: string) => {
  const bare = invoiceNumber.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return [invoiceNumber.toLowerCase(), bare].filter(v => v.length >= 4);
};

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000);

async function findMatches(admin: ReturnType<typeof getSupabaseAdmin>): Promise<PaymentMatch[]> {
  const { data: bills } = await admin
    .from('outgoing_bills')
    .select('id, invoice_number, invoice_date, event_date, customer_name, total_payable, status, paid_in_store')
    .in('status', ['pending', 'paid'])
    .gt('total_payable', 0)
    .order('invoice_date');

  /* An invoice switched to paid by hand still wants the credit that paid it,
     or that credit sits in the cash flow as "No Bill". Those already tied to
     a credit are done. */
  const { data: linkedRows } = await admin
    .from('cashflow_transactions')
    .select('outgoing_bill_id')
    .not('outgoing_bill_id', 'is', null);
  const linked = new Set((linkedRows ?? []).map(r => r.outgoing_bill_id as string));

  /* Outstanding invoices go first, so where two could take the same credit
     it settles the one still waiting for its money. */
  const pending = (bills ?? [])
    .filter(b => !b.paid_in_store && !linked.has(b.id))
    .sort((a, b) => Number(a.status === 'paid') - Number(b.status === 'paid'));
  if (pending.length === 0) return [];

  /* Only credits, only those not already spoken for. The window starts a
     little before the earliest invoice: a deposit is sometimes paid before
     the invoice is written. */
  const earliest = pending.reduce((min, b) => {
    const d = b.invoice_date ?? b.event_date;
    return d && (!min || d < min) ? d : min;
  }, null as string | null);

  const from = earliest
    ? new Date(new Date(earliest + 'T12:00:00Z').getTime() - 30 * 86400000).toISOString().slice(0, 10)
    : '2000-01-01';

  const { data: txs } = await admin
    .from('cashflow_transactions')
    .select('id, date, counterparty, description, amount_cents, outgoing_bill_id')
    .eq('direction', 'in')
    .is('outgoing_bill_id', null)
    .gte('date', from)
    .order('date');

  const credits = txs ?? [];
  const matches: PaymentMatch[] = [];
  const claimed = new Set<string>();

  for (const b of pending) {
    const cents = Math.round(Number(b.total_payable) * 100);
    const billDate = b.invoice_date ?? b.event_date;
    const nameWords = words(b.customer_name);

    const inWindow = (t: { date: string }) => {
      if (!billDate) return true;
      const d = daysBetween(billDate, t.date);
      // A prepayment lands before the invoice; a slow payer inside six months.
      return d >= -30 && d <= 180;
    };
    const candidates = credits.filter(t =>
      !claimed.has(t.id) && Math.abs(t.amount_cents) === cents && inWindow(t));

    /* No credit for the exact amount, but one that quotes the invoice number.
       A customer who pays part of an invoice, or rounds the tip off, still
       says which invoice it was — and an invoice quoted in the bank is worth
       seeing even when the figure disagrees. Never ticked: the amount is the
       whole question. */
    if (candidates.length === 0) {
      if (!b.invoice_number) continue;
      const refs = refVariants(b.invoice_number);
      const quoted = credits.filter(t => {
        if (claimed.has(t.id) || !inWindow(t)) return false;
        const bare = `${t.counterparty ?? ''} ${t.description ?? ''}`.replace(/[^a-z0-9]+/gi, '').toLowerCase();
        return refs.some(v => bare.includes(v.replace(/[^a-z0-9]/g, '')));
      });
      if (quoted.length !== 1) continue;
      const t = quoted[0];
      const paid = Math.abs(t.amount_cents) / 100;
      matches.push({
        billId: b.id, invoiceNumber: b.invoice_number, customerName: b.customer_name,
        invoiceDate: billDate, amount: Number(b.total_payable),
        txId: t.id, txDate: t.date, txCounterparty: t.counterparty ?? '',
        txDescription: (t.description ?? '').slice(0, 120),
        daysAfter: billDate ? daysBetween(billDate, t.date) : 0,
        reasons: [`quotes invoice ${b.invoice_number}`, `but ${paid.toFixed(2)} € arrived against ${Number(b.total_payable).toFixed(2)} € invoiced`],
        confident: false,
        paidAmount: paid,
        alreadyPaid: b.status === 'paid',
      });
      continue;
    }

    const scored = candidates.map(t => {
      const haystack = `${t.counterparty ?? ''} ${t.description ?? ''}`.toLowerCase();
      const bare = haystack.replace(/[^a-z0-9]+/g, '');
      const reasons: string[] = [];

      const refHit = !!b.invoice_number && refVariants(b.invoice_number)
        .some(v => haystack.includes(v) || bare.includes(v.replace(/[^a-z0-9]/g, '')));
      if (refHit) reasons.push(`quotes invoice ${b.invoice_number}`);

      const txWords = new Set(words(`${t.counterparty ?? ''} ${t.description ?? ''}`));
      const shared = nameWords.filter(w => txWords.has(w));
      if (shared.length > 0) reasons.push(`payer matches “${shared.slice(0, 2).join(' ')}”`);

      reasons.push('amount matches to the cent');
      const days = billDate ? daysBetween(billDate, t.date) : 0;
      return { t, reasons, score: (refHit ? 4 : 0) + shared.length, days };
    }).sort((a, b2) => b2.score - a.score || Math.abs(a.days) - Math.abs(b2.days));

    const best = scored[0];
    /* One credit, matching amount, naming neither the invoice nor the payer is
       still probably it — but not certainly, so it is shown unticked. */
    const confident = best.score > 0 && (scored.length === 1 || best.score > scored[1].score);
    if (confident) claimed.add(best.t.id);

    matches.push({
      billId: b.id,
      invoiceNumber: b.invoice_number,
      customerName: b.customer_name,
      invoiceDate: billDate,
      amount: Number(b.total_payable),
      txId: best.t.id,
      txDate: best.t.date,
      txCounterparty: best.t.counterparty ?? '',
      txDescription: (best.t.description ?? '').slice(0, 120),
      daysAfter: best.days,
      reasons: best.reasons,
      confident,
      alreadyPaid: b.status === 'paid',
    });
  }

  return matches.sort((a, b) => Number(b.confident) - Number(a.confident) || (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? ''));
}

/** Preview: what looks paid, and why. */
export async function GET() {
  try {
    return NextResponse.json({ matches: await findMatches(getSupabaseAdmin()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The check failed.' }, { status: 500 });
  }
}

/** Apply: mark the chosen invoices paid and tie each to the credit that paid it. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const pairs: { billId: string; txId: string }[] = Array.isArray(body.pairs) ? body.pairs : [];
  if (pairs.length === 0) {
    return NextResponse.json({ error: 'Nothing was selected.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const errors: string[] = [];
  let updated = 0;

  for (const { billId, txId } of pairs) {
    if (typeof billId !== 'string' || typeof txId !== 'string') continue;
    /* The link goes on first: if that fails the invoice stays pending, which
       is the safer of the two half-finished states. */
    const { error: linkErr } = await admin
      .from('cashflow_transactions')
      .update({ outgoing_bill_id: billId })
      .eq('id', txId)
      .is('outgoing_bill_id', null);
    if (linkErr) { errors.push(linkErr.message); continue; }

    const { error: billErr } = await admin
      .from('outgoing_bills')
      .update({ status: 'paid' })
      .eq('id', billId);
    if (billErr) { errors.push(billErr.message); continue; }
    updated++;
  }

  return NextResponse.json({ updated, errors });
}
