/**
 * O saber dos agentes: os manuais que os agentes de IA leem antes de trabalhar, como um profissional
 * que estudou o ofício. Vão no começo do prompt, marcados para o cache da Anthropic (do segundo pedido
 * em diante custam um décimo). Créditos e licenças em CREDITOS.md.
 */
import { MANUAL_DESIGN } from './design.js';
import { MANUAL_EDITOR_VIDEO } from './editorDeVideo.js';
import { MANUAL_MOTION } from './motion.js';
import { MANUAL_REDACAO } from './redacao.js';
import { MANUAL_REVISAO } from './revisao.js';

export { MANUAL_DESIGN, MANUAL_EDITOR_VIDEO, MANUAL_MOTION, MANUAL_REDACAO, MANUAL_REVISAO };

export type NomeManual = 'design' | 'editorDeVideo' | 'motion' | 'redacao' | 'revisao';

export const MANUAIS: Record<NomeManual, string> = {
  design: MANUAL_DESIGN,
  editorDeVideo: MANUAL_EDITOR_VIDEO,
  motion: MANUAL_MOTION,
  redacao: MANUAL_REDACAO,
  revisao: MANUAL_REVISAO,
};

/** De onde veio o conhecimento (para a tela de ajuda e para quem mexer no código). */
export const FONTES_DO_SABER = [
  { nome: 'Vyral · content-skills', url: 'https://github.com/vyralcontent/content-skills', licenca: 'MIT' },
  {
    nome: 'iart.ai · tiktok-video-skills',
    url: 'https://github.com/iart-ai/tiktok-video-skills',
    licenca: 'MIT',
  },
  {
    nome: 'Muhammad Faizan · Video-Editing-Skill',
    url: 'https://github.com/thisisfaizi/Video-Editing-Skill',
    licenca: 'MIT',
  },
  {
    nome: 'Corey Haines · marketingskills',
    url: 'https://github.com/coreyhaines31/marketingskills',
    licenca: 'MIT',
  },
  { nome: 'HeyGen · HyperFrames', url: 'https://github.com/heygen-com/hyperframes', licenca: 'Apache 2.0' },
  {
    nome: 'Rob Palmer · claude-code-copywriting-skills',
    url: 'https://robpalmer.com/blog/claude-code-copywriting-skills',
    licenca: 'CC BY 4.0',
  },
] as const;
