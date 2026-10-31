import { LISTA_MODULOS, LISTA_RECURSOS, MODULOS, RECURSOS } from '@prospeccao/shared/planos';
import { Badge, EmptyState } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api, type PlanoConta } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { textoDoPlano } from '../componentes/ForaDoPlano';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { ROTULO_PLANO, UsoComLimite } from '../componentes/PlanoConta';
import { useEhAdmin, useSessao } from '../componentes/Sessao';
import { fmtData, fmtNomeMes, fmtNumero, fmtReais } from '../formatar';
import { AssinaturaNoPlano } from './Assinar';

interface TelaMeuPlano extends PlanoConta {
  consumo: {
    emails: { enviados: number; limite: number | null };
    whatsapp: { automaticas: number; limite: number | null };
    horasReuniao: { usadas: number; limite: number | null };
    conversasIa: { usadas: number; limite: number | null };
    numerosWhatsapp: { usados: number; limite: number | null };
  };
}

/** O plano da empresa: o que foi contratado, os limites e quanto já foi usado neste mês. */
export function MeuPlano() {
  const admin = useEhAdmin();
  const pelaAssinatura = !!useSessao().data?.assinatura;
  const [params] = useSearchParams();
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
  const varias = p.organizacao.unidades > 1;
  const temWhatsapp = p.modulos.includes('whatsapp');
  const temEmail = p.modulos.includes('email');

  return (
    <>
      <div className="topo">
        <div>
          <h1>Meu plano</h1>
          <p>
            Plano {ROTULO_PLANO[p.plano]}
            {p.planoDesde ? ` desde ${fmtData(p.planoDesde)}` : ''}
            {varias ? `, de ${p.organizacao.nome} para as ${p.organizacao.unidades} unidades` : ''}. O uso
            volta a zero todo dia 1º. <LinkAjuda artigo="meu-plano" />
          </p>
        </div>
        {admin && p.mensalidade != null && (
          <div className="meu-plano__preco">
            <span className="quieto">Mensalidade</span>
            <b>{fmtReais(p.mensalidade)}</b>
          </div>
        )}
      </div>

      {params.get('mudou') && (
        <Mensagem tipo="ok">
          Assinatura mudada: o plano novo já vale. A próxima mensalidade vem com o valor novo.
        </Mensagem>
      )}
      <AssinaturaNoPlano />

      <section className="pp-panel meu-plano">
        <h2 className="subtitulo">Uso em {mes}</h2>
        <div className="plano-usos">
          <UsoComLimite
            rotulo={varias ? 'Leads enriquecidos (todas as unidades)' : 'Leads enriquecidos'}
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
          {varias && p.unidade && (
            <UsoComLimite
              rotulo={`Leads desta unidade (${p.unidade.nome})`}
              usado={p.unidade.leadsMes}
              limite={p.unidade.cota}
              detalhe={
                p.unidade.cota == null
                  ? 'Sem cota própria: usa o que sobra do total da organização.'
                  : 'Cota definida pelo gestor da organização.'
              }
            />
          )}
          <UsoComLimite
            rotulo={varias ? 'Usuários ativos (todas as unidades)' : 'Usuários ativos'}
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
          {temWhatsapp && (
            <UsoComLimite
              rotulo="Números de WhatsApp conectados"
              usado={p.consumo.numerosWhatsapp.usados}
              limite={p.consumo.numerosWhatsapp.limite}
              detalhe={
                p.numerosExtras
                  ? `Inclui ${p.numerosExtras} contratado${p.numerosExtras > 1 ? 's' : ''} à parte.`
                  : undefined
              }
            />
          )}
          {p.recursos.includes('reunioes') && (
            <UsoComLimite
              rotulo="Horas de reunião por vídeo"
              usado={p.consumo.horasReuniao.usadas}
              limite={p.consumo.horasReuniao.limite}
              detalhe={
                p.consumo.horasReuniao.limite == null
                  ? 'Soma do tempo das reuniões abertas no mês.'
                  : 'Soma do tempo das reuniões abertas no mês. Acabou: as novas reuniões esperam o dia 1º ou mais horas.'
              }
            />
          )}
          {p.modulos.includes('agente_ia') && (
            <UsoComLimite
              rotulo="Conversas do Agente de IA"
              usado={p.consumo.conversasIa.usadas}
              limite={p.consumo.conversasIa.limite}
              detalhe={
                p.consumo.conversasIa.limite == null
                  ? 'Leads diferentes com quem a IA falou no mês.'
                  : 'Leads diferentes com quem a IA falou no mês. Acabou: as respostas passam para o time até o dia 1º.'
              }
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
                · Campanhas por nicho e cidade, enriquecimento com decisor e contatos, nota A-B-C, funil,
                ficha do lead, tarefas, Meu dia e relatórios básicos.
              </span>
            </span>
          </li>
          {LISTA_RECURSOS.map((r) => {
            const tem = p.recursos.includes(r);
            return (
              <li key={r} className="plano-modulos__item" data-ativo={tem || undefined}>
                {tem ? (
                  <Badge tone="brand">Incluído</Badge>
                ) : (
                  <Badge tone="outline" icon="lock">
                    Fora do plano
                  </Badge>
                )}
                <span>
                  <b>{RECURSOS[r].nome}</b>
                  <span className="quieto">
                    {' '}
                    · {RECURSOS[r].descricao}
                    {!tem && ` ${textoDoPlano(r)}`}
                  </span>
                </span>
              </li>
            );
          })}
          {LISTA_MODULOS.map((m) => {
            const tem = p.modulos.includes(m);
            return (
              <li key={m} className="plano-modulos__item" data-ativo={tem || undefined}>
                <Badge tone={tem ? 'brand' : 'outline'}>{tem ? 'Contratado' : 'Módulo à parte'}</Badge>
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
          {pelaAssinatura
            ? 'Para mudar de plano, aumentar usuários ou contratar um módulo, use o botão da assinatura, acima.'
            : 'Para mudar de plano, aumentar usuários ou leads, ou contratar um módulo, fale com a gente.'}
        </p>
      </section>
    </>
  );
}
