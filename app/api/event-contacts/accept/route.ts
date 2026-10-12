import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Turning a reviewed candidate into a contact, and a conversation into history.
 *
 * The same person turns up once per thread, so three Christmas parties over
 * four years arrive as three candidates. Accepting each must build ONE contact
 * with three conversations behind it, not three contacts — which is why the
 * match runs on the email address before anything is created.
 *
 * Where a contact already exists its own fields are left alone. A phone number
 * somebody typed in beats one a model read out of a signature block, and the
 * standing comment is the user's to write. Only what is missing is filled.
 */

/** Same person? The address decides; failing that, the name within a company. */
async function findContact(
  admin: ReturnType<typeof getSupabaseAdmin>,
  c: { email: string | null; person: string | null; company: string | null },
) {
  if (c.email) {
    const { data } = await admin.from('event_contacts')
      .select('*').ilike('email', c.email).maybeSingle();
    if (data) return data;
  }
  if (c.person && c.company) {
    const { data } = await admin.from('event_contacts')
      .select('*').ilike('person', c.person).ilike('company', c.company).maybeSingle();
    if (data) return data;
  }
  /* A company seeded from the invoices but never given a name: the sweep has
     just found the human, so that row is the one to fill rather than a second
     row for the same firm. */
  if (c.company) {
    const { data } = await admin.from('event_contacts')
      .select('*').eq('source', 'invoice').is('person', null)
      .ilike('company', c.company).maybeSingle();
    if (data) return data;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { id, reject } = await req.json().catch(() => ({}));
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id erforderlich.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  const { data: cand, error: readErr } = await admin
    .from('event_contact_candidates').select('*').eq('id', id).maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!cand) return NextResponse.json({ error: 'Vorschlag nicht gefunden.' }, { status: 404 });

  if (reject) {
    const { error } = await admin.from('event_contact_candidates')
      .update({ review: 'rejected' }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, review: 'rejected' });
  }

  const existing = await findContact(admin, cand);
  let contactId: string;

  if (existing) {
    /* Fill the gaps, touch nothing that is already answered. */
    const patch: Record<string, unknown> = {};
    for (const f of ['person', 'company', 'email', 'phone', 'role'] as const) {
      if (!existing[f] && cand[f]) patch[f] = cand[f];
    }
    if (!existing.party_size && cand.party_size) patch.party_size = cand.party_size;
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      await admin.from('event_contacts').update(patch).eq('id', existing.id);
    }
    contactId = existing.id as string;
  } else {
    const { data: made, error } = await admin.from('event_contacts').insert({
      person: cand.person, company: cand.company, email: cand.email,
      phone: cand.phone, role: cand.role,
      status: cand.status, party_size: cand.party_size,
      source: 'email',
      thread_id: cand.thread_id,
    }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    contactId = made.id as string;
  }

  /* The conversation itself. The trigger on this table carries the date and
     the summary up onto the contact, so the list always shows the latest. */
  const { error: histErr } = await admin.from('event_contact_threads').upsert({
    contact_id:  contactId,
    occurred_on: cand.thread_date ?? new Date().toISOString().slice(0, 10),
    subject:     cand.subject,
    summary:     cand.comment,
    outcome:     cand.status,
    party_size:  cand.party_size,
    source:      'email',
    thread_id:   cand.thread_id,
  }, { onConflict: 'contact_id,thread_id' });
  if (histErr) return NextResponse.json({ error: histErr.message }, { status: 500 });

  const { error: markErr } = await admin.from('event_contact_candidates')
    .update({ review: 'accepted', contact_id: contactId }).eq('id', id);
  if (markErr) return NextResponse.json({ error: markErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, contactId, merged: !!existing });
}
