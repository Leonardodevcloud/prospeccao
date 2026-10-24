import { comTransacao, type Executor } from '@prospeccao/db';
import { ErroDefinitivo } from '@prospeccao/queue';
import { type LeadImportado, normalizarCidade, normalizarNome } from '@prospeccao/shared';
import { SIMILARIDADE_SO_CIDADE } from './cruzamento.js';
import type { Deps } from './dependencias.js';

/**
 * Leads que o cliente importou (Excel, CSV ou PDF), já lidos e conferidos por ele na tela. Cada lead
 * vira (ou reaproveita) uma empresa da base, entra na lista e ganha os contatos do arquivo, que ficam
 * só na conta dele (conta_id). Depois, se ele pediu, vai para o enriquecimento; a api põe no funil.
 */

interface Importacao {
  id: number;
  conta_id: number;
  campanha_id: number | null;
  status: string;
  leads: (LeadImportado & { empresaId?: number })[] | null;
  opcoes: { enriquecer?: boolean; funil?: { responsavelId: number | null } | null } | null;
}

/** Lote por transação (e de quanto em quanto a tela vê o andamento). */
const LOTE = 50;

export async function importarLeads(deps: Deps, importacaoId: number) {
  const { rows } = await deps.pool.query<Importacao>(
    `SELECT id, conta_id, campanha_id, status, leads, opcoes FROM cadastro.importacoes_leads WHERE id = $1`,
    [importacaoId],
  );
  const imp = rows[0];
  if (!imp) throw new ErroDefinitivo(`Importação ${importacaoId} não existe`);
  if (!['na_fila', 'gravando', 'erro'].includes(imp.status)) return; // já gravada
  if (!imp.campanha_id || !imp.leads) throw new ErroDefinitivo(`Importação ${importacaoId} sem lista`);
  const campanhaId = imp.campanha_id;
  const leads = imp.leads;

  await deps.pool.query(
    `UPDATE cadastro.importacoes_leads SET status = 'gravando', erro = NULL, iniciado_em = coalesce(iniciado_em, now())
      WHERE id = $1`,
    [imp.id],
  );
  const r = { novas: 0, existentes: 0, jaNaLista: 0, enriquecer: 0 };
  try {
    for (let i = 0; i < leads.length; i += LOTE) {
      await comTransacao(deps.pool, async (db) => {
        for (const l of leads.slice(i, i + LOTE)) {
          const g = await gravarLead(db, imp.conta_id, campanhaId, l);
          l.empresaId = g.empresaId;
          if (g.nova) r.novas++;
          else r.existentes++;
          if (!g.ligada) r.jaNaLista++;
        }
      });
      await deps.pool.query(`UPDATE cadastro.importacoes_leads SET gravados = $2 WHERE id = $1`, [
        imp.id,
        Math.min(leads.length, i + LOTE),
      ]);
    }

    const ids = [...new Set(leads.map((l) => l.empresaId).filter((x): x is number => !!x))];
    if (imp.opcoes?.enriquecer) {
      // Só o que ainda não foi pedido nesta lista (importar de novo não paga duas vezes).
      const { rows: pedir } = await deps.pool.query<{ empresa_id: number }>(
        `UPDATE descoberta.campanha_empresas SET enriquecimento_solicitado_em = now(), dentro_do_raio = true
          WHERE campanha_id = $1 AND empresa_id = ANY($2::bigint[]) AND enriquecimento_solicitado_em IS NULL
          RETURNING empresa_id`,
        [campanhaId, ids],
      );
      for (const p of pedir)
        await deps.filas.publicar('enriquecimento.solicitar', {
          empresaId: Number(p.empresa_id),
          campanhaId,
        });
      r.enriquecer = pedir.length;
    }

    await deps.pool.query(
      `UPDATE cadastro.importacoes_leads
          SET status = $2, leads = $3, empresa_ids = $4, resultado = resultado || $5::jsonb, gravados = total,
              concluido_em = CASE WHEN $2 = 'concluida' THEN now() END
        WHERE id = $1`,
      [imp.id, imp.opcoes?.funil ? 'funil' : 'concluida', JSON.stringify(leads), ids, JSON.stringify(r)],
    );
    deps.log.info({ importacaoId, campanhaId, leads: leads.length, ...r }, 'leads importados gravados');
  } catch (erro) {
    await deps.pool.query(`UPDATE cadastro.importacoes_leads SET status = 'erro', erro = $2 WHERE id = $1`, [
      imp.id,
      erro instanceof Error ? erro.message.slice(0, 300) : String(erro),
    ]);
    throw erro;
  }
}

