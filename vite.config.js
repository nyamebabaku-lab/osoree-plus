import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;

// VITE_TARGET=app builds for the phone apps: no service worker, every file ships inside the app.
const APP = process.env.VITE_TARGET === 'app';

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    react(),
    VitePWA({
      disable: APP,
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'display.html', 'fonts/*'],
      manifest: {
        id: 'osoree-plus',
        name: 'Ɔsɔreɛ Plus',
        short_name: 'Ɔsɔreɛ Plus',
        description: 'Project Bible verses from your phone to any screen, with or without internet',
        theme_color: '#0e0f13',
        background_color: '#0e0f13',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Bible files are large: keep each one for offline use the first time it is opened.
        runtimeCaching: [{ urlPattern: /\/bibles\/.*\.json$/, handler: 'CacheFirst', options: { cacheName: 'bibles' } }],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { outDir: APP ? 'dist-app' : 'dist', chunkSizeWarningLimit: 1500 },
});
