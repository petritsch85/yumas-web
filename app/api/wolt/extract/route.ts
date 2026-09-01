import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { unzipSync } from 'fflate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseWoltInvoice, WoltParseError } from '@/lib/wolt-invoice';
import { parseWoltSalesReport, aggregateWoltShifts, WoltSalesParseError } from '@/lib/wolt-sales-report';
import { buildWoltServices, WoltServicesParseError } from '@/lib/wolt-services';
import { matchLocation, ordersMatchPeriod } from '@/lib/wolt-set';
import { isPayoutReport, parseWoltPayoutReport, parseWoltFeeInvoice, toInvoiceShape } from '@/lib/wolt-payout';
import type { WoltSetFile, WoltSetResult } from '@/lib/wolt-set';

// pdf text extraction needs the Node runtime, not the edge one.
export const runtime = 'nodejs';

/** One PDF, with its text pulled out and its role identified by content. */
interface Doc {
  name:   string;
  text:   string;
  source: string;
  kind:   WoltSetFile['kind'];
}

const kindOf = (text: string): WoltSetFile['kind'] =>
  /Rechnung\s*\(Selbstfakturierung\)/i.test(text)      ? 'invoice'
  : /Umsatzbericht/i.test(text)                        ? 'sales_report'
  : /Übersicht Umsätze und Auszahlungen/i.test(text)   ? 'netting_report'
  : isPayoutReport(text)                               ? 'payout_report'
  : /Wolt Rechnung|Wolt Provision/i.test(text)         ? 'wolt_invoice'
  : 'unknown';

/**
 * Reads a Wolt upload and returns one result per five-day period.
 *
 * Zips are expanded server-side — Wolt publishes a set per archive, so the
 * archive is also the grouping: files that arrived together belong together.
 * Loose PDFs are treated as a single set, which is how a one-period upload
 * behaves.
 *
 * Every set is then checked on its own, and one bad set never blocks the rest.
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

  // ── Expand the upload into PDFs, remembering which archive each came from ──
  const pdfs: { name: string; source: string; bytes: Uint8Array }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(bytes);
      } catch {
        return NextResponse.json({ error: `"${file.name}" could not be opened as a zip.` }, { status: 400 });
      }
      for (const [entryName, data] of Object.entries(entries)) {
        // Skip directory entries and the metadata folders macOS adds.
        if (!/\.pdf$/i.test(entryName) || entryName.startsWith('__MACOSX/')) continue;
        pdfs.push({ name: entryName.split('/').pop() ?? entryName, source: file.name, bytes: data });
      }
    } else if (/\.pdf$/i.test(file.name)) {
      pdfs.push({ name: file.name, source: '', bytes });
    }
  }

  if (pdfs.length === 0) {
    return NextResponse.json(
      { error: 'No PDFs found — drop the Wolt zips, or the PDFs from a document set.' },
      { status: 400 },
    );
  }

  const docs: Doc[] = [];
  for (const pdf of pdfs) {
    try {
      const proxy = await getDocumentProxy(pdf.bytes);
      const { text } = await extractText(proxy, { mergePages: true });
      docs.push({ name: pdf.name, source: pdf.source, text, kind: kindOf(text) });
    } catch {
      return NextResponse.json({ error: `"${pdf.name}" could not be read as a PDF.` }, { status: 400 });
    }
  }

  // Files from the same archive form a set; loose PDFs form one set together.
  const groups = new Map<string, Doc[]>();
  for (const doc of docs) {
    const key = doc.source || 'upload';
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }

  const admin = getSupabaseAdmin();
  const { data: locationRows } = await admin
    .from('locations').select('id, name').eq('is_active', true);
  const locations = (locationRows ?? []) as { id: string; name: string }[];

  // Closed shifts, so orders are never booked to a shift that never ran.
  const [{ data: settings }, { data: closures }] = await Promise.all([
    admin.from('forecast_settings').select('location_id, shift_type, closed_weekdays'),
    admin.from('closure_days').select('location_id, closure_date, shift_type'),
  ]);
  const closedChecker = buildClosedChecker(
    (settings  ?? []) as ClosedWeekdayRow[],
    (closures  ?? []) as ClosureDayRow[],
  );

  const sets: WoltSetResult[] = [];
  for (const [source, groupDocs] of groups) {
    sets.push(buildSet(source, groupDocs, locations, closedChecker));
  }

  sets.sort((a, b) => (a.data?.periodStart ?? '').localeCompare(b.data?.periodStart ?? ''));
  return NextResponse.json({ sets });
}

/**
 * Reads a self-delivery set — a payout report plus Wolt's fee invoice.
 *
 * Net sales are the goods sold plus the delivery income the restaurant earns
 * for delivering itself; commission is Wolt's whole fee invoice less any
 * advertising campaign, so the platform and service fees sit with the
 * commission they arrive alongside.
 *
 * Wolt charges those fees at period level rather than per order, so commission
 * is spread pro-rata on net sales instead of being attributed per order the way
 * the delivered contract allows.
 */
