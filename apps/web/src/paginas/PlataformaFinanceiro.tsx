import { NOME_PLANO, TABELA_PADRAO } from '@prospeccao/shared/planos';
import { CUSTOS_PADRAO, type CustosPlataforma } from '@prospeccao/shared/plataforma';
import { Badge, Button, EmptyState, Icon, Panel, Stat } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Drawer } from '../componentes/Drawer';
import { ErroDaApi } from '../componentes/Formulario';
import { ROTULO_PLANO, useTabelaPrecos } from '../componentes/PlanoConta';
import { fmtNumero, fmtReais, fmtReaisCentavos } from '../formatar';
import {
  type ClientePainel,
  FormCustos,
  type Franquia,
  type GrupoReceita,
  type ItemConfiguracao,
  ROTULO_SAUDE,
  TOM_SAUDE,
  Topo,
  useMaster,
  type Visao,
} from './Plataforma';

/*
 * Financeiro do painel da plataforma: quantos clientes, o que cada um contratou (plano e módulos),
 * quanto usou, quanto custa para a plataforma e se a conta está configurada.
 */

const MES = new Date().toLocaleDateString('pt-BR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

const ROTULO_GRUPO: Record<Exclude<GrupoReceita, 'plano' | 'incluso'>, string> = {
  whatsapp_ia: 'WhatsApp + IA',
  modulos: 'Módulos avulsos',
  numeros: 'Números extras',
  usuarios: 'Usuários extras',
  leads: 'Leads extras',
};

const ROTULO_ITEM_CONFIG: Record<ItemConfiguracao['item'], string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  ia: 'IA de atendimento',
  equipe: 'Equipe',
  campanha: 'Campanhas',
};

const plural = (n: number, um: string, varios: string) => `${fmtNumero(n)} ${n === 1 ? um : varios}`;

/** Itens da mensalidade em reais de verdade: com valor combinado, cada item na proporção. */
function itensReais(c: ClientePainel) {
  const soma = c.contratado.itens.reduce((s, i) => s + i.valor, 0);
  const fator = c.contratado.valorCombinado && soma > 0 && c.mensalidade != null ? c.mensalidade / soma : 1;
  return c.contratado.itens.map((i) => ({ ...i, valor: i.valor * fator }));
}

/** No plano Personalizado, usuários e leads são o próprio plano (não extras). */
const ehExtra = (c: ClientePainel, g: GrupoReceita) =>
  g !== 'plano' && g !== 'incluso' && !(c.plano === 'personalizado' && (g === 'usuarios' || g === 'leads'));

function chipsContratado(c: ClientePainel): string[] {
  const chips: string[] = [];
  for (const i of c.contratado.itens) {
    if (!ehExtra(c, i.grupo)) continue;
    if (i.grupo === 'whatsapp_ia') chips.push('WhatsApp + IA');
    else if (i.grupo === 'numeros') chips.push(`+${plural(c.contratado.numerosExtras, 'número', 'números')}`);
    else if (i.grupo === 'usuarios')
      chips.push(
        `${c.contratado.usuariosExtras >= 0 ? '+' : ''}${plural(c.contratado.usuariosExtras, 'usuário', 'usuários')}`,
      );
    else if (i.grupo === 'leads') chips.push('Leads extras');
    else chips.push(i.rotulo);
  }
  return chips;
}

/** Bolinha de configuração: feito, falta ou o plano não tem. */
function Bolinha(props: { i: ItemConfiguracao; grande?: boolean }) {
  const { i } = props;
  return (
    <span
      className="config-bolinha"
      data-estado={i.estado}
      data-grande={props.grande || undefined}
      title={`${ROTULO_ITEM_CONFIG[i.item]}: ${i.texto}`}
    >
      {i.estado === 'ok' ? (
        <Icon name="check" size={props.grande ? 12 : 10} strokeWidth={3} />
      ) : i.estado === 'pendente' ? (
        '!'
      ) : (
        '–'
      )}
    </span>
  );
}

