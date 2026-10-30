import { campanhaEntrada } from '@prospeccao/shared/dominio';
import { Badge, Button, EmptyState, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type Campanha, type Nicho } from '../api';
import { Modal } from '../componentes/Drawer';
import { CampoLista, ErroDaApi, Mensagem } from '../componentes/Formulario';
import { EstimativaBusca, PainelPlaces, ResumoPlacesCampanha } from '../componentes/GooglePlaces';
import { ImportarLeads } from '../componentes/ImportarLeads';
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
    limiteLeads: '300',
    maxPorBusca: '120',
  });
  const [ajustes, setAjustes] = useState(false);
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
    <Modal
      titulo="Nova campanha"
      subtitulo="Escolha o nicho e as cidades. Ao iniciar, o sistema busca as empresas na Receita e no Google Maps e enriquece cada lead."
      aoFechar={aoFechar}
      rodape={
        <>
          {(erroLocal || criar.error) && (
            <div className="modal__erro">
              {erroLocal ? <Mensagem tipo="erro">{erroLocal}</Mensagem> : <ErroDaApi erro={criar.error} />}
            </div>
          )}
          <Button
            variant="primary"
            type="submit"
            form="form-campanha"
            icon="check"
            disabled={criar.isPending}
          >
            {criar.isPending ? 'Criando…' : 'Criar campanha'}
          </Button>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
        </>
      }
    >
      <form id="form-campanha" className="form" onSubmit={enviar} noValidate>
        <TextField
          rotulo="Nome da campanha"
          value={f.nome}
          onChange={mudar('nome')}
          placeholder="Ex.: Clínicas odontológicas · Salvador e região"
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
            <span className="campo__erro">
              Cadastre um nicho antes, na tela <Link to="/nichos">Nichos</Link>.
            </span>
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
        <TextField
          rotulo="Quantos leads você quer"
          inputMode="numeric"
          value={f.limiteLeads}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setF({ ...f, limiteLeads: e.target.value.replace(/\D/g, '') })
          }
          placeholder="Todos que encontrar"
          dica="A campanha para de buscar no Google quando já tem leads suficientes e só enriquece essa quantidade, começando pelos achados no Google com mais avaliações. Em branco, traz todos. Dá para aumentar depois."
        />
        <div>
          <button
            type="button"
            className="link-botao"
            aria-expanded={ajustes}
            onClick={() => setAjustes(!ajustes)}
          >
            {ajustes ? 'Esconder ajustes da busca' : 'Ajustes da busca no Google'}
          </button>
        </div>
        {ajustes && (
          <TextField
            rotulo="Lugares por busca no Google Maps"
            inputMode="numeric"
            value={f.maxPorBusca}
            onChange={mudar('maxPorBusca')}
            dica="Quantos lugares cada pesquisa traz: 20 por página, até 3 páginas (60). Com 60 ou mais, a cidade que enche é dividida por bairro para achar mais."
          />
        )}
        <div className="nota-campanha">
          <b>E a abordagem?</b>
          <span>
            A campanha só encontra e qualifica os leads. Quem fala com eles é configurado à parte: o{' '}
            <Link to="/agente">Agente</Link> (WhatsApp e limite por chip), o <Link to="/email">E-mail</Link>{' '}
            (sequências) e o <Link to="/funil">Funil</Link> (cadência de follow-up).
          </span>
        </div>
      </form>
    </Modal>
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

