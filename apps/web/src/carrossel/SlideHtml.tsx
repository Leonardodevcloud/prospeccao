import { ALTURA_SLIDE, LARGURA_SLIDE, type No } from '@prospeccao/shared/carrosseis';
import { createElement, type ReactNode } from 'react';
import './fontes';

/**
 * Desenha a árvore do slide (a mesma que o servidor passa para o Satori) como HTML, na escala pedida.
 * Serve para a prévia ao vivo (miniaturas, identidade visual, enquanto digita); a imagem final é a
 * do servidor. O CSS de `.slide-html` imita as regras do motor de layout do Satori (sem encolher por
 * padrão, sem tamanho mínimo automático, caixa com o espaçamento por dentro).
 */

function paraReact(no: No | string, chave: string): ReactNode {
  if (typeof no === 'string') return no;
  const { children, style, ...resto } = no.props;
  const filhos = children == null ? [] : Array.isArray(children) ? children : [children];
  const props: Record<string, unknown> = { key: chave, ...resto };
  if (style) props.style = style;
  if (no.type === 'img') {
    props.alt = '';
    props.draggable = false;
    return createElement('img', props);
  }
  return createElement(no.type, props, ...filhos.map((f, i) => paraReact(f, `${chave}.${i}`)));
}

export function SlideHtml(props: { no: No; largura: number; className?: string; rotulo?: string }) {
  const escala = props.largura / LARGURA_SLIDE;
  const classe = `slide-html${props.className ? ` ${props.className}` : ''}`;
  const tamanho = {
    width: props.largura,
    height: Math.round(props.largura * (ALTURA_SLIDE / LARGURA_SLIDE)),
  };
  const tela = (
    <div className="slide-html__tela" style={{ transform: `scale(${escala})` }}>
      {paraReact(props.no, 'r')}
    </div>
  );
  return props.rotulo ? (
    <div className={classe} style={tamanho} role="img" aria-label={props.rotulo}>
      {tela}
    </div>
  ) : (
    <div className={classe} style={tamanho} aria-hidden="true">
      {tela}
    </div>
  );
}
