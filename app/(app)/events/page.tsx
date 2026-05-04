'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Plus, X, Pencil, FileText, CalendarDays, Users, Phone, Mail,
  MapPin, Euro, ChevronDown, ChevronUp, CheckCircle2, Clock, XCircle, Star,
} from 'lucide-react';
import { useT } from '@/lib/i18n';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type EventStatus = 'tentative' | 'confirmed' | 'cancelled';

type EventRow = {
  id: string;
  name: string;
  location: string;
  event_date: string;
  event_time_from: string | null;
  event_time_until: string | null;
  num_guests: number;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  menu_package: string | null;
  budget: number | null;
  deposit_paid: number | null;
  notes: string | null;
  status: EventStatus;
  confidence: number | null;   // 1–3, only used when tentative
  created_at: string;
};

type EventDraft = Omit<EventRow, 'id' | 'created_at'>;

/* ─── Constants ──────────────────────────────────────────────────────────── */
const LOCATIONS = ['Eschborn', 'Taunus', 'Westend', 'ZK', 'External Venue'];
const STATUSES: EventStatus[] = ['tentative', 'confirmed', 'cancelled'];

const EMPTY_DRAFT: EventDraft = {
  name: '',
  location: 'Eschborn',
  event_date: '',
  event_time_from: '',
  event_time_until: '',
  num_guests: 0,
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  menu_package: '',
  budget: null,
  deposit_paid: null,
  notes: '',
  status: 'tentative',
  confidence: 2,
};

const statusConfig: Record<EventStatus, {
  label: string;
  badgeColor: string;
  cardBg: string;
  cardBorder: string;
  dateBg: string;
  dateText: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = {
  tentative: {
    label: 'Tentative',
    badgeColor: 'bg-yellow-500 text-white',
    cardBg: 'bg-yellow-50',
    cardBorder: 'border-yellow-200',
    dateBg: 'bg-yellow-100',
    dateText: 'text-yellow-800',
    Icon: Clock,
  },
  confirmed: {
    label: 'Confirmed',
    badgeColor: 'bg-green-600 text-white',
    cardBg: 'bg-green-50',
    cardBorder: 'border-green-200',
    dateBg: 'bg-green-100',
    dateText: 'text-green-800',
    Icon: CheckCircle2,
  },
  cancelled: {
    label: 'Cancelled',
    badgeColor: 'bg-red-500 text-white',
    cardBg: 'bg-red-50',
    cardBorder: 'border-red-200',
    dateBg: 'bg-red-100',
    dateText: 'text-red-800',
    Icon: XCircle,
  },
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function isUpcoming(event: EventRow) {
  return new Date(event.event_date) >= new Date(new Date().toDateString());
}

function fmtTime(t: string | null) {
  return t ? t.slice(0, 5) : null;
}

function fmtMoney(n: number) {
  return '€' + n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/* ─── Star Rating ────────────────────────────────────────────────────────── */
function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          className={onChange ? 'cursor-pointer' : 'cursor-default'}
        >
          <Star
            size={14}
            className={n <= value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}
          />
        </button>
      ))}
    </div>
  );
}

