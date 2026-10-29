import { Badge, Button, ContactStatus, EmptyState, Icon, ScoreBadge, Tabs, TextField } from '@prospeccao/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  api,
  type Campanha,
  type EmpresaLista,
  type EtapaFunil,
  type Pagina,
  qs,
  type ResultadoAdicionar,
  ROTULO_ETAPA,
  type StatusContato,
} from '../api';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { ImportarLeads } from '../componentes/ImportarLeads';
import { useEhAdmin, useSoLeitura } from '../componentes/Sessao';
import { fmtCidade, fmtNome, fmtNota, fmtNumero, formatarTelefone, ROTULO_ORIGEM } from '../formatar';

const ABAS = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'A', rotulo: 'Nota A' },
  { id: 'B', rotulo: 'Nota B' },
  { id: 'decisor', rotulo: 'Com possível decisor' },
  { id: 'whatsapp', rotulo: 'Com WhatsApp' },
  { id: 'entrega', rotulo: 'Com entrega' },
  { id: 'pendente', rotulo: 'Aguardando enriquecimento' },
];

/** Situação comercial: por padrão só os nunca trabalhados, para a rodada nova não repetir quem já foi visto. */
const SITUACOES = [
  { id: 'novos', rotulo: 'Novos (não trabalhados)' },
  { id: 'no_funil', rotulo: 'Já no funil' },
  { id: 'descartados', rotulo: 'Descartados' },
  { id: 'todos', rotulo: 'Todos' },
];

const TOM_ETAPA: Record<EtapaFunil, 'neutral' | 'brand' | 'warning' | 'danger' | 'outline'> = {
  a_abordar: 'outline',
  abordado: 'neutral',
  respondeu: 'warning',
  reuniao: 'warning',
  proposta: 'warning',
  ganho: 'brand',
  perdido: 'danger',
  descartado: 'neutral',
};

