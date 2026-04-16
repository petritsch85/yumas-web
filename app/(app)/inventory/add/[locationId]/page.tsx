'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';
import { ChevronLeft, Send } from 'lucide-react';

type Item = { name: string; unit: string };
type Section = { title: string; data: Item[] };

const SECTIONS: Section[] = [
  {
    title: 'Kühlhaus',
    data: [
      { name: 'Guacamole', unit: '1/6 GN groß' },
      { name: 'Schärfemix', unit: 'Beutel (0.5kg)' },
      { name: 'Maissalsa', unit: '1/6 GN groß' },
      { name: 'Tomatensalsa', unit: '1/6 GN groß' },
      { name: 'Sour Cream', unit: '1/6 GN groß' },
      { name: 'Marinade Chicken', unit: 'Beutel (1.0kg)' },
      { name: 'Pico de Gallo', unit: '1/2 GN' },
      { name: 'Crema Nogada', unit: 'Beutel (1.0kg)' },
      { name: 'Käse Gouda', unit: 'Beutel (5.0kg)' },
      { name: 'Gouda Scheiben Gringa', unit: 'Packung' },
      { name: 'Ciabatta', unit: 'Stück' },
      { name: 'Brownie', unit: 'Blech' },
      { name: 'Carlota de Limon', unit: 'Stück' },
      { name: 'Schoko- Avocado Mousse', unit: 'Blech' },
      { name: 'Mole', unit: '1/6 GN groß' },
      { name: 'Marinade Al Pastor', unit: 'Beutel (1.5kg)' },
      { name: 'Barbacoa', unit: '1/6 GN groß' },
      { name: 'Chili con Carne', unit: '1/6 GN groß' },
      { name: 'Cochinita', unit: '1/6 GN groß' },
      { name: 'Kartoffel Würfel', unit: 'Beutel (3.0kg)' },
      { name: 'Vinaigrette', unit: 'Behälter (1.0l)' },
      { name: 'Honig Sesam / Senf', unit: 'Behälter (1.0l)' },
      { name: 'Pozole', unit: 'Beutel (1.0kg)' },
      { name: 'Zwiebeln karamellisiert', unit: 'Beutel (1.0kg)' },
      { name: 'Karotten karamellisiert', unit: 'Beutel (10 Stück)' },
      { name: 'Bohnencreme', unit: 'Beutel (2.5kg)' },
      { name: 'Alambre - Zwiebel', unit: 'Beutel (2.0kg)' },
      { name: 'Weizen Tortillas 12cm', unit: 'Kisten' },
      { name: 'Tortillas 30cm', unit: 'Kisten' },
      { name: 'Frische Habaneros', unit: 'Stück' },
      { name: 'Salsa Habanero', unit: 'Beutel (1.5kg)' },
      { name: 'Salsa Verde', unit: 'Beutel (2.0kg)' },
      { name: 'Chipotle SourCream', unit: 'Beutel (2.0kg)' },
      { name: 'Salsa de Jamaica', unit: 'Beutel (0.5kg)' },
      { name: 'Salsa Torta', unit: 'Beutel (1.0kg)' },
      { name: 'Humo Salsa', unit: 'Flasche' },
      { name: 'Fuego Salsa', unit: 'Flasche' },
      { name: 'Oliven entkernt', unit: 'Glas' },
      { name: 'Chiles Poblanos', unit: 'Stück' },
      { name: 'Salsa Pitaya', unit: 'Beutel (0.5kg)' },
      { name: 'Mais Tortillas 12cm', unit: 'Beutel (50 Stk)' },
      { name: 'Blau Mais Tortillas 15cm', unit: 'Beutel (40 Stk)' },
      { name: 'Queso Cotija', unit: 'Pack (1.0kg)' },
      { name: 'Queso Oaxaca', unit: 'Pack (1.0kg)' },
      { name: 'Queso Chihuahua', unit: 'Pack (1.0kg)' },
      { name: 'Rinderfilet Steak', unit: 'Beutel (250g)' },
      { name: 'Filetspitzen', unit: 'Beutel (100g)' },
      { name: 'Hähnchenkeule (ganz)', unit: 'Beutel (2 Stück)' },
      { name: 'Mole Rojo', unit: 'Beutel (2.0kg)' },
      { name: 'Chorizo', unit: 'Beutel (1.0kg)' },
      { name: 'Carne Vegetal', unit: 'Beutel (1.0kg)' },
      { name: 'Costilla de Res', unit: 'Beutel (4 Portionen)' },
      { name: 'Salsa für Costilla de Res', unit: 'Beutel (2L)' },
      { name: 'Rote Zwiebeln eingelegt', unit: '1/6 GN groß' },
      { name: 'Pulpo (Chipulpotle)', unit: 'Beutel (100 g)' },
      { name: 'Salsa Pulpo', unit: 'Beutel (0.5kg)' },
      { name: 'Birria', unit: 'Beutel (2.0kg)' },
      { name: 'Salsa Birria', unit: 'Beutel (1.0kg)' },
      { name: 'Füllung Nogada', unit: 'Beutel (1.0kg)' },
      { name: 'H-Milch 3,5%', unit: 'Packung' },
    ],
  },
  {
    title: 'Tiefkühler',
    data: [
      { name: 'Alambre - Paprika Streifen', unit: 'Beutel (2.5kg)' },
      { name: 'Gambas', unit: 'Beutel (1.0kg)' },
      { name: 'Weizentortillas 20cm', unit: 'Karton' },
    ],
  },
  {
    title: 'Trockenware',
    data: [
      { name: 'Reis', unit: 'Beutel (1kg)' },
      { name: 'Schwarze Bohnen', unit: 'Sack (5kg)' },
      { name: 'Salz', unit: 'Eimer (10kg)' },
      { name: 'Zucker', unit: 'Packung (1.0kg)' },
      { name: 'Brauner Zucker', unit: 'Packung' },
      { name: 'Pfeffer', unit: 'Packung' },
      { name: 'Pfeffer geschrotet', unit: 'Packung' },
      { name: 'Rapsöl', unit: 'Kanister (10L)' },
      { name: 'Tajin', unit: 'Packung' },
      { name: 'Limettensaft (750ml Metro)', unit: 'Flasche' },
    ],
  },
  {
    title: 'Regale',
    data: [
      { name: 'Große Bowl togo Schale', unit: 'Packungen (40 Stk)' },
      { name: 'Große Bowl togo Deckel', unit: 'Packungen (40 Stk)' },
      { name: 'Kleine Bowl togo Schale', unit: 'Packungen (40 Stk)' },
      { name: 'Kleine Bowl togo Deckel', unit: 'Packungen (40 Stk)' },
      { name: 'Dressingsbecher Schale', unit: '50er Pack' },
      { name: 'Dressingsbecher Deckel', unit: '50er Pack' },
      { name: 'Alufolie', unit: 'Rolle' },
      { name: 'Backpapier', unit: 'Rolle' },
      { name: 'Trayliner Papier', unit: 'Karton' },
      { name: 'Weiße Serviette', unit: 'Karton' },
      { name: 'Zig-Zag Papier', unit: 'Karton' },
      { name: 'Müllbeutel Blau 120L', unit: '120L Rolle' },
      { name: 'Handschuhe M', unit: 'Packung' },
      { name: 'Handschuhe L', unit: 'Packung' },
      { name: 'Mehrwegbowl', unit: 'Stück' },
    ],
  },
  {
    title: 'Lager',
    data: [
      { name: 'Große Togo Tüte', unit: 'Kartons (250 Stk)' },
      { name: 'Kleine Togo Tüte', unit: 'Kartons (250 Stk)' },
      { name: 'Schwarze Serviette', unit: 'Karton' },
      { name: 'Nachos', unit: 'Karton (12 Beutel)' },
      { name: 'Spüli', unit: 'Flasche' },
      { name: 'Essigessenz', unit: 'Flasche' },
      { name: 'Topfschwamm', unit: 'Packung (10Stk)' },
      { name: 'Edelstahlschwamm', unit: 'Packung (10Stk)' },
      { name: 'Reinigungshandschuhe', unit: 'Packung (2Stk)' },
      { name: 'Blaue Rolle', unit: 'Rolle' },
      { name: 'Toilettenpapier', unit: 'Packung' },
      { name: 'Glasreiniger', unit: 'Kanister' },
      { name: 'WC Reiniger', unit: 'Kanister' },
      { name: 'Desinfektionsreiniger', unit: 'Kanister' },
      { name: 'Gastro Universal Reiniger', unit: 'Kanister' },
      { name: 'Kalkreiniger', unit: 'Kanister' },
      { name: 'Laminat - Parkett-Reiniger', unit: 'Kanister' },
      { name: 'B100N', unit: 'Kanister' },
      { name: 'B200S', unit: 'Kanister' },
      { name: 'F8500', unit: 'Kanister' },
      { name: 'F420E', unit: 'Kanister' },
      { name: 'Spülmaschine Salz - Etolit', unit: 'Beutel' },
    ],
  },
];

