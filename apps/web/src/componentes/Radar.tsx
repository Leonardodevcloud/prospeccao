import { Badge, Button, Icon } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ROTULO_ETAPA, type TelaRadar } from '../api';
import { fmtCidade, fmtNome, fmtReais } from '../formatar';

/**
 * Radar dos negócios parados: críticos e em risco, com o motivo de cada um (o lead escreveu e
 * ninguém respondeu, a reunião passou sem registro, parado há dias sem próximo passo).
 */
export function Radar(props: { todos: boolean; aoAbrirLead: (id: number) => void }) {
  const [mais, setMais] = useState(false);
  const q = useQuery({
    queryKey: ['radar', props.todos],
    queryFn: () => api<TelaRadar>(`/funil/radar${props.todos ? '' : '?meus=1'}`),
    refetchInterval: 120_000,
  });
  const d = q.data;
  if (!d?.itens.length) return null;
  const visiveis = mais ? d.itens : d.itens.slice(0, 6);

  return (
    <section className="pilha" style={{ gap: 8 }}>
      <h2 className="subtitulo">
        <Icon name="trending-down" size={16} /> Negócios parados{' '}
        <span className="quieto">
          {d.contagem.critico ? `${d.contagem.critico} crítico${d.contagem.critico > 1 ? 's' : ''}` : ''}
          {d.contagem.critico && d.contagem.risco ? ' · ' : ''}
          {d.contagem.risco ? `${d.contagem.risco} em risco` : ''}
        </span>
      </h2>
      <ul className="tarefas">
        {visiveis.map((i) => (
          <li key={i.empresaId} className="tarefa radar-item" data-nivel={i.nivel}>
            <span className="tarefa__icone" data-tipo={i.nivel === 'critico' ? 'atrasada' : 'tarefa'}>
              <Icon name={i.nivel === 'critico' ? 'circle-x' : 'clock'} size={14} />
            </span>
            <div className="tarefa__corpo">
              <span className="tarefa__titulo">
                {fmtNome(i.nome)}
                {i.valorMensal ? <span className="quieto"> · {fmtReais(i.valorMensal)}/mês</span> : null}
              </span>
              <span className="tarefa__meta">
                {i.motivo}
                {' · '}
                {i.etapaNome ?? ROTULO_ETAPA[i.etapa]}
                {i.cidade ? ` · ${fmtCidade(i.cidade)}` : ''}
                {props.todos && i.responsavelNome ? ` · ${i.responsavelNome}` : ''}
              </span>
            </div>
            <div className="tarefa__acoes">
              <Badge tone={i.nivel === 'critico' ? 'danger' : 'warning'}>
                {i.nivel === 'critico' ? 'Crítico' : 'Em risco'}
              </Badge>
              <Button size="sm" onClick={() => props.aoAbrirLead(i.empresaId)}>
                Abrir
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {d.itens.length > 6 && (
        <Button size="sm" variant="ghost" onClick={() => setMais(!mais)}>
          {mais ? 'Mostrar menos' : `Ver todos (${d.itens.length})`}
        </Button>
      )}
    </section>
  );
}
