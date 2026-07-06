'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import { LanguageProvider } from '@/lib/i18n';

/* ─── Push subscription helper ──────────────────────────────────────────────── */
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await sendSubscriptionToServer(existing);
      return;
    }

    const VAPID_PUBLIC_KEY = 'BHIatRmyZ5TbxlYrhey9wPW1BCz8zktL2mZ_hgIYafnitRTvKb-p5vdbdWj0Idym1a7xSrzbM2JzRq-OzOHEJRg';
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    await sendSubscriptionToServer(sub);
  } catch (err) {
    console.warn('Push subscribe failed:', err);
  }
}

async function sendSubscriptionToServer(sub: PushSubscription) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const key = sub.getKey('p256dh');
  const auth = sub.getKey('auth');
  if (!key || !auth) return;

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
      auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
    }),
  });
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (window.navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

/* ─── iOS Add-to-Home-Screen banner ─────────────────────────────────────────── */
function IosBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isIos() && !isStandalone() && !localStorage.getItem('ios-banner-dismissed')) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 pb-safe">
      <div className="mx-4 mb-4 bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#1B5E20] flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-lg">Y</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm">Enable push notifications</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Tap <strong>Share</strong>{' '}
            <span className="inline-block">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline-block text-blue-500">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </span>{' '}
            then <strong>"Add to Home Screen"</strong> to receive notifications for messages and tasks.
          </p>
        </div>
        <button
          onClick={() => { setShow(false); localStorage.setItem('ios-banner-dismissed', '1'); }}
          className="text-gray-400 hover:text-gray-600 flex-shrink-0 -mt-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/* ─── Layout ─────────────────────────────────────────────────────────────────── */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar  = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/login');
      else {
        setChecking(false);
        // Auto-subscribe to push if permission already granted (no prompt on reload)
        if (Notification.permission === 'granted') {
          subscribeToPush();
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) router.replace('/login');
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-green-700 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <LanguageProvider>
      <div className="flex h-screen overflow-hidden">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={closeSidebar}
          />
        )}
        <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 md:ml-60">
          <TopBar onMenuToggle={toggleSidebar} />
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 bg-gray-50">
            {children}
          </main>
        </div>
      </div>
      <IosBanner />
    </LanguageProvider>
  );
}
