'use client';

import { usePathname } from 'next/navigation';
import { Bell, Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { useT } from '@/lib/i18n';

// Map pathname patterns to topbar translation keys
function getTitleKey(pathname: string): string {
  const exact: Record<string, string> = {
    '/':                          'topbar.dashboard',
    '/products/raw-materials':    'topbar.rawMaterials',
    '/products/semi-finished':    'topbar.semiFinished',
    '/products/finished':         'topbar.finishedGoods',
    '/inventory/counts':          'topbar.inventoryCounts',
    '/inventory/overview':        'topbar.currentInventory',
    '/inventory/add':             'topbar.addInventory',
    '/inventory/usage-forecast':  'topbar.usageForecast',
    '/purchase-orders':           'topbar.purchaseOrders',
    '/suppliers':                 'topbar.suppliers',
    '/transfers':                 'topbar.transfers',
    '/waste':                     'topbar.wasteLog',
    '/production':                'topbar.production',
    '/production/recipes':        'topbar.recipes',
    '/reports':                   'topbar.reports',
    '/calendar':                  'topbar.calendar',
    '/settings':                  'topbar.settings',
    '/settings/users':            'topbar.users',
    '/settings/locations':        'topbar.locations',
    '/settings/categories':       'topbar.categories',
    '/delivery':                  'topbar.delivery',
    '/delivery/forecast':         'topbar.salesForecast',
    '/delivery/reports':          'topbar.deliveryReports',
    '/delivery/targets':          'topbar.deliveryTargets',
    '/analysis':                  'topbar.analysis',
    '/analysis/cogs':             'topbar.cogs',
    '/analysis/store-yield':      'topbar.storeYield',
    '/events':                    'topbar.events',
    '/staff-videos':              'topbar.staffVideos',
    '/staff-videos/food-prep':    'topbar.foodPrep',
    '/staff-videos/drinks-prep':  'topbar.drinksPrep',
    '/bills':                     'topbar.bills',
    '/bills/outgoing':            'topbar.billsOutgoing',
    '/bills/new':                 'topbar.newBill',
    '/pl-reports/stats':          'topbar.plStats',
    '/pl-reports/sales-reports':  'topbar.salesReports',
    '/pl-reports/weekly-sales':   'topbar.weeklySales',
    '/pl-reports/csv-importer':   'topbar.csvImporter',
    '/inventory':                 'topbar.inventory',
    '/products':                  'topbar.productDetails',
    '/waste/new':                 'topbar.logWaste',
  };
  if (exact[pathname]) return exact[pathname];
  if (pathname.startsWith('/purchase-orders/new')) return 'topbar.newPurchaseOrder';
  if (pathname.startsWith('/purchase-orders/'))    return 'topbar.purchaseOrderDetails';
  if (pathname.startsWith('/suppliers/'))          return 'topbar.supplierDetails';
  if (pathname.startsWith('/products/'))           return 'topbar.productDetails';
  if (pathname.startsWith('/waste/new'))           return 'topbar.logWaste';
  return 'topbar.yumasInventory';
}

export default function TopBar({ onMenuToggle }: { onMenuToggle: () => void }) {
  const pathname = usePathname();
  const { t } = useT();
  const [initials, setInitials] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) {
        setInitials(user.email.slice(0, 2).toUpperCase());
      }
    });
  }, []);

  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 md:px-6 flex-shrink-0">
      <button
        onClick={onMenuToggle}
        className="md:hidden mr-3 text-gray-500 hover:text-gray-800 transition-colors p-1"
        aria-label="Open menu"
      >
        <Menu size={22} />
      </button>
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-semibold text-gray-900 truncate">{t(getTitleKey(pathname))}</h2>
      </div>
      <div className="flex items-center gap-4">
        <button className="text-gray-400 hover:text-gray-600 transition-colors">
          <Bell size={18} />
        </button>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
          style={{ backgroundColor: '#1B5E20' }}
        >
          {initials || 'U'}
        </div>
      </div>
    </div>
  );
}
