import { Badge, Button, ContactStatus, EmptyState, Icon, Tabs, TextField } from '@prospeccao/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, type Campanha, type EmpresaLista, type Pagina, qs } from '../api';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi } from '../componentes/Formulario';
import { fmtCidade, fmtKm, fmtNome, fmtNota, fmtNumero, formatarTelefone, ROTULO_ORIGEM } from '../formatar';

const ABAS = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'raio', rotulo: 'Na área' },
  { id: 'entrega', rotulo: 'Com entrega' },
  { id: 'maps', rotulo: 'Só no Maps' },
];

const POR_PAGINA = 50;

function telefonePrincipal(e: EmpresaLista): { valor: string; fonte: 'Maps' | 'Receita' } | null {
  if (e.mapsTelefone) return { valor: e.mapsTelefone, fonte: 'Maps' };
  const t = e.telefonesReceita[0];
  return t ? { valor: t, fonte: 'Receita' } : null;
}

export function Leads() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const aba = params.get('aba') ?? 'todos';
  const campanhaId = params.get('campanhaId') ?? '';
  const ordem = params.get('ordem') ?? 'avaliacoes';
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
    dentroDoRaio: aba === 'raio' ? true : undefined,
    entrega: aba === 'entrega' ? true : undefined,
    origem: aba === 'maps' ? 'maps' : undefined,
  };
  const empresas = useQuery({
    queryKey: ['empresas', filtros],
    queryFn: () => api<Pagina<EmpresaLista>>(`/empresas${qs(filtros)}`),
    placeholderData: keepPreviousData,
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
            <option value="avaliacoes">Mais avaliados no Google</option>
            <option value="distancia">Mais perto da base</option>
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
                  <th>Origem</th>
                  <th>Google</th>
                  <th>Telefone</th>
                  <th>Entrega</th>
                  <th>Distância</th>
                </tr>
              </thead>
              <tbody>
                {empresas.data?.itens.map((e) => {
                  const tel = telefonePrincipal(e);
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
                      <td>
                        <Badge tone={e.origem === 'ambos' ? 'brand' : 'neutral'}>
                          {ROTULO_ORIGEM[e.origem]}
                        </Badge>
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
                      </td>
                      <td>
                        {tel ? (
                          <span className="mono" title={`Fonte: ${tel.fonte}`}>
                            {formatarTelefone(tel.valor)}{' '}
                            <ContactStatus
                              status={tel.fonte === 'Receita' ? 'atencao' : 'nao_verificado'}
                              compact
                            />
                          </span>
                        ) : (
                          <span className="quieto">Sem telefone</span>
                        )}
                      </td>
                      <td>
                        {e.sinalEntrega ? (
                          <Badge tone="brand" icon="package">
                            Entrega
                          </Badge>
                        ) : (
                          <span className="quieto">—</span>
                        )}
                      </td>
                      <td>
                        <span className="mono">{fmtKm(e.distanciaBaseKm)}</span>{' '}
                        {e.dentroDoRaio === false && <Badge tone="warning">Fora do raio</Badge>}
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
