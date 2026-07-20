'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Send, Paperclip, MessageCircle, ChevronLeft, ChevronUp, ChevronDown, X, Users, ClipboardList, CheckSquare, Square, Plus, Pencil, Smile, CornerUpLeft, Bell, Calendar, Flag, UserCheck, KeyRound, Eye, EyeOff, Copy, Check, BookOpen, Lock, Unlock, Loader2 } from 'lucide-react';
import type { Profile } from '@/types';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

/* ─── Types ──────────────────────────────────────────────────────────────────── */
type ReplyPreview = { id: string; sender_name: string; content: string | null; media_type: string | null };

type ChatReaction = { id: string; message_id: string; user_id: string; emoji: string };

type ChatMessage = {
  id: string;
  room: string;
  sender_id: string;
  sender_name: string;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  created_at: string;
  edited_at?: string | null;
  reply_to_id?: string | null;
  reply_to?: ReplyPreview | null;
};

type MinProfile = { id: string; full_name: string; role: string; chat_rooms: string[] | null };

type RoomTask = {
  id: string;
  room: string;
  title: string;
  description: string | null;
  priority: string | null;
  deadline: string | null;
  assignee_ids: string[] | null;
  created_by: string | null;
  completed: boolean;
  done_comment: string | null;
  done_at: string | null;
  done_by: string | null;
  created_at: string;
};

type RoomCanvas = {
  room: string;
  content: string;
  is_editable: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

type RoomCanvasMedia = {
  id: string;
  room: string;
  url: string;
  media_type: 'image' | 'video';
  created_at: string;
  created_by: string | null;
};

type CanvasBlock =
  | { id: string; type: 'text'; content: string }
  | { id: string; type: 'media'; url: string; mediaType: 'image' | 'video'; caption?: string };

type Notif = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  metadata: Record<string, unknown>;
};

type ChatGroup = {
  id: string;
  member_ids: string[];
  created_by: string;
  created_at: string;
};

