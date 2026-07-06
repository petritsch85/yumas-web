'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Mail, CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Bot, RotateCcw, Save,
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

type AgentSettings = {
  system_prompt: string;
  updated_at: string | null;
  is_default: boolean;
};

export default function BookingSettingsPage() {
  const searchParams   = useSearchParams();
  const urlError       = searchParams?.get('error');
  const urlConnected   = searchParams?.get('connected');
  const qc             = useQueryClient();

  const [reconnecting, setReconnecting] = useState(false);
  const [scanning, setScanning]         = useState(false);
  const [scanResult, setScanResult]     = useState<{ processed: number; bookings: number } | null>(null);
  const [scanError, setScanError]       = useState('');

  // Agent instructions state
  const [promptText, setPromptText]     = useState('');
  const [promptDirty, setPromptDirty]   = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved]   = useState(false);
  const [promptError, setPromptError]   = useState('');
  const originalPrompt                  = useRef('');

  const { data: status, isLoading, refetch } = useQuery<StatusResponse>({
    queryKey: ['gmail_status'],
    queryFn: async () => {
      const res = await fetch('/api/bookings/gmail-status');
      return res.json();
    },
    refetchOnMount: true,
  });

  const { data: agentSettings, isLoading: loadingPrompt } = useQuery<AgentSettings>({
    queryKey: ['agent_settings'],
    queryFn: async () => {
      const res = await fetch('/api/bookings/agent-settings');
      return res.json();
    },
  });

  // Populate textarea once loaded
  useEffect(() => {
    if (agentSettings && !promptDirty) {
      setPromptText(agentSettings.system_prompt);
      originalPrompt.current = agentSettings.system_prompt;
    }
  }, [agentSettings, promptDirty]);

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

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    setPromptError('');
    setPromptSaved(false);
    try {
      const res = await fetch('/api/bookings/agent-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: promptText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      originalPrompt.current = promptText;
      setPromptDirty(false);
      setPromptSaved(true);
      qc.invalidateQueries({ queryKey: ['agent_settings'] });
      setTimeout(() => setPromptSaved(false), 3500);
    } catch (e: any) {
      setPromptError(e.message);
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleResetPrompt = () => {
    setPromptText(originalPrompt.current);
    setPromptDirty(false);
    setPromptError('');
  };

  const handleTestScan = async () => {
    setScanning(true);
    setScanResult(null);
    setScanError('');
    try {
      const res  = await fetch('/api/bookings/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Scan failed');
      setScanResult(data);
    } catch (e: any) {
      setScanError(e.message);
    } finally {
      setScanning(false);
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

            {scanResult && (
              <div className="mb-3 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-800 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
                Scanned <strong>{scanResult.processed}</strong> email{scanResult.processed !== 1 ? 's' : ''} —{' '}
                <strong>{scanResult.bookings}</strong> new booking request{scanResult.bookings !== 1 ? 's' : ''} found.
              </div>
            )}
            {scanError && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                {scanError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleTestScan}
                disabled={scanning}
                className="flex items-center gap-2 text-sm text-[#1B5E20] bg-[#1B5E20]/5 border border-[#1B5E20]/20 hover:bg-[#1B5E20]/10 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-60"
              >
                <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
                {scanning ? 'Scanning…' : 'Test Scan Now'}
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

      {/* Agent Instructions Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#1B5E20]/10 flex items-center justify-center flex-shrink-0">
            <Bot size={20} className="text-[#1B5E20]" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Agent Instructions</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Edit the system prompt that tells Claude how to classify and respond to booking emails
            </p>
          </div>
          {agentSettings && (
            <div className="text-right flex-shrink-0">
              {agentSettings.is_default ? (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">Default</span>
              ) : (
                <span className="text-xs bg-[#1B5E20]/10 text-[#1B5E20] px-2 py-1 rounded-full font-medium">Custom</span>
              )}
              {agentSettings.updated_at && !agentSettings.is_default && (
                <p className="text-xs text-gray-400 mt-1">
                  Saved {new Date(agentSettings.updated_at).toLocaleDateString('de-DE', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              )}
            </div>
          )}
        </div>

        {loadingPrompt ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <RefreshCw size={14} className="animate-spin" /> Loading prompt…
          </div>
        ) : (
          <>
            <textarea
              value={promptText}
              onChange={(e) => { setPromptText(e.target.value); setPromptDirty(true); setPromptSaved(false); }}
              rows={18}
              className="w-full text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 resize-y focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/50 leading-relaxed"
              spellCheck={false}
            />
            <div className="flex items-center justify-between mt-2 mb-3">
              <span className="text-xs text-gray-400">{promptText.length.toLocaleString()} characters</span>
              {promptDirty && (
                <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
              )}
            </div>

            {promptSaved && (
              <div className="mb-3 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-800 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
                Agent instructions saved — Claude will use the new prompt on the next scan.
              </div>
            )}
            {promptError && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                {promptError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSavePrompt}
                disabled={savingPrompt || !promptDirty}
                className="flex items-center gap-2 text-sm bg-[#1B5E20] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
              >
                <Save size={14} className={savingPrompt ? 'animate-pulse' : ''} />
                {savingPrompt ? 'Saving…' : 'Save Instructions'}
              </button>
              {promptDirty && (
                <button
                  onClick={handleResetPrompt}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-4 py-2 rounded-lg transition-colors"
                >
                  <RotateCcw size={13} />
                  Discard Changes
                </button>
              )}
              {!agentSettings?.is_default && (
                <button
                  onClick={async () => {
                    const res = await fetch('/api/bookings/agent-settings', { method: 'DELETE' });
                    if (res.ok) {
                      await qc.invalidateQueries({ queryKey: ['agent_settings'] });
                      setPromptDirty(false);
                      setPromptSaved(false);
                    }
                  }}
                  className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 ml-auto transition-colors"
                >
                  <RotateCcw size={12} />
                  Reset to Default
                </button>
              )}
            </div>
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
