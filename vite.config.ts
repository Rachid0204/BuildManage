import { bundleAudit } from './scripts/bundleAudit';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), bundleAudit()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'vendor';
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@tanstack)\//.test(id)) return 'vendor';
          if (/node_modules\/(@firebase|firebase)\//.test(id) && !/\/(firestore|functions|storage)/.test(id)) return 'firebase';
          if (id.includes('/node_modules/jspdf/')) return 'pdf';
          if (id.includes('/node_modules/recharts/')) return 'charts';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
