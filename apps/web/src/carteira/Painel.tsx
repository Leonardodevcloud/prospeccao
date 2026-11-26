import { Stat } from '@prospeccao/ui';
import { useState } from 'react';
import { ErroDaApi } from '../componentes/Formulario';
import { fmtHoraSo, fmtNome, fmtNumero, fmtPct } from '../formatar';
import { fmtMinutos, haQuanto, usePainelCarteira, usePessoasAtendimento } from './dados';

const PERIODOS = [
  { id: 'hoje', nome: 'Hoje' },
  { id: 'semana', nome: 'Esta semana' },
  { id: 'mes', nome: 'Este mês' },
] as const;

const fmtNotaCliente = (n: number | null) => (n == null ? '–' : n.toFixed(1).replace('.', ','));

/** Painel do atendimento (gestor): a fila agora, os tempos, quem está atendendo e como terminaram. */
export function PainelDoAtendimento() {
  const [periodo, setPeriodo] = useState<'hoje' | 'semana' | 'mes'>('hoje');
  const [grupo, setGrupo] = useState<number | null>(null);
  const q = usePainelCarteira(periodo, grupo);
  const grupos = usePessoasAtendimento().data?.grupos ?? [];
  const d = q.data;
  const totalMotivos = d?.motivos.reduce((s, m) => s + m.total, 0) ?? 0;
  const maiorMotivo = Math.max(1, ...(d?.motivos.map((m) => m.total) ?? [1]));
  const totalOrigem = (d?.origens.carteira ?? 0) + (d?.origens.geral ?? 0);
  const delta =
    d?.primeiraRespostaMin != null && d.primeiraRespostaOntemMin != null && periodo === 'hoje'
      ? d.primeiraRespostaMin <= d.primeiraRespostaOntemMin
        ? `${fmtMinutos(d.primeiraRespostaOntemMin - d.primeiraRespostaMin)} melhor que ontem`
        : `${fmtMinutos(d.primeiraRespostaMin - d.primeiraRespostaOntemMin)} pior que ontem`
      : undefined;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="qualidade__filtros">
        <div className="campo">
          <span className="campo__rotulo">Período</span>
          <div className="segmentos" role="tablist" aria-label="Período">
            {PERIODOS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={periodo === p.id}
                className="segmento"
                data-ativo={periodo === p.id || undefined}
                onClick={() => setPeriodo(p.id)}
              >
                {p.nome}
              </button>
            ))}
          </div>
        </div>
        {grupos.length > 0 && (
          <div className="campo">
            <label htmlFor="pa-grupo">Loja ou grupo</label>
            <select
              id="pa-grupo"
              className="filtro"
              value={grupo ?? ''}
              onChange={(e) => setGrupo(Number(e.target.value) || null)}
            >
              <option value="">Todas</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="quieto" style={{ alignSelf: 'end', fontSize: 12 }}>
          Atualiza sozinho.
        </span>
      </div>
      <ErroDaApi erro={q.error} />
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : !d ? null : (
        <>
          <section className="secao">
            <div className="kpis painel-atend__kpis">
              <Stat
                rotulo="Na Fila geral agora"
                valor={fmtNumero(d.agora.naFila)}
                delta={
                  d.agora.filaDesde ? `a mais antiga ${haQuanto(d.agora.filaDesde)}` : 'ninguém esperando'
                }
              />
              <Stat
                rotulo="Em atendimento"
                valor={fmtNumero(d.agora.emAtendimento)}
                delta={`com ${d.agora.pessoas === 1 ? '1 pessoa' : `${fmtNumero(d.agora.pessoas)} pessoas`}`}
              />
              <Stat
                rotulo="1ª resposta (mediana)"
                valor={fmtMinutos(d.primeiraRespostaMin)}
                delta={delta}
                tendencia={
                  delta
                    ? (d.primeiraRespostaMin ?? 0) <= (d.primeiraRespostaOntemMin ?? 0)
                      ? 'sobe'
                      : 'desce'
                    : undefined
                }
              />
              <Stat
                rotulo="Tempo de atendimento"
                valor={fmtMinutos(d.duracaoMin)}
                delta="média dos encerrados"
              />
              <Stat
                rotulo="Encerrados"
                valor={fmtNumero(d.encerrados)}
                delta={`${fmtNumero(d.vendas)} com venda fechada`}
              />
              <Stat
                rotulo="Nota dos clientes"
                valor={fmtNotaCliente(d.notaMedia)}
                delta={d.notas === 1 ? '1 respondeu' : `${fmtNumero(d.notas)} responderam`}
              />
            </div>
          </section>

          <section className="secao" aria-labelledby="pa-pessoas">
            <h2 id="pa-pessoas">Agora, por pessoa</h2>
            <div className="pp-tablewrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Situação</th>
                    <th className="num">Carteira</th>
                    <th className="num">Esperando</th>
                    <th className="num">Em atendimento</th>
                    <th className="num">{periodo === 'hoje' ? 'Hoje' : 'No período'}</th>
                    <th className="num">1ª resposta</th>
                    <th className="num">Nota dos clientes</th>
                  </tr>
                </thead>
                <tbody>
                  {d.porPessoa.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <b>{fmtNome(p.nome)}</b>
                      </td>
                      <td>
                        <span className={p.disponivel ? 'disp disp--sim' : 'disp disp--nao'}>
                          {p.disponivel
                            ? 'Disponível'
                            : `Em pausa${p.pausaDesde ? ` desde ${fmtHoraSo(p.pausaDesde)}` : ''}`}
                        </span>
                        {p.paraFila > 0 && (
                          <small className="quieto painel-atend__fila">
                            {p.paraFila === 1 ? '1 foi' : `${p.paraFila} foram`} para a Fila geral
                          </small>
                        )}
                      </td>
                      <td className="num">{fmtNumero(p.carteira)}</td>
                      <td className="num" data-alerta={p.esperando > 0 || undefined}>
                        {fmtNumero(p.esperando)}
                      </td>
                      <td className="num">{fmtNumero(p.emAtendimento)}</td>
                      <td className="num">{fmtNumero(p.hoje)}</td>
                      <td className="num">{fmtMinutos(p.primeiraRespostaMin)}</td>
                      <td className="num">{fmtNotaCliente(p.nota)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="painel-atend__duas">
            <section className="tel-card painel-atend__bloco" aria-labelledby="pa-motivos">
              <h2 id="pa-motivos">Como terminaram</h2>
              {d.motivos.length ? (
                <ul className="painel-atend__barras">
                  {d.motivos.map((m) => (
                    <li key={m.motivo}>
                      <span>{m.motivo}</span>
                      <span className="painel-atend__barra" aria-hidden="true">
                        <i style={{ width: `${(m.total / maiorMotivo) * 100}%` }} />
                      </span>
                      <b className="num">{fmtNumero(m.total)}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quieto">Nenhum atendimento encerrado no período.</p>
              )}
              {totalMotivos > 0 && (
                <p className="quieto" style={{ fontSize: 12, margin: 0 }}>
                  {fmtNumero(totalMotivos)} encerrados no período.
                </p>
              )}
            </section>
            <section className="tel-card painel-atend__bloco" aria-labelledby="pa-origem">
              <h2 id="pa-origem">De onde vieram e por etiqueta</h2>
              <div className="painel-atend__origens">
                <span>
                  <b>{fmtNumero(d.origens.carteira)}</b> da carteira
                  {totalOrigem > 0 && (
                    <small className="quieto">
                      {' '}
                      · {fmtPct(d.origens.carteira, totalOrigem)} dos atendimentos
                    </small>
                  )}
                </span>
                <span>
                  <b>{fmtNumero(d.origens.geral)}</b> da Fila geral
                  {d.origens.viraramDono > 0 && (
                    <small className="quieto">
                      {' '}
                      ·{' '}
                      {d.origens.viraramDono === 1
                        ? '1 virou cliente'
                        : `${d.origens.viraramDono} viraram clientes`}{' '}
                      com dono
                    </small>
                  )}
                </span>
              </div>
              {d.etiquetas.length ? (
                <ul className="painel-atend__etiquetas">
                  {d.etiquetas.map((e) => (
                    <li key={e.nome}>
                      {e.nome} <b>{fmtNumero(e.total)}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quieto">Nenhuma etiqueta marcada no período.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
