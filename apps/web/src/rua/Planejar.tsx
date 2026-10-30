import { haversineKm } from '@prospeccao/shared/geo';
import {
  diaEmSaoPaulo,
  fmtMinutos,
  linkGoogleMaps,
  ROTULO_SITUACAO_RUA,
  SITUACOES_RUA,
  type SituacaoRua,
} from '@prospeccao/shared/rua';
import { Button, EmptyState, Icon, ScoreBadge } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Campanha, ErroApi } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useEquipe, useSessao } from '../componentes/Sessao';
import {
  type ConfigRoteiroEntrada,
  type Faixa,
  type LeadRua,
  localizacaoAgora,
  nomeBonito,
  type Partida,
  type PlanoRua,
  type RoteiroRua,
  useEstadoRua,
} from './api';
import { MapaRua, type PontoFundo } from './Mapa';

/**
 * Planejar o dia (computador): escolhe de quem é o roteiro, a campanha e quais leads entram; o
 * sistema sugere os melhores que cabem no dia, na ordem que anda menos, com a hora de chegada em
 * cada um. Dá para tirar, pôr (clicando no mapa) e mudar a ordem; no fim, salva e manda para o
 * celular do vendedor.
 */

type Ajustes = Omit<ConfigRoteiroEntrada, 'vendedorId' | 'dia' | 'partida'>;

const PADRAO: Ajustes = {
  campanhaId: null,
  faixas: ['A', 'B'],
  situacoes: ['nunca', 'negociacao'],
  inicio: '08:30',
  fim: '17:30',
  minutosVisita: 30,
  almoco: { inicio: '12:00', minutos: 60 },
  raioKm: 15,
};

const TEMPOS_VISITA = [15, 20, 30, 45, 60, 90];
const RAIOS = [5, 10, 15, 25, 40, 60];