/** Resumo do envio em lote para o funil. */
function textoResultado(r: ResultadoAdicionar, descartando: boolean): string {
  const partes = [
    descartando
      ? `${fmtNumero(r.adicionadas)} descartado${r.adicionadas === 1 ? '' : 's'}`
      : `${fmtNumero(r.adicionadas)} mandado${r.adicionadas === 1 ? '' : 's'} para o funil`,
  ];
  if (r.jaNoFunil) partes.push(`${fmtNumero(r.jaNoFunil)} já estava${r.jaNoFunil === 1 ? '' : 'm'} lá`);
  if (r.duplicadas.length)
    partes.push(
      `${fmtNumero(r.duplicadas.length)} ficou de fora por ter o mesmo telefone de uma empresa já trabalhada`,
    );
  if (r.deOutraUnidade?.length)
    partes.push(
      `${fmtNumero(r.deOutraUnidade.length)} ficou de fora porque outra unidade já trabalha (${r.deOutraUnidade
        .slice(0, 2)
        .map((x) => `${x.nome}: ${x.unidade}`)
        .join('; ')}${r.deOutraUnidade.length > 2 ? '…' : ''})`,
    );
  return `${partes.join(' · ')}.`;
}

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
  const situacao = params.get('situacao') ?? 'novos';
  const admin = useEhAdmin();
  const soLeitura = useSoLeitura();
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [descartando, setDescartando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const cliente = useQueryClient();
  const enviarLote = useMutation({
    mutationFn: (d: {
      empresaIds: number[];
      etapa: 'a_abordar' | 'descartado';
      motivo?: string;
      forcar?: boolean;
    }) => api<ResultadoAdicionar>('/funil', { metodo: 'POST', corpo: d }),
    onSuccess: (r, d) => {
      // Os duplicados continuam marcados: dá para conferir e mandar mesmo assim.
      setMarcados(new Set(r.duplicadas.map((x) => x.empresaId).filter((id) => d.empresaIds.includes(id))));
      setDescartando(false);
      setMotivo('');
      cliente.invalidateQueries({ queryKey: ['empresas'] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });

  const mudar = (novos: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) v ? p.set(k, v) : p.delete(k);
    if (!('pagina' in novos) && !('empresa' in novos)) p.delete('pagina');
    setParams(p, { replace: true });
    if (!('empresa' in novos)) {
      setMarcados(new Set());
      enviarLote.reset();
    }
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
    comDecisor: aba === 'decisor' ? true : undefined,
    situacao,
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
  const itens = empresas.data?.itens ?? [];
  const todosMarcados = itens.length > 0 && itens.every((e) => marcados.has(e.id));
  const alternar = (id: number) =>
    setMarcados((m) => {
      const n = new Set(m);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const ultimoResultado = enviarLote.data;
  const filtrando = !!filtros.busca || aba !== 'todos';

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
          {admin && (
            <Button variant="ghost" icon="file-text" onClick={() => setImportando(true)}>
              Importar leads
            </Button>
          )}
          {admin && (
            <Button
              variant="ghost"
              icon="file-down"
              href={`/api/exportar/leads${qs({ ...filtros, pagina: undefined, porPagina: undefined })}`}
              title="Baixa os leads com os filtros desta tela, numa planilha do Excel"
            >
              Exportar
            </Button>
          )}
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
          <label className="pp-sr" htmlFor="filtro-situacao">
            Situação no funil
          </label>
          <select
            id="filtro-situacao"
            className="filtro"
            value={situacao}
            onChange={(e) => mudar({ situacao: e.target.value === 'novos' ? null : e.target.value })}
          >
            {SITUACOES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.rotulo}
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

      {marcados.size > 0 && (
        <section className="barra-lote" aria-label="Ações com os leads marcados">
          <b>
            {fmtNumero(marcados.size)} marcado{marcados.size === 1 ? '' : 's'}
          </b>
          {descartando ? (
            <>
              <label className="pp-sr" htmlFor="motivo-descarte">
                Motivo do descarte
              </label>
              <input
                id="motivo-descarte"
                className="filtro"
                style={{ flex: '1 1 220px' }}
                placeholder="Motivo (ex.: atacadista, não entrega)"
                value={motivo}
                // biome-ignore lint/a11y/noAutofocus: aparece por ação do usuário
                autoFocus
                onChange={(e) => setMotivo(e.target.value)}
              />
              <Button
                size="sm"
                variant="danger"
                disabled={!motivo.trim() || enviarLote.isPending}
                onClick={() =>
                  enviarLote.mutate({ empresaIds: [...marcados], etapa: 'descartado', motivo: motivo.trim() })
                }
              >
                Descartar {fmtNumero(marcados.size)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDescartando(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="primary"
                icon="kanban"
                disabled={enviarLote.isPending}
                onClick={() =>
                  enviarLote.mutate({
                    empresaIds: [...marcados],
                    etapa: 'a_abordar',
                    // Depois do aviso de duplicado, o segundo clique manda mesmo assim.
                    forcar: !!ultimoResultado?.duplicadas.length,
                  })
                }
              >
                {ultimoResultado?.duplicadas.length ? 'Mandar mesmo assim' : 'Mandar para o funil'}
              </Button>
              <Button size="sm" icon="x" onClick={() => setDescartando(true)}>
                Descartar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMarcados(new Set())}>
                Desmarcar
              </Button>
            </>
          )}
        </section>
      )}
      {ultimoResultado && (
        <Mensagem tipo={ultimoResultado.duplicadas.length ? 'aviso' : 'ok'}>
          {textoResultado(ultimoResultado, enviarLote.variables?.etapa === 'descartado')}
          {ultimoResultado.duplicadas.length > 0 && (
            <>
              {' '}
              {ultimoResultado.duplicadas
                .slice(0, 3)
                .map((d) => `${fmtNome(d.nome)} = ${fmtNome(d.outraNome)} (${ROTULO_ETAPA[d.outraEtapa]})`)
                .join('; ')}
              {ultimoResultado.duplicadas.length > 3 ? '…' : ''}. Eles continuam marcados: confira e use
              "Mandar mesmo assim" se forem lojas diferentes.
            </>
          )}
        </Mensagem>
      )}
      <ErroDaApi erro={empresas.error ?? enviarLote.error} />

      {empresas.isPending ? (
        <div className="pilha" aria-busy="true">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="esqueleto" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="pp-panel">
          <EmptyState
            icone={filtrando ? 'search' : situacao === 'novos' ? 'check' : 'inbox'}
            titulo={
              filtrando
                ? 'Nenhum lead com esses filtros'
                : situacao === 'novos'
                  ? 'Nenhum lead novo'
                  : situacao === 'descartados'
                    ? 'Nenhum lead descartado'
                    : situacao === 'no_funil'
                      ? 'Nenhum lead no funil'
                      : 'Nenhum lead encontrado ainda'
            }
            texto={
              filtrando
                ? 'Tente outra busca ou volte para a aba Todos.'
                : situacao === 'novos'
                  ? 'Todos os leads encontrados já foram mandados para o funil ou descartados. Rode a campanha de novo ou crie uma em outra cidade.'
                  : situacao === 'todos'
                    ? 'Crie e inicie uma campanha: o motor busca na base de CNPJ e no Google Maps.'
                    : 'Troque a situação para ver os outros leads.'
            }
            acao={
              filtrando ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setBusca('');
                    mudar({ busca: null, aba: null });
                  }}
                >
                  Limpar filtros
                </Button>
              ) : soLeitura ? undefined : (
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
                  {!soLeitura && (
                    <th className="col-marcar">
                      <input
                        type="checkbox"
                        aria-label="Marcar todos desta página"
                        checked={todosMarcados}
                        onChange={() =>
                          setMarcados(todosMarcados ? new Set() : new Set(itens.map((e) => e.id)))
                        }
                      />
                    </th>
                  )}
                  <th>Empresa</th>
                  <th>Nota</th>
                  <th>Possível decisor</th>
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
                      {!soLeitura && (
                        <td className="col-marcar">
                          <input
                            type="checkbox"
                            onClick={(ev) => ev.stopPropagation()}
                            aria-label={`Marcar ${fmtNome(e.nome)}`}
                            checked={marcados.has(e.id)}
                            onChange={() => alternar(e.id)}
                          />
                        </td>
                      )}
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
                        {e.mei && (
                          <span className="celula-selos">
                            <Badge tone="danger">MEI</Badge>
                          </span>
                        )}
                        {e.outraUnidade && !e.funilEtapa && (
                          <span
                            className="celula-selos"
                            title="Outra unidade da organização já trabalha esta empresa"
                          >
                            <Badge tone="warning">Da unidade {e.outraUnidade}</Badge>
                          </span>
                        )}
                        {e.funilEtapa && (
                          <span className="celula-selos">
                            <Badge tone={TOM_ETAPA[e.funilEtapa]} icon="kanban">
                              {ROTULO_ETAPA[e.funilEtapa]}
                            </Badge>
                          </span>
                        )}
                      </td>
                      <td title={e.motivo ?? undefined}>
                        {e.faixa ? (
                          <span className="celula-dupla">
                            <ScoreBadge faixa={e.faixa} score={e.score ?? undefined} />
                            {e.enriqParcial && (
                              <span
                                className="quieto"
                                style={{ fontSize: 12 }}
                                title="Alguma fonte não respondeu; o que foi achado ficou"
                              >
                                em parte
                              </span>
                            )}
                          </span>
                        ) : e.enriqStatus === 'rodando' ? (
                          <Badge tone="warning">Enriquecendo</Badge>
                        ) : e.enriqStatus === 'erro' ? (
                          <Badge tone="danger">Erro</Badge>
                        ) : e.enriqPedido === false &&
                          (e.origem === 'importacao' || e.origem === 'manual') ? (
                          <span
                            className="quieto"
                            style={{ fontSize: 13 }}
                            title="Sem enriquecimento: use Enriquecer na campanha"
                          >
                            Sem nota
                          </span>
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

      {empresaAberta && (
        <FichaEmpresa
          id={Number(empresaAberta)}
          aoFechar={() => mudar({ empresa: null })}
          aoAbrir={(id) => mudar({ empresa: String(id) })}
        />
      )}
      {importando && <ImportarLeads aoFechar={() => setImportando(false)} />}
    </>
  );
}
