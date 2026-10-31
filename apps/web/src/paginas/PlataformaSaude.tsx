import type { CotaMes, PlanosConsumo, SaudeAgora, SaudeMes, ServicoAgora } from '@prospeccao/shared/consumo';
import { Badge, Button, Panel, Stat, Tabs } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Drawer } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtNumero, fmtQuando, fmtReais, fmtReaisCentavos } from '../formatar';
import { Topo, useMaster } from './Plataforma';

/*
 * Saúde e consumo (painel master): cada serviço externo agora (atualiza a cada 15 s), o consumo do
 * mês contra o que cada plano inclui e os custos (fixos + o que passa dos planos).
 */

const ABAS = [
  { id: 'agora', rotulo: 'Agora' },
  { id: 'mes', rotulo: 'Consumo do mês' },
  { id: 'custos', rotulo: 'Custos' },
] as const;
type Aba = (typeof ABAS)[number]['id'];

const ROTULO_ESTADO: Record<ServicoAgora['estado'], string> = {
  ok: 'Respondendo',
  aviso: 'Com erros',
  erro: 'Falhando',
  quieto: 'Sem chamadas',
};

const ms = (v: number | null) =>
  v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} s` : `${v} ms`;

/** "há 4 s", contando sozinho. */
function useHaQuanto(iso: string | undefined) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return '';
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));
  return s < 60 ? `há ${s} s` : `há ${Math.round(s / 60)} min`;
}

export function PlataformaSaude() {
  const m = useMaster();
  const [busca, setBusca] = useSearchParams();
  const abaUrl = busca.get('aba');
  const aba: Aba = ABAS.some((a) => a.id === abaUrl) ? (abaUrl as Aba) : 'agora';
  const [planos, setPlanos] = useState(false);
  const agora = useQuery({
    queryKey: ['master', 'saude', 'agora'],
    queryFn: () => api<SaudeAgora>('/master/plataforma/saude/agora'),
    enabled: m.master,
    refetchInterval: 15_000,
  });
  const mes = useQuery({
    queryKey: ['master', 'saude', 'mes'],
    queryFn: () => api<SaudeMes>('/master/plataforma/saude/mes'),
    enabled: m.master,
    refetchInterval: 60_000,
  });
  const ha = useHaQuanto(agora.data?.atualizadoEm);
  if (!m.carregando && !m.master) return <Navigate to="/" replace />;

  return (
    <>
      <Topo
        titulo="Saúde e consumo"
        texto={
          <>
            Cada serviço externo que a plataforma paga: se está respondendo, quanto do plano já foi usado e
            quanto custa. A conta de demonstração fica de fora. <LinkAjuda artigo="saude-consumo" />
          </>
        }
        acoes={
          <span className="saude-vivo" aria-live="off">
            <i aria-hidden="true" />
            {agora.data ? `ao vivo · atualizado ${ha}` : 'carregando…'}
          </span>
        }
      />
      <Tabs
        itens={ABAS.map((a) => ({ ...a }))}
        ativo={aba}
        onChange={(id) => setBusca(id === 'agora' ? {} : { aba: id }, { replace: true })}
        rotulo="Saúde e consumo"
      />
      {aba === 'agora' && <Agora q={agora.data} erro={agora.error} mes={mes.data} />}
      {aba === 'mes' && <Mes d={mes.data} erro={mes.error} abrirPlanos={() => setPlanos(true)} />}
      {aba === 'custos' && <Custos d={mes.data} erro={mes.error} abrirPlanos={() => setPlanos(true)} />}
      {planos && mes.data && (
        <Drawer titulo="Planos dos serviços" barra="Saúde e consumo" aoFechar={() => setPlanos(false)} largo>
          <div className="drawer__corpo">
            <FormPlanos inicial={mes.data.planos} dolar={mes.data.dolar} aoSalvar={() => setPlanos(false)} />
          </div>
        </Drawer>
      )}
    </>
  );
}

/* ───────────────────────── Agora ───────────────────────── */

function Serie(props: { serie: number[]; erros: number[] }) {
  const max = Math.max(1, ...props.serie);
  // 60 minutos em 20 barras de 3 minutos (fica legível no celular).
  const barras = Array.from({ length: 20 }, (_, i) => ({
    n: props.serie.slice(i * 3, i * 3 + 3).reduce((a, b) => a + b, 0),
    e: props.erros.slice(i * 3, i * 3 + 3).reduce((a, b) => a + b, 0),
  }));
  const maxB = Math.max(1, ...barras.map((b) => b.n));
  return (
    <svg className="saude-serie" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true">
      {barras.map((b, i) => {
        const h = b.n ? Math.max(2, (b.n / maxB) * 22) : 1;
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: posição fixa no tempo
            key={i}
            x={i * 6}
            y={24 - h}
            width={4.5}
            height={h}
            rx={1}
            className={b.e ? 'e' : b.n ? 'n' : 'z'}
          />
        );
      })}
      <title>{`${max} chamadas no minuto de pico`}</title>
    </svg>
  );
}

function Agora(props: { q: SaudeAgora | undefined; erro: unknown; mes: SaudeMes | undefined }) {
  const { q } = props;
  if (!q) return props.erro ? <ErroDaApi erro={props.erro} /> : <div className="esqueleto" />;
  const falhando = q.servicos.filter((s) => s.estado === 'erro');
  const r = q.resumo;
  return (
    <div className="pilha" style={{ gap: 16 }}>
      <div className="kpis">
        <Stat
          rotulo="Serviços respondendo"
          valor={`${r.respondendo} de ${r.total}`}
          delta={
            falhando.length ? `${falhando.map((s) => s.nome.split(' · ')[0]).join(', ')} falhando` : undefined
          }
          tendencia="desce"
        />
        <Stat
          rotulo="Erros na última hora"
          valor={
            r.chamadasHora ? `${((r.errosHora / r.chamadasHora) * 100).toFixed(1).replace('.', ',')}%` : '—'
          }
          delta={`${fmtNumero(r.errosHora)} de ${fmtNumero(r.chamadasHora)} chamadas`}
        />
        <Stat
          rotulo="Reuniões e ligações agora"
          valor={fmtNumero(q.aoVivo.reunioes + q.aoVivo.ligacoes)}
          delta={`${q.aoVivo.reunioes} ${q.aoVivo.reunioes === 1 ? 'reunião' : 'reuniões'} (${q.aoVivo.pessoasEmSala} em sala) · ${q.aoVivo.ligacoes} ${q.aoVivo.ligacoes === 1 ? 'ligação' : 'ligações'} · ${q.aoVivo.respostasIaHora} respostas da IA na última hora`}
        />
        <Stat
          rotulo="Gasto do mês até hoje"
          valor={props.mes ? fmtReais(props.mes.custos.totalAte) : '—'}
          delta={props.mes ? `previsão: ${fmtReais(props.mes.custos.totalPrevisao)}` : undefined}
        />
      </div>
      {falhando.map((s) => (
        <Mensagem key={s.id} tipo="erro">
          <b>{s.nome} está falhando.</b>{' '}
          {s.ultimoProblema ? `${fmtQuando(s.ultimoProblema.em)}: ${s.ultimoProblema.texto}` : ''}
        </Mensagem>
      ))}
      <div className="pp-tablewrap">
        <table className="pp-table tabela-cartoes saude-tabela">
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Última hora</th>
              <th className="num">Chamadas</th>
              <th className="num">Erros</th>
              <th className="num">Resposta</th>
              <th>Último problema</th>
            </tr>
          </thead>
          <tbody>
            {q.servicos.map((s) => (
              <tr key={s.id} style={{ cursor: 'default' }}>
                <td data-rotulo="Serviço">
                  <div className="saude-servico">
                    <span className="saude-ponto" data-estado={s.estado} title={ROTULO_ESTADO[s.estado]} />
                    <div>
                      <b>{s.nome}</b>
                      <small className="quieto">{s.detalhe ?? s.papel}</small>
                    </div>
                  </div>
                </td>
                <td data-rotulo="Última hora">
                  <div>
                    <Serie serie={s.serie} erros={s.serieErros} />
                  </div>
                </td>
                <td data-rotulo="Chamadas" className="num mono">
                  <div>{fmtNumero(s.chamadas)}</div>
                </td>
                <td data-rotulo="Erros" className="num mono">
                  <div className={s.erros ? 'saude-erro' : undefined}>{fmtNumero(s.erros)}</div>
                </td>
                <td data-rotulo="Resposta" className="num mono">
                  <div>{ms(s.msMedio)}</div>
                </td>
                <td data-rotulo="Último problema">
                  <div className={`saude-problema${s.estado === 'erro' ? ' saude-erro' : ''}`}>
                    {s.ultimoProblema ? (
                      <>
                        <span className="quieto">{fmtQuando(s.ultimoProblema.em)} · </span>
                        {s.ultimoProblema.texto}
                      </>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grade-relatorio">
        <Panel titulo="Banco de dados">
          <dl className="fin-linhas">
            <div>
              <dt>Tamanho</dt>
              <dd className="mono">{q.banco.tamanhoGb.toLocaleString('pt-BR')} GB</dd>
            </div>
            <div>
              <dt>Conexões abertas</dt>
              <dd className="mono">
                {q.banco.conexoes} de {q.banco.maxConexoes}
              </dd>
            </div>
            <div>
              <dt>Tempo de uma consulta simples</dt>
              <dd className="mono">{q.banco.msConsulta} ms</dd>
            </div>
          </dl>
        </Panel>
        <Panel titulo="Serviços do sistema">
          <dl className="fin-linhas">
            {q.workers.map((w) => (
              <div key={w.nome}>
                <dt>{w.nome}</dt>
                <dd>
                  {w.parado ? (
                    <Badge tone="danger">sem sinal {fmtQuando(w.vistoEm)}</Badge>
                  ) : (
                    <span className="quieto">sinal {fmtQuando(w.vistoEm)}</span>
                  )}
                </dd>
              </div>
            ))}
            <div>
              <dt>Leads na fila do enriquecimento</dt>
              <dd className="mono">{fmtNumero(q.fila.enriquecimento)}</dd>
            </div>
          </dl>
        </Panel>
      </div>
      <p className="nota-rodape">
        Cada chamada da api e dos workers para um serviço externo é contada: quantas, quantas deram erro e o
        tempo de resposta. Vermelho: 5 erros seguidos ou mais de 20% de erro em 10 minutos (você recebe um
        aviso no sino). Cinza: o serviço não foi chamado na última hora.
      </p>
    </div>
  );
}

/* ───────────────────────── Consumo do mês ───────────────────────── */

function Cota({ c }: { c: CotaMes }) {
  const pct = (v: number | null) => `${Math.min(100, Math.max(0, (v ?? 0) * 100))}%`;
  return (
    <div className="saude-cota" data-estado={c.estado}>
      <div className="saude-cota__topo">
        <b>{c.nome}</b>
        <small className="quieto">{c.sub}</small>
      </div>
      <div className="saude-cota__valor">
        {c.valor} {c.de && <small className="quieto">{c.de}</small>}
      </div>
      {c.usado != null && (
        <div className="saude-barra" role="img" aria-label={`${Math.round(c.usado * 100)}% usado`}>
          <i style={{ width: pct(c.usado) }} />
          {c.previsao != null && c.previsao > c.usado && (
            <b style={{ left: pct(c.previsao) }} title="Previsão para o fim do mês" />
          )}
        </div>
      )}
      <p className="saude-cota__detalhe quieto">{c.detalhe}</p>
    </div>
  );
}

function Mes(props: { d: SaudeMes | undefined; erro: unknown; abrirPlanos: () => void }) {
  const { d } = props;
  if (!d) return props.erro ? <ErroDaApi erro={props.erro} /> : <div className="esqueleto" />;
  const lk = d.planos.livekit;
  return (
    <div className="pilha" style={{ gap: 16 }}>
      <div className="saude-cabeca">
        <span className="quieto">
          Dia {d.periodo.dia} de {d.periodo.dias}. A marca na barra é onde o mês fecha se continuar neste
          ritmo.
        </span>
        <Button size="sm" variant="secondary" icon="settings" onClick={props.abrirPlanos}>
          Planos dos serviços
        </Button>
      </div>
      {d.alertas.map((a) => (
        <Mensagem key={a.id} tipo="aviso">
          <b>{a.titulo}</b> {a.texto}
        </Mensagem>
      ))}
      <section className="pilha" style={{ gap: 10 }}>
        <h2 className="saude-titulo">
          LiveKit · plano {lk.plano} {lk.mensalUsd ? `(US$ ${fmtNumero(lk.mensalUsd)}/mês)` : '(grátis)'}
        </h2>
        <div className="saude-cotas">
          {d.cotas
            .filter((c) => c.grupo === 'livekit')
            .map((c) => (
              <Cota key={c.id} c={c} />
            ))}
        </div>
        <p className="quieto saude-nota">
          A gravação das reuniões e das ligações é feita pelo navegador de quem conduz: não gasta o LiveKit.
          Os arquivos vão para o R2 e a transcrição para o Groq. Confira em cloud.livekit.io › Settings ›
          Usage.
        </p>
      </section>
      <section className="pilha" style={{ gap: 10 }}>
        <h2 className="saude-titulo">Os outros serviços</h2>
        <div className="saude-cotas">
          {d.cotas
            .filter((c) => c.grupo === 'outros')
            .map((c) => (
              <Cota key={c.id} c={c} />
            ))}
        </div>
      </section>
      <p className="nota-rodape">
        Medido pelo próprio sistema (cada chamada, cada minuto de sala e de ligação) e multiplicado pelos
        preços dos Planos dos serviços e dos Custos unitários. A conta de demonstração não entra.
      </p>
    </div>
  );
}

/* ───────────────────────── Custos ───────────────────────── */

function Custos(props: { d: SaudeMes | undefined; erro: unknown; abrirPlanos: () => void }) {
  const { d } = props;
  if (!d) return props.erro ? <ErroDaApi erro={props.erro} /> : <div className="esqueleto" />;
  const c = d.custos;
  const margem = c.receita - c.totalPrevisao;
  return (
    <div className="pilha" style={{ gap: 16 }}>
      <div className="kpis">
        <Stat rotulo="Receita do mês" valor={fmtReais(c.receita)} delta={`${c.pagantes} clientes pagantes`} />
        <Stat
          rotulo="Custo até hoje"
          valor={fmtReais(c.totalAte)}
          delta={`fixo ${fmtReais(c.fixoTotal)} · variável ${fmtReais(c.variavelAte)}`}
        />
        <Stat
          rotulo="Previsão do custo no mês"
          valor={fmtReais(c.totalPrevisao)}
          delta={c.receita ? `${Math.round((c.totalPrevisao / c.receita) * 100)}% da receita` : undefined}
        />
        <Stat
          rotulo="Margem prevista"
          valor={fmtReais(margem)}
          delta={c.receita ? `${Math.round((margem / c.receita) * 100)}%` : undefined}
          tendencia={margem < 0 ? 'desce' : 'sobe'}
        />
      </div>
      <div className="saude-custos">
        <Panel
          className="saude-fixos"
          titulo="Fixos por mês"
          acoes={
            <Button size="sm" variant="secondary" icon="settings" onClick={props.abrirPlanos}>
              Planos dos serviços
            </Button>
          }
        >
          <p className="quieto saude-nota">O que você paga todo mês, use ou não use.</p>
          <dl className="fin-linhas">
            {c.fixos.map((f) => (
              <div key={f.nome}>
                <dt>
                  {f.nome} {f.plano && <Badge tone="neutral">plano</Badge>}
                </dt>
                <dd className="mono">{fmtReaisCentavos(f.valor)}</dd>
              </div>
            ))}
            {!c.fixos.length && (
              <div>
                <dt className="quieto">Nenhum custo fixo informado.</dt>
                <dd />
              </div>
            )}
            <div className="saude-total">
              <dt>Total fixo</dt>
              <dd className="mono">{fmtReaisCentavos(c.fixoTotal)}</dd>
            </div>
          </dl>
        </Panel>
        <Panel
          titulo="Variável do mês"
          acoes={<span className="quieto saude-colunas">até hoje · previsão</span>}
        >
          <p className="quieto saude-nota">O que passa do que os planos incluem e o que é cobrado por uso.</p>
          <dl className="fin-linhas">
            {c.variaveis.map((v) => (
              <div key={v.nome}>
                <dt>
                  {v.nome}
                  <small className="quieto saude-sub">{v.detalhe}</small>
                </dt>
                <dd className="mono saude-dupla">
                  <span>{fmtReaisCentavos(v.ate)}</span>
                  <span className="quieto">{fmtReaisCentavos(v.previsao)}</span>
                </dd>
              </div>
            ))}
            <div className="saude-total">
              <dt>Total variável</dt>
              <dd className="mono saude-dupla">
                <span>{fmtReaisCentavos(c.variavelAte)}</span>
                <span className="quieto">{fmtReaisCentavos(c.variavelPrevisao)}</span>
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
      <p className="nota-rodape">
        O fixo é dividido entre os clientes ativos no custo de cada um (Financeiro e Clientes). Dólar a R${' '}
        {d.dolar.toLocaleString('pt-BR')} (Custos unitários, em Configurações).
      </p>
    </div>
  );
}

/* ───────────────────────── Planos dos serviços ───────────────────────── */

type Campo = { k: string; rotulo: string; dica?: string; vazio?: boolean; texto?: boolean };

const BLOCOS: { k: Exclude<keyof PlanosConsumo, 'fixos'>; titulo: string; texto: string; campos: Campo[] }[] =
  [
    {
      k: 'livekit',
      titulo: 'LiveKit (reuniões e ligações)',
      texto: 'Build é o grátis (não cobra excedente: para); Ship custa US$ 50.',
      campos: [
        { k: 'plano', rotulo: 'Plano', texto: true },
        { k: 'mensalUsd', rotulo: 'Por mês (US$)' },
        { k: 'participanteMin', rotulo: 'Minutos de participante inclusos' },
        {
          k: 'participanteExtraUsd',
          rotulo: 'Minuto a mais (US$)',
          dica: 'Vazio: o plano não cobra, para.',
          vazio: true,
        },
        { k: 'ligacaoMin', rotulo: 'Minutos de ligação inclusos' },
        {
          k: 'ligacaoExtraUsd',
          rotulo: 'Minuto de ligação a mais (US$)',
          dica: 'Vazio: o plano não cobra, para.',
          vazio: true,
        },
      ],
    },
    {
      k: 'telefone',
      titulo: 'Operadora do telefone',
      texto: 'Quem leva a ligação até o lead. Só as atendidas são cobradas.',
      campos: [
        { k: 'operadora', rotulo: 'Operadora', texto: true },
        { k: 'mensal', rotulo: 'Franquia por mês (R$)', dica: '0 se não tem franquia.' },
        { k: 'franquiaMin', rotulo: 'Minutos da franquia' },
        { k: 'celularMin', rotulo: 'Minuto para celular (R$)' },
        { k: 'fixoMin', rotulo: 'Minuto para fixo (R$)' },
      ],
    },
    {
      k: 'serper',
      titulo: 'Serper (busca no Google)',
      texto: 'O pacote que você compra por mês (cerca de 3 buscas por lead).',
      campos: [
        { k: 'mensalUsd', rotulo: 'Pacote (US$)' },
        { k: 'creditos', rotulo: 'Créditos do pacote' },
      ],
    },
    {
      k: 'resend',
      titulo: 'Resend (e-mail)',
      texto: 'Plano, e-mails inclusos e o preço por mil acima disso.',
      campos: [
        { k: 'plano', rotulo: 'Plano', texto: true },
        { k: 'mensalUsd', rotulo: 'Por mês (US$)' },
        { k: 'emails', rotulo: 'E-mails inclusos' },
        {
          k: 'extraUsdMil',
          rotulo: 'Mil e-mails a mais (US$)',
          dica: 'Vazio: o plano não cobra, para.',
          vazio: true,
        },
      ],
    },
    {
      k: 'ia',
      titulo: 'IA da plataforma',
      texto: 'Só para avisar quando o mês for passar deste valor.',
      campos: [
        { k: 'limiteMes', rotulo: 'Limite de gasto por mês (R$)', dica: 'Vazio: sem aviso.', vazio: true },
      ],
    },
    {
      k: 'places',
      titulo: 'Google Maps (Places)',
      texto: 'Só para avisar quando o mês for passar deste valor.',
      campos: [
        { k: 'limiteUsd', rotulo: 'Limite de gasto por mês (US$)', dica: 'Vazio: sem aviso.', vazio: true },
      ],
    },
    {
      k: 'r2',
      titulo: 'Gravações (R2)',
      texto: 'GB guardados sem custo.',
      campos: [{ k: 'gbGratis', rotulo: 'GB grátis' }],
    },
    {
      k: 'ors',
      titulo: 'Rotas (OpenRouteService)',
      texto: 'Chamadas por dia do plano.',
      campos: [{ k: 'porDia', rotulo: 'Por dia' }],
    },
  ];

const paraTexto = (v: unknown) =>
  v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
const paraNumero = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'));

function FormPlanos(props: { inicial: PlanosConsumo; dolar: number; aoSalvar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(
      BLOCOS.map((b) => [
        b.k,
        Object.fromEntries(
          b.campos.map((c) => [c.k, paraTexto((props.inicial[b.k] as Record<string, unknown>)[c.k])]),
        ),
      ]),
    ),
  );
  const [fixos, setFixos] = useState(
    props.inicial.fixos.map((x) => ({ nome: x.nome, valor: paraTexto(x.valor) })),
  );
  const salvar = useMutation({
    mutationFn: () => {
      const corpo: Record<string, unknown> = {};
      for (const b of BLOCOS)
        corpo[b.k] = Object.fromEntries(
          b.campos.map((c) => {
            const v = f[b.k]![c.k]!.trim();
            return [c.k, c.texto ? v : c.vazio && v === '' ? null : paraNumero(v) || 0];
          }),
        );
      corpo.fixos = fixos
        .filter((x) => x.nome.trim())
        .map((x) => ({ nome: x.nome.trim(), valor: paraNumero(x.valor) || 0 }));
      return api('/master/plataforma/saude/planos', { metodo: 'PUT', corpo });
    },
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
        Informe o que você contratou em cada serviço. O valor por mês entra nos custos fixos; o sistema só
        soma como variável o que passar do que vem incluso.
      </Mensagem>
      {BLOCOS.map((b) => (
        <fieldset key={b.k} className="saude-bloco">
          <legend>{b.titulo}</legend>
          <p className="quieto saude-nota">{b.texto}</p>
          <div className="saude-campos">
            {b.campos.map((c) => (
              <div className="campo" key={c.k}>
                <label htmlFor={`plano-${b.k}-${c.k}`}>{c.rotulo}</label>
                <input
                  id={`plano-${b.k}-${c.k}`}
                  className="filtro"
                  inputMode={c.texto ? 'text' : 'decimal'}
                  value={f[b.k]![c.k]}
                  onChange={(e) => setF({ ...f, [b.k]: { ...f[b.k]!, [c.k]: e.target.value } })}
                />
                {c.dica && <span className="campo__dica">{c.dica}</span>}
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset className="saude-bloco">
        <legend>Outros custos fixos (R$ por mês)</legend>
        <p className="quieto saude-nota">
          Servidores (Railway), Vercel, domínios… Os planos acima já entram, não repita. Dólar: R${' '}
          {props.dolar.toLocaleString('pt-BR')}.
        </p>
        {fixos.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: linhas editáveis sem id
          <div className="saude-fixo" key={i}>
            <input
              className="filtro"
              aria-label="Nome do custo"
              placeholder="ex.: Vercel Pro"
              value={x.nome}
              onChange={(e) => setFixos(fixos.map((y, j) => (j === i ? { ...y, nome: e.target.value } : y)))}
            />
            <input
              className="filtro mono"
              aria-label={`Valor por mês de ${x.nome || 'custo'}`}
              inputMode="decimal"
              value={x.valor}
              onChange={(e) => setFixos(fixos.map((y, j) => (j === i ? { ...y, valor: e.target.value } : y)))}
            />
            <Button
              size="sm"
              variant="ghost"
              icon="trash-2"
              aria-label={`Tirar ${x.nome || 'este custo'}`}
              onClick={() => setFixos(fixos.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => setFixos([...fixos, { nome: '', valor: '' }])}
          >
            Adicionar custo fixo
          </Button>
        </div>
      </fieldset>
      <ErroDaApi erro={salvar.error} />
      <Button variant="primary" type="submit" disabled={salvar.isPending}>
        {salvar.isPending ? 'Salvando…' : 'Salvar planos'}
      </Button>
    </form>
  );
}
