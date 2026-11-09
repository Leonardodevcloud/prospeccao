import { ETAPA_TIME, ETAPAS_TIME, type EtapaTime } from '@prospeccao/shared/carrosseis-time';
import { Button, Icon } from '@prospeccao/ui';
import { Modal } from '../componentes/Drawer';

/**
 * A apresentação do time de IA dos carrosséis: na primeira entrada no módulo abre uma janela com
 * cada um (foto, nome, função e o que faz); depois o time fica numa faixa no topo da lista, e
 * "Conhecer o time" abre a apresentação de novo.
 */

export function FotoDoTime(props: { etapa: EtapaTime; tamanho: number; className?: string }) {
  const m = ETAPA_TIME[props.etapa];
  return (
    <img
      src={m.foto}
      alt={m.nome}
      width={props.tamanho}
      height={props.tamanho}
      loading="lazy"
      decoding="async"
      className={`foto-time${props.className ? ` ${props.className}` : ''}`}
    />
  );
}

export function ApresentacaoDoTime(props: {
  /** Na primeira entrada os botões chamam para o primeiro carrossel. */
  primeiraVez: boolean;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  return (
    <Modal
      largura="larga"
      titulo="Conheça o seu time de IA"
      subtitulo="Quatro especialistas que criam carrosséis com a cara da sua empresa. Você diz o que precisa, eles fazem, e você confere antes de postar."
      aoFechar={props.aoFechar}
      rodape={
        <>
          <Button variant="ghost" onClick={props.aoFechar}>
            {props.primeiraVez ? 'Ver depois' : 'Fechar'}
          </Button>
          <Button variant="primary" icon="sparkles" onClick={props.aoCriar}>
            {props.primeiraVez ? 'Criar o primeiro carrossel' : 'Novo carrossel'}
          </Button>
        </>
      }
    >
      <ul className="time-ia">
        {ETAPAS_TIME.map((e) => {
          const m = ETAPA_TIME[e];
          return (
            <li key={e} className="time-ia__membro">
              <FotoDoTime etapa={e} tamanho={112} className="time-ia__foto" />
              <div className="time-ia__texto">
                <div className="time-ia__nome">
                  <h3>{m.nome}</h3>
                  <span className="time-ia__selo">
                    <Icon name="sparkles" size={12} /> IA
                  </span>
                </div>
                <span className="time-ia__funcao">{m.funcao}</span>
                <p>{m.apresentacao}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

/** O time numa faixa no topo da lista (depois de ver a apresentação). */
export function FaixaDoTime(props: { aoConhecer: () => void }) {
  return (
    <section className="faixa-time" aria-label="Seu time de IA">
      <div className="faixa-time__fotos">
        {ETAPAS_TIME.map((e) => (
          <FotoDoTime key={e} etapa={e} tamanho={40} />
        ))}
      </div>
      <div className="faixa-time__texto">
        <b>Seu time de IA está pronto</b>
        <span className="quieto">
          {ETAPAS_TIME.slice(0, -1)
            .map((e) => ETAPA_TIME[e].nome)
            .join(', ')}{' '}
          e {ETAPA_TIME.revisor.nome} criam o carrossel; você confere antes de postar.
        </span>
      </div>
      <Button variant="secondary" onClick={props.aoConhecer}>
        Conhecer o time
      </Button>
    </section>
  );
}
