import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from '@/components/providers';
import PwaInit from '@/components/PwaInit';

export const metadata: Metadata = {
  title: 'Yumas Inventory',
  description: 'Restaurant inventory management system',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Yumas',
  },
};

export const viewport: Viewport = {
  themeColor: '#1B5E20',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body className="h-full">
        <Providers>{children}</Providers>
        <PwaInit />
      </body>
    </html>
  );
}
