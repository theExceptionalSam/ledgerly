import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

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
