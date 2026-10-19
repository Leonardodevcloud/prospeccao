import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import type { Coletor } from './coletor.js';

/** Leituras de outros domínios (só views) e escritas no schema enriquecimento. */

export interface EmpresaEnriquecer {
  id: number;
  nome: string;
  razao_social: string | null;
  cnpj: string | null;
  cnpj_basico: string | null;
  porte: string | null;
  data_abertura: string | null;
  cidade: string;
  uf: string;
  telefones_receita: string[];
  email_receita: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
  place_id: string | null;
  maps_url: string | null;
  maps_categoria: string | null;
  maps_nota: number | null;
  maps_avaliacoes: number | null;
  maps_site: string | null;
  maps_telefone: string | null;
  maps_fechada: boolean | null;
  sinal_entrega: boolean | null;
}

export interface CampanhaEnriquecer {
  id: number;
  nome: string;
  status: string;
  nicho_nome: string;
  cargos_alvo: string[];
}

export interface Socio {
  nome: string;
  tipo: string;
  qualificacao: string;
  prioridade: number;
  data_entrada: string | null;
}

export async function obterEmpresa(
  db: Executor,
  empresaId: number,
  campanhaId: number,
): Promise<EmpresaEnriquecer | null> {
  const { rows } = await db.query<EmpresaEnriquecer>(
    `SELECT id, nome, razao_social, cnpj, cnpj_basico, porte, data_abertura, cidade, uf, telefones_receita,
            email_receita, logradouro, numero, bairro, cep, place_id, maps_url, maps_categoria, maps_nota::float8 AS maps_nota, maps_avaliacoes, maps_site,
            maps_telefone, maps_fechada, sinal_entrega
       FROM descoberta.v_empresas_campanha
      WHERE id = $1 AND campanha_id = $2`,
    [empresaId, campanhaId],
  );
  return rows[0] ?? null;
}

export async function obterCampanha(db: Executor, id: number): Promise<CampanhaEnriquecer | null> {
  const { rows } = await db.query<CampanhaEnriquecer>(
    'SELECT id, nome, status, nicho_nome, cargos_alvo FROM cadastro.v_campanhas_enriquecimento WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function obterSocios(db: Executor, cnpjBasico: string): Promise<Socio[]> {
  const { rows } = await db.query<Socio>(
    `SELECT nome, tipo, qualificacao, prioridade, data_entrada
       FROM base_cnpj.v_socios
      WHERE cnpj_basico = $1 AND tipo <> 'pj'
      ORDER BY prioridade, data_entrada NULLS LAST
      LIMIT 10`,
    [cnpjBasico],
  );
  return rows;
}

/** Enriquecida há menos de N dias? Evita gastar de novo com a mesma empresa. */
export async function enriquecidaRecentemente(
  db: Executor,
  empresaId: number,
  dias: number,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM enriquecimento.leads
      WHERE empresa_id = $1 AND status = 'concluido' AND concluido_em > now() - make_interval(days => $2)`,
    [empresaId, dias],
  );
  return rows.length > 0;
}

export async function iniciar(db: Executor, empresaId: number, campanhaId: number) {
  await db.query(
    `INSERT INTO enriquecimento.leads (empresa_id, campanha_id, status, iniciado_em, tentativas)
     VALUES ($1, $2, 'rodando', now(), 1)
     ON CONFLICT (empresa_id) DO UPDATE
        SET campanha_id = EXCLUDED.campanha_id, status = 'rodando', iniciado_em = now(),
            tentativas = enriquecimento.leads.tentativas + 1, erro = NULL`,
    [empresaId, campanhaId],
  );
  await db.query('DELETE FROM enriquecimento.etapas WHERE empresa_id = $1', [empresaId]);
}

export type NomeEtapa =
  | 'receita'
  | 'maps'
  | 'site'
  | 'google'
  | 'instagram'
  | 'ia'
  | 'linkedin'
  | 'places'
  | 'whatsapp';
export type StatusEtapa = 'encontrado' | 'sem_resultado' | 'pulada' | 'erro';

export async function registrarEtapa(
  db: Executor,
  empresaId: number,
  ordem: number,
  etapa: NomeEtapa,
  status: StatusEtapa,
  detalhe: string,
  url: string | null = null,
) {
  await db.query(
    `INSERT INTO enriquecimento.etapas (empresa_id, ordem, etapa, status, detalhe, url)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [empresaId, ordem, etapa, status, detalhe.slice(0, 500), url],
  );
}

