'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Building2, Factory } from 'lucide-react';

const LOCATION_COLORS: Record<string, string> = {
  Eschborn: '#1565C0',
  Taunus:   '#E65100',
  Westend:  '#6A1B9A',
  ZK:       '#2E7D32',
};

export default function AddInventoryPage() {
  const router = useRouter();

  const { data: locations, isLoading } = useQuery({
    queryKey: ['locations', 'active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations')
        .select('id, name, type')
        .eq('is_active', true)
        .order('name');
      return data ?? [];
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Add New Inventory</h1>
      <p className="text-sm text-gray-500 mb-6">Choose the location for which you want to add inventory</p>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden max-w-lg">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          (locations as { id: string; name: string; type: string }[] ?? []).map((loc, i, arr) => {
            const color = LOCATION_COLORS[loc.name] ?? '#1B5E20';
            const isLast = i === arr.length - 1;
            const Icon = loc.type === 'production' ? Factory : Building2;
            return (
              <button
                key={loc.id}
                onClick={() => router.push(`/inventory/add/${loc.id}?name=${encodeURIComponent(loc.name)}`)}
                className={`w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left ${
                  !isLast ? 'border-b border-gray-100' : ''
                }`}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: color + '18' }}
                >
                  <Icon size={20} style={{ color }} />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{loc.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {loc.type === 'production' ? 'Production' : 'Restaurant'}
                  </div>
                </div>
                <svg className="text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
