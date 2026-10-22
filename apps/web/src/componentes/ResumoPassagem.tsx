import { Badge } from '@prospeccao/ui';
import type { ResumoPassagem as TResumo } from '../api';

const INTERESSE: Record<
  TResumo['interesse'],
  { rotulo: string; tom: 'brand' | 'warning' | 'neutral' | 'outline' }
> = {
  alto: { rotulo: 'Interesse alto', tom: 'brand' },
  medio: { rotulo: 'Interesse médio', tom: 'warning' },
  baixo: { rotulo: 'Interesse baixo', tom: 'neutral' },
  indefinido: { rotulo: 'Interesse a confirmar', tom: 'outline' },
};

/**
 * O que a IA deixou para o vendedor ao passar a conversa: em que pé está, o que foi combinado,
 * objeções, perguntas sem resposta e o próximo passo. É a leitura da IA: confira na conversa.
 */
export function ResumoPassagem(props: { r: TResumo; compacto?: boolean }) {
  const { r } = props;
  const i = INTERESSE[r.interesse] ?? INTERESSE.indefinido;
  const linhas: [string, string[]][] = [
    ['Combinado', r.combinado],
    ['Objeções', r.objecoes],
    ['Sem resposta', r.perguntasEmAberto],
  ];
  const topo = (
    <>
      <Badge tone={i.tom}>{i.rotulo}</Badge>
      <span className="resumo-ia__situacao">{r.situacao}</span>
    </>
  );
  const detalhes = (
    <>
      <dl className="resumo-ia__lista">
        {linhas
          .filter(([, itens]) => itens.length)
          .map(([rotulo, itens]) => (
            <div key={rotulo}>
              <dt>{rotulo}</dt>
              <dd>{itens.join(' · ')}</dd>
            </div>
          ))}
        {r.proximoPasso && (
          <div className="resumo-ia__passo">
            <dt>Próximo passo</dt>
            <dd>{r.proximoPasso}</dd>
          </div>
        )}
      </dl>
      <span className="resumo-ia__nota">Resumo feito pela IA: confira na conversa.</span>
    </>
  );
  // Na conversa: fechado, mostrando só a situação (abre com um toque, sem tomar o espaço das mensagens).
  if (props.compacto)
    return (
      <details className="resumo-ia" data-compacto>
        <summary className="resumo-ia__topo">
          {topo}
          <span className="resumo-ia__abrir">ver resumo</span>
        </summary>
        {detalhes}
      </details>
    );
  return (
    <div className="resumo-ia">
      <div className="resumo-ia__topo">{topo}</div>
      {detalhes}
    </div>
  );
}
