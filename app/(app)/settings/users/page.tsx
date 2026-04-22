'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Plus, Pencil, X, Eye, EyeOff } from 'lucide-react';

type Location = { id: string; name: string };

type UserRow = {
  id: string;
  full_name: string;
  role: string;
  location_id: string | null;
  is_active: boolean;
  location?: { name: string } | null;
};

type AddDraft = {
  fullName: string;
  email: string;
  password: string;
  role: string;
  locationId: string;
};

type EditDraft = {
  role: string;
  locationId: string;
  isActive: boolean;
};

const ROLES = ['staff', 'manager', 'admin'];

const roleColor: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  staff: 'bg-gray-100 text-gray-600',
};

const roleHint: Record<string, string> = {
  staff:   'App only — inventory forms',
  manager: 'App + web, assigned location',
  admin:   'Full access, all locations',
};

export default function TeamPage() {
  const qc = useQueryClient();

  // Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>({
    fullName: '', email: '', password: '', role: 'staff', locationId: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [addError, setAddError] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    role: 'staff', locationId: '', isActive: true,
  });

  // Queries
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

  // Create mutation
  const createUser = useMutation({
    mutationFn: async (draft: AddDraft) => {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: draft.fullName,
          email: draft.email,
          password: draft.password,
          role: draft.role,
          locationId: draft.locationId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create account');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-users'] });
      setShowAdd(false);
      setAddDraft({ fullName: '', email: '', password: '', role: 'staff', locationId: '' });
      setAddError('');
      setShowPassword(false);
    },
    onError: (e: any) => setAddError(e.message),
  });

  // Update mutation
  const updateUser = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: EditDraft }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: draft.role,
          locationId: draft.locationId || null,
          isActive: draft.isActive,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to update');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-users'] });
      setEditingId(null);
    },
  });

  const startEdit = (user: UserRow) => {
    setEditingId(user.id);
    setEditDraft({
      role: user.role,
      locationId: user.location_id ?? '',
      isActive: user.is_active,
    });
  };

  const canCreate =
    !!addDraft.fullName.trim() &&
    !!addDraft.email.trim() &&
    addDraft.password.length >= 6;

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

      {/* Add panel */}
      {showAdd && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">New Team Member</h2>
            <button
              onClick={() => { setShowAdd(false); setAddError(''); }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Full name */}
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

            {/* Email */}
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

            {/* Password */}
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
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Role */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Role *</label>
              <select
                value={addDraft.role}
                onChange={e => setAddDraft(d => ({ ...d, role: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)} — {roleHint[r]}
                  </option>
                ))}
              </select>
            </div>

            {/* Location */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
              <select
                value={addDraft.locationId}
                onChange={e => setAddDraft(d => ({ ...d, locationId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
              >
                <option value="">All locations (for admin)</option>
                {locations?.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          {addError && (
            <p className="text-red-500 text-xs mt-3 font-medium">{addError}</p>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => { setShowAdd(false); setAddError(''); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={() => createUser.mutate(addDraft)}
              disabled={createUser.isPending || !canCreate}
              className="bg-[#1B5E20] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createUser.isPending ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
              ))}
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <React.Fragment key={user.id}>
                    {/* Main row */}
                    <tr className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{user.full_name}</td>
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
                        <button
                          onClick={() => editingId === user.id ? setEditingId(null) : startEdit(user)}
                          className={`transition-colors ${editingId === user.id ? 'text-indigo-500' : 'text-gray-300 hover:text-indigo-500'}`}
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>

                    {/* Inline edit row */}
                    {editingId === user.id && (
                      <tr className="border-t border-indigo-100 bg-indigo-50/30">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="grid grid-cols-4 gap-3 items-end">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                              <select
                                value={editDraft.role}
                                onChange={e => setEditDraft(d => ({ ...d, role: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              >
                                {ROLES.map(r => (
                                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                                ))}
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
                                {locations?.map(l => (
                                  <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
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
                            <div className="flex gap-2">
                              <button
                                onClick={() => updateUser.mutate({ id: user.id, draft: editDraft })}
                                disabled={updateUser.isPending}
                                className="flex-1 bg-indigo-600 text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                              >
                                {updateUser.isPending ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
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
