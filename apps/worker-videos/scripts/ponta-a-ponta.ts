/**
 * Teste de ponta a ponta da edição com um vídeo de verdade, sem serviços de fora: armazenamento
 * numa pasta (servida por um HTTP local), transcrição por um programa local (VIDEOS_OUVIR_LOCAL,
 * que recebe um .wav e escreve um JSON de palavras) e a decisão dos cortes pelas regras ou por uma
 * decisão gravada em JSON (VIDEOS_DECISAO). Os enfeites (v129) vêm de um plano gravado
 * (VIDEOS_ENFEITES, o JSON que a IA devolveria); a imagem gerada e a música são feitas pelo ffmpeg
 * aqui (só para conferir a montagem), e uma foto da empresa e uma promoção entram no banco. Uso:
 *   TEST_DATABASE_URL=… VIDEOS_OUVIR_LOCAL="python3 -I transcrever.py" pnpm tsx scripts/ponta-a-ponta.ts video.mp4 saida.mp4
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { criarPool, migrar } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { ClienteClaude } from '@prospeccao/integrations/carrosseis';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { type DecisaoDaIa, lerDecisao } from '@prospeccao/integrations/videos';
import { criarLogger } from '@prospeccao/shared';
import type { PalavraVideo } from '@prospeccao/shared/videos';
import { editarVideo } from '../src/editar.js';

const exec = promisify(execFile);
const [entrada, saida, opcoesJson] = process.argv.slice(2);
if (!entrada || !saida || !process.env.TEST_DATABASE_URL) {
  console.error('uso: TEST_DATABASE_URL=… tsx scripts/ponta-a-ponta.ts entrada.mp4 saida.mp4 [opcoes.json]');
  process.exit(1);
}
const log = criarLogger('e2e', 'info');
const pasta = join(tmpdir(), `e2e-videos-${Date.now()}`);
await mkdir(join(pasta, 'arm'), { recursive: true });

// Armazenamento numa pasta.
const arquivos = new Map<string, Uint8Array>();
const partes = new Map<string, Uint8Array[]>();
const servidor = createServer((req, res) => {
  const chave = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]!);
  const a = arquivos.get(chave);
  if (!a) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-length': a.length }).end(Buffer.from(a));
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const porta = (servidor.address() as { port: number }).port;
const arm = {
  destino: { endpoint: '', regiao: 'auto', bucket: 'b', chave: 'k', segredo: 's'.repeat(10) },
  async urlAssinada(chave: string) {
    return `http://127.0.0.1:${porta}/${encodeURIComponent(chave)}`;
  },
  async apagar(chaves: string[]) {
    for (const k of chaves) arquivos.delete(k);
  },
  async enviar(chave: string, corpo: Uint8Array) {
    arquivos.set(chave, new Uint8Array(corpo));
  },
  async ler(chave: string) {
    return arquivos.get(chave)!;
  },
  async iniciarEmPartes(chave: string) {
    partes.set(chave, []);
    return chave;
  },
  async enviarParte(chave: string, _id: string, numero: number, corpo: Uint8Array) {
    partes.get(chave)![numero - 1] = new Uint8Array(corpo);
    return `"${numero}"`;
  },
  async concluirEmPartes(chave: string) {
    arquivos.set(chave, new Uint8Array(Buffer.concat(partes.get(chave)!)));
  },
  async cancelarEmPartes(chave: string) {
    partes.delete(chave);
  },
  async testar() {
    return 'ok';
  },
} as unknown as Armazenamento;

// Banco.
const url = await bancoDeTeste(process.env.TEST_DATABASE_URL, 'videos_e2e');
const pool = criarPool({ url, aplicacao: 'e2e' });
await migrar(pool, log);
const opcoes = opcoesJson ? JSON.parse(await readFile(opcoesJson, 'utf8')) : {};
arquivos.set('videos/1/1/original', new Uint8Array(await readFile(entrada)));
await pool.query(
  `INSERT INTO comercial.videos (id, conta_id, titulo, situacao, opcoes, original_chave, original_nome, original_tipo, original_bytes)
   VALUES (1, 1, 'Teste', 'na_fila', $1, 'videos/1/1/original', 'video.mp4', 'video/mp4', 1)`,
  [
    JSON.stringify({
      assunto: '',
      estilo: 'acesa',
      ritmo: 'dinamico',
      transicao: 'alternada',
      chamada: { tipo: 'comente', palavra: 'QUERO', texto: '' },
      instrucoes: '',
      ...opcoes,
    }),
  ],
);

// Transcrição local.
const [prog, ...args] = (process.env.VIDEOS_OUVIR_LOCAL ?? 'python3 -I transcrever.py').split(' ');
const ouvir = async (audio: Uint8Array<ArrayBuffer>) => {
  const f = join(pasta, `fala-${Date.now()}.flac`);
  await writeFile(f, audio);
  const w = f.replace('.flac', '.wav');
  await exec('ffmpeg', ['-v', 'error', '-y', '-i', f, '-ac', '1', '-ar', '16000', w]);
  const j = f.replace('.flac', '.json');
  await exec(prog!, [...args, w, j], { maxBuffer: 1 << 26 });
  const segs = JSON.parse(await readFile(j, 'utf8')) as {
    palavras: { p: string; i: number; f: number; prob: number }[];
  }[];
  return segs.flatMap((s) => s.palavras.map((p) => ({ t: p.p, i: p.i, f: p.f }) as PalavraVideo));
};
// Foto da empresa e promoção (para o plano gravado poder usar foto_id 1 e divulgar_id 1).
const foto = join(pasta, 'foto.jpg');
await exec('ffmpeg', [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=s=1080x1080',
  '-frames:v',
  '1',
  foto,
]);
arquivos.set('carrosseis/1/fotos/1.jpg', new Uint8Array(await readFile(foto)));
await pool.query(
  `INSERT INTO comercial.carrossel_fotos (id, conta_id, nome, chave, largura, altura, bytes, descricao_ia)
   VALUES (1, 1, 'produto.jpg', 'carrosseis/1/fotos/1.jpg', 1080, 1080, 1000, 'Peça de freio sobre a bancada da loja')`,
);
await pool.query(
  `INSERT INTO comercial.carrossel_divulgar (id, conta_id, tipo, titulo, dados)
   VALUES (1, 1, 'promocao', 'Pastilha em promoção', '{"produto":"Pastilha de freio cerâmica","precoDe":"R$ 129,90","precoPor":"R$ 89,90","validade":"Até sábado"}')`,
);
const enfeitesGravados = process.env.VIDEOS_ENFEITES
  ? JSON.parse(await readFile(process.env.VIDEOS_ENFEITES, 'utf8'))
  : null;
const claudeDeMentira = (): ClienteClaude => ({
  modelo: 'gravado',
  async pedir(p) {
    const r = (dados: Record<string, unknown>) => ({
      dados,
      uso: { entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 0 },
      custoUsd: 0,
    });
    if (p.ferramenta.nome === 'propor_enfeites') {
      await writeFile(join(pasta, 'pedido-enfeites.txt'), p.mensagem);
      return r(enfeitesGravados);
    }
    if (p.ferramenta.nome === 'conferir_imagem')
      return r({
        tem_texto: false,
        tem_marca: false,
        rosto_em_destaque: false,
        defeito: false,
        combina: true,
        problemas: [],
      });
    if (p.ferramenta.nome === 'descrever_fotos') return r({ fotos: [] });
    return r({ encaixe: 'acima', motivo: 'teste' });
  },
});
const gerarImagemLocal = async (e: { descricao: string; formato: 'cheia' | 'acima' }) => {
  const f = join(pasta, `gerada-${Date.now()}.jpg`);
  const t = e.formato === 'cheia' ? '1088x1920' : '1536x960';
  await exec('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `gradients=s=${t}:c0=0x1e3a5f:c1=0xd97706:speed=0.01:d=1`,
    '-frames:v',
    '1',
    f,
  ]);
  return new Uint8Array(await readFile(f));
};
const musicaLocal = async (e: { segundos: number }) => {
  const f = join(pasta, `musica-${Date.now()}.mp3`);
  const acorde = '0.12*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.55+0.45*sin(2*PI*2*t))';
  await exec('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='${acorde}':s=44100:d=${e.segundos}`,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    f,
  ]);
  return new Uint8Array(await readFile(f));
};

const decisaoGravada = process.env.VIDEOS_DECISAO
  ? JSON.parse(await readFile(process.env.VIDEOS_DECISAO, 'utf8'))
  : null;

const inicio = Date.now();
await editarVideo(
  {
    db: pool,
    arm,
    log,
    ouvir,
    decidir: decisaoGravada
      ? async (e) => {
          await writeFile(
            join(pasta, 'fala-numerada.txt'),
            e.palavras.map((p, k) => `${k}: ${p.t} (${p.i})`).join('\n'),
          );
          const decisao: DecisaoDaIa = lerDecisao(decisaoGravada, e.palavras.length);
          return { decisao, custoUsd: 0 };
        }
      : null,
    claude: enfeitesGravados ? () => claudeDeMentira() : null,
    gerarImagem: gerarImagemLocal,
    comporMusica: musicaLocal,
    musicaLiberada: () => true,
    custoImagemUsd: 0.05,
    custoMusicaMinutoUsd: 0.15,
    pasta,
    navegador: process.env.HYPERFRAMES_BROWSER_PATH ?? null,
    workersRender: 2,
    custoServidorHora: 0.06,
    custoTranscricaoHora: 0.111,
  },
  1,
  'primeira',
);
const { rows } = await pool.query(
  'SELECT situacao, erro, duracao_original, duracao_final, conferencia, cortes, final_chave, animacoes, imagens, sem_imagem, som FROM comercial.videos WHERE id = 1',
);
const v = rows[0];
console.log(
  JSON.stringify(
    {
      ...v,
      cortes: v.cortes.map(
        (c: { tipo: string; inicio: number; fim: number; motivo: string; duvida: boolean }) =>
          `${c.tipo} ${c.inicio}-${c.fim} ${c.duvida ? '(dúvida) ' : ''}${c.motivo}`,
      ),
    },
    null,
    1,
  ),
);
if (v.final_chave) await writeFile(saida, arquivos.get(v.final_chave)!);
console.log(`levou ${Math.round((Date.now() - inicio) / 1000)} s`);
servidor.close();
await pool.end();
