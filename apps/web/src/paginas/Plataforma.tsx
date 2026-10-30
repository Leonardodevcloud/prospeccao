import type { ConfigVozDTO } from '@prospeccao/shared/assistente';
import type { CustoEstimado, CustosPlataforma, SinalSaude } from '@prospeccao/shared/plataforma';
import { Badge, Button, Panel, Stat } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api';
import { ouvirAmostra, recarregarVoz } from '../componentes/argos/fala';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { ROTULO_PLANO } from '../componentes/PlanoConta';
import { useSessao } from '../componentes/Sessao';
import { fmtNumero, fmtQuando, fmtReais, fmtReaisCentavos } from '../formatar';
import { Barras } from './Relatorios';

/* ───────────────────────── Tipos da API ───────────────────────── */

type PlanoNome = 'start' | 'time' | 'escala' | 'personalizado';

export interface ClientePainel {
  /** Organização (o cliente). */
  id: number;
  nome: string;
  unidades: { id: number; nome: string; ativa: boolean; leadsMes: number; custo: number }[];
  ativa: boolean;
  principal: boolean;
  criadoEm: string;
  desativadaEm: string | null;
  ultimoAcesso: string | null;
  plano: PlanoNome | null;
  mensalidade: number | null;
  usuarios: { uso: number; limite: number | null };
  leads: { mes: number; limite: number | null; ultimos14d: number; mesAnterior: number; esperando: number };
  noFunil: number;
  uso: {
    serper: number;
    apifyInstagram: number;
    apifyGoogle: number;
    iaChamadas: number;
    iaTokensEntrada: number;
    iaTokensSaida: number;
    iaChamadasProprias: number;
    emails: number;
    whatsappEnviadas: number;
    numerosWhatsapp: number;
    placesUsd: number;
    /** Reuniões por vídeo no mês. */
    reuniaoMinutosPessoas: number;
    horasReuniao: number;
    transcricaoHoras: number;
    armazenamentoGb: number;
    /** Leads diferentes com quem a IA de atendimento conversou. */
    conversasIa: number;
  };
  pagaPlataforma: { ia: boolean; email: boolean; whatsapp: boolean; maps: boolean };
  /** O que foi contratado e de onde vem cada real da mensalidade. */
  contratado: {
    modulos: string[];
    numerosExtras: number;
    usuariosExtras: number;
    valorCombinado: boolean;
    mensalidadeCalculada: number | null;
    itens: { rotulo: string; valor: number; grupo: GrupoReceita }[];
  };
  /** Uso de cada franquia do mês (limite null = sem limite; 0 = o plano não tem). */
  franquias: Record<'usuarios' | 'leads' | 'horasReuniao' | 'conversasIa' | 'numeros', Franquia>;
  /** A conta está pronta para usar? */
  configuracao: ItemConfiguracao[];
  custo: CustoEstimado;
  margem: number | null;
  saude: SinalSaude;
  saudeTexto: string;
}

export type GrupoReceita = 'plano' | 'whatsapp_ia' | 'numeros' | 'usuarios' | 'leads' | 'modulos' | 'incluso';

export interface Franquia {
  uso: number;
  limite: number | null;
}

export interface ItemConfiguracao {
  item: 'whatsapp' | 'email' | 'ia' | 'equipe' | 'campanha';
  estado: 'ok' | 'pendente' | 'fora';
  texto: string;
}

export interface Visao {
  receita: {
    mrr: number;
    clientesAtivos: number;
    ticketMedio: number;
    novosNoMes: number;
    canceladosNoMes: number;
    porPlano: { plano: string; clientes: number; receita: number }[];
    custoEstimado: number;
    margemEstimada: number;
    custoContaPrincipal: number;
  };
  atencao: {
    id: number;
    contaId: number | null;
    nome: string;
    saude: SinalSaude;
    texto: string;
    mensalidade: number | null;
  }[];
  vendas: { porEtapa: Record<string, number>; mes: { novos: number; clientes: number; perdidos: number } };
  operacao: {
    alertas: number;
    alertasErro: number;
    filaEnriquecimento: number;
    erros24h: number;
    parciais24h: number;
  };
}

