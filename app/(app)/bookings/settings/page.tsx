'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Mail, CheckCircle2, AlertCircle, ExternalLink, RefreshCw,
} from 'lucide-react';

type GmailCredential = {
  id: string;
  email: string;
  created_at: string;
  updated_at: string | null;
  token_expiry: string | null;
};

type StatusResponse = {
  connected: boolean;
  credential: GmailCredential | null;
  error?: string;
};

export default function BookingSettingsPage() {
  const searchParams   = useSearchParams();
  const urlError       = searchParams.get('error');
  const urlConnected   = searchParams.get('connected');
  const [reconnecting, setReconnecting] = useState(false);

  const { data: status, isLoading, refetch } = useQuery<StatusResponse>({
    queryKey: ['gmail_status'],
    queryFn: async () => {
      const res = await fetch('/api/bookings/gmail-status');
      return res.json();
    },
    // Refetch once when ?connected=true appears so the UI updates immediately
    refetchOnMount: true,
  });

  // Auto-refetch when redirected back with ?connected=true
  useEffect(() => {
    if (urlConnected === 'true') {
      refetch();
    }
  }, [urlConnected, refetch]);

  const connected = status?.connected ?? false;
  const cred      = status?.credential ?? null;

  const handleConnect = () => {
    setReconnecting(true);
    window.location.href = '/api/auth/gmail';
  };

  const handleTestScan = async () => {
    try {
      const res  = await fetch('/api/bookings/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`✓ Scan successful — processed ${data.processed} email(s), found ${data.bookings} booking request(s).`);
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  // Human-readable error messages
  const errorMessage = (() => {
    if (!urlError) return null;
    if (urlError === 'no_refresh_token') return 'Google did not return a refresh token. Please click "Reconnect" below to try again — make sure to click "Continue" on every screen Google shows.';
    if (urlError === 'access_denied')    return 'Access was denied. Please try connecting again and grant all requested permissions.';
    if (urlError === 'no_code')          return 'OAuth flow incomplete — no authorisation code received. Please try again.';
    return `Connection error: ${urlError}`;
  })();

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Booking Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure the Gmail inbox used for booking requests</p>
      </div>

      {/* Error banner from OAuth redirect */}
      {errorMessage && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Success banner */}
      {urlConnected === 'true' && connected && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 size={16} className="flex-shrink-0" />
          Gmail connected successfully!
        </div>
      )}

      {/* Gmail Connection Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#1B5E20]/10 flex items-center justify-center flex-shrink-0">
            <Mail size={20} className="text-[#1B5E20]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Gmail Connection</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Connect a Gmail inbox to scan for incoming booking requests
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <RefreshCw size={14} className="animate-spin" /> Checking connection…
          </div>
        ) : connected && cred ? (
          <>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-green-700">Connected</span>
                <span className="text-sm text-gray-500 ml-2">{cred.email}</span>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-500 space-y-1 mb-4">
              <div>
                <span className="font-medium text-gray-600">Connected since:</span>{' '}
                {new Date(cred.created_at).toLocaleDateString('de-DE', {
                  day: '2-digit', month: 'long', year: 'numeric',
                })}
              </div>
              {cred.token_expiry && (
                <div>
                  <span className="font-medium text-gray-600">Token valid until:</span>{' '}
                  {new Date(cred.token_expiry).toLocaleDateString('de-DE', {
                    day: '2-digit', month: 'long', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleTestScan}
                className="flex items-center gap-2 text-sm text-[#1B5E20] bg-[#1B5E20]/5 border border-[#1B5E20]/20 hover:bg-[#1B5E20]/10 px-4 py-2 rounded-lg font-medium transition-colors"
              >
                <RefreshCw size={14} />
                Test Scan Now
              </button>
              <button
                onClick={handleConnect}
                disabled={reconnecting}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-4 py-2 rounded-lg transition-colors"
              >
                <ExternalLink size={13} />
                Reconnect / Switch Account
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
              <span className="text-sm text-amber-700 font-medium">Not connected</span>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              Click below to authorise Yumas to read and send emails from your Gmail account.
              You will be redirected to Google to grant permission.
            </p>

            <button
              onClick={handleConnect}
              disabled={reconnecting}
              className="bg-[#1B5E20] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2 disabled:opacity-60"
            >
              <Mail size={15} />
              {reconnecting ? 'Redirecting…' : 'Connect Gmail'}
            </button>
          </>
        )}
      </div>

      {/* How it works */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">How it works</h2>
        <ol className="space-y-3 text-sm text-gray-600">
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#1B5E20]/10 text-[#1B5E20] text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <span>Connect your Gmail inbox (e.g. benjaminpeters@yumas.de).</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#1B5E20]/10 text-[#1B5E20] text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <span>
              Click <strong>Scan for New Requests</strong> in the Booking Requests inbox to check for unread emails.
              Each email is analysed by Claude AI to classify the booking type and draft a reply.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#1B5E20]/10 text-[#1B5E20] text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <span>
              Review the draft reply, edit if needed, then click <strong>Approve &amp; Send</strong>.
              The reply is sent via Gmail directly from your connected account.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#1B5E20]/10 text-[#1B5E20] text-xs font-bold flex items-center justify-center mt-0.5">4</span>
            <span>All requests are stored and searchable in the Booking Requests inbox.</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
