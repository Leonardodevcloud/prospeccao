import { type CenarioProvaDTO, ROTULO_CENARIO } from '@prospeccao/shared/ia-perfil';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtQuando } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';

/**
 * Prova da IA: conversas de teste (com armadilhas) rodadas com o mesmo cérebro do atendimento de
 * verdade. Cada resposta mostra a conferência frase a frase; uma pessoa aprova ou corrige. A
 * correção vira regra e o cenário roda de novo. Só com todas aprovadas a IA liga.
 */

export const CHAVE_IA = ['agente', 'ia'] as const;

interface TelaProva {
  cenarios: CenarioProvaDTO[];
  rodando: boolean;
}

const CHAVE_PROVA = ['agente', 'ia', 'prova'] as const;

const ROTULO_ACAO: Record<string, string> = {
  responder: 'Responde',
  marcar_reuniao: 'Marca a reunião',
  agendar_retorno: 'Combina retomar depois',
  passar_para_humano: 'Passa para o time',
  encerrar_sem_interesse: 'Encerra (sem interesse)',
  optout: 'Para de mandar mensagens',
};

function marca(c: CenarioProvaDTO): { classe: string; sinal: string; texto: string } {
  if (c.status === 'aprovada') return { classe: 'ok', sinal: '✓', texto: 'Aprovada' };
  if (c.status === 'reprovada') return { classe: 'falta', sinal: '✕', texto: 'Reprovada' };
  if (!c.rodadaEm) return { classe: 'nada', sinal: '', texto: 'Não rodou' };
  return { classe: 'sugestao', sinal: '?', texto: 'Para avaliar' };
}

function NovoCenario(props: { aoCriar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({ titulo: '', mensagem: '', esperado: '' });
  const criar = useMutation({
    mutationFn: () => api('/agente/ia/prova', { metodo: 'POST', corpo: f }),
    onSuccess: () => {
      setF({ titulo: '', mensagem: '', esperado: '' });
      cliente.invalidateQueries({ queryKey: CHAVE_PROVA });
      props.aoCriar();
    },
  });
  return (
    <form
      className="ia-bloco"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        criar.mutate();
      }}
    >
      <h3>Escrever um cenário seu</h3>
      <div className="campo">
        <label htmlFor="cen-msg">O que o cliente escreve</label>
        <textarea
          id="cen-msg"
          rows={2}
          placeholder="Ex.: vocês atendem em Aracaju no sábado?"
          value={f.mensagem}
          onChange={(e) =>
            setF({ ...f, mensagem: e.target.value, titulo: f.titulo || e.target.value.slice(0, 60) })
          }
        />
      </div>
      <div className="campo">
        <label htmlFor="cen-esp">O que você espera dela (opcional)</label>
        <input
          id="cen-esp"
          className="filtro"
          value={f.esperado}
          onChange={(e) => setF({ ...f, esperado: e.target.value })}
        />
      </div>
      <ErroDaApi erro={criar.error} />
      <Button type="submit" size="sm" disabled={criar.isPending || f.mensagem.trim().length < 2}>
        Testar este cenário
      </Button>
    </form>
  );
}

