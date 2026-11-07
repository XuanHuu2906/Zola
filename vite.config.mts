import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), {
    name: 'development-csp',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => command === 'serve'
        ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace("connect-src 'none'", "connect-src 'self' ws://127.0.0.1:5173")
        : html,
    },
  }],
  base: './', publicDir: 'public',
  optimizeDeps: { entries: ['index.html'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/.glass-demo-data/**', '**/.npm-cache/**', '**/reports/**', '**/playwright-report/**',
      '**/test-results/**', '**/legacy/**', '**/release/**', '**/dist-electron/**'] } },
  build: { outDir: 'dist', emptyOutDir: true },
}));
