/** O símbolo do Instagram (a biblioteca de ícones não tem marcas). */
export function IconeInstagram(props: { tamanho?: number; cor?: boolean; titulo?: string }) {
  const t = props.tamanho ?? 14;
  return (
    <svg
      className={props.cor ? 'icone-ig icone-ig--cor' : 'icone-ig'}
      width={t}
      height={t}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={props.titulo ? 'img' : undefined}
      aria-label={props.titulo}
      aria-hidden={props.titulo ? undefined : true}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}