export function ProvaIa(props: { admin: boolean }) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: CHAVE_PROVA,
    queryFn: () => api<TelaProva>('/agente/ia/prova'),
    refetchInterval: (consulta) => (consulta.state.data?.rodando ? 2000 : false),
  });
  const [aberto, setAberto] = useState<number | null>(null);
  const [correcao, setCorrecao] = useState('');
  const rodando = q.data?.rodando ?? false;
  // Terminou de rodar: a prontidão muda.
  useEffect(() => {
    if (!rodando) cliente.invalidateQueries({ queryKey: CHAVE_IA });
  }, [rodando, cliente]);
  const rodar = useMutation({
    mutationFn: (ids?: number[]) => api('/agente/ia/prova/rodar', { metodo: 'POST', corpo: { ids } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: CHAVE_PROVA }),
  });
  const avaliar = useMutation({
    mutationFn: (d: { id: number; aprovar: boolean; correcao?: string }) =>
      api<TelaProva>(`/agente/ia/prova/${d.id}/avaliar`, {
        metodo: 'POST',
        corpo: { aprovar: d.aprovar, correcao: d.correcao },
      }),
    onSuccess: (d, vars) => {
      cliente.setQueryData(CHAVE_PROVA, d);
      cliente.invalidateQueries({ queryKey: CHAVE_IA });
      setCorrecao('');
      // Aprovou: vai para o próximo que falta avaliar.
      if (vars.aprovar)
        setAberto(d.cenarios.find((c) => c.status !== 'aprovada' && c.rodadaEm)?.id ?? vars.id);
    },
  });
  const apagar = useMutation({
    mutationFn: (id: number) => api(`/agente/ia/prova/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      setAberto(null);
      cliente.invalidateQueries({ queryKey: CHAVE_PROVA });
    },
  });

  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const { cenarios } = q.data;
  const aprovadas = cenarios.filter((c) => c.status === 'aprovada').length;
  const reprovadas = cenarios.filter((c) => c.status === 'reprovada').length;
  const atual =
    cenarios.find((c) => c.id === aberto) ?? cenarios.find((c) => c.status !== 'aprovada') ?? cenarios[0];
  const nuncaRodou = cenarios.every((c) => !c.rodadaEm);

  return (
    <div className="ia-prova">
      <aside className="ia-prova__lista" aria-label="Cenários da prova">
        <div className="pilha" style={{ gap: 6 }}>
          <h2>Prova</h2>
          <p className="quieto">
            {cenarios.length} conversas de teste, incluindo armadilhas. Você aprova cada resposta. A IA só
            liga com todas aprovadas.
          </p>
          <div
            className="ia-cartao__barra"
            role="progressbar"
            aria-valuenow={aprovadas}
            aria-valuemin={0}
            aria-valuemax={cenarios.length}
            aria-label="Cenários aprovados"
          >
            <span
              data-tom="brand"
              style={{ width: `${(aprovadas / Math.max(1, cenarios.length)) * 100}%` }}
            />
          </div>
          <span className="quieto" style={{ fontSize: 12 }}>
            {aprovadas} aprovadas · {reprovadas} reprovadas · {cenarios.length - aprovadas - reprovadas} por
            ver
          </span>
          {props.admin && (
            <Button
              size="sm"
              variant={nuncaRodou ? 'primary' : 'secondary'}
              icon="play"
              disabled={rodando || rodar.isPending}
              onClick={() => rodar.mutate(undefined)}
            >
              {rodando ? 'Rodando…' : nuncaRodou ? 'Rodar a prova' : 'Rodar de novo o que falta'}
            </Button>
          )}
          <ErroDaApi erro={rodar.error} />
        </div>
        <ul className="ia-prova__cenarios">
          {cenarios.map((c) => {
            const m = marca(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="ia-passo"
                  aria-current={atual?.id === c.id ? 'true' : undefined}
                  onClick={() => {
                    setAberto(c.id);
                    setCorrecao('');
                  }}
                >
                  <span className="ia-passo__marca" data-tipo={m.classe} aria-hidden="true">
                    {m.sinal}
                  </span>
                  <span className="ia-prova__item">
                    <span>{c.titulo}</span>
                    <span className="quieto">
                      {ROTULO_CENARIO[c.tipo]} · {m.texto}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {atual && (
        <section className="ia-prova__detalhe" aria-label="Cenário aberto">
          <div className="ia-prova__conversa">
            <header className="ia-prova__topo">
              <div>
                <span className="quieto">{ROTULO_CENARIO[atual.tipo]}</span>
                <h2>{atual.titulo}</h2>
              </div>
              <Badge
                tone={
                  atual.status === 'aprovada' ? 'brand' : atual.status === 'reprovada' ? 'danger' : 'neutral'
                }
              >
                {marca(atual).texto}
              </Badge>
            </header>
            {atual.esperado && (
              <p className="ia-prova__esperado">
                <b>O que se espera:</b> {atual.esperado}
              </p>
            )}
            <div className="ia-whats">
              <div className="ia-whats__lead">{atual.mensagem}</div>
              {rodando && !atual.rodadaEm ? (
                <span className="ia-whats__aviso">Rodando…</span>
              ) : atual.rodadaEm ? (
                <>
                  {atual.resposta ? (
                    <div className="ia-whats__nos">{atual.resposta}</div>
                  ) : (
                    <span className="ia-whats__aviso">
                      Sem mensagem: {ROTULO_ACAO[atual.acao ?? ''] ?? atual.acao}
                    </span>
                  )}
                  <span className="ia-whats__aviso">
                    {atual.barrada.length
                      ? 'Na vida real esta mensagem não sairia: a conferência barrou'
                      : `Decisão: ${ROTULO_ACAO[atual.acao ?? ''] ?? atual.acao}`}
                  </span>
                </>
              ) : (
                <span className="ia-whats__aviso">Ainda não rodou.</span>
              )}
            </div>
            {atual.motivo && (
              <p className="quieto" style={{ fontSize: 13, margin: 0 }}>
                Por que: {atual.motivo}
              </p>
            )}
            {props.admin && atual.rodadaEm && (
              <div className="ia-bloco">
                <h3>{atual.status === 'aprovada' ? 'Aprovada' : 'Avaliar'}</h3>
                {atual.status === 'aprovada' ? (
                  <p className="quieto" style={{ margin: 0 }}>
                    Aprovada{atual.avaliadaPor ? ` por ${atual.avaliadaPor}` : ''}. Rodada{' '}
                    {fmtQuando(atual.rodadaEm)}.
                  </p>
                ) : (
                  <>
                    <label htmlFor="prova-correcao" className="campo__rotulo">
                      Se não estiver certa: o que ela deveria ter feito
                    </label>
                    <textarea
                      id="prova-correcao"
                      rows={3}
                      value={correcao}
                      placeholder="Ex.: não pode dar desconto; dizer que condição especial é com o time e passar."
                      onChange={(e) => setCorrecao(e.target.value)}
                    />
                    <span className="campo__dica">
                      Vira regra em "Limites e passagem" e o cenário roda de novo.
                    </span>
                    <div className="acoes">
                      <Button
                        variant="primary"
                        icon="check"
                        disabled={avaliar.isPending || atual.barrada.length > 0}
                        title={
                          atual.barrada.length ? 'Mensagem barrada não pode ser aprovada: corrija' : undefined
                        }
                        onClick={() => avaliar.mutate({ id: atual.id, aprovar: true })}
                      >
                        Está certa
                      </Button>
                      <Button
                        disabled={avaliar.isPending || correcao.trim().length < 5}
                        onClick={() => avaliar.mutate({ id: atual.id, aprovar: false, correcao })}
                      >
                        Salvar correção e rodar de novo
                      </Button>
                      {atual.tipo === 'seu' && (
                        <Button
                          variant="ghost"
                          icon="trash-2"
                          disabled={apagar.isPending}
                          onClick={() => apagar.mutate(atual.id)}
                        >
                          Apagar cenário
                        </Button>
                      )}
                    </div>
                    {atual.barrada.length > 0 && (
                      <Mensagem tipo="aviso">
                        A resposta foi barrada. Escreva a correção (ou complete a configuração) e rode de
                        novo.
                      </Mensagem>
                    )}
                  </>
                )}
                <ErroDaApi erro={avaliar.error} />
              </div>
            )}
          </div>

          <aside className="ia-bloco ia-prova__conferencia" aria-label="Conferência da resposta">
            <h3>Conferência frase a frase</h3>
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              Antes de cada mensagem sair, uma segunda IA procura a fonte de cada afirmação no que vocês
              cadastraram.
            </p>
            {atual.conferencia.length ? (
              <ul className="ia-frases">
                {atual.conferencia.map((f, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: frases na ordem da resposta
                  <li key={i} data-tipo={f.tipo === 'fato' ? (f.fonte ? 'ok' : 'sem') : 'neutro'}>
                    <b>“{f.frase}”</b>
                    <span>
                      {f.tipo === 'fato'
                        ? f.fonte
                          ? `✓ ${f.fonte}: “${f.trecho}”`
                          : '✕ Sem fonte nas informações da empresa'
                        : f.tipo === 'pergunta'
                          ? 'Pergunta ao cliente: não precisa de fonte'
                          : 'Cordialidade: não precisa de fonte'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                {atual.rodadaEm ? 'Sem mensagem para conferir.' : 'Aparece depois de rodar.'}
              </p>
            )}
            {atual.barrada.length > 0 && (
              <div className="ia-prova__barrada">
                <span className="ia-como__rotulo ia-como__rotulo--nunca">O QUE BARROU</span>
                <ul>
                  {atual.barrada.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                <span className="quieto" style={{ fontSize: 12 }}>
                  Na vida real: a IA reescreve uma vez sem a parte sem fonte; se ainda não der, o lead vai
                  para o time.
                </span>
              </div>
            )}
          </aside>
        </section>
      )}
      {props.admin && (
        <div className="ia-prova__novo">
          <NovoCenario aoCriar={() => undefined} />
          <p className="quieto" style={{ fontSize: 12 }}>
            <Icon name="circle-help" size={12} /> Os cenários seus também precisam ser aprovados.
          </p>
        </div>
      )}
    </div>
  );
}
