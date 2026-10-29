import type { PrimeirosPassosDTO } from '@prospeccao/shared';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { useEhAdmin } from './Sessao';

/**
 * Primeiros passos do administrador: o caminho até a primeira conversa com lead. Cada passo é
 * conferido nos dados (sem "marcar como feito"); some quando tudo estiver feito ou se ele fechar.
 */
export function PrimeirosPassos() {
  const admin = useEhAdmin();
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['inicio', 'primeiros-passos'],
    queryFn: () => api<PrimeirosPassosDTO>('/inicio/primeiros-passos'),
    enabled: admin,
    staleTime: 30_000,
  });
  const fechar = useMutation({
    mutationFn: () => api<PrimeirosPassosDTO>('/inicio/primeiros-passos/fechar', { metodo: 'POST' }),
    onSuccess: (d) => cliente.setQueryData(['inicio', 'primeiros-passos'], d),
  });
  const d = q.data;
  if (!admin || !d || d.fechado || d.concluido) return null;
  const proximo = d.passos.find((p) => !p.feito);
  const pct = Math.round((d.feitos / Math.max(1, d.total)) * 100);

  return (
    <section className="passos-iniciais" aria-labelledby="passos-titulo">
      <header className="passos-iniciais__topo">
        <div>
          <h2 id="passos-titulo">Primeiros passos</h2>
          <p>
            {d.feitos} de {d.total} feitos. Cada passo é conferido sozinho quando você faz.
          </p>
        </div>
        <Button size="sm" variant="ghost" disabled={fechar.isPending} onClick={() => fechar.mutate()}>
          Esconder
        </Button>
      </header>
      <div
        className="passos-iniciais__barra"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Primeiros passos feitos"
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <ol className="passos-iniciais__lista">
        {d.passos.map((p, i) => (
          <li key={p.id} data-feito={p.feito || undefined} data-proximo={p === proximo || undefined}>
            <span className="passos-iniciais__marca" aria-hidden="true">
              {p.feito ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <div className="passos-iniciais__texto">
              <b>
                {p.titulo}
                {p.feito && <span className="pp-sr"> (feito)</span>}
              </b>
              {!p.feito && <span>{p.texto}</span>}
            </div>
            {!p.feito && (
              <Link className={p === proximo ? 'botao-link botao-link--prim' : 'botao-link'} to={p.link}>
                {p === proximo ? 'Começar' : 'Abrir'}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
