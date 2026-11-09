import {
  CRITERIO_ATENDIMENTO,
  CRITERIOS_ATENDIMENTO,
  type NotaAtendimento,
  ROTULO_SITUACAO,
  situacaoDaNota,
} from '@prospeccao/shared/atendimento';
import { Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useRecurso } from '../componentes/Sessao';
import { fmtNumero, fmtQuando } from '../formatar';
import {
  fmtDiferenca,
  fmtNota,
  type ResumoDaSemana,
  rotuloSemana,
  useNotasDoLead,
  useResumoAtendimento,
} from './dados';

/**
 * As peças da Qualidade do atendimento que aparecem em mais de uma tela: o selo da nota, a nota de um
 * atendimento com os pontos da régua, as notas de um lead (Conversas), o resumo da semana de uma
 * pessoa e o cartão do Meu dia.
 */

export function SeloNota(props: { nota: number; titulo?: string }) {
  return (
    <span className="selo-nota num" data-situacao={situacaoDaNota(props.nota)} title={props.titulo}>
      {fmtNota(props.nota)}
    </span>
  );
}

const ICONE: Record<ReturnType<typeof situacaoDaNota>, string> = {
  bom: 'check',
  atencao: 'circle-help',
  faltou: 'circle-x',
};

/** Um atendimento: a nota e os pontos da régua, com o trecho e o "poderia ter sido". */
export function CartaoNota(props: { n: NotaAtendimento; gestor: boolean; aberto?: boolean }) {
  const { n } = props;
  const [aberto, setAberto] = useState(props.aberto ?? false);
  const [corrigindo, setCorrigindo] = useState(false);
  return (
    <article className="cartao-nota">
      <button
        type="button"
        className="cartao-nota__topo"
        aria-expanded={aberto}
        onClick={() => setAberto(!aberto)}
      >
        <span className="cartao-nota__titulo">
          <b>
            {n.tipo === 'ligacao' ? 'Ligação' : 'Conversa'} · {n.vendedor ?? 'Sem nome'}
          </b>
          <span className="quieto">{fmtQuando(n.fimEm)}</span>
        </span>
        <SeloNota nota={n.nota} />
        <Icon name="chevron-down" size={16} />
      </button>
      {aberto && (
        <div className="cartao-nota__corpo">
          {n.correcao && (
            <Mensagem tipo="aviso">
              Nota corrigida por {n.correcao.por ?? 'o gestor'} de {fmtNota(n.notaIa)} para{' '}
              {fmtNota(n.correcao.nota)}: {n.correcao.motivo}
            </Mensagem>
          )}
          <ul className="criterios-nota">
            {CRITERIOS_ATENDIMENTO.map((k) => {
              const c = n.criterios[k];
              if (!c) return null;
              const s = situacaoDaNota(c.nota);
              return (
                <li key={k} className="criterio-nota" data-situacao={s}>
                  <span className="criterio-nota__cabeca">
                    <b>{CRITERIO_ATENDIMENTO[k].nome}</b>
                    <span className="criterio-nota__situacao">
                      <Icon name={ICONE[s]} size={14} /> {ROTULO_SITUACAO[s]}
                    </span>
                  </span>
                  <span className="criterio-nota__texto">
                    {c.comentario}
                    {k === 'tempo' && <span className="criterio-nota__fonte">MEDIDO PELO SISTEMA</span>}
                  </span>
                  {c.trecho && <q className="criterio-nota__trecho">{c.trecho}</q>}
                  {c.sugestao && (
                    <span className="criterio-nota__sugestao">
                      <b>Poderia ter sido:</b> “{c.sugestao}”
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="quieto cartao-nota__rodape">
            Avaliada pela IA{' '}
            {n.tipo === 'ligacao' ? 'pela transcrição da ligação' : 'quando a conversa ficou parada'}. Cada
            trecho citado foi conferido no atendimento.
          </p>
          {props.gestor &&
            (corrigindo ? (
              <CorrigirNota n={n} aoFechar={() => setCorrigindo(false)} />
            ) : (
              <div className="acoes">
                <Button size="sm" variant="secondary" onClick={() => setCorrigindo(true)}>
                  {n.correcao ? 'Mudar a correção' : 'Discordar da nota'}
                </Button>
              </div>
            ))}
        </div>
      )}
    </article>
  );
}

function CorrigirNota(props: { n: NotaAtendimento; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [nota, setNota] = useState(fmtNota(props.n.correcao?.nota ?? props.n.notaIa));
  const [motivo, setMotivo] = useState(props.n.correcao?.motivo ?? '');
  const salvar = useMutation({
    mutationFn: () =>
      api<NotaAtendimento>(`/atendimento/notas/${props.n.id}/corrigir`, {
        metodo: 'POST',
        corpo: { nota: Number(nota.replace(',', '.')), motivo },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['atendimento'] });
      cliente.invalidateQueries({ queryKey: ['conversas'] });
      props.aoFechar();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };
  return (
    <form className="corrigir-nota" onSubmit={enviar}>
      <div className="campo">
        <label htmlFor={`cn-nota-${props.n.id}`}>Nota que você daria (0 a 10)</label>
        <input
          id={`cn-nota-${props.n.id}`}
          className="filtro num"
          inputMode="decimal"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          style={{ maxWidth: 120 }}
        />
      </div>
      <div className="campo">
        <label htmlFor={`cn-motivo-${props.n.id}`}>Por quê</label>
        <textarea
          id={`cn-motivo-${props.n.id}`}
          rows={2}
          maxLength={500}
          value={motivo}
          placeholder="Ex.: o cliente já tinha combinado a entrega por telefone"
          onChange={(e) => setMotivo(e.target.value)}
        />
        <span className="campo__dica">A nota da IA continua guardada; a sua passa a valer no painel.</span>
      </div>
      <ErroDaApi erro={salvar.error} />
      <div className="acoes">
        <Button type="button" size="sm" variant="ghost" onClick={props.aoFechar}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={salvar.isPending}>
          Salvar a correção
        </Button>
      </div>
    </form>
  );
}

/** As notas dos atendimentos de um lead (o painel que abre em Conversas). */
export function NotasDoLead(props: { empresaId: number; gestor: boolean }) {
  const q = useNotasDoLead(props.empresaId);
  if (q.isPending) return <div className="esqueleto" style={{ height: 200 }} />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const notas = q.data.notas;
  if (!notas.length)
    return (
      <EmptyState
        icone="badge-check"
        titulo="Nenhum atendimento avaliado ainda"
        texto="A IA dá a nota quando a conversa fica parada por 2 horas e tem pelo menos 3 mensagens da equipe."
      />
    );
  return (
    <div className="notas-lead">
      {notas.map((n, i) => (
        <CartaoNota key={n.id} n={n} gestor={props.gestor} aberto={i === 0} />
      ))}
    </div>
  );
}

/** O resumo da semana de uma pessoa (o gestor abre pelo painel; cada um vê o próprio). */
export function ResumoDaPessoa(props: { d: ResumoDaSemana; voce?: boolean }) {
  const { resumo: r, semanas } = props.d;
  const dif = fmtDiferenca(r.nota, r.notaAnterior);
  if (!r.atendimentos)
    return (
      <EmptyState
        icone="badge-check"
        titulo="Nenhum atendimento avaliado nesta semana"
        texto="A nota aparece quando há conversas paradas com pelo menos 3 mensagens da equipe ou ligações transcritas."
      />
    );
  return (
    <div className="resumo-atendimento">
      <header className="resumo-atendimento__topo">
        <div>
          <h3>{props.voce ? 'Você' : r.nome}</h3>
          <span className="quieto">
            {r.grupo ? `${r.grupo} · ` : ''}
            {fmtNumero(r.atendimentos)}{' '}
            {r.atendimentos === 1 ? 'atendimento avaliado' : 'atendimentos avaliados'}
          </span>
        </div>
        <div className="resumo-atendimento__nota">
          <span className="num">{fmtNota(r.nota)}</span>
          {dif && (
            <span className="quieto" data-sinal={dif.sinal}>
              {dif.texto === 'igual' ? 'igual à semana anterior' : `${dif.texto} na semana`}
            </span>
          )}
        </div>
      </header>

      <section aria-labelledby="ra-pontos">
        <h4 id="ra-pontos">Nota por ponto</h4>
        <dl className="barras-nota">
          {CRITERIOS_ATENDIMENTO.map((k) => {
            const v = r.criterios[k];
            if (v == null) return null;
            const fraco = r.treinar?.criterio === k;
            return (
              <div key={k} className="barras-nota__linha" data-fraco={fraco || undefined}>
                <dt>{CRITERIO_ATENDIMENTO[k].nome}</dt>
                <dd>
                  <span className="barras-nota__barra" aria-hidden="true">
                    <span style={{ width: `${v * 10}%` }} />
                  </span>
                  <span className="num">{fmtNota(v)}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {r.forte && (
        <section className="bloco-nota" data-tipo="forte" aria-labelledby="ra-forte">
          <span className="bloco-nota__rotulo">PONTO FORTE</span>
          <h4 id="ra-forte">{CRITERIO_ATENDIMENTO[r.forte.criterio].forte}</h4>
          <p>
            {CRITERIO_ATENDIMENTO[r.forte.criterio].nome}: nota {fmtNota(r.forte.nota)} na semana
            {r.forte.criterio === 'tempo' && r.primeiraRespostaMin != null
              ? `, primeira resposta em ${r.primeiraRespostaMin} min em média`
              : ''}
            .
          </p>
          {r.forte.exemplo?.trecho && (
            <blockquote>
              “{r.forte.exemplo.trecho}”
              <cite>
                {r.forte.exemplo.empresa ?? 'Atendimento'} · {fmtQuando(r.forte.exemplo.em)}
              </cite>
            </blockquote>
          )}
        </section>
      )}

      {r.treinar ? (
        <section className="bloco-nota" data-tipo="treinar" aria-labelledby="ra-treinar">
          <span className="bloco-nota__rotulo">O QUE TREINAR</span>
          <h4 id="ra-treinar">{CRITERIO_ATENDIMENTO[r.treinar.criterio].treinar}</h4>
          <p>
            {fmtNumero(r.treinar.abaixo)} de {fmtNumero(r.atendimentos)} atendimentos ficaram abaixo de 6 em “
            {CRITERIO_ATENDIMENTO[r.treinar.criterio].nome.toLowerCase()}”.
          </p>
          {r.treinar.exemplo?.trecho && (
            <blockquote>
              “{r.treinar.exemplo.trecho}”
              <cite>
                {r.treinar.exemplo.empresa ?? 'Atendimento'} · {fmtQuando(r.treinar.exemplo.em)}
              </cite>
            </blockquote>
          )}
          {r.treinar.exemplo?.sugestao && (
            <p>
              <b>Poderia ter sido:</b> “{r.treinar.exemplo.sugestao}”
            </p>
          )}
        </section>
      ) : (
        <Mensagem tipo="ok">Nenhum ponto ficou abaixo de 8 na média da semana.</Mensagem>
      )}

      <section aria-labelledby="ra-semanas">
        <h4 id="ra-semanas">Últimas 4 semanas</h4>
        <ol className="semanas-nota">
          {semanas.map((s, i) => (
            <li key={s.semana} data-atual={i === semanas.length - 1 || undefined}>
              <span className="quieto">{rotuloSemana(s.semana)}</span>
              <span className="num">{fmtNota(s.nota)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** O texto do resumo, para copiar e mandar por fora. */
export function textoDoResumo(d: ResumoDaSemana): string {
  const r = d.resumo;
  const linhas = [
    `Atendimento de ${r.nome} · semana de ${rotuloSemana(d.semana)}`,
    `Nota: ${fmtNota(r.nota)} (${fmtNumero(r.atendimentos)} atendimentos)`,
    ...CRITERIOS_ATENDIMENTO.flatMap((k) =>
      r.criterios[k] != null ? [`- ${CRITERIO_ATENDIMENTO[k].nome}: ${fmtNota(r.criterios[k]!)}`] : [],
    ),
  ];
  if (r.forte) linhas.push('', `Ponto forte: ${CRITERIO_ATENDIMENTO[r.forte.criterio].forte}`);
  if (r.treinar) {
    linhas.push(`O que treinar: ${CRITERIO_ATENDIMENTO[r.treinar.criterio].treinar}`);
    if (r.treinar.exemplo?.sugestao) linhas.push(`Poderia ter sido: “${r.treinar.exemplo.sugestao}”`);
  }
  return linhas.join('\n');
}

/** O cartão no Meu dia: a nota da semana e o ponto a treinar (só para quem tem o recurso). */
export function MeuAtendimento() {
  const tem = useRecurso('atendimento');
  const q = useResumoAtendimento('eu', null, tem);
  const r = q.data?.resumo;
  if (!tem || !r?.atendimentos) return null;
  const dif = fmtDiferenca(r.nota, r.notaAnterior);
  return (
    <section className="meu-atendimento" aria-label="Seu atendimento na semana">
      <SeloNota nota={r.nota ?? 0} />
      <div className="meu-atendimento__texto">
        <b>Seu atendimento na semana{dif && dif.texto !== 'igual' ? ` (${dif.texto})` : ''}</b>
        <span className="quieto">
          {r.treinar
            ? `Para treinar: ${CRITERIO_ATENDIMENTO[r.treinar.criterio].treinar.toLowerCase()}.`
            : 'Nenhum ponto abaixo de 8. Continue assim.'}
        </span>
      </div>
      <Link to="/qualidade" className="link-botao">
        Ver o resumo
      </Link>
    </section>
  );
}
