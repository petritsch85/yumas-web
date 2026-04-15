'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  FlaskConical,
  Star,
  ClipboardList,
  ShoppingCart,
  Truck,
  ArrowLeftRight,
  Trash2,
  Factory,
  BarChart3,
  Calendar,
  Settings,
  Users,
  LogOut,
} from 'lucide-react';
import { supabase } from '@/lib/supabase-browser';
import { useEffect, useState } from 'react';
import type { Profile } from '@/types';

const navGroups = [
  {
    label: 'OVERVIEW',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    label: 'INVENTORY',
    items: [
      { label: 'Raw Materials', href: '/products/raw-materials', icon: Package },
      { label: 'Semi-Finished', href: '/products/semi-finished', icon: FlaskConical },
      { label: 'Finished Goods', href: '/products/finished', icon: Star },
      { label: 'Inventory Counts', href: '/inventory/counts', icon: ClipboardList },
    ],
  },
  {
    label: 'PROCUREMENT',
    items: [
      { label: 'Purchase Orders', href: '/purchase-orders', icon: ShoppingCart },
      { label: 'Suppliers', href: '/suppliers', icon: Truck },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { label: 'Transfers', href: '/transfers', icon: ArrowLeftRight },
      { label: 'Waste Log', href: '/waste', icon: Trash2 },
      { label: 'Production', href: '/production', icon: Factory },
    ],
  },
  {
    label: 'ANALYTICS',
    items: [
      { label: 'Reports', href: '/reports', icon: BarChart3 },
      { label: 'Calendar', href: '/calendar', icon: Calendar },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { label: 'Settings', href: '/settings', icon: Settings },
      { label: 'Users', href: '/settings/users', icon: Users },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()
          .then(({ data }) => {
            if (data) setProfile(data as Profile);
          });
      }
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div className="w-60 flex-shrink-0 h-screen flex flex-col overflow-y-auto" style={{ backgroundColor: '#1B5E20' }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="text-white font-bold text-xl tracking-tight">Yumas</div>
        <div className="text-white/60 text-xs mt-0.5">Inventory Manager</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-2 mb-1 text-white/40 text-xs font-semibold tracking-wider">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'text-white'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                    style={active ? { backgroundColor: '#2E7D32' } : undefined}
                  >
                    <Icon size={16} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-white/10">
        {profile && (
          <div className="mb-3">
            <div className="text-white text-sm font-medium truncate">{profile.full_name}</div>
            <div className="text-white/50 text-xs capitalize">{profile.role}</div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-white/70 hover:text-white text-sm transition-colors w-full"
        >
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