function buildSelfDeliverySet(
  base: WoltSetResult,
  payoutDoc: Doc,
  docs: Doc[],
  locations: { id: string; name: string }[],
  isClosed: (locationId: string, date: string, shift: string) => boolean,
): WoltSetResult {
  const warnings = base.warnings;
  const feeDoc = docs.find(d => d.kind === 'wolt_invoice');
  if (!feeDoc) {
    return { ...base, error: "No Wolt fee invoice in this set — that is the document carrying Wolt's commission." };
  }

  let data;
  let services;
  try {
    const payout = parseWoltPayoutReport(payoutDoc.text);
    const fees   = parseWoltFeeInvoice(feeDoc.text, payoutDoc.text, docs.find(d => d.kind === 'sales_report')?.text);
    data = toInvoiceShape(payout, fees);
    services = { total: fees.adCampaignNet, adCampaign: fees.adCampaignNet || null, lines: [] };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'The payout report could not be read.' };
  }

  if (!data.checkOk) {
    return {
      ...base, data,
      error: `The payout does not reconcile: goods plus services less Wolt's invoice should equal the stated Zahlungsbetrag of ${data.reportedEndbetrag}.`,
    };
  }

  const location = matchLocation(data.restaurant, locations);
  if (!location) {
    return {
      ...base, data,
      error: `"${data.restaurant}" does not match a location in the system${
        locations.length ? ` (${locations.map(l => l.name).join(', ')})` : ''
      }. Add the location, or name it so the restaurant matches, before importing this period.`,
    };
  }

  const salesDoc = docs.find(d => d.kind === 'sales_report');
  let breakdown = null;
  if (salesDoc) {
    try {
      const orders = parseWoltSalesReport(salesDoc.text);
      const mismatch = ordersMatchPeriod(orders.map(o => o.date), data);
      if (mismatch) return { ...base, data, error: mismatch };
      breakdown = aggregateWoltShifts(
        orders, data, services.total,
        (date, shift) => isClosed(location.id, date, shift),
        () => 0,   // charged per period here, so spread pro-rata rather than per order
      );
      if (breakdown.reassigned > 0) {
        warnings.push(
          `${breakdown.reassigned} order${breakdown.reassigned === 1 ? '' : 's'} moved to the other shift — ` +
          'the shift their time implied was closed that day.',
        );
      }
    } catch (e) {
      warnings.push(e instanceof WoltSalesParseError ? e.message : 'The sales report could not be read, so there is no daily breakdown.');
    }
  } else {
    warnings.push('No sales report — this period will import without a daily breakdown.');
  }

  return {
    ...base, data, services, breakdown,
    contract: 'self_delivery',
    locationId: location.id, locationName: location.name,
  };
}

/** Parses and validates one document set. Never throws — it reports instead. */
interface ClosedWeekdayRow { location_id: string; shift_type: string; closed_weekdays: string[] | null }
interface ClosureDayRow   { location_id: string; closure_date: string; shift_type: string }

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Builds a lookup for "was this location shut for this shift that day?",
 * combining the recurring weekday closures with one-off closure dates — the
 * same two sources the P&L shades its closed shifts from.
 */
function buildClosedChecker(settings: ClosedWeekdayRow[], closures: ClosureDayRow[]) {
  const recurring = new Set<string>();
  for (const r of settings) {
    for (const day of r.closed_weekdays ?? []) recurring.add(`${r.location_id}|${r.shift_type}|${day}`);
  }
  const specific = new Set<string>();
  for (const c of closures) {
    for (const shift of c.shift_type === 'all' ? ['lunch', 'dinner'] : [c.shift_type]) {
      specific.add(`${c.location_id}|${shift}|${c.closure_date}`);
    }
  }
  return (locationId: string, date: string, shift: string) => {
    if (specific.has(`${locationId}|${shift}|${date}`)) return true;
    const dow = DOW[new Date(date + 'T12:00:00Z').getUTCDay()];
    return recurring.has(`${locationId}|${shift}|${dow}`);
  };
}

