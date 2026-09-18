import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Only the real vite-plugin-pwa provides this virtual module (dev/build); stub it for tests.
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwaRegisterStub.ts', import.meta.url)
      ),
    },
  },
  define: {
    __BUILD_DATE__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
