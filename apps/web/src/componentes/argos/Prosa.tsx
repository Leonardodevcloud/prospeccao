import { Fragment, type ReactNode } from 'react';

/**
 * Markdown curto da análise do Argos (parágrafos, listas, **negrito**, `código`), montado como
 * elementos React: nada do texto vira HTML, então não há como injetar marcação.
 */
function emLinha(texto: string): ReactNode[] {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return partes.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: pedaços fixos de um texto que não muda
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : p.startsWith('`') && p.endsWith('`') ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: idem
      <code key={i}>{p.slice(1, -1)}</code>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: idem
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

export function Prosa({ texto }: { texto: string }) {
  const blocos: ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (!lista.length) return;
    const itens = lista;
    blocos.push(
      <ul key={`l${blocos.length}`}>
        {itens.map((it, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: itens fixos
          <li key={i}>{emLinha(it)}</li>
        ))}
      </ul>,
    );
    lista = [];
  };
  for (const linha of texto.split('\n')) {
    const t = linha.trim();
    const item = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(t);
    if (item) {
      lista.push(item[1] ?? '');
      continue;
    }
    fecharLista();
    if (!t) continue;
    const titulo = /^#{1,6}\s+(.*)$/.exec(t);
    blocos.push(
      titulo ? (
        <p key={`p${blocos.length}`}>
          <strong>{emLinha(titulo[1] ?? '')}</strong>
        </p>
      ) : (
        <p key={`p${blocos.length}`}>{emLinha(t)}</p>
      ),
    );
  }
  fecharLista();
  return <div className="prosa-argos">{blocos}</div>;
}
