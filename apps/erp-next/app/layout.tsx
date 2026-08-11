import type { Metadata } from 'next';
import './globals.css';
import './theme-hardening.css';

export const metadata: Metadata = {
  title: 'DEMAC ERP Next',
  description: 'DEMAC Professional Cooling Solutions operating system',
};

const themeBootstrap = `
(function () {
  try {
    var saved = localStorage.getItem('demac-theme');
    var theme = saved === 'dark' || saved === 'light'
      ? saved
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = 'light';
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
