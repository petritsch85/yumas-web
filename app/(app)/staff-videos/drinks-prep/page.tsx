'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { ChevronLeft, Upload, Trash2, X } from 'lucide-react';

const CATEGORY = 'drinks-prep';

type VideoRow = { id: string; title: string; storage_path: string; created_at: string };

export default function DrinksPrepPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const { data: videos, isLoading } = useQuery({
    queryKey: ['staff-videos', CATEGORY],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_videos')
        .select('id, title, storage_path, created_at')
        .eq('category', CATEGORY)
        .order('created_at', { ascending: false });
      return (data ?? []) as VideoRow[];
    },
  });

  const getPublicUrl = (path: string) =>
    supabase.storage.from('staff-videos').getPublicUrl(path).data.publicUrl;

  const handleUpload = async () => {
    if (!file || !title.trim()) { setError('Please add a title and select a file.'); return; }
    setUploading(true);
    setError('');
    try {
      const ext = file.name.split('.').pop();
      const path = `${CATEGORY}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('staff-videos')
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('staff_videos')
        .insert({ title: title.trim(), category: CATEGORY, storage_path: path });
      if (dbError) throw dbError;

      queryClient.invalidateQueries({ queryKey: ['staff-videos', CATEGORY] });
      setShowUpload(false);
      setTitle('');
      setFile(null);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (video: VideoRow) => {
    if (!window.confirm(`Delete "${video.title}"?`)) return;
    await supabase.storage.from('staff-videos').remove([video.storage_path]);
    await supabase.from('staff_videos').delete().eq('id', video.id);
    queryClient.invalidateQueries({ queryKey: ['staff-videos', CATEGORY] });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft size={16} />
            Back
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <h1 className="text-2xl font-bold text-gray-900">Drinks Prep</h1>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors"
        >
          <Upload size={15} />
          Upload Video
        </button>
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Upload Video</h2>
              <button onClick={() => { setShowUpload(false); setError(''); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Margarita Prep"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Video file</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-[#1B5E20] transition-colors"
                >
                  {file ? (
                    <p className="text-sm text-gray-700 font-medium">{file.name}</p>
                  ) : (
                    <>
                      <Upload size={24} className="mx-auto text-gray-300 mb-2" />
                      <p className="text-sm text-gray-500">Click to select a video file</p>
                      <p className="text-xs text-gray-400 mt-1">.mp4, .mov supported</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                onClick={handleUpload}
                disabled={uploading}
                className="w-full bg-[#1B5E20] text-white py-2.5 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video list */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => <div key={i} className="aspect-video bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : !videos || videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Upload size={40} className="text-gray-200" />
          <p className="text-gray-500 font-medium">No videos yet</p>
          <p className="text-sm text-gray-400">Click "Upload Video" to add the first one</p>
        </div>
      ) : (
        <div className="space-y-6 max-w-2xl">
          {videos.map((video) => (
            <div key={video.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
              <video
                src={getPublicUrl(video.storage_path)}
                controls
                className="w-full aspect-video bg-black"
              />
              <div className="px-4 py-3 flex items-center justify-between">
                <p className="font-medium text-gray-900">{video.title}</p>
                <button
                  onClick={() => handleDelete(video)}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
