import { defineConfig } from 'tsup';

// Empacota o código dos pacotes do monorepo (@prospeccao/*) dentro do serviço;
// as dependências de terceiros continuam em node_modules.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@prospeccao\//],
});
