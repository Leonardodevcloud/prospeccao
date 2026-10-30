import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  type ArquivoEmail,
  api,
  type Campanha,
  type CampanhaEmail,
  type CanalSequencia,
  type ClasseResposta,
  type ConfigEmail,
  type EnvioEmail,
  type ModeloEmail,
  type Nicho,
  type PassoSequencia,
  type PreviaEmail,
  type RespostaEmail,
  ROTULO_CLASSE,
  ROTULO_ETAPA,
  type VisaoEmail,
} from '../api';
import { DominioEmail } from '../componentes/DominioEmail';
import { Drawer } from '../componentes/Drawer';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useEhMaster, useSessao } from '../componentes/Sessao';
import { fmtCidade, fmtHora, fmtNome, fmtNumero, fmtPct, fmtQuando } from '../formatar';
import {
  EscolherLead,
  fmtTamanho,
  JanelaEmail,
  lerBase64,
  Marcas,
  PreviaCampanha,
  useMarcas,
} from './EmailMarca';

type Aba = 'campanhas' | 'modelos' | 'marca' | 'enviados' | 'respostas' | 'config';
const ABAS: { id: Aba; rotulo: string; admin?: boolean }[] = [
  { id: 'campanhas', rotulo: 'Sequências' },
  { id: 'respostas', rotulo: 'Respostas' },
  { id: 'enviados', rotulo: 'Enviados' },
  { id: 'modelos', rotulo: 'Modelos' },
  { id: 'marca', rotulo: 'Identidade visual' },
  { id: 'config', rotulo: 'Configuração', admin: true },
];

const TOM_CLASSE: Record<ClasseResposta, 'brand' | 'neutral' | 'danger' | 'outline'> = {
  interessado: 'brand',
  sem_interesse: 'neutral',
  descadastro: 'danger',
  automatica: 'outline',
};

const ROTULO_STATUS: Record<CampanhaEmail['status'], string> = {
  rascunho: 'Rascunho',
  enviando: 'Enviando',
  pausada: 'Pausada',
  concluida: 'Concluída',
};

export function useVisaoEmail() {
  return useQuery({ queryKey: ['email'], queryFn: () => api<VisaoEmail>('/email'), refetchInterval: 30_000 });
}

function useNichos() {
  return useQuery({ queryKey: ['nichos'], queryFn: () => api<Nicho[]>('/nichos'), staleTime: 60_000 });
}

/* ───────────────────────── Status (topo) ───────────────────────── */

function Status(props: { v: VisaoEmail; aoConfigurar: () => void }) {
  const { v } = props;
  const cliente = useQueryClient();
  const admin = useEhAdmin();
  const master = useEhMaster();
  const ligar = useMutation({
    mutationFn: (ligado: boolean) => api('/email/config', { metodo: 'PUT', corpo: { ...v.config, ligado } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['email'] }),
  });
  if (!v.status.resend)
    return (
      <Mensagem tipo="aviso">
        Para começar a enviar, cadastre o domínio de e-mail da sua empresa (leva poucos minutos).{' '}
        {admin ? (
          <button type="button" className="link-botao" onClick={props.aoConfigurar}>
            Cadastrar o domínio
          </button>
        ) : (
          'Peça a um administrador da sua conta.'
        )}
      </Mensagem>
    );
  return (
    <div className="status-email">
      <div className="status-email__item">
        <span className="quieto">Envio automático</span>
        {admin ? (
          <label className="interruptor">
            <input
              type="checkbox"
              checked={v.config.ligado}
              disabled={ligar.isPending}
              onChange={(e) => ligar.mutate(e.target.checked)}
            />
            <b>{v.config.ligado ? 'Ligado' : 'Desligado'}</b>
          </label>
        ) : (
          <b>{v.config.ligado ? 'Ligado' : 'Desligado'}</b>
        )}
      </div>
      <div className="status-email__item">
        <span className="quieto">Enviados hoje</span>
        <b className="mono">
          {fmtNumero(v.resumo.enviadosHoje)} / {fmtNumero(v.config.limiteDia)}
        </b>
      </div>
      <div className="status-email__item">
        <span className="quieto">Na fila</span>
        <b className="mono">{fmtNumero(v.resumo.naFila)}</b>
      </div>
      <div className="status-email__item">
        <span className="quieto">Remetente padrão</span>
        <b>{v.status.remetente}</b>
      </div>
      <div className="status-email__item">
        <span className="quieto">Leitura das respostas</span>
        <b>
          {!v.status.dominioRespostas || !v.status.webhook
            ? master
              ? 'Não configurada'
              : 'Em ativação'
            : v.config.webhookEm
              ? `Último aviso ${fmtQuando(v.config.webhookEm)}`
              : 'Aguardando o 1º aviso'}
        </b>
      </div>
      <ErroDaApi erro={ligar.error} />
    </div>
  );
}

/* ───────────────────────── Campanhas ───────────────────────── */

type Passo = PassoSequencia;

const ROTULO_CANAL: Record<CanalSequencia, string> = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  ligacao: 'Ligação',
};
const ICONE_CANAL: Record<CanalSequencia, string> = {
  email: 'mail',
  whatsapp: 'message-circle',
  ligacao: 'phone',
};
const TEXTO_PADRAO: Record<'whatsapp' | 'ligacao', string> = {
  whatsapp: '{saudacao} Aqui é {remetente}. Te mandei um e-mail para a {empresa}: conseguiu ver?',
  ligacao: 'Confirme se recebeu o e-mail e pergunte qual é hoje o maior desafio da {empresa} nesse assunto.',
};

/** Canais que a sequência usa (para a estimativa de quem pode entrar). */
const canaisDe = (passos: Passo[]) => [...new Set(passos.map((p) => p.canal ?? 'email'))];

/** Modelos do nicho da campanha primeiro (os outros continuam na lista). */
function ordenarModelos(modelos: ModeloEmail[], nichoId: number | null | undefined): ModeloEmail[] {
  if (!nichoId) return modelos;
  return [...modelos].sort((a, b) => Number(b.nichoId === nichoId) - Number(a.nichoId === nichoId));
}

/**
 * A sequência: até 6 passos, cada um num canal (e-mail, WhatsApp ou ligação), com os dias de espera
 * sem resposta. Respondeu em qualquer canal, a sequência para para aquele lead.
 */
