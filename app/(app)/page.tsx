'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Package, Truck, ShoppingCart, AlertTriangle,
  ClipboardList, Factory, Trash2, BarChart3,
  TrendingUp, PartyPopper, Users, LineChart,
  FilePlus, Store, UtensilsCrossed,
} from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';
import type { Profile, AppPermissions } from '@/types';
import { useT } from '@/lib/i18n';

function KpiCard({
  label, value, icon: Icon, color, loading,
}: {
  label: string; value: number | string; icon: React.ElementType; color: string; loading: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 md:p-6 flex items-center gap-4">
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
  const { t } = useT();

  const { data: profile } = useQuery<Profile | null>({
    queryKey: ['dashboard-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      return data as Profile | null;
    },
  });

  const isAdmin = profile?.role === 'admin';
  const perms   = profile?.permissions ?? {};

  const can = (permKey?: keyof AppPermissions, adminOnly?: boolean): boolean => {
    if (profile === undefined) return false;
    if (isAdmin) return true;
    if (adminOnly) return false;
    if (permKey) return !!perms[permKey];
    return true;
  };

  const { data: itemCount,     isLoading: loadingItems }    = useQuery({
    queryKey: ['kpi-items'],
    enabled: can('products'),
    queryFn: async () => {
      const { count } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('is_active', true);
      return count ?? 0;
    },
  });

  const { data: supplierCount, isLoading: loadingSuppliers } = useQuery({
    queryKey: ['kpi-suppliers'],
    enabled: can('suppliers'),
    queryFn: async () => {
      const { count } = await supabase.from('suppliers').select('*', { count: 'exact', head: true }).eq('is_active', true);
      return count ?? 0;
    },
  });

  const { data: pendingPOs,    isLoading: loadingPOs }       = useQuery({
    queryKey: ['kpi-pending-pos'],
    enabled: can('buying'),
    queryFn: async () => {
      const { count } = await supabase.from('purchase_orders').select('*', { count: 'exact', head: true }).in('status', ['draft', 'sent', 'confirmed']);
      return count ?? 0;
    },
  });

  const { data: lowStockCount, isLoading: loadingLowStock }  = useQuery({
    queryKey: ['kpi-low-stock'],
    enabled: can('analysis'),
    queryFn: async () => {
      const { data } = await supabase.from('inventory_levels').select('quantity, low_stock_threshold');
      return (data ?? []).filter((r) => r.low_stock_threshold != null && r.quantity <= r.low_stock_threshold).length;
    },
  });

  const { data: recentPOs,     isLoading: loadingRecentPOs }    = useQuery({
    queryKey: ['recent-pos'],
    enabled: can('buying'),
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders')
        .select('*, supplier:suppliers(name), destination_location:locations(name)')
        .order('created_at', { ascending: false }).limit(10);
      return data ?? [];
    },
  });

  const { data: lowStockItems, isLoading: loadingLowStockItems } = useQuery({
    queryKey: ['low-stock-items'],
    enabled: can('analysis'),
    queryFn: async () => {
      const { data } = await supabase.from('inventory_levels')
        .select('*, item:items(name, sku), location:locations(name)')
        .order('quantity', { ascending: true }).limit(10);
      return (data ?? []).filter((r: Record<string, unknown>) => {
        const qty = r.quantity as number;
        const threshold = r.low_stock_threshold as number | null;
        return threshold != null && qty <= threshold;
      });
    },
  });

  // Quick links with translation keys
  type QuickLink = {
    labelKey: string;
    href: string;
    icon: React.ElementType;
    color: string;
    permKey?: keyof AppPermissions;
    adminOnly?: boolean;
  };

  const QUICK_LINKS: QuickLink[] = [
    { labelKey: 'dashboard.quickLinks.inventory',    href: '/inventory/overview',       icon: ClipboardList,   color: '#1B5E20', permKey: 'inventory' },
    { labelKey: 'dashboard.quickLinks.addInventory', href: '/inventory/add',            icon: FilePlus,        color: '#2E7D32', permKey: 'inventory' },
    { labelKey: 'dashboard.quickLinks.suppliers',    href: '/suppliers',                icon: Store,           color: '#FF8F00', permKey: 'suppliers' },
    { labelKey: 'dashboard.quickLinks.menus',        href: '/products/menus',           icon: UtensilsCrossed, color: '#6D4C41', permKey: 'products' },
    { labelKey: 'dashboard.quickLinks.products',     href: '/products',                 icon: Package,         color: '#4CAF50', permKey: 'products' },
    { labelKey: 'dashboard.quickLinks.buying',       href: '/purchase-orders',          icon: ShoppingCart,    color: '#1565C0', permKey: 'buying' },
    { labelKey: 'dashboard.quickLinks.production',   href: '/products/semi-finished',   icon: Factory,         color: '#7B1FA2', permKey: 'production' },
    { labelKey: 'dashboard.quickLinks.wasteLog',     href: '/waste',                    icon: Trash2,          color: '#C62828', permKey: 'waste_log' },
    { labelKey: 'dashboard.quickLinks.delivery',     href: '/delivery',                 icon: Truck,           color: '#00838F', permKey: 'delivery' },
    { labelKey: 'dashboard.quickLinks.analysis',     href: '/analysis',                 icon: BarChart3,       color: '#F57F17', permKey: 'analysis' },
    { labelKey: 'dashboard.quickLinks.events',       href: '/events',                   icon: PartyPopper,     color: '#AD1457', permKey: 'events' },
    { labelKey: 'dashboard.quickLinks.staffVideos',  href: '/staff-videos',             icon: Users,           color: '#37474F', permKey: 'staff_videos' },
    { labelKey: 'dashboard.quickLinks.bills',        href: '/bills',                    icon: FilePlus,        color: '#558B2F', permKey: 'bills' },
    { labelKey: 'dashboard.quickLinks.salesReports', href: '/pl-reports/sales-reports', icon: LineChart,       color: '#283593', permKey: 'pl_reports' },
    { labelKey: 'dashboard.quickLinks.team',         href: '/settings/users',           icon: Users,           color: '#4E342E', adminOnly: true },
    { labelKey: 'dashboard.quickLinks.plReports',    href: '/reports',                  icon: TrendingUp,      color: '#00695C', adminOnly: true },
  ];

  const kpis = [
    { label: t('dashboard.kpi.totalItems'),      value: itemCount     ?? 0, icon: Package,       color: '#1B5E20', loading: loadingItems,     show: can('products')  },
    { label: t('dashboard.kpi.activeSuppliers'), value: supplierCount ?? 0, icon: Truck,         color: '#FF8F00', loading: loadingSuppliers, show: can('suppliers') },
    { label: t('dashboard.kpi.pendingPOs'),      value: pendingPOs    ?? 0, icon: ShoppingCart,  color: '#1565C0', loading: loadingPOs,       show: can('buying')    },
    { label: t('dashboard.kpi.lowStockItems'),   value: lowStockCount ?? 0, icon: AlertTriangle, color: '#C62828', loading: loadingLowStock,  show: can('analysis')  },
  ].filter((k) => k.show);

  const visibleLinks = QUICK_LINKS.filter((l) => can(l.permKey, l.adminOnly));
  const showPOPanel       = can('buying');
  const showLowStockPanel = can('analysis');
  const showPanelRow      = showPOPanel || showLowStockPanel;

  return (
    <div>
      {kpis.length > 0 && (
        <div className={`grid gap-3 md:gap-4 mb-6 md:mb-8 ${
          kpis.length === 1 ? 'grid-cols-1 max-w-xs' :
          kpis.length === 2 ? 'grid-cols-2 max-w-lg' :
          kpis.length === 3 ? 'grid-cols-2 lg:grid-cols-3' :
          'grid-cols-2 lg:grid-cols-4'
        }`}>
          {kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
        </div>
      )}

      {showPanelRow && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6 md:mb-8">
          {showPOPanel && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{t('dashboard.recentPOs')}</h3>
                <Link href="/purchase-orders" className="text-xs font-medium hover:underline" style={{ color: '#1B5E20' }}>
                  {t('common.viewAll')}
                </Link>
              </div>
              <div className="overflow-x-auto">
                {loadingRecentPOs ? (
                  <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div>
                ) : recentPOs && recentPOs.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('dashboard.table.poNumber')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('dashboard.table.supplier')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('dashboard.table.status')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('dashboard.table.date')}</th>
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
                  <div className="p-6 text-center text-gray-400 text-sm">{t('dashboard.noRecentPOs')}</div>
                )}
              </div>
            </div>
          )}

          {showLowStockPanel && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{t('dashboard.lowStock')}</h3>
                <Link href="/reports" className="text-xs font-medium hover:underline" style={{ color: '#1B5E20' }}>
                  {t('common.viewReport')}
                </Link>
              </div>
              <div className="overflow-x-auto">
                {loadingLowStockItems ? (
                  <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div>
                ) : lowStockItems && lowStockItems.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('dashboard.table.item')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('dashboard.table.location')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('dashboard.table.qty')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('dashboard.table.threshold')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(lowStockItems as Record<string, unknown>[]).map((row, i) => (
                        <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-800">{(row.item as { name: string } | null)?.name ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{(row.location as { name: string } | null)?.name ?? '—'}</td>
                          <td className="px-4 py-3 font-medium text-red-600">{row.quantity as number}</td>
                          <td className="px-4 py-3 text-gray-500">{(row.low_stock_threshold as number) ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-6 text-center text-gray-400 text-sm">{t('dashboard.allStocked')}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {visibleLinks.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">{t('dashboard.quickAccess')}</h3>
          </div>
          <div className="p-4 md:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {visibleLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href + link.labelKey}
                  href={link.href}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors text-center group"
                >
                  <div className="rounded-full p-2.5" style={{ backgroundColor: `${link.color}15` }}>
                    <Icon size={20} style={{ color: link.color }} />
                  </div>
                  <span className="text-xs font-medium text-gray-700 group-hover:text-gray-900 leading-tight">{t(link.labelKey)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
