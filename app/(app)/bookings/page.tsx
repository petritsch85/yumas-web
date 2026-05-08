'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';
import {
  Mail, RefreshCw, Users, MapPin, Calendar, ChevronRight,
  Inbox, CheckCircle2, Send, EyeOff, Clock,
} from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type BookingType = 'regular' | 'group' | 'private_hire' | 'other' | 'not_booking';
type InquiryStatus = 'draft' | 'ignored' | 'sent';

type Inquiry = {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string | null;
  received_at: string;
  booking_type: BookingType;
  party_size: number | null;
  requested_date: string | null;
  preferred_location: string | null;
  language: string;
  summary: string | null;
  status: InquiryStatus;
  created_at: string;
};

type StatusFilter = 'all' | InquiryStatus;

/* ─── Config ─────────────────────────────────────────────────────────────── */
const BOOKING_TYPE_LABELS: Record<BookingType, { label: string; color: string }> = {
  regular:      { label: 'Regular',      color: 'bg-blue-100 text-blue-700' },
  group:        { label: 'Group',        color: 'bg-purple-100 text-purple-700' },
  private_hire: { label: 'Private Hire', color: 'bg-orange-100 text-orange-700' },
  other:        { label: 'Other',        color: 'bg-gray-100 text-gray-600' },
  not_booking:  { label: 'Not a Booking',color: 'bg-gray-100 text-gray-400' },
};

const STATUS_FILTERS: { key: StatusFilter; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'all',     label: 'All',     icon: Inbox },
  { key: 'draft',   label: 'New',     icon: Clock },
  { key: 'sent',    label: 'Replied', icon: Send },
  { key: 'ignored', label: 'Ignored', icon: EyeOff },
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtRequestedDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function BookingsPage() {
  const router = useRouter();
  const qc     = useQueryClient();
  const [filter, setFilter]   = useState<StatusFilter>('all');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ processed: number; bookings: number } | null>(null);

  const { data: inquiries = [], isLoading } = useQuery({
    queryKey: ['booking_inquiries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_inquiries')
        .select('id,from_name,from_email,subject,received_at,booking_type,party_size,requested_date,preferred_location,language,summary,status,created_at')
        .neq('booking_type', 'not_booking')
        .order('received_at', { ascending: false });
      if (error) throw error;
      return data as Inquiry[];
    },
  });

  const filtered = filter === 'all' ? inquiries : inquiries.filter(i => i.status === filter);

  const counts: Record<StatusFilter, number> = {
    all:     inquiries.length,
    draft:   inquiries.filter(i => i.status === 'draft').length,
    sent:    inquiries.filter(i => i.status === 'sent').length,
    ignored: inquiries.filter(i => i.status === 'ignored').length,
  };

  const ignoreMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('booking_inquiries')
        .update({ status: 'ignored' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking_inquiries'] }),
  });

  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res  = await fetch('/api/bookings/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Scan failed');
      setScanResult(data);
      qc.invalidateQueries({ queryKey: ['booking_inquiries'] });
    } catch (err: any) {
      alert('Scan error: ' + err.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Booking Requests</h1>
          <p className="text-sm text-gray-500 mt-0.5">Incoming event & table enquiries via email</p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw size={15} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning…' : 'Scan for New Requests'}
        </button>
      </div>

      {/* Scan result banner */}
      {scanResult && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
          <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
          <span className="text-green-800">
            Scanned <strong>{scanResult.processed}</strong> email{scanResult.processed !== 1 ? 's' : ''} —{' '}
            <strong>{scanResult.bookings}</strong> new booking request{scanResult.bookings !== 1 ? 's' : ''} found.
          </span>
          <button onClick={() => setScanResult(null)} className="ml-auto text-green-500 hover:text-green-700">×</button>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-gray-200">
        {STATUS_FILTERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
              filter === key
                ? 'border-[#1B5E20] text-[#1B5E20]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={14} />
            {label}
            {counts[key] > 0 && (
              <span className={`ml-1 text-xs rounded-full px-1.5 py-0.5 font-semibold ${
                filter === key ? 'bg-[#1B5E20]/10 text-[#1B5E20]' : 'bg-gray-100 text-gray-500'
              }`}>
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Mail size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">
            {filter === 'all'
              ? 'No booking requests yet — click "Scan for New Requests" to check your inbox.'
              : `No ${filter} requests.`}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">From</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Details</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Received</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((inq, idx) => {
                const typeCfg = BOOKING_TYPE_LABELS[inq.booking_type];
                return (
                  <tr
                    key={inq.id}
                    className={`border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${
                      idx === filtered.length - 1 ? 'border-b-0' : ''
                    } ${inq.status === 'draft' ? 'bg-blue-50/30' : ''}`}
                    onClick={() => router.push(`/bookings/${inq.id}`)}
                  >
                    {/* From */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 truncate max-w-[160px]">
                        {inq.from_name || inq.from_email}
                      </div>
                      {inq.from_name && (
                        <div className="text-xs text-gray-400 truncate max-w-[160px]">{inq.from_email}</div>
                      )}
                    </td>

                    {/* Subject */}
                    <td className="px-4 py-3">
                      <span className="text-gray-700 truncate max-w-[220px] block">{inq.subject ?? '(no subject)'}</span>
                    </td>

                    {/* Type badge */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${typeCfg.color}`}>
                        {typeCfg.label}
                      </span>
                    </td>

                    {/* Details chips */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {inq.party_size && (
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Users size={11} />{inq.party_size} guests
                          </span>
                        )}
                        {inq.requested_date && (
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Calendar size={11} />{fmtRequestedDate(inq.requested_date)}
                          </span>
                        )}
                        {inq.preferred_location && (
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <MapPin size={11} />{inq.preferred_location}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Received */}
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {fmtDate(inq.received_at)}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {inq.status === 'draft' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                          <Clock size={10} /> New
                        </span>
                      )}
                      {inq.status === 'sent' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                          <Send size={10} /> Replied
                        </span>
                      )}
                      {inq.status === 'ignored' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          <EyeOff size={10} /> Ignored
                        </span>
                      )}
                    </td>

                    {/* Chevron */}
                    <td className="px-3 py-3">
                      <ChevronRight size={15} className="text-gray-300" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
