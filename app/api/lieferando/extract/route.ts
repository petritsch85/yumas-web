import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { unzipSync } from 'fflate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { matchLocation } from '@/lib/wolt-set';
import {
  parseLieferandoStatement, buildLieferandoBreakdown, LieferandoParseError,
} from '@/lib/lieferando-statement';
import type { LieferandoStatement, LieferandoSetResult } from '@/lib/lieferando-statement';

// pdf text extraction needs the Node runtime, not the edge one.
export const runtime = 'nodejs';

/**
 * Reads Lieferando statements and returns one result per PDF.
 *
 * Each statement is a whole week on its own, so there is no set to assemble:
 * one file, one period. Zips are expanded for convenience.
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
    return NextResponse.json({ error: 'No PDFs found — drop the Lieferando statement PDFs.' }, { status: 400 });
  }

  const { data: locationRows } = await getSupabaseAdmin()
    .from('locations').select('id, name').eq('is_active', true);
  const locations = (locationRows ?? []) as { id: string; name: string }[];

  const sets: LieferandoSetResult[] = [];
  for (const pdf of pdfs) {
    let text = '';
    try {
      const doc = await getDocumentProxy(pdf.bytes);
      text = (await extractText(doc, { mergePages: true })).text;
    } catch {
      sets.push({ source: pdf.name, warnings: [], error: 'The PDF could not be read.' });
      continue;
    }

    let data: LieferandoStatement;
    try {
      data = parseLieferandoStatement(text);
    } catch (e) {
      sets.push({
        source: pdf.name, warnings: [],
        error: e instanceof LieferandoParseError ? e.message : 'The statement could not be read.',
      });
      continue;
    }

    const location = matchLocation(data.restaurant, locations);
    if (!location) {
      sets.push({
        source: pdf.name, data, warnings: data.warnings,
        error: `"${data.restaurant}" does not match a location in the system.`,
      });
      continue;
    }

    sets.push({
      source: pdf.name,
      locationId: location.id, locationName: location.name,
      data, breakdown: buildLieferandoBreakdown(data),
      warnings: data.warnings,
      error: data.checkOk ? undefined
        : `The payout does not reconcile: the balance Lieferando holds less the invoices it settled should equal the Auszahlung of ${data.payout ?? '—'}.`,
    });
  }

  sets.sort((a, b) => (a.data?.periodStart ?? '').localeCompare(b.data?.periodStart ?? ''));
  return NextResponse.json({ sets });
}
