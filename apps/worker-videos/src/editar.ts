import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Executor } from '@prospeccao/db';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import {
  alturaDoTitulo,
  argumentosDaMistura,
  blocosDaLegenda,
  conferirJuncoes,
  conferirSobreposicao,
  type DecisaoDaIa,
  decisaoPelasRegras,
  diagramar,
  duracaoTotal,
  efeitosDoVideo,
  enfeitesNaTela,
  type Grafico,
  marcarFortes,
  montarComposicao,
  montarCortes,
  type Plano,
  palavrasEsticadas,
  palavrasNoEditado,
  partirPalavraEsticada,
  planosDoVideo,
  recorteDoPlano,
  rostosNoEditado,
  type Silencio,
  silencios,
  tituloEmLinhas,
} from '@prospeccao/integrations/videos';
import type { Logger } from '@prospeccao/shared';
import {
  type AnimacoesVideo,
  type CorteVideo,
  duracaoDosTrechos,
  fmtDuracao,
  fraseDaChamada,
  type ImagemPosta,
  type ImagemVideo,
  LIMITE_SEGUNDOS_VIDEO,
  type MomentoVideo,
  momentosDe,
  type OpcoesVideo,
  type PalavraVideo,
  SEGUNDOS_PREVIA,
  type SomVideo,
  TAMANHO_PARTE_ENVIO,
  type TrechoSemImagem,
  trechosQueFicam,
} from '@prospeccao/shared/videos';
import {
  type CustosEnfeites,
  type DepsEnfeites,
  efeitosParaMisturar,
  fotosDescritas,
  planejar,
  prepararImagens,
  prepararMusica,
  somPadrao,
  sonsPresentes,
} from './enfeitar.js';
import { duracaoDoVideo, ErroDoVideo, lerAudioCru, lerInfo, pedacos, rodar } from './ferramentas.js';
import { ARQUIVOS_FONTE, regua } from './fontes.js';
import * as repo from './repositorio.js';
import { centroDoRosto, mapearRosto, remendarBuracos } from './rosto.js';

/**
 * A edição de um vídeo, do arquivo enviado ao vídeo pronto no armazenamento:
 * 1. em pé e no tamanho do Reels (vídeo deitado é recortado em volta do rosto);
 * 2. a fala palavra por palavra e os silêncios medidos no áudio;
 * 3. os cortes (a IA decide as palavras; as pausas, o ritmo);
 * 4. o mapa do rosto;
 * 5. os planos montados com a aproximação alternada e o som tratado;
 * 5. (v129) os enfeites: o plano da IA (animações, imagens, clima da música), as fotos da empresa
 *    descritas, as imagens que faltam geradas e conferidas;
 * 6. a diagramação (legenda, animações e imagens fora do rosto) e o render no HyperFrames, com a
 *    música composta ao mesmo tempo; depois a mistura (voz, música que baixa na fala, efeitos);
 * 7. a conferência: o rosto no vídeo pronto contra cada texto, e as junções ouvidas de novo.
 * "Gerar de novo" pula 2 a 4 e o plano, e usa o que a pessoa mudou na revisão.
 */

const require = createRequire(import.meta.url);
const FPS = 30;
const FPS_ROSTO = 6;

export interface DepsEdicao extends DepsEnfeites {
  db: Executor;
  arm: Armazenamento;
  log: Logger;
  /** Transcrição com o tempo de cada palavra (sem ela, a edição não roda). */
  ouvir:
    | ((
        audio: Uint8Array<ArrayBuffer>,
        o: { vocabulario: string[]; assunto: string },
      ) => Promise<PalavraVideo[]>)
    | null;
  /** A IA decide os cortes (sem ela, só as regras: muletas e pausas). */
  decidir:
    | ((e: {
        palavras: PalavraVideo[];
        silencios: Silencio[];
        opcoes: OpcoesVideo;
      }) => Promise<{ decisao: DecisaoDaIa; custoUsd: number }>)
    | null;
  pasta: string;
  navegador: string | null;
  workersRender: number;
  /** Quanto custa uma hora do servidor que edita (US$), para a Saúde e consumo. */
  custoServidorHora: number;
  /** Quanto custa uma hora de áudio transcrito (US$). */
  custoTranscricaoHora: number;
}

interface Custos extends CustosEnfeites {
  transcricaoSeg: number;
}

/* ───────────────────────────── Arquivos ───────────────────────────── */

async function baixar(arm: Armazenamento, chave: string, destino: string) {
  const url = await arm.urlAssinada(chave, { segundos: 3600 });
  const r = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) });
  if (!r.ok || !r.body) throw new ErroDoVideo('Não deu para ler o vídeo enviado.', false, `HTTP ${r.status}`);
  await pipeline(
    Readable.fromWeb(r.body as import('node:stream/web').ReadableStream),
    createWriteStream(destino),
  );
}

