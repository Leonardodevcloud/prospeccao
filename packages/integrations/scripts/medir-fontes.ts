/**
 * Mede a largura de cada letra das fontes dos carrosséis (em "em": fração do tamanho da fonte) e
 * grava a tabela em packages/shared/src/carrosseisMetricas.gerada.ts. A tabela é o que deixa o
 * texto de cada slide no tamanho certo (sem estourar a caixa) igual no servidor e no navegador.
 *
 * Rodar de novo só se mudar a versão dos pacotes @fontsource ou a lista de fontes:
 *   pnpm --filter @prospeccao/integrations medir-fontes
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import {
  arquivoDaFonte,
  CARACTERES_MEDIDOS,
  chaveFonte,
  FONTES_SLIDES,
} from '../../shared/src/carrosseisFontes.js';

const exigir = createRequire(import.meta.url);
const TAM = 200;
const REPETE = 20;

async function largura(
  texto: string,
  familia: string,
  peso: number,
  fontes: Parameters<typeof satori>[1]['fonts'],
) {
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: { display: 'flex', fontFamily: familia, fontWeight: peso, fontSize: TAM, whiteSpace: 'pre' },
        children: texto,
      },
    },
    { width: 60_000, height: 400, fonts: fontes },
  );
  const caixa = new Resvg(svg).getBBox();
  return caixa ? caixa.width : 0;
}

const tabela: Record<string, Record<string, number>> = {};
for (const f of FONTES_SLIDES) {
  const fontes = [
    {
      name: f.familia,
      data: readFileSync(exigir.resolve(arquivoDaFonte(f))),
      weight: f.peso as 400,
      style: 'normal' as const,
    },
  ];
  const base = await largura('HH', f.familia, f.peso, fontes);
  const medidas: Record<string, number> = {};
  for (const c of CARACTERES_MEDIDOS) {
    const w = await largura(`H${c.repeat(REPETE)}H`, f.familia, f.peso, fontes);
    medidas[c] = Math.max(0, Math.round(((w - base) / REPETE / TAM) * 1000) / 1000);
  }
  tabela[chaveFonte(f.familia, f.peso)] = medidas;
  console.log(chaveFonte(f.familia, f.peso), 'a', medidas.a, 'M', medidas.M, 'espaço', medidas[' ']);
}

const saida = new URL('../../shared/src/carrosseisMetricas.gerada.ts', import.meta.url);
writeFileSync(
  saida,
  `// Gerado por packages/integrations/scripts/medir-fontes.ts: não editar à mão.\n// Largura de cada letra em "em" (fração do tamanho da fonte), medida no mesmo motor que desenha os slides.\nexport const METRICAS_FONTES: Record<string, Record<string, number>> = ${JSON.stringify(tabela, null, 1)};\n`,
);
console.log('gravado em', saida.pathname);
