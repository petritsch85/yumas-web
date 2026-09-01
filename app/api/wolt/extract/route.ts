import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseWoltInvoice, WoltParseError } from '@/lib/wolt-invoice';
import { parseWoltSalesReport, aggregateWoltShifts, WoltSalesParseError } from '@/lib/wolt-sales-report';
import { buildWoltServices, WoltServicesParseError } from '@/lib/wolt-services';

// pdf text extraction needs the Node runtime, not the edge one.
export const runtime = 'nodejs';

/**
 * Reads a Wolt document set and returns the figures for the five-day period.
 *
 * All three PDFs are posted together because that is how Wolt publishes them,
 * but only the self-billing invoice carries the period totals — the others are
 * accepted, identified and reported back so the upload is traceable, and so
 * the sales report is already here when we come to derive the daily split.
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

  // Pull the text out of every PDF once, then decide what each one is by its
  // content rather than its filename — Wolt's filenames carry the restaurant
  // name and are easy to rename by accident.
  const docs: { name: string; text: string }[] = [];
  for (const file of files) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      docs.push({ name: file.name, text });
    } catch {
      return NextResponse.json(
        { error: `"${file.name}" could not be read as a PDF.` },
        { status: 400 },
      );
    }
  }

  const invoiceDoc = docs.find(d => /Rechnung\s*\(Selbstfakturierung\)/i.test(d.text));
  if (!invoiceDoc) {
    return NextResponse.json(
      {
        error:
          'None of these files is the Wolt self-billing invoice ' +
          '(Rechnung (Selbstfakturierung)) — that is the one carrying the period totals.',
      },
      { status: 400 },
    );
  }

  try {
    const data = parseWoltInvoice(invoiceDoc.text);

    // What Wolt charges us: the netting report states it as one figure, the
    // Wolt-to-merchant invoice itemises it. Both are optional; without either,
    // the period imports with no advertising.
    const nettingDoc = docs.find(d => /Übersicht Umsätze und Auszahlungen/i.test(d.text));
    const woltInvDoc = docs.find(d => /Wolt Rechnung/i.test(d.text));
    let services = null;
    let servicesError: string | null = null;
    if (nettingDoc || woltInvDoc) {
      try {
        services = buildWoltServices(nettingDoc?.text ?? null, woltInvDoc?.text ?? null);
      } catch (e) {
        servicesError = e instanceof WoltServicesParseError
          ? e.message
          : 'The Wolt services charge could not be read.';
      }
    } else {
      servicesError = 'No netting report in this set — the period will import with no advertising figure.';
    }

    // The sales report carries the order timestamps, which is the only way to
    // cut the period into days and shifts. It is optional: without it the
    // period totals still import, just with no breakdown.
    const salesDoc = docs.find(d => /Umsatzbericht/i.test(d.text));
    let breakdown = null;
    let breakdownError: string | null = null;
    if (salesDoc) {
      try {
        breakdown = aggregateWoltShifts(
          parseWoltSalesReport(salesDoc.text), data, services?.total ?? 0,
        );
      } catch (e) {
        breakdownError = e instanceof WoltSalesParseError
          ? e.message
          : 'The sales report could not be read, so there is no daily breakdown.';
      }
    } else {
      breakdownError = 'No sales report (Umsatzbericht) in this set — the period will import without a daily breakdown.';
    }

    return NextResponse.json({
      data,
      services,
      servicesError,
      breakdown,
      breakdownError,
      files: docs.map(d => ({
        name: d.name,
        kind: /Rechnung\s*\(Selbstfakturierung\)/i.test(d.text) ? 'invoice'
            : /Umsatzbericht/i.test(d.text)                     ? 'sales_report'
            : /Übersicht Umsätze und Auszahlungen/i.test(d.text) ? 'netting_report'
            : /Wolt Rechnung/i.test(d.text)                      ? 'wolt_invoice'
            : 'unknown',
      })),
    });
  } catch (e) {
    if (e instanceof WoltParseError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
}
