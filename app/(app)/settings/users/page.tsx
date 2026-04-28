'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Plus, Pencil, X, Eye, EyeOff, Trash2, CheckSquare, Square } from 'lucide-react';

type Location = { id: string; name: string };

/* ─── Permissions ────────────────────────────────────────────────────────── */
type AppPermissions = {
  // Web section access (booleans)
  inventory:    boolean;
  production:   boolean;
  buying:       boolean;
  waste_log:    boolean;
  delivery:     boolean;
  analysis:     boolean;
  events:       boolean;
  staff_videos: boolean;
  bills:        boolean;
  pl_reports:   boolean;
  suppliers:    boolean;
  products:     boolean;
};

type PermKey = keyof AppPermissions;

type ModuleItem = { key: PermKey; label: string; description?: string };
type ModuleGroup = { group: string; items: ModuleItem[] };

const MODULE_GROUPS: ModuleGroup[] = [
  {
    group: 'Supply Chain',
    items: [
      { key: 'inventory',  label: 'Inventory',       description: 'Add counts, view stock levels, reports' },
      { key: 'production', label: 'Production',      description: 'Batches & recipes' },
      { key: 'buying',     label: 'Purchase Orders', description: 'Create & view orders' },
      { key: 'waste_log',  label: 'Waste Log',       description: 'Log waste entries' },
      { key: 'delivery',   label: 'Delivery',        description: 'Runs, target levels, sales forecast' },
      { key: 'analysis',   label: 'Analysis',        description: 'COGS & Store Yield' },
    ],
  },
  {
    group: 'Events',
    items: [
      { key: 'events', label: 'Events', description: 'View & manage events' },
    ],
  },
  {
    group: 'In Store',
    items: [
      { key: 'staff_videos', label: 'Staff Videos', description: 'Food & drinks prep videos' },
    ],
  },
  {
    group: 'Data',
    items: [
      { key: 'suppliers', label: 'Suppliers', description: 'Supplier list & details' },
      { key: 'products',  label: 'Products / Menus', description: 'Raw materials, semi-finished, finished' },
    ],
  },
  {
    group: 'Reports',
    items: [
      { key: 'pl_reports', label: 'P&L Reports', description: 'Sales reports & monthly P&L' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { key: 'bills', label: 'Bills', description: 'Upload & review supplier invoices' },
    ],
  },
];

const STAFF_DEFAULTS: AppPermissions = {
  inventory: true, production: false, buying: false, waste_log: true,
  delivery: false, analysis: false, events: false, staff_videos: true,
  bills: false, pl_reports: false, suppliers: false, products: false,
};

const MANAGER_DEFAULTS: AppPermissions = {
  inventory: true, production: true, buying: true, waste_log: true,
  delivery: true, analysis: true, events: true, staff_videos: true,
  bills: false, pl_reports: true, suppliers: true, products: true,
};

const ADMIN_DEFAULTS: AppPermissions = {
  inventory: true, production: true, buying: true, waste_log: true,
  delivery: true, analysis: true, events: true, staff_videos: true,
  bills: true, pl_reports: true, suppliers: true, products: true,
};

function defaultsForRole(role: string): AppPermissions {
  if (role === 'admin')   return { ...ADMIN_DEFAULTS };
  if (role === 'manager') return { ...MANAGER_DEFAULTS };
  return { ...STAFF_DEFAULTS };
}

function mergePermissions(raw?: Partial<AppPermissions>): AppPermissions {
  return { ...STAFF_DEFAULTS, ...(raw ?? {}) };
}

/* ─── Types ──────────────────────────────────────────────────────────────── */
type UserRow = {
  id: string;
  full_name: string;
  role: string;
  location_id: string | null;
  is_active: boolean;
  permissions?: Partial<AppPermissions>;
  location?: { name: string } | null;
};

type AddDraft = {
  fullName: string; email: string; password: string;
  role: string; locationId: string;
};

type EditDraft = {
  role: string; locationId: string; isActive: boolean;
  permissions: AppPermissions; newPassword: string; newEmail: string;
};

const ROLES = ['staff', 'manager', 'admin'];

const roleColor: Record<string, string> = {
  admin:   'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  staff:   'bg-gray-100 text-gray-600',
};
const roleHint: Record<string, string> = {
  staff:   'Inventory forms only',
  manager: 'Operational access, assigned location',
  admin:   'Full access, all locations',
};

/* ─── Permissions editor ─────────────────────────────────────────────────── */
function PermissionsEditor({
  perms,
  onChange,
  isAdmin,
}: {
  perms: AppPermissions;
  onChange: (p: AppPermissions) => void;
  isAdmin?: boolean;
}) {
  if (isAdmin) {
    return (
      <div className="mt-4 pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400 italic">Admins have access to everything — no restrictions apply.</p>
      </div>
    );
  }

  const toggle = (key: PermKey) => onChange({ ...perms, [key]: !perms[key] });

  const groupAllOn  = (group: ModuleGroup) => {
    const patch = Object.fromEntries(group.items.map(i => [i.key, true])) as Partial<AppPermissions>;
    onChange({ ...perms, ...patch });
  };
  const groupAllOff = (group: ModuleGroup) => {
    const patch = Object.fromEntries(group.items.map(i => [i.key, false])) as Partial<AppPermissions>;
    onChange({ ...perms, ...patch });
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Section Access</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onChange(Object.fromEntries(MODULE_GROUPS.flatMap(g => g.items).map(i => [i.key, true])) as AppPermissions)}
            className="text-xs text-indigo-600 hover:underline font-medium"
          >
            Enable all
          </button>
          <button
            type="button"
            onClick={() => onChange(Object.fromEntries(MODULE_GROUPS.flatMap(g => g.items).map(i => [i.key, false])) as AppPermissions)}
            className="text-xs text-gray-400 hover:underline"
          >
            Clear all
          </button>
        </div>
      </div>

      {MODULE_GROUPS.map((group) => {
        const allOn = group.items.every(i => perms[i.key]);
        return (
          <div key={group.group}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{group.group}</p>
              <button
                type="button"
                onClick={() => allOn ? groupAllOff(group) : groupAllOn(group)}
                className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
              >
                {allOn ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {group.items.map(({ key, label, description }) => {
                const checked = !!perms[key];
                return (
                  <label
                    key={key}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all select-none ${
                      checked
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-900'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggle(key)}
                    />
                    {checked
                      ? <CheckSquare size={15} className="text-indigo-600 flex-shrink-0 mt-0.5" />
                      : <Square size={15} className="text-gray-300 flex-shrink-0 mt-0.5" />
                    }
                    <div>
                      <div className={`text-xs font-semibold ${checked ? 'text-indigo-800' : 'text-gray-700'}`}>{label}</div>
                      {description && <div className="text-xs text-gray-400 mt-0.5 leading-tight">{description}</div>}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
export default function TeamPage() {
  const qc = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>({
    fullName: '', email: '', password: 'Yumas2026!', role: 'staff', locationId: '',
  });
  const [addPerms, setAddPerms] = useState<AppPermissions>(defaultsForRole('staff'));
  const [showPassword, setShowPassword] = useState(false);
  const [addError, setAddError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    role: 'staff', locationId: '', isActive: true,
    permissions: { ...STAFF_DEFAULTS }, newPassword: '', newEmail: '',
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ['team-users'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*, location:locations(name)')
        .order('full_name');
      return (data ?? []) as UserRow[];
    },
  });

  const { data: emailMap } = useQuery({
    queryKey: ['team-emails'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users');
      if (!res.ok) return {} as Record<string, string>;
      return res.json() as Promise<Record<string, string>>;
    },
  });

  const { data: locations } = useQuery({
    queryKey: ['locations-active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      return (data ?? []) as Location[];
    },
  });

  const createUser = useMutation({
    mutationFn: async ({ draft, perms }: { draft: AddDraft; perms: AppPermissions }) => {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName:    draft.fullName,
          email:       draft.email,
          password:    draft.password,
          role:        draft.role,
          locationId:  draft.locationId || null,
          permissions: draft.role !== 'admin' ? perms : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create account');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-users'] });
      qc.invalidateQueries({ queryKey: ['team-emails'] });
      setShowAdd(false);
      setAddDraft({ fullName: '', email: '', password: 'Yumas2026!', role: 'staff', locationId: '' });
      setAddPerms(defaultsForRole('staff'));
      setAddError('');
      setShowPassword(false);
    },
    onError: (e: any) => setAddError(e.message),
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: EditDraft }) => {
      const body: Record<string, any> = {
        role:       draft.role,
        locationId: draft.locationId || null,
        isActive:   draft.isActive,
      };
      if (draft.role !== 'admin') body.permissions = draft.permissions;
      if (draft.newPassword.trim()) body.newPassword = draft.newPassword.trim();
      if (draft.newEmail.trim()) body.newEmail = draft.newEmail.trim();

      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to update');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-users'] });
      qc.invalidateQueries({ queryKey: ['team-emails'] });
      setEditingId(null);
    },
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to delete');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-users'] });
      qc.invalidateQueries({ queryKey: ['team-emails'] });
      setConfirmDeleteId(null);
      setEditingId(null);
    },
  });

  const startEdit = (user: UserRow) => {
    setEditingId(user.id);
    setEditDraft({
      role:        user.role,
      locationId:  user.location_id ?? '',
      isActive:    user.is_active,
      permissions: mergePermissions(user.permissions),
      newPassword: '',
      newEmail:    emailMap?.[user.id] ?? '',
    });
  };

  const canCreate = !!addDraft.fullName.trim() && !!addDraft.email.trim() && addDraft.password.length >= 6;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create accounts and control access levels</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddError(''); }}
          className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          Add Team Member
        </button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {ROLES.map(r => (
          <div key={r} className="bg-white border border-gray-100 rounded-lg px-4 py-3 flex items-start gap-3">
            <span className={`mt-0.5 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${roleColor[r]}`}>
              {r}
            </span>
            <p className="text-xs text-gray-500">{roleHint[r]}</p>
          </div>
        ))}
      </div>

      {/* ── Add panel ── */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">New Team Member</h2>
            <button onClick={() => { setShowAdd(false); setAddError(''); }} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Full name *</label>
              <input
                type="text"
                value={addDraft.fullName}
                onChange={e => setAddDraft(d => ({ ...d, fullName: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                placeholder="e.g. Maria García"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email *</label>
              <input
                type="email"
                value={addDraft.email}
                onChange={e => setAddDraft(d => ({ ...d, email: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                placeholder="maria@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Password * (min 6 chars)</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={addDraft.password}
                  onChange={e => setAddDraft(d => ({ ...d, password: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                  placeholder="Min 6 characters"
                />
                <button type="button" onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Role *</label>
              <select
                value={addDraft.role}
                onChange={e => {
                  const role = e.target.value;
                  setAddDraft(d => ({ ...d, role }));
                  setAddPerms(defaultsForRole(role));
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)} — {roleHint[r]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
              <select
                value={addDraft.locationId}
                onChange={e => setAddDraft(d => ({ ...d, locationId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
              >
                <option value="">All locations (for admin)</option>
                {locations?.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          {/* Permissions for staff + manager */}
          <PermissionsEditor
            perms={addPerms}
            onChange={setAddPerms}
            isAdmin={addDraft.role === 'admin'}
          />

          {addError && <p className="text-red-500 text-xs mt-3 font-medium">{addError}</p>}

          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => { setShowAdd(false); setAddError(''); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              onClick={() => createUser.mutate({ draft: addDraft, perms: addPerms })}
              disabled={createUser.isPending || !canCreate}
              className="bg-[#1B5E20] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createUser.isPending ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (() => {
        const target = users?.find(u => u.id === confirmDeleteId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Delete account?</h3>
              <p className="text-sm text-gray-500 mb-5">
                <span className="font-medium text-gray-700">{target?.full_name ?? 'This user'}</span>'s
                account will be permanently deleted. This cannot be undone.
              </p>
              {deleteUser.error && <p className="text-red-500 text-xs mb-3">{(deleteUser.error as any).message}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setConfirmDeleteId(null); deleteUser.reset(); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                <button
                  onClick={() => deleteUser.mutate(confirmDeleteId)}
                  disabled={deleteUser.isPending}
                  className="bg-red-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteUser.isPending ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Users table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : !users || users.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-gray-400 text-sm">No team members yet — add your first one above.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <React.Fragment key={user.id}>
                    <tr className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{user.full_name}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                        {emailMap?.[user.id] ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${roleColor[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {(user as any).location?.name ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => editingId === user.id ? setEditingId(null) : startEdit(user)}
                            className={`transition-colors ${editingId === user.id ? 'text-indigo-500' : 'text-gray-300 hover:text-indigo-500'}`}
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setConfirmDeleteId(user.id)}
                            className="text-gray-300 hover:text-red-500 transition-colors" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline edit row */}
                    {editingId === user.id && (
                      <tr className="border-t-4 border-indigo-400">
                        <td colSpan={6} className="p-0 bg-indigo-50">
                          {/* Edit panel header */}
                          <div className="flex items-center justify-between px-5 py-3 bg-indigo-600">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                {user.full_name.charAt(0)}
                              </div>
                              <span className="text-white text-sm font-semibold">Editing: {user.full_name}</span>
                            </div>
                            <button onClick={() => setEditingId(null)} className="text-white/70 hover:text-white transition-colors">
                              <X size={15} />
                            </button>
                          </div>
                          <div className="px-5 py-4">
                          {/* Basic fields */}
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end mb-3">
                            <div className="col-span-2 md:col-span-1">
                              <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                              <input
                                type="email"
                                value={editDraft.newEmail}
                                onChange={e => setEditDraft(d => ({ ...d, newEmail: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                placeholder="email@example.com"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">
                                New password <span className="text-gray-400 font-normal">(leave blank to keep)</span>
                              </label>
                              <input
                                type="text"
                                value={editDraft.newPassword}
                                onChange={e => setEditDraft(d => ({ ...d, newPassword: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 font-mono"
                                placeholder="min 6 chars"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                              <select
                                value={editDraft.role}
                                onChange={e => {
                                  const role = e.target.value;
                                  setEditDraft(d => ({ ...d, role, permissions: defaultsForRole(role) }));
                                }}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              >
                                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
                              <select
                                value={editDraft.locationId}
                                onChange={e => setEditDraft(d => ({ ...d, locationId: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              >
                                <option value="">All locations</option>
                                {locations?.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                              <select
                                value={editDraft.isActive ? 'active' : 'inactive'}
                                onChange={e => setEditDraft(d => ({ ...d, isActive: e.target.value === 'active' }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            </div>
                          </div>

                          {/* Permissions */}
                          <PermissionsEditor
                            perms={editDraft.permissions}
                            onChange={p => setEditDraft(d => ({ ...d, permissions: p }))}
                            isAdmin={editDraft.role === 'admin'}
                          />

                          <div className="flex gap-2 mt-4">
                            <button
                              onClick={() => updateUser.mutate({ id: user.id, draft: editDraft })}
                              disabled={updateUser.isPending}
                              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            >
                              {updateUser.isPending ? 'Saving…' : 'Save changes'}
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="px-4 py-2 text-xs text-gray-500 hover:text-gray-700">
                              Cancel
                            </button>
                          </div>
                          </div>{/* end content padding div */}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