function EditorPassos(props: { passos: Passo[]; modelos: ModeloEmail[]; aoMudar: (p: Passo[]) => void }) {
  const { passos, aoMudar } = props;
  const mudar = (i: number, p: Partial<Passo>) =>
    aoMudar(passos.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const trocarCanal = (i: number, canal: CanalSequencia) =>
    mudar(
      i,
      canal === 'email'
        ? { canal, modeloId: passos[i]?.modeloId ?? props.modelos[0]?.id, texto: undefined }
        : { canal, texto: passos[i]?.texto || TEXTO_PADRAO[canal], modeloId: undefined },
    );
  return (
    <fieldset className="opcoes opcoes--pilha">
      <legend>Sequência</legend>
      <ol className="passos-sequencia">
        {passos.map((p, i) => {
          const canal = p.canal ?? 'email';
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a posição é o próprio passo
            <li key={i} className="passo-sequencia" data-canal={canal}>
              <div className="passo-sequencia__topo">
                <span className="passo-sequencia__n mono">{i + 1}º</span>
                <fieldset className="segmentos segmentos--mini" aria-label={`Canal do ${i + 1}º passo`}>
                  {(['email', 'whatsapp', 'ligacao'] as CanalSequencia[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="segmento"
                      aria-pressed={canal === c}
                      data-ativo={canal === c || undefined}
                      onClick={() => trocarCanal(i, c)}
                    >
                      <Icon name={ICONE_CANAL[c]} size={12} /> {ROTULO_CANAL[c]}
                    </button>
                  ))}
                </fieldset>
                {i === 0 ? (
                  <span className="quieto passo-sequencia__quando">logo que começar</span>
                ) : (
                  <span className="passo-email__dias passo-sequencia__quando">
                    <input
                      className="filtro"
                      inputMode="numeric"
                      aria-label={`Dias sem resposta antes do ${i + 1}º passo`}
                      value={p.dias}
                      onChange={(e) => mudar(i, { dias: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                    />
                    dias sem resposta
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label={`Tirar o ${i + 1}º passo`}
                      onClick={() => aoMudar(passos.filter((_, j) => j !== i))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </span>
                )}
              </div>
              {canal === 'email' ? (
                <>
                  <label className="pp-sr" htmlFor={`passo-modelo-${i}`}>
                    Modelo do {i + 1}º passo
                  </label>
                  <select
                    id={`passo-modelo-${i}`}
                    className="filtro"
                    value={p.modeloId ?? ''}
                    onChange={(e) => mudar(i, { modeloId: Number(e.target.value) })}
                  >
                    {!p.modeloId && <option value="">Escolha o modelo</option>}
                    {props.modelos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                        {m.nichoNome ? ` · ${m.nichoNome}` : ''}
                        {m.arquivos.length
                          ? ` (${m.arquivos.length} anexo${m.arquivos.length === 1 ? '' : 's'})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label className="pp-sr" htmlFor={`passo-texto-${i}`}>
                    {canal === 'whatsapp' ? 'Mensagem do WhatsApp' : 'Roteiro da ligação'}
                  </label>
                  <textarea
                    id={`passo-texto-${i}`}
                    rows={3}
                    maxLength={2000}
                    placeholder={
                      canal === 'whatsapp' ? 'Mensagem do WhatsApp' : 'Roteiro da ligação (opcional)'
                    }
                    value={p.texto ?? ''}
                    onChange={(e) => mudar(i, { texto: e.target.value })}
                  />
                  <span className="campo__dica">
                    {canal === 'whatsapp'
                      ? 'Sai pelo chip do lead, no horário e no limite do WhatsApp (tela Agente). Vale {saudacao}, {nome}, {empresa}, {cidade} e {remetente}.'
                      : 'Vira uma tarefa de ligação para o dono do lead, com o telefone e este roteiro.'}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {passos.length < 6 && (
        <div className="acoes">
          <Button
            size="sm"
            variant="ghost"
            icon="mail"
            onClick={() =>
              aoMudar([
                ...passos,
                { canal: 'email', modeloId: props.modelos.at(-1)?.id, dias: passos.length === 1 ? 3 : 4 },
              ])
            }
          >
            E-mail
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="message-circle"
            onClick={() => aoMudar([...passos, { canal: 'whatsapp', texto: TEXTO_PADRAO.whatsapp, dias: 2 }])}
          >
            WhatsApp
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="phone"
            onClick={() => aoMudar([...passos, { canal: 'ligacao', texto: TEXTO_PADRAO.ligacao, dias: 2 }])}
          >
            Ligação
          </Button>
        </div>
      )}
      <span className="campo__dica">
        Respondeu em qualquer canal, pediu para sair, avançou no funil ou o e-mail voltou: a sequência para na
        hora para aquele lead. Quem não tem o canal de um passo pula para o próximo; o passo de WhatsApp ou de
        ligação põe o lead no funil.
      </span>
    </fieldset>
  );
}

/** A sequência está pronta para salvar (todo passo tem o que precisa). */
const passosValidos = (passos: Passo[]) =>
  passos.length > 0 &&
  passos.every((p) =>
    (p.canal ?? 'email') === 'email' ? !!p.modeloId : p.canal === 'ligacao' || !!p.texto?.trim(),
  );

interface CamposCampanha {
  marcaId: number;
  instrucoesIa: string;
  personalizarIa: boolean;
}

/** Identidade visual e o que a IA precisa saber do nicho. */
function EditorMarcaIa(props: {
  v: CamposCampanha;
  aoMudar: (v: CamposCampanha) => void;
  nichoNome?: string | null;
  iaLigada: boolean;
}) {
  const marcas = useMarcas();
  const { v } = props;
  useEffect(() => {
    if (!v.marcaId && marcas.data?.[0]) props.aoMudar({ ...v, marcaId: marcas.data[0].id });
  }, [marcas.data, v, props.aoMudar]);
  return (
    <fieldset className="opcoes opcoes--pilha">
      <legend>Cara e conteúdo</legend>
      <div className="campo">
        <label htmlFor="ce-marca">Identidade visual</label>
        <select
          id="ce-marca"
          className="filtro"
          value={v.marcaId || ''}
          onChange={(e) => props.aoMudar({ ...v, marcaId: Number(e.target.value) })}
        >
          {!marcas.data?.length && <option value="">Crie uma na aba Identidade visual</option>}
          {marcas.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome} · {m.remetenteNome}
            </option>
          ))}
        </select>
        <span className="campo__dica">Cores, logo, remetente e assinatura que o lead vê.</span>
      </div>
      <label className="opcao">
        <input
          type="checkbox"
          checked={v.personalizarIa}
          onChange={(e) => props.aoMudar({ ...v, personalizarIa: e.target.checked })}
        />
        A IA escreve a abertura de cada e-mail olhando o lead (onde o modelo tiver {'{abertura}'})
      </label>
      {v.personalizarIa && !props.iaLigada && (
        <Mensagem tipo="aviso">
          A IA ainda não está ativa nesta conta: até lá, a abertura fica vazia.
        </Mensagem>
      )}
      <div className="campo">
        <label htmlFor="ce-instr">
          Instruções para a IA{props.nichoNome ? ` (nicho ${props.nichoNome})` : ''}
        </label>
        <textarea
          id="ce-instr"
          rows={5}
          maxLength={3000}
          placeholder={
            'Ex.: São empresas de médio porte que compram por cotação. A dor é perder tempo com fornecedor que não responde. Cite o bairro ou a especialidade da empresa quando der; nunca invente número. Tom direto, de quem conhece o ramo.'
          }
          value={v.instrucoesIa}
          onChange={(e) => props.aoMudar({ ...v, instrucoesIa: e.target.value })}
        />
        <span className="campo__dica">
          O que vale para este nicho: a dor, o que funciona, o que evitar. A IA usa isso e os dados do lead
          (nome, cidade, avaliações, site) para escrever uma ou duas frases; o resto do e-mail é o modelo.
        </span>
      </div>
    </fieldset>
  );
}

function NovaCampanha(props: {
  modelos: ModeloEmail[];
  iaLigada: boolean;
  aoFechar: () => void;
  /** Salva como rascunho: abre a prévia da campanha criada. */
  aoSalvarRascunho: (id: number) => void;
}) {
  const cliente = useQueryClient();
  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });
  const [f, setF] = useState({
    nome: '',
    campanhaId: 0,
    faixas: [] as ('A' | 'B' | 'C')[],
    pularNoFunil: true,
    incluirContador: false,
    passos: [{ canal: 'email', modeloId: props.modelos[0]?.id, dias: 0 }] as Passo[],
    marcaId: 0,
    instrucoesIa: '',
    personalizarIa: props.iaLigada,
  });
  const filtro = {
    campanhaId: f.campanhaId,
    faixas: f.faixas,
    pularNoFunil: f.pularNoFunil,
    incluirContador: f.incluirContador,
    canais: canaisDe(f.passos),
  };
  const estimativa = useQuery({
    queryKey: ['email', 'estimar', filtro],
    queryFn: () =>
      api<{
        leads: number;
        comEmail: number;
        comWhatsapp: number;
        elegiveis: number;
        exemplos: {
          empresaId: number;
          nome: string;
          email: string | null;
          whatsapp: boolean;
          faixa: string | null;
        }[];
      }>('/email/campanhas/estimar', { metodo: 'POST', corpo: filtro }),
    enabled: f.campanhaId > 0,
    placeholderData: keepPreviousData,
  });
  const criar = useMutation({
    mutationFn: async (iniciar: boolean) => {
      const { id } = await api<{ id: number }>('/email/campanhas', { metodo: 'POST', corpo: f });
      if (iniciar) await api(`/email/campanhas/${id}/iniciar`, { metodo: 'POST' });
      return id;
    },
    onSuccess: async (id, iniciar) => {
      await cliente.invalidateQueries({ queryKey: ['email'] });
      if (iniciar) props.aoFechar();
      else props.aoSalvarRascunho(id);
    },
  });
  const faixa = (x: 'A' | 'B' | 'C') =>
    setF({ ...f, faixas: f.faixas.includes(x) ? f.faixas.filter((y) => y !== x) : [...f.faixas, x] });
  const campanha = campanhas.data?.find((c) => c.id === f.campanhaId);
  const modelos = ordenarModelos(props.modelos, campanha?.nichoId);
  const aoMudarIa = useCallback((v: CamposCampanha) => setF((x) => ({ ...x, ...v })), []);

  return (
    <Drawer titulo="Nova sequência" barra="Sequências" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            criar.mutate(true);
          }}
        >
          <div className="campo">
            <label htmlFor="ce-campanha">Leads de qual campanha</label>
            <select
              id="ce-campanha"
              className="filtro"
              value={f.campanhaId || ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                const c = campanhas.data?.find((x) => x.id === id);
                // O 1º e-mail passa a ser o modelo do nicho da campanha, se houver.
                const doNicho = props.modelos.find((m) => c && m.nichoId === c.nichoId);
                setF({
                  ...f,
                  campanhaId: id,
                  nome: f.nome || (c ? `E-mail · ${c.nome}` : ''),
                  passos:
                    doNicho && f.passos.length === 1 && (f.passos[0]?.canal ?? 'email') === 'email'
                      ? [{ canal: 'email', modeloId: doNicho.id, dias: 0 }]
                      : f.passos,
                });
              }}
            >
              <option value="">Escolha a campanha de prospecção</option>
              {campanhas.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} · {c.nichoNome}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="ce-nome">Nome desta campanha de e-mail</label>
            <input
              id="ce-nome"
              className="filtro"
              maxLength={120}
              value={f.nome}
              onChange={(e) => setF({ ...f, nome: e.target.value })}
            />
          </div>

          <fieldset className="opcoes">
            <legend>Quem recebe</legend>
            <div className="segmentos">
              {(['A', 'B', 'C'] as const).map((x) => (
                <button
                  key={x}
                  type="button"
                  className="segmento"
                  data-ativo={f.faixas.includes(x) || undefined}
                  aria-pressed={f.faixas.includes(x)}
                  onClick={() => faixa(x)}
                >
                  Nota {x}
                </button>
              ))}
              <span className="quieto" style={{ alignSelf: 'center', fontSize: 12 }}>
                {f.faixas.length ? '' : 'Nenhuma marcada = todas (qualificados ou não)'}
              </span>
            </div>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.pularNoFunil}
                onChange={(e) => setF({ ...f, pularNoFunil: e.target.checked })}
              />
              Pular quem já está sendo trabalhado no funil (abordado, em conversa, cliente…)
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.incluirContador}
                onChange={(e) => setF({ ...f, incluirContador: e.target.checked })}
              />
              Incluir e-mails que parecem ser do contador (vieram da Receita)
            </label>
          </fieldset>

          {f.campanhaId > 0 && (
            <div className="estimativa-email">
              {estimativa.isPending ? (
                <div className="esqueleto" />
              ) : estimativa.data ? (
                <>
                  <p style={{ margin: 0 }}>
                    <b className="mono" style={{ fontSize: 20 }}>
                      {fmtNumero(estimativa.data.elegiveis)}
                    </b>{' '}
                    {estimativa.data.elegiveis === 1
                      ? 'lead entra na sequência'
                      : 'leads entram na sequência'}
                    <span className="quieto">
                      {' '}
                      · dos {fmtNumero(estimativa.data.leads)} leads de “{campanha?.nome}”,{' '}
                      {fmtNumero(estimativa.data.comEmail)} têm e-mail e{' '}
                      {fmtNumero(estimativa.data.comWhatsapp)} têm WhatsApp
                    </span>
                  </p>
                  {estimativa.data.exemplos.length > 0 && (
                    <ul className="exemplos-email">
                      {estimativa.data.exemplos.map((x) => (
                        <li key={x.empresaId}>
                          {fmtNome(x.nome)}{' '}
                          <span className="quieto mono">
                            {[x.email, x.whatsapp ? 'WhatsApp' : null].filter(Boolean).join(' · ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <span className="campo__dica">
                    Entra quem tem algum canal da sequência. Fica de fora quem pediu para sair, quem foi
                    descartado, quem está em outra sequência e quem recebeu e-mail de outra campanha nos
                    últimos 30 dias.
                  </span>
                </>
              ) : null}
            </div>
          )}

          <EditorMarcaIa
            v={{ marcaId: f.marcaId, instrucoesIa: f.instrucoesIa, personalizarIa: f.personalizarIa }}
            aoMudar={aoMudarIa}
            nichoNome={campanha?.nichoNome}
            iaLigada={props.iaLigada}
          />
          <EditorPassos passos={f.passos} modelos={modelos} aoMudar={(passos) => setF({ ...f, passos })} />

          <ErroDaApi erro={criar.error} />
          <div className="acoes">
            <Button
              variant="primary"
              disabled={
                criar.isPending || !f.campanhaId || !f.nome.trim() || !f.marcaId || !passosValidos(f.passos)
              }
              onClick={() => criar.mutate(false)}
            >
              Salvar e ver a prévia
            </Button>
            <Button
              type="submit"
              variant="ghost"
              icon="send"
              disabled={
                criar.isPending ||
                !f.campanhaId ||
                !f.nome.trim() ||
                !f.marcaId ||
                !passosValidos(f.passos) ||
                !estimativa.data?.elegiveis
              }
            >
              Criar e já começar a enviar
            </Button>
          </div>
          <span className="campo__dica">
            “Salvar e ver a prévia” guarda como rascunho: confira cada passo com leads de verdade antes de
            começar.
          </span>
        </form>
      </div>
    </Drawer>
  );
}

type SecaoCampanha = 'previa' | 'ajustes';

/** Campanha de e-mail aberta: prévia real (lead, marca, IA) e ajustes (marca, instruções, sequência). */
function CampanhaAberta(props: {
  campanha: CampanhaEmail;
  modelos: ModeloEmail[];
  iaLigada: boolean;
  secao: SecaoCampanha;
  aoFechar: () => void;
}) {
  const c = props.campanha;
  const cliente = useQueryClient();
  const admin = useEhAdmin();
  const sessao = useSessao();
  const [secao, setSecao] = useState<SecaoCampanha>(props.secao);
  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });
  const nicho = campanhas.data?.find((x) => x.id === c.campanhaId);
  const inicial = () => ({
    nome: c.nome,
    passos: c.passos,
    marcaId: c.marcaId ?? 0,
    instrucoesIa: c.instrucoesIa ?? '',
    personalizarIa: c.personalizarIa,
  });
  const [f, setF] = useState(inicial);
  const salvar = useMutation({
    mutationFn: () => api(`/email/campanhas/${c.id}`, { metodo: 'PATCH', corpo: f }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['email'] });
      setSecao('previa');
    },
  });
  const mudou = JSON.stringify(f) !== JSON.stringify(inicial());
  const aoMudarIa = useCallback((v: CamposCampanha) => setF((x) => ({ ...x, ...v })), []);

  return (
    <Drawer titulo={c.nome} barra="Campanha de e-mail" aoFechar={props.aoFechar} largo>
      <div className="drawer__corpo">
        <div className="pilha" style={{ gap: 16 }}>
          <header>
            <h2 style={{ margin: 0, fontSize: 18 }}>{c.nome}</h2>
            <span className="quieto" style={{ fontSize: 13 }}>
              {c.campanhaNome} · {c.marcaNome ?? 'sem identidade visual'} ·{' '}
              {c.personalizarIa ? 'abertura pela IA' : 'sem IA'}
            </span>
          </header>
          {admin && (
            <div className="pipelines" role="tablist" aria-label="Seções da campanha">
              {(
                [
                  ['previa', 'Prévia e teste'],
                  ['ajustes', 'Ajustes'],
                ] as [SecaoCampanha, string][]
              ).map(([id, rotulo]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={secao === id}
                  className="pipelines__aba"
                  onClick={() => setSecao(id)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          )}
          {secao === 'previa' || !admin ? (
            <PreviaCampanha
              key={JSON.stringify([c.passos, c.marcaId, c.instrucoesIa, c.personalizarIa])}
              campanhaEmailId={c.id}
              campanhaId={c.campanhaId}
              passos={c.passos}
              emailPadrao={sessao.data?.email ?? ''}
              admin={admin}
            />
          ) : (
            <form
              className="form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                salvar.mutate();
              }}
            >
              <div className="campo">
                <label htmlFor="ca-nome">Nome</label>
                <input
                  id="ca-nome"
                  className="filtro"
                  maxLength={120}
                  value={f.nome}
                  onChange={(e) => setF({ ...f, nome: e.target.value })}
                />
              </div>
              <EditorMarcaIa
                v={{ marcaId: f.marcaId, instrucoesIa: f.instrucoesIa, personalizarIa: f.personalizarIa }}
                aoMudar={aoMudarIa}
                nichoNome={nicho?.nichoNome}
                iaLigada={props.iaLigada}
              />
              <EditorPassos
                passos={f.passos}
                modelos={ordenarModelos(props.modelos, nicho?.nichoId)}
                aoMudar={(passos) => setF({ ...f, passos })}
              />
              {c.enviados > 0 && (
                <span className="campo__dica">
                  Vale para os próximos envios; quem já recebeu não recebe de novo.
                </span>
              )}
              <ErroDaApi erro={salvar.error} />
              <div className="acoes">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={salvar.isPending || !mudou || !f.nome.trim() || !passosValidos(f.passos)}
                >
                  {salvar.isPending ? 'Salvando…' : 'Salvar e ver a prévia'}
                </Button>
                {mudou && (
                  <Button variant="ghost" onClick={() => setF(inicial())}>
                    Descartar mudanças
                  </Button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function Campanhas(props: { modelos: ModeloEmail[]; ligado: boolean; iaLigada: boolean }) {
  const cliente = useQueryClient();
  const admin = useEhAdmin();
  const [params, setParams] = useSearchParams();
  const [nova, setNova] = useState(false);
  const q = useQuery({
    queryKey: ['email', 'campanhas'],
    queryFn: () => api<CampanhaEmail[]>('/email/campanhas'),
    refetchInterval: 30_000,
  });
  const acao = useMutation({
    mutationFn: (d: { id: number; acao: 'iniciar' | 'pausar' | 'apagar' }) =>
      d.acao === 'apagar'
        ? api(`/email/campanhas/${d.id}`, { metodo: 'DELETE' })
        : api(`/email/campanhas/${d.id}/${d.acao}`, { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['email'] }),
  });
  const abertaId = Number(params.get('abrir')) || null;
  const aberta = q.data?.find((c) => c.id === abertaId) ?? null;
  const abrir = (id: number | null, secao?: SecaoCampanha) => {
    const p = new URLSearchParams(params);
    if (id) {
      p.set('abrir', String(id));
      secao === 'ajustes' ? p.set('secao', 'ajustes') : p.delete('secao');
    } else {
      p.delete('abrir');
      p.delete('secao');
    }
    setParams(p, { replace: true });
  };

  return (
    <section className="pilha" style={{ gap: 12 }}>
      {admin && (
        <div className="acoes">
          <Button
            variant="primary"
            icon="plus"
            disabled={!props.modelos.length}
            onClick={() => setNova(true)}
          >
            Nova sequência
          </Button>
        </div>
      )}
      {!props.ligado && q.data?.some((c) => c.status === 'enviando' && c.naFila > 0) && (
        <Mensagem tipo="aviso">
          Há e-mails na fila, mas o envio automático está desligado. Ligue no topo da página para começarem a
          sair.
        </Mensagem>
      )}
      <ErroDaApi erro={q.error ?? acao.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : !q.data?.length ? (
        <div className="pp-panel">
          <EmptyState
            icone="mail"
            titulo="Nenhuma sequência ainda"
            texto="Escolha uma campanha de prospecção e monte os passos: e-mail com a proposta em anexo, WhatsApp e ligação, nos dias que você quiser. Respondeu em qualquer canal, a sequência para; quem tem interesse entra sozinho no SDR."
          />
        </div>
      ) : (
        <div className="grade-cards">
          {q.data.map((c) => {
            const base = c.enviados ? c.leads : 0;
            return (
              <article key={c.id} className="pp-panel card-email">
                <header className="card-email__topo">
                  <div>
                    <b>{c.nome}</b>
                    <span className="quieto card-email__sub">{c.campanhaNome}</span>
                    <span className="canais-sequencia" title="Passos da sequência">
                      {c.passos.map((p, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: a posição é o próprio passo
                        <span key={i} className="canal-passo" data-canal={p.canal ?? 'email'}>
                          <Icon name={ICONE_CANAL[p.canal ?? 'email']} size={12} />
                          {i > 0 && <span className="mono">+{p.dias}d</span>}
                        </span>
                      ))}
                    </span>
                    <span className="quieto card-email__sub">
                      {c.marcaNome ?? 'Sem identidade visual'}
                      {c.personalizarIa && ' · abertura pela IA'}
                    </span>
                  </div>
                  <Badge
                    tone={c.status === 'enviando' ? 'brand' : c.status === 'pausada' ? 'warning' : 'neutral'}
                  >
                    {ROTULO_STATUS[c.status]}
                  </Badge>
                </header>
                <div className="funil-email">
                  <div
                    title={`${fmtNumero(c.enviadosEmail)} e-mails · ${fmtNumero(c.enviadosWhatsapp)} WhatsApp · ${fmtNumero(c.ligacoes)} ligações`}
                  >
                    <b className="mono">{fmtNumero(c.enviados)}</b>
                    <span>
                      {c.enviadosWhatsapp || c.ligacoes
                        ? `toques (${[
                            c.enviadosEmail ? `${c.enviadosEmail} e-mail` : null,
                            c.enviadosWhatsapp ? `${c.enviadosWhatsapp} zap` : null,
                            c.ligacoes ? `${c.ligacoes} lig.` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')})`
                        : 'enviados'}
                    </span>
                  </div>
                  <div>
                    <b className="mono">{fmtPct(c.abriram, base)}</b>
                    <span>abriram ({fmtNumero(c.abriram)})</span>
                  </div>
                  <div>
                    <b className="mono">{fmtNumero(c.clicaram)}</b>
                    <span>clicaram</span>
                  </div>
                  <div>
                    <b className="mono">{fmtNumero(c.responderam)}</b>
                    <span>responderam</span>
                  </div>
                  <div data-destaque>
                    <b className="mono">{fmtNumero(c.interessados)}</b>
                    <span>com interesse</span>
                  </div>
                </div>
                <p className="quieto card-email__rodape">
                  {c.naFila > 0 && `${fmtNumero(c.naFila)} na fila · `}
                  {c.erros > 0 && `${fmtNumero(c.erros)} não entregues · `}
                  {c.ultimoEnvio ? `último envio ${fmtHora(c.ultimoEnvio)}` : 'nada enviado ainda'}
                </p>
                <div className="acoes">
                  <Button size="sm" icon="mail" onClick={() => abrir(c.id)}>
                    Prévia e teste
                  </Button>
                  {admin && (
                    <Button size="sm" variant="ghost" icon="settings" onClick={() => abrir(c.id, 'ajustes')}>
                      Ajustes
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setParams({ aba: 'enviados', campanha: String(c.id) })}
                  >
                    Ver envios
                  </Button>
                  {admin && (c.status === 'rascunho' || c.status === 'pausada') && (
                    <Button size="sm" icon="send" onClick={() => acao.mutate({ id: c.id, acao: 'iniciar' })}>
                      {c.status === 'rascunho' ? 'Começar a enviar' : 'Retomar'}
                    </Button>
                  )}
                  {admin && c.status === 'enviando' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => acao.mutate({ id: c.id, acao: 'pausar' })}
                    >
                      Pausar
                    </Button>
                  )}
                  {admin && c.enviados === 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => acao.mutate({ id: c.id, acao: 'apagar' })}
                    >
                      Apagar
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="nota-rodape">
        “Abriram” conta quem carregou as imagens do e-mail: o Gmail carrega sozinho e o Outlook às vezes
        bloqueia, então é uma estimativa. Clique e resposta são certeza.
      </p>
      {nova && (
        <NovaCampanha
          modelos={props.modelos}
          iaLigada={props.iaLigada}
          aoFechar={() => setNova(false)}
          aoSalvarRascunho={(id) => {
            setNova(false);
            abrir(id);
          }}
        />
      )}
      {aberta && (
        <CampanhaAberta
          key={aberta.id}
          campanha={aberta}
          modelos={props.modelos}
          iaLigada={props.iaLigada}
          secao={params.get('secao') === 'ajustes' ? 'ajustes' : 'previa'}
          aoFechar={() => abrir(null)}
        />
      )}
    </section>
  );
}

/* ───────────────────────── Modelos (editor com prévia) ───────────────────────── */

/** Prévia do modelo: com a identidade visual escolhida e um lead de verdade (sem a IA, para não gastar). */
function Previa(props: {
  assunto: string;
  corpo: string;
  marcaId: number | null;
  empresaId: number | null;
  anexos: number[];
}) {
  const [atraso, setAtraso] = useState(props);
  useEffect(() => {
    const t = setTimeout(() => setAtraso(props), 400);
    return () => clearTimeout(t);
  }, [props]);
  const q = useQuery({
    queryKey: ['email', 'previa', 'modelo', atraso],
    queryFn: () =>
      api<PreviaEmail>('/email/previa', { metodo: 'POST', corpo: { ...atraso, personalizarIa: false } }),
    placeholderData: keepPreviousData,
    enabled: !!atraso.corpo.trim() && !!atraso.marcaId,
  });
  return (
    <>
      <ErroDaApi erro={q.error} />
      <JanelaEmail previa={q.data} carregando={q.isFetching} />
    </>
  );
}

function EditorModelo(props: {
  modelo: ModeloEmail | null;
  aoSalvar: (id: number) => void;
  aoApagar: () => void;
}) {
  const cliente = useQueryClient();
  const sessao = useSessao();
  const admin = useEhAdmin();
  const m = props.modelo;
  const [f, setF] = useState({ nome: '', assunto: '', corpo: '', nichoId: null as number | null });
  const [arquivos, setArquivos] = useState<ArquivoEmail[]>([]);
  const marcas = useMarcas();
  const nichos = useNichos();
  const [marcaId, setMarcaId] = useState<number | null>(null);
  const [leadPrevia, setLeadPrevia] = useState<number | null>(null);
  const marcaPrevia = marcaId ?? marcas.data?.[0]?.id ?? null;
  const [para, setPara] = useState('');
  const [testeOk, setTesteOk] = useState(false);
  const corpoRef = useRef<HTMLTextAreaElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setF({
      nome: m?.nome ?? '',
      assunto: m?.assunto ?? '',
      corpo: m?.corpo ?? '',
      nichoId: m?.nichoId ?? null,
    });
    setArquivos(m?.arquivos ?? []);
    setTesteOk(false);
  }, [m]);
  useEffect(() => setPara((p) => p || sessao.data?.email || ''), [sessao.data?.email]);

  const salvar = useMutation({
    mutationFn: () =>
      m
        ? api<{ id: number; modelos: ModeloEmail[] }>(`/email/modelos/${m.id}`, {
            metodo: 'PUT',
            corpo: { ...f, anexos: arquivos.map((a) => a.id) },
          })
        : api<{ id: number; modelos: ModeloEmail[] }>('/email/modelos', {
            metodo: 'POST',
            corpo: { ...f, anexos: arquivos.map((a) => a.id) },
          }),
    onSuccess: (d) => {
      cliente.setQueryData(['email', 'modelos'], d.modelos);
      props.aoSalvar(d.id);
    },
  });
  const apagar = useMutation({
    mutationFn: () => api<ModeloEmail[]>(`/email/modelos/${m?.id}`, { metodo: 'DELETE' }),
    onSuccess: (d) => {
      cliente.setQueryData(['email', 'modelos'], d);
      props.aoApagar();
    },
  });
  const anexar = useMutation({
    mutationFn: async (arq: File) =>
      api<ArquivoEmail>('/email/anexos', {
        metodo: 'POST',
        corpo: { nome: arq.name, mime: arq.type || 'application/octet-stream', base64: await lerBase64(arq) },
      }),
    onSuccess: (a) => setArquivos((x) => [...x, a]),
  });
  const teste = useMutation({
    mutationFn: () =>
      api('/email/teste', {
        metodo: 'POST',
        corpo: {
          assunto: f.assunto,
          corpo: f.corpo,
          marcaId: marcaPrevia,
          empresaId: leadPrevia,
          anexos: arquivos.map((a) => a.id),
          para,
        },
      }),
    onSuccess: () => setTesteOk(true),
  });

  const inserir = (v: string) => {
    const el = corpoRef.current;
    if (!el) return;
    const ini = el.selectionStart ?? f.corpo.length;
    const fim = el.selectionEnd ?? ini;
    const novo = f.corpo.slice(0, ini) + v + f.corpo.slice(fim);
    setF({ ...f, corpo: novo });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + v.length, ini + v.length);
    });
  };
  const total = arquivos.reduce((s, a) => s + a.tamanho, 0);
  const mudou =
    !m ||
    f.nome !== m.nome ||
    f.assunto !== m.assunto ||
    f.corpo !== m.corpo ||
    f.nichoId !== m.nichoId ||
    arquivos.map((a) => a.id).join() !== m.anexos.join();

  return (
    <div className="editor-email">
      <form
        className="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <div className="campo">
          <label htmlFor="me-nome">Nome do modelo</label>
          <input
            id="me-nome"
            className="filtro"
            maxLength={80}
            disabled={!admin}
            value={f.nome}
            onChange={(e) => setF({ ...f, nome: e.target.value })}
          />
        </div>
        <div className="campo">
          <label htmlFor="me-nicho">Nicho</label>
          <select
            id="me-nicho"
            className="filtro"
            disabled={!admin}
            value={f.nichoId ?? ''}
            onChange={(e) => setF({ ...f, nichoId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Qualquer nicho</option>
            {nichos.data
              ?.filter((n) => n.ativo || n.id === f.nichoId)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nome}
                </option>
              ))}
          </select>
          <span className="campo__dica">Na campanha desse nicho, este modelo aparece primeiro.</span>
        </div>
        <div className="campo">
          <label htmlFor="me-assunto">Assunto</label>
          <input
            id="me-assunto"
            className="filtro"
            maxLength={200}
            disabled={!admin}
            value={f.assunto}
            onChange={(e) => setF({ ...f, assunto: e.target.value })}
          />
        </div>
        <div className="campo">
          <label htmlFor="me-corpo">Texto do e-mail</label>
          <div className="variaveis">
            {[
              ['{saudacao}', '“Olá, Marcos!”'],
              ['{nome}', 'nome do decisor'],
              ['{empresa}', 'nome da loja'],
              ['{cidade}', 'cidade'],
              ['{remetente}', 'seu nome'],
              ['{abertura}', 'uma ou duas frases que a IA escreve para cada lead (liga na campanha)'],
            ].map(([v, dica]) => (
              <button
                key={v}
                type="button"
                className="variavel"
                title={dica}
                disabled={!admin}
                onClick={() => inserir(v as string)}
              >
                {v}
              </button>
            ))}
          </div>
          <textarea
            id="me-corpo"
            ref={corpoRef}
            rows={14}
            maxLength={20_000}
            disabled={!admin}
            value={f.corpo}
            onChange={(e) => setF({ ...f, corpo: e.target.value })}
          />
          <span className="campo__dica">
            Linha em branco separa parágrafos. “- ” no começo da linha faz lista, **assim** fica em negrito e
            links viram clicáveis. Uma linha só com [[Ver a proposta|https://…]] vira botão. A assinatura, o
            rodapé e o “sair da lista” vêm da identidade visual.
          </span>
        </div>

        <div className="campo">
          <span className="campo__rotulo">Anexos</span>
          {arquivos.length > 0 && (
            <ul className="anexos">
              {arquivos.map((a) => (
                <li key={a.id}>
                  <Icon name="file-text" size={14} />
                  <a href={`/api/conversas/midia/${a.id}`} target="_blank" rel="noreferrer">
                    {a.nome}
                  </a>
                  <span className="quieto">{fmtTamanho(a.tamanho)}</span>
                  {admin && (
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label={`Tirar ${a.nome}`}
                      onClick={() => setArquivos((x) => x.filter((y) => y.id !== a.id))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {admin && (
            <div>
              <input
                ref={arquivoRef}
                type="file"
                hidden
                accept="application/pdf,image/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                onChange={(e) => {
                  const arq = e.target.files?.[0];
                  if (arq) anexar.mutate(arq);
                  e.target.value = '';
                }}
              />
              <Button
                size="sm"
                icon="paperclip"
                disabled={anexar.isPending || arquivos.length >= 5}
                onClick={() => arquivoRef.current?.click()}
              >
                {anexar.isPending ? 'Enviando…' : 'Anexar arquivo'}
              </Button>
              <span className="campo__dica" style={{ marginLeft: 8 }}>
                Proposta comercial, apresentação… até 10 MB somando tudo ({fmtTamanho(total)} usados).
              </span>
            </div>
          )}
          <ErroDaApi erro={anexar.error} />
        </div>

        <ErroDaApi erro={salvar.error ?? apagar.error} />
        {admin && (
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              disabled={salvar.isPending || !mudou || !f.nome.trim() || !f.assunto.trim() || !f.corpo.trim()}
            >
              {salvar.isPending ? 'Salvando…' : m ? 'Salvar modelo' : 'Criar modelo'}
            </Button>
            {m && (
              <Button variant="ghost" disabled={apagar.isPending} onClick={() => apagar.mutate()}>
                Apagar modelo
              </Button>
            )}
          </div>
        )}

        {admin && (
          <div className="confirmar">
            <label htmlFor="me-teste" style={{ fontWeight: 500 }}>
              Mandar um teste para ver na caixa de entrada de verdade
            </label>
            <div className="barra">
              <input
                id="me-teste"
                className="filtro"
                type="email"
                style={{ flex: '1 1 220px' }}
                value={para}
                onChange={(e) => setPara(e.target.value)}
              />
              <Button
                size="sm"
                icon="send"
                disabled={teste.isPending || !para || !f.assunto.trim() || !f.corpo.trim()}
                onClick={() => teste.mutate()}
              >
                {teste.isPending ? 'Enviando…' : 'Enviar teste'}
              </Button>
            </div>
            {testeOk && (
              <Mensagem tipo="ok">Teste enviado para {para}. Confira também a pasta de spam.</Mensagem>
            )}
            <ErroDaApi erro={teste.error} />
          </div>
        )}
      </form>
      <div className="pilha" style={{ gap: 8 }}>
        <div className="barra-previa">
          <div className="campo">
            <label htmlFor="me-marca">Ver com a identidade</label>
            <select
              id="me-marca"
              className="filtro"
              value={marcaPrevia ?? ''}
              onChange={(e) => setMarcaId(Number(e.target.value) || null)}
            >
              {marcas.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </div>
          <EscolherLead valor={leadPrevia} aoMudar={setLeadPrevia} />
        </div>
        <Previa
          assunto={f.assunto}
          corpo={f.corpo}
          marcaId={marcaPrevia}
          empresaId={leadPrevia}
          anexos={arquivos.map((a) => a.id)}
        />
        {/\{abertura\}/.test(f.corpo) && (
          <p className="nota-rodape" style={{ margin: 0 }}>
            Aqui o {'{abertura}'} fica vazio. Na campanha com a IA ligada, “Prévia e teste” mostra o que ela
            escreve para cada lead.
          </p>
        )}
      </div>
    </div>
  );
}

function Modelos(props: { modelos: ModeloEmail[]; carregando: boolean }) {
  const [params, setParams] = useSearchParams();
  const admin = useEhAdmin();
  const pedido = params.get('modelo');
  const novo = pedido === 'novo';
  const atual = novo
    ? null
    : (props.modelos.find((m) => String(m.id) === pedido) ?? props.modelos[0] ?? null);
  const abrir = (v: string) => {
    const p = new URLSearchParams(params);
    p.set('modelo', v);
    setParams(p, { replace: true });
  };
  if (props.carregando) return <div className="esqueleto" />;
  return (
    <div className="modelos-email">
      <nav className="modelos-email__lista" aria-label="Modelos">
        {props.modelos.map((m) => (
          <button
            key={m.id}
            type="button"
            className="modelo-item"
            aria-current={(!novo && atual?.id === m.id) || undefined}
            onClick={() => abrir(String(m.id))}
          >
            <b>{m.nome}</b>
            <span className="quieto">{m.assunto}</span>
            {m.arquivos.length > 0 && (
              <span className="quieto">
                <Icon name="paperclip" size={12} /> {m.arquivos.map((a) => a.nome).join(', ')}
              </span>
            )}
          </button>
        ))}
        {admin && (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => abrir('novo')}>
            Novo modelo
          </Button>
        )}
      </nav>
      <EditorModelo
        key={novo ? 'novo' : (atual?.id ?? 'vazio')}
        modelo={atual}
        aoSalvar={(id) => abrir(String(id))}
        aoApagar={() => abrir('')}
      />
    </div>
  );
}

/* ───────────────────────── Enviados ───────────────────────── */

function Enviados(props: { aoAbrirLead: (id: number) => void }) {
  const [params, setParams] = useSearchParams();
  const campanha = params.get('campanha') ?? '';
  const filtro = params.get('filtro') ?? 'todos';
  const campanhas = useQuery({
    queryKey: ['email', 'campanhas'],
    queryFn: () => api<CampanhaEmail[]>('/email/campanhas'),
  });
  const q = useQuery({
    queryKey: ['email', 'envios', campanha, filtro],
    queryFn: () =>
      api<EnvioEmail[]>(`/email/envios?filtro=${filtro}${campanha ? `&campanhaEmailId=${campanha}` : ''}`),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const mudar = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const STATUS: Record<EnvioEmail['status'], string> = {
    na_fila: 'Na fila',
    enviado: 'Feito',
    erro: 'Erro',
    devolvido: 'Voltou',
    cancelado: 'Parou',
    pulado: 'Pulado',
  };
  return (
    <section className="pilha" style={{ gap: 12 }}>
      <div className="barra">
        <label className="pp-sr" htmlFor="env-campanha">
          Campanha
        </label>
        <select
          id="env-campanha"
          className="filtro"
          value={campanha}
          onChange={(e) => mudar('campanha', e.target.value || null)}
        >
          <option value="">Todas as campanhas</option>
          {campanhas.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        <div className="segmentos" role="tablist" aria-label="Filtro">
          {[
            ['todos', 'Todos'],
            ['abriram', 'Abriram'],
            ['responderam', 'Responderam'],
            ['fila', 'Na fila'],
            ['erros', 'Não entregues'],
          ].map(([id, r]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="segmento"
              aria-selected={filtro === id}
              data-ativo={filtro === id || undefined}
              onClick={() => mudar('filtro', id === 'todos' ? null : (id as string))}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <ErroDaApi erro={q.error} />
      <div className="pp-tablewrap">
        <table className="pp-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Para</th>
              <th>Passo</th>
              <th>Status</th>
              <th>Abriu</th>
              <th>Clicou</th>
              <th>Respondeu</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending ? (
              <tr>
                <td colSpan={7}>
                  <div className="esqueleto" />
                </td>
              </tr>
            ) : !q.data?.length ? (
              <tr>
                <td colSpan={7} className="quieto">
                  Nada por aqui ainda.
                </td>
              </tr>
            ) : (
              q.data.map((e) => (
                <tr key={e.id}>
                  <td>
                    <button
                      type="button"
                      className="link-botao"
                      onClick={() => props.aoAbrirLead(e.empresaId)}
                    >
                      {fmtNome(e.nome)}
                    </button>
                    <div className="quieto" style={{ fontSize: 12 }}>
                      {e.cidade ? fmtCidade(e.cidade) : ''}
                      {e.etapaFunil && e.etapaFunil !== 'descartado'
                        ? ` · no funil: ${ROTULO_ETAPA[e.etapaFunil]}`
                        : ''}
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {e.canal === 'email' ? e.email : (e.telefone ?? '—')}
                  </td>
                  <td>
                    <span className="canal-passo" title={ROTULO_CANAL[e.canal ?? 'email']}>
                      <Icon name={ICONE_CANAL[e.canal ?? 'email']} size={12} />
                      <span className="mono">{e.passo}º</span>
                    </span>
                  </td>
                  <td>
                    <Badge
                      tone={
                        e.status === 'enviado'
                          ? 'neutral'
                          : e.status === 'na_fila'
                            ? 'outline'
                            : e.status === 'cancelado'
                              ? 'outline'
                              : 'danger'
                      }
                    >
                      {STATUS[e.status]}
                    </Badge>
                    {e.enviadoEm && (
                      <div className="quieto" style={{ fontSize: 12 }}>
                        {fmtHora(e.enviadoEm)}
                      </div>
                    )}
                    {(e.erro || e.paradoMotivo) && (
                      <div className="quieto" style={{ fontSize: 12 }} title={e.erro ?? e.paradoMotivo ?? ''}>
                        {(e.erro ?? e.paradoMotivo ?? '').slice(0, 60)}
                      </div>
                    )}
                  </td>
                  <td>
                    {e.abertoEm ? (
                      <span title={`${e.aberturas} vez(es)`}>{fmtHora(e.abertoEm)}</span>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                  <td>{e.clicadoEm ? fmtHora(e.clicadoEm) : <span className="quieto">—</span>}</td>
                  <td>
                    {e.respondidoEm ? (
                      <>
                        {e.classeResposta && (
                          <Badge tone={TOM_CLASSE[e.classeResposta]}>{ROTULO_CLASSE[e.classeResposta]}</Badge>
                        )}
                        <div className="quieto" style={{ fontSize: 12 }}>
                          {fmtHora(e.respondidoEm)}
                        </div>
                      </>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ───────────────────────── Respostas ───────────────────────── */

function Resposta(props: {
  r: RespostaEmail;
  aberta: boolean;
  aoAbrir: () => void;
  aoAbrirLead: (id: number) => void;
}) {
  const { r } = props;
  const cliente = useQueryClient();
  const [texto, setTexto] = useState('');
  const atualizar = () => {
    cliente.invalidateQueries({ queryKey: ['email'] });
    cliente.invalidateQueries({ queryKey: ['quadro'] });
  };
  const classe = useMutation({
    mutationFn: (c: ClasseResposta) =>
      api(`/email/respostas/${r.id}/classe`, { metodo: 'POST', corpo: { classe: c } }),
    onSuccess: atualizar,
  });
  const responder = useMutation({
    mutationFn: () => api(`/email/respostas/${r.id}/responder`, { metodo: 'POST', corpo: { texto } }),
    onSuccess: () => {
      setTexto('');
      atualizar();
    },
  });
  const lida = useMutation({
    mutationFn: () => api(`/email/respostas/${r.id}/lida`, { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: marca como lida só ao abrir
  useEffect(() => {
    if (props.aberta && !r.lidaEm) lida.mutate();
  }, [props.aberta]);

  return (
    <li className="resposta-email" data-nova={!r.lidaEm || undefined} data-aberta={props.aberta || undefined}>
      <button
        type="button"
        className="resposta-email__cabeca"
        aria-expanded={props.aberta}
        onClick={props.aoAbrir}
      >
        <span className="resposta-email__quem">
          <b>{r.nome ? fmtNome(r.nome) : r.deEmail}</b>
          <span className="quieto">
            {r.deNome ? `${r.deNome} · ` : ''}
            {r.deEmail}
          </span>
        </span>
        <Badge tone={TOM_CLASSE[r.classe]}>{ROTULO_CLASSE[r.classe]}</Badge>
        <span className="quieto resposta-email__quando">{fmtQuando(r.recebidoEm)}</span>
        <span className="resposta-email__previa">{r.resumo ?? r.texto.slice(0, 160)}</span>
      </button>
      {props.aberta && (
        <div className="resposta-email__corpo pilha" style={{ gap: 12 }}>
          <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
            {r.assunto} · {fmtHora(r.recebidoEm)}
            {r.campanhaNome ? ` · ${r.campanhaNome}` : ''} · classificado{' '}
            {r.classificadoPor === 'ia'
              ? 'pela IA'
              : r.classificadoPor === 'voce'
                ? 'por você'
                : 'pelas palavras da resposta'}
          </p>
          <p className="resposta-email__texto">{r.texto}</p>
          <div className="acoes">
            {r.empresaId && (
              <Button
                size="sm"
                variant="ghost"
                icon="id-card"
                onClick={() => props.aoAbrirLead(r.empresaId!)}
              >
                {r.etapaFunil && r.etapaFunil !== 'descartado'
                  ? `Ficha (no funil: ${ROTULO_ETAPA[r.etapaFunil]})`
                  : 'Ficha'}
              </Button>
            )}
            {r.classe !== 'interessado' && (
              <Button
                size="sm"
                icon="arrow-right"
                disabled={classe.isPending}
                onClick={() => classe.mutate('interessado')}
              >
                Tem interesse: mandar para o SDR
              </Button>
            )}
            {r.classe !== 'sem_interesse' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={classe.isPending}
                onClick={() => classe.mutate('sem_interesse')}
              >
                Sem interesse
              </Button>
            )}
            {r.classe !== 'descadastro' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={classe.isPending}
                onClick={() => classe.mutate('descadastro')}
              >
                Tirar da lista
              </Button>
            )}
          </div>
          <form
            className="pilha"
            style={{ gap: 8 }}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              responder.mutate();
            }}
          >
            <label htmlFor={`resp-${r.id}`} style={{ fontWeight: 500, fontSize: 13 }}>
              Responder por e-mail
            </label>
            <textarea
              id={`resp-${r.id}`}
              rows={4}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Sua resposta (a assinatura entra sozinha)"
            />
            <ErroDaApi erro={responder.error ?? classe.error} />
            {responder.isSuccess && <Mensagem tipo="ok">Resposta enviada.</Mensagem>}
            <div className="acoes">
              <Button
                size="sm"
                type="submit"
                variant="primary"
                icon="send"
                disabled={!texto.trim() || responder.isPending}
              >
                {responder.isPending ? 'Enviando…' : 'Enviar resposta'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </li>
  );
}

function Respostas(props: { aoAbrirLead: (id: number) => void }) {
  const [params, setParams] = useSearchParams();
  const classe = params.get('classe') ?? '';
  const aberta = Number(params.get('resposta')) || null;
  const q = useQuery({
    queryKey: ['email', 'respostas', classe],
    queryFn: () => api<RespostaEmail[]>(`/email/respostas${classe ? `?classe=${classe}` : ''}`),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const mudar = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  return (
    <section className="pilha" style={{ gap: 12 }}>
      <div className="segmentos" role="tablist" aria-label="Classificação">
        {(['', 'interessado', 'sem_interesse', 'descadastro', 'automatica'] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            className="segmento"
            aria-selected={classe === c}
            data-ativo={classe === c || undefined}
            onClick={() => mudar('classe', c || null)}
          >
            {c ? ROTULO_CLASSE[c] : 'Todas'}
          </button>
        ))}
      </div>
      <ErroDaApi erro={q.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : !q.data?.length ? (
        <p className="quieto">
          Nenhuma resposta {classe ? 'nesta classificação' : 'ainda'}. As respostas aparecem aqui assim que
          chegam; quem tem interesse entra sozinho no SDR em “Respondeu”.
        </p>
      ) : (
        <ul className="respostas-email">
          {q.data.map((r) => (
            <Resposta
              key={r.id}
              r={r}
              aberta={aberta === r.id}
              aoAbrir={() => mudar('resposta', aberta === r.id ? null : String(r.id))}
              aoAbrirLead={props.aoAbrirLead}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────────────────────── Configuração ───────────────────────── */

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function Configuracao(props: { v: VisaoEmail }) {
  const cliente = useQueryClient();
  const master = !!useSessao().data?.master;
  const [f, setF] = useState<ConfigEmail>(props.v.config);
  useEffect(() => setF(props.v.config), [props.v.config]);
  const salvar = useMutation({
    mutationFn: () => {
      const { webhookEm: _, ...corpo } = f;
      return api('/email/config', { metodo: 'PUT', corpo });
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['email'] }),
  });
  const verificar = useMutation({
    mutationFn: () => api<{ resend: string; respostas: string }>('/email/verificar', { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['email'] }),
  });
  const num = (k: keyof ConfigEmail, v: string) => setF({ ...f, [k]: Number(v.replace(/\D/g, '')) || 0 });
  const st = props.v.status;

  return (
    <div className="pilha" style={{ gap: 16 }}>
      <DominioEmail />
      <div className="grade-config-email">
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.ligado}
              onChange={(e) => setF({ ...f, ligado: e.target.checked })}
            />
            <b>Envio automático ligado</b>
          </label>
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            Remetente, assinatura, cores e logo ficam na aba Identidade visual (cada campanha escolhe a sua).
          </p>
          <h3 className="subtitulo">Ritmo</h3>
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="cfe-lim">E-mails por dia</label>
              <input
                id="cfe-lim"
                className="filtro"
                inputMode="numeric"
                value={f.limiteDia}
                onChange={(e) => num('limiteDia', e.target.value)}
              />
              <span className="campo__dica">
                Caixa nova: comece com 30 a 50 por dia e aumente aos poucos.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="cfe-int">Intervalo entre e-mails (segundos)</label>
              <input
                id="cfe-int"
                className="filtro"
                inputMode="numeric"
                value={f.intervaloSeg}
                onChange={(e) => num('intervaloSeg', e.target.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor="cfe-ini">Das (hora)</label>
              <input
                id="cfe-ini"
                className="filtro"
                inputMode="numeric"
                value={f.horaInicio}
                onChange={(e) => num('horaInicio', e.target.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor="cfe-fim">Até (hora)</label>
              <input
                id="cfe-fim"
                className="filtro"
                inputMode="numeric"
                value={f.horaFim}
                onChange={(e) => num('horaFim', e.target.value)}
              />
            </div>
          </div>
          <fieldset className="segmentos">
            <legend className="campo__rotulo">Dias</legend>
            {DIAS.map((d, i) => (
              <button
                key={d}
                type="button"
                className="segmento"
                aria-pressed={f.diasSemana.includes(i)}
                data-ativo={f.diasSemana.includes(i) || undefined}
                onClick={() =>
                  setF({
                    ...f,
                    diasSemana: f.diasSemana.includes(i)
                      ? f.diasSemana.filter((x) => x !== i)
                      : [...f.diasSemana, i].sort(),
                  })
                }
              >
                {d}
              </button>
            ))}
          </fieldset>
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.rastrearAbertura}
              onChange={(e) => setF({ ...f, rastrearAbertura: e.target.checked })}
            />
            Contar aberturas e cliques
          </label>
          <ErroDaApi erro={salvar.error} />
          {salvar.isSuccess && <Mensagem tipo="ok">Configuração salva.</Mensagem>}
          <div className="acoes">
            <Button type="submit" variant="primary" disabled={salvar.isPending}>
              Salvar
            </Button>
          </div>
        </form>

        {master ? (
          <aside className="pilha" style={{ gap: 12 }}>
            <div className="pp-panel" style={{ padding: 16 }}>
              <h3 className="subtitulo" style={{ marginTop: 0 }}>
                Conexão
              </h3>
              <ul className="lista-status">
                <li data-ok={st.resend || undefined}>
                  <Icon name={st.resend ? 'check' : 'circle-x'} size={14} />
                  <span>
                    Envio pelo Resend
                    <span className="quieto">
                      {' · '}
                      {st.remetente ?? 'falta a chave e o remetente'}
                      {st.origem === 'plataforma' && ' (chaves da plataforma)'}
                    </span>
                  </span>
                </li>
                <li data-ok={st.dominioRespostas || undefined}>
                  <Icon name={st.dominioRespostas ? 'check' : 'circle-x'} size={14} />
                  <span>
                    Domínio de respostas
                    <span className="quieto"> · {st.dominioRespostas ?? 'falta configurar'}</span>
                  </span>
                </li>
                <li data-ok={(st.webhook && !!props.v.config.webhookEm) || undefined}>
                  <Icon
                    name={st.webhook ? (props.v.config.webhookEm ? 'check' : 'clock') : 'circle-x'}
                    size={14}
                  />
                  <span>
                    Webhook
                    <span className="quieto">
                      {' · '}
                      {!st.webhook
                        ? 'falta o segredo'
                        : props.v.config.webhookEm
                          ? `último aviso ${fmtQuando(props.v.config.webhookEm)}`
                          : 'nenhum aviso ainda'}
                    </span>
                  </span>
                </li>
                <li data-ok={st.ia || undefined}>
                  <Icon name={st.ia ? 'check' : 'circle-help'} size={14} />
                  <span>
                    IA (lê as respostas e escreve a abertura)
                    <span className="quieto">
                      {' · '}
                      {st.ia
                        ? (st.iaDescricao ?? 'ligada')
                        : 'sem ela, uma regra de palavras lê as respostas'}
                    </span>
                  </span>
                </li>
              </ul>
              {st.resend && (
                <div className="acoes" style={{ marginTop: 12 }}>
                  <Button
                    size="sm"
                    icon="check"
                    disabled={verificar.isPending}
                    onClick={() => verificar.mutate()}
                  >
                    {verificar.isPending ? 'Testando…' : 'Testar conexão'}
                  </Button>
                </div>
              )}
              {verificar.data && (
                <Mensagem
                  tipo={
                    /^ok/.test(verificar.data.resend) && /^ok/.test(verificar.data.respostas) ? 'ok' : 'aviso'
                  }
                >
                  Resend: {verificar.data.resend} · Respostas: {verificar.data.respostas}
                </Mensagem>
              )}
              <ErroDaApi erro={verificar.error} />
            </div>
            <div className="pp-panel" style={{ padding: 16 }}>
              <h3 className="subtitulo" style={{ marginTop: 0 }}>
                Chaves desta conta
              </h3>
              <p className="quieto" style={{ margin: '0 0 12px', fontSize: 13 }}>
                A chave do Resend, o remetente padrão, o domínio de respostas e o segredo do webhook ficam no
                painel master (cada conta tem os seus).
                {!master && ' Peça para quem administra o sistema.'}
              </p>
              {master && (
                <Button size="sm" icon="building-2" href="/plataforma/clientes">
                  Abrir o painel master
                </Button>
              )}
              <div className="campo" style={{ marginTop: 12 }}>
                <label htmlFor="cfe-webhook">Endereço do webhook desta conta</label>
                <input
                  id="cfe-webhook"
                  className="filtro mono"
                  readOnly
                  value={st.webhookUrl}
                  onFocus={(e) => e.target.select()}
                />
                <span className="campo__dica">
                  No Resend: Webhooks → Add endpoint, com os eventos de e-mail (received, delivered, opened,
                  clicked, bounced, complained, failed).
                </span>
              </div>
              <p className="quieto" style={{ margin: '8px 0 0', fontSize: 13 }}>
                Deixe o rastreio de abertura e clique do domínio desligado no Resend: o sistema já conta
                sozinho.
              </p>
            </div>
          </aside>
        ) : (
          <aside className="pilha" style={{ gap: 12 }}>
            <div className="pp-panel" style={{ padding: 16 }}>
              <h3 className="subtitulo" style={{ marginTop: 0 }}>
                Situação
              </h3>
              <ul className="lista-status">
                <li data-ok={st.resend || undefined}>
                  <Icon name={st.resend ? 'check' : 'clock'} size={14} />
                  <span>
                    Envio de e-mail
                    <span className="quieto">
                      {' '}
                      · {st.resend ? (st.remetente ?? 'ativo') : 'falta verificar o domínio (acima)'}
                    </span>
                  </span>
                </li>
                <li data-ok={(st.dominioRespostas && st.webhook) || undefined}>
                  <Icon name={st.dominioRespostas && st.webhook ? 'check' : 'clock'} size={14} />
                  <span>
                    Leitura das respostas
                    <span className="quieto">
                      {' '}
                      ·{' '}
                      {st.dominioRespostas && st.webhook
                        ? 'ativa'
                        : st.resend
                          ? 'em ativação pelo suporte'
                          : 'começa junto com o envio'}
                    </span>
                  </span>
                </li>
                <li data-ok={st.ia || undefined}>
                  <Icon name={st.ia ? 'check' : 'circle-help'} size={14} />
                  <span>
                    IA (lê as respostas e escreve a abertura)
                    <span className="quieto">
                      {' '}
                      · {st.ia ? 'ativa' : 'sem ela, uma regra de palavras lê as respostas'}
                    </span>
                  </span>
                </li>
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Página ───────────────────────── */

export function Email() {
  const [params, setParams] = useSearchParams();
  const admin = useEhAdmin();
  const aba = (params.get('aba') as Aba | null) ?? 'campanhas';
  const lead = params.get('empresa');
  const visao = useVisaoEmail();
  const modelos = useQuery({
    queryKey: ['email', 'modelos'],
    queryFn: () => api<ModeloEmail[]>('/email/modelos'),
  });
  const mudar = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const naoLidas = visao.data?.resumo.respostasNaoLidas ?? 0;

  return (
    <>
      <div className="topo">
        <div>
          <h1>E-mail</h1>
          <p>
            Sequências por e-mail, WhatsApp e ligação para os leads das campanhas, com a proposta em anexo e a
            leitura das respostas.
          </p>
        </div>
      </div>
      {visao.data && <Status v={visao.data} aoConfigurar={() => setParams({ aba: 'config' })} />}
      <ErroDaApi erro={visao.error} />
      <div className="pipelines" role="tablist" aria-label="Seções">
        {ABAS.filter((a) => !a.admin || admin).map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className="pipelines__aba"
            onClick={() => setParams({ aba: a.id }, { replace: true })}
          >
            {a.rotulo}
            {a.id === 'respostas' && naoLidas > 0 && (
              <span className="pipelines__conta pipelines__conta--nova">{naoLidas}</span>
            )}
          </button>
        ))}
      </div>
      {aba === 'campanhas' && (
        <Campanhas
          modelos={modelos.data ?? []}
          ligado={!!visao.data?.config.ligado}
          iaLigada={!!visao.data?.status.ia}
        />
      )}
      {aba === 'marca' && <Marcas remetenteConta={visao.data?.status.remetente ?? null} />}
      {aba === 'modelos' && <Modelos modelos={modelos.data ?? []} carregando={modelos.isPending} />}
      {aba === 'enviados' && <Enviados aoAbrirLead={(id) => mudar('empresa', String(id))} />}
      {aba === 'respostas' && <Respostas aoAbrirLead={(id) => mudar('empresa', String(id))} />}
      {aba === 'config' && admin && visao.data && <Configuracao v={visao.data} />}
      {lead && (
        <FichaEmpresa
          id={Number(lead)}
          aoFechar={() => mudar('empresa', null)}
          aoAbrir={(id) => mudar('empresa', String(id))}
        />
      )}
    </>
  );
}
