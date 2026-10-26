import { type LeadImportado, normalizarCidade, normalizarNome } from '@prospeccao/shared';
import type { Executor } from './pool.js';

/**
 * Lead que a conta trouxe: do arquivo importado, cadastrado à mão no funil ou de uma conversa nova
 * no WhatsApp. Acha (ou cria) a empresa na base, liga à lista e grava os contatos só para a conta.
 * Usado pelo worker-descoberta (importação) e pela api (cadastro manual e WhatsApp).
 */

/** De onde o lead veio (vira a origem na lista e a fonte dos contatos). */
export type OrigemLead = 'importacao' | 'manual';

/** Nome muito parecido na mesma cidade (pg_trgm) para aceitar como a mesma empresa. */
const SIMILARIDADE_NOME_CIDADE = 0.62;

/**
 * Lista onde ficam os leads cadastrados à mão e os que chegaram pelo WhatsApp (uma por conta,
 * criada na primeira vez). Precisa de um nicho da conta (o primeiro ativo).
 */
export async function listaDeLeadsManuais(db: Executor, contaId: number): Promise<number> {
  const ja = await db.query<{ id: number }>(
    `SELECT id FROM cadastro.campanhas WHERE conta_id = $1 AND tipo = 'manual' ORDER BY id LIMIT 1`,
    [contaId],
  );
  if (ja.rows[0]) return Number(ja.rows[0].id);
  const nicho = await db.query<{ id: number }>(
    `SELECT id FROM cadastro.nichos WHERE conta_id = $1 AND ativo ORDER BY id LIMIT 1`,
    [contaId],
  );
  if (!nicho.rows[0]) throw new Error('SEM_NICHO');
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO cadastro.campanhas (conta_id, nome, nicho_id, cidades, raio_km, tipo, status, iniciada_em)
     VALUES ($1, 'Cadastrados à mão e do WhatsApp', $2, '[{"cidade":"","uf":""}]', NULL, 'manual', 'ativa', now())
     RETURNING id`,
    [contaId, nicho.rows[0].id],
  );
  return Number(rows[0]!.id);
}

/** Uma linha: acha ou cria a empresa, liga à lista e grava os contatos do arquivo (privados da conta). */
export async function gravarLead(
  db: Executor,
  contaId: number,
  campanhaId: number,
  l: LeadImportado,
  origem: OrigemLead = 'importacao',
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

  // Já era candidata desta campanha (estoque da busca): vira lead (liberada) sem trocar a origem.
  const { rows: lig } = await db.query<{ nova: boolean }>(
    `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, dentro_do_raio)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (campanha_id, empresa_id) DO UPDATE
        SET liberado_em = coalesce(descoberta.campanha_empresas.liberado_em, now())
     RETURNING (xmax = 0) AS nova`,
    [campanhaId, empresaId, origem],
  );
  const rowCount = lig[0]?.nova ? 1 : 0;

  await gravarContatos(db, contaId, empresaId, l, origem);
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
  return c && c.sim >= SIMILARIDADE_NOME_CIDADE ? { id: Number(c.id), nova: false } : null;
}

/** Contatos que a conta trouxe (arquivo, cadastro, WhatsApp): só dela (as outras contas nunca veem). */
async function gravarContatos(
  db: Executor,
  contaId: number,
  empresaId: number,
  l: LeadImportado,
  origem: OrigemLead,
) {
  const fonte = origem === 'importacao' ? 'importacao' : 'manual';
  const de = origem === 'importacao' ? 'da sua planilha' : 'cadastrado por você';
  let pessoaId: number | null = null;
  if (l.contato) {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO enriquecimento.pessoas (empresa_id, conta_id, nome, cargo, papel, decisor, prioridade, fontes)
       VALUES ($1, $2, $3, $4, 'outro', true, 1, ARRAY[$5])
       ON CONFLICT (empresa_id, conta_id, nome_chave) DO UPDATE
          SET cargo = coalesce(EXCLUDED.cargo, enriquecimento.pessoas.cargo)
       RETURNING id`,
      [empresaId, contaId, l.contato, l.cargo, fonte],
    );
    pessoaId = rows[0] ? Number(rows[0].id) : null;
  }
  const contatos: { canal: string; valor: string; rotulo: string }[] = [
    ...l.telefones.map((t) => ({
      canal: t.whatsapp ? 'whatsapp' : 'telefone',
      valor: t.numero,
      rotulo: t.whatsapp ? `WhatsApp ${de}` : `Telefone ${de}`,
    })),
    ...l.emails.map((e) => ({ canal: 'email', valor: e, rotulo: `E-mail ${de}` })),
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
       VALUES ($1, $2, $3, $4, $5, $6, $8, ARRAY[$8], 95, 'verificado', $7)
       ON CONFLICT (empresa_id, conta_id, canal, valor) DO UPDATE
          SET pessoa_id = coalesce(enriquecimento.contatos.pessoa_id, EXCLUDED.pessoa_id)`,
      [empresaId, contaId, pessoaId, c.canal, c.valor, c.rotulo, c === principal, fonte],
    );
  }
}