/** Uma linha: acha ou cria a empresa, liga à lista e grava os contatos do arquivo (privados da conta). */
export async function gravarLead(
  db: Executor,
  contaId: number,
  campanhaId: number,
  l: LeadImportado,
): Promise<{ empresaId: number; nova: boolean; ligada: boolean }> {
  const uf = l.uf ?? '';
  const cidade = normalizarCidade(l.cidade ?? '');
  const achou = await acharEmpresa(db, l, uf, cidade);
  let achada = achou?.id ?? null;
  let nova = achou?.nova ?? false;
  if (!achada) {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO descoberta.empresas (cnpj, nome, cidade, uf, cep, logradouro)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cnpj) DO UPDATE SET cnpj = EXCLUDED.cnpj
       RETURNING id, (xmax = 0) AS nova`,
      [l.cnpj, l.empresa, cidade, uf, l.cep, l.endereco],
    );
    achada = Number(rows[0]!.id);
    nova = (rows[0] as unknown as { nova: boolean }).nova;
  }
  const empresaId = achada;
  // Site é público: vale para a empresa (o enriquecimento lê o site), sem tirar o que já havia.
  if (l.site)
    await db.query(`UPDATE descoberta.empresas SET maps_site = coalesce(maps_site, $2) WHERE id = $1`, [
      empresaId,
      l.site,
    ]);

  const { rowCount } = await db.query(
    `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, dentro_do_raio)
     VALUES ($1, $2, 'importacao', NULL)
     ON CONFLICT (campanha_id, empresa_id) DO NOTHING`,
    [campanhaId, empresaId],
  );

  await gravarContatos(db, contaId, empresaId, l);
  return { empresaId, nova, ligada: (rowCount ?? 0) > 0 };
}

/**
 * A empresa do lead na base, em ordem de confiança: o CNPJ (ou a base da Receita, que cria com os
 * dados oficiais); o telefone com nome parecido; o nome muito parecido na mesma cidade.
 */
async function acharEmpresa(
  db: Executor,
  l: LeadImportado,
  uf: string,
  cidade: string,
): Promise<{ id: number; nova: boolean } | null> {
  if (l.cnpj) {
    const ja = await db.query<{ id: number }>('SELECT id FROM descoberta.empresas WHERE cnpj = $1', [l.cnpj]);
    if (ja.rows[0]) return { id: Number(ja.rows[0].id), nova: false };
    const daBase = await db.query<{ id: number }>(
      `INSERT INTO descoberta.empresas
         (cnpj, cnpj_basico, nome, razao_social, cnae_principal, porte, situacao, data_abertura,
          logradouro, numero, bairro, cep, cidade, uf, telefones_receita, email_receita, mei)
       SELECT cnpj, cnpj_basico, coalesce(nome_fantasia, razao_social, cnpj), razao_social, cnae_principal,
              porte, situacao, data_inicio, logradouro, numero, bairro, cep, cidade, uf, telefones, email, mei
         FROM base_cnpj.v_estabelecimentos WHERE cnpj = $1
       ON CONFLICT (cnpj) DO NOTHING
       RETURNING id`,
      [l.cnpj],
    );
    return daBase.rows[0] ? { id: Number(daBase.rows[0].id), nova: true } : null;
  }

  const nome = normalizarNome(l.empresa);
  for (const t of l.telefones) {
    // Telefone da Receita sozinho não basta (costuma ser do contador): o nome também tem de parecer.
    const r = await db.query<{ id: number }>(
      `SELECT id FROM descoberta.empresas
        WHERE uf = $1 AND ($2 = maps_telefone OR $2 = ANY(telefones_receita))
          AND ($3 = '' OR greatest(similarity(nome_busca, $3), similarity(coalesce(razao_busca, ''), $3)) >= 0.3)
        ORDER BY ($2 = maps_telefone) DESC, (cidade = $4) DESC, id LIMIT 1`,
      [uf, t.numero, nome, cidade],
    );
    if (r.rows[0]) return { id: Number(r.rows[0].id), nova: false };
  }
  if (!nome || !uf || !cidade) return null;
  const r = await db.query<{ id: number; sim: number }>(
    `SELECT id, greatest(similarity(nome_busca, $1), similarity(coalesce(razao_busca, ''), $1)) AS sim
       FROM descoberta.empresas
      WHERE uf = $2 AND cidade = $3 AND (nome_busca % $1 OR razao_busca % $1)
      ORDER BY sim DESC LIMIT 1`,
    [nome, uf, cidade],
  );
  const c = r.rows[0];
  return c && c.sim >= SIMILARIDADE_SO_CIDADE ? { id: Number(c.id), nova: false } : null;
}

/** Contatos do arquivo: só da conta que importou (as outras contas nunca veem). */
async function gravarContatos(db: Executor, contaId: number, empresaId: number, l: LeadImportado) {
  let pessoaId: number | null = null;
  if (l.contato) {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO enriquecimento.pessoas (empresa_id, conta_id, nome, cargo, papel, decisor, prioridade, fontes)
       VALUES ($1, $2, $3, $4, 'outro', true, 1, '{importacao}')
       ON CONFLICT (empresa_id, conta_id, nome_chave) DO UPDATE
          SET cargo = coalesce(EXCLUDED.cargo, enriquecimento.pessoas.cargo)
       RETURNING id`,
      [empresaId, contaId, l.contato, l.cargo],
    );
    pessoaId = rows[0] ? Number(rows[0].id) : null;
  }
  const contatos: { canal: string; valor: string; rotulo: string }[] = [
    ...l.telefones.map((t) => ({
      canal: t.whatsapp ? 'whatsapp' : 'telefone',
      valor: t.numero,
      rotulo: t.whatsapp ? 'WhatsApp da sua planilha' : 'Telefone da sua planilha',
    })),
    ...l.emails.map((e) => ({ canal: 'email', valor: e, rotulo: 'E-mail da sua planilha' })),
    ...(l.instagram
      ? [
          {
            canal: 'instagram',
            valor: `https://www.instagram.com/${l.instagram}/`,
            rotulo: `@${l.instagram}`,
          },
        ]
      : []),
  ];
  // O melhor contato do lead é o primeiro telefone (ou o primeiro e-mail) que o cliente mandou.
  const principal = contatos.find((c) => c.canal !== 'instagram');
  for (const c of contatos) {
    await db.query(
      `INSERT INTO enriquecimento.contatos
         (empresa_id, conta_id, pessoa_id, canal, valor, rotulo, fonte, fontes, confianca, status, principal)
       VALUES ($1, $2, $3, $4, $5, $6, 'importacao', '{importacao}', 95, 'verificado', $7)
       ON CONFLICT (empresa_id, conta_id, canal, valor) DO UPDATE
          SET pessoa_id = coalesce(enriquecimento.contatos.pessoa_id, EXCLUDED.pessoa_id)`,
      [empresaId, contaId, pessoaId, c.canal, c.valor, c.rotulo, c === principal],
    );
  }
}
