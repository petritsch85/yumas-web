import { statusColor } from '@/lib/utils';

export function StatusBadge({ status }: { status: string }) {
  const colorClass = statusColor(status);
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}
