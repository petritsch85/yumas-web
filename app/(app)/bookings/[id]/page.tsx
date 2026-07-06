'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft, Send, EyeOff, Mail, Users, Calendar, MapPin,
  Clock, CheckCircle2, AlertCircle, Languages,
} from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type BookingType = 'regular' | 'group' | 'private_hire' | 'other' | 'not_booking';

type Inquiry = {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string | null;
  body_text: string | null;
  received_at: string;
  booking_type: BookingType;
  party_size: number | null;
  requested_date: string | null;
  requested_time: string | null;
  preferred_location: string | null;
  language: string;
  summary: string | null;
  draft_reply: string | null;
  status: 'draft' | 'ignored' | 'sent';
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const TYPE_LABELS: Record<BookingType, { label: string; color: string }> = {
  regular:      { label: 'Regular (<12 guests)',     color: 'bg-blue-100 text-blue-700' },
  group:        { label: 'Group (12–50 guests)',     color: 'bg-purple-100 text-purple-700' },
  private_hire: { label: 'Private Hire',             color: 'bg-orange-100 text-orange-700' },
  other:        { label: 'Other / General Enquiry',  color: 'bg-gray-100 text-gray-600' },
  not_booking:  { label: 'Not a Booking',            color: 'bg-gray-100 text-gray-400' },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtRequestedDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function BookingDetailPage() {
  const router      = useRouter();
  const { id }      = useParams<{ id: string }>() ?? {};
  const qc          = useQueryClient();

  const [replyText, setReplyText] = useState('');
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState(false);

  const { data: inquiry, isLoading } = useQuery({
    queryKey: ['booking_inquiry', id],
    queryFn: async () => {
      const res = await fetch(`/api/bookings/${id}`);
      if (!res.ok) throw new Error('Not found');
      return res.json() as Promise<Inquiry>;
    },
    enabled: !!id,
  });

  // Pre-fill reply textarea once inquiry loads
  useEffect(() => {
    if (inquiry?.draft_reply && !replyText) {
      setReplyText(inquiry.draft_reply);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiry]);

  const sendMut = useMutation({
    mutationFn: async () => {
      const res  = await fetch(`/api/bookings/${id}/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reply_text: replyText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Send failed');
    },
    onSuccess: () => {
      setSendSuccess(true);
      setSendError('');
      qc.invalidateQueries({ queryKey: ['booking_inquiries'] });
      qc.invalidateQueries({ queryKey: ['booking_inquiry', id] });
    },
    onError: (e: any) => setSendError(e.message),
  });

  const ignoreMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ignored' }),
      });
      if (!res.ok) throw new Error('Failed to update');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking_inquiries'] });
      router.push('/bookings');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-4 border-gray-200 border-t-[#1B5E20] rounded-full animate-spin" />
      </div>
    );
  }

  if (!inquiry) {
    return (
      <div className="text-center py-20 text-gray-400">Inquiry not found.</div>
    );
  }

  const typeCfg  = TYPE_LABELS[inquiry.booking_type];
  const isSent   = inquiry.status === 'sent';
  const isIgnored = inquiry.status === 'ignored';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back */}
      <button
        onClick={() => router.push('/bookings')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Inbox
      </button>

      {/* Status banner for sent/ignored */}
      {isSent && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-green-800">
          <CheckCircle2 size={16} className="text-green-600" />
          Reply sent to <strong>{inquiry.from_email}</strong>
        </div>
      )}
      {isIgnored && (
        <div className="mb-4 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-gray-500">
          <EyeOff size={16} /> This request has been marked as ignored.
        </div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Left column — original email */}
        <div className="col-span-2 space-y-4">

          {/* Email meta */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[#1B5E20]/10 flex items-center justify-center flex-shrink-0">
                <Mail size={18} className="text-[#1B5E20]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">
                    {inquiry.from_name || inquiry.from_email}
                  </span>
                  {inquiry.from_name && (
                    <span className="text-xs text-gray-400">&lt;{inquiry.from_email}&gt;</span>
                  )}
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-semibold ${typeCfg.color}`}>
                    {typeCfg.label}
                  </span>
                </div>
                <div className="text-sm font-medium text-gray-700 mt-0.5">
                  {inquiry.subject ?? '(no subject)'}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                  <Clock size={11} />{fmtDate(inquiry.received_at)}
                </div>
              </div>
            </div>

            {/* Email body */}
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-mono text-xs border border-gray-100">
              {inquiry.body_text ?? '(no body text)'}
            </div>
          </div>

          {/* Draft reply editor */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">
              {isSent ? 'Sent Reply' : 'Draft Reply'}
            </h2>

            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              disabled={isSent}
              rows={12}
              className="w-full border border-gray-200 rounded-lg px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 resize-none disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="Draft reply will appear here after scanning…"
            />

            {sendError && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle size={13} /> {sendError}
              </div>
            )}

            {sendSuccess && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-green-700">
                <CheckCircle2 size={13} /> Email sent successfully!
              </div>
            )}

            {!isSent && (
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => sendMut.mutate()}
                  disabled={sendMut.isPending || !replyText.trim()}
                  className="bg-[#1B5E20] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Send size={14} />
                  {sendMut.isPending ? 'Sending…' : 'Approve & Send'}
                </button>

                {!isIgnored && (
                  <button
                    onClick={() => ignoreMut.mutate()}
                    disabled={ignoreMut.isPending}
                    className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                  >
                    <EyeOff size={14} />
                    Ignore
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column — analysis panel */}
        <div className="space-y-4">

          {/* Claude analysis */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
              AI Analysis
            </h2>

            <div className="space-y-3">
              {/* Booking type */}
              <div>
                <div className="text-xs text-gray-400 mb-1">Booking type</div>
                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${typeCfg.color}`}>
                  {typeCfg.label}
                </span>
              </div>

              {/* Party size */}
              {inquiry.party_size != null && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Users size={14} className="text-gray-400 flex-shrink-0" />
                  <span><strong>{inquiry.party_size}</strong> guests</span>
                </div>
              )}

              {/* Requested date */}
              {inquiry.requested_date && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                  <span>{fmtRequestedDate(inquiry.requested_date)}</span>
                  {inquiry.requested_time && (
                    <span className="text-gray-400">at {inquiry.requested_time}</span>
                  )}
                </div>
              )}

              {/* Location */}
              {inquiry.preferred_location && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <MapPin size={14} className="text-gray-400 flex-shrink-0" />
                  <span>Yumas {inquiry.preferred_location}</span>
                </div>
              )}

              {/* Language */}
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Languages size={14} className="text-gray-400 flex-shrink-0" />
                <span className="uppercase text-xs font-semibold tracking-wide text-gray-500">
                  {inquiry.language === 'de' ? 'Deutsch' : 'English'}
                </span>
              </div>
            </div>
          </div>

          {/* Summary */}
          {inquiry.summary && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Summary
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed">{inquiry.summary}</p>
            </div>
          )}

          {/* Reply to */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Reply to
            </h2>
            <div className="text-sm text-gray-700 font-medium">
              {inquiry.from_name ?? inquiry.from_email}
            </div>
            {inquiry.from_name && (
              <div className="text-xs text-gray-400 mt-0.5 break-all">{inquiry.from_email}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
