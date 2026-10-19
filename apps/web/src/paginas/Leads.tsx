import { Badge, Button, ContactStatus, EmptyState, Icon, ScoreBadge, Tabs, TextField } from '@prospeccao/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, type Campanha, type EmpresaLista, type Pagina, qs, type StatusContato } from '../api';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi } from '../componentes/Formulario';
import { fmtCidade, fmtNome, fmtNota, fmtNumero, formatarTelefone, ROTULO_ORIGEM } from '../formatar';

const ABAS = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'A', rotulo: 'Nota A' },
  { id: 'B', rotulo: 'Nota B' },
  { id: 'whatsapp', rotulo: 'Com WhatsApp' },
  { id: 'entrega', rotulo: 'Com entrega' },
  { id: 'pendente', rotulo: 'Aguardando enriquecimento' },
];

const POR_PAGINA = 50;

const ICONE_CANAL: Record<string, string> = {
  whatsapp: 'message-circle',
  telefone: 'phone',
  email: 'mail',
  instagram: 'camera',
  linkedin: 'id-card',
  site: 'globe',
  facebook: 'globe',
};

/** Melhor contato: o escolhido pelo enriquecimento; antes dele, o telefone do Google ou da Receita. */
function melhorContato(e: EmpresaLista): { canal: string; valor: string; status: StatusContato } | null {
  if (e.contatoCanal && e.contatoValor) {
    const fone = e.contatoCanal === 'whatsapp' || e.contatoCanal === 'telefone';
    return {
      canal: e.contatoCanal,
      valor: fone ? formatarTelefone(e.contatoValor) : e.contatoValor,
      status: e.contatoStatus ?? 'nao_verificado',
    };
  }
  if (e.mapsTelefone)
    return { canal: 'telefone', valor: formatarTelefone(e.mapsTelefone), status: 'nao_verificado' };
  const t = e.telefonesReceita[0];
  return t ? { canal: 'telefone', valor: formatarTelefone(t), status: 'atencao' } : null;
}