/** Sobe um arquivo grande em partes, sem segurar tudo na memória. */
export async function subirArquivo(arm: Armazenamento, chave: string, arquivo: string, tipo: string) {
  const envio = await arm.iniciarEmPartes(chave, tipo);
  const partes: { numero: number; etag: string }[] = [];
  try {
    let n = 1;
    for await (const p of pedacos(arquivo, TAMANHO_PARTE_ENVIO)) {
      partes.push({ numero: n, etag: await arm.enviarParte(chave, envio, n, p) });
      n++;
    }
    await arm.concluirEmPartes(chave, envio, partes);
  } catch (erro) {
    await arm.cancelarEmPartes(chave, envio);
    throw erro;
  }
}

/* ───────────────────────────── Etapas ───────────────────────────── */

/** Deixa em pé, 1080 × 1920, 30 quadros por segundo; vídeo deitado é recortado em volta do rosto. */
async function emPe(
  original: string,
  base: string,
  info: { largura: number; altura: number; duracao: number },
  recorteX: number | null,
): Promise<number | null> {
  const proporcao = info.largura / info.altura;
  let filtro = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
  let centro = recorteX;
  if (proporcao > 0.62) {
    // Deitado ou quadrado: acha o rosto (2 quadros por segundo bastam) e recorta em pé em volta.
    if (centro == null) {
      const rostos = await mapearRosto(original, { fps: 2, largura: info.largura, altura: info.altura });
      centro = centroDoRosto(rostos, info.largura);
    }
    const escala = 1920 / info.altura;
    const larguraEscalada = Math.round((info.largura * escala) / 2) * 2;
    const x = Math.max(0, Math.min(larguraEscalada - 1080, Math.round(centro * escala - 540)));
    filtro = `scale=${larguraEscalada}:1920,crop=1080:1920:${x}:0`;
  }
  await rodar(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-i',
      original,
      '-vf',
      `${filtro},fps=${FPS},setsar=1,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '16',
      '-g',
      String(FPS),
      '-c:a',
      'pcm_s16le',
      '-ar',
      '48000',
      base,
    ],
    { timeoutMs: 30 * 60_000 },
  );
  return proporcao > 0.62 ? centro : null;
}

/** Monta o vídeo editado: cada plano com o seu enquadramento, juntos, cor e som tratados. */
async function montarEditado(base: string, planos: Plano[], pasta: string, saida: string): Promise<Plano[]> {
  const lista: string[] = [];
  const reais: Plano[] = [];
  let acc = 0;
  for (const [k, p] of planos.entries()) {
    // Duração inteira em quadros: som e imagem do pedaço terminam juntos (sem escorregar na junção).
    const d = Math.max(1, Math.round((p.fim - p.inicio) * FPS)) / FPS;
    const c = recorteDoPlano(p);
    const arq = join(pasta, `plano-${String(k).padStart(3, '0')}.mov`);
    const fadeOut = Math.max(0, d - 0.015).toFixed(3);
    await rodar(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        p.inicio.toFixed(3),
        '-i',
        base,
        '-t',
        d.toFixed(4),
        '-vf',
        `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=1080:1920:flags=lanczos,setsar=1`,
        '-af',
        `afade=t=in:d=0.012,afade=t=out:st=${fadeOut}:d=0.015`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '15',
        '-c:a',
        'pcm_s16le',
        arq,
      ],
      { timeoutMs: 10 * 60_000 },
    );
    const real = (await duracaoDoVideo(arq)) || d;
    reais.push({ ...p, editadoIni: r3(acc), editadoFim: r3(acc + real), fim: r3(p.inicio + real) });
    acc += real;
    lista.push(`file '${arq.replace(/'/g, "'\\''")}'`);
  }
  const arqLista = join(pasta, 'planos.txt');
  await writeFile(arqLista, lista.join('\n'));
  await rodar(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      arqLista,
      '-vf',
      'eq=contrast=1.05:saturation=1.06:brightness=0.01,unsharp=5:5:0.35,format=yuv420p',
      '-af',
      'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-14:TP=-1.5:LRA=7,aresample=48000',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '17',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      saida,
    ],
    { timeoutMs: 30 * 60_000 },
  );
  return reais;
}

