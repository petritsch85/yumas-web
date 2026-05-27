'use client';

import { useState } from 'react';
import { Package, Truck, UtensilsCrossed, Moon, CheckCircle2, ArrowRight } from 'lucide-react';

/* ─── Types ──────────────────────────────────────────────────────────────── */
type StepType = 'inventory' | 'lunch' | 'dinner' | 'delivery' | 'end';

type Step = {
  label: string;
  type: StepType;
};

type Cycle = {
  day: string;
  shortDay: string; // Mon, Tue, etc.
  steps: Step[];
};

/* ─── Data ───────────────────────────────────────────────────────────────── */
const CYCLES: Record<string, Cycle[]> = {
  Westend: [
    {
      day: 'Monday',
      shortDay: 'Mon',
      steps: [
        { label: 'Sun Inventory', type: 'inventory' },
        { label: 'Mon Lunch', type: 'lunch' },
        { label: 'Mon Delivery', type: 'delivery' },
        { label: 'Tue Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Tuesday',
      shortDay: 'Tue',
      steps: [
        { label: 'Mon Inventory', type: 'inventory' },
        { label: 'Tue Lunch', type: 'lunch' },
        { label: 'Tue Delivery', type: 'delivery' },
        { label: 'Tue Dinner', type: 'dinner' },
        { label: 'Wed Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Wednesday',
      shortDay: 'Wed',
      steps: [
        { label: 'Tue Inventory', type: 'inventory' },
        { label: 'Wed Lunch', type: 'lunch' },
        { label: 'Wed Delivery', type: 'delivery' },
        { label: 'Wed Dinner', type: 'dinner' },
        { label: 'Thu Lunch', type: 'lunch' },
        { label: 'Thu Dinner', type: 'dinner' },
        { label: 'Fri Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Friday',
      shortDay: 'Fri',
      steps: [
        { label: 'Thu Inventory', type: 'inventory' },
        { label: 'Fri Lunch', type: 'lunch' },
        { label: 'Fri Delivery', type: 'delivery' },
        { label: 'Fri Dinner', type: 'dinner' },
        { label: 'Sat Dinner', type: 'dinner' },
        { label: 'Sun Dinner', type: 'dinner' },
        { label: 'End', type: 'end' },
      ],
    },
  ],
  Eschborn: [
    {
      day: 'Monday',
      shortDay: 'Mon',
      steps: [
        { label: 'Sat Inventory', type: 'inventory' },
        { label: 'Mon Lunch', type: 'lunch' },
        { label: 'Mon Delivery', type: 'delivery' },
        { label: 'Mon Dinner', type: 'dinner' },
        { label: 'Tue Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Tuesday',
      shortDay: 'Tue',
      steps: [
        { label: 'Mon Inventory', type: 'inventory' },
        { label: 'Tue Lunch', type: 'lunch' },
        { label: 'Tue Delivery', type: 'delivery' },
        { label: 'Tue Dinner', type: 'dinner' },
        { label: 'Wed Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Wednesday',
      shortDay: 'Wed',
      steps: [
        { label: 'Tue Inventory', type: 'inventory' },
        { label: 'Wed Lunch', type: 'lunch' },
        { label: 'Wed Delivery', type: 'delivery' },
        { label: 'Wed Dinner', type: 'dinner' },
        { label: 'Thu Lunch', type: 'lunch' },
        { label: 'Thu Dinner', type: 'dinner' },
        { label: 'Fri Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Friday',
      shortDay: 'Fri',
      steps: [
        { label: 'Thu Inventory', type: 'inventory' },
        { label: 'Fri Lunch', type: 'lunch' },
        { label: 'Fri Delivery', type: 'delivery' },
        { label: 'Fri Dinner', type: 'dinner' },
        { label: 'Sat Dinner', type: 'dinner' },
        { label: 'End', type: 'end' },
      ],
    },
  ],
  Taunus: [
    {
      day: 'Monday',
      shortDay: 'Mon',
      steps: [
        { label: 'Sat Inventory', type: 'inventory' },
        { label: 'Mon Lunch', type: 'lunch' },
        { label: 'Mon Delivery', type: 'delivery' },
        { label: 'Tue Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Tuesday',
      shortDay: 'Tue',
      steps: [
        { label: 'Mon Inventory', type: 'inventory' },
        { label: 'Tue Lunch', type: 'lunch' },
        { label: 'Tue Delivery', type: 'delivery' },
        { label: 'Tue Dinner', type: 'dinner' },
        { label: 'Wed Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Wednesday',
      shortDay: 'Wed',
      steps: [
        { label: 'Tue Inventory', type: 'inventory' },
        { label: 'Wed Lunch', type: 'lunch' },
        { label: 'Wed Delivery', type: 'delivery' },
        { label: 'Wed Dinner', type: 'dinner' },
        { label: 'Thu Lunch', type: 'lunch' },
        { label: 'Thu Dinner', type: 'dinner' },
        { label: 'Fri Lunch', type: 'lunch' },
        { label: 'End', type: 'end' },
      ],
    },
    {
      day: 'Friday',
      shortDay: 'Fri',
      steps: [
        { label: 'Thu Inventory', type: 'inventory' },
        { label: 'Fri Lunch', type: 'lunch' },
        { label: 'Fri Delivery', type: 'delivery' },
        { label: 'Fri Dinner', type: 'dinner' },
        { label: 'Sat Dinner', type: 'dinner' },
        { label: 'End', type: 'end' },
      ],
    },
  ],
};

const STORES = ['Westend', 'Eschborn', 'Taunus'] as const;
type Store = (typeof STORES)[number];

/* ─── Step styling ───────────────────────────────────────────────────────── */
const STEP_STYLES: Record<StepType, { bg: string; border: string; text: string; label: string }> = {
  inventory: {
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-700',
    label: 'Inventory',
  },
  lunch: {
    bg: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-700',
    label: 'Lunch shift',
  },
  dinner: {
    bg: 'bg-indigo-50',
    border: 'border-indigo-300',
    text: 'text-indigo-700',
    label: 'Dinner shift',
  },
  delivery: {
    bg: 'bg-amber-100',
    border: 'border-amber-400',
    text: 'text-amber-800',
    label: 'Delivery arrives',
  },
  end: {
    bg: 'bg-gray-50',
    border: 'border-gray-300',
    text: 'text-gray-500',
    label: 'End (must be > 0)',
  },
};

function StepIcon({ type }: { type: StepType }) {
  const cls = 'flex-shrink-0';
  if (type === 'inventory')  return <Package size={14} className={cls} />;
  if (type === 'delivery')   return <Truck size={14} className={cls} />;
  if (type === 'lunch')      return <UtensilsCrossed size={14} className={cls} />;
  if (type === 'dinner')     return <Moon size={14} className={cls} />;
  return <CheckCircle2 size={14} className={cls} />;
}

function StepChip({ step, isLast }: { step: Step; isLast: boolean }) {
  const s = STEP_STYLES[step.type];
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <div
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold ${s.bg} ${s.border} ${s.text} ${
          step.type === 'delivery' ? 'shadow-sm ring-1 ring-amber-300' : ''
        }`}
      >
        <StepIcon type={step.type} />
        <span>{step.label}</span>
      </div>
      {!isLast && (
        <ArrowRight size={14} className="text-gray-300 flex-shrink-0" />
      )}
    </div>
  );
}

function CycleCard({ cycle }: { cycle: Cycle }) {
  const shiftsBeforeDelivery = cycle.steps.filter(
    (s, i) => s.type !== 'inventory' && s.type !== 'delivery' && s.type !== 'end' &&
    i < cycle.steps.findIndex(x => x.type === 'delivery')
  ).length;
  const shiftsAfterDelivery = cycle.steps.filter(
    (s, i) => s.type !== 'inventory' && s.type !== 'delivery' && s.type !== 'end' &&
    i > cycle.steps.findIndex(x => x.type === 'delivery')
  ).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#1B5E20] flex items-center justify-center flex-shrink-0">
            <Truck size={14} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900">{cycle.day} Delivery</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {shiftsBeforeDelivery} shift{shiftsBeforeDelivery !== 1 ? 's' : ''} before ·{' '}
              {shiftsAfterDelivery} shift{shiftsAfterDelivery !== 1 ? 's' : ''} after · must last until next delivery
            </div>
          </div>
        </div>
        <div className="text-xs font-bold text-[#1B5E20] bg-[#1B5E20]/8 px-2.5 py-1 rounded-lg border border-[#1B5E20]/20">
          {cycle.steps.length - 2} shifts
        </div>
      </div>

      {/* Timeline */}
      <div className="px-5 py-4 overflow-x-auto">
        <div className="flex items-center gap-1.5 min-w-max">
          {cycle.steps.map((step, i) => (
            <StepChip key={i} step={step} isLast={i === cycle.steps.length - 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Legend ─────────────────────────────────────────────────────────────── */
function Legend() {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {(Object.entries(STEP_STYLES) as [StepType, typeof STEP_STYLES[StepType]][]).map(([type, s]) => (
        <div key={type} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${s.bg} ${s.border} ${s.text}`}>
          <StepIcon type={type} />
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function DeliveryCyclesPage() {
  const [activeStore, setActiveStore] = useState<Store>('Westend');
  const cycles = CYCLES[activeStore];

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Delivery Cycles</h1>
        <p className="text-sm text-gray-500 mt-1">
          Standard chronology of shifts and deliveries per store. The End value must be positive — meaning stock doesn&apos;t run out before the next delivery arrives.
        </p>
      </div>

      {/* Store tabs */}
      <div className="flex gap-2 flex-wrap">
        {STORES.map(store => (
          <button
            key={store}
            onClick={() => setActiveStore(store)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              activeStore === store
                ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                : 'bg-white text-[#1B5E20] border-[#1B5E20] hover:bg-[#1B5E20]/5'
            }`}
          >
            {store}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-3.5">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5">Legend</div>
        <Legend />
      </div>

      {/* Delivery cycle cards */}
      <div className="space-y-4">
        {cycles.map(cycle => (
          <CycleCard key={cycle.day} cycle={cycle} />
        ))}
      </div>

      {/* Store differences callout */}
      {activeStore === 'Westend' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <span className="font-bold">Westend only:</span> Friday delivery must cover Fri Dinner + Sat Dinner + <span className="font-semibold">Sun Dinner</span> before the Monday delivery arrives — the longest cycle of all three stores.
        </div>
      )}
      {activeStore === 'Eschborn' && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800">
          <span className="font-bold">Eschborn only:</span> Monday inventory is taken on <span className="font-semibold">Saturday</span> (not Sunday). Monday delivery also covers <span className="font-semibold">Monday Dinner</span> in addition to Tuesday Lunch.
        </div>
      )}
      {activeStore === 'Taunus' && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-700">
          <span className="font-bold">Taunus:</span> Monday inventory taken on <span className="font-semibold">Saturday</span>. Monday delivery covers Tuesday Lunch only — no Monday Dinner shift to bridge. Friday cycle ends at Saturday Dinner.
        </div>
      )}
    </div>
  );
}
