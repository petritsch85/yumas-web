'use client';

import { useRouter } from 'next/navigation';
import { FilePlus, BarChart3, ClipboardList } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function InventoryHubPage() {
  const router = useRouter();
  const { t } = useT();

  const items = [
    {
      icon: FilePlus,
      labelKey: 'inventory.addNew.label',
      sublabelKey: 'inventory.addNew.sublabel',
      href: '/inventory/add',
      color: '#2E7D32',
    },
    {
      icon: BarChart3,
      labelKey: 'inventory.current.label',
      sublabelKey: 'inventory.current.sublabel',
      href: '/inventory/overview',
      color: '#1565C0',
    },
    {
      icon: ClipboardList,
      labelKey: 'inventory.reports.label',
      sublabelKey: 'inventory.reports.sublabel',
      href: '/inventory/counts',
      color: '#6A1B9A',
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('inventory.title')}</h1>
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden max-w-lg">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left ${
                i < items.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: item.color + '18' }}
              >
                <Icon size={20} style={{ color: item.color }} />
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">{t(item.labelKey)}</div>
                <div className="text-xs text-gray-500 mt-0.5">{t(item.sublabelKey)}</div>
              </div>
              <svg className="text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
