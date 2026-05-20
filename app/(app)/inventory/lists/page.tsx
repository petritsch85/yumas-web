'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useT } from '@/lib/i18n';

/* ─── Stores ────────────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = (typeof STORES)[number];

/* ─── Item list (single source of truth — other pages will migrate here) ────── */
type Item    = { name: string; unit: string };
type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: 'Kühlhaus',
    items: [
      { name: 'Guacamole',                    unit: '1/6 GN groß' },
      { name: 'Schärfemix',                   unit: 'Beutel (0.5kg)' },
      { name: 'Maissalsa',                    unit: '1/6 GN groß' },
      { name: 'Tomatensalsa',                 unit: '1/6 GN groß' },
      { name: 'Sour Cream',                   unit: '1/6 GN groß' },
      { name: 'Marinade Chicken',             unit: 'Beutel (1.0kg)' },
      { name: 'Pico de Gallo',                unit: '1/2 GN' },
      { name: 'Crema Nogada',                 unit: 'Beutel (1.0kg)' },
      { name: 'Käse Gouda',                   unit: 'Beutel (5.0kg)' },
      { name: 'Gouda Scheiben Gringa',        unit: 'Packung' },
      { name: 'Ciabatta',                     unit: 'Stück' },
      { name: 'Brownie',                      unit: 'Blech' },
      { name: 'Carlota de Limon',             unit: 'Stück' },
      { name: 'Schoko- Avocado Mousse',       unit: 'Blech' },
      { name: 'Mole',                         unit: '1/6 GN groß' },
      { name: 'Marinade Al Pastor',           unit: 'Beutel (1.5kg)' },
      { name: 'Barbacoa',                     unit: '1/6 GN groß' },
      { name: 'Chili con Carne',              unit: '1/6 GN groß' },
      { name: 'Cochinita',                    unit: '1/6 GN groß' },
      { name: 'Kartoffel Würfel',             unit: 'Beutel (3.0kg)' },
      { name: 'Vinaigrette',                  unit: 'Behälter (1.0l)' },
      { name: 'Honig Sesam / Senf',           unit: 'Behälter (1.0l)' },
      { name: 'Pozole',                       unit: 'Beutel (1.0kg)' },
      { name: 'Zwiebeln karamellisiert',      unit: 'Beutel (1.0kg)' },
      { name: 'Karotten karamellisiert',      unit: 'Beutel (10 Stück)' },
      { name: 'Bohnencreme',                  unit: 'Beutel (2.5kg)' },
      { name: 'Alambre - Zwiebel',            unit: 'Beutel (2.0kg)' },
      { name: 'Weizen Tortillas 12cm',        unit: 'Kisten' },
      { name: 'Tortillas 30cm',               unit: 'Kisten' },
      { name: 'Frische Habaneros',            unit: 'Stück' },
      { name: 'Salsa Habanero',               unit: 'Beutel (1.5kg)' },
      { name: 'Salsa Verde',                  unit: 'Beutel (2.0kg)' },
      { name: 'Chipotle SourCream',           unit: 'Beutel (2.0kg)' },
      { name: 'Salsa de Jamaica',             unit: 'Beutel (0.5kg)' },
      { name: 'Salsa Torta',                  unit: 'Beutel (1.0kg)' },
      { name: 'Humo Salsa',                   unit: 'Flasche' },
      { name: 'Fuego Salsa',                  unit: 'Flasche' },
      { name: 'Oliven entkernt',              unit: 'Glas' },
      { name: 'Chiles Poblanos',              unit: 'Stück' },
      { name: 'Salsa Pitaya',                 unit: 'Beutel (0.5kg)' },
      { name: 'Mais Tortillas 12cm',          unit: 'Beutel (50 Stk)' },
      { name: 'Blau Mais Tortillas 15cm',     unit: 'Beutel (40 Stk)' },
      { name: 'Queso Cotija',                 unit: 'Pack (1.0kg)' },
      { name: 'Queso Oaxaca',                 unit: 'Pack (1.0kg)' },
      { name: 'Queso Chihuahua',              unit: 'Pack (1.0kg)' },
      { name: 'Rinderfilet Steak',            unit: 'Beutel (250g)' },
      { name: 'Filetspitzen',                 unit: 'Beutel (100g)' },
      { name: 'Hähnchenkeule (ganz)',         unit: 'Beutel (2 Stück)' },
      { name: 'Mole Rojo',                    unit: 'Beutel (2.0kg)' },
      { name: 'Chorizo',                      unit: 'Beutel (1.0kg)' },
      { name: 'Carne Vegetal',                unit: 'Beutel (1.0kg)' },
      { name: 'Costilla de Res',              unit: 'Beutel (4 Portionen)' },
      { name: 'Salsa für Costilla de Res',    unit: 'Beutel (2L)' },
      { name: 'Rote Zwiebeln eingelegt',      unit: '1/6 GN groß' },
      { name: 'Pulpo (Chipulpotle)',          unit: 'Beutel (100 g)' },
      { name: 'Salsa Pulpo',                  unit: 'Beutel (0.5kg)' },
      { name: 'Birria',                       unit: 'Beutel (2.0kg)' },
      { name: 'Salsa Birria',                 unit: 'Beutel (1.0kg)' },
      { name: 'Füllung Nogada',               unit: 'Beutel (1.0kg)' },
      { name: 'H-Milch 3,5%',                unit: 'Packung' },
    ],
  },
  {
    title: 'Tiefkühler',
    items: [
      { name: 'Alambre - Paprika Streifen',   unit: 'Beutel (2.5kg)' },
      { name: 'Gambas',                        unit: 'Beutel (1.0kg)' },
      { name: 'Weizentortillas 20cm',          unit: 'Karton' },
    ],
  },
  {
    title: 'Trockenware',
    items: [
      { name: 'Reis',                          unit: 'Beutel (1kg)' },
      { name: 'Schwarze Bohnen',               unit: 'Sack (5kg)' },
      { name: 'Salz',                          unit: 'Eimer (10kg)' },
      { name: 'Zucker',                        unit: 'Packung (1.0kg)' },
      { name: 'Brauner Zucker',                unit: 'Packung' },
      { name: 'Pfeffer',                       unit: 'Packung' },
      { name: 'Pfeffer geschrotet',            unit: 'Packung' },
      { name: 'Rapsöl',                        unit: 'Kanister (10L)' },
      { name: 'Tajin',                         unit: 'Packung' },
      { name: 'Limettensaft (750ml Metro)',    unit: 'Flasche' },
    ],
  },
  {
    title: 'Regale',
    items: [
      { name: 'Große Bowl togo Schale',        unit: 'Packungen (40 Stk)' },
      { name: 'Große Bowl togo Deckel',        unit: 'Packungen (40 Stk)' },
      { name: 'Kleine Bowl togo Schale',       unit: 'Packungen (40 Stk)' },
      { name: 'Kleine Bowl togo Deckel',       unit: 'Packungen (40 Stk)' },
      { name: 'Dressingsbecher Schale',        unit: '50er Pack' },
      { name: 'Dressingsbecher Deckel',        unit: '50er Pack' },
      { name: 'Alufolie',                      unit: 'Rolle' },
      { name: 'Backpapier',                    unit: 'Rolle' },
      { name: 'Trayliner Papier',              unit: 'Karton' },
      { name: 'Weiße Serviette',               unit: 'Karton' },
      { name: 'Zig-Zag Papier',               unit: 'Karton' },
      { name: 'Müllbeutel Blau 120L',          unit: '120L Rolle' },
      { name: 'Handschuhe M',                  unit: 'Packung' },
      { name: 'Handschuhe L',                  unit: 'Packung' },
      { name: 'Mehrwegbowl',                   unit: 'Stück' },
    ],
  },
  {
    title: 'Lager',
    items: [
      { name: 'Große Togo Tüte',               unit: 'Kartons (250 Stk)' },
      { name: 'Kleine Togo Tüte',              unit: 'Kartons (250 Stk)' },
      { name: 'Schwarze Serviette',            unit: 'Karton' },
      { name: 'Nachos',                        unit: 'Karton (12 Beutel)' },
      { name: 'Spüli',                         unit: 'Flasche' },
      { name: 'Essigessenz',                   unit: 'Flasche' },
      { name: 'Topfschwamm',                   unit: 'Packung (10Stk)' },
      { name: 'Edelstahlschwamm',              unit: 'Packung (10Stk)' },
      { name: 'Reinigungshandschuhe',          unit: 'Packung (2Stk)' },
      { name: 'Blaue Rolle',                   unit: 'Rolle' },
      { name: 'Toilettenpapier',               unit: 'Packung' },
      { name: 'Glasreiniger',                  unit: 'Kanister' },
      { name: 'WC Reiniger',                   unit: 'Kanister' },
      { name: 'Desinfektionsreiniger',         unit: 'Kanister' },
      { name: 'Gastro Universal Reiniger',     unit: 'Kanister' },
      { name: 'Kalkreiniger',                  unit: 'Kanister' },
      { name: 'Laminat - Parkett-Reiniger',   unit: 'Kanister' },
      { name: 'B100N',                         unit: 'Kanister' },
      { name: 'B200S',                         unit: 'Kanister' },
      { name: 'F8500',                         unit: 'Kanister' },
      { name: 'F420E',                         unit: 'Kanister' },
      { name: 'Spülmaschine Salz - Etolit',   unit: 'Beutel' },
    ],
  },
];

