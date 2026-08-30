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
      workbox: {
        // Only cache static assets (JS/CSS/images), NOT the HTML. This ensures
        // the browser always fetches a fresh index.html on navigation, which
        // references the latest hashed JS/CSS bundles. Without this, Samsung
        // browsers can get stuck serving a stale cached index.html that
        // references bundles that no longer exist → blank page.
        globPatterns: ['**/*.{js,css,ico,png,jpg,svg}'],
        // Don't use navigateFallback — this was the main cause of the Samsung
        // blank-page issue. It served a cached index.html for ALL navigations,
        // which meant new deploys never reached the user until the SW decided
        // to update (which Samsung browsers delay aggressively).
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Cache the API GET requests for offline read (NetworkFirst with a
            // 10s timeout so a slow network falls back to the cached response
            // instead of hanging the UI).
            urlPattern: /\/api\/v1\//i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
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
