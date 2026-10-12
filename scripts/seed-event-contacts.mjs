/**
 * Seed the CRM from what we have already billed.
 *
 * Every company that has been invoiced for an event is a company that booked
 * one, which makes it the safest row in the list — no reading between the
 * lines, no model, just what we charged and when. It is also the half of the
 * work that needs no mailbox at all, so the list is useful before a single
 * email has been swept.
 *
 * A name comes from the customers table where one is recorded. Most have none,
 * and that is the point: a company with no human against it is exactly what
 * the sweep is for, and seeing the gap is what makes it worth filling.
 *
 * Idempotent. Re-running updates the comment and the dates rather than adding
 * a second row, because a seeded company is identified by its name.
 *
 *   node scripts/seed-event-contacts.mjs           → zeigt nur
 *   node scripts/seed-event-contacts.mjs --apply   → schreibt
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');
const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };

const bills = await page(p => db.from('outgoing_bills')
  .select('customer_name,event_date,invoice_date,net_total,issuing_location,invoice_number,paid_in_store')
  .range(p * 1000, p * 1000 + 999));
const { data: customers } = await db.from('customers').select('company_name,contact_name,city');

/* A contact name per company, where the invoicing side happens to hold one. */
const contactOf = new Map();
for (const c of customers ?? []) {
  if (!c.company_name || !c.contact_name) continue;
  contactOf.set(c.company_name.trim().toLowerCase(), c.contact_name.trim());
}

const by = new Map();
for (const b of bills) {
  const name = String(b.customer_name ?? '').trim();
  if (!name || name === '—') continue;
  /* A Bewirtungsbeleg documents a delivery-platform order, not an event. */
  if (String(b.invoice_number ?? '').toUpperCase().startsWith('BB')) continue;
  const cur = by.get(name) ?? { n: 0, net: 0, dates: [], places: new Set(), events: [] };
  cur.n++;
  cur.net += Number(b.net_total ?? 0);
  const d = String(b.event_date ?? b.invoice_date ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    cur.dates.push(d);
    /* Each billed event is a conversation in its own right — the history
       should show four separate bookings, not "4 Veranstaltungen". */
    cur.events.push({ on: d, net: Number(b.net_total ?? 0),
      where: b.issuing_location ?? null, no: b.invoice_number ?? null });
  }
  if (b.issuing_location) cur.places.add(b.issuing_location);
  by.set(name, cur);
}

const de = d => `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const eur = n => Math.round(n).toLocaleString('de-DE');

console.log(`${by.size} Firmen aus ${bills.length} Ausgangsrechnungen\n`);

let made = 0, updated = 0;
for (const [company, c] of [...by.entries()].sort((a, z) => z[1].net - a[1].net)) {
  c.dates.sort();
  const first = c.dates[0], last = c.dates.at(-1);
  const person = contactOf.get(company.toLowerCase()) ?? null;

  /* The comment is the whole point of the row, so it says what happened in
     the words someone would use: how many, when, where, how much. */
  const comment = [
    c.n === 1 ? '1 Veranstaltung' : `${c.n} Veranstaltungen`,
    first && last ? (first === last ? `am ${de(first)}` : `${de(first)} bis ${de(last)}`) : null,
    c.places.size ? `(${[...c.places].join(', ')})` : null,
    `· ${eur(c.net)} € netto insgesamt`,
    '· aus den Ausgangsrechnungen übernommen',
  ].filter(Boolean).join(' ');

  console.log(`  ${eur(c.net).padStart(8)} €  ${String(c.n).padStart(2)}x  ${company.slice(0, 44).padEnd(44)} ${person ?? '— kein Ansprechpartner —'}`);
  if (!apply) continue;

  const row = {
    company, person,
    comment,
    status: 'won',
    source: 'invoice',
    last_contact: last ?? null,
    updated_at: new Date().toISOString(),
  };

  /* Identified by company among the seeded rows: a row a person has since
     edited by hand keeps its own comment rather than being overwritten. */
  const { data: exists } = await db.from('event_contacts')
    .select('id,source').eq('company', company).eq('source', 'invoice').maybeSingle();

  let contactId = exists?.id ?? null;
  if (exists) {
    const { error } = await db.from('event_contacts').update(row).eq('id', exists.id);
    if (error) { console.log(`     FEHLER: ${error.message}`); continue; }
    updated++;
  } else {
    const { data: made_, error } = await db.from('event_contacts').insert(row).select('id').single();
    if (error) { console.log(`     FEHLER: ${error.message}`); continue; }
    contactId = made_.id; made++;
  }

  /* One history row per billed event, so the timeline reads as bookings
     rather than as a count. Keyed on the invoice number, so re-running
     neither doubles them nor disturbs a note added by hand. */
  for (const ev of c.events) {
    const key = ev.no ? `invoice:${ev.no}` : `invoice:${company}:${ev.on}`;
    const { error } = await db.from('event_contact_threads').upsert({
      contact_id: contactId,
      occurred_on: ev.on,
      subject: `Veranstaltung ${de(ev.on)}${ev.where ? ` · ${ev.where}` : ''}`,
      summary: `Ausgerichtet und abgerechnet · ${eur(ev.net)} € netto`
             + (ev.no ? ` · Rechnung ${ev.no}` : ''),
      outcome: 'won',
      source: 'invoice',
      thread_id: key,
    }, { onConflict: 'contact_id,thread_id', ignoreDuplicates: true });
    if (error) console.log(`     Verlauf FEHLER: ${error.message}`);
  }
}

console.log(apply
  ? `\n${made} angelegt, ${updated} aktualisiert.`
  : '\nProbelauf — mit --apply schreiben.');
