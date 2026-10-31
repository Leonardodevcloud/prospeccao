import {
  CAMPOS_FORMULARIO,
  type CampoFormulario,
  JANELA_DIRECT_HORAS,
  PRAZO_RESPOSTA_PRIVADA_DIAS,
} from '@prospeccao/shared/instagram';
import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Drawer, Modal } from '../componentes/Drawer';
import { CampoEtiquetas, ErroDaApi, Mensagem } from '../componentes/Formulario';
import { IconeInstagram } from '../componentes/IconeInstagram';
import { usePipelines } from '../componentes/Pipelines';
import { useEquipe, useSessao, useSoLeitura } from '../componentes/Sessao';
import { fmtCompromisso, fmtNumero, fmtPct, fmtQuando, fmtReais, formatarTelefone } from '../formatar';
import { AbaConteudo } from './InstagramConteudo';

/**
 * Instagram no CRM: "comente e receba" (quem comenta a palavra recebe um direct e, ao responder,
 * vira lead), os cadastros dos formulários dos anúncios da Meta e a conexão da conta.
 */

/* ───────────────────────── Tipos ───────────────────────── */

interface Situacao {
  configurado: boolean;
  conexao: {
    igId: string;
    usuario: string | null;
    nome: string | null;
    seguidores: number | null;
    foto: string | null;
    paginaId: string;
    paginaNome: string | null;
    conectadoEm: string;
    mensagensBloqueadas: boolean;
    erro: string | null;
    erroEm: string | null;
    directNovo: 'lead' | 'ignorar';
  } | null;
  escolher:
    | { paginaId: string; paginaNome: string; usuario: string | null; seguidores: number | null }[]
    | null;
  directNovo: 'lead' | 'ignorar';
}

interface Numeros {
  comentaram: number;
  receberam: number;
  foraDoPrazo: number;
  erros: number;
  responderam: number;
  leads: number;
  whatsapp: number;
  reunioes: number;
  ganhos: number;
  valorGanho: number;
}

interface Regra extends Partial<Numeros> {
  id: number;
  alvo: 'publicacao' | 'proxima' | 'todas';
  midiaId: string | null;
  midiaLegenda: string | null;
  midiaTipo: string | null;
  midiaLink: string | null;
  midiaImagem: string | null;
  midiaEm: string | null;
  palavras: string[];
  respostas: string[];
  mensagem: string;
  botaoTexto: string | null;
  botaoLink: string | null;
  iaContinua: boolean;
  avisar: boolean;
  etapaId: number | null;
  responsavelId: number | null;
  etiquetas: string[];
  ligada: boolean;
  criadoEm: string;
}

interface Pessoa {
  id: number;
  usuario: string | null;
  nome: string | null;
  comentario: string | null;
  comentadoEm: string;
  direct: 'enviado' | 'erro' | 'fora_do_prazo' | 'repetido';
  directErro: string | null;
  respostaPublica: boolean;
  respondeuEm: string | null;
  empresaId: number | null;
  leadNome: string | null;
  etapa: string | null;
  etapaNome: string | null;
  etapaCor: string | null;
  responsavelNome: string | null;
  iaConduzindo: boolean | null;
  temWhatsapp: boolean;
  reuniaoEm: string | null;
}

interface Publicacao {
  id: string;
  legenda: string | null;
  tipo: string | null;
  link: string | null;
  imagem: string | null;
  em: string | null;
  comentarios: number | null;
}

interface Pergunta {
  chave: string;
  rotulo: string;
  tipo: string;
  campo: CampoFormulario;
}

interface Formulario {
  id: number;
  formId: string;
  nome: string;
  perguntas: Pergunta[];
  ligado: boolean;
  etapaId: number | null;
  responsavelId: number | null;
  etiquetas: string[];
  boasVindas: string | null;
  avisar: boolean;
  cadastros: number | null;
  leads: number | null;
  atendidos: number | null;
  reunioes: number | null;
  anuncio: string | null;
  plataformas: string[] | null;
  ultimoNome: string | null;
  ultimoEmpresaId: number | null;
  ultimoEm: string | null;
  ultimoErro: string | null;
  ultimoTelefone: string | null;
}

/* ───────────────────────── Página ───────────────────────── */

type Aba = 'conteudo' | 'regras' | 'formularios' | 'conexao';
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'conteudo', rotulo: 'Conteúdo' },
  { id: 'regras', rotulo: 'Comente e receba' },
  { id: 'formularios', rotulo: 'Formulários' },
  { id: 'conexao', rotulo: 'Conexão' },
];

function useSituacao() {
  return useQuery({ queryKey: ['instagram'], queryFn: () => api<Situacao>('/instagram') });
}

export function Instagram() {
  const q = useSituacao();
  const [params, setParams] = useSearchParams();
  const sessao = useSessao();
  const admin = sessao.data?.papel === 'admin';
  const conectado = !!q.data?.conexao;
  const pedida = params.get('aba') as Aba | null;
  const aba: Aba = ABAS.some((a) => a.id === pedida) ? (pedida as Aba) : conectado ? 'conteudo' : 'conexao';
  const [novaRegra, setNovaRegra] = useState(false);
  // Volta do login na Meta: mostra o resultado uma vez e limpa o endereço.
  const [retorno] = useState(() => ({
    conectado: params.get('conectado') === '1',
    escolher: params.get('escolher') === '1',
    erro: params.get('erro'),
  }));
  // biome-ignore lint/correctness/useExhaustiveDependencies: só na chegada
  useEffect(() => {
    if (retorno.conectado || retorno.escolher || retorno.erro) setParams({ aba }, { replace: true });
  }, []);

  return (
    <>
      <div className="topo">
        <div>
          <h1>Instagram</h1>
          {q.data?.conexao ? (
            <p className="ig-conta">
              <IconeInstagram tamanho={16} cor />
              <b>@{q.data.conexao.usuario}</b>
              <span
                className={q.data.conexao.erro ? 'ig-ponto ig-ponto--erro' : 'ig-ponto'}
                aria-hidden="true"
              />
              {q.data.conexao.erro ? 'precisa conectar de novo' : 'conectado'}
              {q.data.conexao.paginaNome && (
                <span className="quieto"> · página {q.data.conexao.paginaNome}</span>
              )}
            </p>
          ) : (
            <p>
              Leads de quem comenta, manda direct ou preenche o formulário dos seus anúncios, direto no funil.
            </p>
          )}
        </div>
        <div className="topo__acoes">
          <LinkAjuda artigo="instagram">Como funciona</LinkAjuda>
          {admin && conectado && aba === 'regras' && (
            <Button variant="primary" icon="plus" onClick={() => setNovaRegra(true)}>
              Nova regra
            </Button>
          )}
        </div>
      </div>
      {retorno.conectado && <Mensagem tipo="ok">Instagram conectado. Agora crie a primeira regra.</Mensagem>}
      {retorno.erro && <Mensagem tipo="erro">Não deu para conectar: {retorno.erro}</Mensagem>}
      <div className="pipelines" role="tablist" aria-label="Seções do Instagram">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className="pipelines__aba"
            onClick={() => setParams({ aba: a.id }, { replace: true })}
          >
            {a.rotulo}
            {a.id === 'conexao' && (q.data?.conexao?.erro || q.data?.conexao?.mensagensBloqueadas) && (
              <span className="pipelines__conta pipelines__conta--nova">!</span>
            )}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : q.error || !q.data ? (
        <ErroDaApi erro={q.error} />
      ) : !q.data.configurado ? (
        <Mensagem tipo="aviso">
          A integração com o Instagram ainda não foi liberada na plataforma. Fale com o suporte do Prospect
          Team.
        </Mensagem>
      ) : aba === 'conexao' || !conectado ? (
        <AbaConexao s={q.data} admin={admin} />
      ) : aba === 'conteudo' ? (
        <AbaConteudo admin={admin} />
      ) : aba === 'formularios' ? (
        <AbaFormularios admin={admin} />
      ) : (
        <AbaRegras admin={admin} aoNova={() => setNovaRegra(true)} />
      )}
      {novaRegra && <FormRegra aoFechar={() => setNovaRegra(false)} />}
    </>
  );
}

