import type { Pool } from '@prospeccao/db';
import { SCHEMA_VITRINE } from './acesso.js';

/** O que cada view da vitrine tem, para a IA escolher onde procurar. */
export const DESCRICAO_TABELA: Record<string, string> = {
  unidades: 'unidades (regionais/filiais) e a organização de cada uma; unidade_id liga as outras tabelas',
  equipe: 'pessoas da equipe (vendedores, SDRs, closers, administradores), papel, último acesso e metas',
  nichos: 'perfis de cliente que a unidade prospecta (CNAEs, termos do Google, sinais de bom lead)',
  campanhas: 'campanhas de prospecção: nicho, cidades, meta, situação',
  leads:
    'empresas encontradas pelas campanhas (uma linha por empresa e campanha), com a nota da IA (faixa A/B/C, score), categoria e nota no Google',
  etapas_funil: 'etapas dos pipelines de cada unidade e o que cada uma significa (funciona_como)',
  funil:
    'negociações: uma por empresa e unidade, etapa atual, valor mensal em potencial, responsável, próximo passo, motivo de perda',
  historico_funil:
    'tudo o que aconteceu nas negociações: mudanças de etapa, contatos registrados, notas (texto até 500 caracteres)',
  mensagens_whatsapp: 'mensagens de WhatsApp enviadas e recebidas (direcao enviada/recebida), status e texto',
  tarefas: 'tarefas e reuniões agendadas (tipo reuniao/ligacao/tarefa), responsável e se foi concluída',
  reunioes:
    'reuniões por vídeo que aconteceram (uma linha por reunião): duração, se foi gravada, resumo da IA, interesse do lead, destaques (dor, volume, objeções, quem decide) e próximos passos combinados',
  campanhas_email: 'campanhas de e-mail de prospecção',
  emails_enviados: 'cada e-mail (ou passo) enviado: entregue, aberto, clicado, respondido',
  respostas_email: 'respostas de e-mail dos leads, com o interesse lido pela IA e um resumo',
  decisores: 'possíveis decisores encontrados em cada empresa (nome, cargo, se é sócio/decisor)',
  contatos_lead:
    'canais encontrados para falar com cada empresa (WhatsApp, telefone, e-mail, Instagram), sem o número',
  conhecimento:
    'base de conhecimento da unidade (respostas, objeções, informações da empresa usadas pelo agente)',
  consumo_ia: 'uso diário da IA por unidade (chamadas e tokens)',
  mercado:
    'base pública da Receita Federal: todas as empresas do Brasil importadas (CNAE, porte, capital social, cidade, data de abertura). Use para tamanho de mercado; é grande, sempre filtre por uf/cidade/cnae',
  plataforma_organizacoes: 'clientes da plataforma (organizações): plano, limites, módulos, mensalidade',
  plataforma_consumo_buscas: 'buscas pagas por unidade e serviço (Google, Apify) por dia',
  plataforma_pedidos_site: 'pedidos de demonstração que chegaram pelo site e a etapa da venda',
};

/** Views que só o master da plataforma usa (para os outros, nem aparecem no catálogo). */
export const SO_MASTER = new Set([
  'plataforma_organizacoes',
  'plataforma_consumo_buscas',
  'plataforma_pedidos_site',
]);

export interface TabelaCatalogo {
  nome: string;
  descricao: string | null;
  colunas: { nome: string; tipo: string }[];
}

let cache: { em: number; tabelas: TabelaCatalogo[] } | null = null;
const VALIDADE_MS = 10 * 60_000;