/* ─── Add / Edit Form ────────────────────────────────────────────────────── */
function EventForm({
  draft, onChange, onSubmit, onCancel, isPending, error, isEdit,
}: {
  draft: EventDraft;
  onChange: (d: EventDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  error: string;
  isEdit?: boolean;
}) {
  const { t } = useT();
  const set = (key: keyof EventDraft, value: any) => onChange({ ...draft, [key]: value });

  const canSubmit =
    draft.name.trim() !== '' &&
    draft.event_date !== '' &&
    draft.contact_name.trim() !== '' &&
    draft.num_guests > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-gray-900">
          {isEdit ? t('events.editEvent') : t('events.newEvent')}
        </h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Event name */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.eventName')} *</label>
          <input
            type="text"
            value={draft.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Birthday Dinner – Müller Family"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Status */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.status')}</label>
          <select
            value={draft.status}
            onChange={e => set('status', e.target.value as EventStatus)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          >
            {STATUSES.map(s => (
              <option key={s} value={s}>{t(`events.status.${s}`)}</option>
            ))}
          </select>
        </div>

        {/* Location */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.location')} *</label>
          <select
            value={draft.location}
            onChange={e => set('location', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          >
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        {/* Date */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.date')} *</label>
          <input
            type="date"
            value={draft.event_date}
            onChange={e => set('event_date', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Guests */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.numGuests')} *</label>
          <input
            type="number"
            min={1}
            value={draft.num_guests || ''}
            onChange={e => set('num_guests', parseInt(e.target.value) || 0)}
            placeholder="e.g. 40"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Time From */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.timeFrom')}</label>
          <input
            type="time"
            value={draft.event_time_from ?? ''}
            onChange={e => set('event_time_from', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Time Until */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.timeUntil')}</label>
          <input
            type="time"
            value={draft.event_time_until ?? ''}
            onChange={e => set('event_time_until', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Confidence (only for tentative) */}
        {draft.status === 'tentative' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.confidence')}</label>
            <div className="flex items-center gap-2 h-9">
              <StarRating
                value={draft.confidence ?? 2}
                onChange={v => set('confidence', v)}
              />
              <span className="text-xs text-gray-400">
                {draft.confidence === 1 ? t('events.confidence.low') : draft.confidence === 2 ? t('events.confidence.medium') : t('events.confidence.high')}
              </span>
            </div>
          </div>
        )}

        {/* Contact name */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.contactName')} *</label>
          <input
            type="text"
            value={draft.contact_name}
            onChange={e => set('contact_name', e.target.value)}
            placeholder="e.g. Thomas Müller"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Contact email */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.contactEmail')}</label>
          <input
            type="email"
            value={draft.contact_email ?? ''}
            onChange={e => set('contact_email', e.target.value)}
            placeholder="thomas@example.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Contact phone */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.contactPhone')}</label>
          <input
            type="tel"
            value={draft.contact_phone ?? ''}
            onChange={e => set('contact_phone', e.target.value)}
            placeholder="+49 171 000 0000"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Menu / Package */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.menuPackage')}</label>
          <input
            type="text"
            value={draft.menu_package ?? ''}
            onChange={e => set('menu_package', e.target.value)}
            placeholder="e.g. 3-course set menu, drinks incl."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Budget */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.budget')}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={draft.budget ?? ''}
            onChange={e => set('budget', e.target.value ? parseFloat(e.target.value) : null)}
            placeholder="e.g. 2400"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Deposit */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.deposit')}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={draft.deposit_paid ?? ''}
            onChange={e => set('deposit_paid', e.target.value ? parseFloat(e.target.value) : null)}
            placeholder="e.g. 500"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {/* Notes */}
        <div className="col-span-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('events.form.specialNotes')}</label>
          <textarea
            value={draft.notes ?? ''}
            onChange={e => set('notes', e.target.value)}
            rows={3}
            placeholder="Dietary requirements, room setup, AV equipment, decorations, allergies…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 resize-none"
          />
        </div>
      </div>

      {error && <p className="text-red-500 text-xs mt-3 font-medium">{error}</p>}

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
          {t('events.cancel')}
        </button>
        <button
          onClick={onSubmit}
          disabled={isPending || !canSubmit}
          className="bg-[#1B5E20] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (isEdit ? t('events.saving') : t('events.creating')) : (isEdit ? t('events.saveChanges') : t('events.createEvent'))}
        </button>
      </div>
    </div>
  );
}

/* ─── Event Card ─────────────────────────────────────────────────────────── */
function EventCard({ event, onEdit }: { event: EventRow; onEdit: (e: EventRow) => void }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const cfg = statusConfig[event.status];
  const StatusIcon = cfg.Icon;

  const timeStr = (() => {
    const from = fmtTime(event.event_time_from);
    const until = fmtTime(event.event_time_until);
    if (from && until) return `${from} – ${until}`;
    if (from) return `from ${from}`;
    return null;
  })();

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${cfg.cardBg} ${cfg.cardBorder}`}>
      {/* Main row */}
      <div className="px-5 py-4 flex items-start gap-4">

        {/* Date block */}
        <div className={`flex-shrink-0 w-14 rounded-lg py-2 text-center ${cfg.dateBg}`}>
          <div className={`text-xl font-bold leading-none ${cfg.dateText}`}>
            {new Date(event.event_date).getDate().toString().padStart(2, '0')}
          </div>
          <div className={`text-xs uppercase tracking-wide mt-0.5 ${cfg.dateText} opacity-70`}>
            {new Date(event.event_date).toLocaleDateString('en-GB', { month: 'short' })}
          </div>
          <div className={`text-xs mt-0.5 ${cfg.dateText} opacity-50`}>
            {new Date(event.event_date).getFullYear()}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Name + status badge */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">{event.name}</h3>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${cfg.badgeColor}`}>
              <StatusIcon size={12} />
              {cfg.label}
            </span>
            {/* Confidence stars — only for tentative */}
            {event.status === 'tentative' && event.confidence && (
              <span className="flex items-center gap-0.5" title={`Confidence: ${event.confidence}/3`}>
                <StarRating value={event.confidence} />
              </span>
            )}
          </div>

          {/* Meta row 1 */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
            <span className="flex items-center gap-1"><MapPin size={11} />{event.location}</span>
            {timeStr && <span className="flex items-center gap-1"><Clock size={11} />{timeStr}</span>}
            <span className="flex items-center gap-1"><Users size={11} />{event.num_guests} guests</span>
            <span className="flex items-center gap-1"><Phone size={11} />{event.contact_name}</span>
          </div>

          {/* Meta row 2 — financials always visible */}
          {(event.budget || event.deposit_paid) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mt-1">
              {event.budget && (
                <span className="flex items-center gap-1 font-medium">
                  <Euro size={11} />Budget: {fmtMoney(event.budget)}
                </span>
              )}
              {event.deposit_paid && (
                <span className="flex items-center gap-1">
                  Deposit paid: {fmtMoney(event.deposit_paid)}
                </span>
              )}
              {event.budget && event.deposit_paid && (
                <span className="flex items-center gap-1 text-gray-400">
                  Outstanding: {fmtMoney(event.budget - event.deposit_paid)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => alert('PDF generation coming soon — details to be configured')}
            className="flex items-center gap-1.5 text-xs text-[#1B5E20] bg-white border border-[#1B5E20]/30 hover:bg-[#1B5E20]/5 px-3 py-1.5 rounded-lg font-medium transition-colors shadow-sm"
          >
            <FileText size={13} />
            Generate Offer
          </button>
          <button
            onClick={() => onEdit(event)}
            className="text-gray-400 hover:text-indigo-500 transition-colors p-1"
            title="Edit"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => setExpanded(p => !p)}
            className="text-gray-400 hover:text-gray-700 transition-colors p-1"
            title={expanded ? 'Collapse' : 'Show notes & contact'}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* Expanded details — contact + notes */}
      {expanded && (
        <div className="border-t border-black/5 px-5 py-4 grid grid-cols-2 gap-4 text-xs bg-white/60">
          <div>
            <p className="text-gray-400 font-semibold uppercase tracking-wide mb-1">Contact</p>
            <p className="text-gray-700 font-medium">{event.contact_name}</p>
            {event.contact_email && (
              <p className="flex items-center gap-1 text-gray-500 mt-0.5"><Mail size={10} />{event.contact_email}</p>
            )}
            {event.contact_phone && (
              <p className="flex items-center gap-1 text-gray-500 mt-0.5"><Phone size={10} />{event.contact_phone}</p>
            )}
          </div>
          <div>
            <p className="text-gray-400 font-semibold uppercase tracking-wide mb-1">Package</p>
            {event.menu_package
              ? <p className="text-gray-700">{event.menu_package}</p>
              : <p className="text-gray-400 italic">Not specified</p>
            }
          </div>
          {event.notes && (
            <div className="col-span-2">
              <p className="text-gray-400 font-semibold uppercase tracking-wide mb-1">Notes</p>
              <p className="text-gray-600 whitespace-pre-line">{event.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function EventsPage() {
  const qc = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<EventDraft>(EMPTY_DRAFT);
  const [addError, setAddError] = useState('');

  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
  const [editDraft, setEditDraft] = useState<EventDraft>(EMPTY_DRAFT);
  const [editError, setEditError] = useState('');

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('event_date', { ascending: true });
      if (error) throw error;
      return data as EventRow[];
    },
  });

  const upcoming = events.filter(isUpcoming).filter(e => e.status !== 'cancelled');
  const past = events.filter(e => !isUpcoming(e) || e.status === 'cancelled');

  const cleanDraft = (draft: EventDraft) => ({
    ...draft,
    event_time_from: draft.event_time_from || null,
    event_time_until: draft.event_time_until || null,
    contact_email: draft.contact_email || null,
    contact_phone: draft.contact_phone || null,
    menu_package: draft.menu_package || null,
    notes: draft.notes || null,
    confidence: draft.status === 'tentative' ? (draft.confidence ?? 2) : null,
  });

  const createEvent = useMutation({
    mutationFn: async (draft: EventDraft) => {
      const { error } = await supabase.from('events').insert([cleanDraft(draft)]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      setShowAdd(false);
      setAddDraft(EMPTY_DRAFT);
      setAddError('');
    },
    onError: (e: any) => setAddError(e.message),
  });

  const updateEvent = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: EventDraft }) => {
      const { error } = await supabase.from('events').update(cleanDraft(draft)).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      setEditingEvent(null);
      setEditError('');
    },
    onError: (e: any) => setEditError(e.message),
  });

  const startEdit = (event: EventRow) => {
    setEditingEvent(event);
    setEditDraft({
      name: event.name,
      location: event.location,
      event_date: event.event_date,
      event_time_from: event.event_time_from ?? '',
      event_time_until: event.event_time_until ?? '',
      num_guests: event.num_guests,
      contact_name: event.contact_name,
      contact_email: event.contact_email ?? '',
      contact_phone: event.contact_phone ?? '',
      menu_package: event.menu_package ?? '',
      budget: event.budget,
      deposit_paid: event.deposit_paid,
      notes: event.notes ?? '',
      status: event.status,
      confidence: event.confidence ?? 2,
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Events</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage bookings, enquiries and offers</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddError(''); }}
          className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          Add New Event
        </button>
      </div>

      {showAdd && (
        <EventForm
          draft={addDraft}
          onChange={setAddDraft}
          onSubmit={() => createEvent.mutate(addDraft)}
          onCancel={() => { setShowAdd(false); setAddError(''); }}
          isPending={createEvent.isPending}
          error={addError}
        />
      )}

      {editingEvent && (
        <EventForm
          draft={editDraft}
          onChange={setEditDraft}
          onSubmit={() => updateEvent.mutate({ id: editingEvent.id, draft: editDraft })}
          onCancel={() => setEditingEvent(null)}
          isPending={updateEvent.isPending}
          error={editError}
          isEdit
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Current Events */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays size={16} className="text-[#1B5E20]" />
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Current Events</h2>
              <span className="ml-1 bg-[#1B5E20]/10 text-[#1B5E20] text-xs font-semibold px-2 py-0.5 rounded-full">
                {upcoming.length}
              </span>
            </div>
            {upcoming.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                <CalendarDays size={32} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">No upcoming events — add one above.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcoming.map(e => <EventCard key={e.id} event={e} onEdit={startEdit} />)}
              </div>
            )}
          </section>

          {/* Past Events */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Past Events</h2>
              <span className="ml-1 bg-gray-100 text-gray-500 text-xs font-semibold px-2 py-0.5 rounded-full">
                {past.length}
              </span>
            </div>
            {past.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                <p className="text-sm text-gray-400">No past events yet.</p>
              </div>
            ) : (
              <div className="space-y-3 opacity-80">
                {[...past].reverse().map(e => <EventCard key={e.id} event={e} onEdit={startEdit} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
