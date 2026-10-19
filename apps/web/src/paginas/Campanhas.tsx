import { campanhaEntrada } from '@prospeccao/shared/dominio';
import { Badge, Button, EmptyState, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type Campanha, type Nicho } from '../api';
import { Drawer } from '../componentes/Drawer';
import { CampoLista, ErroDaApi, Mensagem } from '../componentes/Formulario';
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
            dica="Limite de lugares que cada busca no Google Maps traz (uma busca por cidade × termo do nicho). Não limita os leads da base de CNPJ. Mais lugares, mais custo no Apify."
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

function CardCampanha({ c }: { c: Campanha }) {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const [avisos, setAvisos] = useState<string[]>([]);
  const acao = useMutation({
    mutationFn: (qual: 'iniciar' | 'pausar' | 'encerrar') =>
      api<{ avisos?: string[] }>(`/campanhas/${c.id}/${qual}`, { metodo: 'POST' }),
    onSuccess: (r) => {
      setAvisos(r?.avisos ?? []);
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });
  const [confirmarRefazer, setConfirmarRefazer] = useState(false);
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
  const buscando = c.status === 'ativa' && p.buscasPendentes > 0;

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
      <p className="quieto" style={{ margin: 0, fontSize: 12, lineHeight: '16px' }}>
        {fmtNumero(p.comCnpj)} com CNPJ · {fmtNumero(p.comSinalEntrega)} com sinal de entrega
        {p.mei > 0 && ` · ${fmtNumero(p.mei)} MEI ignorados`}. Rodar de novo só traz como "novos" os que ainda
        não foram trabalhados.
      </p>

      <p className="quieto" style={{ margin: 0, fontSize: 12, lineHeight: '16px' }}>
        {buscando
          ? `Buscando no Maps: ${p.buscasPendentes} ${p.buscasPendentes === 1 ? 'busca' : 'buscas'} em andamento`
          : p.buscasConcluidas
            ? `${p.buscasConcluidas} buscas no Maps · última ${fmtQuando(p.ultimaBusca)}`
            : 'Nenhuma busca no Maps ainda'}
        {p.buscasComErro > 0 && ` · ${p.buscasComErro} com erro`}
        {p.semLocalizacao > 0 && ` · ${p.semLocalizacao} sem localização`}
      </p>

      {avisos.map((a) => (
        <Mensagem key={a} tipo="aviso">
          {a}
        </Mensagem>
      ))}
      <ErroDaApi erro={acao.error ?? refazer.error} />
      {p.naFilaEnriquecimento > 0 && (
        <div className="linha-status" style={{ fontSize: 13 }}>
          <Badge tone="warning">
            <span className="vivo" aria-hidden="true" /> Enriquecendo
          </Badge>
          <span>{fmtNumero(p.naFilaEnriquecimento)} leads na fila ou rodando agora</span>
          <Button size="sm" variant="danger" disabled={parar.isPending} onClick={() => parar.mutate()}>
            {parar.isPending ? 'Parando…' : 'Parar enriquecimento'}
          </Button>
        </div>
      )}
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
            Refazer o enriquecimento de quais leads? MEI e descartados ficam de fora. Gasta de novo no Apify e
            no Gemini.
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
            disabled={acao.isPending}
            onClick={() => acao.mutate('iniciar')}
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
    </article>
  );
}

export function Campanhas() {
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
