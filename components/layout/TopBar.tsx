'use client';

import { usePathname } from 'next/navigation';
import { Bell, Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/products/raw-materials': 'Raw Materials',
  '/products/semi-finished': 'Semi-Finished Products',
  '/products/finished': 'Finished Goods',
  '/inventory/counts': 'Inventory Counts',
  '/purchase-orders': 'Purchase Orders',
  '/suppliers': 'Suppliers',
  '/transfers': 'Transfers',
  '/waste': 'Waste Log',
  '/production': 'Production',
  '/production/recipes': 'Recipes',
  '/reports': 'Reports',
  '/calendar': 'Delivery Calendar',
  '/settings': 'Settings',
  '/settings/users': 'Users',
  '/settings/locations': 'Locations',
  '/settings/categories': 'Categories',
};

function getTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith('/purchase-orders/new')) return 'New Purchase Order';
  if (pathname.startsWith('/purchase-orders/')) return 'Purchase Order Details';
  if (pathname.startsWith('/suppliers/')) return 'Supplier Details';
  if (pathname.startsWith('/products/')) return 'Product Details';
  if (pathname.startsWith('/waste/new')) return 'Log Waste';
  return 'Yumas Inventory';
}

export default function TopBar({ onMenuToggle }: { onMenuToggle: () => void }) {
  const pathname = usePathname();
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
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuToggle}
        className="md:hidden mr-3 text-gray-500 hover:text-gray-800 transition-colors p-1"
        aria-label="Open menu"
      >
        <Menu size={22} />
      </button>
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-semibold text-gray-900 truncate">{getTitle(pathname)}</h2>
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
