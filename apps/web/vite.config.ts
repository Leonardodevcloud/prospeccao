import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * O corretor ortográfico (hunspell-asm) e o carregador dele importam módulos CommonJS (o nanoid 2
 * e o runtime do Hunspell) como namespace e os chamam como função, o que quebra no bundle e no
 * modo de desenvolvimento. Troca por import padrão.
 */
const NAMESPACE_CHAMADO = /import \* as (\w+) from '(nanoid|\.\/lib\/node\/hunspell)'/g;
const nanoidPadrao = (): Plugin => ({
  name: 'hunspell-imports',
  transform(codigo, id) {
    if (!/(hunspell-asm|emscripten-wasm-loader)/.test(id) || !NAMESPACE_CHAMADO.test(codigo)) return null;
    NAMESPACE_CHAMADO.lastIndex = 0;
    return { code: codigo.replace(NAMESPACE_CHAMADO, "import $1 from '$2'"), map: null };
  },
});

// Em desenvolvimento, /api vai para a API local (mesma origem, como em produção
// pelo rewrite do Vercel): o cookie de sessão SameSite=Strict funciona igual.
export default defineConfig({
  plugins: [react(), nanoidPadrao()],
  worker: { format: 'es', plugins: () => [nanoidPadrao()] },
  optimizeDeps: { rolldownOptions: { plugins: [nanoidPadrao()] } },
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
