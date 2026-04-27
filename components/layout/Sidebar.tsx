'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Store,
  MapPin,
  UtensilsCrossed,
  Wrench,
  Users,
  Package,
  FlaskConical,
  Utensils,
  ClipboardList,
  Factory,
  ShoppingCart,
  TrendingUp,
  Trash2,
  CalendarDays,
  BarChart3,
  Banknote,
  TrendingDown,
  Building2,
  FilePlus,
  FileCheck,
  UserSquare,
  FolderOpen,
  LogOut,
  Truck,
  Target,
  ChevronDown,
  ChevronRight,
  FileUp,
  LineChart,
  TableProperties,
  PartyPopper,
} from 'lucide-react';
import { supabase } from '@/lib/supabase-browser';
import { useEffect, useState } from 'react';
import type { Profile } from '@/types';

type ChildItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
};

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  children?: ChildItem[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: 'OVERVIEW',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    label: 'DATA',
    items: [
      { label: 'Suppliers',  href: '/suppliers',  icon: Store },
      { label: 'Locations',  href: '/locations',  icon: MapPin },
      { label: 'Menus',      href: '/products/menus', icon: UtensilsCrossed },
      { label: 'Machines',   href: '/coming-soon/machines',   icon: Wrench },
      { label: 'Team',        href: '/settings/users',          icon: Users },
    ],
  },
  {
    label: 'SUPPLY CHAIN',
    items: [
      {
        label: 'Products', href: '/products', icon: Package,
        children: [
          { label: '1 - Raw Materials', href: '/products/raw-materials', icon: Package },
          { label: '2 - Semi Finished', href: '/products/semi-finished', icon: FlaskConical },
          { label: '3 - Finished',      href: '/products/finished',      icon: Utensils },
        ],
      },
      {
        label: 'Inventory', href: '/inventory', icon: ClipboardList,
        children: [
          { label: 'Add New Inventory',  href: '/inventory/add',      icon: FilePlus },
          { label: 'Current Inventory',  href: '/inventory/overview', icon: BarChart3 },
          { label: 'Inventory Reports',  href: '/inventory/counts',   icon: ClipboardList },
        ],
      },
      {
        label: 'Production', href: '/production', icon: Factory,
        children: [
          { label: 'Batches', href: '/production',         icon: Factory },
          { label: 'Recipes', href: '/production/recipes', icon: ClipboardList },
        ],
      },
      { label: 'Buying',             href: '/purchase-orders',         icon: ShoppingCart },
      { label: 'Controlling',        href: '/coming-soon/controlling', icon: TrendingUp },
      { label: 'Waste Log',          href: '/waste',                   icon: Trash2 },
      {
        label: 'Delivery', href: '/delivery', icon: Truck,
        children: [
          { label: 'Delivery Run',   href: '/delivery',          icon: Truck },
          { label: 'Target Levels',  href: '/delivery/targets',  icon: Target },
          { label: 'Sales Forecast', href: '/delivery/forecast', icon: TrendingUp },
        ],
      },
    ],
  },
  {
    label: 'EVENTS',
    items: [
      { label: 'Events', href: '/events', icon: PartyPopper },
    ],
  },
  {
    label: 'IN STORE',
    items: [
      {
        label: 'Staff Videos', href: '/staff-videos', icon: Users,
        children: [
          { label: 'Food Prep',   href: '/staff-videos/food-prep',   icon: UtensilsCrossed },
          { label: 'Drinks Prep', href: '/staff-videos/drinks-prep', icon: Utensils },
        ],
      },
      { label: 'Shift Roster',      href: '/coming-soon/shift-roster',  icon: CalendarDays },
    ],
  },
  {
    label: 'STAFFING',
    items: [
      { label: 'Holidays',        href: '/coming-soon/holidays',        icon: CalendarDays },
      { label: 'Sick Days',       href: '/coming-soon/sick-days',       icon: CalendarDays },
      { label: 'Training',        href: '/coming-soon/training',        icon: Users },
      { label: 'Health & Safety', href: '/coming-soon/health-safety',   icon: Users },
    ],
  },
  {
    label: 'P&L REPORTS',
    items: [
      { label: 'Sales Reports',  href: '/pl-reports/sales-reports', icon: LineChart },
      { label: 'Monthly P&L',    href: '/pl-reports/sales-reports', icon: TableProperties },
    ],
  },
  {
    label: 'ANALYSIS',
    items: [
      { label: 'P&L Reports',     href: '/reports',                      icon: BarChart3 },
      { label: 'Cash Flow Check', href: '/coming-soon/cash-flow',        icon: Banknote },
      { label: 'Demand Forecast', href: '/coming-soon/demand-forecast',  icon: TrendingDown },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { label: 'Accounts',      href: '/coming-soon/accounts',       icon: Building2 },
      { label: 'Bills',         href: '/bills',                      icon: FilePlus },
      { label: 'Create Bills',  href: '/bills/new',                  icon: FileCheck },
      { label: 'Approve Bills', href: '/coming-soon/approve-bills',  icon: FileCheck },
    ],
  },
  {
    label: 'DOCUMENTS',
    items: [
      { label: 'Staff',      href: '/coming-soon/docs-staff',      icon: UserSquare },
      { label: 'Locations',  href: '/coming-soon/docs-locations',  icon: MapPin },
      { label: 'Suppliers',  href: '/coming-soon/docs-suppliers',  icon: Truck },
      { label: 'Other',      href: '/coming-soon/docs-other',      icon: FolderOpen },
    ],
  },
  {
    label: 'SETTINGS',
    items: [
      { label: 'Users',      href: '/settings/users',      icon: Users },
      { label: 'Locations',  href: '/settings/locations',  icon: MapPin },
      { label: 'Categories', href: '/settings/categories', icon: FolderOpen },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand any parent whose children include the current path.
  // We MERGE into the existing set so manually-opened items never get collapsed.
  useEffect(() => {
    const toExpand: string[] = [];
    for (const group of navGroups) {
      for (const item of group.items) {
        if (item.children) {
          const childActive = item.children.some((c) =>
            pathname === c.href || pathname.startsWith(c.href + '/')
          );
          if (childActive) toExpand.push(item.href);
        }
      }
    }
    if (toExpand.length > 0) {
      setExpanded(prev => {
        const next = new Set(prev);
        for (const href of toExpand) next.add(href);
        return next;
      });
    }
  }, [pathname]);

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
    return pathname === href || pathname.startsWith(href + '/');
  };

  const toggleExpanded = (href: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(href)) {
        next.delete(href);
      } else {
        next.add(href);
      }
      return next;
    });
  };

  return (
    <div className="w-60 flex-shrink-0 h-screen flex flex-col overflow-y-auto" style={{ backgroundColor: '#1B5E20' }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="text-white font-bold text-xl tracking-tight">Yumas</div>
        <div className="text-white/60 text-xs mt-0.5">Inventory Manager</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-2 mb-1 text-white/40 text-xs font-semibold tracking-wider">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                const isComingSoon = item.href.startsWith('/coming-soon');
                const hasChildren = !!item.children?.length;
                const isExpanded = expanded.has(item.href);

                return (
                  <div key={item.href}>
                    {/* Parent row */}
                    {hasChildren ? (
                      <button
                        onClick={() => {
                          router.push(item.href);
                          toggleExpanded(item.href);
                        }}
                        className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors px-3 py-2 ${
                          active
                            ? 'text-white'
                            : 'text-white/70 hover:text-white hover:bg-white/10'
                        }`}
                        style={active ? { backgroundColor: '#2E7D32' } : undefined}
                      >
                        <Icon size={16} />
                        <span className="truncate flex-1 text-left">{item.label}</span>
                        {isExpanded
                          ? <ChevronDown size={14} className="flex-shrink-0 opacity-60" />
                          : <ChevronRight size={14} className="flex-shrink-0 opacity-60" />
                        }
                      </button>
                    ) : (
                      <Link
                        href={item.href}
                        className={`flex items-center gap-3 rounded-lg text-sm font-medium transition-colors px-3 py-2 ${
                          active
                            ? 'text-white'
                            : isComingSoon
                            ? 'text-white/40 cursor-default pointer-events-none'
                            : 'text-white/70 hover:text-white hover:bg-white/10'
                        }`}
                        style={active ? { backgroundColor: '#2E7D32' } : undefined}
                      >
                        <Icon size={16} />
                        <span className="truncate">{item.label}</span>
                        {isComingSoon && (
                          <span className="ml-auto text-white/30 text-xs">Soon</span>
                        )}
                      </Link>
                    )}

                    {/* Children (collapsible) */}
                    {hasChildren && isExpanded && (
                      <div className="mt-0.5 space-y-0.5">
                        {item.children!.map((child) => {
                          const ChildIcon = child.icon;
                          const childActive = isActive(child.href);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={`flex items-center gap-3 rounded-lg text-xs font-medium transition-colors px-3 py-1.5 ml-4 ${
                                childActive
                                  ? 'text-white'
                                  : 'text-white/50 hover:text-white/80 hover:bg-white/10'
                              }`}
                              style={childActive ? { backgroundColor: '#2E7D32' } : undefined}
                            >
                              <ChildIcon size={14} />
                              <span className="truncate">{child.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-white/10 flex-shrink-0">
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
