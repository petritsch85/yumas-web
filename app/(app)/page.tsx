'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Package, Truck, ShoppingCart, AlertTriangle } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate, formatCurrency } from '@/lib/utils';
import Link from 'next/link';

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 flex items-center gap-4">
      <div className="rounded-full p-3 flex-shrink-0" style={{ backgroundColor: `${color}20` }}>
        <Icon size={22} style={{ color }} />
      </div>
      <div>
        {loading ? (
          <div className="h-7 w-16 bg-gray-200 rounded animate-pulse mb-1" />
        ) : (
          <div className="text-2xl font-bold text-gray-900">{value}</div>
        )}
        <div className="text-sm text-gray-500">{label}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: itemCount, isLoading: loadingItems } = useQuery({
    queryKey: ['kpi-items'],
    queryFn: async () => {
      const { count } = await supabase
        .from('items')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      return count ?? 0;
    },
  });

  const { data: supplierCount, isLoading: loadingSuppliers } = useQuery({
    queryKey: ['kpi-suppliers'],
    queryFn: async () => {
      const { count } = await supabase
        .from('suppliers')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      return count ?? 0;
    },
  });

  const { data: pendingPOs, isLoading: loadingPOs } = useQuery({
    queryKey: ['kpi-pending-pos'],
    queryFn: async () => {
      const { count } = await supabase
        .from('purchase_orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['draft', 'sent', 'confirmed']);
      return count ?? 0;
    },
  });

  const { data: lowStockCount, isLoading: loadingLowStock } = useQuery({
    queryKey: ['kpi-low-stock'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_levels')
        .select('quantity, low_stock_threshold');
      return (data ?? []).filter(
        (row) => row.low_stock_threshold != null && row.quantity <= row.low_stock_threshold
      ).length;
    },
  });

  const { data: recentPOs, isLoading: loadingRecentPOs } = useQuery({
    queryKey: ['recent-pos'],
    queryFn: async () => {
      const { data } = await supabase
        .from('purchase_orders')
        .select('*, supplier:suppliers(name), destination_location:locations(name)')
        .order('created_at', { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const { data: lowStockItems, isLoading: loadingLowStockItems } = useQuery({
    queryKey: ['low-stock-items'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_levels')
        .select('*, item:items(name, sku), location:locations(name)')
        .order('quantity', { ascending: true })
        .limit(10);
      return (data ?? []).filter((row: Record<string, unknown>) => {
        const qty = row.quantity as number;
        const threshold = row.low_stock_threshold as number | null;
        return threshold != null && qty <= threshold;
      });
    },
  });

  const kpis = [
    { label: 'Total Items', value: itemCount ?? 0, icon: Package, color: '#1B5E20', loading: loadingItems },
    { label: 'Active Suppliers', value: supplierCount ?? 0, icon: Truck, color: '#FF8F00', loading: loadingSuppliers },
    { label: 'Pending POs', value: pendingPOs ?? 0, icon: ShoppingCart, color: '#1565C0', loading: loadingPOs },
    { label: 'Low Stock Items', value: lowStockCount ?? 0, icon: AlertTriangle, color: '#C62828', loading: loadingLowStock },
  ];

  return (
    <div>
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Recent Purchase Orders */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Recent Purchase Orders</h3>
            <Link href="/purchase-orders" className="text-xs font-medium hover:underline" style={{ color: '#1B5E20' }}>
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            {loadingRecentPOs ? (
              <div className="p-6 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : recentPOs && recentPOs.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PO #</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentPOs as Record<string, unknown>[]).map((po) => (
                    <tr key={po.id as string} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800 font-mono text-xs">{po.po_number as string}</td>
                      <td className="px-4 py-3 text-gray-800">{(po.supplier as { name: string } | null)?.name ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={po.status as string} /></td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(po.order_date as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-center text-gray-400 text-sm">No purchase orders found</div>
            )}
          </div>
        </div>

        {/* Low Stock Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Low Stock Items</h3>
            <Link href="/reports" className="text-xs font-medium hover:underline" style={{ color: '#1B5E20' }}>
              View report
            </Link>
          </div>
          <div className="overflow-x-auto">
            {loadingLowStockItems ? (
              <div className="p-6 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : lowStockItems && lowStockItems.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {(lowStockItems as Record<string, unknown>[]).map((row, i) => (
                    <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">{(row.item as { name: string } | null)?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{(row.location as { name: string } | null)?.name ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-red-600">{row.quantity as number}</td>
                      <td className="px-4 py-3 text-gray-500">{row.low_stock_threshold as number ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-center text-gray-400 text-sm">All items are adequately stocked</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
