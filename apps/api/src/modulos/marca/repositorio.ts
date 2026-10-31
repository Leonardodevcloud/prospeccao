import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import { recarregarDominios } from '../../dominios.js';
import { temRecurso } from '../../recursos.js';
import { type DominiosSite, explicarErroVercel, type RegistroDns } from './vercel.js';

/**
 * Marca própria do cliente (organização): nome, cor, logo, ícone, imagem de divulgação e o domínio
 * próprio. A marca vale com o recurso "marca" no plano (Escala); o domínio, depois de ativo, continua
 * funcionando mesmo se o plano mudar (ninguém fica sem acesso), só sem a marca.
 */

export type ArquivoMarca = 'logo' | 'logoEscuro' | 'icone' | 'favicon' | 'app' | 'imagem';
export const ARQUIVOS_MARCA: ArquivoMarca[] = ['logo', 'logoEscuro', 'icone', 'favicon', 'app', 'imagem'];
const COLUNA: Record<ArquivoMarca, string> = {
  logo: 'marca_logo',
  logoEscuro: 'marca_logo_escuro',
  icone: 'marca_icone',
  favicon: 'marca_favicon',
  app: 'marca_app',
  imagem: 'marca_imagem',
};

export interface DominioDaMarca {
  endereco: string;
  situacao: 'pendente' | 'ativo';
  registros: RegistroDns[];
  erro: string | null;
  desde: string | null;
  ativoEm: string | null;
  conferidoEm: string | null;
}

export interface DadosMarca {
  organizacaoId: number;
  organizacaoNome: string;
  nome: string | null;
  /** Primária (botões). */
  cor: string | null;
  corSecundaria: string | null;
  corDestaque: string | null;
  corClara: string | null;
  /** Menu lateral na cor secundária. */
  menuEscuro: boolean;
  logo: boolean;
  logoEscuro: boolean;
  icone: boolean;
  favicon: boolean;
  app: boolean;
  imagem: boolean;
  /** Muda a cada salvamento (para o navegador buscar a imagem nova). */
  versao: string;
  dominio: DominioDaMarca | null;
}

export async function dados(db: Executor, organizacaoId: number): Promise<DadosMarca> {
  const { rows } = await db.query<
    DadosMarca & { dominioNome: string | null; situacao: 'pendente' | 'ativo' | null }
  >(
    `SELECT id AS "organizacaoId", nome AS "organizacaoNome", marca_nome AS nome, marca_cor AS cor,
            marca_cor_secundaria AS "corSecundaria", marca_cor_destaque AS "corDestaque",
            marca_cor_clara AS "corClara", marca_menu_escuro AS "menuEscuro",
            marca_logo IS NOT NULL AS logo, marca_logo_escuro IS NOT NULL AS "logoEscuro",
            marca_icone IS NOT NULL AS icone, marca_favicon IS NOT NULL AS favicon,
            marca_app IS NOT NULL AS app, marca_imagem IS NOT NULL AS imagem,
            coalesce(extract(epoch FROM marca_atualizada_em)::bigint, 0)::text AS versao,
            dominio AS "dominioNome", dominio_situacao AS situacao, dominio_registros AS registros,
            dominio_erro AS erro, dominio_desde AS desde, dominio_ativo_em AS "ativoEm",
            dominio_conferido_em AS "conferidoEm"
       FROM cadastro.organizacoes WHERE id = $1`,
    [organizacaoId],
  );
  const r = rows[0] as
    | (DadosMarca & {
        dominioNome: string | null;
        situacao: 'pendente' | 'ativo' | null;
        registros: RegistroDns[];
        erro: string | null;
        desde: string | null;
        ativoEm: string | null;
        conferidoEm: string | null;
      })
    | undefined;
  if (!r) throw AppError.naoEncontrado('Organização');
  return {
    organizacaoId: r.organizacaoId,
    organizacaoNome: r.organizacaoNome,
    nome: r.nome,
    cor: r.cor,
    corSecundaria: r.corSecundaria,
    corDestaque: r.corDestaque,
    corClara: r.corClara,
    menuEscuro: r.menuEscuro,
    logo: r.logo,
    logoEscuro: r.logoEscuro,
    icone: r.icone,
    favicon: r.favicon,
    app: r.app,
    imagem: r.imagem,
    versao: r.versao,
    dominio:
      r.dominioNome && r.situacao
        ? {
            endereco: r.dominioNome,
            situacao: r.situacao,
            registros: r.registros ?? [],
            erro: r.erro,
            desde: r.desde,
            ativoEm: r.ativoEm,
            conferidoEm: r.conferidoEm,
          }
        : null,
  };
}

