import type { Metadata } from 'next';
import './globals.css';
import './refinements.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3090'),
  title: 'Booking Desk — рабочая запись',
  description: 'Календарь записи с конфликтами, переносом и мобильным сценарием.',
  openGraph: { title: 'Booking Desk', description: 'Запись без конфликтов', images: ['/og.png'] },
  twitter: { card: 'summary_large_image', title: 'Booking Desk', description: 'Запись без конфликтов', images: ['/og.png'] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
