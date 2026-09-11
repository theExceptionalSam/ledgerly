import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// Offline / online detection — toggles a `app-offline` class on <body> so the
// CSS banner (see styles.css `.app-offline::before`) shows when the user loses
// connectivity. We don't redirect to a fallback page (the existing VitePWA
// workbox config keeps `navigateFallback: null` on purpose to avoid Samsung
// blank-page issues), so the user stays on whatever route they were on and
// just sees the banner until connectivity returns. API calls in flight will
// surface their own error messages; this banner is the global indicator.
if (typeof window !== 'undefined' && 'onoffline' in window) {
  window.addEventListener('offline', () => {
    document.body.classList.add('app-offline');
  });
  window.addEventListener('online', () => {
    document.body.classList.remove('app-offline');
  });
  // Set the initial state — if the tab is loaded while already offline
  // (e.g. PWA launched from cache with no network), show the banner now.
  if (!navigator.onLine) {
    document.body.classList.add('app-offline');
  }
}

// Aggressively clean up old/stale service workers before registering the new
// one. This is critical for Samsung browsers which hold onto stale SWs and
// can cause "failed to fetch" errors on API requests when the old SW's routing
// rules don't match the new deployment.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      // Unregister ALL existing service workers, then register the fresh one.
      // This forces the browser to pick up the new SW immediately instead of
      // waiting for the old one to "update" (which Samsung browsers delay).
      const unregisters = registrations.map((reg) => reg.unregister());
      Promise.all(unregisters).then(() => {
        // Clear all caches left over from the old SW
        if ('caches' in window) {
          caches.keys().then((names) => {
            names.forEach((name) => caches.delete(name));
          });
        }
        // Register the fresh service worker
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
          // SW registration failed — not fatal, the app works without it
        });
      });
    }).catch(() => {
      // getRegistrations failed — try registering anyway
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
