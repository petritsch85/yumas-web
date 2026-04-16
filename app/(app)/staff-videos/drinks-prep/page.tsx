'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, GlassWater } from 'lucide-react';

export default function DrinksPrepPage() {
  const router = useRouter();

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="text-2xl font-bold text-gray-900">Drinks Prep</h1>
      </div>

      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
          <GlassWater size={32} className="text-gray-300" />
        </div>
        <p className="text-gray-800 font-semibold mt-2">Drinks Prep Videos</p>
        <p className="text-sm text-gray-400">Training videos coming soon</p>
      </div>
    </div>
  );
}
