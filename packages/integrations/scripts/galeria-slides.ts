/**
 * Desenha todos os modelos de slide em todos os estilos, com um carrossel de exemplo, numa pasta
 * (para conferir o visual depois de mexer nos modelos):
 *   pnpm --filter @prospeccao/integrations galeria-slides [pasta]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  ESTILOS,
  IDENTIDADE_PADRAO,
  type IdentidadeCarrossel,
  montarSlide,
  type SlideCarrossel,
  slideNovo,
} from '@prospeccao/shared/carrosseis';
import { dataUrl, desenharSlide } from '../src/slides/index.js';

const pasta = process.argv[2] ?? '/tmp/galeria-slides';
// Com uma foto (3º argumento), a capa e o slide de foto usam ela.
const foto = process.argv[3] ? dataUrl(readFileSync(process.argv[3]), 'image/jpeg') : null;
mkdirSync(pasta, { recursive: true });

const s = (modelo: SlideCarrossel['modelo'], campos: Partial<SlideCarrossel>, i: number): SlideCarrossel => ({
  ...slideNovo(modelo, `s${i}`),
  ...campos,
});
const exemplo: SlideCarrossel[] = [
  s(
    'capa',
    {
      sobretitulo: 'Comercial B2B',
      titulo: '5 sinais de que o seu comercial está deixando venda na mesa',
      texto: 'E o que fazer em cada um, antes do fim do mês.',
    },
    1,
  ),
  s(
    'item',
    {
      destaque: '1',
      titulo: 'O lead espera mais de um dia pela primeira resposta',
      texto:
        'Quem pediu orçamento ontem já falou com outro fornecedor hoje. A primeira resposta precisa sair no mesmo dia.',
    },
    2,
  ),
  s(
    'texto',
    {
      sobretitulo: 'Sinal 2',
      titulo: 'Ninguém sabe quem é o dono de cada lead',
      texto:
        'Quando todo mundo pode responder, ninguém responde. Cada lead precisa de um nome do lado, com o próximo passo marcado.',
    },
    3,
  ),
  s(
    'citacao',
    {
      titulo: 'Quem responde primeiro costuma levar a conversa.',
      texto: 'Por isso o tempo de resposta vem antes de qualquer script.',
    },
    4,
  ),
  s(
    'lista',
    {
      sobretitulo: 'E mais três',
      titulo: 'Os outros sinais que aparecem junto',
      itens: [
        'O follow-up depende da memória do vendedor',
        'A lista de prospecção acabou e ninguém sabe onde achar mais',
        'O gestor só descobre a venda perdida no fim do mês',
      ],
    },
    5,
  ),
  s(
    'numero',
    {
      destaque: 'R$ 139,90',
      titulo: 'Pastilha cerâmica dianteira, com instalação grátis',
      texto: 'Na compra do par, até 30/11. Enquanto durar o estoque.',
    },
    6,
  ),
  s(
    'comparacao',
    {
      titulo: 'Follow-up de memória',
      colunas: [
        { rotulo: 'Hoje', texto: 'O vendedor lembra de retornar quando dá tempo.' },
        { rotulo: 'O certo', texto: 'O próximo passo já fica marcado, com dia e hora.' },
      ],
    },
    7,
  ),
  s('foto', { titulo: 'Lead sem dono', texto: 'Quando todo mundo pode responder, ninguém responde.' }, 8),
  s(
    'chamada',
    {
      titulo: 'Quer o checklist com o que fazer em cada sinal?',
      botao: 'Comente CHECKLIST',
      texto: 'A gente te manda no direct.',
    },
    9,
  ),
];
const identidade: IdentidadeCarrossel = {
  ...IDENTIDADE_PADRAO,
  assinatura: '@nexosistemas',
  marcaTexto: 'Nexo',
};
const pares: Record<string, IdentidadeCarrossel['fontes']> = {
  editorial: 'editorial',
  impacto: 'impacto',
  clean: 'moderno',
  foto: 'tecnologia',
};

for (const estilo of ESTILOS) {
  for (const [i, slide] of exemplo.entries()) {
    const comFoto = foto && (slide.modelo === 'capa' || slide.modelo === 'foto');
    const m = montarSlide({
      slide: comFoto ? { ...slide, fotoId: 1 } : slide,
      indice: i,
      total: exemplo.length,
      identidade: { ...identidade, fontes: pares[estilo]!, estilo },
      estilo,
      foto: comFoto ? foto : null,
    });
    const jpg = await desenharSlide(m.no, { largura: 540 });
    writeFileSync(`${pasta}/${estilo}-${i + 1}-${slide.modelo}.jpg`, jpg);
    if (m.avisos.length) console.log(estilo, slide.modelo, m.avisos);
  }
}
console.log('pronto em', pasta);
