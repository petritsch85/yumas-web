'use client';

import { statusColor } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const colorClass = statusColor(status);
  // Try translation first, fall back to formatted status string
  const key = `status.${status}`;
  const translated = t(key);
  const label = translated !== key
    ? translated
    : status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}
