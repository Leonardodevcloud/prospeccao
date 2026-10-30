import { type ResultadoVisita, ROTULO_RESULTADO } from '@prospeccao/shared/rua';
import { Avatar, EmptyState, Stat } from '@prospeccao/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { type AgoraVendedor, type EquipeRua, nomeBonito } from './api';

/**
 * Acompanhamento das visitas: os números do período, cada vendedor (campanha, quantas fez, o que
 * conseguiu e onde está agora) e as últimas visitas com a anotação.
 */

type Periodo = 'hoje' | 'semana' | 'mes';
const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'semana', rotulo: 'Esta semana' },
  { id: 'mes', rotulo: 'Este mês' },
];

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
const fmtQuando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return dia === hoje ? fmtHora(iso) : `${dia.slice(0, 5)} ${fmtHora(iso)}`;
};

function textoAgora(a: AgoraVendedor | null): { texto: string; tom: 'brand' | 'warning' | 'neutral' } {
  if (!a) return { texto: 'Sem roteiro hoje', tom: 'neutral' };
  switch (a.tipo) {
    case 'em_visita':
      return { texto: `Na visita ${a.ordem}${a.desde ? ` · desde ${fmtHora(a.desde)}` : ''}`, tom: 'brand' };
    case 'a_caminho':
      return { texto: `A caminho da ${a.ordem}`, tom: 'warning' };
    case 'nao_comecou':
      return { texto: 'Ainda não começou', tom: 'neutral' };
    case 'terminou':
      return { texto: a.desde ? `Terminou às ${fmtHora(a.desde)}` : 'Terminou', tom: 'neutral' };
  }
}

function resumoResultados(r: Partial<Record<ResultadoVisita, number>>): string {
  const partes: string[] = [];
  const n = (k: ResultadoVisita) => r[k] ?? 0;
  if (n('fechou')) partes.push(`${n('fechou')} ${n('fechou') === 1 ? 'fechou' : 'fecharam'}`);
  if (n('proposta')) partes.push(`${n('proposta')} ${n('proposta') === 1 ? 'proposta' : 'propostas'}`);
  if (n('reuniao')) partes.push(`${n('reuniao')} ${n('reuniao') === 1 ? 'reunião' : 'reuniões'}`);
  if (n('decisor')) partes.push(`${n('decisor')} em conversa`);
  if (n('nao_estava')) partes.push(`${n('nao_estava')} não ${n('nao_estava') === 1 ? 'estava' : 'estavam'}`);
  return partes.join(', ') || '—';
}

export function EquipeRuaPainel(props: { admin: boolean }) {
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const q = useQuery({
    queryKey: ['rua', 'equipe', periodo],
    queryFn: () => api<EquipeRua>(`/rua/equipe?periodo=${periodo}`),
    refetchInterval: periodo === 'hoje' ? 60_000 : false,
  });
  const verFoto = useMutation({
    mutationFn: (paradaId: number) => api<{ url: string }>(`/rua/paradas/${paradaId}/foto`),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
  });
  const d = q.data;
  const pct = d?.numeros.feitas ? Math.round((d.numeros.comConversa / d.numeros.feitas) * 100) : null;

  return (
    <div className="rua-equipe">
      <fieldset className="rua-secao">
        <legend className="pp-sr">Período</legend>
        <div className="rua-chips">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="rua-chip"
              aria-pressed={periodo === p.id}
              onClick={() => setPeriodo(p.id)}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </fieldset>
      <ErroDaApi erro={q.error ?? verFoto.error} />

      {d && (
        <div className="rua-numeros">
          <Stat rotulo="Visitas feitas" valor={`${d.numeros.feitas} de ${d.numeros.planejadas}`} />
          <Stat
            rotulo="Falaram com quem decide"
            valor={d.numeros.comConversa}
            delta={pct != null ? `${pct}% das visitas` : undefined}
          />
          <Stat rotulo="Propostas e reuniões" valor={d.numeros.propostasReunioes} />
          <Stat rotulo="Fecharam" valor={d.numeros.fechados} />
          <Stat rotulo="Km planejados" valor={d.numeros.km.toLocaleString('pt-BR')} />
        </div>
      )}

      {d && !d.vendedores.length ? (
        <EmptyState
          icone="route"
          titulo="Nenhum roteiro neste período"
          texto="Os roteiros salvos em Planejar aparecem aqui, com o andamento de cada vendedor."
        />
      ) : (
        d && (
          <div className="rua-equipe__grade">
            <section className="rua-cartao rua-tabela-caixa" aria-label="Por vendedor">
              <table className="rua-tabela">
                <thead>
                  <tr>
                    <th>{props.admin ? 'Vendedor' : 'Você'}</th>
                    <th>Campanha</th>
                    <th>Feitas</th>
                    <th>Resultado</th>
                    {periodo === 'hoje' && <th>Agora</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.vendedores.map((v) => {
                    const agora = textoAgora(v.agora);
                    const pctV = v.total ? Math.round((v.feitas / v.total) * 100) : 0;
                    return (
                      <tr key={v.id}>
                        <td className="rua-td">
                          <span className="rua-pessoa">
                            <Avatar nome={v.nome} size={28} />
                            <b>{v.nome}</b>
                          </span>
                        </td>
                        <td className="rua-td quieto">{v.campanhas.join(', ') || '—'}</td>
                        <td className="rua-td rua-tabela__feitas">
                          <span className="mono">
                            {v.feitas} de {v.total}
                          </span>
                          <span className="rua-barra" aria-hidden="true">
                            <span style={{ width: `${pctV}%` }} />
                          </span>
                        </td>
                        <td className="rua-td">{resumoResultados(v.resultados)}</td>
                        {periodo === 'hoje' && (
                          <td className="rua-td">
                            <span className="rua-agora" data-tom={agora.tom}>
                              {agora.texto}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="rua-cartao rua-ultimas" aria-label="Últimas visitas">
              <h2 className="rua-h2">Últimas visitas</h2>
              {!d.ultimas.length ? (
                <p className="quieto">Nenhuma visita registrada ainda.</p>
              ) : (
                <ol>
                  {d.ultimas.map((u) => (
                    <li key={u.paradaId} className="rua-ultima">
                      <div className="rua-ultimas__topo">
                        <Link to={`/funil?empresa=${u.empresaId}`}>{nomeBonito(u.empresa)}</Link>
                        <span className="mono quieto">{fmtQuando(u.quando)}</span>
                      </div>
                      <span className="quieto rua-ultimas__quem">
                        {u.vendedor.split(' ')[0]} · {ROTULO_RESULTADO[u.resultado]}
                        {u.temFoto && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              className="rua-link-pequeno"
                              onClick={() => verFoto.mutate(u.paradaId)}
                            >
                              ver foto
                            </button>
                          </>
                        )}
                      </span>
                      {u.anotacao && <span className="rua-ultimas__nota">{u.anotacao}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )
      )}
    </div>
  );
}
