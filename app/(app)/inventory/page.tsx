'use client';

import { useRouter } from 'next/navigation';
import { FilePlus, ClipboardList } from 'lucide-react';

const items = [
  {
    icon: FilePlus,
    label: 'Add New Inventory',
    sublabel: 'Add a new item or opening stock',
    href: '/inventory/add',
    color: '#2E7D32',
  },
  {
    icon: ClipboardList,
    label: 'Current Inventory',
    sublabel: 'View stock levels by location',
    href: '/inventory/counts',
    color: '#1565C0',
  },
];

export default function InventoryHubPage() {
  const router = useRouter();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Inventory</h1>
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
                <div className="font-medium text-gray-900">{item.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{item.sublabel}</div>
              </div>
              <svg className="text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
