import { campanhaEntrada } from '@prospeccao/shared/dominio';
import { Badge, Button, EmptyState, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type Campanha, type Nicho } from '../api';
import { Drawer } from '../componentes/Drawer';
import { CampoLista, ErroDaApi, Mensagem } from '../componentes/Formulario';
import { EstimativaBusca, PainelPlaces, ResumoPlacesCampanha } from '../componentes/GooglePlaces';
import { ImportarPlanilha } from '../componentes/ImportarPlanilha';
import { useEhMaster } from '../componentes/Sessao';
import { fmtNumero, fmtQuando, ROTULO_STATUS_CAMPANHA, TOM_STATUS_CAMPANHA } from '../formatar';

/** "Salvador/BA" ou "Salvador - BA" → { cidade, uf } */
function lerCidades(linhas: string[]) {
  return linhas
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.+?)\s*[/,-]\s*([A-Za-z]{2})$/);
      return m ? { cidade: m[1]!.trim(), uf: m[2]!.toUpperCase() } : { cidade: l, uf: '' };
    });
}

function FormCampanha({ aoFechar }: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const nichos = useQuery({ queryKey: ['nichos'], queryFn: () => api<Nicho[]>('/nichos') });
  const [f, setF] = useState({
    nome: '',
    nichoId: '',
    cidades: [] as string[],
    metaDiaria: '40',
    limiteEnviosDia: '25',
    maxPorBusca: '120',
    cadencia: 'padrao',
    modo: 'semi',
  });
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const mudar = (campo: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [campo]: e.target.value });

  const criar = useMutation({
    mutationFn: (dados: unknown) => api<Campanha>('/campanhas', { metodo: 'POST', corpo: dados }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
      aoFechar();
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const cidades = lerCidades(f.cidades);
    const semUf = cidades.find((c) => !c.uf);
    if (semUf) return setErroLocal(`Informe a UF de "${semUf.cidade}", ex.: ${semUf.cidade}/BA.`);
    const r = campanhaEntrada.safeParse({ ...f, cidades, raioKm: null });
    if (!r.success) return setErroLocal(r.error.issues[0]?.message ?? 'Confira os campos.');
    setErroLocal(null);
    criar.mutate(r.data);
  };

  return (
    <Drawer titulo="Nova campanha" barra="Nova campanha" aoFechar={aoFechar}>
      <form className="drawer__corpo form" onSubmit={enviar} noValidate>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>Nova campanha</h2>
          <p className="quieto" style={{ margin: '2px 0 0', fontSize: 13 }}>
            Escolha o nicho e as cidades; ao iniciar, o motor busca na base de CNPJ e no Google Maps.
          </p>
        </div>
        <TextField
          rotulo="Nome da campanha"
          value={f.nome}
          onChange={mudar('nome')}
          placeholder="Ex.: Pet shops com entrega · Salvador"
        />
        <div className="campo">
          <label htmlFor="nicho">Nicho</label>
          <select id="nicho" value={f.nichoId} onChange={mudar('nichoId')}>
            <option value="">Escolha um nicho</option>
            {nichos.data?.map((n) => (
              <option key={n.id} value={n.id}>
                {n.nome}
              </option>
            ))}
          </select>
          {nichos.data?.length === 0 && (
            <span className="campo__erro">Cadastre um nicho antes, na tela Nichos.</span>
          )}
        </div>
        <CampoLista
          id="cidades"
          rotulo="Cidades"
          valor={f.cidades}
          aoMudar={(cidades) => setF({ ...f, cidades })}
          exemplo={'Salvador/BA\nLauro de Freitas/BA'}
          dica="Uma por linha, no formato Cidade/UF. Pode misturar estados."
        />
        <div className="form__duas">
          <TextField
            rotulo="Lugares por busca no Maps"
            inputMode="numeric"
            value={f.maxPorBusca}
            onChange={mudar('maxPorBusca')}
            dica="Lugares que cada busca no Google traz: 20 por página, até 3 páginas (60). Cada página conta como uma busca na franquia do Google. Com 60 ou mais, a cidade que enche é dividida por bairro."
          />
          <TextField
            rotulo="Meta de leads por dia"
            inputMode="numeric"
            value={f.metaDiaria}
            onChange={mudar('metaDiaria')}
          />
          <TextField
            rotulo="Abordagens por dia"
            inputMode="numeric"
            value={f.limiteEnviosDia}
            onChange={mudar('limiteEnviosDia')}
            dica="Teto do chip de prospecção."
          />
        </div>
        <div className="campo">
          <label htmlFor="cadencia">Cadência</label>
          <select id="cadencia" value={f.cadencia} onChange={mudar('cadencia')}>
            <option value="padrao">Padrão · 5 passos em 11 dias úteis</option>
            <option value="curta">Curta · 3 passos em 5 dias úteis</option>
          </select>
        </div>
        <fieldset className="campo">
          <legend>Modo de envio</legend>
          <div className="opcoes" style={{ flexDirection: 'column' }}>
            <label className="opcao">
              <input
                type="radio"
                name="modo"
                value="semi"
                checked={f.modo === 'semi'}
                onChange={mudar('modo')}
              />
              <span>
                Semi-automático
                <br />
                <span className="campo__dica">Você aprova a fila de mensagens toda manhã.</span>
              </span>
            </label>
            <label className="opcao">
              <input
                type="radio"
                name="modo"
                value="auto"
                checked={f.modo === 'auto'}
                onChange={mudar('modo')}
              />
              <span>
                Automático
                <br />
                <span className="campo__dica">Leads faixa A recebem a cadência sozinhos.</span>
              </span>
            </label>
          </div>
        </fieldset>
        {erroLocal && <Mensagem tipo="erro">{erroLocal}</Mensagem>}
        <ErroDaApi erro={criar.error} />
        <div className="acoes">
          <Button variant="primary" type="submit" icon="check" disabled={criar.isPending}>
            {criar.isPending ? 'Criando…' : 'Criar campanha'}
          </Button>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

/** Barra fina de progresso (feito de total). */
function Barra({ feito, total, rotulo }: { feito: number; total: number; rotulo: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((feito / total) * 100)) : 0;
  return (
    <div
      className="barra-progresso"
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={feito}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Onde a campanha está, etapa por etapa: base de CNPJ, buscas no Maps e enriquecimento. Cada
 * etapa diz o que já fez e, se parou, por quê e o que fazer.
 */
function Andamento(props: {
  c: Campanha;
  aoTentarDeNovo: () => void;
  aoParar: () => void;
  ocupado: boolean;
}) {
  const master = useEhMaster();
  const { c } = props;
  // A tela pode chegar antes da API nova (o Vercel publica mais rápido que o Railway): campos que
  // ainda não vieram entram com valor neutro em vez de derrubar a página.
  const p = {
    ...c.progresso,
    ufsForaDaBase: c.progresso.ufsForaDaBase ?? [],
    enriquecidos: c.progresso.enriquecidos ?? 0,
    elegiveis: c.progresso.elegiveis ?? 0,
    naFilaEnriquecimento: c.progresso.naFilaEnriquecimento ?? 0,
    servicoEnriquecimento: c.progresso.servicoEnriquecimento ?? 'desconhecido',
    erroBusca: c.progresso.erroBusca ?? null,
    buscasParadas: c.progresso.buscasParadas ?? 0,
    buscasBloqueadas: c.progresso.buscasBloqueadas ?? 0,
    buscasPorBairro: c.progresso.buscasPorBairro ?? 0,
  };
  const ativa = c.status === 'ativa';
  const buscasTotal = p.buscasPendentes + p.buscasConcluidas + p.buscasComErro + p.buscasBloqueadas;
  const noTeto = p.buscasBloqueadas > 0;
  const paradas = ativa ? p.buscasParadas : 0;
  const buscando = ativa && p.buscasPendentes > paradas;
  const enriquecendo = p.naFilaEnriquecimento > 0;
  const servico = p.servicoEnriquecimento;

  return (
    <div className="andamento-campanha">
      {/* 1. Base de CNPJ */}
      <div className="etapa-campanha">
        <div className="etapa-campanha__topo">
          <b>Base de CNPJ</b>
          <span className="mono">{fmtNumero(p.comCnpj)} empresas</span>
        </div>
        {p.ufsForaDaBase.length > 0 ? (
          <p className="erro-texto">
            A base ainda não tem {p.ufsForaDaBase.join(', ')}: importe de novo em{' '}
            <Link to="/base-cnpj">Base CNPJ</Link> (com todos os estados em CNPJ_UFS_EXTRAS).
          </p>
        ) : (
          <p className="quieto">Empresas ativas do nicho nas cidades da campanha (sem MEI).</p>
        )}
      </div>

      {/* 2. Google Maps */}
      <div className="etapa-campanha">
        <div className="etapa-campanha__topo">
          <b>{buscando && <span className="vivo" aria-hidden="true" />} Google Maps</b>
          <span className="mono">
            {buscasTotal ? `${fmtNumero(p.buscasConcluidas)} de ${fmtNumero(buscasTotal)} buscas` : '—'}
          </span>
        </div>
        {buscasTotal > 0 && <Barra feito={p.buscasConcluidas} total={buscasTotal} rotulo="Buscas no Maps" />}
        {master && <ResumoPlacesCampanha c={c} />}
        {noTeto ? (
          <div className="etapa-campanha__erro">
            <p className="erro-texto">
              {fmtNumero(p.buscasBloqueadas)} {p.buscasBloqueadas === 1 ? 'busca parada' : 'buscas paradas'}{' '}
              no teto. {p.erroBusca}
            </p>
            {c.status !== 'encerrada' && (
              <Button size="sm" disabled={props.ocupado} onClick={props.aoTentarDeNovo}>
                Ajustar teto e retomar
              </Button>
            )}
          </div>
        ) : p.erroBusca || paradas > 0 ? (
          <div className="etapa-campanha__erro">
            <p className="erro-texto">
              {paradas > 0 && `${fmtNumero(paradas)} ${paradas === 1 ? 'busca parada' : 'buscas paradas'}. `}
              {p.erroBusca ?? 'Ela não está mais na fila: clique em "Tentar de novo".'}
            </p>
            {ativa && (
              <Button size="sm" disabled={props.ocupado} onClick={props.aoTentarDeNovo}>
                Tentar de novo
              </Button>
            )}
          </div>
        ) : (
          <p className="quieto">
            {!ativa && p.buscasPendentes > 0
              ? 'Campanha pausada: as buscas esperam ela voltar.'
              : buscando
                ? `${fmtNumero(p.buscasPendentes - paradas)} em andamento no Google · cada uma leva poucos segundos.`
                : buscasTotal
                  ? `Concluídas · última ${fmtQuando(p.ultimaBusca)} · ${fmtNumero(p.noMaps)} lugares ligados`
                  : ativa
                    ? 'Preparando as buscas…'
                    : 'Começa quando a campanha for iniciada.'}
          </p>
        )}
      </div>

      {/* 3. Enriquecimento */}
      <div className="etapa-campanha">
        <div className="etapa-campanha__topo">
          <b>
            {enriquecendo && servico === 'rodando' && <span className="vivo" aria-hidden="true" />}{' '}
            Enriquecimento
          </b>
          <span className="mono">
            {fmtNumero(p.enriquecidos)} de {fmtNumero(p.elegiveis)} leads
          </span>
        </div>
        {p.elegiveis > 0 && <Barra feito={p.enriquecidos} total={p.elegiveis} rotulo="Leads enriquecidos" />}
        {servico === 'pausado' ? (
          <p className="aviso-texto">
            {master
              ? `Pausado no Railway (ENRIQ_PAUSADO=true no worker-enriquecimento). ${fmtNumero(p.naFilaEnriquecimento)} esperando; troque para false para continuar.`
              : `Enriquecimento em manutenção: ${fmtNumero(p.naFilaEnriquecimento)} leads esperando, continuam sozinhos.`}
          </p>
        ) : servico === 'fora' ? (
          <p className="erro-texto">
            {master
              ? 'O worker-enriquecimento não dá sinal de vida há mais de 3 minutos: confira se ele está no ar no Railway.'
              : 'O enriquecimento está parado no momento. Nosso suporte já foi avisado; os leads continuam na fila.'}
          </p>
        ) : enriquecendo ? (
          <div className="etapa-campanha__erro">
            <p className="quieto">{fmtNumero(p.naFilaEnriquecimento)} na fila ou rodando agora.</p>
            <Button size="sm" variant="danger" disabled={props.ocupado} onClick={props.aoParar}>
              Parar enriquecimento
            </Button>
          </div>
        ) : (
          <p className="quieto">
            {p.elegiveis === 0
              ? 'Começa quando as buscas encontrarem leads.'
              : p.enriquecidos >= p.elegiveis
                ? 'Todos os leads enriquecidos.'
                : buscando
                  ? 'Começa quando as buscas no Maps terminarem.'
                  : 'Nada na fila. Use "Refazer enriquecimento" para enriquecer os que faltam.'}
          </p>
        )}
      </div>
    </div>
  );
}

function CardCampanha({ c }: { c: Campanha }) {
  const master = useEhMaster();
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const [avisos, setAvisos] = useState<string[]>([]);
  const [estimando, setEstimando] = useState(false);
  const acao = useMutation({
    mutationFn: (qual: 'iniciar' | 'pausar' | 'encerrar') =>
      api<{ avisos?: string[] }>(`/campanhas/${c.id}/${qual}`, { metodo: 'POST' }),
    onSuccess: (r) => {
      setAvisos(r?.avisos ?? []);
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });
  /** Iniciar/retomar depois da estimativa do Google, já com o teto escolhido. */
  const rodar = useMutation({
    mutationFn: (tetoPlacesUsd: number | null) =>
      api<{ avisos?: string[] }>(`/campanhas/${c.id}/iniciar`, { metodo: 'POST', corpo: { tetoPlacesUsd } }),
    onSuccess: (r) => {
      setEstimando(false);
      setAvisos(r?.avisos ?? []);
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
      cliente.invalidateQueries({ queryKey: ['places-uso'] });
    },
  });
  const [confirmarRefazer, setConfirmarRefazer] = useState(false);
  const [importando, setImportando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [nomeDigitado, setNomeDigitado] = useState('');
  const parar = useMutation({
    mutationFn: () =>
      api<{ cancelados: number }>(`/campanhas/${c.id}/parar-enriquecimento`, { metodo: 'POST' }),
    onSuccess: (r) => {
      setAvisos([
        `Enriquecimento parado: ${fmtNumero(r.cancelados)} leads saíram da fila. Os que já estavam rodando terminam em instantes.`,
      ]);
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });
  const apagar = useMutation({
    mutationFn: () =>
      api<{ leadsApagados: number }>(`/campanhas/${c.id}`, {
        metodo: 'DELETE',
        corpo: { confirmarNome: nomeDigitado },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
      cliente.invalidateQueries({ queryKey: ['empresas'] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
    },
  });
  const [escopo, setEscopo] = useState<'ab' | 'sem_decisor' | 'todos'>('ab');
  const previa = useQuery({
    queryKey: ['reenriquecer', c.id],
    queryFn: () => api<{ ab: number; semDecisor: number; todos: number }>(`/campanhas/${c.id}/reenriquecer`),
    enabled: confirmarRefazer,
  });
  const refazer = useMutation({
    mutationFn: () =>
      api<{ quantidade: number }>(`/campanhas/${c.id}/reenriquecer`, { metodo: 'POST', corpo: { escopo } }),
    onSuccess: (r) => {
      setConfirmarRefazer(false);
      setAvisos([
        `${fmtNumero(r.quantidade)} leads entraram na fila do enriquecimento (notas mais altas primeiro). O andamento aparece aqui no card e em Atividade.`,
      ]);
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });
  const OPCOES_REFAZER = [
    {
      id: 'ab' as const,
      rotulo: 'Só notas A e B',
      dica: 'Recomendado: refaz decisor e LinkedIn de quem vale abordar.',
      n: previa.data?.ab,
    },
    {
      id: 'sem_decisor' as const,
      rotulo: 'Só quem está sem decisor',
      dica: 'Útil depois que a base de CNPJ trouxe os sócios.',
      n: previa.data?.semDecisor,
    },
    { id: 'todos' as const, rotulo: 'Todos', dica: 'O mais caro.', n: previa.data?.todos },
  ];
  const escolhida = OPCOES_REFAZER.find((o) => o.id === escopo);
  const p = c.progresso;

  return (
    <article className="card-campanha">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3>{c.nome}</h3>
          <p className="quieto" style={{ margin: '2px 0 0', fontSize: 13, lineHeight: '18px' }}>
            {c.nichoNome} · {c.cidades.map((x) => `${x.cidade}/${x.uf}`).join(', ')} ·{' '}
            {c.raioKm == null ? 'todo o Brasil' : `raio ${c.raioKm} km`}
          </p>
        </div>
        <Badge tone={TOM_STATUS_CAMPANHA[c.status]}>{ROTULO_STATUS_CAMPANHA[c.status]}</Badge>
      </div>

      <div className="numeros">
        <div>
          <b>{fmtNumero(p.empresas)}</b>
          <span>empresas</span>
        </div>
        <div>
          <b>{fmtNumero(p.novos)}</b>
          <span>novos</span>
        </div>
        <div>
          <b>{fmtNumero(p.noFunil)}</b>
          <span>no funil</span>
        </div>
        <div>
          <b>{fmtNumero(p.descartados)}</b>
          <span>descartados</span>
        </div>
      </div>
      <Andamento
        c={c}
        aoTentarDeNovo={() => (master ? setEstimando(true) : rodar.mutate(null))}
        aoParar={() => parar.mutate()}
        ocupado={acao.isPending || parar.isPending || rodar.isPending}
      />
      {estimando && (
        <EstimativaBusca
          c={c}
          ocupado={rodar.isPending}
          aoRodar={(teto) => rodar.mutate(teto)}
          aoCancelar={() => setEstimando(false)}
        />
      )}

      {avisos.map((a) => (
        <Mensagem key={a} tipo="aviso">
          {a}
        </Mensagem>
      ))}
      <ErroDaApi erro={acao.error ?? rodar.error ?? refazer.error} />
      <ErroDaApi erro={parar.error ?? apagar.error} />
      {apagando && (
        <div className="confirmar" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
          <span>
            Apagar a campanha e os {fmtNumero(p.empresas)} leads dela, com enriquecimento e funil? Leads que
            outra campanha também achou ficam. A Base CNPJ e os nichos não são apagados. Não dá para desfazer.
          </span>
          <div className="campo">
            <label htmlFor={`apagar-${c.id}`}>
              Digite <b>{c.nome}</b> para confirmar
            </label>
            <input
              id={`apagar-${c.id}`}
              className="filtro"
              value={nomeDigitado}
              autoComplete="off"
              onChange={(e) => setNomeDigitado(e.target.value)}
            />
          </div>
          <div className="acoes">
            <Button
              size="sm"
              variant="danger"
              disabled={apagar.isPending || nomeDigitado.trim().toLowerCase() !== c.nome.trim().toLowerCase()}
              onClick={() => apagar.mutate()}
            >
              {apagar.isPending ? 'Apagando…' : 'Apagar campanha e leads'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setApagando(false);
                setNomeDigitado('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {confirmarRefazer && (
        <div className="confirmar">
          <span>
            Refazer o enriquecimento de quais leads? MEI e descartados ficam de fora. Conta de novo no limite
            de leads do mês.
          </span>
          <fieldset className="campo" style={{ gap: 6 }}>
            <legend className="pp-sr">Quais leads</legend>
            {OPCOES_REFAZER.map((o) => (
              <label key={o.id} className="opcao">
                <input
                  type="radio"
                  name={`escopo-${c.id}`}
                  checked={escopo === o.id}
                  onChange={() => setEscopo(o.id)}
                />
                <span>
                  <b style={{ fontWeight: 500 }}>
                    {o.rotulo} {o.n != null && <span className="mono">({fmtNumero(o.n)})</span>}
                  </b>
                  <span className="campo__dica" style={{ display: 'block' }}>
                    {o.dica}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <ErroDaApi erro={previa.error} />
          <div className="acoes">
            <Button
              size="sm"
              variant="primary"
              disabled={refazer.isPending || !escolhida?.n}
              onClick={() => refazer.mutate()}
            >
              {refazer.isPending
                ? 'Enviando…'
                : escolhida?.n != null
                  ? `Refazer ${fmtNumero(escolhida.n)} leads`
                  : 'Contando…'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmarRefazer(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="acoes">
        {(c.status === 'rascunho' || c.status === 'pausada') && (
          <Button
            variant="primary"
            size="sm"
            icon="send"
            disabled={acao.isPending || estimando}
            onClick={() => (master ? setEstimando(true) : rodar.mutate(null))}
          >
            {c.status === 'rascunho' ? 'Iniciar busca' : 'Retomar'}
          </Button>
        )}
        {c.status === 'ativa' && (
          <Button size="sm" disabled={acao.isPending} onClick={() => acao.mutate('pausar')}>
            Pausar
          </Button>
        )}
        {p.empresas > 0 && (
          <Button
            size="sm"
            icon="users"
            onClick={() => navegar(`/?campanhaId=${c.id}${p.novos ? '' : '&situacao=todos'}`)}
          >
            {p.novos ? `Ver ${fmtNumero(p.novos)} novos` : 'Ver leads'}
          </Button>
        )}
        {c.status !== 'encerrada' && (
          <Button size="sm" variant="ghost" icon="file-text" onClick={() => setImportando(true)}>
            Importar planilha do Maps
          </Button>
        )}
        {p.empresas > 0 && !confirmarRefazer && (
          <Button size="sm" variant="ghost" icon="loader" onClick={() => setConfirmarRefazer(true)}>
            Refazer enriquecimento
          </Button>
        )}
        {c.status !== 'encerrada' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={acao.isPending}
            onClick={() => {
              if (confirm(`Encerrar a campanha "${c.nome}"? Ela não poderá ser retomada.`))
                acao.mutate('encerrar');
            }}
          >
            Encerrar
          </Button>
        )}
        {!apagando && (
          <Button variant="ghost" size="sm" icon="x" onClick={() => setApagando(true)}>
            Apagar campanha
          </Button>
        )}
      </div>
      {importando && <ImportarPlanilha campanha={c} aoFechar={() => setImportando(false)} />}
    </article>
  );
}

export function Campanhas() {
  const master = useEhMaster();
  const [criando, setCriando] = useState(false);
  const campanhas = useQuery({
    queryKey: ['campanhas'],
    queryFn: () => api<Campanha[]>('/campanhas'),
    // Atualiza sozinho enquanto alguma busca estiver rodando.
    refetchInterval: (q) =>
      q.state.data?.some(
        (c) =>
          (c.status === 'ativa' && c.progresso.buscasPendentes > 0) || c.progresso.naFilaEnriquecimento > 0,
      )
        ? 10_000
        : false,
  });

  return (
    <>
      <div className="topo">
        <div>
          <h1>Campanhas</h1>
          <p>Cada campanha é um nicho em algumas cidades, com meta de leads e ritmo de abordagem.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCriando(true)}>
          Nova campanha
        </Button>
      </div>

      {master && <PainelPlaces />}
      <ErroDaApi erro={campanhas.error} />
      {campanhas.isPending ? (
        <div className="grade-cards">
          {[1, 2].map((i) => (
            <div key={i} className="esqueleto" style={{ height: 220 }} />
          ))}
        </div>
      ) : campanhas.data?.length ? (
        <div className="grade-cards">
          {campanhas.data.map((c) => (
            <CardCampanha key={c.id} c={c} />
          ))}
        </div>
      ) : (
        <div className="pp-panel">
          <EmptyState
            icone="layers"
            titulo="Nenhuma campanha ainda"
            texto="Crie a primeira: escolha um nicho e as cidades onde buscar."
            acao={
              <Button size="sm" variant="primary" icon="plus" onClick={() => setCriando(true)}>
                Nova campanha
              </Button>
            }
          />
        </div>
      )}

      {criando && <FormCampanha aoFechar={() => setCriando(false)} />}
    </>
  );
}
