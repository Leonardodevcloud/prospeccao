import { Button, EmptyState, Panel, Stat } from '@prospeccao/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api, type Campanha, qs, type Relatorio } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useSoLeitura } from '../componentes/Sessao';
import { fmtNumero, fmtPct, fmtReais } from '../formatar';

const NOME_FONTE_ERRO: Record<string, string> = {
  receita: 'Cadastro da Receita',
  maps: 'Google Maps',
  places: 'Google (busca por nome)',
  site: 'Site da empresa',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  google: 'Diretórios no Google',
  ia: 'IA',
  whatsapp: 'WhatsApp Business',
  base_paga: 'Base paga',
  importacao: 'Sua planilha',
  manual: 'Cadastro manual',
  desconhecida: 'Fonte desconhecida',
};

const PERIODOS = [
  { id: '7', rotulo: 'Últimos 7 dias' },
  { id: '30', rotulo: 'Últimos 30 dias' },
  { id: '90', rotulo: 'Últimos 90 dias' },
  { id: '0', rotulo: 'Desde o começo' },
];

const ETAPAS_FUNIL = [
  { id: 'a_abordar', rotulo: 'Entraram no funil' },
  { id: 'abordado', rotulo: 'Abordados' },
  { id: 'respondeu', rotulo: 'Responderam' },
  { id: 'reuniao', rotulo: 'Reunião' },
  { id: 'proposta', rotulo: 'Proposta' },
  { id: 'ganho', rotulo: 'Ganhos' },
] as const;

const NOME_FAIXA: Record<string, string> = { A: 'Nota A', B: 'Nota B', C: 'Nota C', sem_nota: 'Sem nota' };