export function Leads() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const aba = params.get('aba') ?? 'todos';
  const campanhaId = params.get('campanhaId') ?? '';
  const ordem = params.get('ordem') ?? 'nota';
  const pagina = Number(params.get('pagina') ?? '1');
  const empresaAberta = params.get('empresa');
  const [busca, setBusca] = useState(params.get('busca') ?? '');

  const mudar = (novos: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) v ? p.set(k, v) : p.delete(k);
    if (!('pagina' in novos) && !('empresa' in novos)) p.delete('pagina');
    setParams(p, { replace: true });
  };

  // Busca com pausa: só consulta quando o usuário para de digitar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só a digitação dispara
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('busca') ?? '') !== busca) mudar({ busca: busca || null });
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });
  const filtros = {
    campanhaId: campanhaId || undefined,
    busca: params.get('busca') || undefined,
    ordem,
    pagina,
    porPagina: POR_PAGINA,
    entrega: aba === 'entrega' ? true : undefined,
    faixa: aba === 'A' || aba === 'B' || aba === 'pendente' ? aba : undefined,
    comWhatsapp: aba === 'whatsapp' ? true : undefined,
  };
  const empresas = useQuery({
    queryKey: ['empresas', filtros],
    queryFn: () => api<Pagina<EmpresaLista>>(`/empresas${qs(filtros)}`),
    placeholderData: keepPreviousData,
    // Enquanto há leads na fila do enriquecimento, a lista se atualiza sozinha.
    refetchInterval: (q) =>
      q.state.data?.itens.some((e) => e.enriqStatus !== 'concluido' && e.enriqStatus !== 'erro')
        ? 15_000
        : false,
  });

  const total = empresas.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const campanhaAtual = campanhas.data?.find((c) => String(c.id) === campanhaId);

  return (
    <>
      <div className="topo">
        <div>
          <h1>Leads</h1>
          <p>
            {campanhaAtual
              ? `${campanhaAtual.nome} · ${campanhaAtual.cidades.map((c) => c.cidade).join(', ')}`
              : 'Empresas encontradas em todas as campanhas'}
          </p>
        </div>
        <div className="acoes">
          <label className="pp-sr" htmlFor="filtro-campanha">
            Campanha
          </label>
          <select
            id="filtro-campanha"
            className="filtro"
            value={campanhaId}
            onChange={(e) => mudar({ campanhaId: e.target.value || null })}
          >
            <option value="">Todas as campanhas</option>
            {campanhas.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <label className="pp-sr" htmlFor="filtro-ordem">
            Ordenar por
          </label>
          <select
            id="filtro-ordem"
            className="filtro"
            value={ordem}
            onChange={(e) => mudar({ ordem: e.target.value })}
          >
            <option value="nota">Maior nota</option>
            <option value="avaliacoes">Mais avaliados no Google</option>
            <option value="recentes">Encontrados por último</option>
            <option value="nome">Nome</option>
          </select>
        </div>
      </div>

      <Tabs
        rotulo="Filtrar leads"
        itens={ABAS}
        ativo={aba}
        onChange={(id) => mudar({ aba: id === 'todos' ? null : id })}
      />

      <div className="barra">
        <TextField
          rotulo="Buscar leads"
          rotuloOculto
          icone="search"
          placeholder="Empresa, CNPJ ou telefone"
          value={busca}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusca(e.target.value)}
        />
      </div>

      <ErroDaApi erro={empresas.error} />

      {empresas.isPending ? (
        <div className="pilha" aria-busy="true">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="esqueleto" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="pp-panel">
          <EmptyState
            icone={filtros.busca || aba !== 'todos' ? 'search' : 'inbox'}
            titulo={
              filtros.busca || aba !== 'todos'
                ? 'Nenhum lead com esses filtros'
                : 'Nenhum lead encontrado ainda'
            }
            texto={
              filtros.busca || aba !== 'todos'
                ? 'Tente outra busca ou volte para a aba Todos.'
                : 'Crie e inicie uma campanha: o motor busca na base de CNPJ e no Google Maps.'
            }
            acao={
              filtros.busca || aba !== 'todos' ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setBusca('');
                    mudar({ busca: null, aba: null });
                  }}
                >
                  Limpar filtros
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => navegar('/campanhas')}>
                  Ir para campanhas
                </Button>
              )
            }
          />
        </div>
      ) : (
        <>
          <div className="pp-tablewrap">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Nota</th>
                  <th>Quem decide</th>
                  <th>Melhor contato</th>
                  <th>Google</th>
                </tr>
              </thead>
              <tbody>
                {empresas.data?.itens.map((e) => {
                  const contato = melhorContato(e);
                  const aberta = empresaAberta === String(e.id);
                  return (
                    <tr
                      key={e.id}
                      aria-selected={aberta}
                      className="linha-clicavel"
                      onClick={() => mudar({ empresa: String(e.id) })}
                    >
                      <td>
                        <button
                          type="button"
                          className="botao-linha"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            mudar({ empresa: String(e.id) });
                          }}
                        >
                          <b style={{ fontWeight: 500 }}>{fmtNome(e.nome)}</b>
                          <span className="quieto" style={{ fontSize: 13, lineHeight: '18px' }}>
                            {[fmtCidade(e.cidade), e.bairro ? fmtCidade(e.bairro) : null, e.mapsCategoria]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </button>
                      </td>
                      <td title={e.motivo ?? undefined}>
                        {e.faixa ? (
                          <ScoreBadge faixa={e.faixa} score={e.score ?? undefined} />
                        ) : e.enriqStatus === 'rodando' ? (
                          <Badge tone="warning">Enriquecendo</Badge>
                        ) : e.enriqStatus === 'erro' ? (
                          <Badge tone="danger">Erro</Badge>
                        ) : (
                          <span className="quieto" style={{ fontSize: 13 }}>
                            Na fila
                          </span>
                        )}
                      </td>
                      <td>
                        {e.decisorNome ? (
                          <span className="celula-dupla">
                            <span>{fmtNome(e.decisorNome)}</span>
                            {e.decisorCargo && <span className="quieto">{e.decisorCargo}</span>}
                          </span>
                        ) : (
                          <span className="quieto">—</span>
                        )}
                      </td>
                      <td>
                        {contato ? (
                          <span className="contato-celula">
                            <Icon name={ICONE_CANAL[contato.canal] ?? 'phone'} size={14} />
                            <span className="mono">{contato.valor}</span>
                            <ContactStatus status={contato.status} compact />
                          </span>
                        ) : (
                          <span className="quieto">Sem contato</span>
                        )}
                      </td>
                      <td>
                        {e.mapsAvaliacoes != null ? (
                          <span className="mono">
                            <Icon name="star" size={12} /> {fmtNota(e.mapsNota) ?? '—'}{' '}
                            <span className="quieto">({fmtNumero(e.mapsAvaliacoes)})</span>
                          </span>
                        ) : (
                          <span className="quieto">—</span>
                        )}
                        {(e.sinalEntrega || e.origem === 'maps') && (
                          <span className="celula-selos">
                            {e.sinalEntrega && (
                              <Badge tone="brand" icon="package">
                                Entrega
                              </Badge>
                            )}
                            {e.origem === 'maps' && <Badge tone="neutral">{ROTULO_ORIGEM[e.origem]}</Badge>}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rodape-lista">
            <span>
              {fmtNumero(total)} {total === 1 ? 'lead' : 'leads'} · página {pagina} de {paginas}
            </span>
            <div className="acoes">
              <Button size="sm" disabled={pagina <= 1} onClick={() => mudar({ pagina: String(pagina - 1) })}>
                Página anterior
              </Button>
              <Button
                size="sm"
                disabled={pagina >= paginas}
                onClick={() => mudar({ pagina: String(pagina + 1) })}
              >
                Próxima página
              </Button>
            </div>
          </div>
        </>
      )}

      {empresaAberta && <FichaEmpresa id={Number(empresaAberta)} aoFechar={() => mudar({ empresa: null })} />}
    </>
  );
}
