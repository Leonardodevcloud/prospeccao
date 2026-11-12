import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { carregarEnv, envBase, opcional } from '@prospeccao/config';
import { criarPool, manterSinalDeVida } from '@prospeccao/db';
import { criarClaude } from '@prospeccao/integrations/carrosseis';
import { criarArmazenamento } from '@prospeccao/integrations/reuniao';
import {
  comporMusica,
  gerarEfeito,
  gerarImagem,
  MODELO_IMAGEM_PADRAO,
  pedirDecisao,
  transcreverPalavras,
} from '@prospeccao/integrations/videos';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { z } from 'zod';
import { type DepsEdicao, editarVideo } from './editar.js';
import { prepararBiblioteca, sonsPresentes } from './enfeitar.js';

const env = carregarEnv(
  envBase.extend({
    /** O mesmo armazenamento das gravações (o original e o vídeo pronto ficam em videos/<conta>/<id>/). */
    GRAVACOES_S3_ENDPOINT: z.string().url(),
    GRAVACOES_S3_REGIAO: z.string().default('auto'),
    GRAVACOES_S3_BUCKET: z.string().min(3),
    GRAVACOES_S3_CHAVE: z.string().min(3),
    GRAVACOES_S3_SEGREDO: z.string().min(10),
    /** Transcrição palavra por palavra (a mesma chave da Groq das reuniões). Sem ela, nada é editado. */
    GROQ_CHAVE: opcional(z.string().min(10)),
    VOZ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
    /** O modelo grande marca melhor o tempo de cada palavra que o turbo. */
    VIDEOS_VOZ_MODELO: z.string().default('whisper-large-v3'),
    /** A IA que decide os cortes (a mesma chave dos carrosséis). Sem ela, só as regras. */
    ANTHROPIC_CHAVE: opcional(z.string().min(20)),
    VIDEOS_MODELO: z.string().default('claude-sonnet-5-5'),
    /** v157: o modelo barato das conferências e descrições de foto ("nenhum" desliga). */
    VIDEOS_MODELO_LEVE: z.string().default('claude-haiku-5-5'),
    /** Chrome do render (a imagem traz o Chromium em /usr/bin/chromium). */
    VIDEOS_NAVEGADOR: opcional(z.string().min(1)),
    VIDEOS_WORKERS_RENDER: z.coerce.number().int().min(1).max(8).default(2),
    VIDEOS_CONCORRENCIA: z.coerce.number().int().min(1).max(4).default(1),
    VIDEOS_PASTA: z.string().default(tmpdir()),
    /** Para a Saúde e consumo: hora do servidor que edita e hora de áudio transcrito (US$). */
    VIDEOS_CUSTO_SERVIDOR_USD_HORA: z.coerce.number().min(0).default(0.06),
    VIDEOS_CUSTO_TRANSCRICAO_USD_HORA: z.coerce.number().min(0).default(0.111),
    /** Imagens geradas (GPT Image 2): a mesma chave da OpenAI da api. Sem ela, só fotos da empresa. */
    OPENAI_CHAVE: opcional(z.string().min(10)),
    VIDEOS_IMAGEM_MODELO: z.string().default(MODELO_IMAGEM_PADRAO),
    /** v148: a qualidade das imagens geradas (high: a mais caprichada do GPT Image). */
    VIDEOS_IMAGEM_QUALIDADE: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
    /** v152: o modelo de música da ElevenLabs (music_v2_5 compõe por partes; music_v1 é o de reserva). */
    VIDEOS_MUSICA_MODELO: z
      .string()
      .regex(/^music_[\w.]+$/)
      .default('music_v2_5'),
    /** Sem valor: o custo médio da qualidade (em pé, 9:16: high ≈ US$ 0,25; medium ≈ US$ 0,06). */
    VIDEOS_CUSTO_IMAGEM_USD: z.coerce.number().min(0).optional(),
    /** Música (Eleven Music): com a chave, vale para toda conta com o módulo Vídeos (o plano decide). */
    ELEVENLABS_CHAVE: opcional(z.string().min(10)),
    VIDEOS_CUSTO_MUSICA_USD_MINUTO: z.coerce.number().min(0).default(0.15),
  }),
);

const log = criarLogger('worker-videos', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'worker-videos', max: 4 });
// O sinal de vida diz à api o que este worker sabe fazer (a tela mostra a música só com a chave).
const pararSinal = manterSinalDeVida(pool, 'worker-videos', {
  musica: !!env.ELEVENLABS_CHAVE,
  imagens: !!env.OPENAI_CHAVE,
});
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'worker-videos',
  log,
  filas: ['video.editar'],
});

