/**
 * No celular, as tabelas viram cartões (CSS em app.css): cada célula mostra o nome da coluna antes
 * do valor. Este observador copia o título de cada coluna (thead) para as células (data-rotulo),
 * em qualquer tabela do sistema, sem precisar mexer em cada tela.
 */

function rotular(tabela: HTMLTableElement) {
  const titulos = [
    ...tabela.querySelectorAll<HTMLTableCellElement>(':scope > thead > tr:last-child > th'),
  ].map((th) => (th.innerText || th.getAttribute('aria-label') || '').trim());
  if (!titulos.length) return;
  for (const tr of tabela.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr, :scope > tfoot > tr')) {
    let coluna = 0;
    for (const td of tr.cells) {
      const t = titulos[coluna] ?? '';
      if (td.dataset.rotulo !== t) td.dataset.rotulo = t;
      coluna += td.colSpan || 1;
    }
  }
}

export function rotularTabelasNoCelular(): void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  let pendente = false;
  const rodar = () => {
    pendente = false;
    for (const t of document.querySelectorAll<HTMLTableElement>('table.pp-table')) rotular(t);
  };
  const agendar = () => {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(rodar);
  };
  new MutationObserver(agendar).observe(document.body, { childList: true, subtree: true });
  agendar();
}