interface Operacao {
  alertas: {
    id: number;
    contaId: number | null;
    contaNome: string | null;
    nivel: 'erro' | 'aviso';
    titulo: string;
    texto: string | null;
    primeiraVez: string;
    ultimaVez: string;
  }[];
  enriquecimento: {
    na_fila: number;
    rodando: number;
    concluidos24h: number;
    erros24h: number;
    parciais24h: number;
    limite: number;
  };
  fontesComErro: { etapa: string; erros: number; total: number }[];
  baseCnpj: { mes: string; status: string; concluidoEm: string | null } | null;
  basePaga: { consultas: number; custo: number };
  enriquecimentoPorDia: { dia: string; concluidos: number; erros: number }[];
  filas: Record<string, number>;
}

/* ───────────────────────── Peças ───────────────────────── */

export const ROTULO_SAUDE: Record<SinalSaude, string> = {
  parado: 'Parou de usar',
  pouco_uso: 'Usa pouco',
  no_limite: 'No limite',
  novo: 'Cliente novo',
  ok: 'Ok',
};
export const TOM_SAUDE: Record<SinalSaude, 'danger' | 'warning' | 'brand' | 'neutral' | 'outline'> = {
  parado: 'danger',
  pouco_uso: 'warning',
  no_limite: 'brand',
  novo: 'outline',
  ok: 'neutral',
};

const NOME_FONTE: Record<string, string> = {
  receita: 'Base da Receita',
  maps: 'Google Maps',
  site: 'Site da empresa',
  google: 'Busca no Google',
  instagram: 'Instagram',
  ia: 'IA',
  linkedin: 'LinkedIn',
  places: 'Google Places',
  whatsapp: 'Conferir WhatsApp',
  base_paga: 'Base paga',
  cnpj: 'Consulta do CNPJ',
};

const NOME_FILA: Record<string, string> = {
  'enriquecimento.solicitar': 'Enriquecimento',
  'maps.buscar': 'Busca no Maps',
  'maps.coletar': 'Coleta do Maps',
  'leads.importar': 'Importação de leads',
  'campanha.iniciar': 'Início de campanha',
  'cnpj.importar': 'Importação da base CNPJ',
  'maps.importar_planilha': 'Planilha do Maps',
};

export function useMaster() {
  const sessao = useSessao();
  return { carregando: sessao.isPending, master: !!sessao.data?.master };
}

export function Topo(props: { titulo: string; texto: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <div className="topo">
      <div>
        <h1>{props.titulo}</h1>
        <p>{props.texto}</p>
      </div>
      {props.acoes && <div className="acoes">{props.acoes}</div>}
    </div>
  );
}

export const pct = (parte: number, total: number | null) =>
  total ? `${Math.round((parte / Math.max(1, total)) * 100)}%` : null;

/* ───────────────────────── Visão geral ───────────────────────── */