/* ─── Types ─────────────────────────────────────────────────────────────────── */
type TargetRow = {
  item_name:   string;
  unit:        string;
  mon_target:  number;
  tue_target:  number;
  wed_target:  number;
  fri_target:  number;
};

const DAY_COLS = [
  { key: 'mon_target' as const, label: 'MON' },
  { key: 'tue_target' as const, label: 'TUE' },
  { key: 'wed_target' as const, label: 'WED' },
  { key: 'fri_target' as const, label: 'FRI' },
];

/* ─── Page ───────────────────────────────────────────────────────────────────── */
export default function InventoryListsPage() {
  const { t } = useT();
  const [activeStore, setActiveStore] = useState<Store>('Eschborn');

  const { data: targets, isLoading } = useQuery({
    queryKey: ['inventory-lists-targets', activeStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_targets')
        .select('item_name, unit, mon_target, tue_target, wed_target, fri_target')
        .eq('location_name', activeStore);
      if (error) throw error;
      return (data ?? []) as TargetRow[];
    },
  });

  // Build a fast lookup: item_name → target row
  const targetMap = new Map((targets ?? []).map(t => [t.item_name, t]));
  const totalItems = SECTIONS.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Lists</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {totalItems} items · standard delivery targets per store
          </p>
        </div>

        {/* Store tabs */}
        <div className="flex items-center gap-1.5">
          {STORES.map(store => (
            <button
              key={store}
              onClick={() => setActiveStore(store)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors whitespace-nowrap ${
                activeStore === store
                  ? 'bg-[#1B5E20] text-white border-[#1B5E20] shadow-sm'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-[#1B5E20] hover:text-[#1B5E20]'
              }`}
            >
              {store}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[220px]">
                  Item
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide min-w-[140px]">
                  Unit
                </th>
                {DAY_COLS.map(d => (
                  <th key={d.key} className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[64px]">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex justify-center gap-2">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
                      ))}
                    </div>
                  </td>
                </tr>
              ) : (
                SECTIONS.map(section => (
                  <>
                    {/* Section header row */}
                    <tr key={`s-${section.title}`} className="bg-[#F1F8E9] border-y border-green-100">
                      <td colSpan={6} className="px-4 py-2 text-xs font-bold text-[#2E7D32] uppercase tracking-wider">
                        {section.title}
                      </td>
                    </tr>

                    {/* Item rows */}
                    {section.items.map((item, idx) => {
                      const target = targetMap.get(item.name);
                      const isEven = idx % 2 === 0;
                      return (
                        <tr
                          key={item.name}
                          className={`border-b border-gray-50 ${isEven ? 'bg-white' : 'bg-gray-50/40'}`}
                        >
                          <td className="px-4 py-2.5 font-medium text-gray-800">
                            {item.name}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-400">
                            {item.unit}
                          </td>
                          {DAY_COLS.map(d => {
                            const val = target?.[d.key];
                            return (
                              <td key={d.key} className="px-4 py-2.5 text-center tabular-nums">
                                {val == null || val === 0
                                  ? <span className="text-gray-300">—</span>
                                  : <span className="font-semibold text-[#2E7D32]">{val}</span>
                                }
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        {!isLoading && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-400">
              Standard targets are set via the Delivery page → Standard Targets.
              Items with no targets show —.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
