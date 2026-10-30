import { CUSTOS_PADRAO, type CustosPlataforma } from '@prospeccao/shared/plataforma';
import { Button, Panel, Stat } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { api, type ServicoTestavel } from '../api';
import { Administradores } from '../componentes/Administradores';
import { LinkAjuda } from '../componentes/Ajuda';
import { useAbrirDemonstracao, useRecriarDemonstracao } from '../componentes/Demonstracao';
import { Drawer } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { TabelaDePrecos } from '../componentes/PlanoConta';
import { fmtNumero, fmtQuando, fmtReais, formatarTelefone } from '../formatar';
import { FormCustos, Topo, useMaster } from './Plataforma';
import { ContatoDoSite } from './Vendas';

/*
 * Configurações da plataforma: os serviços que a plataforma usa para todos os clientes (o que está
 * ligado, o que falta e como resolver), os preços, o contato do site e o CRM de demonstração.
 */

interface Servico {
  id: string;
  nome: string;
  papel: string;
  estado: 'ok' | 'aviso' | 'falta';
  detalhe: string;
  comoFazer: string | null;
  testavel: boolean;
}

interface DadosServicos {
  servicos: Servico[];
  contaPrincipalId: number | null;
  contato: { whatsapp: string | null; email: string | null };
  pedidosApresentacaoMes: number;
  demonstracao: { contaId: number; geradaEm: string | null } | null;
}

interface Resultado {
  ok: boolean;
  resultado: string;
}

const ROTULO_ESTADO: Record<Servico['estado'], string> = {
  ok: 'Funcionando',
  aviso: 'Com aviso',
  falta: 'Falta configurar',
};

/** Serviços que se testam pela conta principal (com as chaves da plataforma). */
const PELA_CONTA: Record<string, ServicoTestavel> = {
  whatsapp: 'whatsapp',
  email: 'resend',
  ia: 'ia',
  places: 'places',
  ors: 'ors',
};

async function testar(id: string, contaPrincipalId: number | null): Promise<Resultado> {
  const pelaConta = PELA_CONTA[id];
  if (pelaConta && contaPrincipalId)
    return api<Resultado>(`/master/contas/${contaPrincipalId}/testar`, {
      metodo: 'POST',
      corpo: { servico: pelaConta },
    });
  return api<Resultado>(`/master/plataforma/servicos/${id}/testar`, { metodo: 'POST' });
}

type Gaveta = 'precos' | 'custos' | 'contato' | null;

