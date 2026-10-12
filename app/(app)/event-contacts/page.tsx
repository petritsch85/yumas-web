'use client';

/**
 * The people who book large events.
 *
 * Two halves, in the order they matter. The contact list is what has been
 * confirmed; the review queue is what the mailbox sweep proposed and nobody
 * has checked. Nothing crosses from the second to the first without somebody
 * saying so, because a model reading five years of correspondence will
 * occasionally be confidently wrong, and a CRM nobody trusts is worse than
 * none at all.
 *
 * Every contact carries a history rather than a sentence. The same person asks
 * about a Christmas party in 2023, books a summer event in 2024 and goes quiet
 * in 2025 — the sequence is the point, so the row opens into it.
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Users, Search, Loader2, Check, X, Mail, Phone, Building2,
  ChevronRight, ChevronDown, Wand2, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { EVENT_MIN_PARTY } from '@/lib/event-sweep';

type Contact = {
  id: string; person: string | null; company: string | null;
  email: string | null; phone: string | null; role: string | null;
  comment: string | null; status: string | null; party_size: number | null;
  last_contact: string | null; last_summary: string | null;
  thread_count: number; source: string; thread_id: string | null;
};
type Thread = {
  id: string; contact_id: string; occurred_on: string; subject: string | null;
  summary: string | null; outcome: string | null; party_size: number | null;
  source: string; thread_id: string | null; note: string | null;
};
type Candidate = {
  id: string; thread_id: string; subject: string | null; thread_date: string | null;
  person: string | null; company: string | null; email: string | null;
  phone: string | null; role: string | null; comment: string | null;
  status: string | null; party_size: number | null;
  confidence: number | null; evidence: string | null; review: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  won:      { label: 'ausgerichtet', cls: 'bg-green-100 text-green-700' },
  lost:     { label: 'verloren',     cls: 'bg-red-100 text-red-600' },
  no_reply: { label: 'keine Antwort', cls: 'bg-amber-100 text-amber-700' },
  enquiry:  { label: 'offen',        cls: 'bg-blue-100 text-blue-700' },
};
const de = (d: string | null) =>
  d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—';

export default function EventContactsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sweep, setSweep] = useState<{ running: boolean; log: string[]; token: string | null }>(
    { running: false, log: [], token: null });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['event-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_contacts')
        .select('*').order('last_contact', { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Contact[];
    },
  });

  const { data: candidates = [] } = useQuery({
    queryKey: ['event-candidates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_contact_candidates')
        .select('*').eq('review', 'pending').order('thread_date', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Candidate[];
    },
  });

  /* The history is fetched only for the row that is open: two hundred contacts
     with a timeline each is a great deal of nothing anybody is looking at. */
  const { data: threads = [] } = useQuery({
    queryKey: ['event-threads', open],
    enabled: !!open,
    queryFn: async () => {
      const { data, error } = await supabase.from('event_contact_threads')
        .select('*').eq('contact_id', open!).order('occurred_on', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Thread[];
    },
  });

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return contacts;
    return contacts.filter(c => [c.person, c.company, c.email, c.comment, c.last_summary]
      .some(v => String(v ?? '').toLowerCase().includes(t)));
  }, [contacts, q]);

  const review = async (id: string, reject: boolean) => {
    setBusy(id); setError(null);
    try {
      const res = await fetch('/api/event-contacts/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, reject }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Fehlgeschlagen');
      qc.invalidateQueries({ queryKey: ['event-candidates'] });
      qc.invalidateQueries({ queryKey: ['event-contacts'] });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  /** One batch. Dry runs change nothing and are the way to judge the prompt. */
  const runSweep = async (dryRun: boolean) => {
    setSweep(s => ({ ...s, running: true }));
    setError(null);
    try {
      const res = await fetch('/api/event-contacts/sweep', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ years: 5, batch: 25, dryRun, pageToken: sweep.token }),
      });
      /* Read as text first. A function that runs out of time is killed with no
         body at all, and res.json() on that says "Unexpected end of JSON
         input" — which tells nobody what went wrong. */
      const raw = await res.text();
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(raw);
      } catch {
        throw new Error(raw.trim()
          ? `Unerwartete Antwort (${res.status}): ${raw.slice(0, 160)}`
          : `Der Lauf wurde nach ${res.status === 504 ? 'Zeitüberschreitung' : `Status ${res.status}`} abgebrochen. Nochmal drücken — er macht dort weiter, wo er aufgehört hat.`);
      }
      if (!res.ok) throw new Error(String(j.error ?? 'Sweep fehlgeschlagen'));
      const line = `${dryRun ? 'Testlauf' : 'Lauf'}: ${j.read} gelesen, `
        + `${j.triaged} direkt verworfen, ${j.found} Treffer, ${j.rejected} nach Prüfung verworfen, ${j.skipped} schon bekannt`
        + (j.done ? ' · fertig' : j.outOfTime ? ' · Zeit um, bitte nochmal' : ' · weitere vorhanden');
      setSweep(s => ({ running: false, token: typeof j.nextPageToken === 'string' ? j.nextPageToken : null, log: [line, ...s.log].slice(0, 12) }));
      if (!dryRun) qc.invalidateQueries({ queryKey: ['event-candidates'] });
      if (dryRun && Array.isArray(j.candidates)) {
        for (const c of j.candidates.slice(0, 8)) {
          setSweep(s => ({ ...s, log: [...s.log,
            `   · ${c.person ?? '—'} (${c.company ?? '—'})${c.party_size ? ` · ${c.party_size} Pers.` : ''} — ${c.comment ?? ''}`] }));
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setSweep(s => ({ ...s, running: false }));
    }
  };

  const patch = async (id: string, field: keyof Contact, value: string) => {
    await supabase.from('event_contacts')
      .update({ [field]: value || null, updated_at: new Date().toISOString() }).eq('id', id);
    qc.invalidateQueries({ queryKey: ['event-contacts'] });
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users size={22} className="text-indigo-600" /> Event-Kontakte
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => runSweep(true)} disabled={sweep.running}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50">
            {sweep.running ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            Testlauf (schreibt nichts)
          </button>
          <button onClick={() => runSweep(false)} disabled={sweep.running}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            {sweep.running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Postfach durchsuchen
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Ansprechpartner für Veranstaltungen · Verlauf je Person · ab {EVENT_MIN_PARTY} Personen relevant
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}
        </div>
      )}

      {sweep.log.length > 0 && (
        <pre className="mb-4 p-3 rounded-lg bg-gray-900 text-gray-100 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap">
          {sweep.log.join('\n')}
          {sweep.token && '\n\nEs gibt weitere Threads — Knopf erneut drücken, der Lauf macht dort weiter.'}
        </pre>
      )}

      {candidates.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-600" />
            <span className="text-sm font-semibold text-amber-900">
              {candidates.length} Vorschlag{candidates.length === 1 ? '' : 'e'} aus dem Postfach — bitte prüfen
            </span>
          </div>
          <div className="divide-y divide-amber-200/70 max-h-[420px] overflow-y-auto">
            {candidates.map(c => (
              <div key={c.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {c.person ?? '— kein Name —'}
                    {c.company && <span className="text-gray-500 font-normal"> · {c.company}</span>}
                    {c.party_size != null && (
                      <span className={'ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold '
                        + (c.party_size >= EVENT_MIN_PARTY ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600')}>
                        {c.party_size} Pers.
                      </span>
                    )}
                    {c.confidence != null && (
                      <span className="ml-1.5 text-[10px] text-gray-400">
                        Sicherheit {(c.confidence * 100).toFixed(0)} %
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">{c.comment}</div>
                  <div className="text-[11px] text-gray-400 mt-1">
                    {de(c.thread_date)} · {c.subject ?? '—'}
                    {c.email && <> · {c.email}</>}{c.phone && <> · {c.phone}</>}
                  </div>
                  {c.evidence && <div className="text-[11px] text-gray-400 italic mt-0.5">„{c.evidence}“</div>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => review(c.id, false)} disabled={busy === c.id}
                    className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50" title="Übernehmen">
                    {busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button onClick={() => review(c.id, true)} disabled={busy === c.id}
                    className="p-1.5 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 disabled:opacity-50" title="Verwerfen">
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Name, Firma, E-Mail oder Stichwort aus dem Verlauf…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 w-8" />
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Firma</th>
              <th className="px-3 py-2">Kontakt</th>
              <th className="px-3 py-2">Letztes Gespräch</th>
              <th className="px-3 py-2 text-right">Pers.</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                <Loader2 size={16} className="animate-spin inline" /></td></tr>
            )}
            {!isLoading && shown.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-xs">
                Keine Kontakte.</td></tr>
            )}
            {shown.map(c => (
              <React.Fragment key={c.id}>
                <tr className="hover:bg-gray-50/70 cursor-pointer"
                  onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <td className="px-3 py-2 text-gray-400">
                    {open === c.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {c.person ?? <span className="text-gray-300">— offen —</span>}
                    {c.role && <span className="block text-[11px] text-gray-400 font-normal">{c.role}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    <span className="inline-flex items-center gap-1">
                      <Building2 size={12} className="text-gray-300" />{c.company ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-500">
                    {c.email && <span className="flex items-center gap-1"><Mail size={11} />{c.email}</span>}
                    {c.phone && <span className="flex items-center gap-1"><Phone size={11} />{c.phone}</span>}
                    {!c.email && !c.phone && <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-xs text-gray-700 line-clamp-2">{c.last_summary ?? c.comment ?? '—'}</div>
                    <div className="text-[11px] text-gray-400">
                      {de(c.last_contact)}
                      {c.thread_count > 1 && ` · ${c.thread_count} Gespräche`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-600">
                    {c.party_size ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {c.status && STATUS[c.status] && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS[c.status].cls}`}>
                        {STATUS[c.status].label}
                      </span>
                    )}
                  </td>
                </tr>
                {open === c.id && (
                  <tr><td colSpan={7} className="px-3 py-3 bg-gray-50/80">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Verlauf</div>
                    {threads.length === 0 && (
                      <div className="text-xs text-gray-400 mb-3">Noch keine Gespräche hinterlegt.</div>
                    )}
                    <ol className="space-y-2 mb-3">
                      {threads.map(t => (
                        <li key={t.id} className="flex gap-3 text-xs">
                          <span className="tabular-nums text-gray-400 w-20 shrink-0">{de(t.occurred_on)}</span>
                          <span className="flex-1">
                            <span className="text-gray-800">{t.note ?? t.summary ?? t.subject ?? '—'}</span>
                            {t.party_size != null && <span className="text-gray-400"> · {t.party_size} Pers.</span>}
                            {t.outcome && STATUS[t.outcome] && (
                              <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS[t.outcome].cls}`}>
                                {STATUS[t.outcome].label}
                              </span>
                            )}
                            {t.source === 'email' && t.thread_id && (
                              <a href={`https://mail.google.com/mail/u/0/#all/${t.thread_id}`}
                                target="_blank" rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="ml-2 text-indigo-600 hover:underline">E-Mail öffnen</a>
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">
                      Notiz zur Person
                    </label>
                    <textarea defaultValue={c.comment ?? ''} rows={2}
                      onClick={e => e.stopPropagation()}
                      onBlur={e => patch(c.id, 'comment', e.target.value)}
                      placeholder="Dauerhafte Notiz — z. B. „bucht jedes Jahr im November, will immer den hinteren Raum“"
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-gray-400">
        {contacts.length} Kontakte · aus Ausgangsrechnungen übernommen und aus dem Postfach
        benjaminpeters@yumas.de ergänzt. Vorschläge werden erst nach Prüfung zu Kontakten.
      </p>
    </div>
  );
}
