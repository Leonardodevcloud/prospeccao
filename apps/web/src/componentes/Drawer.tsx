import { Button } from '@prospeccao/ui';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';

/**
 * Janela por cima da tela: fecha no Esc, prende o foco dentro enquanto aberta e devolve ao
 * elemento que a abriu.
 */
function usePrenderFoco(painel: RefObject<HTMLElement | null>, aoFechar: () => void) {
  // Guarda a função mais recente sem reexecutar o efeito (o foco não pode pular a cada render).
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    painel.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar.current();
      if (e.key !== 'Tab' || !painel.current) return;
      const focaveis = painel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo?.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro?.focus();
      }
    };
    document.addEventListener('keydown', tecla);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla);
      document.body.style.overflow = overflow;
      anterior?.focus();
    };
  }, [painel]);

  return () => fechar.current();
}

/** Painel lateral (ficha, formulários). Fecha no Esc e no clique fora. */
export function Drawer(props: {
  titulo: string;
  barra?: ReactNode;
  aoFechar: () => void;
  children: ReactNode;
  /** Mais largo (prévia de e-mail, painel da conta). */
  largo?: boolean;
}) {
  const painel = useRef<HTMLElement>(null);
  const aoFechar = usePrenderFoco(painel, props.aoFechar);

  return (
    <>
      <div className="scrim" onClick={aoFechar} aria-hidden="true" />
      <aside
        ref={painel}
        className={props.largo ? 'drawer drawer--largo' : 'drawer'}
        role="dialog"
        aria-modal="true"
        aria-label={props.titulo}
        tabIndex={-1}
      >
        <div className="drawer__barra">
          <span>{props.barra}</span>
          <Button variant="ghost" size="sm" icon="x" aria-label="Fechar" onClick={aoFechar} />
        </div>
        {props.children}
      </aside>
    </>
  );
}

/**
 * Janela no centro da tela, para uma escolha ou um formulário curto. Cabeçalho e rodapé fixos;
 * o meio rola.
 */
export function Modal(props: {
  titulo: string;
  subtitulo?: ReactNode;
  aoFechar: () => void;
  children: ReactNode;
  /** Botões do rodapé. */
  rodape?: ReactNode;
  /** Antes do título (ex.: voltar). */
  antes?: ReactNode;
  largura?: 'media' | 'larga';
}) {
  const painel = useRef<HTMLDivElement>(null);
  const aoFechar = usePrenderFoco(painel, props.aoFechar);

  return (
    <div className="modal-fundo">
      <div className="scrim" onClick={aoFechar} aria-hidden="true" />
      <div
        ref={painel}
        className={props.largura === 'larga' ? 'modal modal--larga' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
        tabIndex={-1}
      >
        <header className="modal__topo">
          {props.antes}
          <div className="modal__titulos">
            <h2 id="modal-titulo" className="modal__titulo">
              {props.titulo}
            </h2>
            {props.subtitulo && <p className="modal__subtitulo">{props.subtitulo}</p>}
          </div>
          <Button variant="ghost" size="sm" icon="x" aria-label="Fechar" onClick={aoFechar} />
        </header>
        <div className="modal__corpo">{props.children}</div>
        {props.rodape && <footer className="modal__rodape">{props.rodape}</footer>}
      </div>
    </div>
  );
}