type ChatChannel = {
  id: string;
  label: string;
  emoji: string;
  member_ids: string[];
  created_by: string;
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

function groupRoomId(group: ChatGroup) { return `group::${group.id}`; }

function groupLabel(group: ChatGroup, profiles: MinProfile[], myId: string): string {
  return group.member_ids
    .filter(id => id !== myId)
    .map(id => profiles.find(p => p.id === id)?.full_name?.split(' ')[0] ?? '?')
    .join(', ') || 'Group';
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
  activeRoom, myId, otherProfiles, allProfiles, unread, mentionsByRoom, onSelect, onClose, visibleRooms, roomMembers, chatGroups, onCreateGroup, isAdmin, onCreateChannel,
  activeView, onViewNotifications, unreadNotifCount,
}: {
  activeRoom: string;
  myId: string;
  otherProfiles: MinProfile[];
  allProfiles: MinProfile[];
  unread: Record<string, number>;
  mentionsByRoom: Record<string, number>;
  onSelect: (room: string) => void;
  onClose?: () => void;
  visibleRooms: { id: string; label: string; emoji: string }[];
  roomMembers: MinProfile[];
  chatGroups: ChatGroup[];
  onCreateGroup: () => void;
  isAdmin: boolean;
  onCreateChannel: () => void;
  activeView: 'chat' | 'notifications';
  onViewNotifications: () => void;
  unreadNotifCount: number;
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
        {/* Notifications button */}
        <div className="px-3 mb-3">
          <button
            onClick={onViewNotifications}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
              activeView === 'notifications' ? 'bg-[#1B5E20] text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Bell size={15} className="flex-shrink-0" />
            <span className="flex-1">Notifications</span>
            {unreadNotifCount > 0 && <UnreadBadge count={unreadNotifCount} />}
          </button>
        </div>

        {/* Rooms */}
        <div className="px-3 mb-4">
          <div className="flex items-center justify-between px-2 mb-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Rooms</p>
            {isAdmin && (
              <button onClick={onCreateChannel} className="text-gray-400 hover:text-[#1B5E20] transition-colors" title="New channel">
                <Plus size={13} />
              </button>
            )}
          </div>
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
                <span className={`flex-1 truncate ${!isActive && count > 0 ? 'font-bold' : ''}`}>{room.label}</span>
                {!isActive && count > 0 && <UnreadBadge count={count} />}
              </button>
            );
          })}
        </div>

        {/* Group Messages */}
        <div className="px-3 mb-4">
          <div className="flex items-center justify-between px-2 mb-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Group Messages</p>
            <button
              onClick={onCreateGroup}
              className="text-gray-400 hover:text-[#1B5E20] transition-colors"
              title="New group"
            >
              <Plus size={13} />
            </button>
          </div>
          {chatGroups.length === 0 && (
            <p className="text-xs text-gray-400 px-2.5 py-1 italic">No groups yet</p>
          )}
          {chatGroups.map(group => {
            const roomId = groupRoomId(group);
            const isActive = activeRoom === roomId;
            const count = unread[roomId] ?? 0;
            const label = groupLabel(group, allProfiles, myId);
            return (
              <button
                key={group.id}
                onClick={() => onSelect(roomId)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5 text-left ${
                  isActive ? 'bg-[#1B5E20] text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isActive ? 'bg-white/20 text-white' : 'bg-[#1B5E20]/15 text-[#1B5E20]'
                }`}>
                  <Users size={11} />
                </div>
                <span className="flex-1 truncate">{label}</span>
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
        {!activeRoom.startsWith('dm::') && !activeRoom.startsWith('group::') && roomMembers.length > 0 && (
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
  visibleRooms, otherProfiles, allProfiles, myId, unread, mentionsByRoom, onSelect, profile, chatGroups, onCreateGroup, isAdmin, onCreateChannel,
  onViewNotifications, unreadNotifCount,
}: {
  visibleRooms: { id: string; label: string; emoji: string }[];
  otherProfiles: MinProfile[];
  allProfiles: MinProfile[];
  myId: string;
  unread: Record<string, number>;
  mentionsByRoom: Record<string, number>;
  onSelect: (room: string) => void;
  profile: Profile | null;
  chatGroups: ChatGroup[];
  onCreateGroup: () => void;
  isAdmin: boolean;
  onCreateChannel: () => void;
  onViewNotifications: () => void;
  unreadNotifCount: number;
}) {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Messages</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Notifications */}
        <button
          onClick={onViewNotifications}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 active:bg-gray-100 border-b border-gray-100"
        >
          <Bell size={20} className="text-[#1B5E20] flex-shrink-0" />
          <span className="flex-1 text-[15px] font-semibold text-gray-900">Notifications</span>
          {unreadNotifCount > 0 && <UnreadBadge count={unreadNotifCount} />}
        </button>

        {visibleRooms.length > 0 && (
          <>
            <div className="flex items-center justify-between px-4 pt-5 pb-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Channels</p>
              {isAdmin && (
                <button onClick={onCreateChannel} className="text-gray-400 hover:text-[#1B5E20] transition-colors p-0.5">
                  <Plus size={16} />
                </button>
              )}
            </div>
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
                  {count > 0 && <UnreadBadge count={count} />}
                </button>
              );
            })}
          </>
        )}

        {/* Group Messages */}
        <>
          <div className="flex items-center justify-between px-4 pt-5 pb-2">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Group Messages</p>
            <button onClick={onCreateGroup} className="text-gray-400 hover:text-[#1B5E20] transition-colors p-0.5">
              <Plus size={16} />
            </button>
          </div>
          {chatGroups.length === 0 && (
            <p className="text-sm text-gray-400 px-4 pb-2 italic">No groups yet — tap + to create one</p>
          )}
          {chatGroups.map(group => {
            const roomId = groupRoomId(group);
            const count = unread[roomId] ?? 0;
            const label = groupLabel(group, allProfiles, myId);
            return (
              <button
                key={group.id}
                onClick={() => onSelect(roomId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 border-b border-gray-50"
              >
                <div className="w-8 h-8 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[#1B5E20] flex-shrink-0">
                  <Users size={14} />
                </div>
                <span className={`flex-1 text-[15px] truncate ${count > 0 ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                  {label}
                </span>
                <UnreadBadge count={count} />
              </button>
            );
          })}
        </>

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

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];

const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const PRIORITY_COLORS: Record<string, string> = {
  low:    'bg-gray-100 text-gray-500',
  medium: 'bg-blue-50 text-blue-600',
  high:   'bg-orange-50 text-orange-600',
  urgent: 'bg-red-50 text-red-600',
};

/* ─── Notifications Panel ────────────────────────────────────────────────────── */
function NotificationsPanel({ notifs, onMarkRead, onMarkAllRead }: {
  notifs: Notif[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  const unread = notifs.filter(n => !n.read).length;
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-[#1B5E20]" />
          <span className="font-semibold text-gray-900">Notifications</span>
          {unread > 0 && <UnreadBadge count={unread} />}
        </div>
        {unread > 0 && (
          <button onClick={onMarkAllRead} className="text-xs text-[#1B5E20] hover:underline">Mark all read</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {notifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none py-16">
            <Bell size={36} className="mb-2 opacity-25" />
            <p className="text-sm">No notifications yet</p>
          </div>
        ) : (
          notifs.map(n => (
            <div
              key={n.id}
              className={`w-full px-4 py-3.5 border-b border-gray-50 flex gap-3 items-start ${!n.read ? 'bg-[#1B5E20]/5' : ''}`}
            >
              <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${!n.read ? 'bg-[#1B5E20]' : 'bg-transparent'}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!n.read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-snug">{n.body}</p>
                <p className="text-[10px] text-gray-400 mt-1">{fmtTime(n.created_at)}</p>
              </div>
              {!n.read && (
                <button
                  onClick={() => onMarkRead(n.id)}
                  className="flex-shrink-0 text-xs text-white bg-[#1B5E20] hover:bg-[#145214] px-2.5 py-1 rounded-full mt-0.5"
                >
                  Read
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Message Bubble ─────────────────────────────────────────────────────────── */
function MessageBubble({
  msg, isOwn, showMeta, myId, reactions,
  isEditing, editText, onStartEdit, onTextChange, onSave, onCancel,
  onReply, onReact, onLongPress, allProfiles = [],
}: {
  msg: ChatMessage;
  isOwn: boolean;
  showMeta: boolean;
  myId: string;
  reactions: ChatReaction[];
  isEditing: boolean;
  editText: string;
  onStartEdit: () => void;
  onTextChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onLongPress: () => void;
  allProfiles?: MinProfile[];
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => { onLongPress(); }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const msgReactions = useMemo(() => {
    const groups: Record<string, { count: number; reacted: boolean; ids: string[] }> = {};
    for (const r of reactions) {
      if (r.message_id !== msg.id) continue;
      if (!groups[r.emoji]) groups[r.emoji] = { count: 0, reacted: false, ids: [] };
      groups[r.emoji].count++;
      groups[r.emoji].ids.push(r.id);
      if (r.user_id === myId) groups[r.emoji].reacted = true;
    }
    return Object.entries(groups).map(([emoji, g]) => ({ emoji, ...g }));
  }, [reactions, msg.id, myId]);

  return (
    <div
      className={`flex gap-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'} ${showMeta ? 'mt-4' : 'mt-0.5'} group items-end select-none`}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onContextMenu={e => e.preventDefault()}
    >
      {/* Avatar */}
      <div className="w-7 flex-shrink-0">
        {showMeta && (
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
            isOwn ? 'bg-[#1B5E20] text-white' : 'bg-gray-200 text-gray-600'
          }`}>
            {initials(msg.sender_name)}
          </div>
        )}
      </div>

      {/* Content column — relative so action bar can be positioned beside it without affecting flex layout */}
      <div className={`relative flex flex-col gap-0.5 ${isOwn ? 'items-end max-w-[72%]' : 'items-start max-w-[85%]'}`}>

        {/* Action bar: absolutely positioned beside the bubble, zero flex footprint */}
        {!isEditing && (
          <div className={`absolute bottom-0 ${isOwn ? 'right-full mr-1' : 'left-full ml-1'} opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-white shadow-md rounded-full px-1.5 py-1 z-20`}>
            {QUICK_EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => onReact(e)}
                className="w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-sm transition-colors leading-none"
                title={e}
              >
                {e}
              </button>
            ))}
            <button
              onClick={onReply}
              className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Reply"
            >
              <CornerUpLeft size={13} />
            </button>
            {isOwn && !msg.media_url && (
              <button
                onClick={onStartEdit}
                className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="Edit"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
        {showMeta && (
          <p className="text-[11px] text-gray-400 px-1">
            {isOwn ? 'You' : msg.sender_name} · {fmtTime(msg.created_at)}
          </p>
        )}

        {isEditing ? (
          <div className="flex flex-col gap-1.5 w-64">
            <textarea
              value={editText}
              onChange={e => onTextChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(); }
                if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
              }}
              autoFocus
              rows={2}
              className="w-full bg-gray-100 rounded-xl px-3 py-2 text-sm text-gray-900 outline-none resize-none leading-snug"
              style={{ fontSize: '16px' }}
            />
            <div className="flex gap-1.5 justify-end">
              <button onClick={onCancel} className="px-3 py-1 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition-colors">Cancel</button>
              <button onClick={onSave} disabled={!editText.trim()} className="px-3 py-1 rounded-lg text-xs bg-[#1B5E20] text-white disabled:opacity-40 hover:bg-[#2E7D32] transition-colors">Save</button>
            </div>
          </div>
        ) : (
          <>
            {/* Main bubble — quote embedded inside when replying */}
            <div className={`rounded-2xl text-sm overflow-hidden ${
              isOwn ? 'bg-[#1B5E20] text-white rounded-tr-sm' : 'bg-gray-100 text-gray-900 rounded-tl-sm'
            }`}>
              {msg.reply_to?.id && (
                <div
                  className={`flex gap-0 border-l-[3px] mx-2 mt-2 mb-1 rounded-sm overflow-hidden ${
                    isOwn ? 'border-white/60 bg-white/15' : 'border-[#1B5E20] bg-black/5'
                  }`}
                >
                  <div className="px-2 py-1 min-w-0">
                    <p className={`text-[10px] font-bold mb-0.5 truncate ${isOwn ? 'text-white/80' : 'text-[#1B5E20]'}`}>
                      {msg.reply_to.sender_name}
                    </p>
                    <p className={`text-xs truncate max-w-[220px] ${isOwn ? 'text-white/70' : 'text-gray-500'}`}>
                      {msg.reply_to.content ?? (msg.reply_to.media_type ? '📷 Media' : '…')}
                    </p>
                  </div>
                </div>
              )}
              <div className="px-3 py-2">
              {msg.media_url && msg.media_type === 'image' && (
                <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="block mb-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={msg.media_url} alt="shared image" className="rounded-xl max-h-64 max-w-full object-cover" />
                </a>
              )}
              {msg.media_url && msg.media_type === 'video' && (
                <video src={msg.media_url} controls preload="metadata" playsInline className="rounded-xl max-h-64 max-w-full mb-1 bg-black" onLoadedMetadata={e => { (e.target as HTMLVideoElement).currentTime = 0.001; }} />
              )}
              {msg.content && (
                <p className="whitespace-pre-wrap break-words leading-snug">
                  {highlightMentions(msg.content, allProfiles, isOwn)}
                </p>
              )}
              </div>{/* end inner px-3 py-2 */}
            </div>

            {msg.edited_at && (
              <p className={`text-[10px] text-gray-400 px-1 ${isOwn ? 'text-right' : ''}`}>edited</p>
            )}

            {/* Reaction pills */}
            {msgReactions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {msgReactions.map(({ emoji, count, reacted }) => (
                  <button
                    key={emoji}
                    onClick={() => onReact(emoji)}
                    className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      reacted
                        ? 'bg-[#1B5E20]/15 border-[#1B5E20]/30 text-[#1B5E20] font-medium'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {emoji} {count}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}

/* ─── Shared chat body components ────────────────────────────────────────────── */
function highlightMentions(content: string, profiles: MinProfile[], isOwn = false): React.ReactNode {
  if (!profiles.length) return content;
  const names = [...profiles].sort((a, b) => b.full_name.length - a.full_name.length);
  const escaped = names.map(p => '@' + p.full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts = content.split(re);
  // Every odd index in split result is a captured group (the mention)
  const mentionClass = isOwn
    ? 'font-semibold underline decoration-white/60'
    : 'font-semibold text-[#1B5E20]';
  return parts.map((part, i) =>
    i % 2 === 1
      ? <span key={i} className={mentionClass}>{part}</span>
      : part
  );
}

function ChatMessages({
  messages, isLoading, myId, messagesEndRef, reactions,
  editingId, editingText, onStartEdit, onTextChange, onSave, onCancel,
  onReply, onReact, onLongPress, allProfiles = [],
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  myId: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  reactions: ChatReaction[];
  editingId: string | null;
  editingText: string;
  onStartEdit: (msg: ChatMessage) => void;
  onTextChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onReply: (msg: ChatMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
  onLongPress: (msg: ChatMessage) => void;
  allProfiles?: MinProfile[];
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3">
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
            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isOwn={isOwn}
                showMeta={showMeta}
                myId={myId}
                reactions={reactions}
                isEditing={editingId === msg.id}
                editText={editingText}
                onStartEdit={() => onStartEdit(msg)}
                onTextChange={onTextChange}
                onSave={onSave}
                onCancel={onCancel}
                onReply={() => onReply(msg)}
                onReact={(emoji) => onReact(msg.id, emoji)}
                onLongPress={() => onLongPress(msg)}
                allProfiles={allProfiles}
              />
            );
          })}
        </>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

/* ─── Mention dropdown portal ────────────────────────────────────────────────── */
function MentionDropdown({
  profiles, mentionIndex, anchorRef, onSelect,
}: {
  profiles: MinProfile[];
  mentionIndex: number;
  anchorRef: React.RefObject<HTMLTextAreaElement | null>;
  onSelect: (p: MinProfile) => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!profiles.length) { setRect(null); return; }
    const update = () => {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [profiles.length, anchorRef]);

  if (!profiles.length || !rect) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      }}
      className="bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
    >
      {profiles.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => onSelect(p)}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${i === mentionIndex ? 'bg-[#1B5E20]/10 text-[#1B5E20]' : 'hover:bg-gray-50 text-gray-900'}`}
        >
          <div className="w-7 h-7 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[10px] font-bold text-[#1B5E20] flex-shrink-0">
            {p.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <span className="text-sm font-medium">{p.full_name}</span>
          <span className="text-xs text-gray-400 ml-auto capitalize">{p.role}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

function ChatInput({
  text, setText, activeLabel, textareaRef, fileInputRef, uploading, sendMutation, handleSend, handleKeyDown, handleFileChange, replyingTo, onCancelReply, mentionMembers,
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
  replyingTo: ChatMessage | null;
  onCancelReply: () => void;
  mentionMembers: MinProfile[];
}) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionStartRef = useRef<number>(-1);
  const mentionQueryRef = useRef<string | null>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  useEffect(() => { textRef.current = text; }, [text]);

  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) { setText(text + emoji); return; }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + emoji.length, start + emoji.length);
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
    });
  };

  const filteredMentions = mentionQuery !== null
    ? mentionMembers.filter(p => p.full_name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
    : [];

  const insertMention = (profile: MinProfile) => {
    const val = textRef.current; // always current, no stale-closure risk
    const atIdx = val.lastIndexOf('@');
    console.log('[mention] insertMention called', { profile: profile.full_name, val, atIdx });
    if (atIdx < 0) {
      console.warn('[mention] no @ found in text, aborting');
      return;
    }
    const afterAt = val.slice(atIdx + 1);
    const queryLen = afterAt.match(/^[\w ]*/)?.[0].length ?? 0;
    const before = val.slice(0, atIdx);
    const after = val.slice(atIdx + 1 + queryLen);
    const inserted = `@${profile.full_name} `;
    const newText = before + inserted + after;
    console.log('[mention] inserting:', { before, inserted, after, newText });
    mentionStartRef.current = -1;
    mentionQueryRef.current = null;
    setMentionQuery(null);
    setMentionIndex(0);
    setText(newText);
    const ta = textareaRef.current;
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        const pos = before.length + inserted.length;
        ta.setSelectionRange(pos, pos);
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
      }
    });
  };

  const handleMentionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQueryRef.current === null || filteredMentions.length === 0) {
      handleKeyDown(e);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex(i => (i + 1) % filteredMentions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex(i => (i - 1 + filteredMentions.length) % filteredMentions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(filteredMentions[mentionIndex]);
    } else if (e.key === 'Escape') {
      mentionQueryRef.current = null;
      mentionStartRef.current = -1;
      setMentionQuery(null);
    } else {
      handleKeyDown(e);
    }
  };

  return (
    <div className="border-t border-gray-100 flex-shrink-0">
      {/* @mention chip bar — in normal flow, no positioning issues */}
      {filteredMentions.length > 0 && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-gray-100 bg-gray-50">
          {filteredMentions.map(p => (
            <button
              key={p.id}
              type="button"
              onPointerDown={e => {
                e.preventDefault(); // keeps textarea focused, fires before blur
                insertMention(p);
              }}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#1B5E20]/30 text-[#1B5E20] rounded-full text-sm font-medium hover:bg-[#1B5E20]/10 transition-colors"
            >
              <span className="w-5 h-5 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                {p.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              {p.full_name}
            </button>
          ))}
        </div>
      )}
      {/* Reply preview bar */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100">
          <div className="w-0.5 self-stretch bg-[#1B5E20] rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-[#1B5E20]">{replyingTo.sender_name}</p>
            <p className="text-xs text-gray-500 truncate">{replyingTo.content ?? '📷 Media'}</p>
          </div>
          <button onClick={onCancelReply} className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}
    <div className="px-4 py-3">

      {/* Emoji picker popover */}
      {showEmoji && (
        <div ref={emojiRef} className="absolute bottom-full left-4 mb-1 z-50 shadow-xl rounded-2xl overflow-hidden">
          <EmojiPicker
            onEmojiClick={(data) => { insertEmoji(data.emoji); setShowEmoji(false); }}
            skinTonesDisabled
            searchDisabled={false}
            height={380}
            width={320}
            lazyLoadEmojis
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 bg-gray-100 rounded-2xl px-3.5 py-2.5 flex items-end gap-2 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => {
              const val = e.target.value;
              setText(val);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
              // Detect @mention: find last @ before cursor
              const cursor = e.target.selectionStart ?? val.length;
              const textBeforeCursor = val.slice(0, cursor);
              const atMatch = textBeforeCursor.match(/@([\w ]*)$/);
              if (atMatch) {
                const start = cursor - atMatch[0].length;
                mentionStartRef.current = start;
                mentionQueryRef.current = atMatch[1];
                setMentionQuery(atMatch[1]);
                setMentionIndex(0);
              } else {
                mentionStartRef.current = -1;
                mentionQueryRef.current = null;
                setMentionQuery(null);
              }
            }}
            onKeyDown={handleMentionKeyDown}
            placeholder={`Message ${activeLabel}…`}
            rows={1}
            disabled={sendMutation.isPending || uploading}
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 resize-none outline-none leading-5 min-w-0"
            style={{ height: '20px', maxHeight: '128px', fontSize: '16px' }}
          />
          <button
            onClick={() => setShowEmoji(v => !v)}
            title="Emoji"
            className={`text-gray-400 hover:text-[#1B5E20] transition-colors flex-shrink-0 pb-px ${showEmoji ? 'text-[#1B5E20]' : ''}`}
          >
            <Smile size={16} />
          </button>
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
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────────── */
export default function ChatPage() {
  const qc = useQueryClient();
  const [activeRoom, setActiveRoom] = useState<string>('general');
  // locallyCleared[roomId] = ms timestamp when user entered that room; hides badges instantly
  const [locallyCleared, setLocallyCleared] = useState<Record<string, number>>({});
  const [text, setText] = useState('');
  const [unread, setUnread] = useState<Record<string, number>>({});
  const initializedRoomsRef = useRef<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'chat' | 'notifications'>('list');
  const [showMobileMembers, setShowMobileMembers] = useState(false);
  const [showMobileTasks, setShowMobileTasks] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [showCanvasPanel, setShowCanvasPanel] = useState(false);
  const [canvasEditing, setCanvasEditing] = useState(false);
  const [canvasBlocks, setCanvasBlocks] = useState<CanvasBlock[]>([]);
  const [canvasMediaUploading, setCanvasMediaUploading] = useState(false);
  const canvasFileInputRef = useRef<HTMLInputElement>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [pendingCaption, setPendingCaption] = useState('');
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [newChannelLabel, setNewChannelLabel] = useState('');
  const [newChannelEmoji, setNewChannelEmoji] = useState('💬');
  const [selectedChannelMembers, setSelectedChannelMembers] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [longPressMsg, setLongPressMsg] = useState<ChatMessage | null>(null);
  const [activeView, setActiveView] = useState<'chat' | 'notifications'>('chat');
  // Enhanced task creation
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [taskDraft, setTaskDraft] = useState({ title: '', description: '', priority: 'medium', deadline: '', assigneeIds: [] as string[], assignAll: false });
  // Task done modal
  const [doneModalTaskId, setDoneModalTaskId] = useState<string | null>(null);
  const [doneComment, setDoneComment] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRoomRef = useRef(activeRoom);
  const mobileViewRef = useRef(mobileView);

  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);
  useEffect(() => { mobileViewRef.current = mobileView; }, [mobileView]);

  // Lock all outer scroll so only the messages area scrolls on mobile.
  // iOS Safari ignores overflow:hidden on divs for momentum scrolling, so we
  // also set overscroll-behavior:none on <html>/<body> and strip the <main>
  // padding that leaves gray gaps on mobile (gaps the user accidentally swipes).
  useEffect(() => {
    const main = document.querySelector('main');
    const html = document.documentElement;
    const body = document.body;
    if (!main) return;
    const prevOverflow = main.style.overflow;
    const prevPadding = main.style.padding;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    main.style.overflow = 'hidden';
    main.style.padding = '0';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    return () => {
      main.style.overflow = prevOverflow;
      main.style.padding = prevPadding;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overscrollBehavior = prevBodyOverscroll;
    };
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
        .neq('is_active', false)
        .order('full_name');
      return (data ?? []) as MinProfile[];
    },
    staleTime: 120_000,
  });

  const myId = profile?.id ?? '';
  const otherProfiles = allProfiles.filter(p => p.id !== myId);

  /* ── Dynamic channels (admin-created) ── */
  // Fetch via server API (admin client) so RLS on chat_channels does not
  // filter out channels the user was granted via profile.chat_rooms but is
  // not yet in member_ids.
  const { data: dynamicChannels = [] } = useQuery<ChatChannel[]>({
    queryKey: ['chat-channels', myId],
    queryFn: async () => {
      if (!myId) return [];
      const res = await fetch(`/api/chat/channels?userId=${myId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!myId,
    staleTime: 30_000,
  });

  const createChannelMutation = useMutation({
    mutationFn: async ({ id, label, emoji, memberIds }: { id: string; label: string; emoji: string; memberIds: string[] }) => {
      const { error } = await supabase.from('chat_channels')
        .insert({ id, label, emoji, member_ids: memberIds, created_by: myId });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['chat-channels'] });
      setShowChannelModal(false);
      setNewChannelLabel('');
      setNewChannelEmoji('💬');
      setSelectedChannelMembers([]);
      setActiveRoom(vars.id);
      setMobileView('chat');
    },
  });

  const isAdmin = profile?.role === 'admin';
  const staticVisibleRooms = isAdmin
    ? ROOMS
    : ROOMS.filter(r => profile?.chat_rooms?.includes(r.id));
  const visibleDynamicChannels = isAdmin
    ? dynamicChannels
    : dynamicChannels.filter(c => profile?.chat_rooms?.includes(c.id));
  const visibleRooms = [...staticVisibleRooms, ...visibleDynamicChannels];

  /* ── Chat groups ── */
  const { data: chatGroups = [] } = useQuery<ChatGroup[]>({
    queryKey: ['chat-groups', myId],
    queryFn: async () => {
      if (!myId) return [];
      const { data } = await supabase
        .from('chat_groups')
        .select('*')
        .contains('member_ids', [myId])
        .order('created_at', { ascending: true });
      return (data ?? []) as ChatGroup[];
    },
    enabled: !!myId,
    staleTime: 0,
  });

  const createGroupMutation = useMutation({
    mutationFn: async (memberIds: string[]) => {
      const { data, error } = await supabase
        .from('chat_groups')
        .insert({ member_ids: memberIds, created_by: myId })
        .select()
        .single();
      if (error) throw error;
      return data as ChatGroup;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ['chat-groups', myId] });
      setShowGroupModal(false);
      setSelectedGroupMembers([]);
      setActiveRoom(groupRoomId(group));
      setMobileView('chat');
    },
  });

  const activeGroup = chatGroups.find(g => groupRoomId(g) === activeRoom) ?? null;

  const roomMembers = activeRoom.startsWith('dm::')
    ? []
    : activeRoom.startsWith('group::')
      ? allProfiles.filter(p => activeGroup?.member_ids.includes(p.id))
      : allProfiles.filter(p => p.role === 'admin' || p.role === 'manager' || (p.chat_rooms ?? []).includes(activeRoom));

  // For @mention dropdown: only people in the current room
  const mentionableProfiles = roomMembers;

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

  /* ── Room canvas ── */
  const { data: roomCanvas } = useQuery<RoomCanvas | null>({
    queryKey: ['room-canvas', activeRoom],
    queryFn: async () => {
      if (activeRoom.startsWith('dm::') || activeRoom.startsWith('group::')) return null;
      const { data } = await supabase.from('room_canvases').select('*').eq('room', activeRoom).maybeSingle();
      return (data ?? null) as RoomCanvas | null;
    },
    staleTime: 0,
  });

  const saveCanvasMutation = useMutation({
    mutationFn: async ({ content, is_editable }: { content: string; is_editable: boolean }) => {
      const { error } = await supabase.from('room_canvases').upsert(
        { room: activeRoom, content, is_editable, updated_at: new Date().toISOString(), updated_by: myId },
        { onConflict: 'room' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-canvas', activeRoom] });
      setCanvasEditing(false);
    },
  });

  // Keep legacy media query so old uploads remain visible until re-saved as blocks
  const { data: canvasMedia = [] } = useQuery<RoomCanvasMedia[]>({
    queryKey: ['room-canvas-media', activeRoom],
    queryFn: async () => {
      if (activeRoom.startsWith('dm::') || activeRoom.startsWith('group::')) return [];
      const { data } = await supabase.from('room_canvas_media').select('*').eq('room', activeRoom).order('created_at', { ascending: true });
      return (data ?? []) as RoomCanvasMedia[];
    },
    staleTime: 0,
  });

  const handleCanvasMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) { alert('Only images and videos are supported.'); return; }
    if (isImage && file.size > 20 * 1024 * 1024) { alert('Image too large. Max 20 MB.'); return; }
    if (isVideo && file.size > 500 * 1024 * 1024) { alert('Video too large. Max 500 MB.'); return; }
    setCanvasMediaUploading(true);
    try {
      let url: string;
      if (isVideo) {
        const res = await fetch(`/api/r2/presign?filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`);
        if (!res.ok) throw new Error('Failed to get upload URL');
        const { uploadUrl, publicUrl } = await res.json();
        const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        if (!putRes.ok) throw new Error('Upload failed');
        url = publicUrl;
      } else {
        const ext = file.name.split('.').pop() ?? 'jpg';
        const path = `canvas/${activeRoom}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('chat-media').upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        ({ data: { publicUrl: url } } = supabase.storage.from('chat-media').getPublicUrl(path));
      }
      const newBlock: CanvasBlock = { id: Math.random().toString(36).slice(2), type: 'media', url, mediaType: isVideo ? 'video' : 'image' };
      setCanvasBlocks(bs => [...bs, newBlock]);
    } finally {
      setCanvasMediaUploading(false);
    }
  };

  const showToast = (title: string, body: string) => {
    setToast({ title, body });
    setTimeout(() => setToast(null), 4000);
  };



  const createNotif = async (userId: string, type: string, title: string, body: string, metadata: Record<string, unknown> = {}) => {
    const res = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, type, title, body, metadata }),
    });
    if (!res.ok) console.error('createNotif failed:', await res.text(), { userId, type });
  };

  const addTaskMutation = useMutation({
    mutationFn: async (draft: typeof taskDraft) => {
      const assigneeIds = draft.assignAll ? roomMembers.map(m => m.id) : draft.assigneeIds;
      const { data, error } = await supabase.from('room_tasks').insert({
        room: activeRoom,
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        priority: draft.priority,
        deadline: draft.deadline || null,
        assignee_ids: assigneeIds,
        created_by: myId,
      }).select().single();
      if (error) throw error;
      return (data ?? { title: draft.title.trim(), priority: draft.priority, deadline: draft.deadline || null, assignee_ids: assigneeIds }) as RoomTask;
    },
    onSuccess: async (task) => {
      qc.invalidateQueries({ queryKey: ['room-tasks', activeRoom] });
      setShowNewTaskModal(false);
      const draft = taskDraft;
      setTaskDraft({ title: '', description: '', priority: 'medium', deadline: '', assigneeIds: [], assignAll: false });
      const assigneeNames = (task.assignee_ids ?? [])
        .map(id => allProfiles.find(p => p.id === id)?.full_name.split(' ')[0])
        .filter(Boolean).join(', ');
      const lines = [
        PRIORITY_LABELS[task.priority ?? 'medium'] ?? task.priority,
        task.deadline ? `Due ${task.deadline}` : null,
        assigneeNames ? `Assigned to ${assigneeNames}` : null,
        draft.description.trim() ? draft.description.trim() : null,
      ].filter(Boolean).join(' · ');
      showToast('Task created', lines || 'No additional details');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to add task: ${msg}`);
    },
  });

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase.from('room_tasks')
        .update({ completed }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['room-tasks', activeRoom] }),
  });

  const markDoneMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      // Capture task from local cache before mutation so we have created_by even if SELECT returns null
      const localTask = tasks.find(t => t.id === id);
      const { data, error } = await supabase.from('room_tasks')
        .update({ completed: true, done_comment: comment || null, done_at: new Date().toISOString(), done_by: myId })
        .eq('id', id).select().single();
      if (error) throw error;
      return { task: (data ?? localTask) as RoomTask, comment };
    },
    onSuccess: async ({ task, comment }) => {
      qc.invalidateQueries({ queryKey: ['room-tasks', activeRoom] });
      setDoneModalTaskId(null);
      setDoneComment('');
      // Notifications are handled by the DB trigger notify_task_done()
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('room_tasks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['room-tasks', activeRoom] }),
  });

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
      const msgs = (data ?? []) as ChatMessage[];
      const replyIds = [...new Set(msgs.filter(m => m.reply_to_id).map(m => m.reply_to_id!))];
      if (replyIds.length > 0) {
        const { data: replyData } = await supabase
          .from('chat_messages')
          .select('id, sender_name, content, media_type')
          .in('id', replyIds);
        const replyMap = Object.fromEntries((replyData ?? []).map(r => [r.id, r as ReplyPreview]));
        return msgs.map(m => m.reply_to_id ? { ...m, reply_to: replyMap[m.reply_to_id] ?? null } : m);
      }
      return msgs;
    },
    staleTime: 0,
  });

  /* ── Reactions ── */
  const { data: reactions = [] } = useQuery<ChatReaction[]>({
    queryKey: ['chat-reactions', activeRoom],
    queryFn: async () => {
      const ids = messages.map(m => m.id);
      if (!ids.length) return [];
      const { data } = await supabase.from('chat_reactions').select('*').in('message_id', ids);
      return (data ?? []) as ChatReaction[];
    },
    enabled: messages.length > 0,
    staleTime: 0,
  });

  /* ── Notifications ── */
  const { data: notifs = [] } = useQuery<Notif[]>({
    queryKey: ['notifications', myId],
    queryFn: async () => {
      if (!myId) return [];
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', myId)
        .order('created_at', { ascending: false })
        .limit(100);
      return (data ?? []) as Notif[];
    },
    enabled: !!myId,
    staleTime: 0,
  });

  const taskNotifs = useMemo(() => notifs.filter(n => n.type !== 'mention'), [notifs]);
  const unreadNotifCount = taskNotifs.filter(n => !n.read).length;

  const mentionsByRoom = useMemo(() => {
    const result: Record<string, number> = {};
    for (const n of notifs) {
      if (n.type === 'mention' && !n.read) {
        const room = (n.metadata as Record<string, string>)?.room;
        if (!room) continue;
        const clearedAt = locallyCleared[room];
        // Skip notifications that predate when the user entered this room
        if (clearedAt && new Date(n.created_at).getTime() <= clearedAt) continue;
        result[room] = (result[room] ?? 0) + 1;
      }
    }
    return result;
  }, [notifs, locallyCleared]);

  const markNotifReadMutation = useMutation({
    mutationFn: async (id: string | 'all') => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user_id: myId }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onMutate: (id: string | 'all') => {
      // Snapshot for rollback on error
      const previous = qc.getQueryData(['notifications', myId]);
      qc.setQueryData(['notifications', myId], (old: Notif[] | undefined) => {
        if (!old) return old;
        return old.map(n => id === 'all' ? { ...n, read: true } : n.id === id ? { ...n, read: true } : n);
      });
      return { previous };
    },
    onError: (_err, _id, context) => {
      // Rollback on failure
      if (context?.previous) qc.setQueryData(['notifications', myId], context.previous);
    },
    onSuccess: () => {
      // Confirm DB state — admin API update succeeds synchronously so no race condition
      qc.invalidateQueries({ queryKey: ['notifications', myId] });
    },
  });

  /* ── Notifications realtime ── */
  useEffect(() => {
    if (!myId) return;
    const ch = supabase
      .channel(`notifications::${myId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${myId}` }, () => {
        qc.invalidateQueries({ queryKey: ['notifications', myId] });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${myId}` }, () => {
        qc.invalidateQueries({ queryKey: ['notifications', myId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [myId, qc]);

  useEffect(() => {
    // Scroll the messages container directly to avoid scrollIntoView scrolling main
    const container = messagesEndRef.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  useEffect(() => {
    // Also scroll to bottom when switching rooms (cache may already have messages, so [messages] won't fire)
    const raf = requestAnimationFrame(() => {
      const container = messagesEndRef.current?.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
      // Second pass for slow network — messages may still be loading
      setTimeout(() => {
        const c = messagesEndRef.current?.parentElement;
        if (c) c.scrollTop = c.scrollHeight;
      }, 300);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeRoom]);

  useEffect(() => {
    // On mobile, ChatMessages unmounts when on the list screen and remounts when
    // entering a room. The activeRoom/messages effects fire before the container
    // exists, so scroll again once the chat view becomes visible.
    if (mobileView !== 'chat') return;
    const raf = requestAnimationFrame(() => {
      const container = messagesEndRef.current?.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
      setTimeout(() => {
        const c = messagesEndRef.current?.parentElement;
        if (c) c.scrollTop = c.scrollHeight;
      }, 150);
    });
    return () => cancelAnimationFrame(raf);
  }, [mobileView]);

  /* ── Mark room as read ── */
  useEffect(() => {
    setUnread(prev => { const n = { ...prev }; delete n[activeRoom]; return n; });
    if (myId) {
      supabase.from('chat_read_markers').upsert(
        { user_id: myId, room: activeRoom, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,room' },
      ).then(() => {});
    }
  }, [activeRoom, myId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Initial unread counts from DB — runs for each new room as they appear ── */
  useEffect(() => {
    if (!myId || visibleRooms.length === 0) return;
    // Only fetch rooms we haven't fetched yet (handles dynamic channels loading late)
    const newRooms = visibleRooms.filter(r => !initializedRoomsRef.current.has(r.id));
    if (newRooms.length === 0) return;
    newRooms.forEach(r => initializedRoomsRef.current.add(r.id));

    const init = async () => {
      const { data: markers } = await supabase
        .from('chat_read_markers')
        .select('room, last_read_at')
        .eq('user_id', myId);
      const markerMap: Record<string, string> = {};
      for (const m of markers ?? []) markerMap[m.room] = m.last_read_at;

      const counts: Record<string, number> = {};
      await Promise.all(
        newRooms.map(async (room) => {
          const lastRead = markerMap[room.id];
          let q = supabase
            .from('chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('room', room.id)
            .neq('sender_id', myId);
          if (lastRead) q = q.gt('created_at', lastRead);
          const { count } = await q;
          if (count && count > 0) counts[room.id] = count;
        }),
      );
      // Merge counts but don't override in-memory realtime increments
      setUnread(prev => ({ ...counts, ...prev }));
      // Clear the currently-active room (read_marker was just upserted on enter)
      setUnread(prev => { const n = { ...prev }; delete n[activeRoom]; return n; });
    };
    init();
  }, [myId, visibleRooms]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Realtime: active room ── */
  useEffect(() => {
    const channel = supabase
      .channel(`chat-room::${activeRoom}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `room=eq.${activeRoom}`,
      }, async (payload) => {
        let msg = payload.new as ChatMessage;
        if (msg.reply_to_id) {
          const { data } = await supabase
            .from('chat_messages')
            .select('id, sender_name, content, media_type')
            .eq('id', msg.reply_to_id)
            .single();
          if (data) msg = { ...msg, reply_to: data as ReplyPreview };
        }
        qc.setQueryData<ChatMessage[]>(['chat-messages', activeRoom], (prev = []) =>
          prev.some(m => m.id === msg.id) ? prev : [...prev, msg],
        );
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'chat_messages',
        filter: `room=eq.${activeRoom}`,
      }, (payload) => {
        const updated = payload.new as ChatMessage;
        qc.setQueryData<ChatMessage[]>(['chat-messages', activeRoom], (prev = []) =>
          prev.map(m => m.id === updated.id ? { ...updated, reply_to: m.reply_to } : m),
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeRoom, qc]);

  /* ── Realtime: reactions ── */
  useEffect(() => {
    const channel = supabase
      .channel(`chat-reactions::${activeRoom}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_reactions' }, (payload) => {
        const r = payload.new as ChatReaction;
        qc.setQueryData<ChatReaction[]>(['chat-reactions', activeRoom], (prev = []) => {
          const msgs = qc.getQueryData<ChatMessage[]>(['chat-messages', activeRoom]) ?? [];
          if (!msgs.some(m => m.id === r.message_id)) return prev;
          return prev.some(x => x.id === r.id) ? prev : [...prev, r];
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_reactions' }, (payload) => {
        const r = payload.old as { id: string };
        qc.setQueryData<ChatReaction[]>(['chat-reactions', activeRoom], (prev = []) =>
          prev.filter(x => x.id !== r.id),
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
        // On mobile the user is only actively reading a room when mobileView === 'chat'.
        // On the list/notifications screen, activeRoom is still set but the user
        // isn't seeing it — count new messages for ALL rooms including the default
        // activeRoom (General). On desktop mobileView stays 'list' but the chat is
        // always visible, so use window width to differentiate.
        const isMobileWidth = typeof window !== 'undefined' && window.innerWidth < 768;
        const activelyViewing =
          msg.room === activeRoomRef.current &&
          (!isMobileWidth || mobileViewRef.current === 'chat');
        if (!activelyViewing) {
          setUnread(prev => ({ ...prev, [msg.room]: (prev[msg.room] ?? 0) + 1 }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /* ── Send ── */
  const sendMutation = useMutation({
    mutationFn: async ({
      content, mediaUrl, mediaType, replyToId,
    }: { content: string | null; mediaUrl?: string | null; mediaType?: string | null; replyToId?: string | null }) => {
      if (!profile) throw new Error('Not logged in');
      const { error } = await supabase.from('chat_messages').insert({
        room:         activeRoom,
        sender_id:    profile.id,
        sender_name:  profile.full_name,
        content:      content || null,
        media_url:    mediaUrl ?? null,
        media_type:   mediaType ?? null,
        reply_to_id:  replyToId ?? null,
      });
      if (error) throw error;
    },
  });

  /* ── React ── */
  const reactMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      const existing = reactions.find(r => r.message_id === messageId && r.user_id === myId && r.emoji === emoji);
      if (existing) {
        const { error } = await supabase.from('chat_reactions').delete().eq('id', existing.id);
        if (error) throw error;
        qc.setQueryData<ChatReaction[]>(['chat-reactions', activeRoom], (prev = []) => prev.filter(r => r.id !== existing.id));
      } else {
        const { data, error } = await supabase.from('chat_reactions')
          .insert({ message_id: messageId, user_id: myId, emoji })
          .select().single();
        if (error) throw error;
        qc.setQueryData<ChatReaction[]>(['chat-reactions', activeRoom], (prev = []) => [...prev, data as ChatReaction]);
      }
    },
  });

  /* ── Edit ── */
  const editMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase
        .from('chat_messages')
        .update({ content, edited_at: new Date().toISOString() })
        .eq('id', id)
        .eq('sender_id', myId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.setQueryData<ChatMessage[]>(['chat-messages', activeRoom], (prev = []) =>
        prev.map(m => m.id === vars.id ? { ...m, content: vars.content, edited_at: new Date().toISOString() } : m),
      );
      setEditingId(null);
      setEditingText('');
    },
  });

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingId(msg.id);
    setEditingText(msg.content ?? '');
  };

  const handleSaveEdit = () => {
    if (!editingId || !editingText.trim() || editMutation.isPending) return;
    editMutation.mutate({ id: editingId, content: editingText.trim() });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };

  const activeLabel =
    visibleRooms.find(r => r.id === activeRoom)?.label ??
    otherProfiles.find(p => activeRoom === dmRoom(myId, p.id))?.full_name ??
    (activeGroup ? groupLabel(activeGroup, allProfiles, myId) : null) ??
    'Chat';

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    const replyId = replyingTo?.id ?? null;
    setText('');
    setReplyingTo(null);
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
    await sendMutation.mutateAsync({ content: trimmed, replyToId: replyId });
    // detect @mentions and notify — match full name or first name, case-insensitive
    const lowerTrimmed = trimmed.toLowerCase();
    for (const p of allProfiles) {
      if (p.id === myId) continue;
      const fullMention = ('@' + p.full_name).toLowerCase();
      const firstName = p.full_name.split(' ')[0];
      const firstMention = ('@' + firstName).toLowerCase();
      if (lowerTrimmed.includes(fullMention) || lowerTrimmed.includes(firstMention + ' ') || lowerTrimmed.endsWith(firstMention)) {
        await createNotif(p.id, 'mention',
          `${profile?.full_name ?? 'Someone'} mentioned you`,
          `In ${activeLabel}: "${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}"`,
          { room: activeRoom });
      }
    }
  }, [text, sendMutation, replyingTo, allProfiles, myId, profile, activeLabel, activeRoom]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) { alert('Only images and videos are supported.'); return; }
    if (isImage && file.size > 20 * 1024 * 1024) { alert('Image too large. Max 20 MB.'); return; }
    if (isVideo && file.size > 500 * 1024 * 1024) { alert('Video too large. Max 500 MB.'); return; }
    setPendingFile(file);
    setPendingPreviewUrl(URL.createObjectURL(file));
    setPendingCaption('');
  };

  const handleSendMedia = async () => {
    if (!pendingFile || !profile) return;
    const isImage = pendingFile.type.startsWith('image/');
    const isVideo = pendingFile.type.startsWith('video/');
    setUploading(true);
    try {
      let publicUrl: string;
      if (isVideo) {
        // Upload video to Cloudflare R2 via presigned URL
        const res = await fetch(`/api/r2/presign?filename=${encodeURIComponent(pendingFile.name)}&type=${encodeURIComponent(pendingFile.type)}`);
        if (!res.ok) throw new Error('Failed to get upload URL');
        const { uploadUrl, publicUrl: r2Url } = await res.json();
        const putRes = await fetch(uploadUrl, { method: 'PUT', body: pendingFile, headers: { 'Content-Type': pendingFile.type } });
        if (!putRes.ok) throw new Error('Video upload to R2 failed');
        publicUrl = r2Url;
      } else {
        // Upload image to Supabase Storage
        const ext = pendingFile.name.split('.').pop() ?? 'bin';
        const path = `${activeRoom}/${Date.now()}-${profile.id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('chat-media').upload(path, pendingFile, { contentType: pendingFile.type });
        if (upErr) throw upErr;
        ({ data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(path));
      }
      await sendMutation.mutateAsync({ content: pendingCaption.trim() || null, mediaUrl: publicUrl, mediaType: isImage ? 'image' : 'video' });
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      setPendingFile(null);
      setPendingPreviewUrl(null);
      setPendingCaption('');
    } catch (err) {
      console.error('Upload failed', err);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const cancelPendingMedia = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
    setPendingCaption('');
  };

  // Clear @mention badge for a room: record clear timestamp in local state (instant),
  // then mark as read in DB, then refetch to confirm.
  const clearRoomMentions = async (room: string) => {
    if (!myId) return;
    // Record the clear time — mentionsByRoom will ignore all pre-existing mentions for this room
    const clearTime = Date.now();
    setLocallyCleared(prev => ({ ...prev, [room]: clearTime }));
    // Persist to DB
    await supabase.from('notifications')
      .update({ read: true })
      .eq('user_id', myId)
      .eq('type', 'mention')
      .eq('read', false);
    // Sync cache — after this, notifs have read:true so badge stays gone even if locallyCleared resets
    qc.refetchQueries({ queryKey: ['notifications', myId] });
  };

  // Desktop sidebar room selection — does NOT change mobileView
  const handleDesktopSelect = (room: string) => {
    setActiveRoom(room);
    clearRoomMentions(room);
  };

  // Mobile channel list selection — switches to chat view
  const handleMobileSelect = (room: string) => {
    setActiveRoom(room);
    setMobileView('chat');
    clearRoomMentions(room);
  };

  const handleReact = (messageId: string, emoji: string) => reactMutation.mutate({ messageId, emoji });

  const sharedInputProps = { text, setText, activeLabel, textareaRef, fileInputRef, uploading, sendMutation, handleSend, handleKeyDown, handleFileChange, replyingTo, onCancelReply: () => setReplyingTo(null), mentionMembers: mentionableProfiles };

  /* ─── Render ─────────────────────────────────────────────────────────────── */
  return (
    <>
    <div className="flex h-full bg-white overflow-hidden md:rounded-xl md:border md:border-gray-100 md:shadow-sm">

      {/* ── MOBILE: Channel list ── */}
      {mobileView === 'list' && (
        <div className="md:hidden flex flex-col w-full">
          <MobileChannelList
            visibleRooms={visibleRooms}
            otherProfiles={otherProfiles}
            allProfiles={allProfiles}
            myId={myId}
            unread={unread}
            mentionsByRoom={mentionsByRoom}
            onSelect={handleMobileSelect}
            profile={profile ?? null}
            chatGroups={chatGroups}
            onCreateGroup={() => setShowGroupModal(true)}
            isAdmin={isAdmin}
            onCreateChannel={() => setShowChannelModal(true)}
            onViewNotifications={() => setMobileView('notifications')}
            unreadNotifCount={unreadNotifCount}
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
                <button
                  onClick={() => setShowCanvasPanel(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <KeyRound size={14} />
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
          <ChatMessages messages={messages} isLoading={isLoading} myId={myId} messagesEndRef={messagesEndRef} reactions={reactions} editingId={editingId} editingText={editingText} onStartEdit={handleStartEdit} onTextChange={setEditingText} onSave={handleSaveEdit} onCancel={handleCancelEdit} onReply={setReplyingTo} onReact={handleReact} onLongPress={setLongPressMsg} allProfiles={allProfiles} />
          <ChatInput {...sharedInputProps} />

        </div>
      )}

      {/* ── Tasks panel (shared mobile + desktop) ── */}
      {showMobileTasks && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileTasks(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="font-semibold text-gray-900">Tasks — {activeLabel}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowMobileTasks(false); setShowNewTaskModal(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-medium"
                >
                  <Plus size={13} /> New Task
                </button>
                <button onClick={() => setShowMobileTasks(false)} className="text-gray-400 hover:text-gray-600 p-1">
                  <X size={18} />
                </button>
              </div>
            </div>
            {/* Task table */}
            <div className="overflow-auto flex-1">
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 select-none">
                  <ClipboardList size={32} className="mb-2 opacity-25" />
                  <p className="text-sm">No tasks yet</p>
                </div>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-left">
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 w-8" />
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500">Task</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 whitespace-nowrap">Priority</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 whitespace-nowrap">Due</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500">Assignee</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 w-20 text-center">Done</th>
                      <th className="px-2 py-2 w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(task => {
                      const assignees = (task.assignee_ids ?? []).map(id => allProfiles.find(p => p.id === id)).filter(Boolean) as MinProfile[];
                      return (
                        <tr key={task.id} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${task.completed ? 'opacity-50' : ''}`}>
                          {/* Status dot */}
                          <td className="px-3 py-2.5 align-middle">
                            <div className={`w-2 h-2 rounded-full mx-auto ${task.completed ? 'bg-[#1B5E20]' : 'bg-gray-200'}`} />
                          </td>
                          {/* Task name + description */}
                          <td className="px-3 py-2.5 align-middle max-w-[160px]">
                            <p className={`text-sm font-medium leading-snug ${task.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.title}</p>
                            {task.description && <p className="text-xs text-gray-400 truncate">{task.description}</p>}
                            {task.completed && task.done_comment && <p className="text-xs text-gray-400 italic truncate">"{task.done_comment}"</p>}
                          </td>
                          {/* Priority */}
                          <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                            {task.priority ? (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] ?? 'bg-gray-100 text-gray-500'}`}>
                                {PRIORITY_LABELS[task.priority] ?? task.priority}
                              </span>
                            ) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          {/* Deadline */}
                          <td className="px-3 py-2.5 align-middle whitespace-nowrap text-xs text-gray-500">
                            {task.deadline ? task.deadline : <span className="text-gray-300">—</span>}
                          </td>
                          {/* Assignees */}
                          <td className="px-3 py-2.5 align-middle">
                            {assignees.length > 0 ? (
                              <span className="text-xs text-gray-600">{assignees.map(a => a.full_name.split(' ')[0]).join(', ')}</span>
                            ) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          {/* Done button */}
                          <td className="px-3 py-2.5 align-middle text-center">
                            {task.completed ? (
                              <button
                                onClick={() => toggleTaskMutation.mutate({ id: task.id, completed: false })}
                                className="text-[10px] font-semibold text-[#1B5E20] bg-[#1B5E20]/10 px-2 py-1 rounded-full whitespace-nowrap"
                              >✓ Done</button>
                            ) : (
                              <button
                                onClick={() => setDoneModalTaskId(task.id)}
                                className="text-[10px] font-semibold text-gray-500 border border-gray-200 px-2 py-1 rounded-full hover:border-[#1B5E20] hover:text-[#1B5E20] transition-colors whitespace-nowrap"
                              >Mark done</button>
                            )}
                          </td>
                          {/* Delete */}
                          <td className="px-2 py-2.5 align-middle">
                            <button onClick={() => deleteTaskMutation.mutate(task.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50">
                              <X size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Canvas panel ── */}
      {showCanvasPanel && (() => {
        const canEdit = isAdmin || (roomCanvas?.is_editable ?? true);
        const isReadOnly = !(roomCanvas?.is_editable ?? true);
        const updatedByName = roomCanvas?.updated_by
          ? (allProfiles.find(p => p.id === roomCanvas.updated_by)?.full_name ?? 'Unknown')
          : null;

        // Parse stored blocks from DB for view mode, merging any legacy room_canvas_media entries
        const viewBlocks: CanvasBlock[] = (() => {
          const raw = roomCanvas?.content;
          let blocks: CanvasBlock[] = [];
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              blocks = Array.isArray(parsed) ? (parsed as CanvasBlock[]) : [{ id: '0', type: 'text', content: raw }];
            } catch {
              blocks = [{ id: '0', type: 'text', content: raw }];
            }
          }
          // Append legacy media entries not already present as blocks
          const existingUrls = new Set(blocks.filter(b => b.type === 'media').map(b => (b as { url: string }).url));
          for (const m of canvasMedia) {
            if (!existingUrls.has(m.url)) {
              blocks = [...blocks, { id: m.id, type: 'media', url: m.url, mediaType: m.media_type }];
            }
          }
          return blocks;
        })();

        const moveBlock = (idx: number, dir: -1 | 1) => {
          setCanvasBlocks(bs => {
            const next = [...bs];
            const swap = idx + dir;
            if (swap < 0 || swap >= next.length) return bs;
            [next[idx], next[swap]] = [next[swap], next[idx]];
            return next;
          });
        };

        return (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => { setShowCanvasPanel(false); setCanvasEditing(false); }}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-t-2xl shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-gray-300" /></div>

              {/* Header */}
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <BookOpen size={16} className="text-gray-500" />
                  <span className="font-semibold text-gray-900">Canvas — {activeLabel}</span>
                  {isReadOnly && (
                    <span className="flex items-center gap-1 text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      <Lock size={9} /> Read-only
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <button
                      onClick={() => saveCanvasMutation.mutate({ content: roomCanvas?.content ?? '', is_editable: isReadOnly })}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs transition-colors"
                      title={isReadOnly ? 'Make editable' : 'Set read-only'}
                    >
                      {isReadOnly ? <><Unlock size={12} /> Unlock</> : <><Lock size={12} /> Lock</>}
                    </button>
                  )}
                  {canEdit && !canvasEditing && (
                    <button
                      onClick={() => {
                        const raw = roomCanvas?.content;
                        let blocks: CanvasBlock[] = [];
                        if (raw) {
                          try {
                            const parsed = JSON.parse(raw);
                            blocks = Array.isArray(parsed) ? parsed : [{ id: Math.random().toString(36).slice(2), type: 'text', content: raw }];
                          } catch {
                            blocks = [{ id: Math.random().toString(36).slice(2), type: 'text', content: raw }];
                          }
                        }
                        // Merge legacy media not already in blocks
                        const existingUrls = new Set(blocks.filter(b => b.type === 'media').map(b => (b as { url: string }).url));
                        for (const m of canvasMedia) {
                          if (!existingUrls.has(m.url)) {
                            blocks = [...blocks, { id: m.id, type: 'media', url: m.url, mediaType: m.media_type }];
                          }
                        }
                        if (blocks.length === 0) blocks = [{ id: Math.random().toString(36).slice(2), type: 'text', content: '' }];
                        setCanvasBlocks(blocks);
                        setCanvasEditing(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-medium"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                  )}
                  {canvasEditing && (
                    <>
                      <button onClick={() => setCanvasEditing(false)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600">Cancel</button>
                      <button
                        onClick={() => saveCanvasMutation.mutate({ content: JSON.stringify(canvasBlocks), is_editable: roomCanvas?.is_editable ?? true })}
                        disabled={saveCanvasMutation.isPending}
                        className="px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-medium disabled:opacity-40"
                      >
                        {saveCanvasMutation.isPending ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  )}
                  <button onClick={() => { setShowCanvasPanel(false); setCanvasEditing(false); }} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
                {canvasEditing ? (
                  <>
                    {canvasBlocks.map((block, idx) => (
                      <div key={block.id} className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
                        {/* Block toolbar */}
                        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200">
                          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                            {block.type === 'text' ? 'Text' : block.mediaType === 'video' ? 'Video' : 'Image'}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => moveBlock(idx, -1)}
                              disabled={idx === 0}
                              className="flex items-center gap-0.5 px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                            >
                              <ChevronUp size={13} /> Up
                            </button>
                            <button
                              onClick={() => moveBlock(idx, 1)}
                              disabled={idx === canvasBlocks.length - 1}
                              className="flex items-center gap-0.5 px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                            >
                              <ChevronDown size={13} /> Down
                            </button>
                            <button
                              onClick={() => setCanvasBlocks(bs => bs.filter(b => b.id !== block.id))}
                              className="px-2 py-0.5 rounded bg-white border border-gray-200 text-red-400 hover:bg-red-50 hover:border-red-300 text-xs"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        {/* Block content */}
                        <div>
                          {block.type === 'text' ? (
                            <textarea
                              value={block.content}
                              onChange={e => setCanvasBlocks(bs => bs.map(b => b.id === block.id ? { ...b, content: e.target.value } : b))}
                              className="w-full min-h-[80px] text-sm text-gray-800 leading-relaxed outline-none resize-none px-4 py-3 focus:bg-green-50/30 transition-colors"
                              placeholder="Write text here…"
                              style={{ fontSize: '16px' }}
                            />
                          ) : (
                            <div>
                              <div className="bg-gray-100">
                                {block.mediaType === 'image' ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={block.url} alt="" className="w-full max-h-72 object-contain" />
                                ) : (
                                  <video src={block.url} controls preload="metadata" playsInline className="w-full max-h-72" onLoadedMetadata={e => { (e.target as HTMLVideoElement).currentTime = 0.001; }} />
                                )}
                              </div>
                              <input
                                type="text"
                                value={block.caption ?? ''}
                                onChange={e => setCanvasBlocks(bs => bs.map(b => b.id === block.id ? { ...b, caption: e.target.value } : b))}
                                className="w-full px-4 py-2 text-sm text-gray-600 outline-none border-t border-gray-200 placeholder:text-gray-400 bg-white"
                                placeholder="Add a caption…"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Add block buttons */}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => setCanvasBlocks(bs => [...bs, { id: Math.random().toString(36).slice(2), type: 'text', content: '' }])}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-gray-300 text-gray-500 text-xs hover:border-[#1B5E20] hover:text-[#1B5E20] transition-colors"
                      >
                        <Plus size={13} /> Add text
                      </button>
                      <button
                        onClick={() => canvasFileInputRef.current?.click()}
                        disabled={canvasMediaUploading}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-gray-300 text-gray-500 text-xs hover:border-[#1B5E20] hover:text-[#1B5E20] transition-colors disabled:opacity-40"
                      >
                        {canvasMediaUploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                        {canvasMediaUploading ? 'Uploading…' : 'Add photo or video'}
                      </button>
                    </div>
                    <input ref={canvasFileInputRef} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" onChange={handleCanvasMedia} />
                  </>
                ) : viewBlocks.length > 0 ? (
                  viewBlocks.map((block, idx) => (
                    <div key={block.id ?? idx}>
                      {block.type === 'text' ? (
                        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{block.content}</p>
                      ) : (
                        <div className="rounded-xl overflow-hidden border border-gray-100">
                          {block.mediaType === 'image' ? (
                            <a href={block.url} target="_blank" rel="noopener noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={block.url} alt="" className="w-full max-h-80 object-contain bg-gray-100" />
                            </a>
                          ) : (
                            <video src={block.url} controls preload="metadata" playsInline className="w-full max-h-80 bg-black" onLoadedMetadata={e => { (e.target as HTMLVideoElement).currentTime = 0.001; }} />
                          )}
                          {block.caption && (
                            <p className="px-4 py-2 text-sm text-gray-500 bg-white border-t border-gray-100">{block.caption}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400 select-none">
                    <BookOpen size={36} className="mb-2 opacity-25" />
                    <p className="text-sm">Canvas is empty</p>
                    {canEdit && <p className="text-xs mt-1">Tap Edit to add content</p>}
                  </div>
                )}
              </div>

              {/* Footer */}
              {updatedByName && !canvasEditing && (
                <div className="px-5 py-2 border-t border-gray-100 flex-shrink-0">
                  <p className="text-[10px] text-gray-400">Last edited by {updatedByName} · {roomCanvas?.updated_at ? fmtTime(roomCanvas.updated_at) : ''}</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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

      {/* ── Media preview + caption modal ── */}
      {pendingFile && pendingPreviewUrl && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={cancelPendingMedia}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Image / video preview */}
            <div className="bg-black flex-shrink-0 flex items-center justify-center" style={{ maxHeight: '55vh' }}>
              {pendingFile.type.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pendingPreviewUrl} alt="preview" className="w-full object-contain" style={{ maxHeight: '55vh' }} />
              ) : (
                <video src={pendingPreviewUrl} controls className="w-full object-contain" style={{ maxHeight: '55vh' }} />
              )}
            </div>
            {/* Caption + actions */}
            <div className="px-4 pt-3 pb-5 flex flex-col gap-3 bg-white">
              <textarea
                value={pendingCaption}
                onChange={e => setPendingCaption(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMedia(); } }}
                placeholder="Add a caption… (optional)"
                rows={2}
                autoFocus
                className="w-full bg-gray-100 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder-gray-400 resize-none leading-snug"
                style={{ fontSize: '16px' }}
              />
              <div className="flex gap-2">
                <button
                  onClick={cancelPendingMedia}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendMedia}
                  disabled={uploading || sendMutation.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-[#1B5E20] text-white text-sm font-semibold disabled:opacity-40 hover:bg-[#2E7D32] transition-colors flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending…
                    </>
                  ) : (
                    'Send'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Group creation modal ── */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowGroupModal(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="font-semibold text-gray-900">New Group Message</span>
              <button onClick={() => setShowGroupModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={18} />
              </button>
            </div>
            <p className="px-5 pt-3 pb-1 text-xs text-gray-400">Select members to include in the group:</p>
            <div className="overflow-y-auto flex-1 py-2">
              {otherProfiles.map(p => {
                const checked = selectedGroupMembers.includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedGroupMembers(prev =>
                        checked ? prev.filter(id => id !== p.id) : [...prev, p.id]
                      )}
                      className="w-4 h-4 accent-[#1B5E20] flex-shrink-0"
                    />
                    <div className="w-8 h-8 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[11px] font-bold text-[#1B5E20] flex-shrink-0">
                      {initials(p.full_name)}
                    </div>
                    <span className="text-sm text-gray-800">{p.full_name}</span>
                  </label>
                );
              })}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="text-xs text-gray-400">{selectedGroupMembers.length} selected</span>
              <button
                onClick={() => createGroupMutation.mutate([myId, ...selectedGroupMembers])}
                disabled={selectedGroupMembers.length < 1 || createGroupMutation.isPending}
                className="px-5 py-2 rounded-xl bg-[#1B5E20] text-white text-sm font-semibold disabled:opacity-40 hover:bg-[#2E7D32] transition-colors"
              >
                {createGroupMutation.isPending ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Channel creation modal (admin only) ── */}
      {showChannelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowChannelModal(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="font-semibold text-gray-900">New Channel</span>
              <button onClick={() => setShowChannelModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4 flex-shrink-0">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Channel name</label>
                <input
                  type="text"
                  value={newChannelLabel}
                  onChange={e => setNewChannelLabel(e.target.value)}
                  placeholder="e.g. Marketing"
                  className="w-full bg-gray-100 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder-gray-400"
                  style={{ fontSize: '16px' }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Emoji</label>
                <div className="flex gap-2 flex-wrap">
                  {['💬','📢','🏪','🏭','📦','📋','🎯','💡'].map(em => (
                    <button
                      key={em}
                      onClick={() => setNewChannelEmoji(em)}
                      className={`w-9 h-9 rounded-lg text-xl flex items-center justify-center transition-colors ${
                        newChannelEmoji === em ? 'bg-[#1B5E20]/15 ring-2 ring-[#1B5E20]' : 'bg-gray-100 hover:bg-gray-200'
                      }`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="border-t border-gray-100 flex-shrink-0 px-5 pt-3 pb-1">
              <p className="text-xs font-medium text-gray-500">Members</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Select who can see this channel. You are always included.</p>
            </div>
            <div className="overflow-y-auto flex-1 py-1">
              {otherProfiles.map(p => {
                const checked = selectedChannelMembers.includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedChannelMembers(prev =>
                        checked ? prev.filter(id => id !== p.id) : [...prev, p.id]
                      )}
                      className="w-4 h-4 accent-[#1B5E20] flex-shrink-0"
                    />
                    <div className="w-8 h-8 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[11px] font-bold text-[#1B5E20] flex-shrink-0">
                      {initials(p.full_name)}
                    </div>
                    <span className="text-sm text-gray-800">{p.full_name}</span>
                  </label>
                );
              })}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="text-xs text-gray-400">{selectedChannelMembers.length + 1} member{selectedChannelMembers.length !== 0 ? 's' : ''}</span>
              <button
                onClick={() => {
                  const label = newChannelLabel.trim();
                  if (!label) return;
                  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                  createChannelMutation.mutate({ id, label, emoji: newChannelEmoji, memberIds: [myId, ...selectedChannelMembers] });
                }}
                disabled={!newChannelLabel.trim() || createChannelMutation.isPending}
                className="px-5 py-2 rounded-xl bg-[#1B5E20] text-white text-sm font-semibold disabled:opacity-40 hover:bg-[#2E7D32] transition-colors"
              >
                {createChannelMutation.isPending ? 'Creating…' : 'Create Channel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Long-press bottom sheet (mobile only) ── */}
      {longPressMsg && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setLongPressMsg(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-t-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            {/* Message preview */}
            <div className="px-5 pb-3 border-b border-gray-100">
              <p className="text-[11px] font-semibold text-gray-400 mb-0.5">{longPressMsg.sender_name}</p>
              <p className="text-sm text-gray-700 line-clamp-2">{longPressMsg.content ?? '📷 Media'}</p>
            </div>
            {/* Quick reactions */}
            <div className="flex justify-around px-4 py-4 border-b border-gray-100">
              {QUICK_EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => { handleReact(longPressMsg.id, e); setLongPressMsg(null); }}
                  className="text-2xl w-11 h-11 flex items-center justify-center rounded-full active:bg-gray-100 transition-colors"
                >
                  {e}
                </button>
              ))}
            </div>
            {/* Actions */}
            <div className="py-1">
              <button
                onClick={() => { setReplyingTo(longPressMsg); setLongPressMsg(null); }}
                className="w-full flex items-center gap-4 px-5 py-4 text-left active:bg-gray-50"
              >
                <CornerUpLeft size={20} className="text-gray-500 flex-shrink-0" />
                <span className="text-[15px] text-gray-800">Reply</span>
              </button>
              {longPressMsg.sender_id === myId && !longPressMsg.media_url && (
                <button
                  onClick={() => { handleStartEdit(longPressMsg); setLongPressMsg(null); }}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left active:bg-gray-50"
                >
                  <Pencil size={20} className="text-gray-500 flex-shrink-0" />
                  <span className="text-[15px] text-gray-800">Edit</span>
                </button>
              )}
            </div>
            <div className="pb-8" />
          </div>
        </div>
      )}

      {/* ── New Task Modal ── */}
      {showNewTaskModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowNewTaskModal(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1 sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-300" /></div>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="font-semibold text-gray-900">New Task — {activeLabel}</span>
              <button onClick={() => setShowNewTaskModal(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Title *</label>
                <input
                  type="text" value={taskDraft.title} onChange={e => setTaskDraft(d => ({ ...d, title: e.target.value }))}
                  placeholder="What needs to be done?"
                  className="w-full bg-gray-100 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder-gray-400"
                  style={{ fontSize: '16px' }} autoFocus
                />
              </div>
              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Description (optional)</label>
                <textarea
                  value={taskDraft.description} onChange={e => setTaskDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="Add more detail…" rows={3}
                  className="w-full bg-gray-100 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder-gray-400 resize-none leading-snug"
                  style={{ fontSize: '16px' }}
                />
              </div>
              {/* Priority + Deadline */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1"><Flag size={10} className="inline mr-1" />Priority</label>
                  <select
                    value={taskDraft.priority} onChange={e => setTaskDraft(d => ({ ...d, priority: e.target.value }))}
                    className="w-full bg-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-900 outline-none"
                    style={{ fontSize: '16px' }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1"><Calendar size={10} className="inline mr-1" />Deadline (optional)</label>
                  <input
                    type="date" value={taskDraft.deadline} onChange={e => setTaskDraft(d => ({ ...d, deadline: e.target.value }))}
                    className="w-full bg-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-900 outline-none"
                    style={{ fontSize: '16px' }}
                  />
                </div>
              </div>
              {/* Assignees */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2"><UserCheck size={10} className="inline mr-1" />Assign to</label>
                <label className="flex items-center gap-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={taskDraft.assignAll}
                    onChange={e => setTaskDraft(d => ({ ...d, assignAll: e.target.checked, assigneeIds: [] }))}
                    className="w-4 h-4 accent-[#1B5E20]" />
                  <span className="text-sm font-medium text-[#1B5E20]">Whole Team (everyone in this channel)</span>
                </label>
                {!taskDraft.assignAll && roomMembers.filter(m => m.id !== myId).map(m => (
                  <label key={m.id} className="flex items-center gap-3 py-2 cursor-pointer">
                    <input type="checkbox"
                      checked={taskDraft.assigneeIds.includes(m.id)}
                      onChange={e => setTaskDraft(d => ({
                        ...d,
                        assigneeIds: e.target.checked ? [...d.assigneeIds, m.id] : d.assigneeIds.filter(id => id !== m.id)
                      }))}
                      className="w-4 h-4 accent-[#1B5E20]" />
                    <div className="w-7 h-7 rounded-full bg-[#1B5E20]/15 flex items-center justify-center text-[10px] font-bold text-[#1B5E20] flex-shrink-0">{initials(m.full_name)}</div>
                    <span className="text-sm text-gray-800">{m.full_name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
              <button onClick={() => setShowNewTaskModal(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 font-medium">Cancel</button>
              <button
                onClick={() => { if (taskDraft.title.trim()) addTaskMutation.mutate(taskDraft); }}
                disabled={!taskDraft.title.trim() || addTaskMutation.isPending}
                className="flex-1 py-2.5 rounded-xl bg-[#1B5E20] text-white text-sm font-semibold disabled:opacity-40"
              >
                {addTaskMutation.isPending ? 'Adding…' : 'Add Task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Done modal ── */}
      {doneModalTaskId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => { setDoneModalTaskId(null); setDoneComment(''); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1 sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-300" /></div>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="font-semibold text-gray-900">Mark as Done</span>
              <button onClick={() => { setDoneModalTaskId(null); setDoneComment(''); }} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-sm text-gray-600">Add an optional comment for the task creator:</p>
              <textarea
                value={doneComment} onChange={e => setDoneComment(e.target.value)}
                placeholder="e.g. Completed at 14:00, all done!"
                rows={3} autoFocus
                className="w-full bg-gray-100 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder-gray-400 resize-none leading-snug"
                style={{ fontSize: '16px' }}
              />
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
              <button onClick={() => { setDoneModalTaskId(null); setDoneComment(''); }} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 font-medium">Cancel</button>
              <button
                onClick={() => markDoneMutation.mutate({ id: doneModalTaskId!, comment: doneComment })}
                disabled={markDoneMutation.isPending}
                className="flex-1 py-2.5 rounded-xl bg-[#1B5E20] text-white text-sm font-semibold disabled:opacity-40"
              >
                {markDoneMutation.isPending ? 'Saving…' : 'Mark Done'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE: Notifications view ── */}
      {mobileView === 'notifications' && (
        <div className="md:hidden flex flex-col w-full overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
            <button onClick={() => setMobileView('list')} className="p-1 -ml-1 text-gray-400 hover:text-gray-600"><ChevronLeft size={20} /></button>
            <span className="font-semibold text-gray-900 flex-1">Notifications</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <NotificationsPanel
              notifs={taskNotifs}
              onMarkRead={id => markNotifReadMutation.mutate(id)}
              onMarkAllRead={() => markNotifReadMutation.mutate('all')}
            />
          </div>
        </div>
      )}

      {/* ── DESKTOP: Sidebar ── */}
      <div className="hidden md:flex flex-col w-60 border-r border-gray-100 flex-shrink-0 bg-gray-50/60">
        <RoomSidebar
          activeRoom={activeRoom}
          myId={myId}
          otherProfiles={otherProfiles}
          allProfiles={allProfiles}
          unread={unread}
          mentionsByRoom={mentionsByRoom}
          onSelect={(room) => { handleDesktopSelect(room); setActiveView('chat'); }}
          visibleRooms={visibleRooms}
          roomMembers={roomMembers}
          chatGroups={chatGroups}
          onCreateGroup={() => setShowGroupModal(true)}
          isAdmin={isAdmin}
          onCreateChannel={() => setShowChannelModal(true)}
          activeView={activeView}
          onViewNotifications={() => setActiveView('notifications')}
          unreadNotifCount={unreadNotifCount}
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
        {activeView === 'notifications' ? (
          <NotificationsPanel
            notifs={notifs}
            onMarkRead={id => markNotifReadMutation.mutate(id)}
            onMarkAllRead={() => markNotifReadMutation.mutate('all')}
          />
        ) : (
          <>
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
                  <button
                    onClick={() => setShowCanvasPanel(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                  >
                    <KeyRound size={14} />
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
            <ChatMessages messages={messages} isLoading={isLoading} myId={myId} messagesEndRef={messagesEndRef} reactions={reactions} editingId={editingId} editingText={editingText} onStartEdit={handleStartEdit} onTextChange={setEditingText} onSave={handleSaveEdit} onCancel={handleCancelEdit} onReply={setReplyingTo} onReact={handleReact} onLongPress={setLongPressMsg} allProfiles={allProfiles} />
            <ChatInput {...sharedInputProps} />
          </>
        )}
      </div>

    </div>

    {/* ── Toast notification ── */}
    {toast && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-start gap-3 bg-gray-900 text-white px-4 py-3 rounded-2xl shadow-xl max-w-sm w-[90vw]">
        <div className="w-2 h-2 rounded-full bg-[#4CAF50] mt-1.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug">{toast.title}</p>
          <p className="text-xs text-gray-400 mt-0.5 leading-snug">{toast.body}</p>
        </div>
        <button onClick={() => setToast(null)} className="text-gray-500 hover:text-gray-300 flex-shrink-0 mt-0.5">
          <X size={14} />
        </button>
      </div>
    )}
    </>
  );
}