async function renderizar(
  deps: DepsEdicao,
  pasta: string,
  html: string,
  arquivos: { editado: string; ultimo: string; extras: { origem: string; nome: string }[] },
  saida: string,
) {
  const projeto = join(pasta, 'projeto');
  await mkdir(join(projeto, 'assets'), { recursive: true });
  await Promise.all([
    copyFile(arquivos.editado, join(projeto, 'assets', 'editado.mp4')),
    copyFile(arquivos.ultimo, join(projeto, 'assets', 'ultimo.png')),
    copyFile(require.resolve('gsap/dist/gsap.min.js'), join(projeto, 'assets', 'gsap.min.js')),
    copyFile(ARQUIVOS_FONTE[800], join(projeto, 'assets', 'legenda-800.woff2')),
    copyFile(ARQUIVOS_FONTE[900], join(projeto, 'assets', 'legenda-900.woff2')),
    ...arquivos.extras.map((x) => copyFile(x.origem, join(projeto, 'assets', x.nome))),
  ]);
  await writeFile(join(projeto, 'index.html'), html);
  await writeFile(join(projeto, 'meta.json'), JSON.stringify({ id: 'video', name: 'video' }));
  await writeFile(
    join(projeto, 'hyperframes.json'),
    JSON.stringify({
      paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
      media: { autoProxy: true },
    }),
  );
  const cli = join(dirname(require.resolve('hyperframes/package.json')), 'bin', 'hyperframes.mjs');
  await rodar(
    process.execPath,
    [cli, 'render', '-o', saida, '-w', String(deps.workersRender), '--crf', '18', '--quiet', '--no-wait'],
    {
      cwd: projeto,
      timeoutMs: 40 * 60_000,
      env: {
        ...process.env,
        HYPERFRAMES_NO_TELEMETRY: '1',
        HYPERFRAMES_NO_UPDATE_CHECK: '1',
        HYPERFRAMES_SKIP_SKILLS: '1',
        HYPERFRAMES_NO_AUTO_INSTALL: '1',
        HYPERFRAMES_NO_OPTIONAL_INSTALL: '1',
        HYPERFRAMES_CACHE_DIR: join(pasta, 'cache-hf'),
        ...(deps.navegador ? { HYPERFRAMES_BROWSER_PATH: deps.navegador } : {}),
      },
    },
  );
}

/* ───────────────────────────── A edição ───────────────────────────── */

