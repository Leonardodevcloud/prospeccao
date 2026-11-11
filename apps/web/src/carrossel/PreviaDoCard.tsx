import { FORMATO_PECA, type FormatoPeca } from '@prospeccao/shared/carrosseis';
import type { VariacaoCard } from '@prospeccao/shared/carrosseis-time';
import { Button } from '@prospeccao/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Modal } from '../componentes/Drawer';

/**
 * v148: a variação no tamanho do celular (a imagem de verdade, a mesma que vai para o Instagram), com
 * as setas entre as variações do card e as ações: usar esta, editar, outra variação e baixar.
 */

export const imagemGrande = (v: VariacaoCard) =>
  `/api/carrosseis/${v.id}/slides/0?largura=1080&v=${v.versao}`;

export function PreviaDoCard(props: {
  card: number;
  variacoes: VariacaoCard[];
  inicial: number;
  formato: FormatoPeca;
  fazendoOutra: boolean;
  aoEscolher: (id: number) => void;
  aoOutra: () => void;
  aoFechar: () => void;
}) {
  const [i, setI] = useState(Math.min(props.inicial, props.variacoes.length - 1));
  const v = props.variacoes[i] ?? props.variacoes[0]!;
  const n = props.variacoes.length;
  const ir = (d: number) => setI((x) => (x + d + n) % n);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % n);
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % n);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [n]);

  return (
    <Modal
      titulo={`Card ${props.card} · variação ${v.variacao} de ${n}`}
      subtitulo={`${FORMATO_PECA[props.formato].nome} · como sai no Instagram`}
      largura="larga"
      aoFechar={props.aoFechar}
    >
      <div className="previa-card" data-formato={props.formato}>
        <Button
          type="button"
          variant="ghost"
          icon="chevron-left"
          aria-label="Variação anterior"
          disabled={n < 2}
          onClick={() => ir(-1)}
        />
        <img
          key={v.id}
          className="previa-card__imagem"
          src={imagemGrande(v)}
          alt={v.slide?.titulo ? `Variação ${v.variacao}: ${v.slide.titulo.replace(/\*/g, '')}` : ''}
        />
        <Button
          type="button"
          variant="ghost"
          icon="chevron-right"
          aria-label="Próxima variação"
          disabled={n < 2}
          onClick={() => ir(1)}
        />
        <div className="previa-card__acoes">
          {v.escolhido ? (
            <span className="previa-card__escolhida">Esta é a escolhida</span>
          ) : (
            <Button type="button" variant="primary" icon="check" onClick={() => props.aoEscolher(v.id)}>
              Usar esta
            </Button>
          )}
          <Button variant="secondary" href={`/carrosseis/${v.id}`}>
            Editar
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon="sparkles"
            disabled={props.fazendoOutra}
            onClick={props.aoOutra}
          >
            {props.fazendoOutra ? 'Fazendo outra…' : 'Outra variação'}
          </Button>
          <a
            className="link-botao"
            href={imagemGrande(v)}
            download={`card-${props.card}-variacao-${v.variacao}.jpg`}
          >
            Baixar esta imagem
          </a>
          <Link className="link-botao" to={`/carrosseis/${v.id}?aba=publicacao`}>
            Publicar
          </Link>
          {n > 1 && (
            <div className="previa-card__pontos" aria-hidden="true">
              {props.variacoes.map((x, k) => (
                <span key={x.id} data-ativo={k === i || undefined} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