/** Barra fina de uso de uma franquia (cor de aviso perto do limite). */
function BarraUso(props: { f: Franquia }) {
  const { uso, limite } = props.f;
  if (!limite) return null;
  const p = Math.min(1, uso / limite);
  return (
    <span className="uso-barra">
      <span
        className="uso-barra__nivel"
        data-alerta={p >= 0.9 ? 'quase' : undefined}
        style={{ width: `${Math.max(p * 100, uso > 0 ? 2 : 0)}%` }}
      />
    </span>
  );
}

const textoFranquia = (f: Franquia, un = '') =>
  f.limite == null
    ? `${fmtNumero(f.uso)}${un} · sem limite`
    : `${fmtNumero(Math.round(f.uso))}${un} / ${fmtNumero(f.limite)}${un}`;

/** Barras com valor em reais (o componente de relatórios mostra só números). */
function BarrasReais(props: {
  rotulo: string;
  itens: { rotulo: string; valor: number; detalhe?: string }[];
  custo?: boolean;
}) {
  const max = Math.max(1, ...props.itens.map((i) => i.valor));
  return (
    <ul className="barras" aria-label={props.rotulo}>
      {props.itens.map((i) => (
        <li key={i.rotulo} className="barras__linha" title={`${i.rotulo}: ${fmtReais(i.valor)}`}>
          <span className="barras__rotulo">
            {i.rotulo}
            {i.detalhe && <span className="quieto"> · {i.detalhe}</span>}
          </span>
          <span className="barras__trilho">
            <span
              className="barras__barra"
              data-tom={props.custo ? 'custo' : undefined}
              style={{ width: `${(i.valor / max) * 100}%` }}
            />
          </span>
          <span className="barras__valor mono">{fmtReais(i.valor)}</span>
        </li>
      ))}
    </ul>
  );
}

type Ordem = 'margem' | 'receita' | 'custo' | 'nome';
type FiltroPlano = 'todos' | 'start' | 'time' | 'escala' | 'personalizado' | 'sem';

