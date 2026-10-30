import { NOME_PLANO, planoQueLibera, RECURSOS, type Recurso } from '@prospeccao/shared/planos';
import { Button, Icon } from '@prospeccao/ui';
import { useEhAdmin } from './Sessao';

/** Telas inteiras que dependem de um recurso do plano (o menu mostra um cadeado nelas). */
export const RECURSO_DA_TELA: { prefixo: string; recurso: Recurso }[] = [
  { prefixo: '/rua', recurso: 'rua' },
  { prefixo: '/argos', recurso: 'argos' },
  { prefixo: '/atividade', recurso: 'relatorios' },
  { prefixo: '/auditoria', recurso: 'seguranca' },
  { prefixo: '/marca', recurso: 'marca' },
];

export function recursoDaTela(caminho: string): Recurso | null {
  return (
    RECURSO_DA_TELA.find((t) => caminho === t.prefixo || caminho.startsWith(`${t.prefixo}/`))?.recurso ?? null
  );
}

/** "Disponível a partir do plano Time." */
export function textoDoPlano(r: Recurso): string {
  const p = planoQueLibera(r);
  return p ? `Disponível a partir do plano ${NOME_PLANO[p]}.` : 'Disponível sob consulta.';
}

/**
 * O recurso não está no plano da empresa: o que ele faz, a partir de qual plano e o caminho para
 * contratar. `compacto` para dentro de uma tela (uma faixa); sem ele, ocupa a tela.
 */
export function ForaDoPlano(props: { recurso: Recurso; compacto?: boolean }) {
  const admin = useEhAdmin();
  const r = RECURSOS[props.recurso];
  if (props.compacto)
    return (
      <div className="fora-plano fora-plano--compacto" role="note">
        <Icon name="lock" size={16} />
        <span className="fora-plano__msg">
          <b>{r.nome}</b> não está no seu plano. {textoDoPlano(props.recurso)}{' '}
          {admin ? 'Veja em Meu plano como liberar.' : 'Fale com o administrador da sua empresa.'}
        </span>
        {admin && (
          <Button size="sm" variant="ghost" href="/plano">
            Meu plano
          </Button>
        )}
      </div>
    );
  return (
    <section className="fora-plano" aria-labelledby="fora-plano-titulo">
      <span className="fora-plano__icone" aria-hidden="true">
        <Icon name="lock" size={22} />
      </span>
      <h1 id="fora-plano-titulo" className="fora-plano__titulo">
        {r.nome}
      </h1>
      <p className="fora-plano__texto">{r.descricao}</p>
      <p className="fora-plano__texto fora-plano__plano">
        <b>{textoDoPlano(props.recurso)}</b>{' '}
        {admin
          ? 'Para liberar, fale com a gente: a mudança vale na hora, sem perder nada do que já está no sistema.'
          : 'Para liberar, fale com o administrador da sua empresa.'}
      </p>
      {admin && (
        <Button variant="primary" href="/plano">
          Ver meu plano
        </Button>
      )}
    </section>
  );
}
