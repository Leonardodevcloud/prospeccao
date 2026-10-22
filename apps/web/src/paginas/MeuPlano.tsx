import { LISTA_MODULOS, MODULOS } from '@prospeccao/shared/planos';
import { Badge, EmptyState } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { api, type PlanoConta } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { ROTULO_PLANO, UsoComLimite } from '../componentes/PlanoConta';
import { useEhAdmin } from '../componentes/Sessao';
import { fmtData, fmtNomeMes, fmtNumero, fmtReais } from '../formatar';

interface TelaMeuPlano extends PlanoConta {
  consumo: {
    emails: { enviados: number; limite: number | null };
    whatsapp: { automaticas: number; limite: number | null };
  };
}

/** O plano da empresa: o que foi contratado, os limites e quanto já foi usado neste mês. */
export function MeuPlano() {
  const admin = useEhAdmin();
  const q = useQuery({
    queryKey: ['meu-plano'],
    queryFn: () => api<TelaMeuPlano>('/equipe/plano'),
    refetchInterval: 120_000,
  });
  const mes = fmtNomeMes(new Date().toISOString().slice(0, 7));

  if (q.isPending) return <div className="esqueleto" />;
  if (!q.data) return <ErroDaApi erro={q.error} />;
  const p = q.data;
  if (!p.plano)
    return (
      <div className="pp-panel">
        <EmptyState icone="badge-check" titulo="Sem plano" texto="Esta conta não tem limites de uso." />
      </div>
    );
  const temWhatsapp = p.modulos.includes('whatsapp');
  const temEmail = p.modulos.includes('email');

  return (
    <>
      <div className="topo">
        <div>
          <h1>Meu plano</h1>
          <p>
            Plano {ROTULO_PLANO[p.plano]}
            {p.planoDesde ? ` desde ${fmtData(p.planoDesde)}` : ''}. O uso volta a zero todo dia 1º.
          </p>
        </div>
        {admin && p.mensalidade != null && (
          <div className="meu-plano__preco">
            <span className="quieto">Mensalidade</span>
            <b>{fmtReais(p.mensalidade)}</b>
          </div>
        )}
      </div>

      <section className="pp-panel meu-plano">
        <h2 className="subtitulo">Uso em {mes}</h2>
        <div className="plano-usos">
          <UsoComLimite
            rotulo="Leads enriquecidos"
            usado={p.uso.leadsMes}
            limite={p.leadsMes}
            detalhe={
              p.uso.leadsEsperando
                ? `${fmtNumero(p.uso.leadsEsperando)} leads esperando: entram sozinhos no próximo mês ou se o limite aumentar.`
                : p.leadsMes != null
                  ? `Restam ${fmtNumero(Math.max(0, p.leadsMes - p.uso.leadsMes))} neste mês.`
                  : undefined
            }
          />
          <UsoComLimite
            rotulo="Usuários ativos"
            usado={p.uso.usuarios}
            limite={p.usuarios}
            detalhe={
              p.usuarios != null && p.uso.usuarios >= p.usuarios
                ? 'Todas as vagas em uso. Desative alguém na tela Equipe ou aumente o plano.'
                : undefined
            }
          />
          {temEmail && (
            <UsoComLimite
              rotulo="E-mails enviados"
              usado={p.consumo.emails.enviados}
              limite={p.consumo.emails.limite}
            />
          )}
          {temWhatsapp && (
            <UsoComLimite
              rotulo="Mensagens automáticas no WhatsApp"
              usado={p.consumo.whatsapp.automaticas}
              limite={p.consumo.whatsapp.limite}
            />
          )}
        </div>
      </section>

      <section className="pp-panel meu-plano">
        <h2 className="subtitulo">O que está incluído</h2>
        <ul className="plano-modulos">
          <li className="plano-modulos__item" data-ativo>
            <Badge tone="brand">Incluído</Badge>
            <span>
              <b>Prospecção e CRM</b>
              <span className="quieto">
                {' '}
                · Busca de empresas por nicho, enriquecimento de contatos, funil (Kanban), conversas, agenda e
                relatórios.
              </span>
            </span>
          </li>
          {LISTA_MODULOS.map((m) => {
            const tem = p.modulos.includes(m);
            return (
              <li key={m} className="plano-modulos__item" data-ativo={tem || undefined}>
                <Badge tone={tem ? 'brand' : 'outline'}>{tem ? 'Contratado' : 'Disponível'}</Badge>
                <span>
                  <b>{MODULOS[m].nome}</b>
                  <span className="quieto"> · {MODULOS[m].descricao}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {admin && p.itens.length > 0 && (
          <div className="plano-conta" style={{ marginTop: 12 }}>
            {p.itens.map((i) => (
              <div key={i.rotulo} className="plano-conta__linha" data-negativo={i.valor < 0 || undefined}>
                <span>{i.rotulo}</span>
                <span className="mono">
                  {i.valor < 0 ? '− ' : ''}
                  {fmtReais(Math.abs(i.valor))}
                </span>
              </div>
            ))}
            {p.mensalidade != null && (
              <div className="plano-conta__linha plano-conta__final">
                <span>Mensalidade</span>
                <span className="mono">{fmtReais(p.mensalidade)}</span>
              </div>
            )}
          </div>
        )}
        <p className="quieto" style={{ margin: '12px 0 0', fontSize: 13 }}>
          Para mudar de plano, aumentar usuários ou leads, ou contratar um módulo, fale com a gente.
        </p>
      </section>
    </>
  );
}
