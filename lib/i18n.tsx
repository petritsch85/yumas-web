'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/supabase-browser';

export type Lang = 'en' | 'de' | 'es';

// Cache loaded translations in memory
const cache: Partial<Record<Lang, Record<string, unknown>>> = {};

async function load(lang: Lang): Promise<Record<string, unknown>> {
  if (cache[lang]) return cache[lang]!;
  const mod = await import(`@/locales/${lang}.json`);
  cache[lang] = mod.default as Record<string, unknown>;
  return cache[lang]!;
}

// Resolve a dot-path like "sidebar.nav.dashboard" from a nested object
function resolve(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

type LanguageContextType = {
  lang: Lang;
  setLang: (lang: Lang) => Promise<void>;
  t: (key: string) => string;
};

const LanguageContext = createContext<LanguageContextType>({
  lang: 'en',
  setLang: async () => {},
  t: (key) => key,
});

// Detect initial language: localStorage → browser → 'en'
function detectInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem('yumas-lang') as Lang | null;
  if (stored && ['en', 'de', 'es'].includes(stored)) return stored;
  const browser = navigator.language.slice(0, 2).toLowerCase();
  if (browser === 'de') return 'de';
  if (browser === 'es') return 'es';
  return 'en';
}

export function LanguageProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);
  const [msgs, setMsgs] = useState<Record<string, unknown>>({});

  // Load translations whenever lang changes
  useEffect(() => {
    load(lang).then(setMsgs);
  }, [lang]);

  // On mount: fetch profile language from Supabase and override if different
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('language')
        .eq('id', user.id)
        .single();
      const profileLang = data?.language as Lang | null;
      if (profileLang && ['en', 'de', 'es'].includes(profileLang) && profileLang !== lang) {
        localStorage.setItem('yumas-lang', profileLang);
        setLangState(profileLang);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = useCallback(async (newLang: Lang) => {
    localStorage.setItem('yumas-lang', newLang);
    setLangState(newLang);
    // Persist to profile
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('profiles').update({ language: newLang }).eq('id', user.id);
    }
  }, []);

  const t = useCallback((key: string): string => {
    if (!msgs || Object.keys(msgs).length === 0) {
      // Translations not yet loaded — return last segment as fallback
      return key.split('.').pop() ?? key;
    }
    return resolve(msgs, key) ?? key;
  }, [msgs]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useT() {
  return useContext(LanguageContext);
}
