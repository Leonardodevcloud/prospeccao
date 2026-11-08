import { defineConfig } from 'tsup';

// Empacota o código dos pacotes do monorepo (@prospeccao/*) dentro do serviço;
// as dependências de terceiros continuam em node_modules.
export default defineConfig({
  entry: ['src/main.ts', 'src/migrar.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@prospeccao\//],
  // Módulo nativo (o menu de voz das ligações): fica em node_modules, não dá para empacotar.
  external: ['@livekit/rtc-node'],
});
