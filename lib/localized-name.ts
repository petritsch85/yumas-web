import type { Lang } from './i18n';

export type LocalizableItem = {
  name: string;
  name_en?: string | null;
  name_de?: string | null;
  name_es?: string | null;
};

/**
 * Returns the best available name for `item` in the given language.
 * Falls back to the primary `name` column if no translation is set.
 */
export function localizedName(
  item: LocalizableItem | null | undefined,
  lang: Lang,
): string {
  if (!item) return '—';
  const col =
    lang === 'de' ? item.name_de :
    lang === 'es' ? item.name_es :
    item.name_en;
  return col?.trim() || item.name;
}