/** Barras horizontais de uma série só (cor da marca), com o número escrito ao lado. */
export function Barras(props: {
  itens: { rotulo: string; valor: number; detalhe?: string }[];
  rotulo: string;
}) {
  const max = Math.max(1, ...props.itens.map((i) => i.valor));
  return (
    <ul className="barras" aria-label={props.rotulo}>
      {props.itens.map((i) => (
        <li
          key={i.rotulo}
          className="barras__linha"
          title={`${i.rotulo}: ${fmtNumero(i.valor)}${i.detalhe ? ` (${i.detalhe})` : ''}`}
        >
          <span className="barras__rotulo">{i.rotulo}</span>
          <span className="barras__trilho">
            <span className="barras__barra" style={{ width: `${(i.valor / max) * 100}%` }} />
          </span>
          <span className="barras__valor mono">
            {fmtNumero(i.valor)}
            {i.detalhe && <span className="quieto"> · {i.detalhe}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Contatos feitos por dia (colunas), com respostas no detalhe ao passar o mouse. */
function Ritmo({ dias }: { dias: Relatorio['diario'] }) {
  const max = Math.max(1, ...dias.map((d) => d.contatos));
  const total = dias.reduce((s, d) => s + d.contatos, 0);
  if (!total)
    return (
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Nenhum contato registrado no período. Registre os contatos na ficha do lead (aba Funil) para ver o
        ritmo aqui.
      </p>
    );
  const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return (
    <figure className="ritmo">
      <div className="ritmo__colunas" aria-hidden="true">
        {dias.map((d) => (
          <div
            key={d.dia}
            className="ritmo__coluna"
            title={`${dia(d.dia)}: ${d.contatos} contatos feitos · ${d.respostas} respostas · ${d.novosNoFunil} novos no funil`}
          >
            <span className="ritmo__barra" style={{ height: `${(d.contatos / max) * 100}%` }} />
          </div>
        ))}
      </div>
      {/* Mesma informação em tabela, para leitor de tela. */}
      <table className="pp-sr">
        <caption>Contatos feitos e respostas por dia</caption>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Contatos</th>
            <th>Respostas</th>
          </tr>
        </thead>
        <tbody>
          {dias.map((d) => (
            <tr key={d.dia}>
              <td>{dia(d.dia)}</td>
              <td>{d.contatos}</td>
              <td>{d.respostas}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="ritmo__eixo">
        <span>{dia(dias[0]?.dia ?? '')}</span>
        <span>
          máx. {fmtNumero(max)} contatos/dia · média {fmtNumero(Math.round((total / dias.length) * 10) / 10)}
        </span>
        <span>{dia(dias.at(-1)?.dia ?? '')}</span>
      </figcaption>
    </figure>
  );
}

export function Relatorios() {
  const [params, setParams] = useSearchParams();
  const dias = params.get('dias') ?? '30';
  const campanhaId = params.get('campanhaId') ?? '';
  // Exportar é só olhar: a diretoria (leitura) também baixa.
  const ehAdmin = useEhAdmin();
  const soLeitura = useSoLeitura();
  const admin = ehAdmin || soLeitura;
  const mudar = (novos: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const filtros = { dias, campanhaId: campanhaId || undefined };
  const q = useQuery({
    queryKey: ['relatorios', filtros],
    queryFn: () => api<Relatorio>(`/relatorios${qs(filtros)}`),
    placeholderData: keepPreviousData,
  });
  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });
  const r = q.data;
  const k = r?.kpis;

  return (
    <>
      <div className="topo">
        <div>
          <h1>Relatórios</h1>
          <p>Leads encontrados, andamento do funil e se a nota dos leads acerta quem fecha.</p>
        </div>
        <div className="acoes">
          {admin && (
            <Button
              icon="file-down"
              variant="ghost"
              href={`/api/exportar/relatorio${qs(filtros)}`}
              title="Baixa o relatório deste período numa planilha do Excel (uma aba por quadro)"
            >
              Exportar
            </Button>
          )}
          <label className="pp-sr" htmlFor="rel-periodo">
            Período
          </label>
          <select
            id="rel-periodo"
            className="filtro"
            value={dias}
            onChange={(e) => mudar({ dias: e.target.value })}
          >
            {PERIODOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </select>
          <label className="pp-sr" htmlFor="rel-campanha">
            Campanha
          </label>
          <select
            id="rel-campanha"
            className="filtro"
            value={campanhaId}
            onChange={(e) => mudar({ campanhaId: e.target.value || null })}
          >
            <option value="">Todas as campanhas</option>
            {campanhas.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErroDaApi erro={q.error} />

      {!r || !k ? (
        q.isPending ? (
          <div className="pilha" aria-busy="true">
            <div className="esqueleto" />
            <div className="esqueleto" />
          </div>
        ) : null
      ) : k.encontrados === 0 && k.entraramNoFunil === 0 ? (
        <div className="pp-panel">
          <EmptyState
            icone="trending-up"
            titulo="Nada no período"
            texto="Nenhum lead encontrado nem trabalhado nesse período. Escolha um período maior ou outra campanha."
          />
        </div>
      ) : (
        <>
          {(k.followupsAtrasados > 0 || k.semProximoPasso > 0) && (
            <Mensagem tipo="aviso">
              {k.followupsAtrasados > 0 && `${fmtNumero(k.followupsAtrasados)} follow-ups atrasados. `}
              {k.semProximoPasso > 0 &&
                `${fmtNumero(k.semProximoPasso)} leads em andamento sem próximo passo marcado.`}
            </Mensagem>
          )}

          <section className="secao">
            <h2>Comercial no período</h2>
            <div className="kpis">
              <Stat rotulo="Leads abordados" valor={fmtNumero(k.abordados)} />
              <Stat
                rotulo="Taxa de resposta"
                valor={fmtPct(k.responderam, k.abordados)}
                delta={`${fmtNumero(k.responderam)} responderam`}
              />
              <Stat rotulo="Reuniões" valor={fmtNumero(k.reunioes)} />
              <Stat
                rotulo="Ganhos"
                valor={fmtNumero(k.ganhos)}
                delta={
                  k.valorGanho
                    ? `${fmtReais(k.valorGanho)}/mês`
                    : `${fmtPct(k.ganhos, k.abordados)} dos abordados`
                }
              />
              <Stat rotulo="Contatos registrados" valor={fmtNumero(k.contatos)} />
            </div>
          </section>

          <section className="secao">
            <h2>Prospecção no período</h2>
            <div className="kpis">
              <Stat rotulo="Leads encontrados" valor={fmtNumero(k.encontrados)} />
              <Stat
                rotulo="Nota A ou B"
                valor={fmtNumero(k.faixaA + k.faixaB)}
                delta={`${fmtPct(k.faixaA + k.faixaB, k.enriquecidos)} dos enriquecidos`}
              />
              <Stat
                rotulo="Com possível decisor"
                valor={fmtNumero(k.comDecisor)}
                delta={`${fmtPct(k.comDecisor, k.encontrados)} dos encontrados`}
              />
              <Stat
                rotulo="Com WhatsApp"
                valor={fmtNumero(k.comWhatsapp)}
                delta={`${fmtPct(k.comWhatsapp, k.encontrados)} dos encontrados`}
              />
              <Stat rotulo="Mandados ao funil" valor={fmtNumero(k.entraramNoFunil)} />
            </div>
          </section>

          <div className="grade-relatorio">
            <Panel titulo="Funil dos leads do período">
              <Barras
                rotulo="Quantos chegaram a cada etapa"
                itens={ETAPAS_FUNIL.map((e, i) => ({
                  rotulo: e.rotulo,
                  valor: r.funil[e.id],
                  detalhe: i === 0 ? undefined : fmtPct(r.funil[e.id], r.funil.a_abordar),
                }))}
              />
              <p className="quieto nota-rodape">
                Quantos dos leads que entraram no funil no período chegaram até cada etapa (quem fechou conta
                como tendo passado pelas do meio). {fmtNumero(r.funil.perdido)} perdidos.
              </p>
            </Panel>

            <Panel titulo="Ritmo de contatos">
              <Ritmo dias={r.diario} />
            </Panel>
          </div>

          <Panel titulo="A nota acerta?" semPadding>
            <div className="pp-tablewrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Nota ao entrar no funil</th>
                    <th className="num">No funil</th>
                    <th className="num">Abordados</th>
                    <th className="num">Responderam</th>
                    <th className="num">Reunião</th>
                    <th className="num">Ganhos</th>
                    <th className="num">Resposta</th>
                    <th className="num">Conversão</th>
                  </tr>
                </thead>
                <tbody>
                  {r.faixas.length ? (
                    r.faixas.map((f) => (
                      <tr key={f.faixa}>
                        <td>{NOME_FAIXA[f.faixa]}</td>
                        <td className="num mono">{fmtNumero(f.noFunil)}</td>
                        <td className="num mono">{fmtNumero(f.abordados)}</td>
                        <td className="num mono">{fmtNumero(f.responderam)}</td>
                        <td className="num mono">{fmtNumero(f.reunioes)}</td>
                        <td className="num mono">{fmtNumero(f.ganhos)}</td>
                        <td className="num mono">{fmtPct(f.responderam, f.abordados)}</td>
                        <td className="num mono">{fmtPct(f.ganhos, f.abordados)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="quieto">
                        Ninguém entrou no funil no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="quieto nota-rodape" style={{ padding: '0 16px 16px' }}>
              Se a nota A não responde nem fecha mais que a B, os critérios da nota precisam de ajuste.
            </p>
          </Panel>

          <Panel titulo="Decisores encontrados" semPadding>
            <div className="pp-tablewrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Nota</th>
                    <th className="num">Leads</th>
                    <th className="num">Pela Receita</th>
                    <th className="num">Pelo LinkedIn</th>
                    <th className="num">Site / outras</th>
                    <th className="num">Sem decisor</th>
                    <th className="num">Com WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {r.decisores.length ? (
                    r.decisores.map((d) => (
                      <tr key={d.faixa}>
                        <td>{NOME_FAIXA[d.faixa]}</td>
                        <td className="num mono">{fmtNumero(d.total)}</td>
                        <td className="num mono">{fmtNumero(d.receita)}</td>
                        <td className="num mono">{fmtNumero(d.linkedin)}</td>
                        <td className="num mono">{fmtNumero(d.outras)}</td>
                        <td className="num mono">
                          {fmtNumero(d.semDecisor)}{' '}
                          <span className="quieto">({fmtPct(d.semDecisor, d.total)})</span>
                        </td>
                        <td className="num mono">{fmtNumero(d.comWhatsapp)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="quieto">
                        Nenhum lead enriquecido no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="quieto nota-rodape" style={{ padding: '0 16px 16px' }}>
              "Sem decisor" nas notas A e B é o que uma fonte paga de sócios e contatos resolveria: use este
              número para decidir se vale o custo.
            </p>
          </Panel>

          <Panel titulo="Campanhas" semPadding>
            <div className="pp-tablewrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th className="num">Encontrados</th>
                    <th className="num">A / B / C</th>
                    <th className="num">Com possível decisor</th>
                    <th className="num">Novos</th>
                    <th className="num">No funil</th>
                    <th className="num">Descartados</th>
                    <th className="num">Abordados</th>
                    <th className="num">Responderam</th>
                    <th className="num">Ganhos</th>
                  </tr>
                </thead>
                <tbody>
                  {r.campanhas.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nome}</td>
                      <td className="num mono">{fmtNumero(c.encontrados)}</td>
                      <td className="num mono">
                        {c.faixaA} / {c.faixaB} / {c.faixaC}
                      </td>
                      <td className="num mono">{fmtPct(c.comDecisor, c.encontrados)}</td>
                      <td className="num mono">{fmtNumero(c.novos)}</td>
                      <td className="num mono">{fmtNumero(c.noFunil)}</td>
                      <td className="num mono">{fmtNumero(c.descartados)}</td>
                      <td className="num mono">{fmtNumero(c.abordados)}</td>
                      <td className="num mono">
                        {fmtNumero(c.responderam)}{' '}
                        <span className="quieto">({fmtPct(c.responderam, c.abordados)})</span>
                      </td>
                      <td className="num mono">{fmtNumero(c.ganhos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel titulo="Quais fontes erram mais" semPadding>
            <div className="pp-tablewrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Fonte</th>
                    <th className="num">Marcados como errados</th>
                    <th className="num">Contatos dessa fonte</th>
                    <th className="num">Taxa de erro</th>
                  </tr>
                </thead>
                <tbody>
                  {r.errosPorFonte?.length ? (
                    r.errosPorFonte.map((x) => (
                      <tr key={x.fonte}>
                        <td>{NOME_FONTE_ERRO[x.fonte] ?? x.fonte}</td>
                        <td className="num mono">{fmtNumero(x.erros)}</td>
                        <td className="num mono">{fmtNumero(x.contatos)}</td>
                        <td className="num mono">{x.contatos ? fmtPct(x.erros, x.contatos) : '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="quieto">
                        Nenhum contato marcado como errado no período. Use o botão de "número errado" na ficha
                        do lead quando um telefone não for da loja.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="quieto nota-rodape" style={{ padding: '0 16px 16px' }}>
              Fonte com taxa de erro alta deve pesar menos: me avise que eu ajusto a confiança dela.
            </p>
          </Panel>

          {r.custos && (
            <Panel titulo="Custos do mês">
              <dl className="pp-fields" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <div className="pp-field">
                  <dt className="pp-field__rotulo">Base paga (Direct Data)</dt>
                  <dd className="pp-field__valor">
                    {fmtReais(r.custos.basePagaBrl)} · {fmtNumero(r.custos.basePagaConsultas)} consulta(s)
                  </dd>
                </div>
                <div className="pp-field">
                  <dt className="pp-field__rotulo">Google Places no enriquecimento</dt>
                  <dd className="pp-field__valor">
                    {fmtNumero(r.custos.placesEnriquecimento)} pedido(s) da cota grátis
                  </dd>
                </div>
              </dl>
              <p className="quieto" style={{ margin: '12px 0 0', fontSize: 12 }}>
                O uso do Places pelas campanhas aparece no painel do Google Places, em Campanhas.
              </p>
            </Panel>
          )}

          <Panel titulo="Por que perdemos ou descartamos">
            {r.motivos.length ? (
              <Barras
                rotulo="Motivos de perda e descarte"
                itens={r.motivos.map((m) => ({
                  rotulo: `${m.motivo}`,
                  valor: m.quantidade,
                  detalhe: m.etapa === 'perdido' ? 'perdido' : 'descartado',
                }))}
              />
            ) : (
              <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                Nenhuma perda ou descarte no período.
              </p>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