/* ───────────────────────── Comente e receba ───────────────────────── */

const PERIODOS = [
  { dias: 7, rotulo: 'Últimos 7 dias' },
  { dias: 30, rotulo: 'Últimos 30 dias' },
  { dias: 90, rotulo: 'Últimos 90 dias' },
];

function useRegras(dias: number) {
  return useQuery({
    queryKey: ['instagram-regras', dias],
    queryFn: () =>
      api<{ dias: number; total: Numeros & { publicacoes: number }; regras: Regra[] }>(
        `/instagram/regras?dias=${dias}`,
      ),
    refetchInterval: 30_000,
  });
}

function AbaRegras(props: { admin: boolean; aoNova: () => void }) {
  const [dias, setDias] = useState(30);
  const q = useRegras(dias);
  const navegar = useNavigate();
  if (q.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  const t = q.data.total;
  return (
    <div className="ig">
      <div className="ig__titulo">
        <b>{PERIODOS.find((p) => p.dias === dias)?.rotulo}, todas as regras</b>
        <label className="pp-sr" htmlFor="ig-periodo">
          Período
        </label>
        <select
          id="ig-periodo"
          className="filtro"
          value={dias}
          onChange={(e) => setDias(Number(e.target.value))}
        >
          {PERIODOS.map((p) => (
            <option key={p.dias} value={p.dias}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="ig-funil">
        <div>
          <small>Comentaram a palavra</small>
          <b>{fmtNumero(t.comentaram)}</b>
          <span>
            em {fmtNumero(t.publicacoes)} {t.publicacoes === 1 ? 'publicação' : 'publicações'}
          </span>
        </div>
        <div>
          <small>Receberam o direct</small>
          <b>{fmtNumero(t.receberam)}</b>
          <span>
            {t.comentaram ? fmtPct(t.receberam, t.comentaram) : '—'}
            {t.foraDoPrazo ? ` · ${fmtNumero(t.foraDoPrazo)} fora do prazo` : ''}
            {t.erros ? ` · ${fmtNumero(t.erros)} com erro` : ''}
          </span>
        </div>
        <div>
          <small>Responderam no direct</small>
          <b>{fmtNumero(t.responderam)}</b>
          <span>{t.receberam ? `${fmtPct(t.responderam, t.receberam)} de quem recebeu` : '—'}</span>
        </div>
        <div>
          <small>Passaram o WhatsApp</small>
          <b>{fmtNumero(t.whatsapp)}</b>
          <span>{fmtNumero(t.leads)} viraram lead no funil</span>
        </div>
        <div>
          <small>Reuniões marcadas</small>
          <b>{fmtNumero(t.reunioes)}</b>
          <span className={t.ganhos ? 'ig-funil__ok' : undefined}>
            {t.ganhos ? `${fmtReais(t.valorGanho)}/mês ganhos` : 'nenhuma venda ainda'}
          </span>
        </div>
      </div>
      {!q.data.regras.length ? (
        <EmptyState
          icone="message-circle"
          titulo="Nenhuma regra ainda"
          texto='Escolha uma publicação e uma palavra ("comente PROSPECÇÃO"): quem comentar recebe o seu direct na hora, e quem responder vira lead no funil.'
          acao={
            props.admin ? (
              <Button variant="primary" icon="plus" onClick={props.aoNova}>
                Criar a primeira regra
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="pp-tablewrap">
          <table className="pp-table ig-tabela">
            <thead>
              <tr>
                <th>Publicação</th>
                <th>Palavras</th>
                <th className="num">Comentaram</th>
                <th className="num">Direct</th>
                <th className="num">Responderam</th>
                <th className="num">Leads</th>
                <th className="num">Reuniões</th>
                <th>Ligada</th>
              </tr>
            </thead>
            <tbody>
              {q.data.regras.map((r) => (
                <tr
                  key={r.id}
                  className="ig-tabela__linha"
                  onClick={() => navegar(`/instagram/regra/${r.id}`)}
                >
                  <td>
                    <Link
                      className="ig-post"
                      to={`/instagram/regra/${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Capa r={r} />
                      <span>
                        <b>{tituloDaRegra(r)}</b>
                        <small>{subtituloDaRegra(r)}</small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    {r.palavras.map((p) => (
                      <span key={p} className="ig-palavra">
                        {p}
                      </span>
                    ))}
                  </td>
                  <td className="num">{fmtNumero(r.comentaram ?? 0)}</td>
                  <td className="num">{fmtNumero(r.receberam ?? 0)}</td>
                  <td className="num">
                    {fmtNumero(r.responderam ?? 0)}
                    <span className="ig-barrinha" aria-hidden="true">
                      <i
                        style={{
                          width: `${r.receberam ? Math.min(100, ((r.responderam ?? 0) / r.receberam) * 100) : 0}%`,
                        }}
                      />
                    </span>
                  </td>
                  <td className="num">{fmtNumero(r.leads ?? 0)}</td>
                  <td className="num">{fmtNumero(r.reunioes ?? 0)}</td>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: só impede abrir a publicação ao ligar e desligar */}
                  <td onClick={(e) => e.stopPropagation()}>
                    <ChaveRegra r={r} desligado={!props.admin} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="quieto ig-nota">
        A palavra vale sem acento e sem diferença de maiúscula: “prospeccao”, “Prospecção” e “PROSPECÇÃO”
        contam igual. A Meta só deixa mandar o direct uma vez para cada comentário e até{' '}
        {PRAZO_RESPOSTA_PRIVADA_DIAS} dias depois dele (na live, só enquanto ela está no ar).
      </p>
    </div>
  );
}

const ROTULO_TIPO: Record<string, string> = {
  REELS: 'Reels',
  VIDEO: 'Vídeo',
  IMAGE: 'Foto',
  CAROUSEL_ALBUM: 'Carrossel',
};

function tituloDaRegra(r: Regra): string {
  if (r.alvo === 'todas') return 'Qualquer publicação';
  if (r.alvo === 'proxima' && !r.midiaId) return 'A próxima que você postar';
  return r.midiaLegenda?.split('\n')[0]?.slice(0, 70) || 'Publicação sem legenda';
}

function subtituloDaRegra(r: Regra): string {
  if (r.alvo === 'todas') return 'Vale para tudo o que você publicar';
  if (r.alvo === 'proxima' && !r.midiaId) return 'Liga sozinha na primeira publicação nova';
  return [
    r.midiaTipo && (ROTULO_TIPO[r.midiaTipo] ?? r.midiaTipo),
    r.midiaEm && `publicado ${fmtQuando(r.midiaEm)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

const CORES_CAPA = ['#0b6b63', '#7c3aed', '#b45309', '#1e40af', '#be123c', '#27272a'];

function Capa(props: {
  r: { midiaImagem: string | null; id: number; alvo: string; midiaLegenda: string | null };
  grande?: boolean;
}) {
  const { r } = props;
  const cor = CORES_CAPA[r.id % CORES_CAPA.length];
  return (
    <span className={props.grande ? 'ig-capa ig-capa--grande' : 'ig-capa'} style={{ background: cor }}>
      {r.midiaImagem ? (
        <img src={r.midiaImagem} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <Icon
          name={r.alvo === 'todas' ? 'layout-grid' : r.alvo === 'proxima' ? 'clock' : 'image'}
          size={props.grande ? 22 : 16}
        />
      )}
    </span>
  );
}

function ChaveRegra(props: { r: Regra; desligado?: boolean }) {
  const cliente = useQueryClient();
  const mudar = useMutation({
    mutationFn: (ligada: boolean) =>
      api(`/instagram/regras/${props.r.id}`, { metodo: 'PATCH', corpo: { ligada } }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['instagram-regras'] });
      cliente.invalidateQueries({ queryKey: ['instagram-regra', props.r.id] });
    },
  });
  const valor = mudar.isPending ? !!mudar.variables : props.r.ligada;
  return (
    <label className="chave-liga" title={valor ? 'Ligada: desligar' : 'Desligada: ligar'}>
      <input
        type="checkbox"
        checked={valor}
        disabled={props.desligado || mudar.isPending}
        onChange={(e) => mudar.mutate(e.target.checked)}
      />
      <span className="pp-sr">{valor ? 'Regra ligada' : 'Regra desligada'}</span>
    </label>
  );
}

/* ───── Nova regra / editar ───── */

interface CamposRegra {
  alvo: Regra['alvo'];
  midiaId: string | null;
  palavras: string[];
  respostas: { id: number; texto: string }[];
  mensagem: string;
  botaoTexto: string;
  botaoLink: string;
  iaContinua: boolean;
  avisar: boolean;
  etapaId: string;
  responsavelId: string;
  etiquetas: string[];
}

const MENSAGEM_PADRAO =
  'Oi, {nome}! Aqui está o que você pediu 👇\nQuer que eu te mande mais detalhes? Me passa seu WhatsApp.';

export function FormRegra(props: {
  regra?: Regra;
  /** Publicação já escolhida (o "Criar regra neste post" da análise de conteúdo). */
  midiaInicial?: string;
  aoFechar: () => void;
  aoSalvar?: (r: Regra) => void;
}) {
  const r = props.regra;
  const cliente = useQueryClient();
  const pipelines = usePipelines();
  const equipe = useEquipe();
  const sessao = useSessao();
  const [f, setF] = useState<CamposRegra>({
    alvo: r?.alvo ?? 'publicacao',
    midiaId: r?.midiaId ?? props.midiaInicial ?? null,
    palavras: r?.palavras ?? [],
    respostas: (r?.respostas.length ? r.respostas : ['Te mandei no direct, {nome}! 📩']).map((texto, id) => ({
      id,
      texto,
    })),
    mensagem: r?.mensagem ?? MENSAGEM_PADRAO,
    botaoTexto: r?.botaoTexto ?? '',
    botaoLink: r?.botaoLink ?? '',
    iaContinua: r?.iaContinua ?? false,
    avisar: r?.avisar ?? true,
    etapaId: r?.etapaId ? String(r.etapaId) : '',
    responsavelId: r?.responsavelId ? String(r.responsavelId) : '',
    etiquetas: r?.etiquetas ?? ['instagram'],
  });
  const [apagar, setApagar] = useState(false);
  const publicacoes = useQuery({
    queryKey: ['instagram-publicacoes'],
    queryFn: () => api<Publicacao[]>('/instagram/publicacoes'),
    enabled: f.alvo === 'publicacao',
    staleTime: 60_000,
  });
  const salvar = useMutation({
    mutationFn: () =>
      api<Regra>(r ? `/instagram/regras/${r.id}` : '/instagram/regras', {
        metodo: r ? 'PUT' : 'POST',
        corpo: {
          alvo: f.alvo,
          midiaId: f.alvo === 'publicacao' ? f.midiaId : null,
          palavras: f.palavras,
          respostas: f.respostas.map((x) => x.texto.trim()).filter(Boolean),
          mensagem: f.mensagem,
          botaoTexto: f.botaoTexto.trim() || null,
          botaoLink: f.botaoLink.trim() || null,
          iaContinua: f.iaContinua && temIa,
          avisar: f.avisar,
          etapaId: f.etapaId ? Number(f.etapaId) : null,
          responsavelId: f.responsavelId ? Number(f.responsavelId) : null,
          etiquetas: f.etiquetas,
          ligada: r?.ligada ?? true,
        },
      }),
    onSuccess: (nova) => {
      cliente.invalidateQueries({ queryKey: ['instagram-regras'] });
      cliente.setQueryData(['instagram-regra', nova.id], nova);
      props.aoSalvar?.(nova);
      props.aoFechar();
    },
  });
  const tirar = useMutation({
    mutationFn: () => api(`/instagram/regras/${r!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['instagram-regras'] });
      props.aoFechar();
      history.back();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };
  const set = <K extends keyof CamposRegra>(k: K, v: CamposRegra[K]) => setF((x) => ({ ...x, [k]: v }));
  const pessoas = (equipe.data?.usuarios ?? []).filter((u) => u.ativo);
  const pipeline = pipelines.data?.[0];
  const nomeExemplo = 'Marina';
  // A IA responder pelo direct é do módulo WhatsApp + Agente de IA.
  const temIa = sessao.data?.conta.modulos.includes('agente_ia') ?? true;
  const previa = f.mensagem.replace(/\{nome\}/gi, nomeExemplo);

  return (
    <Drawer
      titulo={r ? 'Editar regra' : 'Nova regra de comente e receba'}
      barra={r ? 'Editar regra' : 'Nova regra'}
      largo
      aoFechar={props.aoFechar}
    >
      <form className="ig-form" onSubmit={enviar}>
        <div className="ig-form__corpo">
          <div className="ig-form__campos">
            <fieldset className="campo">
              <legend>Em qual publicação</legend>
              <div className="ig-alvos">
                {(
                  [
                    ['publicacao', 'Uma publicação', 'escolha abaixo'],
                    ['proxima', 'A próxima que eu postar', 'liga sozinha'],
                    ['todas', 'Qualquer publicação', 'vale para todas'],
                  ] as const
                ).map(([id, titulo, sub]) => (
                  <button
                    key={id}
                    type="button"
                    className="ig-alvo"
                    aria-pressed={f.alvo === id}
                    onClick={() => set('alvo', id)}
                  >
                    <b>{titulo}</b>
                    <span>{sub}</span>
                  </button>
                ))}
              </div>
              {f.alvo === 'publicacao' &&
                (publicacoes.isPending ? (
                  <div className="esqueleto" style={{ height: 90 }} />
                ) : publicacoes.error ? (
                  <ErroDaApi erro={publicacoes.error} />
                ) : !publicacoes.data?.length ? (
                  <p className="quieto">Nenhuma publicação no perfil ainda.</p>
                ) : (
                  <div className="ig-posts">
                    {publicacoes.data.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={f.midiaId === p.id}
                        aria-label={p.legenda?.slice(0, 80) ?? 'Publicação sem legenda'}
                        className="ig-posts__item"
                        title={p.legenda ?? undefined}
                        style={{ background: CORES_CAPA[i % CORES_CAPA.length] }}
                        onClick={() => set('midiaId', p.id)}
                      >
                        {p.imagem ? (
                          <img src={p.imagem} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        ) : (
                          <span>{p.legenda?.slice(0, 24) ?? ROTULO_TIPO[p.tipo ?? ''] ?? 'Post'}</span>
                        )}
                        {p.tipo === 'REELS' && <Icon name="play" size={12} className="ig-posts__tipo" />}
                      </button>
                    ))}
                  </div>
                ))}
            </fieldset>
            <CampoEtiquetas
              id="ig-palavras"
              rotulo="Quando comentarem"
              valor={f.palavras}
              aoMudar={(v) => set('palavras', v)}
              placeholder="Digite a palavra e tecle Enter"
              dica="Sem acento e sem diferença de maiúscula. Vale a palavra sozinha ou no meio do comentário."
            />
            <div className="campo">
              <span className="campo__rotulo">
                Responder no comentário <span className="quieto">(aparece para todos · opcional)</span>
              </span>
              {f.respostas.map((x, i) => (
                <div key={x.id} className="ig-resposta">
                  <label className="pp-sr" htmlFor={`ig-resp-${i}`}>
                    Variação {i + 1}
                  </label>
                  <input
                    id={`ig-resp-${i}`}
                    className="filtro"
                    maxLength={300}
                    value={x.texto}
                    onChange={(e) =>
                      set(
                        'respostas',
                        f.respostas.map((y) => (y.id === x.id ? { ...y, texto: e.target.value } : y)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon="x"
                    aria-label="Tirar esta variação"
                    onClick={() =>
                      set(
                        'respostas',
                        f.respostas.filter((y) => y.id !== x.id),
                      )
                    }
                  />
                </div>
              ))}
              {f.respostas.length < 3 && (
                <button
                  type="button"
                  className="link-botao"
                  onClick={() => set('respostas', [...f.respostas, { id: Date.now(), texto: '' }])}
                >
                  + Variação (o sistema sorteia uma, para não repetir sempre a mesma frase)
                </button>
              )}
            </div>
            <div className="campo">
              <label htmlFor="ig-mensagem">Mensagem no direct</label>
              <textarea
                id="ig-mensagem"
                className="filtro"
                rows={4}
                maxLength={900}
                value={f.mensagem}
                onChange={(e) => set('mensagem', e.target.value)}
              />
              <span className="campo__dica">
                {'{nome}'} vira o primeiro nome de quem comentou (quando o Instagram mostra). A Meta só deixa
                mandar <b>uma</b> mensagem para quem comentou: a conversa continua quando a pessoa responder.
              </span>
            </div>
            <div className="form__duas">
              <div className="campo">
                <label htmlFor="ig-botao">Botão (opcional)</label>
                <input
                  id="ig-botao"
                  className="filtro"
                  maxLength={20}
                  placeholder="Baixar o checklist"
                  value={f.botaoTexto}
                  onChange={(e) => set('botaoTexto', e.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="ig-link">Link do botão</label>
                <input
                  id="ig-link"
                  className="filtro mono"
                  maxLength={500}
                  placeholder="suaempresa.com.br/material"
                  value={f.botaoLink}
                  onChange={(e) => set('botaoLink', e.target.value)}
                />
              </div>
            </div>
            <fieldset className="campo">
              <legend>Quando a pessoa responder</legend>
              <label className="opcao">
                <input
                  type="checkbox"
                  checked={f.iaContinua && temIa}
                  disabled={!temIa}
                  onChange={(e) => set('iaContinua', e.target.checked)}
                />
                <span>
                  <b>O Agente de IA continua a conversa</b> e pede o WhatsApp (segue o que você ensinou em
                  Agente de IA)
                  {!temIa && (
                    <span className="campo__dica" style={{ display: 'block' }}>
                      Precisa do módulo WhatsApp + Agente de IA. Sem ele, o time responde em Conversas.
                    </span>
                  )}
                </span>
              </label>
              <label className="opcao">
                <input type="checkbox" checked={f.avisar} onChange={(e) => set('avisar', e.target.checked)} />
                <span>
                  <b>Avisar o responsável</b> a cada resposta
                </span>
              </label>
            </fieldset>
          </div>
          <div className="ig-form__lado">
            <span className="campo__rotulo">Prévia do direct</span>
            <div className="ig-fone">
              <div className="ig-fone__topo">
                <span className="ig-fone__av" />
                <b>{sessao.data?.conta?.nome ?? 'Sua empresa'}</b>
              </div>
              <div className="ig-fone__corpo">
                <p className="ig-fone__nota">
                  Você comentou “<b>{f.palavras[0]?.toLowerCase() ?? 'palavra'}</b>”
                </p>
                <div className="ig-fone__bolha ig-fone__bolha--eu">
                  {previa}
                  {f.botaoTexto && <span className="ig-fone__botao">{f.botaoTexto}</span>}
                </div>
                <div className="ig-fone__bolha">quero sim! 71 99876-5432</div>
              </div>
            </div>
            <div className="campo">
              <label htmlFor="ig-etapa">O lead entra em</label>
              <select
                id="ig-etapa"
                className="filtro"
                value={f.etapaId}
                onChange={(e) => set('etapaId', e.target.value)}
              >
                <option value="">{pipeline?.etapas[0]?.nome ?? 'A abordar'} (padrão)</option>
                {pipelines.data?.map((p) => (
                  <optgroup key={p.id} label={p.nome}>
                    {p.etapas.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="ig-resp">Quem cuida</label>
              <select
                id="ig-resp"
                className="filtro"
                value={f.responsavelId}
                onChange={(e) => set('responsavelId', e.target.value)}
              >
                <option value="">Rodízio da equipe</option>
                {pessoas.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
            <CampoEtiquetas
              id="ig-etiquetas"
              rotulo="Etiquetas no lead"
              valor={f.etiquetas}
              aoMudar={(v) => set('etiquetas', v)}
            />
          </div>
        </div>
        <ErroDaApi erro={salvar.error ?? tirar.error} />
        <div className="ig-form__rodape">
          {r && (
            <Button type="button" variant="ghost" icon="trash-2" onClick={() => setApagar(true)}>
              Apagar
            </Button>
          )}
          <span className="quieto ig-form__teste">
            Para testar: comente a palavra na publicação com outra conta sua.
          </span>
          <Button type="button" variant="ghost" onClick={props.aoFechar}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={salvar.isPending || !f.palavras.length || (f.alvo === 'publicacao' && !f.midiaId)}
          >
            {salvar.isPending ? 'Salvando…' : r ? 'Salvar' : 'Ligar a regra'}
          </Button>
        </div>
      </form>
      {apagar && (
        <Modal
          titulo="Apagar esta regra?"
          aoFechar={() => setApagar(false)}
          rodape={
            <>
              <Button variant="ghost" onClick={() => setApagar(false)}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={tirar.isPending} onClick={() => tirar.mutate()}>
                Apagar a regra
              </Button>
            </>
          }
        >
          <p>Os leads que vieram dela continuam no funil. A lista de quem comentou some.</p>
        </Modal>
      )}
    </Drawer>
  );
}

/* ───── Uma publicação aberta ───── */

type FiltroPessoas = 'todos' | 'responderam' | 'nao' | 'fora';

export function InstagramRegra() {
  const { id } = useParams();
  const regraId = Number(id);
  const soLeitura = useSoLeitura();
  const sessao = useSessao();
  const admin = sessao.data?.papel === 'admin';
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [editar, setEditar] = useState(false);
  const [filtro, setFiltro] = useState<FiltroPessoas>('todos');
  const [busca, setBusca] = useState('');
  const q = useQuery({
    queryKey: ['instagram-regra', regraId],
    queryFn: () => api<Regra & Numeros & { pessoas: Pessoa[] }>(`/instagram/regras/${regraId}`),
    refetchInterval: 20_000,
  });
  const criarLead = useMutation({
    mutationFn: (interacaoId: number) =>
      api<{ empresaId: number }>(`/instagram/interacoes/${interacaoId}/lead`, { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['instagram-regra', regraId] }),
  });
  const pessoas = useMemo(() => {
    const lista = q.data?.pessoas ?? [];
    const b = busca.trim().toLowerCase().replace(/^@/, '');
    return lista.filter(
      (p) =>
        (filtro === 'todos' ||
          (filtro === 'responderam' && p.respondeuEm) ||
          (filtro === 'nao' && !p.respondeuEm && p.direct === 'enviado') ||
          (filtro === 'fora' && (p.direct === 'fora_do_prazo' || p.direct === 'erro'))) &&
        (!b || p.usuario?.toLowerCase().includes(b) || p.nome?.toLowerCase().includes(b)),
    );
  }, [q.data, filtro, busca]);
  if (q.isPending) return <div className="esqueleto" style={{ height: 360 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  const r = q.data;
  const contar = (f: FiltroPessoas) =>
    r.pessoas.filter((p) =>
      f === 'todos'
        ? true
        : f === 'responderam'
          ? p.respondeuEm
          : f === 'nao'
            ? !p.respondeuEm && p.direct === 'enviado'
            : p.direct === 'fora_do_prazo' || p.direct === 'erro',
    ).length;
  return (
    <>
      <Link to="/instagram" className="voltar">
        <Icon name="arrow-right" size={14} className="girar-180" /> Instagram
      </Link>
      <div className="topo ig-pub">
        <div className="ig-pub__quem">
          <Capa r={r} grande />
          <div>
            <h1>{tituloDaRegra(r)}</h1>
            <p className="ig-pub__sub">
              {subtituloDaRegra(r)}
              {' · '}
              {r.palavras.map((p) => (
                <span key={p} className="ig-palavra">
                  {p}
                </span>
              ))}
              <ChaveRegra r={r} desligado={!admin} />
              {r.ligada ? 'ligada' : 'desligada'}
            </p>
          </div>
        </div>
        <div className="topo__acoes">
          {r.midiaLink && (
            <a className="pp-btn" href={r.midiaLink} target="_blank" rel="noreferrer">
              <Icon name="external-link" size={16} /> Abrir no Instagram
            </a>
          )}
          {admin && (
            <Button variant="secondary" icon="settings" onClick={() => setEditar(true)}>
              Editar regra
            </Button>
          )}
        </div>
      </div>
      <div className="ig-funil ig-funil--pequeno">
        <div>
          <small>Comentaram</small>
          <b>{fmtNumero(r.comentaram)}</b>
        </div>
        <div>
          <small>Receberam o direct</small>
          <b>{fmtNumero(r.receberam)}</b>
        </div>
        <div>
          <small>Responderam</small>
          <b>{fmtNumero(r.responderam)}</b>
        </div>
        <div>
          <small>Viraram lead</small>
          <b>{fmtNumero(r.leads)}</b>
        </div>
        <div>
          <small>Reuniões</small>
          <b>{fmtNumero(r.reunioes)}</b>
        </div>
      </div>
      <div className="ig-filtros">
        <div className="segmentos" role="tablist" aria-label="Quem">
          {(
            [
              ['todos', 'Todos'],
              ['responderam', 'Responderam'],
              ['nao', 'Não responderam'],
              ['fora', 'Fora do prazo ou erro'],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filtro === id}
              className="segmento"
              data-ativo={filtro === id || undefined}
              onClick={() => setFiltro(id)}
            >
              {rotulo} {contar(id)}
            </button>
          ))}
        </div>
        <label className="pp-sr" htmlFor="ig-busca">
          Buscar
        </label>
        <input
          id="ig-busca"
          className="filtro"
          placeholder="Buscar @ ou nome"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      <ErroDaApi erro={criarLead.error} />
      {!r.pessoas.length ? (
        <EmptyState
          icone="message-circle"
          titulo="Ninguém comentou a palavra ainda"
          texto="Quando alguém comentar, aparece aqui: o comentário, se o direct foi, se respondeu e em que etapa do funil está."
        />
      ) : (
        <div className="pp-tablewrap">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Quem</th>
                <th>Comentário</th>
                <th>Direct</th>
                <th>Conversa</th>
                <th>No funil</th>
                <th>
                  <span className="pp-sr">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.nome ?? (p.usuario ? `@${p.usuario}` : 'Sem nome')}</b>
                    {p.usuario && <span className="ig-arroba">@{p.usuario}</span>}
                  </td>
                  <td>
                    “{p.comentario}”<span className="ig-quando">{fmtQuando(p.comentadoEm)}</span>
                  </td>
                  <td>
                    <SeloDirect p={p} />
                  </td>
                  <td>
                    {p.respondeuEm ? (
                      p.iaConduzindo && !p.temWhatsapp ? (
                        <Badge tone="warning">a IA está conversando</Badge>
                      ) : (
                        <>
                          <Badge tone="brand">respondeu</Badge>
                          {p.temWhatsapp && <span className="ig-quando">passou o WhatsApp</span>}
                        </>
                      )
                    ) : p.direct === 'enviado' ? (
                      <Badge>não respondeu</Badge>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                  <td>
                    {p.empresaId ? (
                      <>
                        <span className="ig-etapa">
                          <span
                            className="ponto-etapa"
                            style={{ background: p.etapaCor ?? '#94a3b8' }}
                            aria-hidden="true"
                          />
                          {p.etapaNome ?? p.etapa}
                        </span>
                        <span className="ig-quando">
                          {[p.responsavelNome, p.reuniaoEm && `reunião ${fmtCompromisso(p.reuniaoEm)}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </>
                    ) : (
                      <span className="quieto">ainda não</span>
                    )}
                  </td>
                  <td className="ig-acao">
                    {p.empresaId ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navegar(`/conversas?lead=${p.empresaId}`)}
                      >
                        Abrir conversa
                      </Button>
                    ) : (
                      !soLeitura && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={criarLead.isPending}
                          onClick={() => criarLead.mutate(p.id)}
                        >
                          Criar lead
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="quieto ig-nota">
        Quem não respondeu não vira lead sozinho (o Instagram só mostra o @ e o nome), mas dá para criar à mão
        com “Criar lead”. Quem respondeu já está em Conversas, no canal Instagram.
      </p>
      {editar && <FormRegra regra={r} aoFechar={() => setEditar(false)} />}
    </>
  );
}

function SeloDirect(props: { p: Pessoa }) {
  const { p } = props;
  if (p.direct === 'enviado') return <Badge tone="brand">✓ entregue</Badge>;
  if (p.direct === 'repetido') return <Badge>já tinha recebido</Badge>;
  if (p.direct === 'fora_do_prazo') return <Badge tone="warning">fora do prazo</Badge>;
  return (
    <span title={p.directErro ?? undefined}>
      <Badge tone="danger">não foi</Badge>
    </span>
  );
}

/* ───────────────────────── Formulários ───────────────────────── */

function AbaFormularios(props: { admin: boolean }) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['instagram-formularios'],
    queryFn: () => api<Formulario[]>('/instagram/formularios'),
    refetchInterval: 30_000,
  });
  const [config, setConfig] = useState<Formulario | null>(null);
  const sincronizar = useMutation({
    mutationFn: () =>
      api<{ novos: number; formularios: Formulario[] }>('/instagram/formularios/sincronizar', {
        metodo: 'POST',
      }),
    onSuccess: (r) => cliente.setQueryData(['instagram-formularios'], r.formularios),
  });
  if (q.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  return (
    <div className="ig">
      <div className="ig__titulo">
        <span className="quieto">
          Os cadastros dos formulários dos seus anúncios (Instagram e Facebook) caem sozinhos no funil, em
          segundos.
        </span>
        {props.admin && (
          <Button
            variant="secondary"
            icon={sincronizar.isPending ? 'loader' : 'refresh-cw'}
            disabled={sincronizar.isPending}
            onClick={() => sincronizar.mutate()}
          >
            Buscar formulários na Meta
          </Button>
        )}
      </div>
      <BlocoConversoes admin={props.admin} />
      <ErroDaApi erro={sincronizar.error} />
      {sincronizar.data && (
        <Mensagem tipo="ok">
          {sincronizar.data.novos
            ? `${sincronizar.data.novos} ${sincronizar.data.novos === 1 ? 'formulário novo' : 'formulários novos'}.`
            : 'Nenhum formulário novo.'}
        </Mensagem>
      )}
      {!q.data.length ? (
        <EmptyState
          icone="inbox"
          titulo="Nenhum formulário ainda"
          texto='Crie o anúncio com o objetivo "Cadastros" (formulário instantâneo) no Gerenciador de Anúncios e clique em Buscar formulários na Meta. O primeiro cadastro também traz o formulário sozinho.'
        />
      ) : (
        <div className="ig-forms">
          {q.data.map((f) => (
            <section key={f.id} className="ig-form-card">
              <header>
                <div>
                  <b>{f.nome}</b>
                  <span className="quieto">
                    {f.anuncio ? `Anúncio “${f.anuncio}”` : 'Sem cadastro ainda'}
                    {f.plataformas?.length
                      ? ` · ${f.plataformas.map((p) => (p === 'ig' ? 'Instagram' : p === 'fb' ? 'Facebook' : p)).join(' e ')}`
                      : ''}
                  </span>
                </div>
                <Badge tone={f.ligado ? 'brand' : 'neutral'}>{f.ligado ? 'ligado' : 'desligado'}</Badge>
              </header>
              <div className="ig-form-card__numeros">
                <div>
                  <small>Cadastros</small>
                  <b>{fmtNumero(f.cadastros ?? 0)}</b>
                </div>
                <div>
                  <small>Atendidos</small>
                  <b>{fmtNumero(f.atendidos ?? 0)}</b>
                </div>
                <div>
                  <small>Reuniões</small>
                  <b>{fmtNumero(f.reunioes ?? 0)}</b>
                </div>
              </div>
              <div className="ig-form-card__ultimo">
                <span className="ig-rotulo">Último cadastro</span>
                {f.ultimoEm ? (
                  <span>
                    {f.ultimoNome ?? 'Sem nome'}
                    {f.ultimoTelefone && (
                      <span className="mono"> · {formatarTelefone(f.ultimoTelefone)}</span>
                    )}{' '}
                    · {fmtQuando(f.ultimoEm)}{' '}
                    {f.ultimoEmpresaId ? (
                      <Link to={`/funil?empresa=${f.ultimoEmpresaId}`}>no funil</Link>
                    ) : (
                      <Badge tone="warning">{f.ultimoErro ?? 'não entrou'}</Badge>
                    )}
                  </span>
                ) : (
                  <span className="quieto">—</span>
                )}
              </div>
              <footer>
                <span className="quieto">
                  {f.perguntas.length} {f.perguntas.length === 1 ? 'pergunta' : 'perguntas'} ·{' '}
                  {f.etiquetas.join(', ') || 'sem etiqueta'}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setConfig(f)}>
                  {props.admin ? 'Configurar' : 'Ver'}
                </Button>
              </footer>
            </section>
          ))}
        </div>
      )}
      {config && <FormFormulario f={config} admin={props.admin} aoFechar={() => setConfig(null)} />}
    </div>
  );
}

function FormFormulario(props: { f: Formulario; admin: boolean; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const pipelines = usePipelines();
  const equipe = useEquipe();
  const [f, setF] = useState({
    ligado: props.f.ligado,
    perguntas: props.f.perguntas,
    etapaId: props.f.etapaId ? String(props.f.etapaId) : '',
    responsavelId: props.f.responsavelId ? String(props.f.responsavelId) : '',
    etiquetas: props.f.etiquetas,
    boasVindas: props.f.boasVindas ?? '',
    avisar: props.f.avisar,
  });
  const salvar = useMutation({
    mutationFn: () =>
      api<Formulario[]>(`/instagram/formularios/${props.f.id}`, {
        metodo: 'PUT',
        corpo: {
          ligado: f.ligado,
          perguntas: f.perguntas,
          etapaId: f.etapaId ? Number(f.etapaId) : null,
          responsavelId: f.responsavelId ? Number(f.responsavelId) : null,
          etiquetas: f.etiquetas,
          boasVindas: f.boasVindas.trim() || null,
          avisar: f.avisar,
        },
      }),
    onSuccess: (lista) => {
      cliente.setQueryData(['instagram-formularios'], lista);
      props.aoFechar();
    },
  });
  const pessoas = (equipe.data?.usuarios ?? []).filter((u) => u.ativo);
  const pipeline = pipelines.data?.[0];
  return (
    <Drawer titulo={props.f.nome} barra="Formulário" largo aoFechar={props.aoFechar}>
      <form
        className="drawer__corpo"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <div className="ig-form__cab">
          <h2>{props.f.nome}</h2>
          <label className="chave-liga chave-liga--texto">
            <input
              type="checkbox"
              checked={f.ligado}
              disabled={!props.admin}
              onChange={(e) => setF({ ...f, ligado: e.target.checked })}
            />
            <span>{f.ligado ? 'Os cadastros entram no funil' : 'Desligado: os cadastros não entram'}</span>
          </label>
        </div>
        <fieldset className="campo" disabled={!props.admin}>
          <legend>O que vai para onde</legend>
          <span className="campo__dica">O sistema já sugere pelo tipo de cada pergunta; dá para trocar.</span>
          <div className="ig-mapa">
            {f.perguntas.map((p, i) => (
              <div key={p.chave} className="ig-mapa__linha">
                <span className="ig-mapa__de">
                  {p.rotulo}
                  <small>{p.tipo === 'CUSTOM' ? 'pergunta sua' : 'pergunta do formulário'}</small>
                </span>
                <Icon name="arrow-right" size={14} />
                <label className="pp-sr" htmlFor={`ig-campo-${i}`}>
                  Campo para {p.rotulo}
                </label>
                <select
                  id={`ig-campo-${i}`}
                  className="filtro"
                  value={p.campo}
                  onChange={(e) =>
                    setF({
                      ...f,
                      perguntas: f.perguntas.map((x, j) =>
                        j === i ? { ...x, campo: e.target.value as CampoFormulario } : x,
                      ),
                    })
                  }
                >
                  {Object.entries(CAMPOS_FORMULARIO).map(([id, rotulo]) => (
                    <option key={id} value={id}>
                      {rotulo}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {!f.perguntas.length && (
              <p className="quieto">A Meta não mostrou as perguntas deste formulário.</p>
            )}
          </div>
        </fieldset>
        <fieldset className="form__duas" disabled={!props.admin}>
          <div className="campo">
            <label htmlFor="igf-etapa">O lead entra em</label>
            <select
              id="igf-etapa"
              className="filtro"
              value={f.etapaId}
              onChange={(e) => setF({ ...f, etapaId: e.target.value })}
            >
              <option value="">{pipeline?.etapas[0]?.nome ?? 'A abordar'} (padrão)</option>
              {pipelines.data?.map((p) => (
                <optgroup key={p.id} label={p.nome}>
                  {p.etapas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="igf-resp">Quem cuida</label>
            <select
              id="igf-resp"
              className="filtro"
              value={f.responsavelId}
              onChange={(e) => setF({ ...f, responsavelId: e.target.value })}
            >
              <option value="">Rodízio da equipe</option>
              {pessoas.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        <CampoEtiquetas
          id="igf-etiquetas"
          rotulo="Etiquetas no lead"
          valor={f.etiquetas}
          aoMudar={(v) => setF({ ...f, etiquetas: v })}
        />
        <div className="campo">
          <label htmlFor="igf-boas">WhatsApp de boas-vindas (opcional)</label>
          <textarea
            id="igf-boas"
            className="filtro"
            rows={3}
            maxLength={900}
            disabled={!props.admin}
            placeholder="Oi, {nome}! Recebemos seu cadastro. Posso te ligar hoje?"
            value={f.boasVindas}
            onChange={(e) => setF({ ...f, boasVindas: e.target.value })}
          />
          <span className="campo__dica">
            Sai pelo WhatsApp da conta assim que o lead chega (no horário do Agente). {'{nome}'} vira o
            primeiro nome.
          </span>
        </div>
        <label className="opcao">
          <input
            type="checkbox"
            checked={f.avisar}
            disabled={!props.admin}
            onChange={(e) => setF({ ...f, avisar: e.target.checked })}
          />
          <span>
            <b>Avisar o responsável</b> a cada cadastro
          </span>
        </label>
        <ErroDaApi erro={salvar.error} />
        {props.admin && (
          <div className="ig-form__rodape">
            <Button type="button" variant="ghost" onClick={props.aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={salvar.isPending}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        )}
      </form>
    </Drawer>
  );
}

/* ───────────────────────── Devolver as vendas para a Meta ───────────────────────── */

interface Conversoes {
  ligado: boolean;
  dataset: string | null;
  temToken: boolean;
  erro: string | null;
  erroEm: string | null;
  etapas: { id: string; evento: string; rotulo: string; enviados: number; pendentes: number }[];
  ultimos: {
    id: number;
    empresaId: number;
    nome: string | null;
    etapa: string;
    evento: string;
    enviadoEm: string | null;
    erro: string | null;
    tentativas: number;
  }[];
}

function BlocoConversoes(props: { admin: boolean }) {
  const [aberto, setAberto] = useState(false);
  const q = useQuery({
    queryKey: ['instagram-conversoes'],
    queryFn: () => api<Conversoes>('/instagram/conversoes'),
    refetchInterval: 60_000,
  });
  if (q.isPending) return <div className="esqueleto" style={{ height: 120 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  const c = q.data;
  return (
    <section className="ig-capi" aria-labelledby="ig-capi-titulo">
      <div className="ig-capi__cab">
        <span className="ig-capi__icone" aria-hidden="true">
          <Icon name="trending-up" size={18} />
        </span>
        <div className="ig-capi__texto">
          <h2 id="ig-capi-titulo">
            Devolver as vendas para a Meta{' '}
            <Badge tone={c.erro ? 'warning' : c.ligado ? 'brand' : 'neutral'}>
              {c.erro ? 'com erro' : c.ligado ? 'ligado' : 'desligado'}
            </Badge>
          </h2>
          <p className="quieto">
            Quando um cadastro de anúncio anda no funil, o CRM avisa a Meta. Ela aprende quem vira cliente
            (não só quem preenche) e passa a mostrar o anúncio para gente parecida.{' '}
            <LinkAjuda artigo="instagram">Como funciona</LinkAjuda>
          </p>
        </div>
        <Button variant={c.ligado ? 'secondary' : 'primary'} onClick={() => setAberto(true)}>
          {!props.admin ? 'Ver' : c.ligado ? 'Configurar' : 'Ligar'}
        </Button>
      </div>
      {c.erro && <Mensagem tipo="erro">{c.erro}</Mensagem>}
      {c.ligado && (
        <ol className="ig-capi__etapas" aria-label="Avisos à Meta nos últimos 30 dias">
          {c.etapas.map((e) => (
            <li key={e.id}>
              <small>{e.rotulo}</small>
              <b>{fmtNumero(e.enviados)}</b>
              {e.pendentes > 0 && <span className="quieto">{e.pendentes} na fila</span>}
            </li>
          ))}
        </ol>
      )}
      {aberto && <FormConversoes c={c} admin={props.admin} aoFechar={() => setAberto(false)} />}
    </section>
  );
}

function FormConversoes(props: { c: Conversoes; admin: boolean; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    ligado: props.c.ligado || !props.c.dataset,
    dataset: props.c.dataset ?? '',
    token: '',
  });
  const [codigo, setCodigo] = useState('');
  const salvar = useMutation({
    mutationFn: () =>
      api<Conversoes>('/instagram/conversoes', {
        metodo: 'PUT',
        corpo: { ligado: f.ligado, dataset: f.dataset.trim() || null, token: f.token.trim() || null },
      }),
    onSuccess: (r) => {
      cliente.setQueryData(['instagram-conversoes'], r);
      props.aoFechar();
    },
  });
  const testar = useMutation({
    mutationFn: () =>
      api<{ recebidos: number }>('/instagram/conversoes/testar', { metodo: 'POST', corpo: { codigo } }),
  });
  const ro = !props.admin;
  return (
    <Drawer titulo="Devolver as vendas para a Meta" barra="Formulários" largo aoFechar={props.aoFechar}>
      <form
        className="drawer__corpo"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <div className="ig-form__cab">
          <h2>Ligar ao seu conjunto de dados (pixel)</h2>
          <label className="chave-liga chave-liga--texto">
            <input
              type="checkbox"
              checked={f.ligado}
              disabled={ro}
              onChange={(e) => setF({ ...f, ligado: e.target.checked })}
            />
            <span>{f.ligado ? 'Avisando a Meta' : 'Desligado'}</span>
          </label>
        </div>
        <ol className="ig-capi__passos">
          <li>
            <div className="campo">
              <label htmlFor="capi-dataset">ID do conjunto de dados</label>
              <input
                id="capi-dataset"
                className="filtro mono"
                inputMode="numeric"
                autoComplete="off"
                maxLength={20}
                disabled={ro}
                placeholder="Ex.: 1234567890123456"
                value={f.dataset}
                onChange={(e) => setF({ ...f, dataset: e.target.value.replace(/\D/g, '') })}
              />
              <span className="campo__dica">
                No Gerenciador de Eventos da Meta, abra Fontes de dados, escolha o conjunto de dados (o mesmo
                pixel da conta de anúncios) e copie o número que aparece embaixo do nome.
              </span>
            </div>
          </li>
          <li>
            <div className="campo">
              <label htmlFor="capi-token">Token de acesso</label>
              <input
                id="capi-token"
                className="filtro mono"
                type="password"
                autoComplete="off"
                disabled={ro}
                placeholder={
                  props.c.temToken ? 'Já guardado. Cole um novo só para trocar.' : 'Cole o token aqui'
                }
                value={f.token}
                onChange={(e) => setF({ ...f, token: e.target.value })}
              />
              <span className="campo__dica">
                No mesmo conjunto de dados, vá em Configurações, procure API de Conversões e clique em Gerar
                token de acesso. Ele fica guardado cifrado e não aparece de novo aqui.
              </span>
            </div>
          </li>
        </ol>
        <Mensagem tipo="aviso">
          Vão para a Meta só os cadastros dos formulários de anúncio: cada etapa uma vez, na ordem (Chegou o
          cadastro, Respondeu, Reunião marcada, Proposta enviada, Virou cliente). Leads de comentário e de
          direct não vieram de anúncio e ficam de fora.
        </Mensagem>
        {props.c.temToken && props.c.dataset && (
          <fieldset className="campo ig-capi__teste">
            <legend>Testar agora</legend>
            <span className="campo__dica">
              No Gerenciador de Eventos, abra a aba Testar eventos do conjunto de dados, copie o código
              (começa com TEST) e mande um aviso de teste. Ele aparece lá em segundos e não conta para os
              anúncios.
            </span>
            <div className="ig-capi__teste-linha">
              <label className="pp-sr" htmlFor="capi-codigo">
                Código de teste
              </label>
              <input
                id="capi-codigo"
                className="filtro mono"
                autoComplete="off"
                placeholder="TEST12345"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.trim())}
              />
              <Button
                type="button"
                variant="secondary"
                icon={testar.isPending ? 'loader' : 'send'}
                disabled={!codigo || testar.isPending}
                onClick={() => testar.mutate()}
              >
                Mandar teste
              </Button>
            </div>
            <ErroDaApi erro={testar.error} />
            {testar.data && (
              <Mensagem tipo="ok">A Meta recebeu o teste. Confira na aba Testar eventos.</Mensagem>
            )}
          </fieldset>
        )}
        {props.c.ultimos.length > 0 && (
          <div className="campo">
            <span className="campo__rotulo">Últimos avisos</span>
            <ul className="ig-capi__ultimos">
              {props.c.ultimos.map((u) => (
                <li key={u.id}>
                  <span>
                    <b>{props.c.etapas.find((e) => e.id === u.etapa)?.rotulo ?? u.evento}</b> ·{' '}
                    <Link to={`/funil?empresa=${u.empresaId}`}>{u.nome ?? 'Lead'}</Link>
                  </span>
                  {u.enviadoEm ? (
                    <span className="quieto">{fmtQuando(u.enviadoEm)}</span>
                  ) : (
                    <Badge tone={u.erro ? 'warning' : 'neutral'}>
                      {u.erro ? `tentando de novo (${u.tentativas})` : 'na fila'}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ErroDaApi erro={salvar.error} />
        {props.admin && (
          <div className="ig-form__rodape">
            <Button type="button" variant="ghost" onClick={props.aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={salvar.isPending}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        )}
      </form>
    </Drawer>
  );
}

/* ───────────────────────── Conexão ───────────────────────── */

function AbaConexao(props: { s: Situacao; admin: boolean }) {
  const { s } = props;
  const c = s.conexao;
  const cliente = useQueryClient();
  const [desconectar, setDesconectar] = useState(false);
  const atualizar = (nova: Situacao) => cliente.setQueryData(['instagram'], nova);
  const conectar = useMutation({
    mutationFn: () => api<{ url: string }>('/instagram/conexao', { metodo: 'POST' }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
  });
  const escolher = useMutation({
    mutationFn: (paginaId: string) =>
      api<Situacao>('/instagram/conexao/escolher', { metodo: 'POST', corpo: { paginaId } }),
    onSuccess: atualizar,
  });
  const tirar = useMutation({
    mutationFn: () => api<Situacao>('/instagram/conexao', { metodo: 'DELETE' }),
    onSuccess: (r) => {
      atualizar(r);
      setDesconectar(false);
    },
  });
  const modo = useMutation({
    mutationFn: (directNovo: 'lead' | 'ignorar') =>
      api<Situacao>('/instagram/config', { metodo: 'PUT', corpo: { directNovo } }),
    onSuccess: atualizar,
  });

  const botaoConectar = (rotulo: string, principal = true) =>
    props.admin ? (
      <Button
        variant={principal ? 'primary' : 'secondary'}
        disabled={conectar.isPending}
        onClick={() => conectar.mutate()}
      >
        <IconeInstagram tamanho={16} /> {conectar.isPending ? 'Abrindo a Meta…' : rotulo}
      </Button>
    ) : (
      <p className="quieto">Só o administrador conecta o Instagram.</p>
    );

  if (s.escolher?.length)
    return (
      <section className="pp-panel ig-conexao">
        <h2>Qual conta do Instagram?</h2>
        <p className="quieto">Você liberou mais de uma. Escolha a da empresa:</p>
        <div className="ig-opcoes">
          {s.escolher.map((o) => (
            <button
              key={o.paginaId}
              type="button"
              className="ig-alvo"
              disabled={!props.admin || escolher.isPending}
              onClick={() => escolher.mutate(o.paginaId)}
            >
              <b>@{o.usuario ?? 'sem nome'}</b>
              <span>
                página {o.paginaNome}
                {o.seguidores != null ? ` · ${fmtNumero(o.seguidores)} seguidores` : ''}
              </span>
            </button>
          ))}
        </div>
        <ErroDaApi erro={escolher.error} />
      </section>
    );

  if (!c)
    return (
      <div className="ig-conexao-vazia">
        <section className="pp-panel ig-conexao">
          <h2>Conecte o Instagram da empresa</h2>
          <p>
            Precisa ser conta <b>profissional</b> (comercial ou criador) e estar ligada à{' '}
            <b>página do Facebook</b> da empresa. Você entra com o Facebook de quem administra a página e
            escolhe a conta. O Prospect Team só lê comentários, mensagens e cadastros; não publica nada.
          </p>
          <ErroDaApi erro={conectar.error} />
          {botaoConectar('Conectar Instagram')}
        </section>
        <section className="pp-panel ig-conexao">
          <h3>O que passa a funcionar</h3>
          <ul className="ig-lista">
            <li>
              <b>Comente e receba</b>: quem comenta a palavra recebe o seu direct; quem responde vira lead.
            </li>
            <li>
              <b>Direct em Conversas</b>: responda pelo CRM (até {JANELA_DIRECT_HORAS} h depois da última
              mensagem da pessoa) ou deixe o Agente de IA conversar.
            </li>
            <li>
              <b>Formulários dos anúncios</b>: o cadastro cai no funil com nome, telefone e o anúncio de onde
              veio.
            </li>
          </ul>
        </section>
      </div>
    );

  return (
    <div className="ig-conexao-vazia">
      <section className="pp-panel ig-conexao">
        {c.erro && <Mensagem tipo="erro">{c.erro}</Mensagem>}
        <ul className="ig-passos">
          <Passo ok titulo="Conta profissional do Instagram">
            @{c.usuario}
            {c.seguidores != null && ` · ${fmtNumero(c.seguidores)} seguidores`}
          </Passo>
          <Passo ok titulo="Página do Facebook ligada">
            {c.paginaNome} · é por ela que chegam os cadastros dos anúncios
          </Passo>
          <Passo ok={!c.erro} titulo="Permissões">
            {c.erro
              ? 'A Meta não aceita mais o acesso: conecte de novo.'
              : 'Ler comentários · mandar e receber direct · receber os cadastros'}
          </Passo>
          <Passo ok={!c.mensagensBloqueadas} titulo="Mensagens liberadas no Instagram">
            {c.mensagensBloqueadas ? (
              <>
                O Instagram recusou o direct. No app: Configurações › Mensagens e respostas a stories ›
                Ferramentas conectadas › ligue <b>“Permitir acesso às mensagens”</b>. Depois clique em
                Reconectar.
              </>
            ) : (
              <>
                Se o direct não chegar, confira no app: Configurações › Mensagens e respostas a stories ›
                Ferramentas conectadas › “Permitir acesso às mensagens”.
              </>
            )}
          </Passo>
        </ul>
        <p className="quieto">Conectado {fmtQuando(c.conectadoEm)}.</p>
        {props.admin && (
          <div className="ig-conexao__acoes">
            {botaoConectar('Reconectar', false)}
            <Button variant="ghost" className="ig-perigo" onClick={() => setDesconectar(true)}>
              Desconectar
            </Button>
          </div>
        )}
        <ErroDaApi erro={conectar.error ?? tirar.error} />
      </section>
      <section className="pp-panel ig-conexao">
        <h3>Direct de quem não comentou</h3>
        <p className="quieto">Alguém mandou mensagem direto, sem comentar em nenhuma regra:</p>
        <fieldset className="ig-modos" disabled={!props.admin || modo.isPending}>
          <label className="opcao">
            <input
              type="radio"
              name="ig-direct"
              checked={s.directNovo === 'lead'}
              onChange={() => modo.mutate('lead')}
            />
            <span>
              <b>Vira lead no funil</b> e a conversa aparece em Conversas
            </span>
          </label>
          <label className="opcao">
            <input
              type="radio"
              name="ig-direct"
              checked={s.directNovo === 'ignorar'}
              onChange={() => modo.mutate('ignorar')}
            />
            <span>
              <b>Fica só no Instagram</b> (o CRM só traz quem comentou ou já é lead)
            </span>
          </label>
        </fieldset>
        <ErroDaApi erro={modo.error} />
      </section>
      {desconectar && (
        <Modal
          titulo="Desconectar o Instagram?"
          aoFechar={() => setDesconectar(false)}
          rodape={
            <>
              <Button variant="ghost" onClick={() => setDesconectar(false)}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={tirar.isPending} onClick={() => tirar.mutate()}>
                Desconectar
              </Button>
            </>
          }
        >
          <p>
            Os comentários param de mandar direct e os cadastros dos anúncios param de chegar. As regras, os
            leads e as conversas ficam guardados.
          </p>
        </Modal>
      )}
    </div>
  );
}

function Passo(props: { ok: boolean; titulo: string; children: ReactNode }) {
  return (
    <li className="ig-passo">
      <span className={props.ok ? 'ig-passo__n' : 'ig-passo__n ig-passo__n--atencao'} aria-hidden="true">
        {props.ok ? <Icon name="check" size={13} /> : '!'}
      </span>
      <div>
        <b>{props.titulo}</b>
        <small>{props.children}</small>
      </div>
    </li>
  );
}
