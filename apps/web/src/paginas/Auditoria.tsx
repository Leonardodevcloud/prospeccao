import { Badge, Button, EmptyState } from '@prospeccao/ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { api, type ItemAuditoria, qs } from '../api';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi } from '../componentes/Formulario';
import { useEquipe, useSessao } from '../componentes/Sessao';
import { fmtHoraCompleta, fmtNome, fmtQuando } from '../formatar';

const PERIODOS = [
  { id: '1', rotulo: 'Hoje e ontem' },
  { id: '7', rotulo: 'Últimos 7 dias' },
  { id: '30', rotulo: 'Últimos 30 dias' },
  { id: '', rotulo: 'Desde o começo' },
];

const ROTULO_ACAO: Record<string, string> = {
  acesso: 'Acesso',
  funil: 'Funil',
  campanha: 'Campanha',
  configuração: 'Configuração',
  conversa: 'Conversa',
  agente: 'Agente',
  agenda: 'Agenda',
  'e-mail': 'E-mail',
  equipe: 'Equipe',
  lead: 'Lead',
  importação: 'Importação',
  exportação: 'Exportação',
  master: 'Suporte Prospect Team',
  outro: 'Outro',
};

/** O que foi enviado na alteração, para quem quer conferir (sem senhas nem chaves). */
function Detalhes(props: { i: ItemAuditoria }) {
  const corpo = props.i.detalhes?.corpo ?? props.i.detalhes?.filtros;
  if (!corpo || (typeof corpo === 'object' && !Object.keys(corpo as object).length)) return null;
  return (
    <details className="auditoria__detalhes">
      <summary>detalhes</summary>
      <pre className="bloco-codigo">{JSON.stringify(corpo, null, 2)}</pre>
      {props.i.ip && <span className="quieto">IP {props.i.ip}</span>}
    </details>
  );
}

/** Quem fez o quê na conta: alterações pela tela, acessos, exportações e o que o master fez nela. */
export function Auditoria() {
  const sessao = useSessao();
  const equipe = useEquipe();
  const [params, setParams] = useSearchParams();
  const usuarioId = params.get('pessoa') ?? '';
  const acao = params.get('acao') ?? '';
  const dias = params.get('dias') ?? '7';
  const lead = params.get('empresa');
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const mudar = (novos: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: só a digitação dispara
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('busca') ?? '') !== busca) mudar({ busca: busca || null });
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const filtros = {
    usuarioId: usuarioId || undefined,
    acao: acao || undefined,
    dias: dias || undefined,
    busca: params.get('busca') || undefined,
  };
  const acoes = useQuery({
    queryKey: ['auditoria', 'acoes'],
    queryFn: () => api<{ acao: string; n: number }[]>('/auditoria/acoes'),
  });
  const q = useInfiniteQuery({
    queryKey: ['auditoria', filtros],
    queryFn: ({ pageParam }) =>
      api<{ itens: ItemAuditoria[]; temMais: boolean }>(
        `/auditoria${qs({ ...filtros, antesDe: pageParam || undefined })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (ultima) => (ultima.temMais ? (ultima.itens.at(-1)?.id ?? undefined) : undefined),
    placeholderData: keepPreviousData,
  });
  const itens = q.data?.pages.flatMap((p) => p.itens) ?? [];

  if (sessao.data && sessao.data.papel !== 'admin') return <Navigate to="/" replace />;

  return (
    <>
      <div className="topo">
        <div>
          <h1>Auditoria</h1>
          <p>Quem fez o quê nesta conta: alterações pela tela, acessos, exportações e o que o suporte fez.</p>
        </div>
      </div>
      <div className="barra">
        <label className="pp-sr" htmlFor="aud-busca">
          Buscar
        </label>
        <input
          id="aud-busca"
          className="filtro"
          type="search"
          placeholder="Buscar (o quê, quem, lead)"
          style={{ flex: '1 1 220px' }}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <label className="pp-sr" htmlFor="aud-pessoa">
          Pessoa
        </label>
        <select
          id="aud-pessoa"
          className="filtro"
          value={usuarioId}
          onChange={(e) => mudar({ pessoa: e.target.value || null })}
        >
          <option value="">Todas as pessoas</option>
          {equipe.data?.usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <label className="pp-sr" htmlFor="aud-acao">
          Tipo
        </label>
        <select
          id="aud-acao"
          className="filtro"
          value={acao}
          onChange={(e) => mudar({ acao: e.target.value || null })}
        >
          <option value="">Tudo</option>
          {acoes.data?.map((a) => (
            <option key={a.acao} value={a.acao}>
              {ROTULO_ACAO[a.acao] ?? a.acao} ({a.n})
            </option>
          ))}
        </select>
        <label className="pp-sr" htmlFor="aud-periodo">
          Período
        </label>
        <select
          id="aud-periodo"
          className="filtro"
          value={dias}
          onChange={(e) => mudar({ dias: e.target.value })}
        >
          {PERIODOS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </div>
      <ErroDaApi erro={q.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : !itens.length ? (
        <div className="pp-panel">
          <EmptyState
            icone="clock"
            titulo="Nada no período"
            texto="Mude os filtros ou o período para ver mais."
          />
        </div>
      ) : (
        <div className="pp-tablewrap">
          <table className="pp-table tabela-auditoria">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>O quê</th>
                <th>Lead</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id} className="auditoria__linha">
                  <td title={fmtHoraCompleta(i.criadoEm)} className="quieto auditoria__quando">
                    {fmtQuando(i.criadoEm)}
                  </td>
                  <td>
                    {i.usuarioNome ?? 'sistema'}
                    {i.comoMaster && (
                      <Badge tone="outline" className="auditoria__master">
                        suporte
                      </Badge>
                    )}
                  </td>
                  <td>
                    <span className="auditoria__acao">{ROTULO_ACAO[i.acao] ?? i.acao}</span> {i.descricao}
                    <Detalhes i={i} />
                  </td>
                  <td>
                    {i.empresaId ? (
                      <button
                        type="button"
                        className="link-botao"
                        onClick={() => mudar({ empresa: String(i.empresaId) })}
                      >
                        {fmtNome(i.empresaNome ?? `#${i.empresaId}`)}
                      </button>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && (
        <div className="acoes">
          <Button variant="ghost" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {q.isFetchingNextPage ? 'Carregando…' : 'Ver mais antigos'}
          </Button>
        </div>
      )}
      <p className="nota-rodape">
        Senhas e chaves nunca entram no registro. Leituras (abrir telas, fichas e conversas) não são
        registradas; exportações sim.
      </p>
      {lead && (
        <FichaEmpresa
          id={Number(lead)}
          aoFechar={() => mudar({ empresa: null })}
          aoAbrir={(id) => mudar({ empresa: String(id) })}
        />
      )}
    </>
  );
}
