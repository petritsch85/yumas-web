import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getGmailClient, decodeBody } from '@/lib/gmail';
import { sweepQuery, TRIAGE_PROMPT, EXTRACT_PROMPT, worthKeeping, type Candidate } from '@/lib/event-sweep';

export const maxDuration = 300;

/**
 * Stop with time to spare and hand back a page token.
 *
 * A request that runs past its limit is killed mid-flight and returns no body
 * at all — which reaches the browser as "Unexpected end of JSON input" and
 * loses every thread it had already read. Better to do less and say where to
 * carry on from.
 */
const BUDGET_MS = 30_000;
/**
 * The last moment a slow call may be started.
 *
 * The budget above decides whether to begin another thread; this decides
 * whether to finish one properly. A thread begun at 29 seconds still has a
 * Gmail fetch, a triage and a full read ahead of it, which is enough to run
 * past a sixty-second limit and lose the whole request.
 */
const SLOW_CALL_DEADLINE_MS = 42_000;

/**
 * Reading five years of mail for the people who booked events.
 *
 * The mailbox is already connected — benjaminpeters@yumas.de, read-only, by
 * OAuth — so this needs no Apps Script and no forwarding. It searches, reads,
 * and puts what it finds in a review queue.
 *
 * Deliberately resumable rather than one long run. Five years of threads is
 * more than any request can finish, and a sweep that must complete or lose
 * everything is a sweep that never completes. Each call does a batch, records
 * what it looked at, and says whether there is more.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Plain text of a thread, oldest first, trimmed to what a model needs. */
function threadText(messages: { payload?: unknown; internalDate?: string | null }[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = m.payload as any;
    const h = (name: string) =>
      (p?.headers ?? []).find((x: { name: string }) => x.name.toLowerCase() === name)?.value ?? '';
    const body = decodeBody(p)
      /* Quoted history repeats the whole thread in every reply; without this a
         ten-message thread is read ten times over. */
      .replace(/^>.*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    parts.push(`--- Von: ${h('from')} | An: ${h('to')} | ${h('date')}\nBetreff: ${h('subject')}\n\n${body.slice(0, 4000)}`);
  }
  return parts.join('\n\n').slice(0, 30000);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const years: number = Number(body.years ?? 5);
  const batch: number = Math.min(Number(body.batch ?? 25), 60);
  const dryRun: boolean = !!body.dryRun;

  const admin = getSupabaseAdmin();
  let gmail;
  try {
    gmail = await getGmailClient();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const q = sweepQuery(years);

  /* Gmail pages through the whole result set; the page token is carried by the
     caller so a later call resumes rather than starting again. */
  const list = await gmail.users.threads.list({
    userId: 'me', q, maxResults: batch,
    pageToken: typeof body.pageToken === 'string' ? body.pageToken : undefined,
  });
  const threads = list.data.threads ?? [];

  /* Threads already judged are skipped without paying the model again. */
  const ids = threads.map(t => t.id!).filter(Boolean);
  const { data: seenRows } = await admin.from('event_sweep_seen')
    .select('thread_id').in('thread_id', ids.length ? ids : ['-']);
  const seen = new Set((seenRows ?? []).map(r => r.thread_id as string));

  const started = Date.now();
  const found: Record<string, unknown>[] = [];
  let read = 0, skipped = 0, rejected = 0, triaged = 0;
  /* Where to resume inside this page when the budget runs out before the
     threads do. Gmail's own token only moves a whole page at a time. */
  let stoppedAt: string | null = null;

  for (const t of threads) {
    if (!t.id) continue;
    if (seen.has(t.id)) { skipped++; continue; }
    if (Date.now() - started > BUDGET_MS) { stoppedAt = t.id; break; }

    const full = await gmail.users.threads.get({ userId: 'me', id: t.id, format: 'full' });
    const messages = full.data.messages ?? [];
    if (!messages.length) continue;
    read++;

    /* The cheap look first. Most threads end here, for a fraction of a cent
       and under a second, which is what makes five years affordable. */
    const opening = threadText(messages.slice(0, 2)).slice(0, 3000);
    try {
      const t1 = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8,
        system: TRIAGE_PROMPT,
        messages: [{ role: 'user', content: opening }],
      });
      const verdict = t1.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim().toUpperCase();
      if (!verdict.startsWith('JA')) {
        triaged++;
        if (!dryRun) {
          await admin.from('event_sweep_seen')
            .upsert({ thread_id: t.id, outcome: 'triage-no' }, { onConflict: 'thread_id' });
        }
        continue;
      }
    } catch (e) {
      /* A triage failure must not drop the thread — fall through and let the
         proper read decide. */
      console.warn(`[event-sweep] triage ${t.id}: ${(e as Error).message}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = messages[0].payload as any;
    const subject = (first?.headers ?? [])
      .find((x: { name: string }) => x.name.toLowerCase() === 'subject')?.value ?? '';
    const when = messages.at(-1)?.internalDate
      ? new Date(Number(messages.at(-1)!.internalDate)).toISOString().slice(0, 10)
      : null;

    /* Triage said yes, but there is no longer time to read it properly. Leave
       it unrecorded so the next press picks it up rather than half-judging it
       now. */
    if (Date.now() - started > SLOW_CALL_DEADLINE_MS) { stoppedAt = t.id; break; }

    let c: Candidate | null = null;
    try {
      const res = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: EXTRACT_PROMPT,
        messages: [{ role: 'user', content: threadText(messages) }],
      });
      const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
      c = JSON.parse(text.replace(/^```(?:json)?|```$/gm, '').trim()) as Candidate;
    } catch (e) {
      console.warn(`[event-sweep] ${t.id}: unreadable — ${(e as Error).message}`);
      continue;
    }

    const keep = worthKeeping(c);
    if (!dryRun) {
      await admin.from('event_sweep_seen').upsert(
        { thread_id: t.id, outcome: keep ? 'candidate' : (c.is_event ? 'too-small-or-unsure' : 'not-an-event') },
        { onConflict: 'thread_id' });
    }
    if (!keep) { rejected++; continue; }

    const row = {
      thread_id: t.id, subject, thread_date: when,
      person: c.person, company: c.company, email: c.email, phone: c.phone,
      role: c.role, comment: c.comment, status: c.status,
      party_size: c.party_size, confidence: c.confidence, evidence: c.evidence,
    };
    found.push(row);
    if (!dryRun) {
      await admin.from('event_contact_candidates')
        .upsert(row, { onConflict: 'thread_id', ignoreDuplicates: true });
    }
  }

  return NextResponse.json({
    query: q,
    inBatch: threads.length, read, skipped, rejected, triaged, found: found.length,
    /* Staying on this page when the budget cut it short: the threads already
       judged are recorded, so pressing again skips straight past them. */
    nextPageToken: stoppedAt
      ? (typeof body.pageToken === 'string' ? body.pageToken : null)
      : (list.data.nextPageToken ?? null),
    done: !stoppedAt && !list.data.nextPageToken,
    outOfTime: !!stoppedAt,
    candidates: dryRun ? found : undefined,
  });
}
