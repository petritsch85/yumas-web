import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseWoltInvoice, WoltParseError } from '@/lib/wolt-invoice';

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
    return NextResponse.json({
      data,
      files: docs.map(d => ({
        name: d.name,
        kind: /Rechnung\s*\(Selbstfakturierung\)/i.test(d.text) ? 'invoice'
            : /Umsatzbericht/i.test(d.text)                     ? 'sales_report'
            : /Übersicht Umsätze und Auszahlungen/i.test(d.text) ? 'netting_report'
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
