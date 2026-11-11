import { createHash } from 'node:crypto';
import type { Executor } from '@prospeccao/db';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { dataUrl, desenharSlide, prepararImagem } from '@prospeccao/integrations/slides';
import {
  type EstiloCarrossel,
  type FormatoPeca,
  type IdentidadeCarrossel,
  type LogoSlide,
  montarSlide,
  type SlideCarrossel,
} from '@prospeccao/shared/carrosseis';
import { conta } from '../../contexto.js';
import * as marca from '../marca/repositorio.js';
import { organizacaoDaConta } from '../plano/repositorio.js';
import * as repo from './repositorio.js';

/**
 * Desenho dos slides na api: junta a identidade da conta, as logos (as próprias dos carrosséis ou as
 * de Marca e domínio) e a foto de cada slide, monta a árvore (shared) e desenha o JPEG.
 * Guarda na memória as últimas imagens e fotos usadas: a mesma prévia pedida de novo sai na hora.
 */

class Lembranca<T> {
  private mapa = new Map<string, T>();
  constructor(private readonly max: number) {}
  obter(k: string): T | undefined {
    const v = this.mapa.get(k);
    if (v !== undefined) {
      this.mapa.delete(k);
      this.mapa.set(k, v);
    }
    return v;
  }
  guardar(k: string, v: T): void {
    this.mapa.delete(k);
    this.mapa.set(k, v);
    while (this.mapa.size > this.max) this.mapa.delete(this.mapa.keys().next().value as string);
  }
}

const imagens = new Lembranca<Buffer>(240);
const fotosLidas = new Lembranca<string>(16);
const logosLidas = new Lembranca<LogoSlide | null>(40);

export interface MaterialDaConta {
  identidade: IdentidadeCarrossel;
  logoClaro: LogoSlide | null;
  logoEscuro: LogoSlide | null;
  /** Muda quando a identidade ou uma logo muda (entra na chave das imagens guardadas). */
  versao: string;
}

async function lerArquivo(arm: Armazenamento | null, chave: string): Promise<Uint8Array | null> {
  if (!arm) return null;
  return arm.ler(chave).catch(() => null);
}

async function logoDaMarca(db: Executor, tipo: 'logo' | 'logoEscuro'): Promise<LogoSlide | null> {
  const org = await organizacaoDaConta(db, conta());
  const a = await marca.arquivo(db, org, tipo);
  if (!a) return null;
  const chave = `marca:${org}:${tipo}:${createHash('sha1').update(a.dados).digest('hex').slice(0, 12)}`;
  const lembrada = logosLidas.obter(chave);
  if (lembrada !== undefined) return lembrada;
  const p = await prepararImagem(a.dados, { maxLado: 900, manterTransparencia: true }).catch(() => null);
  const logo = p ? { src: dataUrl(p.dados, p.tipo), largura: p.largura, altura: p.altura } : null;
  logosLidas.guardar(chave, logo);
  return logo;
}

async function logoPropria(
  arm: Armazenamento | null,
  l: repo.LogoGuardada | null,
): Promise<LogoSlide | null> {
  if (!l) return null;
  const lembrada = logosLidas.obter(l.chave);
  if (lembrada !== undefined) return lembrada;
  const dados = await lerArquivo(arm, l.chave);
  const logo = dados ? { src: dataUrl(dados, 'image/png'), largura: l.largura, altura: l.altura } : null;
  logosLidas.guardar(l.chave, logo);
  return logo;
}

/** Identidade e logos da conta, prontas para desenhar. `identidade` troca a salva (prévia sem salvar). */
export async function materialDaConta(
  db: Executor,
  arm: Armazenamento | null,
  identidade?: IdentidadeCarrossel,
): Promise<MaterialDaConta> {
  const g = await repo.identidade(db);
  const id = identidade ?? g.identidade;
  const marcaLiberada = id.usarLogoDaMarca;
  const [claro, escuro] = await Promise.all([
    g.logos.claro ? logoPropria(arm, g.logos.claro) : marcaLiberada ? logoDaMarca(db, 'logo') : null,
    g.logos.escuro ? logoPropria(arm, g.logos.escuro) : marcaLiberada ? logoDaMarca(db, 'logoEscuro') : null,
  ]);
  const versao = createHash('sha1')
    .update(
      JSON.stringify([
        id,
        g.logos.claro?.chave,
        g.logos.escuro?.chave,
        claro?.src.length,
        escuro?.src.length,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  return { identidade: id, logoClaro: claro, logoEscuro: escuro, versao };
}

/** Foto do slide em data URL (null: sem foto, foto de outra conta ou armazenamento desligado). */
export async function fotoDoSlide(
  db: Executor,
  arm: Armazenamento | null,
  fotoId: number | null,
): Promise<string | null> {
  if (!fotoId || !arm) return null;
  const f = await repo.foto(db, fotoId);
  if (!f) return null;
  const lembrada = fotosLidas.obter(f.chave);
  if (lembrada) return lembrada;
  const dados = await lerArquivo(arm, f.chave);
  if (!dados) return null;
  const url = dataUrl(dados, 'image/jpeg');
  fotosLidas.guardar(f.chave, url);
  return url;
}

export interface PedidoDesenho {
  slide: SlideCarrossel;
  indice: number;
  total: number;
  estilo: EstiloCarrossel;
  largura?: number;
  /** v144: feed (padrão) ou story. */
  formato?: FormatoPeca;
}

/** Desenha um slide (JPEG). Devolve também os avisos de quem edita e a chave (para o ETag). */
export async function desenhar(
  db: Executor,
  arm: Armazenamento | null,
  material: MaterialDaConta,
  p: PedidoDesenho,
): Promise<{ jpeg: Buffer; avisos: string[]; etag: string }> {
  const foto = await fotoDoSlide(db, arm, p.slide.fotoId);
  const montado = montarSlide({
    slide: p.slide,
    indice: p.indice,
    total: p.total,
    identidade: material.identidade,
    estilo: p.estilo,
    foto,
    logoClaro: material.logoClaro,
    logoEscuro: material.logoEscuro,
    formato: p.formato ?? 'feed',
  });
  const largura = Math.min(1080, Math.max(160, Math.round(p.largura ?? 1080)));
  const etag = createHash('sha1')
    .update(
      JSON.stringify([
        material.versao,
        p.slide,
        p.indice,
        p.total,
        p.estilo,
        largura,
        foto ? foto.length : 0,
        p.formato ?? 'feed',
      ]),
    )
    .digest('hex')
    .slice(0, 24);
  const guardada = imagens.obter(etag);
  if (guardada) return { jpeg: guardada, avisos: montado.avisos, etag };
  const jpeg = await desenharSlide(montado.no, {
    largura,
    qualidade: largura < 1080 ? 86 : 92,
    peca: p.formato ?? 'feed',
  });
  imagens.guardar(etag, jpeg);
  return { jpeg, avisos: montado.avisos, etag };
}
