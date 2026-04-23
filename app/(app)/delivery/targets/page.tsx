'use client';

import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Upload, Target, ChevronDown, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type TargetRow = {
  id: string;
  location_name: string;
  section: string;
  item_name: string;
  unit: string;
  mon_target: number;
  tue_target: number;
  wed_target: number;
  fri_target: number;
};

type DayKey = 'mon_target' | 'tue_target' | 'wed_target' | 'fri_target';

type ParsedItem = {
  section: string;
  item_name: string;
  unit: string;
  mon_target: number;
  tue_target: number;
  wed_target: number;
  fri_target: number;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = typeof STORES[number];

const SECTIONS = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

const DAY_COLS: { key: DayKey; label: string }[] = [
  { key: 'mon_target', label: 'Mon' },
  { key: 'tue_target', label: 'Tue' },
  { key: 'wed_target', label: 'Wed' },
  { key: 'fri_target', label: 'Fri' },
];

/* ─── Inline editable cell ───────────────────────────────────────────────── */
function EditableCell({
  value,
  onSave,
}: {
  value: number;
  onSave: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const parsed = parseFloat(draft);
    if (!isNaN(parsed) && parsed !== value) {
      onSave(parsed);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-16 border border-[#1B5E20]/40 rounded px-1.5 py-0.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      className="w-16 text-sm text-center text-gray-700 hover:bg-[#1B5E20]/5 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
      title="Click to edit"
    >
      {value === 0 ? <span className="text-gray-300">—</span> : value}
    </button>
  );
}

/* ─── Section group ──────────────────────────────────────────────────────── */
function SectionGroup({
  section,
  rows,
  onUpdate,
}: {
  section: string;
  rows: TargetRow[];
  onUpdate: (id: string, key: DayKey, value: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Section header */}
      <tr
        className="bg-gray-50 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <td colSpan={6} className="px-4 py-2">
          <div className="flex items-center gap-2">
            {collapsed
              ? <ChevronRight size={13} className="text-gray-400" />
              : <ChevronDown size={13} className="text-gray-400" />
            }
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {section}
            </span>
            <span className="ml-1 text-xs text-gray-400 font-normal">
              {rows.length} item{rows.length !== 1 ? 's' : ''}
            </span>
          </div>
        </td>
      </tr>

      {!collapsed && rows.map(row => (
        <tr key={row.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
          <td className="px-4 py-2 text-sm text-gray-800">{row.item_name}</td>
          <td className="px-4 py-2 text-xs text-gray-500">{row.unit}</td>
          {DAY_COLS.map(({ key }) => (
            <td key={key} className="px-2 py-2 text-center">
              <EditableCell
                value={row[key]}
                onSave={v => onUpdate(row.id, key, v)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function DeliveryTargetsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [activeStore, setActiveStore] = useState<Store>('Eschborn');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  /* ─ Query ─ */
  const { data: targets = [], isLoading } = useQuery({
    queryKey: ['delivery-targets', activeStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_targets')
        .select('*')
        .eq('location_name', activeStore)
        .order('section')
        .order('item_name');
      if (error) throw error;
      return data as TargetRow[];
    },
  });

  /* ─ Update single cell ─ */
  const updateTarget = useMutation({
    mutationFn: async ({ id, key, value }: { id: string; key: DayKey; value: number }) => {
      const { error } = await supabase
        .from('delivery_targets')
        .update({ [key]: value })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-targets', activeStore] });
    },
  });

  /* ─ Upsert from Excel ─ */
  const upsertTargets = useMutation({
    mutationFn: async (rows: ParsedItem[]) => {
      const payload = rows.map(r => ({
        location_name: activeStore,
        section: r.section,
        item_name: r.item_name,
        unit: r.unit,
        mon_target: r.mon_target,
        tue_target: r.tue_target,
        wed_target: r.wed_target,
        fri_target: r.fri_target,
      }));
      const { error } = await supabase
        .from('delivery_targets')
        .upsert(payload, { onConflict: 'location_name,item_name' });
      if (error) throw error;
    },
    onSuccess: (_, rows) => {
      qc.invalidateQueries({ queryKey: ['delivery-targets', activeStore] });
      setUploadMsg(`Imported ${rows.length} items successfully.`);
      setTimeout(() => setUploadMsg(''), 4000);
    },
    onError: (e: any) => {
      setUploadMsg(`Error: ${e.message}`);
    },
  });

  /* ─ Excel parse ─ */
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const parsed: ParsedItem[] = [];
      let currentSection = 'Uncategorised';

      // Skip rows 0 and 1 (headers), start from row 2
      for (let i = 2; i < raw.length; i++) {
        const row = raw[i];
        const colA = String(row[0] ?? '').trim();
        const colC = String(row[2] ?? '').trim();
        const colD = row[3];
        const colE = row[4];
        const colF = row[5];
        const colG = row[6];

        if (!colA) continue; // completely empty row

        const hasUnit = colC !== '';
        const hasNumbers = [colD, colE, colF, colG].some(v => v !== '' && !isNaN(Number(v)));

        if (!hasUnit && !hasNumbers) {
          // Section header row
          currentSection = colA;
          continue;
        }

        // Data item
        parsed.push({
          section: currentSection,
          item_name: colA,
          unit: colC,
          mon_target: parseFloat(String(colD)) || 0,
          tue_target: parseFloat(String(colE)) || 0,
          wed_target: parseFloat(String(colF)) || 0,
          fri_target: parseFloat(String(colG)) || 0,
        });
      }

      if (parsed.length === 0) {
        setUploadMsg('No data rows found in the file.');
      } else {
        upsertTargets.mutate(parsed);
      }
    } catch (err: any) {
      setUploadMsg(`Parse error: ${err.message}`);
    } finally {
      setUploading(false);
      // Reset file input so same file can be re-uploaded
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /* ─ Group by section ─ */
  const grouped = SECTIONS.reduce<Record<string, TargetRow[]>>((acc, sec) => {
    acc[sec] = targets.filter(t => t.section === sec);
    return acc;
  }, {});
  // Also collect any unknown sections
  const knownSections = new Set(SECTIONS);
  const otherSections = [...new Set(targets.map(t => t.section).filter(s => !knownSections.has(s)))];

  const totalItems = targets.length;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Target size={20} className="text-[#1B5E20]" />
            <h1 className="text-2xl font-bold text-gray-900">Target Levels</h1>
          </div>
          <p className="text-sm text-gray-500">
            Set daily delivery targets per store — click any number to edit inline
          </p>
        </div>

        <div className="flex items-center gap-3">
          {uploadMsg && (
            <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
              uploadMsg.startsWith('Error') || uploadMsg.startsWith('Parse')
                ? 'bg-red-50 text-red-600'
                : 'bg-green-50 text-green-700'
            }`}>
              {uploadMsg}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || upsertTargets.isPending}
            className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Upload size={15} />
            {uploading || upsertTargets.isPending ? 'Importing…' : 'Upload Excel'}
          </button>
        </div>
      </div>

      {/* Store tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
        {STORES.map(store => (
          <button
            key={store}
            onClick={() => setActiveStore(store)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeStore === store
                ? 'bg-white text-[#1B5E20] shadow-sm font-semibold'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {store}
          </button>
        ))}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${60 + (i % 3) * 15}%` }} />
            ))}
          </div>
        ) : totalItems === 0 ? (
          <div className="p-12 text-center">
            <Target size={36} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400 mb-1">No targets set for {activeStore}</p>
            <p className="text-xs text-gray-300">Upload an Excel file or add items to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-[40%]">
                    Item Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Unit
                  </th>
                  {DAY_COLS.map(({ key, label }) => (
                    <th key={key} className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map(section => {
                  const rows = grouped[section] ?? [];
                  if (rows.length === 0) return null;
                  return (
                    <SectionGroup
                      key={section}
                      section={section}
                      rows={rows}
                      onUpdate={(id, key, value) =>
                        updateTarget.mutate({ id, key, value })
                      }
                    />
                  );
                })}
                {otherSections.map(section => {
                  const rows = targets.filter(t => t.section === section);
                  return (
                    <SectionGroup
                      key={section}
                      section={section}
                      rows={rows}
                      onUpdate={(id, key, value) =>
                        updateTarget.mutate({ id, key, value })
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {totalItems > 0 && (
          <div className="border-t border-gray-50 px-4 py-2 bg-gray-50/50">
            <p className="text-xs text-gray-400">
              {totalItems} item{totalItems !== 1 ? 's' : ''} · {activeStore}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