export async function editarVideo(
  deps: DepsEdicao,
  videoId: number,
  modo: 'primeira' | 'refazer',
): Promise<void> {
  const { db, arm, log } = deps;
  const comeco = Date.now();
  const v = await repo.carregar(db, videoId);
  if (!v) return;
  if (v.situacao === 'enviando') return; // o envio ainda não terminou
  const pasta = join(deps.pasta, `video-${videoId}-${Date.now()}`);
  await mkdir(pasta, { recursive: true });
  const custos: Custos = {
    claudeUsd: 0,
    transcricaoSeg: 0,
    imagens: 0,
    imagensUsd: 0,
    musicaSeg: 0,
    musicaUsd: 0,
  };
  const versaoLida = v.versao;
  const etapa = (e: Parameters<typeof repo.marcarEtapa>[2], p: number) => repo.marcarEtapa(db, videoId, e, p);
  try {
    await repo.comecar(db, videoId);
    const original = join(pasta, 'original');
    await baixar(arm, v.original_chave, original);
    const info = await lerInfo(original);
    if (info.duracao > LIMITE_SEGUNDOS_VIDEO + 1)
      throw new ErroDoVideo(
        `O vídeo tem ${fmtDuracao(info.duracao)}. O limite é ${fmtDuracao(LIMITE_SEGUNDOS_VIDEO)}.`,
      );
    if (!info.temSom) throw new ErroDoVideo('O vídeo não tem som: a edição corta e legenda pela fala.');

    const base = join(pasta, 'base.mov');
    const recorteX = await emPe(original, base, info, v.analise?.recorteX ?? null);
    await rm(original, { force: true });
    const duracao = (await duracaoDoVideo(base)) || info.duracao;
    // v136: um quadro do vídeo já em pé, para a tela mostrar o mapa do rosto enquanto edita.
    const tPrevia = Math.min(1.5, duracao / 3);
    if (!v.previa_chave)
      await fazerPrevia(arm, base, tPrevia, `videos/${v.conta_id}/${videoId}/previa.jpg`, pasta)
        .then((chave) => repo.guardarPrevia(db, videoId, chave))
        .catch((erro) => log.warn({ err: erro, videoId }, 'a prévia da edição não saiu'));
    if (!v.previa_video_chave)
      await fazerPreviaVideo(arm, base, `videos/${v.conta_id}/${videoId}/previa.mp4`, pasta)
        .then((chave) => repo.guardarPreviaVideo(db, videoId, chave))
        .catch((erro) => log.warn({ err: erro, videoId }, 'a prévia em loop não saiu'));
    const anotar = (parte: Parameters<typeof repo.anotar>[2]) =>
      repo.anotar(db, videoId, parte).catch(() => undefined);

    let palavras: PalavraVideo[];
    let cortes: CorteVideo[];
    let animacoes: AnimacoesVideo;
    let analise: repo.AnaliseVideo;
    let imagens: ImagemVideo[];
    let semImagem: TrechoSemImagem[];
    let som: SomVideo;
    let fotos: Awaited<ReturnType<typeof fotosDescritas>> | null = null;

    if (modo === 'primeira' || !v.analise || !v.palavras.length) {
      // 2. A fala e os silêncios.
      await etapa('ouvindo', 12);
      if (!deps.ouvir) throw new ErroDoVideo('A transcrição não está ligada. Fale com a gente.', false);
      const fala = join(pasta, 'fala.flac');
      await rodar(
        'ffmpeg',
        ['-v', 'error', '-y', '-i', base, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', fala],
        {
          timeoutMs: 5 * 60_000,
        },
      );
      const vocabulario = await repo.vocabularioDaConta(db, v.conta_id);
      palavras = await deps.ouvir(new Uint8Array(await readFile(fala)) as Uint8Array<ArrayBuffer>, {
        vocabulario,
        assunto: v.opcoes.assunto,
      });
      custos.transcricaoSeg += duracao;
      if (palavras.length < 2)
        throw new ErroDoVideo('Não deu para ouvir fala no vídeo: a edição corta e legenda pela fala.');
      const pcm = await lerAudioCru(base);
      const sil = silencios(pcm);
      // v138: a embolação escondida dentro de uma palavra esticada volta a ser um vão (e é cortada).
      palavras = await ajustarEsticadas(palavras, pcm, {
        reouvir: deps.ouvir
          ? async (a, b) => {
              const trecho = join(pasta, `trecho-${Math.round(a * 1000)}.flac`);
              await rodar(
                'ffmpeg',
                [
                  '-v',
                  'error',
                  '-y',
                  '-ss',
                  a.toFixed(3),
                  '-to',
                  b.toFixed(3),
                  '-i',
                  fala,
                  '-c:a',
                  'flac',
                  trecho,
                ],
                { timeoutMs: 60_000 },
              );
              custos.transcricaoSeg += b - a;
              return deps.ouvir!(new Uint8Array(await readFile(trecho)) as Uint8Array<ArrayBuffer>, {
                vocabulario,
                assunto: v.opcoes.assunto,
              });
            }
          : null,
        log: (msg) => log.info({ videoId }, msg),
      });
      await anotar({
        ouvindo: { palavras: palavras.length },
        fala: { palavras: palavras.slice(0, MAX_PALAVRAS_TELA).map((p) => p.t) },
      });

      // 3. Os cortes.
      await etapa('cortando', 30);
      let decisao: DecisaoDaIa;
      if (deps.decidir) {
        try {
          const r = await deps.decidir({ palavras, silencios: sil, opcoes: v.opcoes });
          decisao = r.decisao;
          custos.claudeUsd += r.custoUsd;
        } catch (erro) {
          log.warn({ err: erro, videoId }, 'a IA não decidiu os cortes; seguindo pelas regras');
          decisao = decisaoPelasRegras(palavras);
        }
      } else decisao = decisaoPelasRegras(palavras);
      cortes = montarCortes(palavras, sil, decisao, v.opcoes.ritmo, duracao);
      palavras = marcarFortes(palavras, decisao.fortes);
      await anotar({
        cortando: resumoDosCortes(cortes, duracao),
        fala: {
          palavras: palavras.slice(0, MAX_PALAVRAS_TELA).map((p) => p.t),
          ...cortesNaFala(palavras, cortes),
        },
      });
      const titulo = decisao.titulo || v.opcoes.assunto.toUpperCase().split(/\s+/).slice(0, 5).join(' ');
      animacoes = {
        titulo: { usar: !!titulo, texto: titulo },
        chamada: { usar: v.opcoes.chamada.tipo !== 'nenhuma', ...v.opcoes.chamada },
      };

      // 4. O mapa do rosto.
      await etapa('rosto', 42);
      const rostos = remendarBuracos(
        await mapearRosto(base, {
          fps: FPS_ROSTO,
          largura: 1080,
          altura: 1920,
          duracao,
          aoAndar: (f) => void etapa('rosto', 42 + f * 14).catch(() => undefined),
        }),
      );
      analise = { duracao, silencios: sil, rostos, fps: FPS_ROSTO, recorteX };
      await anotar({ rosto: { caixa: rostoEm(rostos, tPrevia), t: tPrevia }, trilha: trilhaDoRosto(rostos) });
      await repo.salvarAnalise(db, videoId, { duracao, analise, cortes, palavras, animacoes });

      // 5. O plano dos enfeites, sobre a fala que ficou.
      await etapa('imagens', 57);
      const ficamAgora = trechosQueFicam(duracao, cortes);
      fotos = v.opcoes.imagens === 'nenhuma' ? [] : await fotosDescritas(deps, v.conta_id, custos);
      const plano = await planejar(
        deps,
        {
          contaId: v.conta_id,
          palavras,
          ficam: ficamAgora,
          duracaoEditado: duracaoDosTrechos(ficamAgora),
          opcoes: v.opcoes,
          comTitulo: animacoes.titulo.usar && !!animacoes.titulo.texto,
          fotos,
          promocoes: await repo.promocoesDaConta(db, v.conta_id),
        },
        custos,
      );
      animacoes = { ...animacoes, momentos: plano.momentos };
      imagens = plano.imagens;
      semImagem = plano.semImagem;
      som = plano.som;
      await repo.salvarEnfeites(db, videoId, { animacoes, imagens, semImagem, som });
      await anotar({
        imagens: {
          fotos: imagens.filter((i) => i.origem !== 'gerada').length,
          geradas: imagens.filter((i) => i.origem === 'gerada').length,
          animacoes: (animacoes.momentos ?? []).filter((m) => m.usar !== false).length,
          musica: !!som.musica.usar,
        },
      });
    } else {
      analise = { ...v.analise, recorteX: v.analise.recorteX ?? recorteX };
      palavras = v.palavras;
      cortes = v.cortes;
      animacoes = v.animacoes ?? {
        titulo: { usar: false, texto: '' },
        chamada: { usar: v.opcoes.chamada.tipo !== 'nenhuma', ...v.opcoes.chamada },
      };
      imagens = v.imagens;
      semImagem = v.sem_imagem;
      // Vídeo da v128 (sem som guardado): continua sem música e sem efeitos até a pessoa ligar.
      som = v.som ?? somPadrao(v.opcoes, { liberada: deps.musicaLiberada(v.conta_id), antigo: true });
    }

    // As imagens com o arquivo no disco (as que faltam são geradas e conferidas).
    await etapa('imagens', 60);
    const precisaFotos = imagens.some(
      (im) => im.usar && (im.pedido === 'escolher' || (im.origem === 'empresa' && !im.chave)),
    );
    if (!fotos && precisaFotos) fotos = await fotosDescritas(deps, v.conta_id, custos);
    const preparo = await prepararImagens(
      deps,
      {
        contaId: v.conta_id,
        videoId,
        opcoes: v.opcoes,
        imagens,
        fotos: fotos ?? [],
        pasta,
        aoGuardar: (atual) => repo.salvarEnfeites(db, videoId, { animacoes, imagens: atual, semImagem, som }),
      },
      custos,
    );
    imagens = preparo.imagens;

    // 5. Os planos com o enquadramento, juntos.
    await etapa('montando', 58);
    const ficam = trechosQueFicam(duracao, cortes);
    if (!ficam.length)
      throw new ErroDoVideo('Os cortes tiraram o vídeo inteiro. Devolva algum trecho na revisão.', true);
    const planos = await montarEditado(
      base,
      planosDoVideo(ficam, analise.rostos, v.opcoes.transicao),
      pasta,
      join(pasta, 'editado.mp4'),
    );
    await rm(base, { force: true });
    const editado = join(pasta, 'editado.mp4');
    const duracaoEditado = (await duracaoDoVideo(editado)) || planos.at(-1)!.editadoFim;
    const ultimo = join(pasta, 'ultimo.png');
    await rodar(
      'ffmpeg',
      ['-v', 'error', '-y', '-sseof', '-0.1', '-i', editado, '-frames:v', '1', '-update', '1', ultimo],
      {
        timeoutMs: 60_000,
      },
    );

    // 6. Diagramação e render.
    await etapa('montando', 64);
    const medirLegenda = regua(900, -0.01);
    const medirTitulo = regua(900, -0.02);
    const naTela = palavrasNoEditado(palavras, planos);
    const rostosEditado = rostosNoEditado(analise.rostos, planos);
    const titulo =
      animacoes.titulo.usar && animacoes.titulo.texto
        ? tituloEmLinhas(animacoes.titulo.texto, medirTitulo)
        : null;
    const momentos: MomentoVideo[] = momentosDe(animacoes);
    const tela = enfeitesNaTela({
      momentos,
      imagens: imagens
        .filter((im) => preparo.arquivos.has(im.id))
        .map((im) => ({ ...im, arquivo: `assets/img-${im.id}.jpg` })),
      planos,
      rostos: rostosEditado,
      duracao: duracaoEditado,
    });
    const graficos: Grafico[] = titulo?.linhas.length
      ? [
          {
            id: 'abertura',
            ini: 0,
            fim: Math.min(2.3, Math.max(1.2, duracaoEditado - 0.5)),
            altura: alturaDoTitulo(titulo),
          },
        ]
      : [];
    graficos.push(...tela.graficos);
    const diagrama = diagramar({
      rostos: rostosEditado,
      planos: planos.map((p) => ({ inicio: p.editadoIni, fim: p.editadoFim })),
      blocos: blocosDaLegenda(naTela, v.opcoes.estilo),
      graficos,
      estilo: v.opcoes.estilo,
      medir: medirLegenda,
    });
    const chamada =
      animacoes.chamada.usar && animacoes.chamada.tipo !== 'nenhuma'
        ? fraseDaChamada(animacoes.chamada)
        : null;
    const marca = await repo.marcaDaConta(db, v.conta_id);
    const cartaoDe = (id: string) => diagrama.cartoes.find((c) => c.id === id);
    const posta = new Map<string, ImagemPosta | null>(
      tela.imagens.map((i) => [
        i.id,
        i.encaixe === 'cheia' ? 'cheia' : cartaoDe(`img:${i.id}`)?.lugar === 'fora' ? null : 'acima',
      ]),
    );
    imagens = imagens.map((im) => ({ ...im, posta: posta.get(im.id) ?? null }));
    const chamadaFinal = chamada && (chamada.frase || chamada.botao) ? chamada : null;
    const listaEfeitos = efeitosDoVideo({
      titulo: !!titulo?.linhas.length,
      momentos: tela.momentos.filter((m) => m.tipo !== 'destaque'),
      imagens: tela.imagens.map((i) => ({ id: i.id, ini: i.ini, posta: posta.get(i.id) ?? 'acima' })),
      chamadaEm: chamadaFinal ? duracaoEditado + 0.4 : null,
    });
    som = { ...som, efeitos: { ...som.efeitos, lista: listaEfeitos } };
    const html = montarComposicao({
      diagrama,
      empurroes:
        v.opcoes.transicao === 'seco'
          ? []
          : planos
              .filter((p) => p.editadoFim - p.editadoIni >= 1.2)
              .map((p) => ({ ini: p.editadoIni, fim: p.editadoFim, ox: p.ax, oy: p.ay })),
      estilo: v.opcoes.estilo,
      marca,
      duracao: duracaoEditado,
      titulo: titulo ? { usar: true, ...titulo } : null,
      chamada: chamadaFinal,
      momentos: tela.momentos,
      imagens: tela.imagens,
      transicao: v.opcoes.transicao,
      medir: regua(900, 0),
      arquivos: {
        video: 'assets/editado.mp4',
        gsap: 'assets/gsap.min.js',
        fonte800: 'assets/legenda-800.woff2',
        fonte900: 'assets/legenda-900.woff2',
        ultimoQuadro: 'assets/ultimo.png',
      },
    });
    await etapa('gerando', 70);
    const renderizado = join(pasta, 'renderizado.mp4');
    const total = duracaoTotal({ duracao: duracaoEditado, chamada: chamadaFinal });
    // A música é composta enquanto o vídeo renderiza.
    const musicaPronta = prepararMusica(deps, { contaId: v.conta_id, videoId, som, total, pasta }, custos);
    await renderizar(
      deps,
      pasta,
      html,
      {
        editado,
        ultimo,
        extras: tela.imagens.map((i) => ({ origem: preparo.arquivos.get(i.id)!, nome: `img-${i.id}.jpg` })),
      },
      renderizado,
    );
    await etapa('som', 87);
    const musica = await musicaPronta;
    som = musica.som;
    const efeitos = (await sonsPresentes()) ? efeitosParaMisturar(som, listaEfeitos) : [];
    const pronto = join(pasta, 'pronto.mp4');
    if (musica.arquivo || efeitos.length)
      await rodar(
        'ffmpeg',
        argumentosDaMistura({
          pronto: renderizado,
          saida: pronto,
          total,
          musica: musica.arquivo ? { arquivo: musica.arquivo, volume: som.musica.volume } : null,
          efeitos,
        }),
        { timeoutMs: 10 * 60_000 },
      );
    else await copyFile(renderizado, pronto);

    // 7. Conferência: rosto contra texto no vídeo pronto; e as junções ouvidas de novo (primeira vez).
    await etapa('conferindo', 90);
    const rostosPronto = await mapearRosto(pronto, { fps: 4, largura: 1080, altura: 1920 });
    const conferencia = conferirSobreposicao(
      diagrama,
      rostosPronto,
      duracaoEditado,
      tela.imagens.map((i) => {
        const c = cartaoDe(`img:${i.id}`);
        return {
          ini: i.ini,
          fim: i.fim,
          caixa:
            i.encaixe === 'cheia' || !c
              ? null
              : { x0: 110, x1: 970, y0: c.topo, y1: c.topo + 552 * c.escala },
        };
      }),
    );
    if (conferencia.sobreposicoes)
      log.warn({ videoId, conferencia }, 'texto encostou no rosto no vídeo pronto');
    if (modo === 'primeira' && deps.ouvir) {
      try {
        const audioEditado = join(pasta, 'editado.flac');
        await rodar('ffmpeg', [
          '-v',
          'error',
          '-y',
          '-i',
          editado,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'flac',
          audioEditado,
        ]);
        const ouvidas = await deps.ouvir(
          new Uint8Array(await readFile(audioEditado)) as Uint8Array<ArrayBuffer>,
          {
            vocabulario: [],
            assunto: v.opcoes.assunto,
          },
        );
        custos.transcricaoSeg += duracaoEditado;
        cortes = conferirJuncoes(cortes, palavras, ficam, ouvidas);
      } catch (erro) {
        log.warn({ err: erro, videoId }, 'não deu para ouvir de novo as junções');
      }
    }

    // Capa e envio.
    const capa = join(pasta, 'capa.jpg');
    await rodar('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-ss',
      String(Math.min(1, duracaoEditado / 2)),
      '-i',
      pronto,
      '-frames:v',
      '1',
      '-vf',
      'scale=360:640',
      '-q:v',
      '4',
      capa,
    ]);
    const prefixo = `videos/${v.conta_id}/${videoId}`;
    const sufixo = Date.now().toString(36);
    const finalChave = `${prefixo}/editado-${sufixo}.mp4`;
    const capaChave = `${prefixo}/capa-${sufixo}.jpg`;
    await subirArquivo(arm, finalChave, pronto, 'video/mp4');
    await arm.enviar(capaChave, new Uint8Array(await readFile(capa)), 'image/jpeg');
    const antigos = [v.final_chave, v.capa_chave].filter((c): c is string => !!c);

    const segundosServidor = (Date.now() - comeco) / 1000;
    const custoUsd =
      custos.claudeUsd +
      custos.imagensUsd +
      custos.musicaUsd +
      (custos.transcricaoSeg / 3600) * deps.custoTranscricaoHora +
      (segundosServidor / 3600) * deps.custoServidorHora;
    const enfeites = await repo.mesclarComAtual(db, videoId, versaoLida, { animacoes, imagens, som });
    const { contouAgora } = await repo.concluir(db, videoId, {
      finalChave,
      capaChave,
      duracaoFinal: total,
      conferencia,
      cortes,
      custoUsd,
      versaoLida,
      ...enfeites,
    });
    if (antigos.length) await arm.apagar(antigos).catch(() => undefined);
    await repo.registrarConsumo(db, v.conta_id, {
      videos: contouAgora ? 1 : 0,
      segundosVideo: duracao,
      segundosServidor,
      transcricaoSeg: custos.transcricaoSeg,
      claudeUsd: custos.claudeUsd,
      custoUsd,
      imagens: custos.imagens,
      imagensUsd: custos.imagensUsd,
      musicaSeg: custos.musicaSeg,
      musicaUsd: custos.musicaUsd,
    });
    const duvidas = cortes.filter((c) => c.duvida && !c.conferido && c.decisao === 'cortar').length;
    if (v.criado_por)
      await repo
        .avisar(db, v.conta_id, v.criado_por, {
          titulo: duvidas ? 'Seu vídeo está pronto para revisar' : 'Seu vídeo ficou pronto',
          texto: `${v.titulo} · ${fmtDuracao(duracao)} → ${fmtDuracao(duracaoEditado)}${duvidas ? ` · ${duvidas} corte(s) para você decidir` : ''}`,
          link: `/videos/${videoId}`,
        })
        .catch(() => undefined);
    log.info(
      { videoId, segundos: Math.round(segundosServidor), custoUsd: r3(custoUsd), conferencia },
      'vídeo editado',
    );
  } catch (erro) {
    const definitivo = erro instanceof ErroDoVideo ? erro.definitivo : false;
    const mensagem =
      erro instanceof ErroDoVideo
        ? erro.paraQuemUsa
        : 'A edição falhou no meio. Tente gerar de novo; se repetir, fale com a gente.';
    log.error({ err: erro, videoId }, 'edição do vídeo falhou');
    const gasto = custos.claudeUsd + custos.imagensUsd + custos.musicaUsd;
    if (definitivo || v.tentativas >= 1) await repo.falhar(db, videoId, mensagem, gasto);
    else {
      await repo.devolverParaFila(db, videoId, mensagem);
      throw erro; // a fila tenta de novo
    }
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ───────────────────────────── v136: o andamento na tela ───────────────────────────── */

/** O que saiu, por tipo, e o tempo antes e depois (para "14 pausas, 3 éé: 1:24 vira 1:02"). */
export function resumoDosCortes(cortes: CorteVideo[], duracao: number) {
  const valem = cortes.filter((c) => c.decisao !== 'devolver');
  const n = (t: string) => valem.filter((c) => c.tipo === t).length;
  return {
    pausas: n('pausa'),
    muletas: n('muleta'),
    recomecos: n('recomeco'),
    outros: valem.length - n('pausa') - n('muleta') - n('recomeco'),
    de: Math.round(duracao * 10) / 10,
    para: Math.round(duracaoDosTrechos(trechosQueFicam(duracao, cortes)) * 10) / 10,
  };
}

/** O rosto no quadro mais perto de t (a união das caixas), ou null sem rosto ali. */
export function rostoEm(
  rostos: { t: number; caixas: { x0: number; y0: number; x1: number; y1: number }[] }[],
  t: number,
) {
  let melhor: (typeof rostos)[number] | null = null;
  for (const q of rostos)
    if (q.caixas.length && (!melhor || Math.abs(q.t - t) < Math.abs(melhor.t - t))) melhor = q;
  if (!melhor || Math.abs(melhor.t - t) > 2) return null;
  const c = melhor.caixas;
  return {
    x0: Math.round(Math.min(...c.map((x) => x.x0))),
    y0: Math.round(Math.min(...c.map((x) => x.y0))),
    x1: Math.round(Math.max(...c.map((x) => x.x1))),
    y1: Math.round(Math.max(...c.map((x) => x.y1))),
  };
}

/** Um quadro do vídeo em pé (540 × 960, JPEG) guardado no armazenamento. */
async function fazerPrevia(arm: Armazenamento, base: string, t: number, chave: string, pasta: string) {
  const arquivo = join(pasta, 'previa.jpg');
  await rodar(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-ss',
      t.toFixed(2),
      '-i',
      base,
      '-frames:v',
      '1',
      '-vf',
      'scale=540:960',
      '-q:v',
      '4',
      arquivo,
    ],
    { timeoutMs: 60_000 },
  );
  await arm.enviar(chave, new Uint8Array(await readFile(arquivo)), 'image/jpeg');
  return chave;
}

/* ───────────────────────────── v138: a tela da edição viva ───────────────────────────── */

/** Quantas palavras do começo da fala a tela mostra. */
export const MAX_PALAVRAS_TELA = 60;

/** O rosto a cada 0,25 s nos primeiros segundos (o mapa acompanha a prévia tocando). */
export function trilhaDoRosto(
  rostos: { t: number; caixas: { x0: number; y0: number; x1: number; y1: number }[] }[],
) {
  const out: { t: number; caixa: ReturnType<typeof rostoEm> }[] = [];
  for (let t = 0; t <= SEGUNDOS_PREVIA + 1e-6; t += 0.25)
    out.push({ t: Math.round(t * 100) / 100, caixa: rostoEm(rostos, t) });
  return out;
}

/** Quais palavras do começo saíram e onde entrou um corte de fala embolada (antes de qual palavra). */
export function cortesNaFala(palavras: PalavraVideo[], cortes: CorteVideo[]) {
  const valem = cortes.filter((c) => c.decisao !== 'devolver' && c.tipo !== 'pausa');
  const n = Math.min(palavras.length, MAX_PALAVRAS_TELA);
  const cortadas: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = palavras[k]!;
    const meio = (p.i + p.f) / 2;
    if (valem.some((c) => meio >= c.inicio && meio <= c.fim)) cortadas.push(k);
  }
  const emboladas = valem
    .filter((c) => c.tipo === 'outro' && !c.trecho)
    .map((c) => palavras.findIndex((p) => p.i >= c.fim - 0.01))
    .filter((k) => k >= 0 && k < n);
  return { cortadas, emboladas };
}

