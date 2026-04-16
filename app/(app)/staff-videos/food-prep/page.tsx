'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

const VIDEOS = [
  { id: 'pk8HjKC7pfM', title: 'Test' },
  // Add more videos here: { id: 'YOUTUBE_ID', title: 'Video Title' }
];

export default function FoodPrepPage() {
  const router = useRouter();

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="text-2xl font-bold text-gray-900">Food Prep</h1>
      </div>

      <div className="space-y-6 max-w-2xl">
        {VIDEOS.map((video) => (
          <div key={video.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="aspect-video w-full">
              <iframe
                src={`https://www.youtube.com/embed/${video.id}`}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
            <div className="px-4 py-3">
              <p className="font-medium text-gray-900">{video.title}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
