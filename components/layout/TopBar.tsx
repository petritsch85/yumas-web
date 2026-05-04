'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Bell, Menu, LogOut } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { useT } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n';

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

const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
];

export default function TopBar({ onMenuToggle }: { onMenuToggle: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang, setLang } = useT();
  const [initials, setInitials] = useState('');
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) {
        setInitials(user.email.slice(0, 2).toUpperCase());
      }
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleLang = async (code: Lang) => {
    setOpen(false);
    await setLang(code);
  };

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

        {/* Avatar + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen(o => !o)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1B5E20]"
            style={{ backgroundColor: '#1B5E20' }}
          >
            {initials || 'U'}
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
              {/* Language options */}
              <div className="px-3 py-1.5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                  {t('team.form.language')}
                </p>
                {LANGS.map(({ code, flag, label }) => (
                  <button
                    key={code}
                    onClick={() => handleLang(code)}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                      lang === code
                        ? 'bg-[#1B5E20]/10 text-[#1B5E20] font-semibold'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-base leading-none">{flag}</span>
                    {label}
                    {lang === code && <span className="ml-auto text-[#1B5E20] text-xs">✓</span>}
                  </button>
                ))}
              </div>

              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={14} />
                  {t('common.signOut')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
