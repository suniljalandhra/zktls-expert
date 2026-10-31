import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'] });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-mono' });

export const metadata = {
  title: 'Prove your GitHub expertise',
  description: 'Verify a GitHub fact with a zkTLS proof and receive an EAS attestation.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.className} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
