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

import type { AppPermissions } from '@/types';

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
  permKey?: keyof AppPermissions; // required permission; absent = always visible
  adminOnly?: boolean;            // only shown to admins
};

type NavGroup = {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
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
      { label: 'Suppliers', href: '/suppliers',            icon: Store,           permKey: 'suppliers' },
      { label: 'Menus',     href: '/products/menus',      icon: UtensilsCrossed, permKey: 'products' },
      {
        label: 'Products', href: '/products', icon: Package, permKey: 'products',
        children: [
          { label: 'Raw Materials', href: '/products/raw-materials', icon: Package },
          { label: 'Semi Finished', href: '/products/semi-finished', icon: FlaskConical },
          { label: 'Finished',      href: '/products/finished',      icon: Utensils },
        ],
      },
      { label: 'Machines',  href: '/coming-soon/machines', icon: Wrench,        adminOnly: true },
      { label: 'Team',      href: '/settings/users',       icon: Users,         adminOnly: true },
    ],
  },
  {
    label: 'SUPPLY CHAIN',
    items: [
      {
        label: 'Inventory', href: '/inventory', icon: ClipboardList, permKey: 'inventory',
        children: [
          { label: 'Add New Inventory',  href: '/inventory/add',      icon: FilePlus },
          { label: 'Current Inventory',  href: '/inventory/overview', icon: BarChart3 },
          { label: 'Inventory Reports',  href: '/inventory/counts',   icon: ClipboardList },
        ],
      },
      {
        label: 'Production', href: '/production', icon: Factory, permKey: 'production',
        children: [
          { label: 'Batches', href: '/production',         icon: Factory },
          { label: 'Recipes', href: '/production/recipes', icon: ClipboardList },
        ],
      },
      { label: 'Buying',      href: '/purchase-orders',         icon: ShoppingCart, permKey: 'buying' },
      { label: 'Controlling', href: '/coming-soon/controlling', icon: TrendingUp,   adminOnly: true },
      { label: 'Waste Log',   href: '/waste',                   icon: Trash2,       permKey: 'waste_log' },
      {
        label: 'Delivery', href: '/delivery', icon: Truck, permKey: 'delivery',
        children: [
          { label: 'Packing',           href: '/delivery',          icon: Truck },
          { label: 'Sales Forecast',    href: '/delivery/forecast', icon: TrendingUp },
          { label: 'Delivery Reports',  href: '/delivery/reports',  icon: ClipboardList },
        ],
      },
      {
        label: 'Analysis', href: '/analysis', icon: BarChart3, permKey: 'analysis',
        children: [
          { label: 'COGS',        href: '/analysis/cogs',        icon: TrendingDown },
          { label: 'Store Yield', href: '/analysis/store-yield', icon: BarChart3 },
        ],
      },
    ],
  },
  {
    label: 'EVENTS',
    items: [
      { label: 'Events', href: '/events', icon: PartyPopper, permKey: 'events' },
    ],
  },
  {
    label: 'IN STORE',
    items: [
      {
        label: 'Staff Videos', href: '/staff-videos', icon: Users, permKey: 'staff_videos',
        children: [
          { label: 'Food Prep',   href: '/staff-videos/food-prep',   icon: UtensilsCrossed },
          { label: 'Drinks Prep', href: '/staff-videos/drinks-prep', icon: Utensils },
        ],
      },
      { label: 'Shift Roster', href: '/coming-soon/shift-roster', icon: CalendarDays, adminOnly: true },
    ],
  },
  {
    label: 'STAFFING',
    adminOnly: true,
    items: [
      { label: 'Holidays',        href: '/coming-soon/holidays',      icon: CalendarDays },
      { label: 'Sick Days',       href: '/coming-soon/sick-days',     icon: CalendarDays },
      { label: 'Training',        href: '/coming-soon/training',      icon: Users },
      { label: 'Health & Safety', href: '/coming-soon/health-safety', icon: Users },
    ],
  },
  {
    label: 'P&L REPORTS',
    items: [
      { label: 'Sales Reports', href: '/pl-reports/sales-reports', icon: LineChart,       permKey: 'pl_reports' },
      { label: 'Monthly P&L',   href: '/pl-reports/sales-reports', icon: TableProperties, permKey: 'pl_reports' },
    ],
  },
  {
    label: 'ANALYSIS',
    adminOnly: true,
    items: [
      { label: 'P&L Reports',     href: '/reports',                     icon: BarChart3 },
      { label: 'Cash Flow Check', href: '/coming-soon/cash-flow',       icon: Banknote },
      { label: 'Demand Forecast', href: '/coming-soon/demand-forecast', icon: TrendingDown },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { label: 'Accounts',      href: '/coming-soon/accounts',      icon: Building2, adminOnly: true },
      { label: 'Bills',         href: '/bills',                     icon: FilePlus,  permKey: 'bills' },
      { label: 'Create Bills',  href: '/bills/new',                 icon: FileCheck, permKey: 'bills' },
      { label: 'Approve Bills', href: '/coming-soon/approve-bills', icon: FileCheck, adminOnly: true },
    ],
  },
  {
    label: 'DOCUMENTS',
    adminOnly: true,
    items: [
      { label: 'Staff',     href: '/coming-soon/docs-staff',     icon: UserSquare },
      { label: 'Locations', href: '/coming-soon/docs-locations', icon: MapPin },
      { label: 'Suppliers', href: '/coming-soon/docs-suppliers', icon: Truck },
      { label: 'Other',     href: '/coming-soon/docs-other',     icon: FolderOpen },
    ],
  },
  {
    label: 'SETTINGS',
    adminOnly: true,
    items: [
      { label: 'Users',      href: '/settings/users',      icon: Users },
      { label: 'Locations',  href: '/settings/locations',  icon: MapPin },
      { label: 'Categories', href: '/settings/categories', icon: FolderOpen },
    ],
  },
];

type SidebarProps = { isOpen: boolean; onClose: () => void };

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Close sidebar on route change (mobile nav)
  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand any parent whose children include the current path.
  // We MERGE into the existing set so manually-opened items never get collapsed.
  useEffect(() => {
    const toExpand: string[] = [];
    for (const group of navGroups) {  // full list intentional — expand state independent of visibility
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

  // ── Permission filtering ──────────────────────────────────────────────────
  const isAdmin = profile?.role === 'admin';
  const perms   = profile?.permissions ?? {};

  const canSeeItem = (item: NavItem): boolean => {
    if (isAdmin) return true;
    if (item.adminOnly) return false;
    if (item.permKey) return !!perms[item.permKey];
    return true;
  };

  const visibleGroups = navGroups
    .filter(group => isAdmin || !group.adminOnly)
    .map(group => ({ ...group, items: group.items.filter(canSeeItem) }))
    .filter(group => group.items.length > 0);

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
    <div
      className={`fixed inset-y-0 left-0 z-40 w-64 flex flex-col overflow-y-auto transition-transform duration-300 ease-in-out md:relative md:w-60 md:flex-shrink-0 md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      style={{ backgroundColor: '#1B5E20' }}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="text-white font-bold text-xl tracking-tight">Yumas</div>
        <div className="text-white/60 text-xs mt-0.5">Inventory Manager</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {visibleGroups.map((group) => (
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
                        onClick={() => toggleExpanded(item.href)}
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
                          const childActive = pathname === child.href;
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
