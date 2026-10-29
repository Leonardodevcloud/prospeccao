import { Badge, Button, EmptyState, Panel, Stat } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router';
import { api, type PapelQualquer, ROTULO_PAPEL_QUALQUER } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { useSessao } from '../componentes/Sessao';
import { fmtNumero, fmtQuando, fmtReais } from '../formatar';
import { useEntrarNaUnidade, useOrganizacao } from './Organizacao';
import { Barras } from './Relatorios';

/**
 * Painel do gestor: a organização inteira somada, com ranking de unidades e de pessoas, o funil,
 * o ritmo do dia a dia, as metas e a cota de leads. O mesmo conteúdo sai em PDF para a diretoria.
 */

interface PainelOrg {
  periodo: { desde: string; ate: string; rotulo: string };
  plano: {
    plano: string | null;
    leadsMes: number | null;
    usoLeadsMes: number;
    usuarios: number | null;
    usoUsuarios: number;
  };
  totais: {
    leads: number;
    noFunil: number;
    contatos: number;
    abordados: number;
    responderam: number;
    reunioes: number;
    ganhos: number;
    perdidos: number;
    valorGanho: number;
    atrasados: number;
    taxaResposta: number | null;
    taxaReuniao: number | null;
    taxaGanho: number | null;
  };
  metasMes: { reunioes: { meta: number; feito: number }; ganhos: { meta: number; feito: number } };
  funil: Partial<
    Record<'a_abordar' | 'abordado' | 'respondeu' | 'reuniao' | 'proposta' | 'ganho' | 'perdido', number>
  >;
  unidades: {
    id: number;
    nome: string;
    ativa: boolean;
    cota: number | null;
    leads: number;
    noFunil: number;
    contatos: number;
    abordados: number;
    responderam: number;
    reunioes: number;
    ganhos: number;
    perdidos: number;
    valorGanho: number;
    atrasados: number;
    pessoas: number;
  }[];
  pessoas: {
    id: number;
    nome: string;
    papel: PapelQualquer;
    unidade: string;
    contatos: number;
    respostas: number;
    reunioes: number;
    ganhos: number;
    valorGanho: number;
    abertos: number;
    atrasados: number;
    ultimoAcesso: string | null;
    metaReunioes: number;
    metaGanhos: number;
  }[];
  diario: { dia: string; contatos: number; respostas: number; ganhos: number }[];
}

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function mesAtual(deslocamento = 0) {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const d = new Date(agora.getFullYear(), agora.getMonth() + deslocamento, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const PERIODOS: { id: string; rotulo: string; consulta: string }[] = [
  { id: '7', rotulo: 'Últimos 7 dias', consulta: 'dias=7' },
  { id: '30', rotulo: 'Últimos 30 dias', consulta: 'dias=30' },
  { id: '90', rotulo: 'Últimos 90 dias', consulta: 'dias=90' },
  { id: 'mes', rotulo: 'Este mês', consulta: `mes=${mesAtual()}` },
  { id: 'anterior', rotulo: 'Mês passado', consulta: `mes=${mesAtual(-1)}` },
];

/** Barra de progresso de uma meta (feito / meta). */
function Meta(props: { rotulo: string; feito: number; meta: number }) {
  const p = props.meta ? Math.min(1, props.feito / props.meta) : 0;
  return (
    <div className="meta-org">
      <div className="meta-org__topo">
        <span>{props.rotulo}</span>
        <b className="mono">
          {fmtNumero(props.feito)} <span className="quieto">/ {fmtNumero(props.meta)}</span>
        </b>
      </div>
      <div className="meta-org__trilho" role="img" aria-label={`${Math.round(p * 100)}% da meta`}>
        <span
          className="meta-org__barra"
          style={{ width: `${p * 100}%` }}
          data-batida={p >= 1 || undefined}
        />
      </div>
    </div>
  );
}

export function PainelGestor() {
  const sessao = useSessao();
  const daOrganizacao = !!sessao.data?.papelOrganizacao || !!sessao.data?.master;
  const [params, setParams] = useSearchParams();
  const periodo = PERIODOS.find((p) => p.id === params.get('periodo')) ?? PERIODOS[1]!;
  const q = useQuery({
    queryKey: ['organizacao', 'painel', periodo.consulta],
    queryFn: () => api<PainelOrg>(`/organizacao/painel?${periodo.consulta}`),
    enabled: daOrganizacao,
  });
  const org = useOrganizacao(daOrganizacao);
  const entrar = useEntrarNaUnidade();

  if (sessao.data && !daOrganizacao) return <Navigate to="/" replace />;
  const d = q.data;
  const t = d?.totais;
  const maxDia = Math.max(1, ...(d?.diario ?? []).map((x) => x.contatos));
  const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const unidadesAtivas = (d?.unidades ?? []).filter((u) => u.ativa);

  return (
    <>
      <div className="topo">
        <div>
          <h1>{org.data?.organizacao.nome ?? sessao.data?.organizacao?.nome ?? 'Organização'}</h1>
          <p>Todas as unidades somadas: resultado, ranking, funil, ritmo da equipe e consumo do plano.</p>
        </div>
        <div className="acoes">
          <select
            className="filtro"
            aria-label="Período"
            value={periodo.id}
            onChange={(e) => {
              const p = new URLSearchParams(params);
              p.set('periodo', e.target.value);
              setParams(p, { replace: true });
            }}
          >
            {PERIODOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            icon="file-down"
            href={`/api/organizacao/relatorio.pdf?${periodo.consulta}`}
          >
            Baixar PDF
          </Button>
        </div>
      </div>
      <ErroDaApi erro={q.error ?? entrar.error} />
      {!d || !t ? (
        <div className="esqueleto" />
      ) : (
        <>
          <div className="kpis">
            <Stat rotulo="Leads enriquecidos" valor={fmtNumero(t.leads)} />
            <Stat rotulo="Empresas abordadas" valor={fmtNumero(t.abordados)} />
            <Stat
              rotulo="Responderam"
              valor={fmtNumero(t.responderam)}
              delta={`${pct(t.taxaResposta)} das abordadas`}
            />
            <Stat
              rotulo="Reuniões"
              valor={fmtNumero(t.reunioes)}
              delta={`${pct(t.taxaReuniao)} das abordadas`}
            />
            <Stat rotulo="Ganhos" valor={fmtNumero(t.ganhos)} delta={`${pct(t.taxaGanho)} das reuniões`} />
            <Stat rotulo="Valor ganho (mensal)" valor={fmtReais(t.valorGanho)} />
          </div>

          <Panel titulo="Unidades" contagem={unidadesAtivas.length} className="org-painel">
            {unidadesAtivas.length ? (
              <div className="pp-tablewrap">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Unidade</th>
                      <th title="Empresas com pelo menos um contato no período">Abordadas</th>
                      <th>Respostas</th>
                      <th>Reuniões</th>
                      <th>Ganhos</th>
                      <th title="Follow-ups vencidos agora">Atrasados</th>
                      <th aria-label="Entrar" />
                    </tr>
                  </thead>
                  <tbody>
                    {[...unidadesAtivas]
                      .sort(
                        (a, b) => b.ganhos - a.ganhos || b.reunioes - a.reunioes || b.abordados - a.abordados,
                      )
                      .map((u, i) => (
                        <tr key={u.id}>
                          <td>
                            <span className="ranking">{i + 1}</span> <b>{u.nome}</b>
                            <div className="quieto" style={{ fontSize: 12 }}>
                              {fmtNumero(u.pessoas)} {u.pessoas === 1 ? 'pessoa' : 'pessoas'} ·{' '}
                              {fmtNumero(u.noFunil)} no funil
                            </div>
                          </td>
                          <td className="mono">{fmtNumero(u.abordados)}</td>
                          <td className="mono">{fmtNumero(u.responderam)}</td>
                          <td className="mono">{fmtNumero(u.reunioes)}</td>
                          <td className="mono">
                            {fmtNumero(u.ganhos)}
                            {u.valorGanho > 0 && (
                              <div className="quieto" style={{ fontSize: 12 }}>
                                {fmtReais(u.valorGanho)}
                              </div>
                            )}
                          </td>
                          <td className="mono" data-alerta={u.atrasados ? 'quase' : undefined}>
                            {fmtNumero(u.atrasados)}
                          </td>
                          <td>
                            {sessao.data?.conta.id !== u.id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={entrar.isPending}
                                onClick={() => entrar.mutate(u.id)}
                                aria-label={`Entrar na unidade ${u.nome}`}
                              >
                                Entrar
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icone="building-2"
                titulo="Nenhuma unidade ativa"
                texto="Crie uma unidade em Unidades e pessoas."
              />
            )}
          </Panel>

          <div className="grade-relatorio" style={{ marginTop: 16 }}>
            <Panel titulo="Metas da equipe" acoes={<span className="quieto">{d.periodo.rotulo}</span>}>
              <div className="pilha" style={{ gap: 14 }}>
                <Meta
                  rotulo="Reuniões marcadas"
                  feito={d.metasMes.reunioes.feito}
                  meta={d.metasMes.reunioes.meta}
                />
                <Meta
                  rotulo="Negócios ganhos"
                  feito={d.metasMes.ganhos.feito}
                  meta={d.metasMes.ganhos.meta}
                />
                <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
                  Meta: soma das metas mensais de cada pessoa (ajuste na tela Equipe de cada unidade).
                </p>
              </div>
            </Panel>

            <Panel titulo="Funil das negociações abertas no período">
              <Barras
                rotulo="Funil"
                itens={(
                  [
                    ['a_abordar', 'Entraram no funil'],
                    ['abordado', 'Abordadas'],
                    ['respondeu', 'Responderam'],
                    ['reuniao', 'Reunião'],
                    ['proposta', 'Proposta'],
                    ['ganho', 'Ganho'],
                  ] as const
                ).map(([k, rotulo]) => ({
                  rotulo,
                  valor: d.funil[k] ?? 0,
                  detalhe: d.funil.a_abordar ? pct((d.funil[k] ?? 0) / d.funil.a_abordar) : undefined,
                }))}
              />
            </Panel>

            <Panel titulo="Contatos por dia">
              {d.diario.some((x) => x.contatos) ? (
                <figure className="ritmo">
                  <div className="ritmo__colunas" aria-hidden="true">
                    {d.diario.map((x) => (
                      <div
                        key={x.dia}
                        className="ritmo__coluna"
                        title={`${dia(x.dia)}: ${x.contatos} contatos · ${x.respostas} respostas · ${x.ganhos} ganhos`}
                      >
                        <span
                          className="ritmo__barra"
                          style={{ height: `${(x.contatos / maxDia) * 100}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  <table className="pp-sr">
                    <caption>Contatos e respostas por dia</caption>
                    <tbody>
                      {d.diario.map((x) => (
                        <tr key={x.dia}>
                          <td>{dia(x.dia)}</td>
                          <td>{x.contatos}</td>
                          <td>{x.respostas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <figcaption className="ritmo__eixo">
                    <span>{dia(d.diario[0]?.dia ?? '')}</span>
                    <span>
                      {fmtNumero(t.contatos)} contatos ·{' '}
                      {fmtNumero(d.diario.reduce((s, x) => s + x.respostas, 0))} respostas
                    </span>
                    <span>{dia(d.diario.at(-1)?.dia ?? '')}</span>
                  </figcaption>
                </figure>
              ) : (
                <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                  Nenhum contato registrado no período.
                </p>
              )}
            </Panel>

            <Panel
              titulo="Leads do mês por unidade"
              acoes={<Link to="/organizacao/gestao">Ajustar cotas</Link>}
            >
              <div className="pilha" style={{ gap: 14 }}>
                <Meta
                  rotulo="Organização (plano)"
                  feito={d.plano.usoLeadsMes}
                  meta={d.plano.leadsMes ?? d.plano.usoLeadsMes}
                />
                {(org.data?.unidades ?? [])
                  .filter((u) => u.ativa)
                  .map((u) =>
                    u.cotaLeadsMes != null ? (
                      <Meta key={u.id} rotulo={u.nome} feito={u.leadsMes} meta={u.cotaLeadsMes} />
                    ) : (
                      <div key={u.id} className="meta-org__topo">
                        <span>{u.nome}</span>
                        <b className="mono">
                          {fmtNumero(u.leadsMes)} <span className="quieto">sem cota</span>
                        </b>
                      </div>
                    ),
                  )}
              </div>
            </Panel>
          </div>

          <Panel titulo="Pessoas" contagem={d.pessoas.length} className="org-painel">
            {d.pessoas.length ? (
              <div className="pp-tablewrap">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Pessoa</th>
                      <th>Unidade</th>
                      <th>Contatos</th>
                      <th>Respostas</th>
                      <th title="No período / meta mensal">Reuniões</th>
                      <th title="No período / meta mensal">Ganhos</th>
                      <th>Leads abertos</th>
                      <th>Último acesso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pessoas.map((p, i) => (
                      <tr key={p.id}>
                        <td>
                          <span className="ranking">{i + 1}</span> <b>{p.nome}</b>
                          <div className="quieto" style={{ fontSize: 12 }}>
                            {ROTULO_PAPEL_QUALQUER[p.papel]}
                          </div>
                        </td>
                        <td>{p.unidade}</td>
                        <td className="mono">{fmtNumero(p.contatos)}</td>
                        <td className="mono">{fmtNumero(p.respostas)}</td>
                        <td className="mono">
                          {fmtNumero(p.reunioes)}{' '}
                          <span className="quieto">/ {fmtNumero(p.metaReunioes)}</span>
                        </td>
                        <td className="mono">
                          {fmtNumero(p.ganhos)} <span className="quieto">/ {fmtNumero(p.metaGanhos)}</span>
                        </td>
                        <td className="mono">
                          {fmtNumero(p.abertos)}
                          {p.atrasados > 0 && (
                            <>
                              {' '}
                              <Badge tone="warning">{fmtNumero(p.atrasados)} atrasados</Badge>
                            </>
                          )}
                        </td>
                        <td className="quieto">{p.ultimoAcesso ? fmtQuando(p.ultimoAcesso) : 'nunca'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icone="users"
                titulo="Ninguém na equipe ainda"
                texto="Convide as pessoas em Unidades e pessoas."
              />
            )}
          </Panel>
          <p className="nota-rodape">
            Abordadas: empresas com pelo menos um contato enviado (WhatsApp, ligação, e-mail ou visita).
            Responderam: empresas que mandaram mensagem ou passaram para “Respondeu”. Cada empresa é de uma
            unidade só, então a soma não conta nada duas vezes.
          </p>
        </>
      )}
    </>
  );
}
