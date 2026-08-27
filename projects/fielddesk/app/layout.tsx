import type { Metadata } from 'next';
import './globals.css';
import './refinements.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'FieldDesk — управление сервисными заявками',
  description: 'Компактная CRM для диспетчера выездной сервисной команды.',
  openGraph: {
    title: 'FieldDesk — заявки под контролем',
    description: 'Рабочая CRM для диспетчера выездной сервисной команды.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FieldDesk — заявки под контролем',
    description: 'Рабочая CRM для диспетчера выездной сервисной команды.',
    images: ['/og.png'],
  },
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
