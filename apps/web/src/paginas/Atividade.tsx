import { Badge, EmptyState, Panel } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type BuscaAtividade, type Atividade as DadosAtividade } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { fmtDuracao, fmtHora, fmtHoraCompleta, fmtMes, fmtNumero } from '../formatar';

type Tom = 'brand' | 'warning' | 'danger' | 'neutral';

const SITUACAO_BUSCA: Record<BuscaAtividade['status'], { rotulo: string; tom: Tom }> = {
  pendente: { rotulo: 'Na fila', tom: 'neutral' },
  rodando: { rotulo: 'Buscando', tom: 'warning' },
  concluida: { rotulo: 'Concluída', tom: 'brand' },
  erro: { rotulo: 'Erro', tom: 'danger' },
};

/** Nome de cada fila em português de gente. */
const NOME_FILA: Record<string, string> = {
  'campanha.iniciar': 'Campanhas iniciando',
  'campanha.buscar_cnpj': 'Campanhas cruzando com a base de CNPJ',
  'maps.buscar': 'Buscas no Maps para disparar',
  'maps.coletar': 'Buscas no Maps aguardando resultado',
  'empresa.localizar': 'Endereços para localizar',
  'enriquecimento.solicitar': 'Leads aguardando enriquecimento (Fase 2)',
  'cnpj.importar': 'Importação da base de CNPJ',
  'cnpj.importacao_concluida': 'Avisos de base de CNPJ atualizada',
};

/** Há algo acontecendo agora? Define o ritmo de atualização da tela e o ponto na navegação. */
export function temAtividade(d: DadosAtividade | undefined): boolean {
  if (!d) return false;
  return (
    d.buscasEmAndamento > 0 ||
    d.importacao?.status === 'rodando' ||
    d.importacao?.status === 'na_fila' ||
    d.importacaoAgendada != null
  );
}

export function useAtividade(intervaloParado = 30_000) {
  return useQuery({
    queryKey: ['atividade'],
    queryFn: () => api<DadosAtividade>('/atividade'),
    refetchInterval: (q) => (temAtividade(q.state.data) ? 5_000 : intervaloParado),
  });
}

/** Horário com o detalhe completo ao passar o mouse. */
function Quando({ iso, prefixo }: { iso: string | null | undefined; prefixo?: string }) {
  if (!iso) return <span className="quieto">—</span>;
  return (
    <time dateTime={iso} title={fmtHoraCompleta(iso)}>
      {prefixo ? `${prefixo} ` : ''}
      {fmtHora(iso)}
    </time>
  );
}

function ImportacaoCnpj({ d }: { d: DadosAtividade }) {
  const i = d.importacao;
  const ag = d.importacaoAgendada;
  const agora = new Date(d.agora).getTime();

  if (!i && !ag) {
    return (
      <p style={{ margin: 0, fontSize: 14 }}>
        Nenhuma importação ainda. Peça uma em <Link to="/configuracoes">Configurações</Link>.
      </p>
    );
  }

  return (
    <div className="pilha">
      {i && (
        <div className="linha-status">
          {i.status === 'rodando' && (
            <>
              <Badge tone="warning">
                <span className="vivo" aria-hidden="true" /> Importando
              </Badge>
              <div>
                <b>{i.etapa ?? 'preparando'}</b>
                <span className="quieto">
                  {' '}
                  · {fmtNumero(i.linhasLidas)} linhas lidas · {fmtNumero(i.estabelecimentos)} estabelecimentos
                  guardados · <Quando iso={i.iniciadoEm} prefixo="começou" /> (
                  {fmtDuracao(agora - new Date(i.iniciadoEm ?? i.criadoEm).getTime())})
                </span>
              </div>
            </>
          )}
          {i.status === 'na_fila' && (
            <>
              <Badge tone="neutral">Na fila</Badge>
              <span>
                Começa em instantes · pedida <Quando iso={i.criadoEm} />
              </span>
            </>
          )}
          {i.status === 'concluida' && (
            <>
              <Badge tone="brand">Concluída</Badge>
              <span>
                <Quando iso={i.concluidoEm} /> · publicação {fmtMes(i.mes)} · {fmtNumero(i.estabelecimentos)}{' '}
                estabelecimentos, {fmtNumero(i.socios)} sócios
                {i.ufs.length > 0 && <span className="quieto"> · {i.ufs.join(', ')}</span>}
              </span>
            </>
          )}
          {i.status === 'erro' && (
            <>
              <Badge tone="danger">Falhou</Badge>
              <div>
                <span>
                  <Quando iso={i.concluidoEm ?? i.criadoEm} />
                </span>
                <p className="erro-texto">{i.erro}</p>
              </div>
            </>
          )}
        </div>
      )}
      {ag?.estado === 'nova_tentativa' && (
        <div className="linha-status">
          <Badge tone="neutral">Agendada</Badge>
          <span>
            Nova tentativa automática <Quando iso={ag.quando} /> (tentativa {ag.falhas + 1} de{' '}
            {ag.limiteTentativas + 1}). Não precisa pedir de novo.
          </span>
        </div>
      )}
    </div>
  );
}

/** Uma busca no Apify costuma levar poucos minutos; passando disso, vale avisar. */
const BUSCA_DEMORADA_MS = 30 * 60_000;

