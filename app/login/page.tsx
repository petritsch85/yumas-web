'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase-browser';

// Login page uses browser language directly (no LanguageProvider yet at this point)
type Lang = 'en' | 'de' | 'es';

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    inventoryManager: 'Inventory Manager',
    continueWithGoogle: 'Continue with Google',
    redirecting: 'Redirecting...',
    orSignInWithEmail: 'or sign in with email',
    email: 'Email',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    signIn: 'Sign In',
    signingIn: 'Signing in...',
  },
  de: {
    inventoryManager: 'Lagerverwaltung',
    continueWithGoogle: 'Mit Google fortfahren',
    redirecting: 'Weiterleitung...',
    orSignInWithEmail: 'oder mit E-Mail anmelden',
    email: 'E-Mail',
    password: 'Passwort',
    forgotPassword: 'Passwort vergessen?',
    signIn: 'Anmelden',
    signingIn: 'Anmeldung läuft...',
  },
  es: {
    inventoryManager: 'Gestor de Inventario',
    continueWithGoogle: 'Continuar con Google',
    redirecting: 'Redirigiendo...',
    orSignInWithEmail: 'o iniciar sesión con email',
    email: 'Email',
    password: 'Contraseña',
    forgotPassword: '¿Olvidaste tu contraseña?',
    signIn: 'Iniciar sesión',
    signingIn: 'Iniciando sesión...',
  },
};

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem('yumas-lang') as Lang | null;
  if (stored && ['en', 'de', 'es'].includes(stored)) return stored;
  const browser = navigator.language.slice(0, 2).toLowerCase();
  if (browser === 'de') return 'de';
  if (browser === 'es') return 'es';
  return 'en';
}

export default function LoginPage() {
  const router = useRouter();
  const lang = detectLang();
  const s = STRINGS[lang];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
    } else {
      router.push('/');
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) {
      setError(authError.message);
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold" style={{ color: '#1B5E20' }}>Yumas</div>
          <div className="text-gray-500 text-sm mt-1">{s.inventoryManager}</div>
        </div>

        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors disabled:opacity-60 mb-6"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01c-.72.48-1.63.76-2.7.76-2.07 0-3.83-1.4-4.46-3.29H1.86v2.07A8 8 0 0 0 8.98 17z"/>
            <path fill="#FBBC05" d="M4.52 10.52A4.8 4.8 0 0 1 4.27 9c0-.53.09-1.04.25-1.52V5.41H1.86A8 8 0 0 0 .98 9c0 1.29.31 2.51.88 3.59l2.66-2.07z"/>
            <path fill="#EA4335" d="M8.98 3.58c1.16 0 2.2.4 3.02 1.19l2.26-2.26A8 8 0 0 0 .98 9l2.9 2.24C4.43 9.1 6.5 3.58 8.98 3.58z"/>
          </svg>
          {googleLoading ? s.redirecting : s.continueWithGoogle}
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 border-t border-gray-200" />
          <span className="text-xs text-gray-400">{s.orSignInWithEmail}</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{s.email}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': '#1B5E20' } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{s.password}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            />
          </div>
          {error && (
            <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
            style={{ backgroundColor: '#1B5E20' }}
            onMouseEnter={(e) => { if (!loading) (e.target as HTMLButtonElement).style.backgroundColor = '#2E7D32'; }}
            onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.backgroundColor = '#1B5E20'; }}
          >
            {loading ? s.signingIn : s.signIn}
          </button>
          <div className="text-center">
            <Link href="/login/forgot-password" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
              {s.forgotPassword}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