export function PlataformaConfiguracoes() {
  const m = useMaster();
  const cliente = useQueryClient();
  const [gaveta, setGaveta] = useState<Gaveta>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, Resultado | 'testando'>>({});
  const q = useQuery({
    queryKey: ['master', 'servicos'],
    queryFn: () => api<DadosServicos>('/master/plataforma/servicos'),
    enabled: m.master,
  });
  const custos = useQuery({
    queryKey: ['master', 'custos'],
    queryFn: () => api<CustosPlataforma>('/master/plataforma/custos'),
    enabled: m.master,
  });
  const abrirDemo = useAbrirDemonstracao();
  const recriarDemo = useRecriarDemonstracao();
  const testarTudo = useMutation({
    mutationFn: async () => {
      for (const s of q.data?.servicos.filter((x) => x.testavel) ?? []) await rodar(s.id);
    },
  });
  if (!m.carregando && !m.master) return <Navigate to="/" replace />;

  async function rodar(id: string) {
    setResultados((r) => ({ ...r, [id]: 'testando' }));
    try {
      const r = await testar(id, q.data?.contaPrincipalId ?? null);
      setResultados((x) => ({ ...x, [id]: r }));
    } catch (e) {
      setResultados((x) => ({ ...x, [id]: { ok: false, resultado: (e as Error).message } }));
    }
  }

  const d = q.data;
  const servicos = d?.servicos ?? [];
  const nomes = (estado: Servico['estado']) =>
    servicos
      .filter((s) => s.estado === estado)
      .map((s) => s.nome.split(' · ')[0])
      .join(', ');
  const qtd = (estado: Servico['estado']) => servicos.filter((s) => s.estado === estado).length;

  return (
    <>
      <Topo
        titulo="Configurações da plataforma"
        texto={
          <>
            Os serviços que a plataforma usa para todos os clientes: o que está ligado, o que falta e como
            resolver. <LinkAjuda artigo="painel-plataforma" />
          </>
        }
        acoes={
          <Button
            variant="primary"
            icon="check"
            disabled={!d || testarTudo.isPending}
            onClick={() => testarTudo.mutate()}
          >
            {testarTudo.isPending ? 'Testando…' : 'Testar tudo'}
          </Button>
        }
      />
      <ErroDaApi erro={q.error} />
      {!d ? (
        <div className="esqueleto" />
      ) : (
        <>
          <div className="kpis">
            <Stat rotulo="Serviços funcionando" valor={`${qtd('ok')} de ${servicos.length}`} />
            <Stat
              rotulo="Faltando configurar"
              valor={fmtNumero(qtd('falta'))}
              delta={nomes('falta') || undefined}
              tendencia="desce"
            />
            <Stat
              rotulo="Com aviso"
              valor={fmtNumero(qtd('aviso'))}
              delta={nomes('aviso') || undefined}
              tendencia="desce"
            />
            <Stat
              rotulo="Infraestrutura por mês"
              valor={fmtReais((custos.data ?? CUSTOS_PADRAO).infraMes)}
              delta="servidores e banco (custos unitários)"
            />
          </div>

          <div className="config-plataforma">
            <div className="pp-panel config-servicos">
              <ul>
                {servicos.map((s) => {
                  const r = resultados[s.id];
                  return (
                    <li key={s.id} className="config-servico" data-estado={s.estado}>
                      <div className="config-servico__linha">
                        <div className="config-servico__nome">
                          <b>{s.nome}</b>
                          <span className="quieto">{s.detalhe}</span>
                        </div>
                        <span className="config-servico__estado" data-estado={s.estado}>
                          {ROTULO_ESTADO[s.estado]}
                        </span>
                        <div className="config-servico__acao">
                          {s.testavel ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={r === 'testando'}
                              onClick={() => rodar(s.id)}
                            >
                              {r === 'testando' ? 'Testando…' : 'Testar'}
                            </Button>
                          ) : s.comoFazer ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-expanded={aberto === s.id}
                              onClick={() => setAberto(aberto === s.id ? null : s.id)}
                            >
                              Como fazer
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <p className="config-servico__papel quieto">{s.papel}</p>
                      {(aberto === s.id || (s.testavel && s.comoFazer)) && s.comoFazer && (
                        <Mensagem tipo="aviso">{s.comoFazer}</Mensagem>
                      )}
                      {r && r !== 'testando' && (
                        <Mensagem tipo={r.ok ? 'ok' : 'aviso'}>{r.resultado}</Mensagem>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="pilha" style={{ gap: 16 }}>
              <Panel titulo="Preços e cobrança">
                <dl className="fin-linhas">
                  <div>
                    <dt>Tabela de preços dos planos</dt>
                    <dd>
                      <button type="button" className="link-botao" onClick={() => setGaveta('precos')}>
                        Editar
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Custos unitários (para a margem)</dt>
                    <dd>
                      <button type="button" className="link-botao" onClick={() => setGaveta('custos')}>
                        Editar
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Plano anual</dt>
                    <dd className="mono">10% de desconto</dd>
                  </div>
                </dl>
              </Panel>

              <Panel
                titulo="Site e apresentação"
                acoes={
                  <button type="button" className="link-botao" onClick={() => setGaveta('contato')}>
                    Editar
                  </button>
                }
              >
                <dl className="fin-linhas">
                  <div>
                    <dt>WhatsApp comercial</dt>
                    <dd className="mono">
                      {d.contato.whatsapp ? formatarTelefone(d.contato.whatsapp.slice(2)) : 'não cadastrado'}
                    </dd>
                  </div>
                  <div>
                    <dt>E-mail comercial</dt>
                    <dd className="mono">{d.contato.email ?? 'não cadastrado'}</dd>
                  </div>
                  <div>
                    <dt>Pedidos pela apresentação no mês</dt>
                    <dd className="mono">{fmtNumero(d.pedidosApresentacaoMes)}</dd>
                  </div>
                </dl>
              </Panel>

              <Panel titulo="CRM de demonstração">
                <p className="quieto" style={{ margin: '0 0 12px', fontSize: 13 }}>
                  Leads, funil, conversas no WhatsApp, reuniões gravadas e visitas fictícios para apresentar o
                  sistema. Não entra no financeiro e não busca empresas de verdade.
                  {d.demonstracao?.geradaEm && ` Dados gerados ${fmtQuando(d.demonstracao.geradaEm)}.`}
                </p>
                <div className="fin-acoes">
                  <Button variant="primary" disabled={abrirDemo.isPending} onClick={() => abrirDemo.mutate()}>
                    {abrirDemo.isPending ? 'Abrindo…' : 'Abrir a demonstração'}
                  </Button>
                  {d.demonstracao && (
                    <Button
                      variant="secondary"
                      disabled={recriarDemo.isPending}
                      onClick={() => recriarDemo.mutate()}
                    >
                      {recriarDemo.isPending ? 'Recriando…' : 'Recriar os dados'}
                    </Button>
                  )}
                </div>
                {recriarDemo.isSuccess && (
                  <Mensagem tipo="ok">Pronto: os dados de exemplo foram gerados de novo.</Mensagem>
                )}
                <ErroDaApi erro={abrirDemo.error ?? recriarDemo.error} />
              </Panel>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <Administradores />
          </div>
          <p className="nota-rodape">
            As chaves ficam nas variáveis do Railway (nada aparece aqui, só se existe). Para trocar uma chave,
            mude a variável no serviço indicado e faça o redeploy. Chaves próprias de um cliente ficam em
            Clientes, na aba Credenciais.
          </p>
        </>
      )}

      {gaveta === 'precos' && (
        <Drawer titulo="Tabela de preços" barra="Configurações" aoFechar={() => setGaveta(null)} largo>
          <div className="drawer__corpo">
            <TabelaDePrecos />
          </div>
        </Drawer>
      )}
      {gaveta === 'custos' && (
        <Drawer titulo="Custos unitários" barra="Configurações" aoFechar={() => setGaveta(null)}>
          <div className="drawer__corpo">
            <FormCustos inicial={custos.data ?? CUSTOS_PADRAO} aoSalvar={() => setGaveta(null)} />
          </div>
        </Drawer>
      )}
      {gaveta === 'contato' && d && (
        <Drawer titulo="Contato do site" barra="Configurações" aoFechar={() => setGaveta(null)}>
          <div className="drawer__corpo">
            <ContatoDoSite
              inicial={d.contato}
              aoSalvar={() => {
                cliente.invalidateQueries({ queryKey: ['master', 'servicos'] });
                setGaveta(null);
              }}
            />
          </div>
        </Drawer>
      )}
    </>
  );
}
