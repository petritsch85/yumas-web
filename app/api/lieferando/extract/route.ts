import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { unzipSync } from 'fflate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { matchLocation } from '@/lib/wolt-set';
import {
  parseLieferandoStatement, buildLieferandoBreakdown, LieferandoParseError,
} from '@/lib/lieferando-statement';
import type { LieferandoStatement, LieferandoSetResult } from '@/lib/lieferando-statement';
import { buildShiftClosedChecker, type ClosedWeekdayRow, type ClosureRow } from '@/lib/opening-hours';

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

  const admin = getSupabaseAdmin();
  const { data: locationRows } = await admin
    .from('locations').select('id, name').eq('is_active', true);
  const locations = (locationRows ?? []) as { id: string; name: string }[];

  /* Closed shifts, as the Wolt import has them: an order timed into a shift
     the restaurant did not run — 12:30 on a Saturday, when only dinner opens —
     was cooked by the shift that was open, and is booked there. */
  const [{ data: settings }, { data: closures }] = await Promise.all([
    admin.from('forecast_settings').select('location_id, shift_type, closed_weekdays'),
    admin.from('closure_days').select('location_id, closure_date, shift_type, kind'),
  ]);
  const isClosed = buildShiftClosedChecker((settings ?? []) as ClosedWeekdayRow[], (closures ?? []) as ClosureRow[]);

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

    /* The opening pattern is today's; a shift the till shows as run that day
       stays as it is — Eschborn opened Friday lunches in 2025. */
    const { data: zRows } = await admin.from('shift_reports').select('report_date,shift_type')
      .eq('location_id', location.id).gte('report_date', data.periodStart).lte('report_date', data.periodEnd);
    const ran = new Set((zRows ?? []).map(z => `${z.report_date}|${z.shift_type}`));
    let moved = 0;
    for (const o of data.orders) {
      const other = o.shift === 'lunch' ? 'dinner' : 'lunch';
      if (ran.has(`${o.saleDate}|${o.shift}`)) continue;
      if (isClosed(location.id, o.saleDate, o.shift) && !isClosed(location.id, o.saleDate, other)) { o.shift = other; moved++; }
    }
    if (moved) data.warnings.push(`${moved} order${moved === 1 ? '' : 's'} timed into a closed shift booked to the shift that was open.`);

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