const TOTAL_ITEMS = SECTIONS.reduce((sum, s) => sum + s.data.length, 0);

export default function LocationInventoryFormPage({
  params,
}: {
  params: { locationId: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationName = searchParams.get('name') ?? 'Location';

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const filledCount = Object.values(counts).filter((v) => v.trim() !== '').length;

  const handleChange = (name: string, value: string) => {
    setCounts((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    if (!window.confirm(`Submit inventory for ${locationName}? (${filledCount} / ${TOTAL_ITEMS} items filled)`)) return;

    setSubmitting(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        alert('Could not get current user. Please log in again.');
        setSubmitting(false);
        return;
      }

      const data = SECTIONS.flatMap((section) =>
        section.data.map((item) => ({
          section: section.title,
          name: item.name,
          unit: item.unit,
          quantity: parseFloat(counts[item.name] ?? '0') || 0,
        }))
      );

      const { error: insertError } = await supabase
        .from('inventory_submissions')
        .insert({
          location_id: params.locationId,
          location_name: locationName,
          submitted_by: user.id,
          submitted_at: new Date().toISOString(),
          data,
        });

      if (insertError) {
        alert(`Error: ${insertError.message}`);
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch (e: unknown) {
      alert((e as Error)?.message ?? 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1B5E20" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Inventory Submitted</h2>
        <p className="text-sm text-gray-500">Your inventory for {locationName} has been saved.</p>
        <div className="flex gap-3 mt-2">
          <button
            onClick={() => { setCounts({}); setSubmitted(false); }}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            New Submission
          </button>
          <button
            onClick={() => router.push('/inventory/counts')}
            className="px-4 py-2 bg-[#1B5E20] text-white rounded-lg text-sm font-medium hover:bg-[#2E7D32]"
          >
            View Current Inventory
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="text-2xl font-bold text-gray-900">{locationName} — Inventory</h1>
      </div>

      {/* Sections */}
      <div className="flex-1 space-y-4 pb-28">
        {SECTIONS.map((section) => (
          <div key={section.title} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            {/* Section header */}
            <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: '#1B5E20' }}>
              <span className="text-white text-xs font-bold tracking-widest uppercase">{section.title}</span>
              <span className="text-green-300 text-xs font-medium">{section.data.length} items</span>
            </div>
            {/* Items */}
            <div>
              {section.data.map((item, idx) => (
                <div
                  key={item.name}
                  className={`flex items-center gap-4 px-4 py-3 ${idx < section.data.length - 1 ? 'border-b border-gray-100' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{item.unit}</div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={counts[item.name] ?? ''}
                    onChange={(e) => handleChange(item.name, e.target.value)}
                    placeholder="0"
                    className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] bg-gray-50"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-60 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shadow-lg z-10">
        <span className="text-sm text-gray-500 font-medium">
          {filledCount} / {TOTAL_ITEMS} items filled
        </span>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-2 bg-[#1B5E20] text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={15} />
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
