'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { formatCurrency } from '@/lib/utils';
import { TrendingDown, AlertTriangle, Package, ShoppingCart } from 'lucide-react';
import Link from 'next/link';

export default function ReportsPage() {
  const { data: stockValue, isLoading: loadingStockValue } = useQuery({
    queryKey: ['report-stock-value'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_levels')
        .select('quantity, average_unit_cost');
      return (data ?? []).reduce((sum, row) => sum + (row.quantity * (row.average_unit_cost ?? 0)), 0);
    },
  });

  const { data: lowStockCount, isLoading: loadingLowStock } = useQuery({
    queryKey: ['report-low-stock'],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_levels').select('quantity, low_stock_threshold');
      return (data ?? []).filter((row) => row.low_stock_threshold != null && row.quantity <= row.low_stock_threshold).length;
    },
  });

  const { data: wasteThisMonth, isLoading: loadingWaste } = useQuery({
    queryKey: ['report-waste-month'],
    queryFn: async () => {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const { data } = await supabase
        .from('waste_logs')
        .select('quantity, unit_cost')
        .gte('waste_date', firstDay);
      return (data ?? []).reduce((sum, row) => sum + row.quantity * (row.unit_cost ?? 0), 0);
    },
  });

  const { data: poValueThisMonth, isLoading: loadingPOValue } = useQuery({
    queryKey: ['report-po-value-month'],
    queryFn: async () => {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const { data: pos } = await supabase
        .from('purchase_orders')
        .select('id')
        .eq('status', 'received')
        .gte('order_date', firstDay);
      if (!pos || pos.length === 0) return 0;
      const poIds = pos.map((p) => p.id);
      const { data: lines } = await supabase
        .from('purchase_order_lines')
        .select('line_total')
        .in('po_id', poIds);
      return (lines ?? []).reduce((sum, l) => sum + (l.line_total ?? 0), 0);
    },
  });

  const cards = [
    {
      label: 'Stock Value',
      value: formatCurrency(stockValue ?? 0),
      description: 'Total inventory value on hand',
      icon: Package,
      color: '#1B5E20',
      loading: loadingStockValue,
      href: '/products/raw-materials',
    },
    {
      label: 'Low Stock Items',
      value: `${lowStockCount ?? 0} items`,
      description: 'Below minimum threshold',
      icon: AlertTriangle,
      color: '#C62828',
      loading: loadingLowStock,
      href: '/products/raw-materials',
    },
    {
      label: 'Waste This Month',
      value: formatCurrency(wasteThisMonth ?? 0),
      description: 'Estimated waste cost',
      icon: TrendingDown,
      color: '#E65100',
      loading: loadingWaste,
      href: '/waste',
    },
    {
      label: 'PO Value This Month',
      value: formatCurrency(poValueThisMonth ?? 0),
      description: 'Received orders value',
      icon: ShoppingCart,
      color: '#1565C0',
      loading: loadingPOValue,
      href: '/purchase-orders',
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of key inventory metrics</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="rounded-full p-3" style={{ backgroundColor: `${card.color}18` }}>
                  <Icon size={22} style={{ color: card.color }} />
                </div>
                <Link
                  href={card.href}
                  className="text-xs font-medium hover:underline"
                  style={{ color: '#1B5E20' }}
                >
                  View Details →
                </Link>
              </div>
              {card.loading ? (
                <div className="h-8 w-32 bg-gray-200 rounded animate-pulse mb-1" />
              ) : (
                <div className="text-2xl font-bold text-gray-900 mb-1">{card.value}</div>
              )}
              <div className="text-sm text-gray-500">{card.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{card.description}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
