import { Button } from '@prospeccao/ui';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * Painel lateral (ficha, formulários). Fecha no Esc e no clique fora; prende o
 * foco dentro enquanto aberto e devolve ao elemento que o abriu.
 */
export function Drawer(props: {
  titulo: string;
  barra?: ReactNode;
  aoFechar: () => void;
  children: ReactNode;
  /** Mais largo (prévia de e-mail, painel da conta). */
  largo?: boolean;
}) {
  const painel = useRef<HTMLElement>(null);
  // Guarda a função mais recente sem reexecutar o efeito (o foco não pode pular a cada render).
  const fechar = useRef(props.aoFechar);
  fechar.current = props.aoFechar;
  const aoFechar = () => fechar.current();

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    painel.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar.current();
      if (e.key !== 'Tab' || !painel.current) return;
      const focaveis = painel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
  }, []);

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
