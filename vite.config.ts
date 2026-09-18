import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages has no directory-per-repo root, so the base path is injected via
// VITE_BASE at build time (see .github/workflows/deploy.yml). Defaults to '/' for local dev.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // No includeAssets needed: icons/icon.svg already matches the workbox
      // globPatterns below (**/*.svg), so it's precached automatically.
      manifest: {
        name: 'LangTrainer',
        short_name: 'LangTrainer',
        description: 'Daily language-learning sessions, offline-first.',
        start_url: '.',
        display: 'standalone',
        background_color: '#0b1120',
        theme_color: '#6366f1',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