/** "quinta, 5 nov" */
export function fmtDiaCurto(dia: string): string {
  return new Date(`${dia}T12:00:00Z`)
    .toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace('.', '')
    .replace('-feira', '');
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

function Chip(props: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="rua-chip" aria-pressed={props.ativo} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export function Planejar() {
  const sessao = useSessao();
  const admin = useEhAdmin();
  const equipe = useEquipe();
  const estado = useEstadoRua();
  const cliente = useQueryClient();
  const eu = sessao.data?.id ?? 0;

  const [vendedorId, setVendedorId] = useState<number | null>(null);
  const vendedor = vendedorId ?? eu;
  const [dia, setDia] = useState(() => diaEmSaoPaulo());
  const [aj, setAj] = useState<Ajustes>(PADRAO);
  const [partida, setPartida] = useState<Partida | null>(null);
  const [modoPartida, setModoPartida] = useState<'base' | 'local' | 'endereco'>('base');
  const [endereco, setEndereco] = useState('');
  const [plano, setPlano] = useState<PlanoRua | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const mudar = (x: Partial<Ajustes>) => setAj((a) => ({ ...a, ...x }));

  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });
  const partidas = useQuery({
    queryKey: ['rua', 'partidas'],
    queryFn: () => api<Partida[]>('/rua/partidas'),
  });
  const salvo = useQuery({
    queryKey: ['rua', 'roteiro', vendedor, dia],
    queryFn: () => api<RoteiroRua | null>(`/rua/roteiros?vendedorId=${vendedor}&dia=${dia}`),
    enabled: !!eu,
  });
  const pontos = useQuery({
    queryKey: ['rua', 'pontos', aj.campanhaId, dia, vendedor],
    queryFn: () =>
      api<{ leads: LeadRua[]; semLocalizacao: number }>(
        `/rua/pontos?dia=${dia}&vendedorId=${vendedor}${aj.campanhaId ? `&campanhaId=${aj.campanhaId}` : ''}`,
      ),
    enabled: !!eu,
  });

  // Campanha e ponto de partida iniciais.
  const iniciou = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: escolhe a campanha só uma vez, quando a lista chega
  useEffect(() => {
    if (iniciou.current || !campanhas.data) return;
    iniciou.current = true;
    const ativa = campanhas.data.find((c) => c.status === 'ativa') ?? campanhas.data[0];
    if (ativa) mudar({ campanhaId: ativa.id });
  }, [campanhas.data]);
  useEffect(() => {
    if (partida || !partidas.data) return;
    const base = partidas.data[0];
    if (base) setPartida({ rotulo: base.rotulo, lat: base.lat, lng: base.lng });
    else setModoPartida('local');
  }, [partidas.data, partida]);

  const config = (): ConfigRoteiroEntrada | null =>
    partida ? { ...aj, vendedorId: vendedor, dia, partida, maxParadas: 20 } : null;

  const recalcular = useMutation({
    mutationFn: (p: { ids: number[]; otimizar: boolean; cfg?: ConfigRoteiroEntrada }) =>
      api<PlanoRua>('/rua/recalcular', {
        metodo: 'POST',
        corpo: { config: p.cfg ?? config(), empresaIds: p.ids, otimizar: p.otimizar },
      }),
    onSuccess: setPlano,
  });

  // Roteiro já salvo para a pessoa no dia: abre como estava.
  const aberto = useRef('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: abre o roteiro salvo só quando muda a pessoa, o dia ou o roteiro
  useEffect(() => {
    if (salvo.isLoading) return;
    const chave = `${vendedor}|${dia}|${salvo.data?.id ?? 0}`;
    if (aberto.current === chave) return;
    aberto.current = chave;
    setAviso(null);
    const r = salvo.data;
    if (!r) {
      setPlano(null);
      return;
    }
    const novos: Ajustes = {
      campanhaId: r.campanhaId,
      faixas: r.filtros.faixas ?? PADRAO.faixas,
      situacoes: r.filtros.situacoes ?? PADRAO.situacoes,
      inicio: r.inicio,
      fim: r.fim,
      minutosVisita: r.minutosVisita,
      almoco: r.almoco,
      raioKm: r.filtros.raioKm ?? PADRAO.raioKm,
    };
    setAj(novos);
    setPartida(r.partida);
    setModoPartida('base');
    recalcular.mutate({
      ids: r.paradas.map((p) => p.empresaId),
      otimizar: false,
      cfg: { ...novos, vendedorId: vendedor, dia, partida: r.partida },
    });
  }, [salvo.data, salvo.isLoading, vendedor, dia]);

  const sugerir = useMutation({
    mutationFn: () => api<PlanoRua>('/rua/sugerir', { metodo: 'POST', corpo: config() }),
    onSuccess: (p) => {
      setPlano(p);
      setAviso(
        p.paradas.length
          ? null
          : 'Nenhum lead com esses filtros cabe no dia. Aumente a distância, inclua outras notas ou outra situação.',
      );
    },
  });

  const salvar = useMutation({
    mutationFn: (enviar: boolean) =>
      api<RoteiroRua>('/rua/roteiros', {
        metodo: 'PUT',
        corpo: { config: config(), empresaIds: plano?.paradas.map((p) => p.empresaId) ?? [], enviar },
      }),
    onSuccess: (r, enviar) => {
      cliente.setQueryData(['rua', 'roteiro', vendedor, dia], r);
      aberto.current = `${vendedor}|${dia}|${r.id}`;
      cliente.invalidateQueries({ queryKey: ['rua', 'hoje'] });
      cliente.invalidateQueries({ queryKey: ['rua', 'equipe'] });
      setAviso(
        enviar
          ? `Roteiro enviado: ${primeiroNome(r.vendedorNome)} recebe o aviso no celular e abre em Vendas › Na rua.`
          : 'Roteiro salvo. No celular, ele aparece em Vendas › Na rua.',
      );
    },
  });

  const localizar = useMutation({
    mutationFn: async () => {
      const p = await localizacaoAgora();
      if (!p)
        throw new ErroApi(
          0,
          'sem_local',
          'Não consegui a sua localização. Libere a localização no navegador.',
        );
      return { rotulo: 'Minha localização', lat: p.lat, lng: p.lng };
    },
    onSuccess: setPartida,
  });
  const buscarEndereco = useMutation({
    mutationFn: () => api<Partida>('/rua/endereco', { metodo: 'POST', corpo: { endereco } }),
    onSuccess: setPartida,
  });
  // O endereço digitado vira uma base da empresa (o ponto de partida padrão de todos).
  const guardarBase = useMutation({
    mutationFn: (p: Partida) =>
      api('/bases', {
        metodo: 'POST',
        corpo: { nome: p.rotulo.slice(0, 80), endereco: p.rotulo, lat: p.lat, lng: p.lng },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['rua', 'partidas'] });
      setModoPartida('base');
    },
  });

  const ids = plano?.paradas.map((p) => p.empresaId) ?? [];
  const noRoteiro = new Set(ids);
  const mexer = (novos: number[], otimizar = false) => recalcular.mutate({ ids: novos, otimizar });
  const mover = (i: number, d: -1 | 1) => {
    const n = [...ids];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x!);
    mexer(n);
  };

  // Leads do mapa: os que entram pelos filtros mais fortes; os outros, apagados.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refaz quando o roteiro (plano) muda
  const fundo = useMemo<PontoFundo[]>(() => {
    const faixas = new Set<Faixa>(aj.faixas);
    const sit = new Set<string>(aj.situacoes);
    return (pontos.data?.leads ?? []).map((l) => ({
      id: l.empresaId,
      nome: nomeBonito(l.nome),
      lat: l.lat,
      lng: l.lng,
      faixa: l.faixa,
      noRoteiro: noRoteiro.has(l.empresaId),
      apagado:
        !!l.emOutroRoteiro ||
        l.situacao === 'fora' ||
        !sit.has(l.situacao) ||
        !faixas.has(l.faixa ?? 'C') ||
        (partida ? haversineKm(partida, l) > aj.raioKm : false),
    }));
  }, [pontos.data, aj.faixas, aj.situacoes, aj.raioKm, partida, plano]);

  const adicionarDoMapa = (id: number) => {
    if (noRoteiro.has(id) || !partida) return;
    const l = pontos.data?.leads.find((x) => x.empresaId === id);
    if (l?.emOutroRoteiro) {
      setAviso(`${nomeBonito(l.nome)} já está no roteiro de ${l.emOutroRoteiro} neste dia.`);
      return;
    }
    mexer([...ids, id]);
  };

  const vendedores = (equipe.data?.usuarios ?? []).filter((u) => u.ativo);
  const nomeVendedor = vendedores.find((u) => u.id === vendedor)?.nome ?? sessao.data?.nome ?? '';
  const ocupado = sugerir.isPending || recalcular.isPending || salvar.isPending;
  const salvoIds = salvo.data?.paradas.map((p) => p.empresaId).join(',') ?? '';
  const mudouDesdeSalvo = !!plano && ids.join(',') !== salvoIds;
  const paradas = plano?.paradas ?? [];
  const ultima = paradas[paradas.length - 1];
  const googleMaps = partida && ultima ? linkGoogleMaps(ultima, partida, paradas.slice(0, -1)) : null;
  const erro =
    sugerir.error ??
    recalcular.error ??
    salvar.error ??
    localizar.error ??
    buscarEndereco.error ??
    guardarBase.error;

  return (
    <div className="rua-planejar">
      <section className="rua-filtros" aria-label="Quais leads entram">
        <div className="rua-linha2">
          {admin && vendedores.length > 1 && (
            <label className="rua-campo">
              <span className="rotulo-campo">Roteiro de</span>
              <select
                className="filtro"
                value={vendedor}
                onChange={(e) => setVendedorId(Number(e.target.value))}
              >
                {vendedores.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                    {u.id === eu ? ' (você)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="rua-campo">
            <span className="rotulo-campo">Dia</span>
            <input
              className="filtro"
              type="date"
              value={dia}
              onChange={(e) => e.target.value && setDia(e.target.value)}
            />
          </label>
        </div>

        <h2 className="rua-h2">Quais leads entram</h2>
        <label className="rua-campo">
          <span className="rotulo-campo">Campanha</span>
          <select
            className="filtro"
            value={aj.campanhaId ?? ''}
            onChange={(e) => mudar({ campanhaId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Todas as campanhas</option>
            {(campanhas.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="rua-campo">
          <legend className="rotulo-campo">Nota</legend>
          <div className="rua-chips">
            {(['A', 'B', 'C'] as const).map((f) => (
              <Chip
                key={f}
                ativo={aj.faixas.includes(f)}
                onClick={() =>
                  mudar({
                    faixas: aj.faixas.includes(f) ? aj.faixas.filter((x) => x !== f) : [...aj.faixas, f],
                  })
                }
              >
                <ScoreBadge faixa={f} />
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset className="rua-campo">
          <legend className="rotulo-campo">Situação</legend>
          <div className="rua-chips">
            {SITUACOES_RUA.map((s: SituacaoRua) => (
              <Chip
                key={s}
                ativo={aj.situacoes.includes(s)}
                onClick={() =>
                  mudar({
                    situacoes: aj.situacoes.includes(s)
                      ? aj.situacoes.filter((x) => x !== s)
                      : [...aj.situacoes, s],
                  })
                }
              >
                {ROTULO_SITUACAO_RUA[s]}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset className="rua-campo">
          <legend className="rotulo-campo">Ponto de partida</legend>
          {!!partidas.data?.length && (
            <label className="rua-opcao">
              <input
                type="radio"
                name="partida"
                checked={modoPartida === 'base'}
                onChange={() => {
                  setModoPartida('base');
                  const b = partidas.data?.[0];
                  if (b) setPartida({ rotulo: b.rotulo, lat: b.lat, lng: b.lng });
                }}
              />
              <span className="rua-opcao__txt">
                Base da empresa
                {modoPartida === 'base' && partidas.data.length > 1 && (
                  <select
                    className="filtro rua-sub"
                    value={partida?.rotulo ?? ''}
                    onChange={(e) => {
                      const b = partidas.data?.find((x) => x.rotulo === e.target.value);
                      if (b) setPartida({ rotulo: b.rotulo, lat: b.lat, lng: b.lng });
                    }}
                  >
                    {partidas.data.map((b) => (
                      <option key={b.rotulo}>{b.rotulo}</option>
                    ))}
                  </select>
                )}
                {modoPartida === 'base' && partidas.data.length === 1 && (
                  <span className="quieto rua-sub">{partidas.data[0]!.rotulo}</span>
                )}
              </span>
            </label>
          )}
          <label className="rua-opcao">
            <input
              type="radio"
              name="partida"
              checked={modoPartida === 'local'}
              onChange={() => {
                setModoPartida('local');
                localizar.mutate();
              }}
            />
            <span className="rua-opcao__txt">
              Minha localização agora
              {modoPartida === 'local' && (
                <span className="quieto rua-sub">
                  {localizar.isPending
                    ? 'Localizando…'
                    : partida?.rotulo === 'Minha localização'
                      ? 'Pronto'
                      : ''}
                </span>
              )}
            </span>
          </label>
          {estado.data?.enderecos !== false && (
            <label className="rua-opcao">
              <input
                type="radio"
                name="partida"
                checked={modoPartida === 'endereco'}
                onChange={() => setModoPartida('endereco')}
              />
              <span className="rua-opcao__txt">Outro endereço</span>
            </label>
          )}
          {modoPartida === 'endereco' && (
            <form
              className="rua-endereco"
              onSubmit={(e) => {
                e.preventDefault();
                if (endereco.trim().length >= 4) buscarEndereco.mutate();
              }}
            >
              <label className="pp-sr" htmlFor="rua-endereco">
                Endereço de saída
              </label>
              <input
                id="rua-endereco"
                className="filtro"
                placeholder="Rua, número, bairro, cidade"
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
              />
              <Button size="sm" type="submit" disabled={buscarEndereco.isPending}>
                {buscarEndereco.isPending ? 'Buscando…' : 'Usar'}
              </Button>
            </form>
          )}
          {partida && (
            <span className="rua-partida-atual">
              <Icon name="map-pin" size={14} /> Saída: {partida.rotulo}
            </span>
          )}
          {admin &&
            partida &&
            modoPartida === 'endereco' &&
            !partidas.data?.some((x) => x.rotulo === partida.rotulo) && (
              <button
                type="button"
                className="rua-link-pequeno rua-link-esquerda"
                disabled={guardarBase.isPending}
                onClick={() => guardarBase.mutate(partida)}
              >
                {guardarBase.isPending ? 'Guardando…' : 'Guardar como base da empresa'}
              </button>
            )}
        </fieldset>

        <div className="rua-grade2">
          <label className="rua-campo">
            <span className="rotulo-campo">Começa</span>
            <input
              className="filtro"
              type="time"
              value={aj.inicio}
              onChange={(e) => mudar({ inicio: e.target.value })}
            />
          </label>
          <label className="rua-campo">
            <span className="rotulo-campo">Termina</span>
            <input
              className="filtro"
              type="time"
              value={aj.fim}
              onChange={(e) => mudar({ fim: e.target.value })}
            />
          </label>
          <label className="rua-campo">
            <span className="rotulo-campo">Em cada visita</span>
            <select
              className="filtro"
              value={aj.minutosVisita}
              onChange={(e) => mudar({ minutosVisita: Number(e.target.value) })}
            >
              {TEMPOS_VISITA.map((m) => (
                <option key={m} value={m}>
                  {fmtMinutos(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="rua-campo">
            <span className="rotulo-campo">Almoço</span>
            <select
              className="filtro"
              value={aj.almoco ? `${aj.almoco.inicio}|${aj.almoco.minutos}` : ''}
              onChange={(e) => {
                const [inicio, minutos] = e.target.value.split('|');
                mudar({ almoco: inicio ? { inicio, minutos: Number(minutos) } : null });
              }}
            >
              <option value="">Sem pausa</option>
              <option value="11:30|60">11:30, 1 h</option>
              <option value="12:00|60">12:00, 1 h</option>
              <option value="12:00|90">12:00, 1 h 30</option>
              <option value="12:30|60">12:30, 1 h</option>
              <option value="13:00|60">13:00, 1 h</option>
            </select>
          </label>
          <label className="rua-campo">
            <span className="rotulo-campo">Distância máxima</span>
            <select
              className="filtro"
              value={aj.raioKm}
              onChange={(e) => mudar({ raioKm: Number(e.target.value) })}
            >
              {RAIOS.map((r) => (
                <option key={r} value={r}>
                  até {r} km da saída
                </option>
              ))}
            </select>
          </label>
        </div>

        <Button
          variant="primary"
          icon="route"
          disabled={!partida || ocupado || !aj.faixas.length || !aj.situacoes.length}
          onClick={() => sugerir.mutate()}
        >
          {sugerir.isPending ? 'Montando o dia…' : 'Sugerir roteiro do dia'}
        </Button>
        {!partida && (
          <span className="quieto rua-dica">Escolha de onde o vendedor sai para montar o dia.</span>
        )}
        {!!pontos.data?.semLocalizacao && (
          <span className="quieto rua-dica">
            {pontos.data.semLocalizacao} {pontos.data.semLocalizacao === 1 ? 'lead' : 'leads'} desta campanha
            ainda sem endereço no mapa (não entram no roteiro).
          </span>
        )}
      </section>

      <section className="rua-mapa-area" aria-label="Mapa">
        <MapaRua
          rotulo="Mapa com os leads da campanha e o roteiro do dia"
          partida={partida}
          fundo={fundo}
          paradas={paradas.map((p) => ({
            id: p.empresaId,
            ordem: p.ordem,
            nome: nomeBonito(p.nome),
            lat: p.lat,
            lng: p.lng,
          }))}
          tracado={plano?.tracado}
          aoEscolher={adicionarDoMapa}
        />
        <div className="rua-legenda" aria-hidden="true">
          <span className="rua-legenda__item">
            <i data-faixa="A" /> Nota A
          </span>
          <span className="rua-legenda__item">
            <i data-faixa="B" /> Nota B
          </span>
          <span className="rua-legenda__item">
            <i data-faixa="C" /> Nota C
          </span>
          <span className="rua-legenda__item quieto">Clique num lead para pôr no roteiro</span>
        </div>
      </section>

      <section className="rua-lista-area" aria-label="Roteiro do dia">
        <div className="rua-lista-topo">
          <h2 className="rua-h2">Roteiro de {fmtDiaCurto(dia)}</h2>
          {admin && vendedor !== eu && <span className="quieto">{nomeVendedor}</span>}
        </div>

        {paradas.length > 0 && plano && (
          <dl className="rua-resumo">
            <div>
              <dt>Visitas</dt>
              <dd className="mono">{paradas.length}</dd>
            </div>
            <div>
              <dt>Distância</dt>
              <dd className="mono">{plano.km.toLocaleString('pt-BR')} km</dd>
            </div>
            <div>
              <dt>Dirigindo</dt>
              <dd className="mono">{fmtMinutos(plano.minutosRota)}</dd>
            </div>
            <div>
              <dt>Termina</dt>
              <dd className="mono" data-alerta={plano.passouDoHorario || undefined}>
                {plano.termino}
              </dd>
            </div>
          </dl>
        )}

        <ErroDaApi erro={erro} />
        {aviso && <Mensagem tipo={aviso.startsWith('Roteiro') ? 'ok' : 'aviso'}>{aviso}</Mensagem>}
        {plano?.passouDoHorario && (
          <Mensagem tipo="aviso">
            O dia passa do horário de término. Tire uma visita ou comece mais cedo.
          </Mensagem>
        )}
        {plano && plano.calculo === 'estimado' && paradas.length > 0 && (
          <p className="quieto rua-dica">
            Tempos estimados pela distância (o cálculo pelas ruas não está ligado ou não respondeu).
          </p>
        )}

        {!paradas.length ? (
          <EmptyState
            icone="route"
            titulo={salvo.isLoading || recalcular.isPending ? 'Abrindo o roteiro…' : 'Nenhuma visita ainda'}
            texto="Use Sugerir roteiro do dia, ou clique nos leads do mapa para montar à mão."
          />
        ) : (
          <ol className="rua-paradas" aria-busy={recalcular.isPending}>
            {paradas.map((p, i) => (
              <li key={p.empresaId} className="rua-parada">
                {p.almocoAntes && plano?.inicio && (
                  <div className="rua-almoco">
                    <Icon name="clock" size={14} /> Almoço
                  </div>
                )}
                <div className="rua-parada__linha">
                  <span className="rua-num">{p.ordem}</span>
                  <div className="rua-parada__txt">
                    <b>{nomeBonito(p.nome)}</b>
                    <span className="quieto rua-parada__sub">
                      <span className="mono">{p.chegada}</span>
                      {p.bairro ? ` · ${nomeBonito(p.bairro)}` : ''}
                      {` · ${p.kmTrecho.toLocaleString('pt-BR')} km`}
                    </span>
                  </div>
                  {p.faixa && <ScoreBadge faixa={p.faixa} score={p.score ?? undefined} />}
                  <div className="rua-parada__acoes">
                    <button
                      type="button"
                      className="rua-icone"
                      aria-label={`Subir ${nomeBonito(p.nome)}`}
                      disabled={i === 0 || ocupado}
                      onClick={() => mover(i, -1)}
                    >
                      <Icon name="arrow-up" size={16} />
                    </button>
                    <button
                      type="button"
                      className="rua-icone"
                      aria-label={`Descer ${nomeBonito(p.nome)}`}
                      disabled={i === paradas.length - 1 || ocupado}
                      onClick={() => mover(i, 1)}
                    >
                      <Icon name="arrow-down" size={16} />
                    </button>
                    <button
                      type="button"
                      className="rua-icone"
                      aria-label={`Tirar ${nomeBonito(p.nome)} do roteiro`}
                      disabled={ocupado}
                      onClick={() => mexer(ids.filter((x) => x !== p.empresaId))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {plano && plano.foraDoDia > 0 && plano.candidatos > 0 && (
          <p className="quieto rua-dica">
            {plano.candidatos} leads atendem aos filtros; os {paradas.length} melhores couberam no dia.
          </p>
        )}

        {paradas.length > 0 && (
          <div className="rua-lista-acoes">
            <Button
              variant="primary"
              icon="smartphone"
              disabled={ocupado || !partida}
              onClick={() => salvar.mutate(vendedor !== eu)}
            >
              {salvar.isPending
                ? 'Salvando…'
                : vendedor !== eu
                  ? `Mandar para o celular de ${primeiroNome(nomeVendedor)}`
                  : mudouDesdeSalvo || !salvo.data
                    ? 'Salvar roteiro'
                    : 'Salvo'}
            </Button>
            <div className="rua-lista-acoes__linha">
              <Button icon="route" disabled={ocupado || paradas.length < 3} onClick={() => mexer(ids, true)}>
                Otimizar a ordem
              </Button>
              {googleMaps && (
                <Button
                  variant="ghost"
                  iconRight="external-link"
                  href={googleMaps}
                  target="_blank"
                  rel="noopener"
                >
                  Google Maps
                </Button>
              )}
            </div>
            {mudouDesdeSalvo && salvo.data && (
              <span className="quieto rua-dica">Há mudanças ainda não salvas.</span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
