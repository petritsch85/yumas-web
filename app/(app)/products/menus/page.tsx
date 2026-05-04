'use client';

import { UtensilsCrossed } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function MenusPage() {
  const { t } = useT();

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('sidebar.nav.menus')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('menus.subtitle')}</p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-full bg-[#1B5E20]/10 flex items-center justify-center mb-4">
          <UtensilsCrossed size={32} className="text-[#1B5E20]" />
        </div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">{t('menus.comingSoon')}</h2>
        <p className="text-sm text-gray-500 max-w-sm">{t('menus.comingSoonDesc')}</p>
      </div>
    </div>
  );
}