/** "≈ 12 min" no ritmo atual (null: sem ritmo medido ainda). */
function tempoRestante(faltam: number, porMinuto: number): string | null {
  if (faltam <= 0 || porMinuto <= 0) return null;
  const min = Math.ceil(faltam / porMinuto);
  if (min <= 1) return 'menos de 1 min';
  if (min < 60) return `≈ ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `≈ ${h} h${resto ? ` ${resto} min` : ''}`;
}

/**
 * Onde a campanha está: uma barra geral com o tempo estimado e, embaixo, cada etapa (buscas no
 * Google e enriquecimento) com a sua barra até 100%. Se parou, diz por quê e o que fazer.
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
  const pelaMeta = c.progresso.buscasPelaMeta ?? 0;
  const noTeto = p.buscasBloqueadas - pelaMeta > 0;
  // Com meta, o alvo do enriquecimento é a meta (ou menos, se a busca achou menos).
  const alvo = c.limiteLeads != null ? Math.min(p.elegiveis, c.limiteLeads) : p.elegiveis;
  const paradas = ativa ? p.buscasParadas : 0;
  const buscando = ativa && p.buscasPendentes > paradas;
  const enriquecendo = p.naFilaEnriquecimento > 0;
  const servico = p.servicoEnriquecimento;

  // Progresso geral: buscas valem 30%, enriquecimento 70%. Busca que parou na meta ou com erro
  // já terminou o que tinha para fazer.
  const buscasFeitas = p.buscasConcluidas + p.buscasComErro + pelaMeta;
  const fracBuscas = buscasTotal ? Math.min(1, buscasFeitas / buscasTotal) : 0;
  const fracEnriq = alvo ? Math.min(1, p.enriquecidos / alvo) : 0;
  const iniciou = buscasTotal > 0 || alvo > 0;
  const geral = Math.round((0.3 * fracBuscas + 0.7 * fracEnriq) * 100);
  const concluida = iniciou && fracBuscas >= 1 && (alvo === 0 || fracEnriq >= 1);
  const faltamBuscas = Math.max(0, buscasTotal - buscasFeitas);
  const faltamLeads = Math.max(0, alvo - p.enriquecidos);
  const ritmoBuscas = c.progresso.ritmoBuscas ?? 0;
  const ritmoEnriq = c.progresso.ritmoEnriquecimento ?? 0;
  const restoBuscas = buscando ? tempoRestante(faltamBuscas, ritmoBuscas) : null;
  const restoEnriq = enriquecendo ? tempoRestante(faltamLeads, ritmoEnriq) : null;
  // Tempo geral: o que falta das buscas no ritmo das buscas + o que falta enriquecer no ritmo do
  // enriquecimento. Sem ritmo medido ainda (começou agora), "calculando".
  let restoGeral: string | null = null;
  if (ativa && !concluida && (buscando || enriquecendo)) {
    const precisaBuscas = buscando && faltamBuscas > 0;
    const precisaLeads = faltamLeads > 0;
    const semRitmo = (precisaBuscas && ritmoBuscas <= 0) || (precisaLeads && ritmoEnriq <= 0);
    const minutos =
      (precisaBuscas ? faltamBuscas / Math.max(ritmoBuscas, 1e-9) : 0) +
      (precisaLeads ? faltamLeads / Math.max(ritmoEnriq, 1e-9) : 0);
    restoGeral = semRitmo ? 'calculando o tempo…' : tempoRestante(minutos, 1);
  }

  return (
    <div className="andamento-campanha">
      {/* Progresso geral */}
      <div className="etapa-campanha etapa-campanha--geral">
        <div className="etapa-campanha__topo">
          <b>
            {(buscando || enriquecendo) && <span className="vivo" aria-hidden="true" />}
            {concluida ? 'Concluída' : !iniciou ? 'Ainda não começou' : ativa ? 'Em andamento' : 'Pausada'}
          </b>
          <span className="mono">{iniciou ? `${concluida ? 100 : geral}%` : '—'}</span>
        </div>
        <Barra feito={concluida ? 100 : geral} total={100} rotulo="Progresso da campanha" />
        <p className="quieto">
          {concluida
            ? `${fmtNumero(p.enriquecidos)} leads prontos para abordar.`
            : restoGeral
              ? restoGeral === 'calculando o tempo…'
                ? 'Calculando o tempo que falta…'
                : `Falta ${restoGeral} no ritmo atual.`
              : !iniciou
                ? 'Clique em "Iniciar busca" para começar.'
                : 'Acompanhe cada etapa abaixo.'}
        </p>
      </div>
      {master && p.ufsForaDaBase.length > 0 && (
        <p className="aviso-texto">
          Base da Receita sem {p.ufsForaDaBase.join(', ')}: o CNPJ dessas empresas é conferido no
          enriquecimento (site, Google e BrasilAPI). Para cruzar já na busca, importe de novo em{' '}
          <Link to="/base-cnpj">Base CNPJ</Link> com esses estados em CNPJ_UFS_EXTRAS.
        </p>
      )}

      {/* 2. Google Maps */}
      <div className="etapa-campanha">
        <div className="etapa-campanha__topo">
          <b>{buscando && <span className="vivo" aria-hidden="true" />} 1. Busca no Google</b>
          <span className="mono">
            {buscasTotal ? `${fmtNumero(buscasFeitas)} de ${fmtNumero(buscasTotal)} buscas` : '—'}
          </span>
        </div>
        <Barra feito={buscasFeitas} total={Math.max(1, buscasTotal)} rotulo="Buscas no Google" />
        {master && <ResumoPlacesCampanha c={c} />}
        {noTeto ? (
          <div className="etapa-campanha__erro">
            <p className="erro-texto">
              {fmtNumero(p.buscasBloqueadas - pelaMeta)}{' '}
              {p.buscasBloqueadas - pelaMeta === 1 ? 'busca parada' : 'buscas paradas'}{' '}
              {master
                ? `no teto. ${p.erroBusca ?? ''}`
                : 'no limite de uso do Google desta conta. Fale com o suporte do Prospect Team para liberar.'}
            </p>
            {master && c.status !== 'encerrada' && (
              <Button size="sm" disabled={props.ocupado} onClick={props.aoTentarDeNovo}>
                Ajustar teto e retomar
              </Button>
            )}
          </div>
        ) : p.erroBusca || paradas > 0 ? (
          <div className="etapa-campanha__erro">
            <p className="erro-texto">
              {paradas > 0 && `${fmtNumero(paradas)} ${paradas === 1 ? 'busca parada' : 'buscas paradas'}. `}
              {p.erroBusca
                ? master
                  ? p.erroBusca
                  : 'A busca no Google teve um problema. Nosso suporte já foi avisado; você pode tentar de novo.'
                : 'Ela não está mais na fila: clique em "Tentar de novo".'}
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
                ? `${fmtNumero(p.buscasPendentes - paradas)} em andamento · ${fmtNumero(p.noMaps)} lugares até agora${restoBuscas ? ` · falta ${restoBuscas}` : ''}.`
                : pelaMeta > 0
                  ? `Meta de leads atingida: ${fmtNumero(pelaMeta)} ${pelaMeta === 1 ? 'busca parou' : 'buscas pararam'} antes, sem gastar no Google. Se aumentar a meta, elas continuam.`
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
            {enriquecendo && servico === 'rodando' && <span className="vivo" aria-hidden="true" />} 2.
            Enriquecimento
          </b>
          <span className="mono">
            {fmtNumero(p.enriquecidos)} de {fmtNumero(alvo)} leads
          </span>
        </div>
        <Barra feito={p.enriquecidos} total={Math.max(1, alvo)} rotulo="Leads enriquecidos" />
        {alvo > 0 && (
          <p className="quieto">
            Contatos, nota e CNPJ conferido na Receita · {fmtNumero(p.comCnpj)} com CNPJ
            {restoEnriq ? ` · falta ${restoEnriq}` : ''}
          </p>
        )}
        {(c.progresso.incompletos ?? 0) > 0 && (
          <p className="aviso-texto">
            {fmtNumero(c.progresso.incompletos ?? 0)} enriquecidos em parte: alguma fonte (Instagram,
            Receita…) não respondeu. O que foi achado ficou; use "Refazer enriquecimento" → "Só os
            incompletos" mais tarde.
          </p>
        )}
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
            <p className="quieto">{fmtNumero(p.naFilaEnriquecimento)} na fila ou sendo enriquecidos agora.</p>
            <Button size="sm" variant="danger" disabled={props.ocupado} onClick={props.aoParar}>
              Parar enriquecimento
            </Button>
          </div>
        ) : (
          <p className="quieto">
            {alvo === 0
              ? 'Começa quando as buscas encontrarem leads.'
              : p.enriquecidos >= alvo
                ? c.limiteLeads != null && p.enriquecidos >= c.limiteLeads
                  ? 'Meta de leads completa.'
                  : 'Todos os leads enriquecidos.'
                : buscando
                  ? 'Começa quando as buscas no Maps terminarem.'
                  : 'Nada na fila. Use "Refazer enriquecimento" para enriquecer os que faltam.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Lista importada: não busca nada; só o enriquecimento (quando o cliente pediu) tem andamento. */
function EnriquecimentoDaLista(props: { c: Campanha; aoParar: () => void; ocupado: boolean }) {
  const p = props.c.progresso;
  const enriquecidos = p.enriquecidos ?? 0;
  const naFila = p.naFilaEnriquecimento ?? 0;
  const total = enriquecidos + naFila;
  if (!total)
    return (
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        {props.c.tipo === 'manual'
          ? 'Leads que a equipe cadastrou ou que chegaram pelo WhatsApp.'
          : 'Leads trazidos do seu arquivo.'}{' '}
        Para buscar site, Instagram, CNPJ e sócios deles, use "Enriquecer".
      </p>
    );
  return (
    <div className="andamento-campanha">
      <div className="etapa-campanha">
        <div className="etapa-campanha__topo">
          <b>{naFila > 0 && <span className="vivo" aria-hidden="true" />} Enriquecimento</b>
          <span className="mono">
            {fmtNumero(enriquecidos)} de {fmtNumero(total)} leads
          </span>
        </div>
        <Barra feito={enriquecidos} total={Math.max(1, total)} rotulo="Leads enriquecidos" />
        {naFila > 0 ? (
          <div className="etapa-campanha__erro">
            <p className="quieto">{fmtNumero(naFila)} na fila ou sendo enriquecidos agora.</p>
            <Button size="sm" variant="danger" disabled={props.ocupado} onClick={props.aoParar}>
              Parar enriquecimento
            </Button>
          </div>
        ) : (
          <p className="quieto">
            Todos os leads enriquecidos · {fmtNumero(p.comCnpj)} com CNPJ
            {(p.incompletos ?? 0) > 0
              ? ` · ${fmtNumero(p.incompletos ?? 0)} em parte (use "Refazer" → "Só os incompletos")`
              : ''}
            .
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Meta de leads no cartão. "Buscar mais" soma à meta: a busca no Google continua de onde parou e
 * só empresas novas (nunca mandadas para o enriquecimento nesta nem em outra campanha) entram.
 */
function MetaLeads({ c }: { c: Campanha }) {
  const cliente = useQueryClient();
  const [modo, setModo] = useState<'ver' | 'mais' | 'alterar'>('ver');
  const [valor, setValor] = useState('');
  const meta = c.limiteLeads ?? null;
  const reservados = c.progresso.reservados ?? 0;
  const salvar = useMutation({
    mutationFn: (limiteLeads: number | null) =>
      api<Campanha>(`/campanhas/${c.id}`, { metodo: 'PATCH', corpo: { limiteLeads } }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
      setModo('ver');
    },
  });
  const abrir = (m: 'mais' | 'alterar') => {
    setValor(m === 'mais' ? '300' : meta != null ? String(meta) : '');
    setModo(m);
  };
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(valor);
    if (modo === 'mais') {
      if (n > 0) salvar.mutate(Math.max(meta ?? 0, reservados) + n);
    } else salvar.mutate(valor ? n : null);
  };

  if (modo === 'ver')
    return (
      <div className="meta-leads">
        <span>
          {meta != null ? (
            <>
              Meta: <b>{fmtNumero(meta)} leads</b> · {fmtNumero(Math.min(reservados, meta))} já enviados para
              enriquecer
            </>
          ) : (
            'Sem meta: todos os leads que encontrar'
          )}
        </span>
        {c.status !== 'encerrada' && (
          <span className="meta-leads__acoes">
            {meta != null && (
              <Button size="sm" variant="secondary" icon="plus" onClick={() => abrir('mais')}>
                Buscar mais leads
              </Button>
            )}
            <button type="button" className="link-botao" onClick={() => abrir('alterar')}>
              {meta != null ? 'Alterar meta' : 'Definir meta'}
            </button>
          </span>
        )}
      </div>
    );
  return (
    <form className="meta-leads meta-leads--editando" onSubmit={enviar}>
      <label htmlFor={`meta-${c.id}`}>
        {modo === 'mais' ? 'Quantos leads novos a mais' : 'Meta de leads'}
      </label>
      <input
        id={`meta-${c.id}`}
        className="filtro"
        inputMode="numeric"
        placeholder={modo === 'mais' ? '300' : 'Todos'}
        value={valor}
        onChange={(e) => setValor(e.target.value.replace(/\D/g, ''))}
      />
      <Button size="sm" variant="primary" type="submit" disabled={salvar.isPending}>
        {modo === 'mais' ? 'Buscar' : 'Salvar'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setModo('ver')}>
        Cancelar
      </Button>
      {modo === 'mais' && (
        <span className="campo__dica meta-leads__dica">
          Só empresas novas: quem já foi enriquecido nesta ou em outra campanha não entra de novo nem gasta
          API.{c.status !== 'ativa' && ' Inicie a campanha para começar a buscar.'}
        </span>
      )}
      <ErroDaApi erro={salvar.error} />
    </form>
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
  const [importandoLeads, setImportandoLeads] = useState(false);
  const importada = !!c.tipo && c.tipo !== 'busca';
  const cidadesDaLista = c.cidades.filter((x) => x.cidade);
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
  const [escopo, setEscopo] = useState<'ab' | 'sem_decisor' | 'incompletos' | 'todos'>('ab');
  const previa = useQuery({
    queryKey: ['reenriquecer', c.id],
    queryFn: () =>
      api<{ ab: number; semDecisor: number; incompletos?: number; todos: number }>(
        `/campanhas/${c.id}/reenriquecer`,
      ),
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
    {
      id: 'incompletos' as const,
      rotulo: 'Só os incompletos',
      dica: 'Os que ficaram em parte (fonte fora do ar ou sem crédito). O que já foi achado fica.',
      n: previa.data?.incompletos,
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
            {importada
              ? `${c.nichoNome} · ${c.tipo === 'manual' ? 'cadastrados pela equipe e conversas do WhatsApp' : 'lista importada'}${
                  cidadesDaLista.length
                    ? ` · ${cidadesDaLista
                        .slice(0, 3)
                        .map((x) => `${x.cidade}/${x.uf}`)
                        .join(
                          ', ',
                        )}${cidadesDaLista.length > 3 ? ` e mais ${cidadesDaLista.length - 3}` : ''}`
                    : ''
                }`
              : `${c.nichoNome} · ${c.cidades.map((x) => `${x.cidade}/${x.uf}`).join(', ')}`}
            {!importada && c.raioKm != null && ` · até ${c.raioKm} km das bases`}
          </p>
          {!importada && <MetaLeads c={c} />}
        </div>
        <Badge tone={TOM_STATUS_CAMPANHA[c.status]}>{ROTULO_STATUS_CAMPANHA[c.status]}</Badge>
      </div>

      <div className="numeros">
        <div>
          <b>{fmtNumero(p.empresas)}</b>
          <span>leads</span>
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
      {importada ? (
        <EnriquecimentoDaLista c={c} aoParar={() => parar.mutate()} ocupado={parar.isPending} />
      ) : (
        <Andamento
          c={c}
          aoTentarDeNovo={() => (master ? setEstimando(true) : rodar.mutate(null))}
          aoParar={() => parar.mutate()}
          ocupado={acao.isPending || parar.isPending || rodar.isPending}
        />
      )}
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
        {!importada && (c.status === 'rascunho' || c.status === 'pausada') && (
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
        {!importada && c.status === 'ativa' && (
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
          <Button size="sm" variant="ghost" icon="file-text" onClick={() => setImportandoLeads(true)}>
            {importada ? 'Importar mais leads' : 'Importar lista de leads'}
          </Button>
        )}
        {!importada && c.status !== 'encerrada' && (
          <Button size="sm" variant="ghost" icon="map-pin" onClick={() => setImportando(true)}>
            Importar planilha do Maps
          </Button>
        )}
        {p.empresas > 0 && !confirmarRefazer && (
          <Button size="sm" variant="ghost" icon="loader" onClick={() => setConfirmarRefazer(true)}>
            {importada && !p.enriquecidos && !p.naFilaEnriquecimento
              ? 'Enriquecer'
              : 'Refazer enriquecimento'}
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
      {importandoLeads && <ImportarLeads campanha={c} aoFechar={() => setImportandoLeads(false)} />}
    </article>
  );
}

export function Campanhas() {
  const master = useEhMaster();
  const [criando, setCriando] = useState(false);
  const [importando, setImportando] = useState(false);
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
          <p>
            Cada campanha busca um nicho nas cidades que você escolher e entrega os leads já enriquecidos e
            com nota.
          </p>
        </div>
        <div className="acoes">
          <Button variant="ghost" icon="file-text" onClick={() => setImportando(true)}>
            Importar lista
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setCriando(true)}>
            Nova campanha
          </Button>
        </div>
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
      {importando && <ImportarLeads aoFechar={() => setImportando(false)} />}
    </>
  );
}
