'use client';

import { useRouter } from 'next/navigation';
import { Package, FlaskConical, Utensils, ChevronRight } from 'lucide-react';

const sections = [
  {
    label: '1 - Raw Materials',
    description: 'Ingredients and base materials used in production',
    href: '/products/raw-materials',
    icon: Package,
    color: '#2E7D32',
    bg: '#2E7D3218',
  },
  {
    label: '2 - Semi Finished',
    description: 'Prepared components made at the central kitchen',
    href: '/products/semi-finished',
    icon: FlaskConical,
    color: '#F57C00',
    bg: '#F57C0018',
  },
  {
    label: '3 - Finished',
    description: 'Final products ready for service',
    href: '/products/finished',
    icon: Utensils,
    color: '#BF360C',
    bg: '#BF360C18',
  },
];

export default function ProductsIndexPage() {
  const router = useRouter();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <p className="text-sm text-gray-500 mt-1">Select a product category</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden max-w-lg">
        {sections.map((s, idx) => {
          const Icon = s.icon;
          return (
            <button
              key={s.href}
              onClick={() => router.push(s.href)}
              className={`w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left ${idx < sections.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: s.bg }}>
                <Icon size={20} style={{ color: s.color }} />
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900 text-sm">{s.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.description}</div>
              </div>
              <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
