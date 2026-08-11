import type { Metadata } from 'next';
import { AuthProvider } from '@/components/auth/auth-provider';
import './globals.css';
import './theme-hardening.css';
import './management-intelligence.css';
import './management-operations.css';
import './system-governance.css';
import './revenue-cycle.css';
import './field-assets.css';
import './persistence-security.css';
import './shell-productivity.css';
import './auth.css';

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

const legacyCacheCleanup = `
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.getRegistrations()
      .then(function (registrations) {
        return Promise.all(registrations.map(function (registration) { return registration.unregister(); }));
      })
      .then(function () {
        if (!('caches' in window)) return;
        return caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (key) { return caches.delete(key); }));
        });
      })
      .catch(function () {});
  });
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: legacyCacheCleanup }} />
      </head>
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
