import { Button, EmptyState, Panel, Stat, Tabs } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { ErroDaApi } from '../componentes/Formulario';
import { useSessao } from '../componentes/Sessao';
import { fmtNumero } from '../formatar';
import { Barras } from './Relatorios';

/**
 * Painel master › Visitas do site: quantas pessoas abriram o site, de onde vieram, o que clicaram,
 * até onde rolaram a página inicial e quantas viraram cadastro. Contado sem cookie (veja visitas.js).
 */

interface ResumoVisitas {
  dias: number;
  totais: {
    visitas: number;
    visitantes: number;
    celular: number;
    anterior: { visitas: number; visitantes: number };
    profundidade: number | null;
    segundos: number | null;
    chegaramAoFim: number;
    leituras: number;
  };
  porDia: { dia: string; visitas: number; visitantes: number; cliques: number }[];
  origens: { origem: string; visitantes: number }[];
  campanhas: { campanha: string; visitantes: number }[];
  paginas: { pagina: string; visitas: number }[];
  cliques: { alvo: string; rotulo: string; cliques: number; pessoas: number }[];
  dispositivos: { dispositivo: string; visitantes: number }[];
  cidades: { cidade: string; visitantes: number }[];
  secoes: { id: string; rotulo: string; viram: number; pct: number }[];
  conversao: {
    visitantes: number;
    clicaramTesteOuAssinar: number;
    cadastros: number;
    confirmados: number;
    pagaram: number;
    demonstracoes: number;
  };
}

const PERIODOS = [
  { id: '7', rotulo: '7 dias' },
  { id: '30', rotulo: '30 dias' },
  { id: '90', rotulo: '90 dias' },
];

const NOME_PAGINA: Record<string, string> = {
  '/': 'Página inicial',
  '/apresentacao': 'Apresentação',
  '/api': 'Documentação da API',
  '/demonstracao': 'Agendar demonstração',
  '/termos': 'Termos de uso',
  '/privacidade': 'Privacidade',
};
const NOME_DISPOSITIVO: Record<string, string> = {
  celular: 'Celular',
  computador: 'Computador',
  tablet: 'Tablet',
};

