'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/lib/i18n';

function getWeekDates(startDate: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d;
  });
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export default function CalendarPage() {
  const { t } = useT();
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));

  const weekDates = getWeekDates(weekStart);
  const weekEnd = new Date(weekDates[6]);
  weekEnd.setHours(23, 59, 59);

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['delivery-schedules', weekStart.toISOString()],
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_schedules')
        .select('*, supplier:suppliers(id, name)')
        .gte('delivery_date', weekStart.toISOString().split('T')[0])
        .lte('delivery_date', weekEnd.toISOString().split('T')[0]);
      return data ?? [];
    },
  });

  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const getDeliveriesForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return (schedules as Record<string, unknown>[] ?? []).filter((s) => s.delivery_date === dateStr);
  };

  const monthLabel = weekDates[0].toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('calendar.title')}</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={prevWeek}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-36 text-center">{monthLabel}</span>
          <button
            onClick={nextWeek}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-7 gap-3">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-48 bg-white rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-3">
          {weekDates.map((date, i) => {
            const deliveries = getDeliveriesForDate(date);
            const isToday = date.toDateString() === new Date().toDateString();
            return (
              <div
                key={i}
                className={`bg-white rounded-lg border p-3 min-h-40 ${isToday ? 'border-[#1B5E20]' : 'border-gray-100'}`}
              >
                <div className="mb-2">
                  <div className={`text-xs font-semibold uppercase ${isToday ? 'text-[#1B5E20]' : 'text-gray-400'}`}>
                    {DAY_NAMES[i]}
                  </div>
                  <div className={`text-lg font-bold ${isToday ? 'text-[#1B5E20]' : 'text-gray-800'}`}>
                    {date.getDate()}
                  </div>
                </div>
                {deliveries.length === 0 ? (
                  <div className="text-xs text-gray-300 mt-2">{t('calendar.noDeliveries')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {deliveries.map((s, j) => (
                      <div
                        key={j}
                        className="text-xs px-2 py-1 rounded-md font-medium truncate"
                        style={{ backgroundColor: '#E8F5E9', color: '#1B5E20' }}
                      >
                        {(s.supplier as { name: string } | null)?.name ?? '—'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-400 text-center">
        Week of {weekDates[0].toLocaleDateString('en-GB')} — {weekDates[6].toLocaleDateString('en-GB')}
      </div>
    </div>
  );
}
