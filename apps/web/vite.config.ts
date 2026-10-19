import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Em desenvolvimento, /api vai para a API local (mesma origem, como em produção
// pelo rewrite do Vercel): o cookie de sessão SameSite=Strict funciona igual.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
  build: { sourcemap: true },
});