const fmtPct = (x: number) => `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const tempo = (s: number | null) =>
  s == null ? '—' : s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;

function comparar(
  agora: number,
  antes: number,
  dias: number,
): { delta: string; tendencia?: 'sobe' | 'desce' } {
  if (!antes) return { delta: agora ? `nos ${dias} dias antes não havia contagem` : 'sem visitas ainda' };
  const v = Math.round(((agora - antes) / antes) * 100);
  return {
    delta: `${v >= 0 ? '+' : ''}${v}% contra os ${dias} dias antes`,
    tendencia: v > 0 ? 'sobe' : v < 0 ? 'desce' : undefined,
  };
}

/** Visitantes por dia (colunas), com cliques no detalhe ao passar o mouse. */
function PorDia({ dias }: { dias: ResumoVisitas['porDia'] }) {
  const max = Math.max(1, ...dias.map((d) => d.visitantes));
  const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return (
    <figure className="ritmo" style={{ margin: 0 }}>
      <div className="ritmo__colunas" aria-hidden="true">
        {dias.map((d) => (
          <div
            key={d.dia}
            className="ritmo__coluna"
            title={`${dia(d.dia)}: ${d.visitantes} visitantes · ${d.visitas} páginas abertas · ${d.cliques} cliques`}
          >
            <span className="ritmo__barra" style={{ height: `${(d.visitantes / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <figcaption className="quieto visitas__eixo">
        <span>{dia(dias[0]!.dia)}</span>
        <span>hoje</span>
      </figcaption>
      <table className="pp-sr">
        <caption>Visitantes por dia</caption>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Visitantes</th>
            <th>Páginas abertas</th>
            <th>Cliques</th>
          </tr>
        </thead>
        <tbody>
          {dias.map((d) => (
            <tr key={d.dia}>
              <td>{dia(d.dia)}</td>
              <td>{d.visitantes}</td>
              <td>{d.visitas}</td>
              <td>{d.cliques}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const Vazio = (props: { texto: string }) => (
  <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
    {props.texto}
  </p>
);

/** /plataforma/site */
export function PlataformaSite() {
  const sessao = useSessao();
  const master = !!sessao.data?.master;
  const [params, setParams] = useSearchParams();
  const dias = PERIODOS.some((p) => p.id === params.get('dias')) ? params.get('dias')! : '30';
  const q = useQuery({
    queryKey: ['master', 'visitas-site', dias],
    queryFn: () => api<ResumoVisitas>(`/master/site/visitas?dias=${dias}`),
    enabled: master,
    refetchInterval: 120_000,
  });

  if (sessao.data && !master) return <Navigate to="/" replace />;
  const r = q.data;
  const t = r?.totais;

  return (
    <>
      <div className="topo">
        <div>
          <h1>Visitas do site</h1>
          <p>
            Quem abriu o prospectteam.com.br, de onde veio, o que clicou, até onde rolou a página e quantos
            viraram cadastro. Contado sem cookie. <LinkAjuda artigo="painel-plataforma" />
          </p>
        </div>
        <div className="acoes">
          <Button
            variant="ghost"
            icon="globe"
            onClick={() => window.open('https://prospectteam.com.br', '_blank')}
          >
            Abrir o site
          </Button>
        </div>
      </div>
      <Tabs
        itens={PERIODOS}
        ativo={dias}
        onChange={(id) => setParams({ dias: id }, { replace: true })}
        rotulo="Período"
      />
      {q.isPending && <div className="esqueleto" style={{ marginTop: 16 }} />}
      {q.error && <ErroDaApi erro={q.error} />}
      {r && t && (
        <>
          {!t.visitantes && !t.anterior.visitantes && (
            <div className="pp-panel" style={{ marginTop: 16 }}>
              <EmptyState
                icone="globe"
                titulo="Nenhuma visita contada ainda"
                texto="As visitas aparecem aqui depois que o site novo sobe (ele passa a avisar cada página aberta). Abra o site numa janela anônima para ver a primeira."
              />
            </div>
          )}
          <div className="kpis" style={{ marginTop: 16 }}>
            <Stat
              rotulo="Visitantes"
              valor={fmtNumero(t.visitantes)}
              {...comparar(t.visitantes, t.anterior.visitantes, r.dias)}
            />
            <Stat
              rotulo="Páginas abertas"
              valor={fmtNumero(t.visitas)}
              delta={`${fmtPct(t.celular)} pelo celular`}
            />
            <Stat
              rotulo="Leram até o fim"
              valor={t.leituras ? fmtPct(t.chegaramAoFim) : '—'}
              delta={
                t.profundidade != null
                  ? `em média rolam ${t.profundidade}% da página inicial`
                  : 'até onde rolam a página inicial'
              }
            />
            <Stat
              rotulo="Tempo na página inicial"
              valor={tempo(t.segundos)}
              delta="metade fica menos que isso"
            />
            <Stat
              rotulo="Clicaram em testar ou assinar"
              valor={fmtNumero(r.conversao.clicaramTesteOuAssinar)}
              delta={`${pct(r.conversao.clicaramTesteOuAssinar, t.visitantes)} dos visitantes`}
            />
          </div>

          <Panel titulo="Visitantes por dia" className="visitas__painel">
            {t.visitantes ? <PorDia dias={r.porDia} /> : <Vazio texto="Sem visitas no período." />}
          </Panel>

          <div className="grade-relatorio">
            <Panel titulo="Do site ao cliente">
              <Barras
                rotulo="Do site ao cliente"
                itens={[
                  { rotulo: 'Visitantes', valor: r.conversao.visitantes },
                  {
                    rotulo: 'Clicaram em testar',
                    valor: r.conversao.clicaramTesteOuAssinar,
                    detalhe: pct(r.conversao.clicaramTesteOuAssinar, r.conversao.visitantes),
                  },
                  { rotulo: 'Começaram o cadastro', valor: r.conversao.cadastros },
                  {
                    rotulo: 'Confirmaram o e-mail',
                    valor: r.conversao.confirmados,
                    detalhe: pct(r.conversao.confirmados, r.conversao.cadastros),
                  },
                  {
                    rotulo: 'Pagaram',
                    valor: r.conversao.pagaram,
                    detalhe: pct(r.conversao.pagaram, r.conversao.confirmados),
                  },
                ]}
              />
              <p className="quieto" style={{ margin: '10px 0 0', fontSize: 13 }}>
                Mais {fmtNumero(r.conversao.demonstracoes)} pedido
                {r.conversao.demonstracoes === 1 ? '' : 's'} de demonstração pelo formulário (em Vendas).
              </p>
            </Panel>
            <Panel titulo="Até onde chegam na página inicial">
              {t.leituras ? (
                <>
                  <Barras
                    rotulo="Seções vistas"
                    itens={r.secoes.map((s) => ({
                      rotulo: s.rotulo,
                      valor: s.viram,
                      detalhe: fmtPct(s.pct),
                    }))}
                  />
                  <p className="quieto" style={{ margin: '10px 0 0', fontSize: 13 }}>
                    De {fmtNumero(t.leituras)} leituras: quantas passaram por cada seção, na ordem da página.
                    Onde o número cai muito, a página está perdendo gente.
                  </p>
                </>
              ) : (
                <Vazio texto="Aparece quando as primeiras pessoas saírem da página inicial." />
              )}
            </Panel>
            <Panel titulo="De onde vêm">
              {r.origens.length ? (
                <Barras
                  rotulo="Origem dos visitantes"
                  itens={r.origens.map((o) => ({ rotulo: o.origem, valor: o.visitantes }))}
                />
              ) : (
                <Vazio texto="Sem visitas no período." />
              )}
              <p className="quieto" style={{ margin: '10px 0 0', fontSize: 13 }}>
                Link aberto pelo WhatsApp ou pelo app do Instagram costuma chegar como "Direto". Para separar,
                use o link com a origem:{' '}
                <code className="mono">prospectteam.com.br/?utm_source=instagram</code>.
              </p>
            </Panel>
            <Panel titulo="Botões mais clicados">
              {r.cliques.length ? (
                <Barras
                  rotulo="Cliques nos botões"
                  itens={r.cliques.map((c) => ({
                    rotulo: c.rotulo,
                    valor: c.pessoas,
                    detalhe: c.cliques !== c.pessoas ? `${c.cliques} cliques` : undefined,
                  }))}
                />
              ) : (
                <Vazio texto="Nenhum clique nos botões principais no período." />
              )}
            </Panel>
            <Panel titulo="Celular ou computador">
              {r.dispositivos.length ? (
                <Barras
                  rotulo="Dispositivo"
                  itens={r.dispositivos.map((d) => ({
                    rotulo: NOME_DISPOSITIVO[d.dispositivo] ?? d.dispositivo,
                    valor: d.visitantes,
                    detalhe: pct(d.visitantes, t.visitantes),
                  }))}
                />
              ) : (
                <Vazio texto="Sem visitas no período." />
              )}
            </Panel>
            <Panel titulo="Cidades">
              {r.cidades.length ? (
                <Barras
                  rotulo="Cidades"
                  itens={r.cidades.map((c) => ({ rotulo: c.cidade, valor: c.visitantes }))}
                />
              ) : (
                <Vazio texto="A cidade aparece quando o servidor do site informa (pode levar alguns dias para começar)." />
              )}
            </Panel>
            <Panel titulo="Páginas">
              {r.paginas.length ? (
                <Barras
                  rotulo="Páginas abertas"
                  itens={r.paginas.map((p) => ({
                    rotulo: NOME_PAGINA[p.pagina] ?? p.pagina,
                    valor: p.visitas,
                  }))}
                />
              ) : (
                <Vazio texto="Sem visitas no período." />
              )}
            </Panel>
            <Panel titulo="Campanhas (links com utm)">
              {r.campanhas.length ? (
                <Barras
                  rotulo="Campanhas"
                  itens={r.campanhas.map((c) => ({ rotulo: c.campanha, valor: c.visitantes }))}
                />
              ) : (
                <Vazio texto="Nenhuma visita por link com utm_source no período." />
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