const arm = criarArmazenamento({
  endpoint: env.GRAVACOES_S3_ENDPOINT,
  regiao: env.GRAVACOES_S3_REGIAO,
  bucket: env.GRAVACOES_S3_BUCKET,
  chave: env.GRAVACOES_S3_CHAVE,
  segredo: env.GRAVACOES_S3_SEGREDO,
});
const voz = env.GROQ_CHAVE
  ? { baseUrl: env.VOZ_BASE_URL, chave: env.GROQ_CHAVE, modelo: env.VIDEOS_VOZ_MODELO }
  : null;
const modeloLeve = env.VIDEOS_MODELO_LEVE === 'nenhum' ? null : env.VIDEOS_MODELO_LEVE;
const claude = env.ANTHROPIC_CHAVE
  ? criarClaude({ chave: env.ANTHROPIC_CHAVE, modelo: env.VIDEOS_MODELO, modeloLeve })
  : null;
const navegador = env.VIDEOS_NAVEGADOR ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : null);

// O vídeo só chega aqui de conta com o módulo Vídeos: com a chave, a música vale para todas.
const musicaLiberada = (_contaId: number) => !!env.ELEVENLABS_CHAVE;

const deps: DepsEdicao = {
  db: pool,
  arm,
  log,
  ouvir: voz ? (audio, o) => transcreverPalavras(voz, audio, o) : null,
  decidir: claude
    ? async (e) => {
        let custo = 0;
        const medido = criarClaude({
          chave: env.ANTHROPIC_CHAVE!,
          modelo: env.VIDEOS_MODELO,
          modeloLeve,
          medidor: {
            async depois(_uso, custoUsd) {
              custo += custoUsd;
            },
          },
        });
        const decisao = await pedirDecisao(medido, e);
        return { decisao, custoUsd: custo };
      }
    : null,
  claude: env.ANTHROPIC_CHAVE
    ? (somar) =>
        criarClaude({
          chave: env.ANTHROPIC_CHAVE!,
          modelo: env.VIDEOS_MODELO,
          modeloLeve,
          medidor: {
            async depois(_uso, custoUsd) {
              somar(custoUsd);
            },
          },
        })
    : null,
  gerarImagem: env.OPENAI_CHAVE
    ? (e) =>
        gerarImagem(
          {
            chave: env.OPENAI_CHAVE!,
            modelo: env.VIDEOS_IMAGEM_MODELO,
            qualidade: env.VIDEOS_IMAGEM_QUALIDADE,
          },
          e,
        )
    : null,
  comporMusica: env.ELEVENLABS_CHAVE
    ? (e) => comporMusica({ chave: env.ELEVENLABS_CHAVE!, modelo: env.VIDEOS_MUSICA_MODELO }, e)
    : null,
  gerarEfeito: env.ELEVENLABS_CHAVE ? (e) => gerarEfeito({ chave: env.ELEVENLABS_CHAVE! }, e) : null,
  musicaLiberada,
  custoImagemUsd:
    env.VIDEOS_CUSTO_IMAGEM_USD ??
    { low: 0.02, medium: 0.06, high: 0.25, xhigh: 0.4, max: 0.6 }[env.VIDEOS_IMAGEM_QUALIDADE],
  custoMusicaMinutoUsd: env.VIDEOS_CUSTO_MUSICA_USD_MINUTO,
  pasta: env.VIDEOS_PASTA,
  navegador,
  workersRender: env.VIDEOS_WORKERS_RENDER,
  custoServidorHora: env.VIDEOS_CUSTO_SERVIDOR_USD_HORA,
  custoTranscricaoHora: env.VIDEOS_CUSTO_TRANSCRICAO_USD_HORA,
};

// Sobras de um processo que morreu no meio (deploy): voltam para a fila do banco e do pg-boss.
await pool.query(
  `UPDATE comercial.videos SET situacao = 'na_fila', etapa = NULL, progresso = 0 WHERE situacao = 'editando'`,
);
await filas.liberarTravados('video.editar');

await filas.consumir(
  'video.editar',
  async ({ videoId, modo }) => {
    await editarVideo(deps, videoId, modo);
  },
  { concorrencia: env.VIDEOS_CONCORRENCIA, intervaloSegundos: 5 },
);

log.info(
  {
    transcricao: !!voz,
    ia: !!claude,
    imagens: !!env.OPENAI_CHAVE,
    musica: env.ELEVENLABS_CHAVE ? 'ligada' : 'sem chave',
    efeitos: await sonsPresentes(),
    navegador: navegador ?? 'o do HyperFrames',
    workers: env.VIDEOS_WORKERS_RENDER,
  },
  'worker-videos no ar',
);
// v138: a biblioteca de efeitos sutis fica pronta logo ao subir (na primeira vez, a ElevenLabs faz).
void prepararBiblioteca(deps).catch((erro) =>
  log.warn({ err: erro }, 'a biblioteca de efeitos não carregou'),
);

encerrarAoReceberSinal(log, async () => {
  pararSinal();
  await filas.parar();
  await pool.end();
});
