'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', id)
        .single();
      return data;
    },
  });

  const { data: supplierItems } = useQuery({
    queryKey: ['supplier-items-list', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('supplier_items')
        .select('*, item:items(id, name, sku, unit:units_of_measure(abbreviation))')
        .eq('supplier_id', id)
        .order('is_preferred', { ascending: false });
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-white rounded-lg animate-pulse" />)}
      </div>
    );
  }

  if (!supplier) return <div className="text-center text-gray-500 mt-12">Supplier not found</div>;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{(supplier as Record<string, unknown>).name as string}</h1>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${(supplier as Record<string, unknown>).is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {(supplier as Record<string, unknown>).is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Supplier Information</h2>
          <dl className="space-y-3 text-sm">
            {[
              ['Contact Name', (supplier as Record<string, unknown>).contact_name],
              ['Email', (supplier as Record<string, unknown>).email],
              ['Phone', (supplier as Record<string, unknown>).phone],
              ['Address', (supplier as Record<string, unknown>).address],
              ['Payment Terms', (supplier as Record<string, unknown>).payment_terms],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between">
                <dt className="text-gray-500">{label as string}</dt>
                <dd className="text-gray-800 text-right max-w-64">{value as string ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-900">{(supplierItems as unknown[])?.length ?? 0}</div>
            <div className="text-gray-500 text-sm mt-1">Items Supplied</div>
          </div>
        </div>
      </div>

      {/* Items supplied */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Items Supplied</h2>
        </div>
        <div className="overflow-x-auto">
          {!supplierItems || (supplierItems as unknown[]).length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No items for this supplier</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Package Size</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Preferred</th>
                </tr>
              </thead>
              <tbody>
                {(supplierItems as Record<string, unknown>[]).map((si, i) => {
                  const item = si.item as Record<string, unknown> | null;
                  return (
                    <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{item?.name as string ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{item?.sku as string ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(si.unit_price as number)}</td>
                      <td className="px-4 py-3 text-gray-600">{si.package_size as string ?? '—'}</td>
                      <td className="px-4 py-3">
                        {si.is_preferred ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Primary</span>
                        ) : (
                          <span className="text-gray-400 text-xs">No</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