export function PlataformaVisao() {
  const m = useMaster();
  const q = useQuery({
    queryKey: ['master', 'visao'],
    queryFn: () => api<Visao>('/master/plataforma/visao'),
    enabled: m.master,
    refetchInterval: 60_000,
  });
  if (!m.carregando && !m.master) return <Navigate to="/" replace />;
  const v = q.data;
  const r = v?.receita;
  const etapas: [string, string][] = [
    ['novo', 'Novos pedidos'],
    ['contato', 'Em contato'],
    ['demonstracao', 'Demonstração marcada'],
    ['proposta', 'Proposta enviada'],
  ];

  return (
    <>
      <Topo
        titulo="Visão geral"
        texto="Como a plataforma está neste mês: receita, custo, clientes que pedem atenção, vendas e operação."
      />
      <ErroDaApi erro={q.error} />
      {!v || !r ? (
        <div className="esqueleto" />
      ) : (
        <>
          <div className="kpis">
            <Stat rotulo="Receita mensal (MRR)" valor={fmtReais(r.mrr)} />
            <Stat rotulo="Clientes pagantes" valor={fmtNumero(r.clientesAtivos)} />
            <Stat rotulo="Ticket médio" valor={fmtReais(r.ticketMedio)} />
            <Stat
              rotulo="Novos / cancelados no mês"
              valor={
                <>
                  {fmtNumero(r.novosNoMes)} <span className="quieto">/ {fmtNumero(r.canceladosNoMes)}</span>
                </>
              }
            />
            <Stat
              rotulo="Custo estimado dos clientes"
              valor={fmtReais(r.custoEstimado - r.custoContaPrincipal)}
            />
            <Stat
              rotulo="Margem estimada"
              valor={fmtReais(r.margemEstimada)}
              delta={r.mrr ? `${Math.round((r.margemEstimada / r.mrr) * 100)}% da receita` : undefined}
              tendencia={r.margemEstimada >= 0 ? 'sobe' : 'desce'}
            />
          </div>

          <div className="grade-relatorio" style={{ marginTop: 16 }}>
            <Panel
              titulo="Precisam de atenção"
              contagem={v.atencao.length}
              acoes={<Link to="/plataforma/clientes">Ver clientes</Link>}
            >
              {v.atencao.length ? (
                <ul className="lista-atencao">
                  {v.atencao.map((a) => (
                    <li key={a.id} className="lista-atencao__item">
                      <Badge tone={TOM_SAUDE[a.saude]}>{ROTULO_SAUDE[a.saude]}</Badge>
                      <div>
                        <Link to={`/plataforma/clientes?conta=${a.contaId}`}>{a.nome}</Link>
                        <span className="quieto"> · {a.texto}</span>
                      </div>
                      <span className="mono quieto">{fmtReais(a.mensalidade)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                  Todos os clientes estão usando normalmente.
                </p>
              )}
            </Panel>

            <Panel titulo="Receita por plano">
              {r.porPlano.length ? (
                <Barras
                  rotulo="Receita por plano"
                  itens={r.porPlano
                    .sort((a, b) => b.receita - a.receita)
                    .map((p) => ({
                      rotulo: p.plano in ROTULO_PLANO ? ROTULO_PLANO[p.plano as PlanoNome] : 'Sem plano',
                      valor: Math.round(p.receita),
                      detalhe: `${p.clientes} ${p.clientes === 1 ? 'cliente' : 'clientes'}`,
                    }))}
                />
              ) : (
                <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                  Nenhum cliente com plano ainda.
                </p>
              )}
            </Panel>

            <Panel titulo="Vendas da plataforma" acoes={<Link to="/plataforma/vendas">Abrir quadro</Link>}>
              <Barras
                rotulo="Pedidos por etapa"
                itens={etapas.map(([k, rotulo]) => ({ rotulo, valor: v.vendas.porEtapa[k] ?? 0 }))}
              />
              <p className="quieto" style={{ margin: '12px 0 0', fontSize: 13 }}>
                Neste mês: {fmtNumero(v.vendas.mes.novos)} pedidos novos · {fmtNumero(v.vendas.mes.clientes)}{' '}
                viraram cliente · {fmtNumero(v.vendas.mes.perdidos)} perdidos.
              </p>
            </Panel>

            <Panel titulo="Operação" acoes={<Link to="/plataforma/operacao">Ver operação</Link>}>
              <ul className="lista-operacao">
                <li
                  className="lista-operacao__item"
                  data-alerta={v.operacao.alertasErro ? 'erro' : undefined}
                >
                  <span>Alertas em aberto</span>
                  <b className="mono lista-operacao__valor">
                    {fmtNumero(v.operacao.alertas)}
                    {v.operacao.alertasErro > 0 && ` (${v.operacao.alertasErro} com erro)`}
                  </b>
                </li>
                <li className="lista-operacao__item">
                  <span>Leads na fila do enriquecimento</span>
                  <b className="mono lista-operacao__valor">{fmtNumero(v.operacao.filaEnriquecimento)}</b>
                </li>
                <li className="lista-operacao__item" data-alerta={v.operacao.erros24h ? 'aviso' : undefined}>
                  <span>Enriquecimentos com erro (24 h)</span>
                  <b className="mono lista-operacao__valor">{fmtNumero(v.operacao.erros24h)}</b>
                </li>
                <li
                  className="lista-operacao__item"
                  data-alerta={v.operacao.parciais24h ? 'aviso' : undefined}
                >
                  <span>Enriquecidos em parte (24 h)</span>
                  <b className="mono lista-operacao__valor">{fmtNumero(v.operacao.parciais24h)}</b>
                </li>
              </ul>
            </Panel>
          </div>
          <p className="nota-rodape">
            Custo e margem são estimativas: consumo real de cada cliente vezes os custos unitários do
            Financeiro (ajuste para os valores das suas faturas). O uso da sua própria conta (
            {fmtReaisCentavos(r.custoContaPrincipal)} no mês) não entra na margem.
          </p>
        </>
      )}
    </>
  );
}

/* ───────────────────────── Custos unitários ───────────────────────── */

const CAMPOS_CUSTO: { k: keyof CustosPlataforma; rotulo: string; dica: string }[] = [
  { k: 'serperMil', rotulo: 'Serper: 1.000 buscas (R$)', dica: 'Busca no Google do enriquecimento.' },
  {
    k: 'apifyInstagramMil',
    rotulo: 'Apify: 1.000 perfis do Instagram (R$)',
    dica: 'Só com a leitura do Instagram ligada.',
  },
  { k: 'apifyGoogleMil', rotulo: 'Apify: 1.000 buscas no Google (R$)', dica: 'Só quando não há Serper.' },
  {
    k: 'iaEntradaMilhao',
    rotulo: 'IA: 1 milhão de tokens enviados (R$)',
    dica: 'Chave de IA da plataforma.',
  },
  { k: 'iaSaidaMilhao', rotulo: 'IA: 1 milhão de tokens recebidos (R$)', dica: 'Chave de IA da plataforma.' },
  { k: 'emailMil', rotulo: 'E-mail: 1.000 enviados (R$)', dica: 'Resend da plataforma.' },
  { k: 'whatsappNumeroMes', rotulo: 'WhatsApp: cada número por mês (R$)', dica: 'Z-API da plataforma.' },
  {
    k: 'reuniaoMilMinutos',
    rotulo: 'Reuniões: 1.000 minutos de participante (R$)',
    dica: 'LiveKit: cada pessoa na sala conta seus minutos.',
  },
  { k: 'transcricaoHora', rotulo: 'Transcrição: cada hora de reunião (R$)', dica: 'Groq (Whisper).' },
  {
    k: 'armazenamentoGbMes',
    rotulo: 'Gravações: cada GB guardado por mês (R$)',
    dica: 'Cloudflare R2 (os vídeos das reuniões).',
  },
  { k: 'dolar', rotulo: 'Dólar (R$)', dica: 'Converte o que o Google Maps cobra em dólar.' },
  {
    k: 'infraMes',
    rotulo: 'Infraestrutura por mês (R$)',
    dica: 'Servidores e banco; dividido entre os clientes ativos.',
  },
];

export function FormCustos(props: { inicial: CustosPlataforma; aoSalvar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState<Record<keyof CustosPlataforma, string>>(
    Object.fromEntries(
      Object.entries(props.inicial).map(([k, v]) => [k, String(v).replace('.', ',')]),
    ) as Record<keyof CustosPlataforma, string>,
  );
  const salvar = useMutation({
    mutationFn: () =>
      api('/master/plataforma/custos', {
        metodo: 'PUT',
        corpo: Object.fromEntries(
          Object.entries(f).map(([k, v]) => [k, Number(String(v).replace(/\./g, '').replace(',', '.')) || 0]),
        ),
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['master'] });
      props.aoSalvar();
    },
  });
  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <Mensagem tipo="aviso">
        Valores de partida estimados. Ajuste para os das suas faturas para o custo e a margem ficarem certos.
      </Mensagem>
      {CAMPOS_CUSTO.map((c) => (
        <div className="campo" key={c.k}>
          <label htmlFor={`custo-${c.k}`}>{c.rotulo}</label>
          <input
            id={`custo-${c.k}`}
            className="filtro"
            inputMode="decimal"
            value={f[c.k]}
            onChange={(e) => setF({ ...f, [c.k]: e.target.value })}
          />
          <span className="campo__dica">{c.dica}</span>
        </div>
      ))}
      <ErroDaApi erro={salvar.error} />
      <Button variant="primary" type="submit" disabled={salvar.isPending}>
        {salvar.isPending ? 'Salvando…' : 'Salvar custos'}
      </Button>
    </form>
  );
}

/* ───────────────────────── Operação ───────────────────────── */

export function PlataformaOperacao() {
  const m = useMaster();
  const q = useQuery({
    queryKey: ['master', 'operacao'],
    queryFn: () => api<Operacao>('/master/plataforma/operacao'),
    enabled: m.master,
    refetchInterval: 30_000,
  });
  if (!m.carregando && !m.master) return <Navigate to="/" replace />;
  const o = q.data;
  const e = o?.enriquecimento;
  const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const maxDia = Math.max(1, ...(o?.enriquecimentoPorDia ?? []).map((d) => d.concluidos + d.erros));

  return (
    <>
      <Topo
        titulo="Operação"
        texto="A máquina por trás dos clientes: filas, enriquecimento, fontes que falharam e alertas."
        acoes={
          <Button variant="ghost" icon="landmark" href="/base-cnpj">
            Base CNPJ
          </Button>
        }
      />
      <ErroDaApi erro={q.error} />
      {!o || !e ? (
        <div className="esqueleto" />
      ) : (
        <>
          <div className="kpis">
            <Stat rotulo="Na fila do enriquecimento" valor={fmtNumero(e.na_fila)} />
            <Stat rotulo="Enriquecendo agora" valor={fmtNumero(e.rodando)} />
            <Stat rotulo="Concluídos (24 h)" valor={fmtNumero(e.concluidos24h)} />
            <Stat rotulo="Em parte (24 h)" valor={fmtNumero(e.parciais24h)} />
            <Stat rotulo="Com erro (24 h)" valor={fmtNumero(e.erros24h)} />
            <Stat rotulo="Esperando limite do plano" valor={fmtNumero(e.limite)} />
          </div>
          <div className="grade-relatorio" style={{ marginTop: 16 }}>
            <Panel titulo="Alertas em aberto" contagem={o.alertas.length}>
              {o.alertas.length ? (
                <ul className="lista-alertas">
                  {o.alertas.map((a) => (
                    <li key={a.id} className="lista-alertas__item" data-nivel={a.nivel}>
                      <b>{a.titulo}</b>
                      <span className="quieto">
                        {a.contaNome ?? 'Plataforma'} · desde {fmtQuando(a.primeiraVez)}
                      </span>
                      {a.texto && <span>{a.texto}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                  Nada quebrado agora.
                </p>
              )}
            </Panel>
            <Panel titulo="Fontes que falharam (24 h)">
              {o.fontesComErro.length ? (
                <Barras
                  rotulo="Erros por fonte"
                  itens={o.fontesComErro.map((f) => ({
                    rotulo: NOME_FONTE[f.etapa] ?? f.etapa,
                    valor: f.erros,
                    detalhe: `${pct(f.erros, f.total)} das tentativas`,
                  }))}
                />
              ) : (
                <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                  Nenhuma fonte falhou nas últimas 24 horas.
                </p>
              )}
            </Panel>
            <Panel titulo="Enriquecimento por dia (14 dias)">
              <figure className="ritmo">
                <div className="ritmo__colunas" aria-hidden="true">
                  {o.enriquecimentoPorDia.map((d) => (
                    <div
                      key={d.dia}
                      className="ritmo__coluna"
                      title={`${dia(d.dia)}: ${d.concluidos} concluídos · ${d.erros} com erro`}
                    >
                      <span
                        className="ritmo__barra"
                        style={{ height: `${((d.concluidos + d.erros) / maxDia) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                <table className="pp-sr">
                  <caption>Leads enriquecidos por dia</caption>
                  <tbody>
                    {o.enriquecimentoPorDia.map((d) => (
                      <tr key={d.dia}>
                        <td>{dia(d.dia)}</td>
                        <td>{d.concluidos}</td>
                        <td>{d.erros}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <figcaption className="ritmo__eixo">
                  <span>{dia(o.enriquecimentoPorDia[0]?.dia ?? '')}</span>
                  <span>
                    {fmtNumero(o.enriquecimentoPorDia.reduce((s, d) => s + d.concluidos, 0))} concluídos no
                    período
                  </span>
                  <span>{dia(o.enriquecimentoPorDia.at(-1)?.dia ?? '')}</span>
                </figcaption>
              </figure>
            </Panel>
            <Panel titulo="Filas e bases">
              <ul className="lista-operacao">
                {Object.entries(o.filas)
                  .filter(([k]) => !k.startsWith('__'))
                  .map(([k, n]) => (
                    <li key={k} className="lista-operacao__item">
                      <span>{NOME_FILA[k] ?? k}</span>
                      <b className="mono lista-operacao__valor">{fmtNumero(n)}</b>
                    </li>
                  ))}
                <li className="lista-operacao__item">
                  <span>Base CNPJ (última importação)</span>
                  <b className="mono lista-operacao__valor">
                    {o.baseCnpj
                      ? `${o.baseCnpj.mes} · ${o.baseCnpj.status === 'concluida' ? 'ok' : o.baseCnpj.status}`
                      : '—'}
                  </b>
                </li>
                <li className="lista-operacao__item">
                  <span>Base paga no mês</span>
                  <b className="mono lista-operacao__valor">
                    {fmtNumero(o.basePaga.consultas)} · {fmtReaisCentavos(o.basePaga.custo)}
                  </b>
                </li>
              </ul>
            </Panel>
            <VozDoArgos />
          </div>
        </>
      )}
    </>
  );
}

/** Argos: o que está ligado (dados, ouvir, falar) e a voz que vale para todos os clientes. */
function VozDoArgos() {
  const cliente = useQueryClient();
  const sessao = useSessao();
  const q = useQuery({
    queryKey: ['assistente', 'voz'],
    queryFn: () => api<ConfigVozDTO>('/assistente/voz'),
  });
  const [voz, setVoz] = useState<string | null>(null);
  const [velocidade, setVelocidade] = useState<number | null>(null);
  const [erroAmostra, setErroAmostra] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: () =>
      api('/assistente/voz', {
        metodo: 'PUT',
        corpo: { voz: voz ?? q.data?.voz, velocidade: velocidade ?? q.data?.velocidade },
      }),
    onSuccess: () => {
      recarregarVoz();
      cliente.invalidateQueries({ queryKey: ['assistente', 'voz'] });
    },
  });
  const c = q.data;
  if (!c) return <ErroDaApi erro={q.error} />;
  const v = voz ?? c.voz;
  const vel = velocidade ?? c.velocidade;
  const estado = (ok: boolean) => (
    <Badge tone={ok ? 'brand' : 'outline'}>{ok ? 'Ligado' : 'Desligado'}</Badge>
  );
  return (
    <Panel titulo="Argos (assistente)">
      <ul className="lista-operacao">
        <li className="lista-operacao__item">
          <span>Consultar os dados (só leitura, por escopo)</span>
          {estado(c.dados)}
        </li>
        <li className="lista-operacao__item">
          <span>Ouvir (GROQ_CHAVE)</span>
          {estado(c.ouvir)}
        </li>
        <li className="lista-operacao__item">
          <span>Falar com voz natural (OPENAI_CHAVE)</span>
          {estado(c.disponivel)}
        </li>
      </ul>
      {c.disponivel && (
        <div className="pilha" style={{ gap: 10, marginTop: 12 }}>
          <div className="campo">
            <label htmlFor="argos-voz">Voz (vale para todos os clientes)</label>
            <select id="argos-voz" className="filtro" value={v} onChange={(e) => setVoz(e.target.value)}>
              {c.vozes.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="argos-velocidade">Velocidade: {vel.toLocaleString('pt-BR')}×</label>
            <input
              id="argos-velocidade"
              type="range"
              min={0.8}
              max={1.5}
              step={0.02}
              value={vel}
              onChange={(e) => setVelocidade(Number(e.target.value))}
            />
          </div>
          {erroAmostra && <Mensagem tipo="erro">{erroAmostra}</Mensagem>}
          <ErroDaApi erro={salvar.error} />
          <div className="acoes">
            <Button
              variant="ghost"
              icon="volume-2"
              onClick={() => {
                setErroAmostra(null);
                ouvirAmostra(v, vel, sessao.data?.nome.split(' ')[0] ?? '').catch(() =>
                  setErroAmostra('Não consegui tocar a amostra agora.'),
                );
              }}
            >
              Ouvir
            </Button>
            <Button
              variant="primary"
              disabled={salvar.isPending || (v === c.voz && vel === c.velocidade)}
              onClick={() => salvar.mutate()}
            >
              Salvar voz
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
