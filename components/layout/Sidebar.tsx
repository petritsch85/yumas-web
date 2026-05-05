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
import { useT } from '@/lib/i18n';

type ChildItem = {
  labelKey: string;
  href: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
};

type NavItem = {
  labelKey: string;
  href: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  children?: ChildItem[];
  permKey?: keyof AppPermissions;
  adminOnly?: boolean;
};

type NavGroup = {
  labelKey: string;
  items: NavItem[];
  adminOnly?: boolean;
};

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'sidebar.groups.overview',
    items: [
      { labelKey: 'sidebar.nav.dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    labelKey: 'sidebar.groups.data',
    items: [
      { labelKey: 'sidebar.nav.suppliers', href: '/suppliers',            icon: Store,           permKey: 'suppliers' },
      { labelKey: 'sidebar.nav.menus',     href: '/products/menus',      icon: UtensilsCrossed, permKey: 'products' },
      {
        labelKey: 'sidebar.nav.products', href: '/products', icon: Package, permKey: 'products',
        children: [
          { labelKey: 'sidebar.nav.rawMaterials', href: '/products/raw-materials', icon: Package },
          { labelKey: 'sidebar.nav.finished',     href: '/products/finished',      icon: Utensils },
        ],
      },
      { labelKey: 'sidebar.nav.locations', href: '/settings/locations',   icon: MapPin,        adminOnly: true },
      { labelKey: 'sidebar.nav.machines',  href: '/coming-soon/machines', icon: Wrench,        adminOnly: true },
      { labelKey: 'sidebar.nav.team',      href: '/settings/users',       icon: Users,         adminOnly: true },
    ],
  },
  {
    labelKey: 'sidebar.groups.plReports',
    items: [
      { labelKey: 'sidebar.nav.stats',        href: '/pl-reports/stats',         icon: BarChart3, permKey: 'pl_reports' },
      { labelKey: 'sidebar.nav.salesReports', href: '/pl-reports/sales-reports', icon: LineChart,  permKey: 'pl_reports' },
    ],
  },
  {
    labelKey: 'sidebar.groups.supplyChain',
    items: [
      {
        labelKey: 'sidebar.nav.inventory', href: '/inventory', icon: ClipboardList, permKey: 'inventory',
        children: [
          { labelKey: 'sidebar.nav.addNewInventory',  href: '/inventory/add',            icon: FilePlus },
          { labelKey: 'sidebar.nav.currentInventory', href: '/inventory/overview',        icon: BarChart3 },
          { labelKey: 'sidebar.nav.inventoryReports', href: '/inventory/counts',          icon: ClipboardList },
          { labelKey: 'sidebar.nav.usageForecast',    href: '/inventory/usage-forecast',  icon: TrendingDown },
        ],
      },
      {
        labelKey: 'sidebar.nav.delivery', href: '/delivery', icon: Truck, permKey: 'delivery',
        children: [
          { labelKey: 'sidebar.nav.stages',           href: '/delivery',          icon: Truck },
          { labelKey: 'sidebar.nav.salesForecast',    href: '/delivery/forecast', icon: TrendingUp },
          { labelKey: 'sidebar.nav.deliveryReports',  href: '/delivery/reports',  icon: ClipboardList },
        ],
      },
      { labelKey: 'sidebar.nav.recipes', href: '/products/semi-finished', icon: FlaskConical, permKey: 'production' },
      { labelKey: 'sidebar.nav.buying',      href: '/purchase-orders',         icon: ShoppingCart, permKey: 'buying' },
      { labelKey: 'sidebar.nav.controlling', href: '/coming-soon/controlling', icon: TrendingUp,   adminOnly: true },
      { labelKey: 'sidebar.nav.wasteLog',    href: '/waste',                   icon: Trash2,       permKey: 'waste_log' },
      {
        labelKey: 'sidebar.nav.analysis', href: '/analysis', icon: BarChart3, permKey: 'analysis',
        children: [
          { labelKey: 'sidebar.nav.cogs',       href: '/analysis/cogs',        icon: TrendingDown },
          { labelKey: 'sidebar.nav.storeYield', href: '/analysis/store-yield', icon: BarChart3 },
        ],
      },
    ],
  },
  {
    labelKey: 'sidebar.groups.events',
    items: [
      { labelKey: 'sidebar.nav.events', href: '/events', icon: PartyPopper, permKey: 'events' },
    ],
  },
  {
    labelKey: 'sidebar.groups.inStore',
    items: [
      {
        labelKey: 'sidebar.nav.staffVideos', href: '/staff-videos', icon: Users, permKey: 'staff_videos',
        children: [
          { labelKey: 'sidebar.nav.foodPrep',   href: '/staff-videos/food-prep',   icon: UtensilsCrossed },
          { labelKey: 'sidebar.nav.drinksPrep', href: '/staff-videos/drinks-prep', icon: Utensils },
        ],
      },
      { labelKey: 'sidebar.nav.shiftRoster', href: '/coming-soon/shift-roster', icon: CalendarDays, adminOnly: true },
    ],
  },
  {
    labelKey: 'sidebar.groups.staffing',
    adminOnly: true,
    items: [
      { labelKey: 'sidebar.nav.holidays',     href: '/coming-soon/holidays',      icon: CalendarDays },
      { labelKey: 'sidebar.nav.sickDays',     href: '/coming-soon/sick-days',     icon: CalendarDays },
      { labelKey: 'sidebar.nav.training',     href: '/coming-soon/training',      icon: Users },
      { labelKey: 'sidebar.nav.healthSafety', href: '/coming-soon/health-safety', icon: Users },
    ],
  },
  {
    labelKey: 'sidebar.groups.analysis',
    adminOnly: true,
    items: [
      { labelKey: 'sidebar.nav.plReports',      href: '/reports',                     icon: BarChart3 },
      { labelKey: 'sidebar.nav.cashFlowCheck',  href: '/coming-soon/cash-flow',       icon: Banknote },
      { labelKey: 'sidebar.nav.demandForecast', href: '/coming-soon/demand-forecast', icon: TrendingDown },
    ],
  },
  {
    labelKey: 'sidebar.groups.admin',
    items: [
      { labelKey: 'sidebar.nav.accounts',     href: '/coming-soon/accounts',      icon: Building2, adminOnly: true },
      {
        labelKey: 'sidebar.nav.bills', href: '/bills', icon: FilePlus, permKey: 'bills',
        children: [
          { labelKey: 'sidebar.nav.incoming', href: '/bills',          icon: FilePlus },
          { labelKey: 'sidebar.nav.outgoing', href: '/bills/outgoing', icon: FileCheck },
        ],
      },
      { labelKey: 'sidebar.nav.approveBills', href: '/coming-soon/approve-bills', icon: FileCheck, adminOnly: true },
    ],
  },
  {
    labelKey: 'sidebar.groups.documents',
    adminOnly: true,
    items: [
      { labelKey: 'sidebar.nav.staff',     href: '/coming-soon/docs-staff',     icon: UserSquare },
      { labelKey: 'sidebar.nav.locations', href: '/coming-soon/docs-locations', icon: MapPin },
      { labelKey: 'sidebar.nav.suppliers', href: '/coming-soon/docs-suppliers', icon: Truck },
      { labelKey: 'sidebar.nav.other',     href: '/coming-soon/docs-other',     icon: FolderOpen },
    ],
  },
  {
    labelKey: 'sidebar.groups.settings',
    adminOnly: true,
    items: [
      { labelKey: 'sidebar.nav.users',      href: '/settings/users',      icon: Users },
      { labelKey: 'sidebar.nav.categories', href: '/settings/categories', icon: FolderOpen },
    ],
  },
];

