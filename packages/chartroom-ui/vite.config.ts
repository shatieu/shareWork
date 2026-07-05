import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** First port `chartroom serve` tries by default (packages/chartroom/src/commands/serve.ts) --
 * mirrored here only as the dev-mode proxy target, not a shared runtime constant (this package
 * never imports from `chartroom`, plan §1.6/§2). Override with CHARTROOM_DAEMON_PORT if the
 * daemon you're developing against is running on a different port. */
const DEFAULT_DAEMON_PORT = 4317;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.CHARTROOM_DAEMON_PORT ?? DEFAULT_DAEMON_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
