/** Abre o tour do sistema de qualquer lugar (Ajuda, Primeiros passos): o Shell escuta o evento. */
export const abrirTour = () => window.dispatchEvent(new Event('tour:abrir'));