type SidebarProps = { isOpen: boolean; onClose: () => void };

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useT();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const toExpand: string[] = [];
    for (const group of NAV_GROUPS) {
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

  const isAdmin = profile?.role === 'admin';
  const perms   = profile?.permissions ?? {};

  const canSeeItem = (item: NavItem): boolean => {
    if (isAdmin) return true;
    if (item.adminOnly) return false;
    if (item.permKey) return !!perms[item.permKey];
    return true;
  };

  const visibleGroups = NAV_GROUPS
    .filter(group => isAdmin || !group.adminOnly)
    .map(group => ({ ...group, items: group.items.filter(canSeeItem) }))
    .filter(group => group.items.length > 0);

  const toggleExpanded = (href: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
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
        <div className="text-white/60 text-xs mt-0.5">{t('sidebar.inventoryManager')}</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {visibleGroups.map((group) => (
          <div key={group.labelKey}>
            <div className="px-2 mb-1 text-white/40 text-xs font-semibold tracking-wider">
              {t(group.labelKey)}
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
                    {hasChildren ? (
                      <button
                        onClick={() => toggleExpanded(item.href)}
                        className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors px-3 py-2 ${
                          active ? 'text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
                        }`}
                        style={active ? { backgroundColor: '#2E7D32' } : undefined}
                      >
                        <Icon size={16} />
                        <span className="truncate flex-1 text-left">{t(item.labelKey)}</span>
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
                        <span className="truncate">{t(item.labelKey)}</span>
                        {isComingSoon && (
                          <span className="ml-auto text-white/30 text-xs">{t('sidebar.soon')}</span>
                        )}
                      </Link>
                    )}

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
                              <span className="truncate">{t(child.labelKey)}</span>
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
          {t('sidebar.signOut')}
        </button>
      </div>
    </div>
  );
}
