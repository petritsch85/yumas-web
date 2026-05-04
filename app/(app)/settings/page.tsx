'use client';

import Link from 'next/link';
import { Tag, Ruler, MapPin, Users } from 'lucide-react';
import { useT, type Lang } from '@/lib/i18n';

const FLAG: Record<Lang, string> = { en: '🇬🇧', de: '🇩🇪', es: '🇪🇸' };
const LANGS: Lang[] = ['en', 'de', 'es'];

export default function SettingsPage() {
  const { t, lang, setLang } = useT();

  const settingsLinks = [
    { label: t('settings.categories.label'), description: t('settings.categories.description'), href: '/settings/categories', icon: Tag },
    { label: t('settings.units.label'),      description: t('settings.units.description'),      href: '/settings/units',       icon: Ruler },
    { label: t('settings.locations.label'),  description: t('settings.locations.description'),  href: '/settings/locations',   icon: MapPin },
    { label: t('settings.users.label'),      description: t('settings.users.description'),      href: '/settings/users',       icon: Users },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('settings.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('settings.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {settingsLinks.map(({ label, description, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 flex items-center gap-4 hover:border-gray-200 hover:shadow transition-all group"
          >
            <div className="rounded-full p-3 bg-gray-50 group-hover:bg-green-50 transition-colors">
              <Icon size={20} className="text-gray-500 group-hover:text-[#1B5E20] transition-colors" />
            </div>
            <div>
              <div className="font-semibold text-gray-900">{label}</div>
              <div className="text-sm text-gray-500">{description}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Language selector */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 max-w-sm">
        <div className="font-semibold text-gray-900 mb-1">{t('settings.language.title')}</div>
        <div className="text-sm text-gray-500 mb-4">{t('settings.language.subtitle')}</div>
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                lang === l
                  ? 'border-[#1B5E20] bg-[#1B5E20] text-white'
                  : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <span>{FLAG[l]}</span>
              <span>{t(`language.${l}`)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