/** Os primeiros segundos do vídeo em pé, sem som (540 × 960, leve), para a prévia em loop. */
async function fazerPreviaVideo(arm: Armazenamento, base: string, chave: string, pasta: string) {
  const arquivo = join(pasta, 'previa.mp4');
  await rodar(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-t',
      String(SEGUNDOS_PREVIA),
      '-i',
      base,
      '-an',
      '-vf',
      'scale=540:960,fps=24',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      arquivo,
    ],
    { timeoutMs: 120_000 },
  );
  await arm.enviar(chave, new Uint8Array(await readFile(arquivo)), 'video/mp4');
  return chave;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* ───────────────────────────── v138: a palavra esticada ───────────────────────────── */

const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();

/**
 * O Whisper estica uma palavra por cima da fala embolada ("deseja" com 2 s). Aqui a palavra volta
 * para o lugar dela pelo som (o que sobra vira um vão com som, que o corte de fala embolada pega).
 * Se a palavra ficou no fim, o trecho é ouvido de novo: quando ele começa repetindo a palavra
 * anterior ("Se você… blelelé… você deseja"), a primeira tentativa também vai para o vão.
 */
export async function ajustarEsticadas(
  palavras: PalavraVideo[],
  pcm: Int16Array,
  o: {
    reouvir: ((a: number, b: number) => Promise<PalavraVideo[]>) | null;
    log?: (msg: string) => void;
  },
): Promise<PalavraVideo[]> {
  const out = palavras.map((p) => ({ ...p }));
  for (const k of palavrasEsticadas(palavras)) {
    const p = out[k]!;
    const lugar = partirPalavraEsticada(pcm, p);
    if (!lugar) continue;
    o.log?.(`palavra esticada "${p.t}" (${(p.f - p.i).toFixed(2)} s): fica de ${lugar.i} a ${lugar.f}`);
    out[k] = { ...p, i: lugar.i, f: lugar.f };
    const antes = out[k - 1];
    if (!o.reouvir || !antes || lugar.i <= p.i + 0.01 || p.i - antes.f > 0.3) continue;
    const ouvidas = await o.reouvir(Math.max(0, lugar.i - 0.05), lugar.f + 0.05).catch(() => []);
    const primeira = ouvidas[0];
    if (!primeira || semAcento(primeira.t) !== semAcento(antes.t) || ouvidas.length < 2) continue;
    // "você … você deseja": a primeira tentativa sai junto com a embolação.
    const desloca = lugar.i - 0.05;
    out[k - 1] = { ...antes, i: r3(desloca + primeira.i), f: r3(desloca + primeira.f) };
    out[k] = { ...out[k]!, i: Math.max(out[k]!.i, r3(desloca + primeira.f)) };
    o.log?.(`recomeço "${antes.t}" dentro da embolação: a primeira tentativa sai`);
  }
  return out;
}