/** As views que o papel de leitura enxerga, com as colunas (o catálogo não muda por pessoa). */
export async function carregarCatalogo(pool: Pool, agora = Date.now()): Promise<TabelaCatalogo[]> {
  if (cache && agora - cache.em < VALIDADE_MS) return cache.tabelas;
  const { rows } = await pool.query<{ tabela: string; coluna: string; tipo: string }>(
    `SELECT table_name AS tabela, column_name AS coluna, data_type AS tipo
       FROM information_schema.columns WHERE table_schema = $1
      ORDER BY table_name, ordinal_position`,
    [SCHEMA_VITRINE],
  );
  const mapa = new Map<string, TabelaCatalogo>();
  for (const c of rows) {
    let t = mapa.get(c.tabela);
    if (!t) {
      t = { nome: c.tabela, descricao: DESCRICAO_TABELA[c.tabela] ?? null, colunas: [] };
      mapa.set(c.tabela, t);
    }
    t.colunas.push({ nome: c.coluna, tipo: abreviarTipo(c.tipo) });
  }
  const tabelas = [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  cache = { em: agora, tabelas };
  return tabelas;
}

export function invalidarCatalogo() {
  cache = null;
}

/** O catálogo que cada pessoa vê (as views da plataforma só para o master). */
export const catalogoDe = (tabelas: TabelaCatalogo[], master: boolean) =>
  master ? tabelas : tabelas.filter((t) => !SO_MASTER.has(t.nome));

function abreviarTipo(t: string) {
  return t
    .replace('character varying', 'texto')
    .replace(/^text$/, 'texto')
    .replace('timestamp with time zone', 'data-hora')
    .replace('timestamp without time zone', 'data-hora')
    .replace('integer', 'inteiro')
    .replace('bigint', 'inteiro')
    .replace('smallint', 'inteiro')
    .replace('numeric', 'decimal')
    .replace('double precision', 'decimal')
    .replace('boolean', 'sim/não')
    .replace(/^date$/, 'data')
    .replace('ARRAY', 'lista');
}

/** Lista curta (uma linha por tabela) para a IA escolher onde procurar. */
export function resumoDoCatalogo(tabelas: TabelaCatalogo[]): string {
  return tabelas.map((t) => `- ${t.nome}${t.descricao ? `: ${t.descricao}` : ''}`).join('\n');
}

/** Colunas das tabelas escolhidas, para escrever o SQL. */
export function detalharTabelas(tabelas: TabelaCatalogo[], nomes: string[]): string {
  return tabelas
    .filter((t) => nomes.includes(t.nome))
    .map(
      (t) =>
        `### ${t.nome}${t.descricao ? ` — ${t.descricao}` : ''}\n${t.colunas.map((c) => `${c.nome} (${c.tipo})`).join(', ')}`,
    )
    .join('\n\n');
}

/** Como contar certo no negócio de prospecção (vai no prompt). */
export const REGRAS_NEGOCIO = `- Unidade = conta/regional/filial de uma organização (cliente). Toda tabela tem unidade_id; a pessoa só enxerga as unidades que pode ver.
- Funil: funil.situacao é o significado padrão da etapa (a_abordar, abordado, respondeu, reuniao, proposta, ganho, perdido, descartado); funil.etapa é o nome que a unidade deu. Para contar ganhos/perdidos use situacao. Descartado não é negociação ativa.
- Negociações em andamento = situacao NOT IN ('ganho','perdido','descartado'). Taxa de conversão = ganhos / (ganhos + perdidos).
- "Quando ganhou/perdeu": funil.etapa_desde com situacao 'ganho'/'perdido'; ou historico_funil com para_etapa.
- Abordagens = historico_funil com direcao = 'enviada' (contato feito) ou mensagens_whatsapp/emails_enviados enviados. Respostas = direcao 'recebida'.
- leads: a mesma empresa pode aparecer em várias campanhas; para contar empresas use count(DISTINCT empresa_id). faixa A = prioridade alta, B = vale abordar, C = baixa.
- valor_mensal é o potencial em R$ por mês informado pela equipe (pode estar vazio).
- Datas são data-hora com fuso; "hoje" e "este mês" no fuso America/Sao_Paulo: use (now() AT TIME ZONE 'America/Sao_Paulo')::date e date_trunc('month', ...).
- Nomes de cidade em leads/mercado estão em MAIÚSCULAS sem acento na maioria dos casos: compare com upper() e sem acento (translate) ou ILIKE.`;