export interface Conclusao {
  faixa: 'A' | 'B' | 'C';
  score: number;
  motivo: string;
  resumo: string | null;
  entrega: boolean | null;
  cnpjAchado: string | null;
  site: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedinEmpresa: string | null;
  mapsAberto: boolean | null;
}

/**
 * Grava a rodada inteira numa transação: troca pessoas e contatos automáticos pelos novos
 * (os cadastrados à mão ficam) e fecha o lead com a nota.
 */
export async function concluir(pool: Pool, empresaId: number, coletor: Coletor, c: Conclusao) {
  await comTransacao(pool, async (tx) => {
    await tx.query(`DELETE FROM enriquecimento.contatos WHERE empresa_id = $1 AND fonte <> 'manual'`, [
      empresaId,
    ]);
    await tx.query(
      `DELETE FROM enriquecimento.pessoas p WHERE empresa_id = $1
          AND NOT EXISTS (SELECT 1 FROM enriquecimento.contatos c WHERE c.pessoa_id = p.id)`,
      [empresaId],
    );

    const ids = new Map<string, number>();
    for (const p of coletor.pessoas.values()) {
      const { rows } = await tx.query<{ id: number }>(
        `INSERT INTO enriquecimento.pessoas
           (empresa_id, nome, cargo, papel, decisor, prioridade, desde, linkedin_url, fontes, url_origem,
            evidencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (empresa_id, nome_chave) DO UPDATE
            SET cargo = coalesce(EXCLUDED.cargo, enriquecimento.pessoas.cargo),
                papel = EXCLUDED.papel, decisor = EXCLUDED.decisor, prioridade = EXCLUDED.prioridade,
                desde = coalesce(EXCLUDED.desde, enriquecimento.pessoas.desde),
                linkedin_url = coalesce(EXCLUDED.linkedin_url, enriquecimento.pessoas.linkedin_url),
                fontes = EXCLUDED.fontes, url_origem = EXCLUDED.url_origem,
                evidencia = coalesce(EXCLUDED.evidencia, enriquecimento.pessoas.evidencia)
         RETURNING id`,
        [
          empresaId,
          p.nome,
          p.cargo,
          p.papel,
          p.decisor,
          p.prioridade,
          p.desde,
          p.linkedin,
          [...p.fontes],
          p.urlOrigem,
          p.evidencia,
        ],
      );
      if (rows[0]) ids.set(p.nome, rows[0].id);
    }

    for (const ct of coletor.contatos.values()) {
      await tx.query(
        `INSERT INTO enriquecimento.contatos
           (empresa_id, pessoa_id, canal, valor, rotulo, fonte, fontes, url_origem, confianca, status,
            whatsapp, verificado_em, principal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::boolean, CASE WHEN $11::boolean IS NOT NULL THEN now() END, $12)
         ON CONFLICT (empresa_id, canal, valor) DO NOTHING`,
        [
          empresaId,
          ct.pessoa ? (ids.get(ct.pessoa) ?? null) : null,
          ct.canal,
          ct.valor,
          ct.rotulo,
          ct.fonte,
          [...ct.fontes],
          ct.urlOrigem,
          ct.confianca,
          ct.status,
          ct.whatsapp,
          ct.principal,
        ],
      );
    }

    await tx.query(
      `UPDATE enriquecimento.leads
          SET status = 'concluido', concluido_em = now(), erro = NULL,
              faixa = $2, score = $3, motivo = $4, resumo = $5, entrega = $6, cnpj_achado = $7,
              site_url = $8, instagram = $9, facebook = $10, linkedin_empresa = $11, maps_aberto = $12
        WHERE empresa_id = $1`,
      [
        empresaId,
        c.faixa,
        c.score,
        c.motivo,
        c.resumo,
        c.entrega,
        c.cnpjAchado,
        c.site,
        c.instagram,
        c.facebook,
        c.linkedinEmpresa,
        c.mapsAberto,
      ],
    );
  });
}

export async function marcarErro(db: Executor, empresaId: number, erro: string) {
  await db.query(
    `UPDATE enriquecimento.leads SET status = 'erro', erro = $2, concluido_em = now() WHERE empresa_id = $1`,
    [empresaId, erro.slice(0, 500)],
  );
}
