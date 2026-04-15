import Link from 'next/link';
import { Tag, Ruler, MapPin, Users } from 'lucide-react';

const settingsLinks = [
  { label: 'Categories', description: 'Manage item categories and colours', href: '/settings/categories', icon: Tag },
  { label: 'Units of Measure', description: 'Manage measurement units', href: '/settings/units', icon: Ruler },
  { label: 'Locations', description: 'Manage restaurant and production locations', href: '/settings/locations', icon: MapPin },
  { label: 'Users', description: 'Manage staff accounts and roles', href: '/settings/users', icon: Users },
];

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure your inventory system</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
    </div>
  );
}
