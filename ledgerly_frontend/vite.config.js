// Polyfill globalThis.crypto for Node.js 18 (used by serialize-javascript via
// @rollup/plugin-terser via vite-plugin-pwa's workbox-build). Node 20+ has
// crypto globally; Node 18 needs this polyfill or the build fails with
// "ReferenceError: crypto is not defined".
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['app-icon.jpg'],
      manifest: false, // we already have public/manifest.json
      // We register the SW manually in src/main.jsx (with aggressive cleanup
      // of old SWs + caches) instead of using VitePWA's auto-injected
      // registerSW.js. The auto-injected script doesn't clean up old SWs,
      // which causes Samsung browsers to hold onto stale SWs that break
      // API requests ("failed to fetch").
      injectRegister: false,
      workbox: {
        // Only cache static assets (JS/CSS/images), NOT the HTML and NOT the
        // API. This ensures:
        // 1. The browser always fetches a fresh index.html on navigation
        //    (references the latest hashed JS/CSS bundles)
        // 2. API requests (login, payments, etc.) are NEVER intercepted by the
        //    service worker — they go straight to the network. This prevents
        //    "failed to fetch" errors on Samsung browsers where the SW can
        //    interfere with POST requests or strip Set-Cookie headers.
        globPatterns: ['**/*.{js,css,ico,png,jpg,svg}'],
        navigateFallback: null,
        // Don't cache the Google Fonts API response either — only cache the
        // actual font files (handled by the browser's HTTP cache automatically).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // NOTE: API caching (/api/v1/) REMOVED — API responses must never be
          // cached. They're dynamic data, and caching them causes stale-data
          // bugs + "failed to fetch" errors on Samsung browsers when the SW
          // interferes with POST requests.
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  build: {
    // Target a wider browser set — includes Samsung Internet 12+ and older
    // Chrome. The default ('modules') can break on browsers that support ES
    // modules but not newer syntax like optional chaining.
    target: 'es2019',
  },
});
