import { NextResponse } from 'next/server';
import { unzipSync } from 'fflate';
import { importNexiPdf, type NexiImportResult } from '@/lib/nexi-import';

// pdf text extraction needs the Node runtime, not the edge one.
export const runtime = 'nodejs';

export type { NexiImportResult } from '@/lib/nexi-import';

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

  const results: NexiImportResult[] = [];
  for (const pdf of pdfs) results.push(await importNexiPdf(pdf.bytes, pdf.name));
  return NextResponse.json({ results });
}
