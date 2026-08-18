'use client';

import { useEffect } from 'react';

export default function ItemsError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error('Items page error:', error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="text-red-500 font-semibold text-lg mb-2">Items page crashed</div>
      <div className="text-gray-500 text-sm font-mono bg-gray-100 rounded-lg p-4 text-left break-all">
        {error.message}
        {error.digest && <div className="mt-2 text-xs text-gray-400">Digest: {error.digest}</div>}
      </div>
    </div>
  );
}
