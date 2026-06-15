'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Send, Paperclip, MessageCircle, ChevronLeft, X, Users, ClipboardList, CheckSquare, Square } from 'lucide-react';
import type { Profile } from '@/types';

/* ─── Types ──────────────────────────────────────────────────────────────────── */
type ChatMessage = {
  id: string;
  room: string;
  sender_id: string;
  sender_name: string;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  created_at: string;
};

type MinProfile = { id: string; full_name: string; role: string; chat_rooms: string[] | null };

type RoomTask = {
  id: string;
  room: string;
  title: string;
  completed: boolean;
  created_at: string;
};

/* ─── Constants ──────────────────────────────────────────────────────────────── */
const ROOMS = [
  { id: 'general',  label: 'General',  emoji: '💬' },
  { id: 'eschborn', label: 'Eschborn', emoji: '🏪' },
  { id: 'taunus',   label: 'Taunus',   emoji: '🏪' },
  { id: 'westend',  label: 'Westend',  emoji: '🏪' },
  { id: 'zk',       label: 'ZK',       emoji: '🏭' },
];

/* ─── Helpers ────────────────────────────────────────────────────────────────── */
function dmRoom(a: string, b: string) {
  return `dm::${[a, b].sort().join('::')}`;
}

function initials(name: string) {
  return name.split(' ').map(n => n[0] ?? '').slice(0, 2).join('').toUpperCase() || '?';
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · ' + time;
}

