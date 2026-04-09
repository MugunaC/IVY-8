import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    // React and Tailwind plugins are both required.
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    // Allow access from Cloudflared quick tunnels or other remote hosts.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/metrics': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/ws/control': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
      },
      '/ws/telemetry': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
        changeOrigin: true,
      },
      '/ws/device': {
        target: 'ws://127.0.0.1:4000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('maplibre-gl')) return 'maplibre';
            if (id.includes('lucide-react')) return 'icons';
            return undefined;
          }
        },
      },
    },
    chunkSizeWarningLimit: 1100,
  },
  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
});
