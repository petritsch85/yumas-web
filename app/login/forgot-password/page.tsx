'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase-browser';
import type { Lang } from '@/lib/i18n';

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem('yumas-lang') as Lang | null;
  if (stored && ['en', 'de', 'es'].includes(stored)) return stored;
  const browser = navigator.language.slice(0, 2).toLowerCase();
  if (browser === 'de') return 'de';
  if (browser === 'es') return 'es';
  return 'en';
}

const STRINGS: Record<Lang, {
  title: string; subtitle: string; email: string;
  sendLink: string; sending: string; backToLogin: string; successMessage: string;
}> = {
  en: {
    title: 'Reset Password',
    subtitle: 'Enter your email address and we will send you a password reset link.',
    email: 'Email',
    sendLink: 'Send Reset Link',
    sending: 'Sending...',
    backToLogin: 'Back to Sign In',
    successMessage: 'Password reset email sent. Check your inbox.',
  },
  de: {
    title: 'Passwort zurücksetzen',
    subtitle: 'Geben Sie Ihre E-Mail-Adresse ein und wir senden Ihnen einen Link.',
    email: 'E-Mail',
    sendLink: 'Link senden',
    sending: 'Sendet...',
    backToLogin: 'Zurück zur Anmeldung',
    successMessage: 'Überprüfen Sie Ihre E-Mail für einen Link zum Zurücksetzen des Passworts.',
  },
  es: {
    title: 'Restablecer Contraseña',
    subtitle: 'Introduce tu email y te enviaremos un enlace de restablecimiento.',
    email: 'Email',
    sendLink: 'Enviar enlace',
    sending: 'Enviando...',
    backToLogin: 'Volver al inicio de sesión',
    successMessage: 'Revisa tu email para encontrar el enlace de restablecimiento.',
  },
};

export default function ForgotPasswordPage() {
  const s = STRINGS[detectLang()];
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (err) {
      setError(err.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold" style={{ color: '#1B5E20' }}>Yumas</div>
          <div className="text-gray-500 text-sm mt-1">{s.title}</div>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <div className="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm">
              {s.successMessage}
            </div>
            <Link href="/login" className="text-sm font-medium" style={{ color: '#1B5E20' }}>
              {s.backToLogin}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">{s.subtitle}</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{s.email}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>

            {error && (
              <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-60"
              style={{ backgroundColor: '#1B5E20' }}
            >
              {loading ? s.sending : s.sendLink}
            </button>

            <div className="text-center">
              <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700">
                {s.backToLogin}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
