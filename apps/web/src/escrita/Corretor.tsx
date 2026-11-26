import { Icon } from '@prospeccao/ui';
import {
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { adicionarAoDicionario, type PalavraErrada, sugestoesPara, usePalavrasErradas } from './corretor';

/*
 * Corretor na caixa de escrever: uma camada transparente por cima do texto marca as palavras
 * erradas com o sublinhado vermelho, e a faixa de sugestões aparece quando o cursor está numa delas.
 * Não depende do corretor do navegador (que cada pessoa configura de um jeito).
 */

const ESTILOS_COPIADOS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
  'tabSize',
] as const;

/** Camada com os sublinhados, do mesmo tamanho e com a mesma fonte da caixa de texto. */
function Sublinhados(props: {
  alvo: RefObject<HTMLTextAreaElement | null>;
  texto: string;
  erradas: PalavraErrada[];
}) {
  const camada = useRef<HTMLDivElement>(null);
  const [estilo, setEstilo] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    const ta = props.alvo.current;
    if (!ta) return;
    const copiar = () => {
      const c = getComputedStyle(ta);
      const s: Record<string, string> = {};
      for (const k of ESTILOS_COPIADOS) s[k] = c[k];
      setEstilo({
        ...(s as React.CSSProperties),
        top: ta.offsetTop,
        left: ta.offsetLeft,
        width: ta.offsetWidth,
        height: ta.offsetHeight,
      });
    };
    copiar();
    const obs = new ResizeObserver(copiar);
    obs.observe(ta);
    const rolar = () => {
      if (camada.current) camada.current.scrollTop = ta.scrollTop;
    };
    ta.addEventListener('scroll', rolar);
    return () => {
      obs.disconnect();
      ta.removeEventListener('scroll', rolar);
    };
  }, [props.alvo]);
  useEffect(() => {
    const ta = props.alvo.current;
    if (ta && camada.current) camada.current.scrollTop = ta.scrollTop;
  });
  const pedacos: ReactNode[] = [];
  let pos = 0;
  for (const e of props.erradas) {
    // O texto mudou depois da conferência: só marca o que ainda está no mesmo lugar.
    if (e.inicio < pos || props.texto.slice(e.inicio, e.fim) !== e.palavra) continue;
    pedacos.push(props.texto.slice(pos, e.inicio));
    pedacos.push(
      <span key={e.inicio} className="corretor__erro">
        {e.palavra}
      </span>,
    );
    pos = e.fim;
  }
  pedacos.push(props.texto.slice(pos));
  return (
    <div ref={camada} className="corretor__camada" style={estilo} aria-hidden="true">
      {pedacos}
      {/* Um caractere a mais: a última linha vazia também conta na altura. */}
      {'​'}
    </div>
  );
}

/** A palavra errada onde o cursor está (ou logo antes dele). */
function useErradaNoCursor(
  alvo: RefObject<HTMLTextAreaElement | null>,
  erradas: PalavraErrada[],
  texto: string,
) {
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => {
    const ta = alvo.current;
    if (!ta) return;
    // Fora do evento de digitação: mudar o estado no meio do "input" faria o React repor o texto
    // antigo na caixa controlada (a letra digitada sumia).
    let t: ReturnType<typeof setTimeout> | undefined;
    const ler = () => {
      clearTimeout(t);
      t = setTimeout(() => setCursor(document.activeElement === ta ? ta.selectionStart : null), 0);
    };
    const eventos = ['keyup', 'click', 'select', 'focus', 'blur'] as const;
    for (const ev of eventos) ta.addEventListener(ev, ler);
    document.addEventListener('selectionchange', ler);
    return () => {
      clearTimeout(t);
      for (const ev of eventos) ta.removeEventListener(ev, ler);
      document.removeEventListener('selectionchange', ler);
    };
  }, [alvo]);
  if (cursor == null) return null;
  return (
    erradas.find(
      (e) => cursor >= e.inicio && cursor <= e.fim && texto.slice(e.inicio, e.fim) === e.palavra,
    ) ?? null
  );
}

/**
 * O corretor de uma caixa de texto: devolve a camada dos sublinhados (vai dentro de um elemento
 * com position: relative, junto da caixa) e a faixa de sugestões (vai acima da caixa).
 */
export function useCorretor(props: {
  alvo: RefObject<HTMLTextAreaElement | null>;
  texto: string;
  aoMudar: (novo: string) => void;
  ligado?: boolean;
}): { camada: ReactNode; sugestoes: ReactNode } {
  const ligado = props.ligado ?? true;
  const erradas = usePalavrasErradas(props.texto, ligado);
  const errada = useErradaNoCursor(props.alvo, ligado ? erradas : [], props.texto);
  const [lista, setLista] = useState<{ palavra: string; opcoes: string[] } | null>(null);
  const palavraNoCursor = errada?.palavra ?? null;
  useEffect(() => {
    if (!palavraNoCursor) return;
    let vivo = true;
    sugestoesPara(palavraNoCursor).then((opcoes) => {
      if (vivo) setLista({ palavra: palavraNoCursor, opcoes });
    });
    return () => {
      vivo = false;
    };
  }, [palavraNoCursor]);
  const trocar = (nova: string) => {
    if (!errada) return;
    const novo = props.texto.slice(0, errada.inicio) + nova + props.texto.slice(errada.fim);
    props.aoMudar(novo);
    const ta = props.alvo.current;
    if (ta)
      requestAnimationFrame(() => {
        ta.focus();
        const p = errada.inicio + nova.length;
        ta.setSelectionRange(p, p);
      });
  };
  const opcoes = errada && lista?.palavra === errada.palavra ? lista.opcoes : null;
  return {
    camada: ligado ? <Sublinhados alvo={props.alvo} texto={props.texto} erradas={erradas} /> : null,
    sugestoes: errada ? (
      <div className="corretor__sugestoes" role="status">
        <Icon name="circle-help" size={13} />
        <span className="corretor__palavra">“{errada.palavra}”</span>
        {opcoes == null ? (
          <span className="quieto">procurando…</span>
        ) : opcoes.length ? (
          <>
            <span className="quieto">Você quis dizer</span>
            {opcoes.map((o) => (
              <button
                key={o}
                type="button"
                className="corretor__opcao"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => trocar(o)}
              >
                {o}
              </button>
            ))}
          </>
        ) : (
          <span className="quieto">sem sugestão</span>
        )}
        <button
          type="button"
          className="link-botao corretor__adicionar"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => adicionarAoDicionario(errada.palavra)}
        >
          Está certo (adicionar ao dicionário)
        </button>
      </div>
    ) : null,
  };
}

/**
 * Caixa de texto com o corretor do sistema: a faixa de sugestões fica logo acima e os sublinhados
 * por cima do texto. Recebe os mesmos atributos de um textarea (menos value/onChange).
 */
export function CaixaComCorretor(
  props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'spellCheck'> & {
    value: string;
    aoMudar: (novo: string) => void;
  },
) {
  const { value, aoMudar, ...resto } = props;
  const campo = useRef<HTMLTextAreaElement>(null);
  const corretor = useCorretor({
    alvo: campo,
    texto: value,
    aoMudar,
    ligado: !resto.disabled && !resto.readOnly,
  });
  return (
    <>
      {corretor.sugestoes}
      <div className="corretor">
        <textarea
          ref={campo}
          lang="pt-BR"
          {...resto}
          spellCheck={false}
          value={value}
          onChange={(e) => aoMudar(e.target.value)}
        />
        {corretor.camada}
      </div>
    </>
  );
}
