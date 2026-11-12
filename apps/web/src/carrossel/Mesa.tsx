import { ETAPA_TIME, ETAPAS_TIME, type EtapaTime } from '@prospeccao/shared/carrosseis-time';
import { Icon } from '@prospeccao/ui';
import type { ReactNode } from 'react';

/**
 * v158: a mesa do time. Uma visão ilustrada de quem está trabalhando no pedido (carrossel, cards ou
 * vídeo): cada agente numa estação, a folha passando de um para o outro, o balão de quem está com a
 * vez e a conversa do time. Tudo o que aparece escrito vem do que cada etapa anotou de verdade
 * (`detalhes` do pedido, `andamento` do vídeo); nada é texto de enfeite.
 */

export type EstadoDaEstacao = 'feito' | 'agora' | 'depois';

export interface EstacaoDaMesa {
  id: string;
  nome: string;
  funcao: string;
  /** A foto do agente (o time dos carrosséis) ou, sem ela, um ícone (o time dos vídeos). */
  foto?: string;
  icone?: string;
  estado: EstadoDaEstacao;
  /** O que a estação anotou (feita) ou está fazendo (com a vez). Sem nada, aparece a função. */
  fala?: string | null;
}

const ROTULO: Record<EstadoDaEstacao, string> = {
  feito: 'Terminou',
  agora: 'Trabalhando',
  depois: 'Na fila',
};

function Rosto(props: { e: EstacaoDaMesa; tamanho: number }) {
  const { e, tamanho } = props;
  return (
    <span className="mesa__rosto" data-estado={e.estado} style={{ width: tamanho, height: tamanho }}>
      {e.foto ? (
        <img src={e.foto} alt="" width={tamanho} height={tamanho} loading="lazy" decoding="async" />
      ) : (
        <span className="mesa__icone" aria-hidden="true">
          <Icon name={e.icone ?? 'sparkles'} size={Math.round(tamanho * 0.42)} />
        </span>
      )}
      {e.estado === 'feito' && (
        <span className="mesa__feito" aria-hidden="true">
          <Icon name="check" size={Math.max(10, Math.round(tamanho * 0.17))} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

/** Os rostos empilhados, para a lista e os lugares pequenos. */
export function PilhaDoTime(props: { estacoes: EstacaoDaMesa[]; tamanho?: number }) {
  const tamanho = props.tamanho ?? 34;
  return (
    <span className="mesa-pilha" aria-hidden="true">
      {props.estacoes.map((e) => (
        <Rosto key={e.id} e={e} tamanho={tamanho} />
      ))}
    </span>
  );
}

export function MesaDoTime(props: {
  titulo: string;
  estacoes: EstacaoDaMesa[];
  /** O que passa de uma estação para a outra (um rótulo por trilho). */
  entregas: string[];
  /** A linha embaixo da mesa (ex.: a volta da revisora para a redatora). */
  nota?: string;
  /** Parado (na fila ou com erro): sem balão e sem movimento. */
  parado?: boolean;
  children?: ReactNode;
}) {
  const { estacoes } = props;
  const vez = props.parado ? -1 : estacoes.findIndex((e) => e.estado === 'agora');
  const comVez = vez >= 0 ? estacoes[vez]! : null;
  // A conversa: quem já falou (o que anotou), quem está com a vez e quem ainda espera.
  return (
    <div className="mesa" aria-live="polite">
      <section className="mesa__palco" aria-label={props.titulo}>
        <h4 className="mesa__titulo">{props.titulo}</h4>
        <div
          className="mesa__balao-area"
          style={{ ['--vez' as string]: Math.max(0, vez), ['--estacoes' as string]: estacoes.length }}
        >
          {comVez && (
            <p className="mesa__balao" key={`${comVez.id}:${comVez.fala ?? ''}`}>
              <b>{comVez.nome}:</b> {comVez.fala || comVez.funcao}
              <span className="mesa__pontos" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
          )}
        </div>
        <ol className="mesa__estacoes">
          {estacoes.map((e, k) => (
            <li key={e.id} className="mesa__estacao" data-estado={e.estado}>
              {k > 0 && (
                <span
                  className="mesa__trilho"
                  data-estado={
                    props.parado
                      ? 'depois'
                      : e.estado === 'agora'
                        ? 'agora'
                        : e.estado === 'feito'
                          ? 'feito'
                          : 'depois'
                  }
                  aria-hidden="true"
                >
                  <span className="mesa__folha">
                    <Icon name="file-text" size={15} />
                  </span>
                  <span className="mesa__entrega">{props.entregas[k - 1] ?? ''}</span>
                </span>
              )}
              <Rosto e={e} tamanho={72} />
              <b className="mesa__nome">{e.nome}</b>
              <span className="mesa__funcao">{e.funcao}</span>
              <span className="mesa__chip" data-estado={e.estado}>
                {ROTULO[e.estado]}
              </span>
            </li>
          ))}
        </ol>
        {props.nota && <p className="mesa__nota">{props.nota}</p>}
        {props.children}
      </section>
      <section className="mesa__conversa" aria-label="Conversa do time">
        <h4 className="mesa__titulo">Conversa do time</h4>
        <ol className="mesa__falas">
          {estacoes.map((e, k) => {
            const proxima = estacoes[k + 1];
            return (
              <li key={e.id} className="mesa__fala" data-estado={props.parado ? 'depois' : e.estado}>
                <Rosto e={{ ...e, estado: 'depois' }} tamanho={32} />
                <div>
                  <div className="mesa__quem">
                    <b>{e.nome}</b>
                    {e.estado === 'feito' && proxima && (
                      <span className="mesa__para">
                        <Icon name="arrow-right" size={12} /> {proxima.nome}
                      </span>
                    )}
                    <span className="mesa__quando">
                      {e.estado === 'agora' && !props.parado
                        ? 'agora'
                        : e.estado === 'feito'
                          ? 'feito'
                          : 'na fila'}
                    </span>
                  </div>
                  <p className="mesa__texto">{(e.estado !== 'depois' && e.fala) || e.funcao}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/** O time dos carrosséis e dos cards como estações da mesa. */
export function estacoesDoTime(p: {
  situacao: string;
  etapa: EtapaTime | null;
  detalhes: Partial<Record<EtapaTime, string>>;
}): EstacaoDaMesa[] {
  const atual = p.etapa ? ETAPAS_TIME.indexOf(p.etapa) : -1;
  return ETAPAS_TIME.map((e, k) => {
    const estado: EstadoDaEstacao =
      p.situacao === 'pronto'
        ? 'feito'
        : p.etapa === e
          ? 'agora'
          : // A revisora pode devolver à redatora: quem já anotou algo e não está com a vez, terminou.
            k < atual || p.detalhes[e]
            ? 'feito'
            : 'depois';
    return {
      id: e,
      nome: ETAPA_TIME[e].nome,
      funcao: ETAPA_TIME[e].faz,
      foto: ETAPA_TIME[e].foto,
      estado,
      fala: p.detalhes[e] ?? null,
    };
  });
}

export const ENTREGAS_DO_TIME = ['plano', 'texto', 'peça'];
export const NOTA_DO_TIME = 'Se a nota da revisora não passar, o texto volta para a redatora (até 2 vezes).';