function quandoDaBusca(b: BuscaAtividade, agora: number) {
  if (b.status === 'rodando') {
    const desde = b.iniciadoEm ?? b.criadoEm;
    const passou = agora - new Date(desde).getTime();
    return (
      <>
        <Quando iso={desde} prefixo="desde" /> <span className="quieto">· {fmtDuracao(passou)}</span>
        {passou > BUSCA_DEMORADA_MS && (
          <div className="aviso-texto">Demorando mais que o normal: confira o worker-descoberta.</div>
        )}
      </>
    );
  }
  if (b.status === 'concluida' || b.status === 'erro') {
    const levou =
      b.iniciadoEm && b.concluidoEm
        ? fmtDuracao(new Date(b.concluidoEm).getTime() - new Date(b.iniciadoEm).getTime())
        : null;
    return (
      <>
        <Quando iso={b.concluidoEm} />
        {levou && <span className="quieto"> · levou {levou}</span>}
      </>
    );
  }
  return <Quando iso={b.criadoEm} prefixo="pedida" />;
}

/** Célula com rótulo: no celular a linha vira cartão e o rótulo aparece ao lado do valor. */
function Celula(props: { rotulo: string; className?: string; title?: string; children: React.ReactNode }) {
  return (
    <td data-rotulo={props.rotulo} className={props.className} title={props.title}>
      <div>{props.children}</div>
    </td>
  );
}

function BuscasMaps({ d }: { d: DadosAtividade }) {
  const agora = new Date(d.agora).getTime();
  if (!d.buscas.length) {
    return (
      <EmptyState
        icone="search"
        titulo="Nenhuma busca no Maps ainda"
        texto="Inicie uma campanha: o motor busca cada termo do nicho em cada cidade."
        acao={<Link to="/campanhas">Ir para Campanhas</Link>}
      />
    );
  }
  return (
    <div className="pp-tablewrap">
      <table className="pp-table tabela-cartoes">
        <thead>
          <tr>
            <th>Campanha</th>
            <th>Cidade</th>
            <th>Termo</th>
            <th>Situação</th>
            <th className="num">Lugares</th>
            <th>Quando</th>
          </tr>
        </thead>
        <tbody>
          {d.buscas.map((b) => {
            const s = SITUACAO_BUSCA[b.status];
            return (
              <tr key={b.id} style={{ cursor: 'default' }}>
                <Celula rotulo="Campanha">{b.campanha ?? `#${b.campanhaId}`}</Celula>
                <Celula rotulo="Cidade">
                  {b.cidade}/{b.uf}
                </Celula>
                <Celula rotulo="Termo" className="quieto">
                  {b.termo}
                </Celula>
                <Celula rotulo="Situação" title={b.erro ?? undefined}>
                  <Badge tone={s.tom}>
                    {b.status === 'rodando' && <span className="vivo" aria-hidden="true" />} {s.rotulo}
                  </Badge>
                  {b.status === 'erro' && b.erro && <div className="erro-texto">{b.erro}</div>}
                </Celula>
                <Celula rotulo="Lugares" className="mono num">
                  {b.itens == null ? '—' : fmtNumero(b.itens)}
                </Celula>
                <Celula rotulo="Quando">{quandoDaBusca(b, agora)}</Celula>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Filas({ d }: { d: DadosAtividade }) {
  const comItens = Object.entries(d.filas)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a);
  if (!comItens.length) {
    return <p style={{ margin: 0, fontSize: 14 }}>Tudo em dia: nenhuma tarefa esperando.</p>;
  }
  return (
    <ul className="lista-filas">
      {comItens.map(([nome, n]) => (
        <li key={nome}>
          <span>{NOME_FILA[nome] ?? nome}</span>
          <b className="mono">{fmtNumero(n)}</b>
        </li>
      ))}
    </ul>
  );
}

export function Atividade() {
  const atividade = useAtividade();
  const d = atividade.data;
  const ativo = temAtividade(d);

  return (
    <>
      <div className="topo">
        <div>
          <h1>Atividade</h1>
          <p>O que o motor está fazendo agora. Atualiza sozinho; horários de Brasília.</p>
        </div>
        {d && (
          <span className="quieto" style={{ fontSize: 13 }}>
            {ativo && <span className="vivo" style={{ color: 'var(--warning)' }} aria-hidden="true" />}{' '}
            {ativo ? 'Trabalhando' : 'Parado'} · atualizado <Quando iso={d.agora} />
          </span>
        )}
      </div>

      <ErroDaApi erro={atividade.error} />

      {d && (
        <>
          <div className="resumo">
            <div>
              <span>Buscas no Maps</span>
              <b>{d.buscasEmAndamento ? `${d.buscasEmAndamento} em andamento` : 'Nenhuma agora'}</b>
            </div>
            <div>
              <span>Base de CNPJ</span>
              <b>
                {d.importacao?.status === 'rodando'
                  ? 'Importando'
                  : d.importacaoAgendada?.estado === 'nova_tentativa'
                    ? `Nova tentativa ${fmtHora(d.importacaoAgendada.quando)}`
                    : d.importacao?.status === 'concluida'
                      ? `Atualizada ${fmtHora(d.importacao.concluidoEm)}`
                      : d.importacao?.status === 'erro'
                        ? 'Falhou'
                        : d.importacao
                          ? 'Na fila'
                          : 'Nunca importada'}
              </b>
            </div>
            <div>
              <span>Aguardando enriquecimento</span>
              <b>{fmtNumero(d.filas['enriquecimento.solicitar'] ?? 0)} leads</b>
            </div>
          </div>

          <Panel titulo="Base de CNPJ da Receita">
            <ImportacaoCnpj d={d} />
          </Panel>

          <Panel titulo="Buscas no Google Maps" contagem={d.buscas.length} semPadding>
            <BuscasMaps d={d} />
          </Panel>

          <Panel titulo="Filas de trabalho">
            <Filas d={d} />
          </Panel>
        </>
      )}
    </>
  );
}