/* ─── Unread Badge ───────────────────────────────────────────────────────────── */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="min-w-[20px] h-5 rounded-full bg-[#1B5E20] text-white text-[10px] font-bold flex items-center justify-center px-1.5 flex-shrink-0">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* ─── Room Sidebar (desktop) ─────────────────────────────────────────────────── */
function RoomSidebar({
  activeRoom, myId, otherProfiles, unread, onSelect, onClose, visibleRooms, roomMembers,
}: {
  activeRoom: string;
  myId: string;
  otherProfiles: MinProfile[];
  unread: Record<string, number>;
  onSelect: (room: string) => void;
  onClose?: () => void;
  visibleRooms: typeof ROOMS;
  roomMembers: MinProfile[];
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <span className="font-bold text-sm text-gray-900">Messages</span>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {/* Rooms */}
        <div className="px-3 mb-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-1.5">Rooms</p>
          {visibleRooms.map(room => {
            const isActive = activeRoom === room.id;
            const count = unread[room.id] ?? 0;
            return (
              <button
                key={room.id}
                onClick={() => onSelect(room.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5 text-left ${
                  isActive ? 'bg-[#1B5E20] text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="text-base leading-none w-5 flex-shrink-0">{room.emoji}</span>
                <span className="flex-1 truncate">{room.label}</span>
                {!isActive && <UnreadBadge count={count} />}
              </button>
            );
          })}
        </div>

        {/* Direct Messages */}
        {otherProfiles.length > 0 && (
          <div className="px-3 mb-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-1.5">Direct Messages</p>
            {otherProfiles.map(p => {
              const roomId = dmRoom(myId, p.id);
              const isActive = activeRoom === roomId;
              const count = unread[roomId] ?? 0;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelect(roomId)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5 text-left ${
                    isActive ? 'bg-[#1B5E20] text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                    isActive ? 'bg-white/20 text-white' : 'bg-[#1B5E20]/15 text-[#1B5E20]'
                  }`}>
                    {initials(p.full_name)}
                  </div>
                  <span className="flex-1 truncate">{p.full_name}</span>
                  {!isActive && <UnreadBadge count={count} />}
                </button>
              );
            })}
          </div>
        )}

        {/* Room members */}
        {!activeRoom.startsWith('dm::') && roomMembers.length > 0 && (
          <div className="px-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-1.5">
              Members · {roomMembers.length}
            </p>
            {roomMembers.map(p => (
              <div key={p.id} className="flex items-center gap-2.5 px-2.5 py-1.5">
                <div className="w-6 h-6 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[10px] font-bold text-[#1B5E20] flex-shrink-0">
                  {initials(p.full_name)}
                </div>
                <span className="flex-1 text-sm text-gray-600 truncate">{p.full_name}</span>
                {p.role === 'admin' && (
                  <span className="text-[9px] text-gray-400 flex-shrink-0">Admin</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Mobile Channel List ────────────────────────────────────────────────────── */
function MobileChannelList({
  visibleRooms, otherProfiles, myId, unread, onSelect, profile,
}: {
  visibleRooms: typeof ROOMS;
  otherProfiles: MinProfile[];
  myId: string;
  unread: Record<string, number>;
  onSelect: (room: string) => void;
  profile: Profile | null;
}) {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Messages</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visibleRooms.length > 0 && (
          <>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest px-4 pt-5 pb-2">
              Channels
            </p>
            {visibleRooms.map(room => {
              const count = unread[room.id] ?? 0;
              return (
                <button
                  key={room.id}
                  onClick={() => onSelect(room.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 active:bg-gray-100 border-b border-gray-50"
                >
                  <span className="text-gray-400 font-semibold text-base w-5 text-center flex-shrink-0">#</span>
                  <span className={`flex-1 text-[15px] truncate ${count > 0 ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                    {room.label}
                  </span>
                  <UnreadBadge count={count} />
                </button>
              );
            })}
          </>
        )}

        {otherProfiles.length > 0 && (
          <>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest px-4 pt-5 pb-2">
              Direct Messages
            </p>
            {otherProfiles.map(p => {
              const roomId = dmRoom(myId, p.id);
              const count = unread[roomId] ?? 0;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelect(roomId)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 border-b border-gray-50"
                >
                  <div className="w-8 h-8 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[11px] font-bold text-[#1B5E20] flex-shrink-0">
                    {initials(p.full_name)}
                  </div>
                  <span className={`flex-1 text-[15px] truncate ${count > 0 ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                    {p.full_name}
                  </span>
                  <UnreadBadge count={count} />
                </button>
              );
            })}
          </>
        )}
      </div>

      {profile && (
        <div className="px-4 py-4 border-t border-gray-100 flex items-center gap-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[11px] font-bold text-[#1B5E20] flex-shrink-0">
            {initials(profile.full_name)}
          </div>
          <span className="text-sm font-medium text-gray-700 truncate">{profile.full_name}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Message Bubble ─────────────────────────────────────────────────────────── */
function MessageBubble({ msg, isOwn, showMeta }: { msg: ChatMessage; isOwn: boolean; showMeta: boolean }) {
  return (
    <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} ${showMeta ? 'mt-4' : 'mt-0.5'}`}>
      <div className="w-7 flex-shrink-0 flex items-end">
        {showMeta && (
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
            isOwn ? 'bg-[#1B5E20] text-white' : 'bg-gray-200 text-gray-600'
          }`}>
            {initials(msg.sender_name)}
          </div>
        )}
      </div>

      <div className={`max-w-[72%] flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}>
        {showMeta && (
          <p className="text-[11px] text-gray-400 px-1">
            {isOwn ? 'You' : msg.sender_name} · {fmtTime(msg.created_at)}
          </p>
        )}
        <div className={`rounded-2xl px-3 py-2 text-sm ${
          isOwn
            ? 'bg-[#1B5E20] text-white rounded-tr-sm'
            : 'bg-gray-100 text-gray-900 rounded-tl-sm'
        }`}>
          {msg.media_url && msg.media_type === 'image' && (
            <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="block mb-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={msg.media_url} alt="shared image" className="rounded-xl max-h-64 max-w-full object-cover" />
            </a>
          )}
          {msg.media_url && msg.media_type === 'video' && (
            <video src={msg.media_url} controls className="rounded-xl max-h-64 max-w-full mb-1" />
          )}
          {msg.content && (
            <p className="whitespace-pre-wrap break-words leading-snug">{msg.content}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Shared chat body components ────────────────────────────────────────────── */
function ChatMessages({
  messages, isLoading, myId, messagesEndRef,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  myId: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-sm text-gray-400">Loading…</span>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none">
          <MessageCircle size={36} className="mb-2 opacity-25" />
          <p className="text-sm">No messages yet — say hello!</p>
        </div>
      ) : (
        <>
          {messages.map((msg, idx) => {
            const isOwn = msg.sender_id === myId;
            const prev = messages[idx - 1];
            const showMeta = !prev || prev.sender_id !== msg.sender_id;
            return <MessageBubble key={msg.id} msg={msg} isOwn={isOwn} showMeta={showMeta} />;
          })}
        </>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

function ChatInput({
  text, setText, activeLabel, textareaRef, fileInputRef, uploading, sendMutation, handleSend, handleKeyDown, handleFileChange,
}: {
  text: string;
  setText: (v: string) => void;
  activeLabel: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
  sendMutation: { isPending: boolean };
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0">
      <div className="flex items-end gap-2">
        <div className="flex-1 bg-gray-100 rounded-2xl px-3.5 py-2.5 flex items-end gap-2 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${activeLabel}…`}
            rows={1}
            disabled={sendMutation.isPending || uploading}
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 resize-none outline-none leading-5 min-w-0"
            style={{ height: '20px', maxHeight: '128px', fontSize: '16px' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sendMutation.isPending}
            title="Attach photo or video"
            className="text-gray-400 hover:text-[#1B5E20] transition-colors flex-shrink-0 pb-px disabled:opacity-40"
          >
            <Paperclip size={16} />
          </button>
        </div>

        <button
          onClick={handleSend}
          disabled={!text.trim() || sendMutation.isPending || uploading}
          className="w-9 h-9 rounded-full bg-[#1B5E20] text-white flex items-center justify-center hover:bg-[#2E7D32] transition-colors disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
        >
          {uploading || sendMutation.isPending ? (
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleFileChange}
      />
      <p className="text-[10px] text-gray-400 mt-1.5 ml-1">Enter to send · Shift+Enter for new line</p>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────────── */
export default function ChatPage() {
  const qc = useQueryClient();
  const [activeRoom, setActiveRoom] = useState<string>('general');
  const [text, setText] = useState('');
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showMobileMembers, setShowMobileMembers] = useState(false);
  const [showMobileTasks, setShowMobileTasks] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRoomRef = useRef(activeRoom);

  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);

  // Prevent the layout's main element from scrolling — chat handles its own internal scroll
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const prev = main.style.overflow;
    main.style.overflow = 'hidden';
    return () => { main.style.overflow = prev; };
  }, []);

  /* ── Current user ── */
  const { data: profile } = useQuery<Profile | null>({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      return (data as Profile) ?? null;
    },
    staleTime: 60_000,
  });

  /* ── All active profiles ── */
  const { data: allProfiles = [] } = useQuery<MinProfile[]>({
    queryKey: ['all-profiles-chat'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role, chat_rooms')
        .eq('is_active', true)
        .order('full_name');
      return (data ?? []) as MinProfile[];
    },
    staleTime: 120_000,
  });

  const myId = profile?.id ?? '';
  const otherProfiles = allProfiles.filter(p => p.id !== myId);

  const isAdmin = profile?.role === 'admin';
  const visibleRooms = isAdmin
    ? ROOMS
    : ROOMS.filter(r => profile?.chat_rooms?.includes(r.id));

  const roomMembers = activeRoom.startsWith('dm::') ? [] : allProfiles.filter(p =>
    p.role === 'admin' || (p.chat_rooms ?? []).includes(activeRoom),
  );

  useEffect(() => {
    if (!profile) return;
    if (visibleRooms.length === 0) return;
    if (!activeRoom.startsWith('dm::') && !visibleRooms.find(r => r.id === activeRoom)) {
      setActiveRoom(visibleRooms[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  /* ── Room tasks ── */
  const { data: tasks = [] } = useQuery<RoomTask[]>({
    queryKey: ['room-tasks', activeRoom],
    queryFn: async () => {
      if (activeRoom.startsWith('dm::')) return [];
      const { data } = await supabase
        .from('room_tasks')
        .select('*')
        .eq('room', activeRoom)
        .order('created_at', { ascending: true });
      return (data ?? []) as RoomTask[];
    },
    staleTime: 0,
  });

  const addTaskMutation = useMutation({
    mutationFn: async (title: string) => {
      const { error } = await supabase.from('room_tasks').insert({ room: activeRoom, title });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['room-tasks', activeRoom] }),
  });

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase.from('room_tasks')
        .update({ completed, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['room-tasks', activeRoom] }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('room_tasks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['room-tasks', activeRoom] }),
  });

  const handleAddTask = () => {
    const t = newTaskText.trim();
    if (!t || addTaskMutation.isPending) return;
    setNewTaskText('');
    addTaskMutation.mutate(t);
  };

  /* ── Messages ── */
  const { data: messages = [], isLoading } = useQuery<ChatMessage[]>({
    queryKey: ['chat-messages', activeRoom],
    queryFn: async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('room', activeRoom)
        .order('created_at', { ascending: true })
        .limit(200);
      return (data ?? []) as ChatMessage[];
    },
    staleTime: 0,
  });

  useEffect(() => {
    // Scroll the messages container directly to avoid scrollIntoView scrolling main
    const container = messagesEndRef.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  /* ── Mark room as read ── */
  useEffect(() => {
    setUnread(prev => { const n = { ...prev }; delete n[activeRoom]; return n; });
    if (myId) {
      supabase.from('chat_read_markers').upsert(
        { user_id: myId, room: activeRoom, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,room' },
      ).then(() => {});
    }
  }, [activeRoom, myId]);

  /* ── Realtime: active room ── */
  useEffect(() => {
    const channel = supabase
      .channel(`chat-room::${activeRoom}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `room=eq.${activeRoom}`,
      }, (payload) => {
        const msg = payload.new as ChatMessage;
        qc.setQueryData<ChatMessage[]>(['chat-messages', activeRoom], (prev = []) =>
          prev.some(m => m.id === msg.id) ? prev : [...prev, msg],
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeRoom, qc]);

  /* ── Realtime: unread watcher ── */
  useEffect(() => {
    const channel = supabase
      .channel('chat-unread-watcher')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
      }, (payload) => {
        const msg = payload.new as ChatMessage;
        if (msg.room !== activeRoomRef.current) {
          setUnread(prev => ({ ...prev, [msg.room]: (prev[msg.room] ?? 0) + 1 }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /* ── Send ── */
  const sendMutation = useMutation({
    mutationFn: async ({
      content, mediaUrl, mediaType,
    }: { content: string | null; mediaUrl?: string | null; mediaType?: string | null }) => {
      if (!profile) throw new Error('Not logged in');
      const { error } = await supabase.from('chat_messages').insert({
        room:        activeRoom,
        sender_id:   profile.id,
        sender_name: profile.full_name,
        content:     content || null,
        media_url:   mediaUrl ?? null,
        media_type:  mediaType ?? null,
      });
      if (error) throw error;
    },
  });

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    setText('');
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
    await sendMutation.mutateAsync({ content: trimmed });
  }, [text, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) { alert('Only images and videos are supported.'); return; }
    if (file.size > 20 * 1024 * 1024) { alert('File too large. Max 20 MB.'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `${activeRoom}/${Date.now()}-${profile.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from('chat-media').upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(path);
      await sendMutation.mutateAsync({ content: text.trim() || null, mediaUrl: publicUrl, mediaType: isImage ? 'image' : 'video' });
      setText('');
    } catch (err) {
      console.error('Upload failed', err);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const activeLabel =
    visibleRooms.find(r => r.id === activeRoom)?.label ??
    otherProfiles.find(p => activeRoom === dmRoom(myId, p.id))?.full_name ??
    'Chat';

  // Desktop sidebar room selection — does NOT change mobileView
  const handleDesktopSelect = (room: string) => setActiveRoom(room);

  // Mobile channel list selection — switches to chat view
  const handleMobileSelect = (room: string) => {
    setActiveRoom(room);
    setMobileView('chat');
  };

  const sharedInputProps = { text, setText, activeLabel, textareaRef, fileInputRef, uploading, sendMutation, handleSend, handleKeyDown, handleFileChange };

  /* ─── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-full bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">

      {/* ── MOBILE: Channel list ── */}
      {mobileView === 'list' && (
        <div className="md:hidden flex flex-col w-full">
          <MobileChannelList
            visibleRooms={visibleRooms}
            otherProfiles={otherProfiles}
            myId={myId}
            unread={unread}
            onSelect={handleMobileSelect}
            profile={profile ?? null}
          />
        </div>
      )}

      {/* ── MOBILE: Chat view ── */}
      {mobileView === 'chat' && (
        <div className="md:hidden flex flex-col w-full overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => setMobileView('list')}
              className="p-1 -ml-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-semibold text-gray-900 truncate">{activeLabel}</span>
              {activeRoom.startsWith('dm::') && (
                <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">DM</span>
              )}
            </div>
            {!activeRoom.startsWith('dm::') && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => setShowMobileTasks(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <ClipboardList size={14} />
                  {tasks.filter(t => !t.completed).length > 0 && (
                    <span className="text-xs font-medium">{tasks.filter(t => !t.completed).length}</span>
                  )}
                </button>
                {roomMembers.length > 0 && (
                  <button
                    onClick={() => setShowMobileMembers(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                  >
                    <Users size={14} />
                    <span className="text-xs font-medium">{roomMembers.length}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <ChatMessages messages={messages} isLoading={isLoading} myId={myId} messagesEndRef={messagesEndRef} />
          <ChatInput {...sharedInputProps} />

        </div>
      )}

      {/* ── Tasks panel (shared mobile + desktop) ── */}
      {showMobileTasks && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileTasks(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="font-semibold text-gray-900">Tasks — {activeLabel}</span>
              <button onClick={() => setShowMobileTasks(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={18} />
              </button>
            </div>
            {/* Add task input */}
            <div className="px-4 py-3 border-b border-gray-100 flex gap-2 flex-shrink-0">
              <input
                type="text"
                value={newTaskText}
                onChange={e => setNewTaskText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTask(); }}
                placeholder="Add a task…"
                className="flex-1 bg-gray-100 rounded-xl px-3.5 py-2 text-sm text-gray-900 outline-none placeholder-gray-400"
                style={{ fontSize: '16px' }}
              />
              <button
                onClick={handleAddTask}
                disabled={!newTaskText.trim() || addTaskMutation.isPending}
                className="px-4 py-2 rounded-xl bg-[#1B5E20] text-white text-sm font-medium disabled:opacity-40 flex-shrink-0"
              >
                Add
              </button>
            </div>
            {/* Task list */}
            <div className="overflow-y-auto flex-1 py-2">
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 select-none">
                  <ClipboardList size={32} className="mb-2 opacity-25" />
                  <p className="text-sm">No tasks yet</p>
                </div>
              ) : (
                tasks.map(task => (
                  <div key={task.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <button
                      onClick={() => toggleTaskMutation.mutate({ id: task.id, completed: !task.completed })}
                      className="flex-shrink-0 text-[#1B5E20]"
                    >
                      {task.completed
                        ? <CheckSquare size={20} />
                        : <Square size={20} className="text-gray-300" />}
                    </button>
                    <span className={`flex-1 text-sm ${task.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {task.title}
                    </span>
                    <button
                      onClick={() => deleteTaskMutation.mutate(task.id)}
                      className="text-gray-300 hover:text-red-400 p-1 flex-shrink-0 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Members panel (shared mobile + desktop) ── */}
      {showMobileMembers && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileMembers(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white rounded-t-2xl shadow-2xl max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="font-semibold text-gray-900">Members · {roomMembers.length}</span>
              <button onClick={() => setShowMobileMembers(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto py-2">
              {roomMembers.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[11px] font-bold text-[#1B5E20] flex-shrink-0">
                    {initials(p.full_name)}
                  </div>
                  <span className="flex-1 text-sm text-gray-800">{p.full_name}</span>
                  {p.role === 'admin' && (
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">Admin</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── DESKTOP: Sidebar ── */}
      <div className="hidden md:flex flex-col w-60 border-r border-gray-100 flex-shrink-0 bg-gray-50/60">
        <RoomSidebar
          activeRoom={activeRoom}
          myId={myId}
          otherProfiles={otherProfiles}
          unread={unread}
          onSelect={handleDesktopSelect}
          visibleRooms={visibleRooms}
          roomMembers={roomMembers}
        />
        {profile && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[10px] font-bold text-[#1B5E20] flex-shrink-0">
              {initials(profile.full_name)}
            </div>
            <span className="text-xs font-medium text-gray-700 truncate">{profile.full_name}</span>
          </div>
        )}
      </div>

      {/* ── DESKTOP: Chat area ── */}
      <div className="hidden md:flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-semibold text-gray-900 truncate">{activeLabel}</span>
            {activeRoom.startsWith('dm::') && (
              <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">DM</span>
            )}
          </div>
          {!activeRoom.startsWith('dm::') && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowMobileTasks(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <ClipboardList size={14} />
                {tasks.filter(t => !t.completed).length > 0 && (
                  <span className="text-xs font-medium">{tasks.filter(t => !t.completed).length}</span>
                )}
              </button>
              {roomMembers.length > 0 && (
                <button
                  onClick={() => setShowMobileMembers(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <Users size={14} />
                  <span className="text-xs font-medium">{roomMembers.length}</span>
                </button>
              )}
            </div>
          )}
        </div>
        <ChatMessages messages={messages} isLoading={isLoading} myId={myId} messagesEndRef={messagesEndRef} />
        <ChatInput {...sharedInputProps} />
      </div>

    </div>
  );
}