/** Planilha (CSV que o Excel abre) com a tabela de clientes. */
function baixarPlanilha(lista: ClientePainel[]) {
  const linhas = [
    [
      'Cliente',
      'Plano',
      'Contratado',
      'Mensalidade',
      'Custo',
      'Margem',
      'Leads no mês',
      'Limite de leads',
      'Usuários',
      'Horas de reunião',
      'Conversas da IA',
      'Configuração pendente',
      'Situação',
    ],
    ...lista.map((c) => [
      c.nome,
      c.plano ? NOME_PLANO[c.plano] : 'Sem plano',
      chipsContratado(c).join(' + ') || 'Sem módulos',
      (c.mensalidade ?? 0).toFixed(2).replace('.', ','),
      c.custo.total.toFixed(2).replace('.', ','),
      (c.margem ?? 0).toFixed(2).replace('.', ','),
      c.leads.mes,
      c.leads.limite ?? '',
      c.usuarios.uso,
      c.uso.horasReuniao.toFixed(1).replace('.', ','),
      c.uso.conversasIa,
      c.configuracao
        .filter((i) => i.estado === 'pendente')
        .map((i) => i.texto)
        .join('; '),
      ROTULO_SAUDE[c.saude],
    ]),
  ];
  const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `financeiro-${new Date().toISOString().slice(0, 7)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PlataformaFinanceiro() {
  const m = useMaster();
  const [ordem, setOrdem] = useState<Ordem>('margem');
  const [plano, setPlano] = useState<FiltroPlano>('todos');
  const [busca, setBusca] = useState('');
  const [custos, setCustos] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['master', 'clientes-painel'],
    queryFn: () =>
      api<{ clientes: ClientePainel[]; custos: CustosPlataforma }>('/master/plataforma/clientes'),
    enabled: m.master,
  });
  const visao = useQuery({
    queryKey: ['master', 'visao'],
    queryFn: () => api<Visao>('/master/plataforma/visao'),
    enabled: m.master,
  });
  if (!m.carregando && !m.master) return <Navigate to="/" replace />;

  // Só quem é cliente: a sua própria conta fica de fora das contas de receita e custo.
  const clientes = (q.data?.clientes ?? []).filter((c) => !c.principal && (c.ativa || c.custo.total > 0));
  const pagantes = clientes.filter((c) => c.ativa && (c.mensalidade ?? 0) > 0);
  const mrr = pagantes.reduce((s, c) => s + (c.mensalidade ?? 0), 0);
  const custo = clientes.reduce((s, c) => s + c.custo.total, 0);
  const margem = mrr - custo;

  // Receita por plano e por módulo (com valor combinado, na proporção).
  const porPlano = new Map<string, { clientes: number; receita: number }>();
  const porGrupo = new Map<string, { clientes: number; receita: number }>();
  for (const c of pagantes) {
    const k = c.plano ?? 'sem';
    const p = porPlano.get(k) ?? { clientes: 0, receita: 0 };
    porPlano.set(k, { clientes: p.clientes + 1, receita: p.receita + (c.mensalidade ?? 0) });
    const grupos = new Map<string, number>();
    for (const i of itensReais(c))
      if (ehExtra(c, i.grupo)) grupos.set(i.grupo, (grupos.get(i.grupo) ?? 0) + i.valor);
    for (const [g, v] of grupos) {
      const atual = porGrupo.get(g) ?? { clientes: 0, receita: 0 };
      porGrupo.set(g, { clientes: atual.clientes + 1, receita: atual.receita + v });
    }
  }
  const receitaModulos = [...porGrupo.values()].reduce((s, g) => s + g.receita, 0);
  const custoServico = [
    { rotulo: 'IA', valor: clientes.reduce((s, c) => s + c.custo.ia, 0) },
    { rotulo: 'WhatsApp', valor: clientes.reduce((s, c) => s + c.custo.whatsapp, 0) },
    { rotulo: 'Reuniões e gravações', valor: clientes.reduce((s, c) => s + c.custo.reunioes, 0) },
    { rotulo: 'Buscas e Maps', valor: clientes.reduce((s, c) => s + c.custo.buscas + c.custo.maps, 0) },
    { rotulo: 'E-mail', valor: clientes.reduce((s, c) => s + c.custo.email, 0) },
    { rotulo: 'Infraestrutura', valor: clientes.reduce((s, c) => s + c.custo.infra, 0) },
  ]
    .filter((i) => i.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  const termo = busca.trim().toLowerCase();
  const lista = clientes
    .filter((c) => plano === 'todos' || (plano === 'sem' ? !c.plano : c.plano === plano))
    .filter((c) => !termo || c.nome.toLowerCase().includes(termo))
    .sort((a, b) =>
      ordem === 'margem'
        ? (a.margem ?? Number.POSITIVE_INFINITY) - (b.margem ?? Number.POSITIVE_INFINITY)
        : ordem === 'receita'
          ? (b.mensalidade ?? 0) - (a.mensalidade ?? 0)
          : ordem === 'custo'
            ? b.custo.total - a.custo.total
            : a.nome.localeCompare(b.nome),
    );
  const v = visao.data?.receita;
  const selecionado = clientes.find((c) => c.id === aberto) ?? null;

  return (
    <>
      <Topo
        titulo="Financeiro"
        texto={
          <>
            Receita, custo e margem de cada cliente em {MES}, com o que ele contratou, o que já usou e se a
            conta está configurada. <LinkAjuda artigo="painel-plataforma" />
          </>
        }
        acoes={
          <>
            <Button
              variant="ghost"
              icon="download"
              disabled={!lista.length}
              onClick={() => baixarPlanilha(lista)}
            >
              Baixar planilha
            </Button>
            <Button variant="ghost" icon="settings" onClick={() => setCustos(true)}>
              Custos unitários
            </Button>
          </>
        }
      />
      <ErroDaApi erro={q.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : (
        <>
          <div className="kpis">
            <Stat
              rotulo="Receita mensal (MRR)"
              valor={fmtReais(mrr)}
              delta={`por ano: ${fmtReais(mrr * 12)}`}
            />
            <Stat
              rotulo="Clientes pagantes"
              valor={fmtNumero(pagantes.length)}
              delta={v ? `${v.novosNoMes} novos · ${v.canceladosNoMes} cancelados no mês` : undefined}
            />
            <Stat rotulo="Ticket médio" valor={fmtReais(pagantes.length ? mrr / pagantes.length : 0)} />
            <Stat
              rotulo="Custo do mês"
              valor={fmtReais(custo)}
              delta={mrr ? `${Math.round((custo / mrr) * 100)}% da receita` : undefined}
              tendencia="desce"
            />
            <Stat
              rotulo="Margem"
              valor={fmtReais(margem)}
              delta={mrr ? `${Math.round((margem / mrr) * 100)}% da receita` : undefined}
              tendencia={margem >= 0 ? 'sobe' : 'desce'}
            />
            <Stat
              rotulo="Receita de módulos e extras"
              valor={fmtReais(receitaModulos)}
              delta={mrr ? `${Math.round((receitaModulos / mrr) * 100)}% da receita` : undefined}
            />
          </div>

          <div className="grade-financeiro">
            <Panel
              titulo="Receita por plano"
              acoes={<span className="quieto">{plural(pagantes.length, 'cliente', 'clientes')}</span>}
            >
              {porPlano.size ? (
                <BarrasReais
                  rotulo="Receita por plano"
                  itens={[...porPlano.entries()]
                    .sort((a, b) => b[1].receita - a[1].receita)
                    .map(([k, p]) => ({
                      rotulo: k === 'sem' ? 'Sem plano' : ROTULO_PLANO[k as keyof typeof ROTULO_PLANO],
                      detalhe: fmtNumero(p.clientes),
                      valor: p.receita,
                    }))}
                />
              ) : (
                <p className="quieto vazio-curto">Nenhum cliente pagante ainda.</p>
              )}
            </Panel>
            <Panel titulo="Módulos e extras" acoes={<span className="quieto">o que soma ao plano</span>}>
              {porGrupo.size ? (
                <BarrasReais
                  rotulo="Receita de módulos e extras"
                  itens={[...porGrupo.entries()]
                    .sort((a, b) => b[1].receita - a[1].receita)
                    .map(([g, p]) => ({
                      rotulo: ROTULO_GRUPO[g as keyof typeof ROTULO_GRUPO],
                      detalhe: fmtNumero(p.clientes),
                      valor: p.receita,
                    }))}
                />
              ) : (
                <p className="quieto vazio-curto">Nenhum cliente com módulos ou extras.</p>
              )}
            </Panel>
            <Panel titulo="Custo por serviço" acoes={<span className="quieto">o que a plataforma paga</span>}>
              {custoServico.length ? (
                <BarrasReais rotulo="Custo por serviço" itens={custoServico} custo />
              ) : (
                <p className="quieto vazio-curto">Nenhum custo neste mês.</p>
              )}
            </Panel>
          </div>

          <div className="filtros-linha financeiro-filtros">
            <h2 className="titulo-secao">Clientes</h2>
            <input
              className="filtro"
              type="search"
              placeholder="Buscar cliente"
              aria-label="Buscar cliente"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <select
              className="filtro"
              aria-label="Plano"
              style={{ maxWidth: 180 }}
              value={plano}
              onChange={(e) => setPlano(e.target.value as FiltroPlano)}
            >
              <option value="todos">Todos os planos</option>
              <option value="start">Start</option>
              <option value="time">Time</option>
              <option value="escala">Escala</option>
              <option value="personalizado">Personalizado</option>
              <option value="sem">Sem plano</option>
            </select>
            <select
              className="filtro"
              aria-label="Ordenar"
              style={{ maxWidth: 200 }}
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as Ordem)}
            >
              <option value="margem">Menor margem</option>
              <option value="receita">Maior mensalidade</option>
              <option value="custo">Maior custo</option>
              <option value="nome">Nome</option>
            </select>
          </div>

          {!lista.length ? (
            <div className="pp-panel">
              <EmptyState
                icone="building-2"
                titulo={clientes.length ? 'Nenhum cliente com esse filtro' : 'Nenhum cliente ainda'}
                texto={
                  clientes.length ? 'Troque o plano ou limpe a busca.' : 'Cadastre clientes em Clientes.'
                }
              />
            </div>
          ) : (
            <div className="pp-tablewrap">
              <table className="pp-table tabela-financeiro">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Contratado</th>
                    <th>Uso do mês</th>
                    <th>Configuração</th>
                    <th>Mensalidade</th>
                    <th>Custo</th>
                    <th>Margem</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => {
                    const chips = chipsContratado(c);
                    const falta = c.configuracao.find((i) => i.estado === 'pendente');
                    const f = c.franquias;
                    return (
                      <tr key={c.id} data-inativo={!c.ativa || undefined}>
                        <td>
                          <button type="button" className="link-botao" onClick={() => setAberto(c.id)}>
                            {c.nome}
                          </button>
                          <div className="quieto fin-sub">
                            {c.plano ? ROTULO_PLANO[c.plano] : 'Sem plano'}
                            {c.unidades.length > 1 ? ` · ${c.unidades.length} unidades` : ''}
                            {c.contratado.valorCombinado ? ' · valor combinado' : ''}
                          </div>
                        </td>
                        <td>
                          <div className="fin-chips">
                            {chips.length ? (
                              chips.map((t) => (
                                <span
                                  key={t}
                                  className="fin-chip"
                                  data-tom={t === 'WhatsApp + IA' ? 'marca' : undefined}
                                >
                                  {t}
                                </span>
                              ))
                            ) : (
                              <span className="fin-chip">sem módulos</span>
                            )}
                          </div>
                        </td>
                        <td className="fin-uso">
                          <div>Leads {textoFranquia(f.leads)}</div>
                          <BarraUso f={f.leads} />
                          <div className="quieto fin-sub">
                            {[
                              f.horasReuniao.limite !== 0 &&
                                `Reuniões ${textoFranquia(f.horasReuniao, ' h')}`,
                              c.uso.conversasIa > 0 &&
                                `IA ${plural(c.uso.conversasIa, 'conversa', 'conversas')}`,
                            ]
                              .filter(Boolean)
                              .join(' · ') || ' '}
                          </div>
                        </td>
                        <td>
                          <div
                            className="config-bolinhas"
                            role="img"
                            aria-label={c.configuracao
                              .map((i) => `${ROTULO_ITEM_CONFIG[i.item]}: ${i.texto}`)
                              .join('. ')}
                          >
                            {c.configuracao.map((i) => (
                              <Bolinha key={i.item} i={i} />
                            ))}
                          </div>
                          <div className="quieto fin-sub">{falta ? falta.texto : 'Tudo configurado'}</div>
                        </td>
                        <td className="mono">{fmtReais(c.mensalidade)}</td>
                        <td className="mono">{fmtReais(c.custo.total)}</td>
                        <td
                          className="mono"
                          data-alerta={c.margem != null && c.margem < 0 ? 'cheio' : undefined}
                        >
                          {c.margem != null && c.mensalidade
                            ? `${Math.round((c.margem / c.mensalidade) * 100)}%`
                            : '—'}
                        </td>
                        <td>
                          <Badge tone={TOM_SAUDE[c.saude]}>{ROTULO_SAUDE[c.saude]}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="nota-rodape">
            Configuração (bolinhas): WhatsApp conectado · e-mail com domínio verificado · IA de atendimento
            ligada · equipe usando · campanha rodando. Traço: o plano não tem. Custo conta só o que a
            plataforma paga (serviço com a chave do próprio cliente fica fora) e a infraestrutura é dividida
            entre os clientes ativos. Sua conta e o CRM de demonstração não entram.
          </p>
        </>
      )}
      {selecionado && <DetalheFinanceiro c={selecionado} aoFechar={() => setAberto(null)} />}
      {custos && (
        <Drawer titulo="Custos unitários" barra="Financeiro" aoFechar={() => setCustos(false)}>
          <div className="drawer__corpo">
            <FormCustos inicial={q.data?.custos ?? CUSTOS_PADRAO} aoSalvar={() => setCustos(false)} />
          </div>
        </Drawer>
      )}
    </>
  );
}

/** Sugestão de venda: perto do limite do plano, o próximo plano e quanto a mais. */
function useSugestao(c: ClientePainel): string | null {
  const tabela = useTabelaPrecos().data ?? TABELA_PADRAO;
  if (!c.ativa || !c.plano || c.plano === 'escala' || c.plano === 'personalizado') return null;
  const perto = (f: Franquia) => f.limite != null && f.limite > 0 && f.uso >= f.limite * 0.9;
  const motivos = [
    perto(c.franquias.leads) && 'de leads',
    perto(c.franquias.usuarios) && 'de usuários',
    perto(c.franquias.horasReuniao) && 'de horas de reunião',
  ].filter(Boolean) as string[];
  if (!motivos.length) return null;
  const proximo = c.plano === 'start' ? 'time' : 'escala';
  const diferenca = tabela.planos[proximo].preco - tabela.planos[c.plano].preco;
  const lista = motivos.length > 1 ? `${motivos.slice(0, -1).join(', ')} e ${motivos.at(-1)}` : motivos[0];
  return `Está no limite ${lista}. Boa hora para oferecer o ${NOME_PLANO[proximo]} (+ ${fmtReais(diferenca)} por mês).`;
}

function DetalheFinanceiro(props: { c: ClientePainel; aoFechar: () => void }) {
  const { c } = props;
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const sugestao = useSugestao(c);
  const unidade = c.unidades[0]?.id;
  const entrar = useMutation({
    mutationFn: () => api(`/master/contas/${unidade}/entrar`, { metodo: 'POST' }),
    onSuccess: () => {
      cliente.clear();
      navegar('/hoje');
    },
  });
  const receita = itensReais(c).filter((i) => i.valor > 0 || i.grupo === 'incluso');
  const reunioesTexto = [
    c.uso.horasReuniao > 0 && `${c.uso.horasReuniao.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`,
    c.uso.transcricaoHoras > 0 && 'transcrição',
    c.uso.armazenamentoGb > 0 &&
      `${c.uso.armazenamentoGb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB guardados`,
  ]
    .filter(Boolean)
    .join(', ');
  const custo: [string, number][] = (
    [
      [
        `IA${c.pagaPlataforma.ia ? ` (${plural(c.uso.iaChamadas, 'chamada', 'chamadas')})` : ' · chave do cliente'}`,
        c.custo.ia,
      ],
      [
        `WhatsApp${c.pagaPlataforma.whatsapp ? ` (${plural(c.uso.numerosWhatsapp, 'número', 'números')})` : ' · Z-API do cliente'}`,
        c.custo.whatsapp,
      ],
      [`Reuniões e gravações${reunioesTexto ? ` (${reunioesTexto})` : ''}`, c.custo.reunioes],
      [
        `Buscas e Maps (${plural(c.uso.serper + c.uso.apifyGoogle, 'busca', 'buscas')})`,
        c.custo.buscas + c.custo.maps,
      ],
      [
        `E-mail${c.pagaPlataforma.email ? ` (${plural(c.uso.emails, 'enviado', 'enviados')})` : ' · conta do cliente'}`,
        c.custo.email,
      ],
      ['Infraestrutura (rateio)', c.custo.infra],
    ] as [string, number][]
  ).filter(([, v], i) => v > 0 || i === 5);
  const franquias: [string, Franquia, string][] = [
    ['Leads', c.franquias.leads, ''],
    ['Usuários', c.franquias.usuarios, ''],
    ['Horas de reunião', c.franquias.horasReuniao, ' h'],
    ['Números de WhatsApp', c.franquias.numeros, ''],
    ['Conversas da IA', c.franquias.conversasIa, ''],
  ];

  return (
    <Drawer titulo={c.nome} barra="Financeiro" aoFechar={props.aoFechar} largo>
      <div className="drawer__corpo pilha" style={{ gap: 20 }}>
        <div className="fin-detalhe-topo">
          <div>
            <h2 className="fin-detalhe-nome">{c.nome}</h2>
            <span className="quieto">
              {c.plano ? `Plano ${NOME_PLANO[c.plano]}` : 'Sem plano'} · cliente desde{' '}
              {new Date(c.criadoEm).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })} ·{' '}
              {plural(c.usuarios.uso, 'usuário', 'usuários')}
              {c.unidades.length > 1 ? ` · ${c.unidades.length} unidades` : ''}
            </span>
          </div>
          <Badge tone={TOM_SAUDE[c.saude]}>{ROTULO_SAUDE[c.saude]}</Badge>
        </div>
        <div className="kpis">
          <Stat rotulo="Mensalidade" valor={fmtReais(c.mensalidade)} />
          <Stat rotulo="Custo do mês" valor={fmtReais(c.custo.total)} />
          <Stat
            rotulo="Margem"
            valor={c.margem != null ? fmtReais(c.margem) : '—'}
            delta={
              c.margem != null && c.mensalidade
                ? `${Math.round((c.margem / c.mensalidade) * 100)}%`
                : undefined
            }
            tendencia={(c.margem ?? 0) >= 0 ? 'sobe' : 'desce'}
          />
        </div>

        <div className="fin-colunas">
          <section>
            <h3 className="fin-titulo">De onde vem a receita</h3>
            <dl className="fin-linhas">
              {receita.map((i) => (
                <div key={i.rotulo}>
                  <dt>{i.rotulo}</dt>
                  <dd className="mono">{fmtReais(i.valor)}</dd>
                </div>
              ))}
              <div className="fin-linhas__total">
                <dt>Total</dt>
                <dd className="mono">{fmtReais(c.mensalidade)}</dd>
              </div>
            </dl>
            {c.contratado.valorCombinado && (
              <p className="quieto fin-sub" style={{ marginTop: 8 }}>
                Valor combinado. Pela tabela de hoje seria {fmtReais(c.contratado.mensalidadeCalculada)}; os
                itens acima estão na proporção.
              </p>
            )}
          </section>
          <section>
            <h3 className="fin-titulo">Para onde vai o custo</h3>
            <dl className="fin-linhas">
              {custo.map(([rotulo, valor]) => (
                <div key={rotulo}>
                  <dt>{rotulo}</dt>
                  <dd className="mono">{fmtReaisCentavos(valor)}</dd>
                </div>
              ))}
              <div className="fin-linhas__total">
                <dt>Total</dt>
                <dd className="mono">{fmtReaisCentavos(c.custo.total)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <section>
          <h3 className="fin-titulo">Franquias do mês</h3>
          <div className="fin-franquias">
            {franquias
              .filter(([, f]) => f.limite !== 0)
              .map(([rotulo, f, un]) => (
                <div key={rotulo}>
                  <span className="fin-sub">
                    {rotulo} {textoFranquia(f, un)}
                  </span>
                  <BarraUso f={f} />
                </div>
              ))}
          </div>
          {c.leads.esperando > 0 && (
            <p className="quieto fin-sub" style={{ marginTop: 8 }}>
              {plural(c.leads.esperando, 'lead esperando', 'leads esperando')} o limite do plano virar.
            </p>
          )}
        </section>

        <section>
          <h3 className="fin-titulo">Configuração</h3>
          <ul className="fin-config">
            {c.configuracao.map((i) => (
              <li key={i.item} className="fin-config__item" data-estado={i.estado}>
                <Bolinha i={i} grande />
                <span>
                  <b>{ROTULO_ITEM_CONFIG[i.item]}</b> · {i.texto}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {c.unidades.length > 1 && (
          <section>
            <h3 className="fin-titulo">Unidades</h3>
            <dl className="fin-linhas">
              {c.unidades.map((u) => (
                <div key={u.id} data-inativo={!u.ativa || undefined}>
                  <dt>
                    {u.nome} <span className="quieto">· {plural(u.leadsMes, 'lead', 'leads')}</span>
                  </dt>
                  <dd className="mono">{fmtReaisCentavos(u.custo)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <div className="fin-acoes">
          <Button variant="primary" onClick={() => navegar(`/plataforma/clientes?conta=${unidade ?? ''}`)}>
            Abrir plano e módulos
          </Button>
          <Button
            variant="secondary"
            icon="arrow-right"
            disabled={!unidade || entrar.isPending}
            onClick={() => entrar.mutate()}
          >
            Ver como o cliente
          </Button>
        </div>
        <ErroDaApi erro={entrar.error} />
        {sugestao && <p className="fin-sugestao">Sugestão: {sugestao}</p>}
      </div>
    </Drawer>
  );
}