export async function arquivo(db: Executor, organizacaoId: number, tipo: ArquivoMarca) {
  const col = COLUNA[tipo];
  const { rows } = await db.query<{ dados: Buffer | null; tipo: string | null }>(
    `SELECT ${col} AS dados, ${col}_tipo AS tipo FROM cadastro.organizacoes WHERE id = $1`,
    [organizacaoId],
  );
  return rows[0]?.dados ? { dados: rows[0].dados, tipo: rows[0].tipo ?? 'image/png' } : null;
}

/** Organização dona do domínio (ativo e com o cliente ativo), pelo endereço que o navegador abriu. */
export async function organizacaoDoEndereco(db: Executor, host: string): Promise<number | null> {
  const h = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!h) return null;
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM cadastro.organizacoes WHERE dominio = $1 AND dominio_situacao = 'ativo' AND ativa`,
    [h],
  );
  return rows[0]?.id ?? null;
}

/** A organização tem a marca própria no plano? (Pela primeira unidade ativa dela.) */
export async function marcaNoPlano(db: Executor, organizacaoId: number): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM cadastro.contas WHERE organizacao_id = $1 ORDER BY ativa DESC, id LIMIT 1',
    [organizacaoId],
  );
  return rows[0] ? temRecurso(db, 'marca', rows[0].id) : false;
}

/** Quem pode mexer: o gestor da organização, ou o administrador quando ela tem uma unidade só. */
export async function podeEditar(
  db: Executor,
  u: { master: boolean; papel: string; papelOrganizacao: string | null; organizacaoId: number },
): Promise<boolean> {
  if (u.master || u.papelOrganizacao === 'gestor') return true;
  if (u.papel !== 'admin' || u.papelOrganizacao === 'leitura') return false;
  const { rows } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM cadastro.contas WHERE organizacao_id = $1 AND ativa',
    [u.organizacaoId],
  );
  return (rows[0]?.n ?? 0) <= 1;
}

/** Endereços que não podem ser de cliente (os da plataforma). */
export function dominioDaPlataforma(dominio: string, origens: string[]): boolean {
  const nossos = origens
    .map((o) => {
      try {
        return new URL(o).hostname;
      } catch {
        return '';
      }
    })
    .filter(Boolean);
  const raizes = new Set(['prospectteam.com.br', 'vercel.app', ...nossos]);
  return [...raizes].some((r) => dominio === r || dominio.endsWith(`.${r}`));
}

async function gravarSituacao(
  db: Executor,
  organizacaoId: number,
  d: { situacao: 'pendente' | 'ativo'; registros: RegistroDns[]; erro: string | null },
): Promise<void> {
  await db.query(
    `UPDATE cadastro.organizacoes
        SET dominio_situacao = $2, dominio_registros = $3, dominio_erro = $4, dominio_conferido_em = now(),
            dominio_ativo_em = CASE WHEN $2 = 'ativo' THEN coalesce(dominio_ativo_em, now()) ELSE NULL END
      WHERE id = $1`,
    [organizacaoId, d.situacao, JSON.stringify(d.registros), d.erro],
  );
}

/** O que falta, em português, a partir do que o Vercel viu. */
function oQueFalta(s: { verificado: boolean; configurado: boolean }): string | null {
  if (!s.verificado) return 'Falta o registro TXT de verificação (o endereço já foi usado em outro site).';
  if (!s.configurado) return 'O registro ainda não chegou: o DNS pode levar de minutos a algumas horas.';
  return null;
}

/** Cadastra o domínio no Vercel e guarda o que o cliente precisa criar no DNS. */
export async function definirDominio(
  db: Executor,
  site: DominiosSite,
  organizacaoId: number,
  dominio: string,
): Promise<void> {
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM cadastro.organizacoes WHERE dominio = $1 AND id <> $2',
    [dominio, organizacaoId],
  );
  if (rows[0]) throw AppError.conflito('Este endereço já é usado por outra empresa no sistema.');
  const atual = await dados(db, organizacaoId);
  if (atual.dominio?.endereco === dominio)
    return conferirDominio(db, site, organizacaoId).then(() => undefined);
  let s: Awaited<ReturnType<DominiosSite['adicionar']>>;
  try {
    s = await site.adicionar(dominio);
  } catch (erro) {
    throw AppError.invalido(explicarErroVercel(erro));
  }
  // Trocou de endereço: o anterior sai do projeto.
  if (atual.dominio) await site.remover(atual.dominio.endereco).catch(() => undefined);
  const ativo = s.verificado && s.configurado;
  await db.query(
    `UPDATE cadastro.organizacoes
        SET dominio = $2, dominio_situacao = $3, dominio_registros = $4, dominio_erro = $5,
            dominio_desde = now(), dominio_conferido_em = now(),
            dominio_ativo_em = CASE WHEN $3 = 'ativo' THEN now() ELSE NULL END
      WHERE id = $1`,
    [
      organizacaoId,
      dominio,
      ativo ? 'ativo' : 'pendente',
      JSON.stringify(s.registros),
      ativo ? null : oQueFalta(s),
    ],
  );
  await recarregarDominios(db);
}

/** Confere no Vercel se o DNS já chegou. Devolve se ficou ativo agora. */
export async function conferirDominio(
  db: Executor,
  site: DominiosSite,
  organizacaoId: number,
): Promise<boolean> {
  const atual = await dados(db, organizacaoId);
  if (!atual.dominio) throw AppError.naoEncontrado('Domínio');
  const antes = atual.dominio.situacao;
  try {
    const s = await site.conferir(atual.dominio.endereco);
    const ativo = s.verificado && s.configurado;
    await gravarSituacao(db, organizacaoId, {
      situacao: ativo ? 'ativo' : 'pendente',
      registros: s.registros,
      erro: ativo ? null : oQueFalta(s),
    });
    if (ativo !== (antes === 'ativo')) await recarregarDominios(db);
    return ativo && antes !== 'ativo';
  } catch (erro) {
    // O serviço não respondeu: mantém como estava e diz o que houve.
    await db.query(
      'UPDATE cadastro.organizacoes SET dominio_erro = $2, dominio_conferido_em = now() WHERE id = $1',
      [organizacaoId, explicarErroVercel(erro)],
    );
    return false;
  }
}

export async function removerDominio(
  db: Executor,
  site: DominiosSite | null,
  organizacaoId: number,
): Promise<void> {
  const atual = await dados(db, organizacaoId);
  if (!atual.dominio) return;
  if (site) await site.remover(atual.dominio.endereco).catch(() => undefined);
  await db.query(
    `UPDATE cadastro.organizacoes
        SET dominio = NULL, dominio_situacao = NULL, dominio_registros = '[]', dominio_erro = NULL,
            dominio_desde = NULL, dominio_ativo_em = NULL, dominio_conferido_em = NULL
      WHERE id = $1`,
    [organizacaoId],
  );
  await recarregarDominios(db);
}

/** Domínios esperando o DNS (os da última semana): a rotina confere sozinha. */
export async function pendentes(db: Executor): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM cadastro.organizacoes
      WHERE dominio_situacao = 'pendente' AND dominio_desde > now() - interval '7 days' AND ativa`,
  );
  return rows.map((r) => r.id);
}