function buildSet(
  source: string,
  docs: Doc[],
  locations: { id: string; name: string }[],
  isClosed: (locationId: string, date: string, shift: string) => boolean,
): WoltSetResult {
  const files: WoltSetFile[] = docs.map(d => ({ name: d.name, kind: d.kind }));
  const warnings: string[] = [];
  const base: WoltSetResult = { source: source === 'upload' ? 'Dropped files' : source, files, warnings };

  const invoiceDoc = docs.find(d => d.kind === 'invoice');
  const payoutDoc  = docs.find(d => d.kind === 'payout_report');

  // Two Wolt contracts are in use and they publish different documents: where
  // Wolt delivers there is a self-billing invoice; where the restaurant
  // delivers there is a payout report and a separate fee invoice instead.
  if (!invoiceDoc && payoutDoc) {
    return buildSelfDeliverySet(base, payoutDoc, docs, locations, isClosed);
  }
  if (!invoiceDoc) {
    return { ...base, error: 'No self-billing invoice (Rechnung (Selbstfakturierung)) and no payout report (Auszahlungsbericht) in this set — one of those carries the period totals.' };
  }
  if (docs.filter(d => d.kind === 'invoice').length > 1) {
    return { ...base, error: 'This set contains more than one self-billing invoice, so its files cannot be paired reliably. Upload the periods separately.' };
  }

  let data;
  try {
    data = parseWoltInvoice(invoiceDoc.text);
  } catch (e) {
    return { ...base, error: e instanceof WoltParseError ? e.message : 'The invoice could not be read.' };
  }
  if (!data.checkOk) {
    return {
      ...base, data,
      error: `The invoice does not add up: ${data.netSalesPreCommission} − ${data.commission} should equal the stated Endbetrag of ${data.reportedEndbetrag}.`,
    };
  }

  // What Wolt charges back — advertising and fees.
  const nettingDoc = docs.find(d => d.kind === 'netting_report');
  const woltInvDoc = docs.find(d => d.kind === 'wolt_invoice');
  let services = null;
  if (nettingDoc || woltInvDoc) {
    try {
      services = buildWoltServices(nettingDoc?.text ?? null, woltInvDoc?.text ?? null);
    } catch (e) {
      warnings.push(e instanceof WoltServicesParseError ? e.message : 'The Wolt services charge could not be read.');
    }
  } else {
    warnings.push('No netting report — this period will import with no advertising figure.');
  }

  // A set is filed by the restaurant its own invoice names, never by the
  // dropdown: falling back would quietly file one restaurant's sales under
  // another, which is the mistake this whole batch path exists to prevent.
  const location = matchLocation(data.restaurant, locations);
  if (!location) {
    return {
      ...base, data,
      error: `"${data.restaurant}" does not match a location in the system${
        locations.length ? ` (${locations.map(l => l.name).join(', ')})` : ''
      }. Add the location, or name it so the restaurant matches, before importing this period.`,
    };
  }

  // The daily and shift split. It needs the location, so it comes after the
  // match: which shifts were open that day decides where an order belongs.
  const salesDoc = docs.find(d => d.kind === 'sales_report');
  let breakdown = null;
  if (salesDoc) {
    try {
      const orders = parseWoltSalesReport(salesDoc.text);
      // The check that catches mis-paired files: orders must sit inside the
      // period the invoice states.
      const mismatch = ordersMatchPeriod(orders.map(o => o.date), data);
      if (mismatch) return { ...base, data, error: mismatch };
      breakdown = aggregateWoltShifts(
        orders, data, services?.total ?? 0,
        (date, shift) => isClosed(location.id, date, shift),
      );
      if (breakdown.reassigned > 0) {
        warnings.push(
          `${breakdown.reassigned} order${breakdown.reassigned === 1 ? '' : 's'} moved to the other shift — ` +
          'the shift their time implied was closed that day.',
        );
      }
    } catch (e) {
      warnings.push(e instanceof WoltSalesParseError ? e.message : 'The sales report could not be read, so there is no daily breakdown.');
    }
  } else {
    warnings.push('No sales report — this period will import without a daily breakdown.');
  }

  return {
    ...base, data, services, breakdown,
    contract: 'self_billing',
    locationId:   location.id,
    locationName: location.name,
  };
}
