import { Icon } from '@prospeccao/ui';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

const menosMovimento = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Símbolo do Prospect Team: três pessoas que também são um gráfico subindo (dados + time).
 * Ao montar e ao passar o mouse, elas dão pulinhos em onda.
 */
export function Logo(props: {
  tamanho?: number;
  /** cores para fundo escuro */
  escuro?: boolean;
  /** pula sozinho ao aparecer (padrão: sim) */
  pulaAoMontar?: boolean;
  /** pular de novo a cada N ms (0: não repete) */
  repetir?: number;
  className?: string;
}) {
  const [pulando, setPulando] = useState(false);
  const fim = useRef<number>(0);
  const pular = useCallback(() => {
    if (menosMovimento()) return;
    setPulando((p) => {
      if (p) return p;
      window.clearTimeout(fim.current);
      fim.current = window.setTimeout(() => setPulando(false), 1000);
      return true;
    });
  }, []);
  useEffect(() => {
    const t = props.pulaAoMontar === false ? 0 : window.setTimeout(pular, 350);
    const r = props.repetir ? window.setInterval(pular, props.repetir) : 0;
    return () => {
      window.clearTimeout(t);
      window.clearInterval(r);
      window.clearTimeout(fim.current);
    };
  }, [pular, props.pulaAoMontar, props.repetir]);

  const t = props.tamanho ?? 28;
  return (
    <svg
      className={['logo', props.escuro && 'logo--escuro', pulando && 'logo--pulando', props.className]
        .filter(Boolean)
        .join(' ')}
      viewBox="0 0 64 64"
      width={t}
      height={t}
      aria-hidden="true"
      onPointerEnter={pular}
    >
      <g className="logo__fig">
        <rect x="7" y="35" width="13" height="22" rx="6.5" />
        <circle cx="13.5" cy="26" r="6" />
      </g>
      <g className="logo__fig">
        <rect x="25.5" y="27" width="13" height="30" rx="6.5" />
        <circle cx="32" cy="18" r="6" />
      </g>
      <g className="logo__fig logo__acento">
        <rect x="44" y="19" width="13" height="38" rx="6.5" />
        <circle cx="50.5" cy="10" r="6" />
      </g>
    </svg>
  );
}

/** Nome + assinatura, ao lado do símbolo. */
export function Assinatura(props: { escuro?: boolean; tamanho?: number }) {
  return (
    <span className={`assinatura${props.escuro ? ' assinatura--escuro' : ''}`}>
      <Logo tamanho={props.tamanho ?? 40} escuro={props.escuro} />
      <span className="assinatura__texto">
        <b>Prospect Team</b>
        <span className="assinatura__sub">dados + time</span>
      </span>
    </span>
  );
}

/** O que o sistema faz, passando como avisos no painel da tela de entrada (exemplos ilustrativos). */
const EVENTOS: { icone: string; titulo: string; texto: string; tom?: 'marca' | 'aviso' }[] = [
  {
    icone: 'user-round',
    titulo: 'Decisor encontrado',
    texto: 'Sócio-administrador · quadro de sócios + Google Maps',
  },
  {
    icone: 'message-circle',
    titulo: 'Respondeu no WhatsApp',
    texto: '“Pode me ligar amanhã depois das 14h?”',
    tom: 'marca',
  },
  { icone: 'calendar', titulo: 'Reunião marcada', texto: 'Amanhã, 10h · lead passou para o closer' },
  { icone: 'send', titulo: 'Sequência em andamento', texto: '2º passo: WhatsApp pelo chip do lead' },
  {
    icone: 'badge-check',
    titulo: 'Contato confirmado',
    texto: 'Telefone visto no site e no Google',
    tom: 'marca',
  },
  { icone: 'trending-up', titulo: 'Nota A · 88', texto: 'Entrega própria e 289 avaliações' },
];

function Avisos() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (menosMovimento()) return;
    const t = window.setInterval(() => setI((x) => x + 1), 2600);
    return () => window.clearInterval(t);
  }, []);
  // três avisos à vista: o mais novo entra por cima e o mais antigo sai por baixo
  const visiveis = [0, 1, 2].map((k) => {
    const n = i - k;
    return { n, e: EVENTOS[((n % EVENTOS.length) + EVENTOS.length) % EVENTOS.length]! };
  });
  return (
    <ol className="acesso__avisos" aria-hidden="true">
      {visiveis.map(({ n, e }, k) => (
        <li key={n} className="acesso__aviso" data-pos={k} data-tom={e.tom}>
          <span className="acesso__aviso-ic">
            <Icon name={e.icone} size={16} />
          </span>
          <span>
            <b>{e.titulo}</b>
            <small className="acesso__aviso-texto">{e.texto}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Moldura das telas de entrada (login, convite, senha): painel da marca à esquerda, formulário à direita.
 * No celular, o painel vira uma faixa no topo.
 */
export function TelaAcesso(props: { children: ReactNode }) {
  return (
    <main className="acesso">
      <section className="acesso__marca" aria-label="Prospect Team">
        <div className="acesso__grade" aria-hidden="true" />
        <div className="acesso__brilho" aria-hidden="true" />
        <Assinatura escuro tamanho={44} />
        <div className="acesso__chamada">
          <h2>
            Seu time falando com <em>quem decide</em>.
          </h2>
          <p>Empresas do seu nicho, o decisor certo e a conversa no canal certo. Tudo em um lugar.</p>
        </div>
        <Avisos />
        <p className="acesso__rodape">Prospecção B2B com dados abertos, IA e o seu time</p>
      </section>
      <section className="acesso__lado">
        <div className="acesso__logo-celular">
          <Assinatura tamanho={36} />
        </div>
        {props.children}
      </section>
    </main>
  );
}
