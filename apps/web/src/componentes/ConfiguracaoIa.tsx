import {
  faltandoNaSecao,
  GATILHOS_PASSAGEM,
  type GatilhoPassagem,
  METAS_CONVERSA,
  type PerfilIa,
  type PerfilIaTela,
  POLITICAS_PRECO,
  ROTULO_META,
  ROTULO_POLITICA_PRECO,
  ROTULO_TOM,
  type SecaoIa,
  type SecaoStatusIa,
  type SugestaoIaDTO,
  TONS,
} from '@prospeccao/shared/ia-perfil';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, type ConfigAgente } from '../api';
import { fmtQuando } from '../formatar';
import { Modal } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';
import { CHAVE_IA, ProvaIa } from './ProvaIa';
import { useEhAdmin, useEquipe } from './Sessao';

/**
 * Configuração da IA de atendimento: o gestor preenche e confere cada seção; a IA pode sugerir,
 * mas a sugestão só vale aceita. Com tudo conferido, a base com conteúdo e a prova aprovada, a IA
 * pode ser ligada.
 */

export { CHAVE_IA };

export function usePerfilIa() {
  return useQuery({ queryKey: CHAVE_IA, queryFn: () => api<PerfilIaTela>('/agente/ia'), staleTime: 15_000 });
}

type Passo = SecaoIa | 'visao' | 'base' | 'prova';

const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
];

const DICA_SECAO: Record<SecaoIa, string> = {
  quem: 'Como ela se apresenta e o jeito de escrever. As mensagens reais servem para imitar o estilo, nunca como fonte.',
  empresa: 'O que a empresa faz, para quem e por que escolher vocês. Diferencial com prova convence mais.',
  regiao: 'Onde vocês atendem. Lugar fora da lista ela não promete: passa para o time.',
  oferta: 'O que ela pode oferecer, o que deve dizer que vocês não fazem e como falar de preço.',
  objetivo: 'Aonde a conversa precisa chegar e o que ela descobre antes.',
  objecoes: 'O que o cliente costuma dizer e a resposta que vocês aprovam. Pelo menos as 3 mais comuns.',
  limites: 'O que ela nunca pode dizer e quando chama alguém do time.',
  reuniao: 'Como é a reunião que ela marca.',
};

function marcaDoPasso(s: SecaoStatusIa | undefined): { classe: string; sinal: string } {
  if (!s) return { classe: 'falta', sinal: '•' };
  if (s.conferida) return { classe: 'ok', sinal: '✓' };
  if (s.sugestoes) return { classe: 'sugestao', sinal: '!' };
  return { classe: 'falta', sinal: '•' };
}

/* ───────────── Peças de formulário ───────────── */

function Campo(props: {
  rotulo: string;
  obrigatorio?: boolean;
  dica?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>
        {props.rotulo}
        {props.obrigatorio && ' *'}
      </label>
      {props.children(id)}
      {props.dica && <span className="campo__dica">{props.dica}</span>}
    </div>
  );
}

/** Lista de textos: um por linha, com remover e um campo para acrescentar. */
function ListaTextos(props: {
  rotulo: string;
  obrigatorio?: boolean;
  dica?: string;
  itens: string[];
  aoMudar: (l: string[]) => void;
  placeholder?: string;
  longo?: boolean;
}) {
  const [novo, setNovo] = useState('');
  const id = useId();
  const add = () => {
    const v = novo.trim();
    if (!v) return;
    if (!props.itens.includes(v)) props.aoMudar([...props.itens, v]);
    setNovo('');
  };
  return (
    <fieldset className="ia-lista">
      <legend>
        {props.rotulo}
        {props.obrigatorio && ' *'}
      </legend>
      {props.dica && <p className="campo__dica">{props.dica}</p>}
      {props.itens.length > 0 && (
        <ul className="ia-lista__itens">
          {props.itens.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: textos podem se repetir na edição
            <li key={`${i}-${t.slice(0, 20)}`}>
              <span>{t}</span>
              <button
                type="button"
                className="botao-icone"
                aria-label={`Remover: ${t}`}
                onClick={() => props.aoMudar(props.itens.filter((_, j) => j !== i))}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ia-lista__novo">
        <label htmlFor={id} className="pp-sr">
          Acrescentar em {props.rotulo}
        </label>
        {props.longo ? (
          <textarea
            id={id}
            rows={2}
            value={novo}
            placeholder={props.placeholder}
            onChange={(e) => setNovo(e.target.value)}
          />
        ) : (
          <input
            id={id}
            className="filtro"
            value={novo}
            placeholder={props.placeholder}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        )}
        <Button size="sm" onClick={add} disabled={!novo.trim()}>
          Acrescentar
        </Button>
      </div>
    </fieldset>
  );
}

/** Lista de pares (diferencial + prova, linha + descrição, objeção + resposta). */
function ListaPares(props: {
  rotulo: string;
  obrigatorio?: boolean;
  dica?: string;
  rotuloA: string;
  rotuloB: string;
  bObrigatorio?: boolean;
  itens: { a: string; b: string }[];
  aoMudar: (l: { a: string; b: string }[]) => void;
}) {
  const id = useId();
  const mudar = (i: number, k: 'a' | 'b', v: string) =>
    props.aoMudar(props.itens.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <fieldset className="ia-lista">
      <legend>
        {props.rotulo}
        {props.obrigatorio && ' *'}
      </legend>
      {props.dica && <p className="campo__dica">{props.dica}</p>}
      {props.itens.map((x, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: itens editáveis sem id próprio
        <div key={i} className="ia-par">
          <div className="campo">
            <label htmlFor={`${id}-a-${i}`}>{props.rotuloA}</label>
            <input
              id={`${id}-a-${i}`}
              className="filtro"
              value={x.a}
              onChange={(e) => mudar(i, 'a', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor={`${id}-b-${i}`}>
              {props.rotuloB}
              {props.bObrigatorio && ' *'}
            </label>
            <textarea
              id={`${id}-b-${i}`}
              rows={2}
              value={x.b}
              onChange={(e) => mudar(i, 'b', e.target.value)}
            />
          </div>
          <button
            type="button"
            className="botao-icone ia-par__remover"
            aria-label={`Remover ${x.a || 'item'}`}
            onClick={() => props.aoMudar(props.itens.filter((_, j) => j !== i))}
          >
            <Icon name="trash-2" size={14} />
          </button>
        </div>
      ))}
      <div>
        <Button size="sm" icon="plus" onClick={() => props.aoMudar([...props.itens, { a: '', b: '' }])}>
          Acrescentar
        </Button>
      </div>
    </fieldset>
  );
}

function Escolha<T extends string>(props: {
  rotulo: string;
  obrigatorio?: boolean;
  opcoes: readonly T[];
  rotulos: Record<T, string>;
  valor: T | null;
  aoMudar: (v: T) => void;
}) {
  const nome = useId();
  return (
    <fieldset className="ia-escolha">
      <legend>
        {props.rotulo}
        {props.obrigatorio && ' *'}
      </legend>
      <div className="ia-escolha__opcoes">
        {props.opcoes.map((o) => (
          <label key={o} className="ia-escolha__opcao" data-marcada={props.valor === o || undefined}>
            <input type="radio" name={nome} checked={props.valor === o} onChange={() => props.aoMudar(o)} />
            {props.rotulos[o]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ───────────── Sugestões da IA ───────────── */

function textoDaSugestao(s: SugestaoIaDTO): { a: string; b: string | null } {
  if (typeof s.valor === 'string') return { a: s.valor, b: null };
  const v = s.valor as { a?: string; b?: string };
  return { a: v.a ?? '', b: v.b ?? null };
}

function CartaoSugestao(props: { s: SugestaoIaDTO; antesDeAplicar?: () => void }) {
  const { s } = props;
  const cliente = useQueryClient();
  const [editando, setEditando] = useState(false);
  const t = textoDaSugestao(s);
  const [a, setA] = useState(t.a);
  const [b, setB] = useState(t.b ?? '');
  const resolver = useMutation({
    mutationFn: (acao: 'aceitar' | 'descartar') =>
      api<PerfilIaTela>(`/agente/ia/sugestoes/${s.id}/${acao}`, {
        metodo: 'POST',
        corpo: acao === 'aceitar' && editando ? { valor: t.b === null ? a : { a, b } } : {},
      }),
    onSuccess: (d) => {
      props.antesDeAplicar?.();
      cliente.setQueryData(CHAVE_IA, d);
    },
  });
  return (
    <div className="ia-sugestao">
      <div className="ia-sugestao__topo">
        <Badge tone="warning">Sugestão da IA</Badge>
        <span className="quieto">{s.origem}</span>
      </div>
      {editando ? (
        <div className="pilha" style={{ gap: 8 }}>
          <label className="pp-sr" htmlFor={`sug-a-${s.id}`}>
            Texto sugerido
          </label>
          <textarea id={`sug-a-${s.id}`} rows={2} value={a} onChange={(e) => setA(e.target.value)} />
          {t.b !== null && (
            <>
              <label className="pp-sr" htmlFor={`sug-b-${s.id}`}>
                Complemento
              </label>
              <textarea id={`sug-b-${s.id}`} rows={2} value={b} onChange={(e) => setB(e.target.value)} />
            </>
          )}
        </div>
      ) : (
        <p className="ia-sugestao__texto">
          <b>{t.a}</b>
          {t.b ? ` · ${t.b}` : ''}
        </p>
      )}
      {s.trecho && <p className="ia-sugestao__fonte">De onde veio: “{s.trecho}”</p>}
      <div className="acoes">
        <Button
          size="sm"
          variant="primary"
          disabled={resolver.isPending || (editando && !a.trim())}
          onClick={() => resolver.mutate('aceitar')}
        >
          {editando ? 'Aceitar com a edição' : 'Aceitar'}
        </Button>
        {!editando && (
          <Button size="sm" variant="ghost" onClick={() => setEditando(true)}>
            Editar antes
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={resolver.isPending}
          onClick={() => resolver.mutate('descartar')}
        >
          Descartar
        </Button>
      </div>
      <ErroDaApi erro={resolver.error} />
    </div>
  );
}

/* ───────────── Preencher com IA ───────────── */

function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(arquivo);
  });
}

type FonteTipo = 'site' | 'arquivo' | 'texto' | 'base' | 'entrevista';

function PreencherComIa(props: { tela: PerfilIaTela; aoFechar: () => void; inicial?: FonteTipo }) {
  const cliente = useQueryClient();
  const [tipo, setTipo] = useState<FonteTipo>(props.inicial ?? 'site');
  const [url, setUrl] = useState(props.tela.fontes.site ?? '');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [texto, setTexto] = useState('');
  const [respostas, setRespostas] = useState<Record<number, string>>({});
  const perguntas = useQuery({
    queryKey: ['agente', 'ia', 'entrevista'],
    queryFn: () => api<{ perguntas: string[] }>('/agente/ia/entrevista'),
    enabled: tipo === 'entrevista',
  });
  const enviar = useMutation({
    mutationFn: async () => {
      const corpo =
        tipo === 'site'
          ? { tipo, url }
          : tipo === 'arquivo' && arquivo
            ? {
                tipo,
                nome: arquivo.name,
                mime: arquivo.type || 'application/octet-stream',
                base64: await lerBase64(arquivo),
              }
            : tipo === 'texto'
              ? { tipo, rotulo: 'Conversas reais da equipe', texto }
              : tipo === 'base'
                ? { tipo }
                : {
                    tipo,
                    respostas: (perguntas.data?.perguntas ?? [])
                      .map((p, i) => ({ pergunta: p, resposta: respostas[i] ?? '' }))
                      .filter((r) => r.resposta.trim()),
                  };
      return api<{ novas: number; lidas: number; tela: PerfilIaTela }>('/agente/ia/sugestoes', {
        metodo: 'POST',
        corpo,
      });
    },
    onSuccess: (d) => cliente.setQueryData(CHAVE_IA, d.tela),
  });
  const opcoes: { id: FonteTipo; titulo: string; dica: string }[] = [
    {
      id: 'site',
      titulo: 'Site da empresa',
      dica: 'A IA lê a página inicial e as de contato e "quem somos".',
    },
    { id: 'arquivo', titulo: 'Documento', dica: 'Apresentação, tabela, catálogo (PDF, TXT).' },
    {
      id: 'texto',
      titulo: 'Conversas reais da equipe',
      dica: 'Cole conversas exportadas do WhatsApp: tom, objeções e respostas que funcionam.',
    },
    { id: 'base', titulo: 'Base de conhecimento', dica: 'Usa o que já está cadastrado na base.' },
    { id: 'entrevista', titulo: 'Entrevista', dica: 'A IA pergunta o que falta; você responde aqui.' },
  ];
  const pode =
    tipo === 'site'
      ? url.trim().length > 4
      : tipo === 'arquivo'
        ? !!arquivo
        : tipo === 'texto'
          ? texto.trim().length >= 40
          : tipo === 'base'
            ? true
            : Object.values(respostas).some((r) => r.trim());

  return (
    <Modal
      titulo="Preencher com IA"
      subtitulo="A IA lê a fonte e escreve sugestões em cada seção, com o trecho de onde tirou. Nada vale até você aceitar."
      aoFechar={props.aoFechar}
      largura="larga"
      rodape={
        <>
          <Button variant="ghost" onClick={props.aoFechar}>
            {enviar.data ? 'Fechar' : 'Cancelar'}
          </Button>
          <Button
            variant="primary"
            icon="bot"
            disabled={!pode || enviar.isPending}
            onClick={() => enviar.mutate()}
          >
            {enviar.isPending ? 'Lendo e sugerindo…' : 'Gerar sugestões'}
          </Button>
        </>
      }
    >
      <div className="pilha" style={{ gap: 16 }}>
        <fieldset className="ia-fontes">
          <legend className="pp-sr">De onde a IA lê</legend>
          {opcoes.map((o) => (
            <label key={o.id} className="ia-fonte" data-marcada={tipo === o.id || undefined}>
              <input type="radio" name="ia-fonte" checked={tipo === o.id} onChange={() => setTipo(o.id)} />
              <span>
                <b>{o.titulo}</b>
                <span className="quieto">{o.dica}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {tipo === 'site' && (
          <Campo rotulo="Endereço do site">
            {(id) => (
              <input
                id={id}
                className="filtro"
                inputMode="url"
                placeholder="www.suaempresa.com.br"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Campo>
        )}
        {tipo === 'arquivo' && (
          <Campo rotulo="Arquivo (PDF, TXT, Markdown ou CSV, até 10 MB)">
            {(id) => (
              <input
                id={id}
                type="file"
                accept=".pdf,.txt,.md,.csv,application/pdf,text/plain"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
            )}
          </Campo>
        )}
        {tipo === 'texto' && (
          <Campo
            rotulo="Conversas"
            dica="No WhatsApp: abra a conversa › Mais › Exportar conversa › Sem mídia, e cole o texto aqui."
          >
            {(id) => <textarea id={id} rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} />}
          </Campo>
        )}
        {tipo === 'entrevista' &&
          (perguntas.isPending ? (
            <div className="esqueleto" />
          ) : perguntas.data?.perguntas.length ? (
            <div className="pilha" style={{ gap: 12 }}>
              {perguntas.data.perguntas.map((p, i) => (
                <Campo key={p} rotulo={p}>
                  {(id) => (
                    <textarea
                      id={id}
                      rows={2}
                      value={respostas[i] ?? ''}
                      onChange={(e) => setRespostas({ ...respostas, [i]: e.target.value })}
                    />
                  )}
                </Campo>
              ))}
            </div>
          ) : (
            <Mensagem tipo="ok">Não falta nada que a entrevista cubra. Confira as seções.</Mensagem>
          ))}
        <ErroDaApi erro={enviar.error} />
        {enviar.data && (
          <Mensagem tipo={enviar.data.novas ? 'ok' : 'aviso'}>
            {enviar.data.novas
              ? `${enviar.data.novas} sugestões novas nas seções. Abra cada seção para aceitar ou descartar.`
              : 'A IA não achou nada novo com fonte nessa leitura.'}
          </Mensagem>
        )}
      </div>
    </Modal>
  );
}

/* ───────────── Visão geral ───────────── */

const GARANTIAS = [
  [
    'Só usa o que está aqui.',
    'Preço, prazo, cidade ou condição que não estiver escrito ela não fala: chama alguém.',
  ],
  [
    'Cada resposta é conferida antes de sair.',
    'Uma segunda checagem procura, para cada afirmação, o trecho que a sustenta. Sem fonte, não envia.',
  ],
  ['Fora da região, não promete.', 'Lugar fora da lista de atendimento vira passagem para o time.'],
  ['Assume que é assistente.', 'Se perguntarem, diz que é a assistente virtual e oferece uma pessoa.'],
  ['O que ela não soube vira tarefa sua.', 'Cada dúvida sem resposta aparece em "O que falta ensinar".'],
];

function Anel(props: { pct: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`Prontidão: ${props.pct}%`}>
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="9" />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${(c * props.pct) / 100} ${c}`}
        transform="rotate(-90 48 48)"
      />
      <text x="48" y="54" textAnchor="middle" fontSize="20" fontWeight="600" fill="currentColor">
        {props.pct}%
      </text>
    </svg>
  );
}

function VisaoGeral(props: {
  tela: PerfilIaTela;
  config: ConfigAgente;
  ir: (p: Passo) => void;
  admin: boolean;
}) {
  const { tela } = props;
  const cliente = useQueryClient();
  const [preencher, setPreencher] = useState<FonteTipo | null>(null);
  const ligar = useMutation({
    mutationFn: (ligado: boolean) =>
      api('/agente/config', {
        metodo: 'PUT',
        corpo: {
          ligado,
          revisarAntes: props.config.revisarAntes,
          horaInicio: props.config.horaInicio,
          horaFim: props.config.horaFim,
          diasSemana: props.config.diasSemana,
          limiteDia: props.config.limiteDia,
          intervaloSeg: props.config.intervaloSeg,
          respostasDiaLead: props.config.respostasDiaLead,
          avisoPassagem: props.config.avisoPassagem,
        },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['agente'] });
    },
  });
  const conferidas = tela.secoes.filter((s) => s.conferida).length;
  return (
    <div className="pilha" style={{ gap: 20 }}>
      <section className="ia-prontidao" aria-label="Prontidão">
        <Anel pct={tela.prontidao} />
        <div className="ia-prontidao__texto">
          <h2>
            {tela.ligado
              ? 'A IA está ligada'
              : tela.pronto
                ? 'Tudo conferido: pode ligar a IA'
                : 'Ainda não dá para ligar a IA'}
          </h2>
          {tela.impedimentos.length > 0 ? (
            <ul>
              {tela.impedimentos.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : (
            <p>
              Tudo conferido por uma pessoa e a prova aprovada.
              {tela.provaDesatualizada && ' A configuração mudou depois da prova: vale rodar de novo.'}
            </p>
          )}
          <div className="acoes">
            <Badge tone="brand">
              {conferidas} de {tela.secoes.length} conferidas
            </Badge>
            {tela.sugestoes.length > 0 && (
              <Badge tone="warning">{tela.sugestoes.length} sugestões esperando você</Badge>
            )}
          </div>
        </div>
        {props.admin && (
          <div className="ia-prontidao__acao">
            {tela.ligado ? (
              <Button variant="ghost" disabled={ligar.isPending} onClick={() => ligar.mutate(false)}>
                Desligar a IA
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!tela.pronto || ligar.isPending}
                onClick={() => ligar.mutate(true)}
              >
                Ligar a IA
              </Button>
            )}
            {!tela.ligado && !tela.pronto && (
              <span className="quieto">Libera com tudo conferido e a prova aprovada</span>
            )}
          </div>
        )}
      </section>
      <ErroDaApi erro={ligar.error} />

      <div className="ia-visao">
        <section className="ia-visao__secoes" aria-labelledby="ia-secoes-titulo">
          <h2 id="ia-secoes-titulo" className="subtitulo">
            O que a IA precisa saber
          </h2>
          <div className="ia-cartoes">
            {tela.secoes.map((s, i) => {
              const tom = s.conferida ? 'brand' : s.sugestoes ? 'warning' : 'danger';
              return (
                <button key={s.id} type="button" className="ia-cartao" onClick={() => props.ir(s.id)}>
                  <span className="ia-cartao__topo">
                    <span className="mono quieto">{String(i + 1).padStart(2, '0')}</span>
                    <Badge tone={tom}>
                      {s.conferida ? 'Conferida' : s.sugestoes ? 'Sugestão para revisar' : 'Falta'}
                    </Badge>
                  </span>
                  <b>{s.titulo}</b>
                  <span className="ia-cartao__resumo">
                    {s.conferida
                      ? s.id === 'base' || s.id === 'prova'
                        ? 'Pronta'
                        : `Conferida por ${s.conferida.por} · ${fmtQuando(s.conferida.em)}`
                      : s.sugestoes
                        ? `${s.sugestoes} sugestões esperando você`
                        : (s.faltando[0] ?? 'Falta conferir')}
                  </span>
                  <span className="ia-cartao__barra" aria-hidden="true">
                    <span data-tom={tom} style={{ width: `${s.pct}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <aside className="ia-visao__lado">
          {props.admin && (
            <section className="ia-bloco" aria-labelledby="ia-preencher">
              <h2 id="ia-preencher">Preencher com IA</h2>
              <p className="quieto">
                A IA lê o que você der e escreve sugestões em cada seção. Nada vale até você aceitar.
              </p>
              {!tela.temIa && (
                <Mensagem tipo="aviso">A IA desta conta ainda não está ativa: fale com o suporte.</Mensagem>
              )}
              {(
                [
                  [
                    'site',
                    'globe',
                    'Site da empresa',
                    tela.fontes.site
                      ? `lido ${fmtQuando(tela.fontes.siteLidoEm ?? '')}`
                      : 'Página inicial, contato, quem somos',
                  ],
                  ['arquivo', 'file-text', 'Documentos', 'Apresentação, tabela, catálogo'],
                  [
                    'texto',
                    'message-circle',
                    'Conversas reais da equipe',
                    'Tom, objeções e respostas que funcionam',
                  ],
                  ['entrevista', 'bot', 'Entrevista', 'A IA pergunta o que falta'],
                ] as const
              ).map(([id, icone, titulo, dica]) => (
                <button
                  key={id}
                  type="button"
                  className="ia-fonte-botao"
                  disabled={!tela.temIa}
                  onClick={() => setPreencher(id)}
                >
                  <Icon name={icone} size={18} />
                  <span>
                    <b>{titulo}</b>
                    <span className="quieto">{dica}</span>
                  </span>
                </button>
              ))}
            </section>
          )}
          <section className="ia-bloco" aria-labelledby="ia-garantias">
            <h2 id="ia-garantias">Como ela não inventa</h2>
            <ul className="ia-garantias">
              {GARANTIAS.map(([t, d]) => (
                <li key={t}>
                  <span className="ia-garantias__marca" aria-hidden="true">
                    <Icon name="check" size={12} />
                  </span>
                  <span>
                    <b>{t}</b> <span className="quieto">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      {preencher && <PreencherComIa tela={tela} inicial={preencher} aoFechar={() => setPreencher(null)} />}
    </div>
  );
}

/* ───────────── Editor de uma seção ───────────── */

function ComoUsa(props: { secao: SecaoIa; p: PerfilIa }) {
  const { p } = props;
  const pode: string[] = [];
  const nunca: string[] = [];
  switch (props.secao) {
    case 'quem':
      if (p.quem.nome)
        pode.push(
          `Se apresentar como ${p.quem.nome}${p.quem.apresentacao ? `, ${p.quem.apresentacao}` : ''}.`,
        );
      nunca.push('Negar que é uma assistente virtual, se perguntarem.');
      break;
    case 'empresa':
      if (p.empresa.oQueFaz) pode.push(p.empresa.oQueFaz);
      for (const d of p.empresa.diferenciais) pode.push(d.texto + (d.prova ? ` (${d.prova})` : ''));
      nunca.push('Número, cliente ou prêmio que não esteja aqui.');
      break;
    case 'regiao':
      pode.push(
        p.regiao.todoBrasil
          ? 'Que vocês atendem o Brasil todo.'
          : `Que atendem: ${[...p.regiao.ufs, ...p.regiao.cidades].join(', ') || '(nada ainda)'}.`,
      );
      if (!p.regiao.todoBrasil) nunca.push('Que atendem um lugar fora dessa lista (ela passa para o time).');
      break;
    case 'oferta':
      for (const l of p.oferta.linhas) pode.push(l.nome + (l.descricao ? `: ${l.descricao}` : ''));
      if (p.oferta.precoPolitica === 'so_o_escrito' && p.oferta.precoTexto) pode.push(p.oferta.precoTexto);
      if (p.oferta.pagamento) pode.push(p.oferta.pagamento);
      if (p.oferta.prazos) pode.push(p.oferta.prazos);
      for (const n of p.oferta.naoFazemos) nunca.push(`Que fazem: ${n.toLowerCase()}.`);
      nunca.push(
        p.oferta.precoPolitica === 'nunca'
          ? 'Qualquer valor.'
          : 'Preço de item, desconto ou condição especial.',
      );
      break;
    case 'objetivo':
      if (p.objetivo.meta) pode.push(`Levar a conversa para: ${ROTULO_META[p.objetivo.meta].toLowerCase()}.`);
      for (const q of p.objetivo.perguntas) pode.push(`Descobrir: ${q}`);
      nunca.push('Fazer todas as perguntas de uma vez.');
      break;
    case 'objecoes':
      for (const o of p.objecoes.itens) pode.push(`"${o.diz}" → ${o.resposta}`);
      break;
    case 'limites':
      for (const n of [...p.limites.nunca, ...p.limites.daProva]) nunca.push(n);
      for (const g of p.limites.gatilhos)
        pode.push(`Chamar o time quando: ${GATILHOS_PASSAGEM[g].toLowerCase()}.`);
      break;
    case 'reuniao':
      if (p.reuniao.horarios) pode.push(`Oferecer dois horários dentro de: ${p.reuniao.horarios}.`);
      nunca.push('Marcar fora desses horários.');
      break;
  }
  return (
    <aside className="ia-bloco ia-como" aria-label="Como a IA vai usar">
      <h2>Como a {p.quem.nome || 'IA'} vai usar isto</h2>
      <div>
        <span className="ia-como__rotulo ia-como__rotulo--pode">PODE DIZER</span>
        {pode.length ? (
          <ul>
            {pode.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <p className="quieto">Nada ainda.</p>
        )}
      </div>
      {nunca.length > 0 && (
        <div>
          <span className="ia-como__rotulo ia-como__rotulo--nunca">NUNCA VAI DIZER</span>
          <ul>
            {nunca.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="quieto" style={{ fontSize: 12 }}>
        Atualiza enquanto você edita. Para ver respostas de verdade, rode a prova.
      </p>
    </aside>
  );
}

function EditorSecao(props: { secao: SecaoIa; tela: PerfilIaTela; admin: boolean; proxima: () => void }) {
  const { secao, tela } = props;
  const cliente = useQueryClient();
  const equipe = useEquipe();
  const [p, setP] = useState<PerfilIa>(tela.perfil);
  // O que está sendo digitado nesta seção não se perde quando a tela recarrega (outra aba, sugestão
  // aceita em outra seção); salvou ou aceitou uma sugestão daqui, vale o que veio do servidor.
  const sujo = useRef(false);
  useEffect(
    () => setP((x) => ({ ...tela.perfil, [secao]: sujo.current ? x[secao] : tela.perfil[secao] })),
    [tela.perfil, secao],
  );
  const salvar = useMutation({
    mutationFn: (conferir: boolean) =>
      api<PerfilIaTela>(`/agente/ia/secoes/${secao}`, {
        metodo: 'PUT',
        corpo: { dados: p[secao], conferir },
      }),
    onSuccess: (d, conferir) => {
      sujo.current = false;
      cliente.setQueryData(CHAVE_IA, d);
      cliente.invalidateQueries({ queryKey: ['agente', 'ia', 'prova'] });
      if (conferir) props.proxima();
    },
  });
  const set = <K extends SecaoIa>(s: K, v: Partial<PerfilIa[K]>) => {
    sujo.current = true;
    setP((x) => ({ ...x, [s]: { ...x[s], ...v } }));
  };
  const status = tela.secoes.find((s) => s.id === secao);
  const faltando = faltandoNaSecao(p, secao);
  const sugestoes = tela.sugestoes.filter((s) => s.secao === secao);
  const idx = tela.secoes.findIndex((s) => s.id === secao);
  const desabilitado = !props.admin;

  let corpo: ReactNode = null;
  switch (secao) {
    case 'quem':
      corpo = (
        <>
          <div className="form__duas">
            <Campo
              rotulo="Nome de quem atende"
              obrigatorio
              dica="Ex.: Ana. Aparece na apresentação e na assinatura."
            >
              {(id) => (
                <input
                  id={id}
                  className="filtro"
                  value={p.quem.nome}
                  onChange={(e) => set('quem', { nome: e.target.value })}
                />
              )}
            </Campo>
            <Campo rotulo="Como se apresenta" obrigatorio dica='Ex.: "assistente virtual da Rota Norte".'>
              {(id) => (
                <input
                  id={id}
                  className="filtro"
                  value={p.quem.apresentacao}
                  onChange={(e) => set('quem', { apresentacao: e.target.value })}
                />
              )}
            </Campo>
          </div>
          <Escolha
            rotulo="Tom de voz"
            obrigatorio
            opcoes={TONS}
            rotulos={ROTULO_TOM}
            valor={p.quem.tom}
            aoMudar={(tom) => set('quem', { tom })}
          />
          <div className="form__duas">
            <Escolha
              rotulo="Tratamento"
              obrigatorio
              opcoes={['voce', 'senhor'] as const}
              rotulos={{ voce: 'Você', senhor: 'O senhor / a senhora' }}
              valor={p.quem.tratamento}
              aoMudar={(tratamento) => set('quem', { tratamento })}
            />
            <Escolha
              rotulo="Emojis"
              obrigatorio
              opcoes={['nunca', 'pouco'] as const}
              rotulos={{ nunca: 'Nunca', pouco: 'No máximo 1, quando combinar' }}
              valor={p.quem.emojis}
              aoMudar={(emojis) => set('quem', { emojis })}
            />
          </div>
          <ListaTextos
            rotulo="Mensagens reais da equipe (pelo menos 3)"
            obrigatorio
            longo
            dica="Copie mensagens que alguém da equipe mandou de verdade. A IA imita o jeito de escrever, nunca o conteúdo."
            itens={p.quem.exemplos}
            aoMudar={(exemplos) => set('quem', { exemplos })}
          />
        </>
      );
      break;
    case 'empresa':
      corpo = (
        <>
          <Campo rotulo="O que a empresa faz" obrigatorio>
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={p.empresa.oQueFaz}
                onChange={(e) => set('empresa', { oQueFaz: e.target.value })}
              />
            )}
          </Campo>
          <div className="form__duas">
            <Campo rotulo="Para quem vende" obrigatorio>
              {(id) => (
                <textarea
                  id={id}
                  rows={2}
                  value={p.empresa.paraQuem}
                  onChange={(e) => set('empresa', { paraQuem: e.target.value })}
                />
              )}
            </Campo>
            <Campo rotulo="Desde quando (opcional)">
              {(id) => (
                <input
                  id={id}
                  className="filtro"
                  value={p.empresa.desde}
                  onChange={(e) => set('empresa', { desde: e.target.value })}
                />
              )}
            </Campo>
          </div>
          <ListaPares
            rotulo="Diferenciais (pelo menos 2)"
            obrigatorio
            dica="Por que escolher vocês. A prova (número, tempo, garantia) deixa a fala mais forte."
            rotuloA="Diferencial"
            rotuloB="Prova (opcional)"
            itens={p.empresa.diferenciais.map((d) => ({ a: d.texto, b: d.prova }))}
            aoMudar={(l) => set('empresa', { diferenciais: l.map((x) => ({ texto: x.a, prova: x.b })) })}
          />
          <Campo rotulo="Horário de funcionamento" obrigatorio>
            {(id) => (
              <input
                id={id}
                className="filtro"
                value={p.empresa.funcionamento}
                onChange={(e) => set('empresa', { funcionamento: e.target.value })}
              />
            )}
          </Campo>
        </>
      );
      break;
    case 'regiao':
      corpo = (
        <>
          <label className="opcao">
            <input
              type="checkbox"
              checked={p.regiao.todoBrasil}
              onChange={(e) => set('regiao', { todoBrasil: e.target.checked })}
            />
            Atendemos o Brasil todo
          </label>
          {!p.regiao.todoBrasil && (
            <>
              <fieldset className="ia-lista">
                <legend>Estados</legend>
                <div className="ia-ufs">
                  {UFS.map((uf) => {
                    const on = p.regiao.ufs.includes(uf);
                    return (
                      <button
                        key={uf}
                        type="button"
                        className="ia-uf"
                        aria-pressed={on}
                        onClick={() =>
                          set('regiao', {
                            ufs: on ? p.regiao.ufs.filter((x) => x !== uf) : [...p.regiao.ufs, uf],
                          })
                        }
                      >
                        {uf}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <ListaTextos
                rotulo="Cidades (quando não é o estado todo)"
                placeholder="Ex.: Feira de Santana"
                itens={p.regiao.cidades}
                aoMudar={(cidades) => set('regiao', { cidades })}
              />
            </>
          )}
          <Campo rotulo="Observação (opcional)" dica="Ex.: interior da Bahia só com pedido mínimo maior.">
            {(id) => (
              <textarea
                id={id}
                rows={2}
                value={p.regiao.observacao}
                onChange={(e) => set('regiao', { observacao: e.target.value })}
              />
            )}
          </Campo>
        </>
      );
      break;
    case 'oferta':
      corpo = (
        <>
          <ListaPares
            rotulo="Linhas de produto ou serviço"
            obrigatorio
            rotuloA="Nome"
            rotuloB="Descrição e para quem serve"
            itens={p.oferta.linhas.map((l) => ({ a: l.nome, b: l.descricao }))}
            aoMudar={(l) => set('oferta', { linhas: l.map((x) => ({ nome: x.a, descricao: x.b })) })}
          />
          <ListaTextos
            rotulo="O que vocês NÃO fazem"
            obrigatorio
            dica='É o que mais evita promessa errada: ela responde "isso a gente não faz" em vez de inventar.'
            placeholder="Ex.: venda para consumidor final"
            itens={p.oferta.naoFazemos}
            aoMudar={(naoFazemos) => set('oferta', { naoFazemos })}
          />
          <Escolha
            rotulo="Como falar de preço"
            obrigatorio
            opcoes={POLITICAS_PRECO}
            rotulos={ROTULO_POLITICA_PRECO}
            valor={p.oferta.precoPolitica}
            aoMudar={(precoPolitica) => set('oferta', { precoPolitica })}
          />
          {p.oferta.precoPolitica && p.oferta.precoPolitica !== 'nunca' && (
            <Campo
              rotulo={
                p.oferta.precoPolitica === 'tabela'
                  ? 'Observação sobre a tabela'
                  : 'O que pode ser dito sobre preço'
              }
              obrigatorio={p.oferta.precoPolitica === 'so_o_escrito'}
              dica="Ex.: pedido mínimo de R$ 500. Desconto e preço por item: só com o time."
            >
              {(id) => (
                <textarea
                  id={id}
                  rows={2}
                  value={p.oferta.precoTexto}
                  onChange={(e) => set('oferta', { precoTexto: e.target.value })}
                />
              )}
            </Campo>
          )}
          <div className="form__duas">
            <Campo rotulo="Condições de pagamento" obrigatorio>
              {(id) => (
                <textarea
                  id={id}
                  rows={3}
                  value={p.oferta.pagamento}
                  onChange={(e) => set('oferta', { pagamento: e.target.value })}
                />
              )}
            </Campo>
            <Campo rotulo="Prazos de entrega ou de início" obrigatorio>
              {(id) => (
                <textarea
                  id={id}
                  rows={3}
                  value={p.oferta.prazos}
                  onChange={(e) => set('oferta', { prazos: e.target.value })}
                />
              )}
            </Campo>
          </div>
        </>
      );
      break;
    case 'objetivo':
      corpo = (
        <>
          <Escolha
            rotulo="Aonde a conversa precisa chegar"
            obrigatorio
            opcoes={METAS_CONVERSA}
            rotulos={ROTULO_META}
            valor={p.objetivo.meta}
            aoMudar={(meta) => set('objetivo', { meta })}
          />
          <Campo rotulo="Detalhe (opcional)" dica="Ex.: conversa de 15 minutos com o Paulo, por vídeo.">
            {(id) => (
              <input
                id={id}
                className="filtro"
                value={p.objetivo.metaTexto}
                onChange={(e) => set('objetivo', { metaTexto: e.target.value })}
              />
            )}
          </Campo>
          <ListaTextos
            rotulo="O que ela descobre antes de avançar"
            obrigatorio
            dica="Uma pergunta por mensagem, na ordem que fizer sentido na conversa."
            placeholder="Ex.: quanto compram por mês?"
            itens={p.objetivo.perguntas}
            aoMudar={(perguntas) => set('objetivo', { perguntas })}
          />
          <ListaTextos
            rotulo="Quando não vale seguir (opcional)"
            placeholder="Ex.: é MEI"
            itens={p.objetivo.desqualifica}
            aoMudar={(desqualifica) => set('objetivo', { desqualifica })}
          />
        </>
      );
      break;
    case 'objecoes':
      corpo = (
        <ListaPares
          rotulo="Objeções e respostas aprovadas (pelo menos 3)"
          obrigatorio
          rotuloA="Quando o cliente diz"
          rotuloB="A resposta aprovada"
          bObrigatorio
          itens={p.objecoes.itens.map((o) => ({ a: o.diz, b: o.resposta }))}
          aoMudar={(l) => set('objecoes', { itens: l.map((x) => ({ diz: x.a, resposta: x.b })) })}
        />
      );
      break;
    case 'limites':
      corpo = (
        <>
          <ListaTextos
            rotulo="Nunca dizer ou prometer"
            obrigatorio
            placeholder="Ex.: desconto, brinde ou condição especial"
            itens={p.limites.nunca}
            aoMudar={(nunca) => set('limites', { nunca })}
          />
          <fieldset className="ia-lista">
            <legend>Chamar alguém do time quando *</legend>
            {(Object.keys(GATILHOS_PASSAGEM) as GatilhoPassagem[]).map((g) => (
              <label key={g} className="opcao">
                <input
                  type="checkbox"
                  checked={p.limites.gatilhos.includes(g)}
                  onChange={(e) =>
                    set('limites', {
                      gatilhos: e.target.checked
                        ? [...p.limites.gatilhos, g]
                        : p.limites.gatilhos.filter((x) => x !== g),
                    })
                  }
                />
                {GATILHOS_PASSAGEM[g]}
              </label>
            ))}
          </fieldset>
          <ListaTextos
            rotulo="Outros casos (opcional)"
            itens={p.limites.outrosGatilhos}
            aoMudar={(outrosGatilhos) => set('limites', { outrosGatilhos })}
          />
          <div className="form__duas">
            <Campo rotulo="Quem recebe quando ela passa" obrigatorio>
              {(id) => (
                <select
                  id={id}
                  className="filtro"
                  value={p.limites.quemRecebe == null ? '' : String(p.limites.quemRecebe)}
                  onChange={(e) =>
                    set('limites', {
                      quemRecebe:
                        e.target.value === ''
                          ? null
                          : e.target.value === 'responsavel'
                            ? 'responsavel'
                            : Number(e.target.value),
                    })
                  }
                >
                  <option value="">Escolha…</option>
                  <option value="responsavel">O responsável pelo lead</option>
                  {equipe.data?.usuarios
                    .filter((u) => u.ativo)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome}
                      </option>
                    ))}
                </select>
              )}
            </Campo>
            <Campo
              rotulo="O que ela diz ao passar"
              obrigatorio
              dica="Sem prometer prazo que vocês não cumprem."
            >
              {(id) => (
                <textarea
                  id={id}
                  rows={2}
                  value={p.limites.fraseDePassagem}
                  onChange={(e) => set('limites', { fraseDePassagem: e.target.value })}
                />
              )}
            </Campo>
          </div>
          {p.limites.daProva.length > 0 && (
            <ListaTextos
              rotulo="Regras que vieram das correções da prova"
              itens={p.limites.daProva}
              aoMudar={(daProva) => set('limites', { daProva })}
            />
          )}
        </>
      );
      break;
    case 'reuniao':
      corpo = (
        <>
          <Escolha
            rotulo="Formato"
            obrigatorio
            opcoes={['video', 'presencial', 'ligacao'] as const}
            rotulos={{ video: 'Vídeo', presencial: 'Presencial', ligacao: 'Ligação' }}
            valor={p.reuniao.formato}
            aoMudar={(formato) => set('reuniao', { formato })}
          />
          <div className="form__duas">
            <Campo rotulo="Duração (minutos)" obrigatorio>
              {(id) => (
                <input
                  id={id}
                  className="filtro"
                  inputMode="numeric"
                  value={p.reuniao.duracaoMin ?? ''}
                  onChange={(e) =>
                    set('reuniao', { duracaoMin: Number(e.target.value.replace(/\D/g, '')) || null })
                  }
                />
              )}
            </Campo>
            <Campo
              rotulo="Horários livres"
              obrigatorio
              dica="Ex.: segunda a sexta, das 9h às 12h e das 14h às 17h."
            >
              {(id) => (
                <input
                  id={id}
                  className="filtro"
                  value={p.reuniao.horarios}
                  onChange={(e) => set('reuniao', { horarios: e.target.value })}
                />
              )}
            </Campo>
          </div>
          <div className="form__duas">
            <Campo rotulo="Quem participa (opcional)">
              {(id) => (
                <input
                  id={id}
                  className="filtro"
                  value={p.reuniao.quemParticipa}
                  onChange={(e) => set('reuniao', { quemParticipa: e.target.value })}
                />
              )}
            </Campo>
            <Campo rotulo="Link fixo da reunião (opcional)">
              {(id) => (
                <input
                  id={id}
                  className="filtro"
                  inputMode="url"
                  value={p.reuniao.link}
                  onChange={(e) => set('reuniao', { link: e.target.value })}
                />
              )}
            </Campo>
          </div>
        </>
      );
      break;
  }

  return (
    <div className="ia-editor">
      <div className="ia-editor__principal">
        <header className="ia-editor__topo">
          <span className="quieto">
            Seção {idx + 1} de {tela.secoes.length}
          </span>
          <h2>{status?.titulo}</h2>
          <p className="quieto">{DICA_SECAO[secao]} Campos com * são obrigatórios.</p>
          {status?.conferida && (
            <Badge tone="brand">
              Conferida por {status.conferida.por} · {fmtQuando(status.conferida.em)}
            </Badge>
          )}
        </header>
        {sugestoes.length > 0 && (
          <section className="pilha" style={{ gap: 10 }} aria-label="Sugestões da IA para esta seção">
            {sugestoes.map((s) => (
              <CartaoSugestao
                key={s.id}
                s={s}
                antesDeAplicar={() => {
                  sujo.current = false;
                }}
              />
            ))}
          </section>
        )}
        <fieldset className="form ia-editor__campos" disabled={desabilitado}>
          {corpo}
        </fieldset>
        <ErroDaApi erro={salvar.error} />
        {props.admin && (
          <footer className="ia-editor__rodape">
            <span className={faltando.length || sugestoes.length ? 'ia-editor__falta' : 'quieto'}>
              {sugestoes.length
                ? `${sugestoes.length} sugestões esperando você antes de conferir`
                : faltando.length
                  ? `Falta: ${faltando.join('; ')}`
                  : 'Tudo preenchido. Leia com calma e marque como conferida.'}
            </span>
            <div className="acoes">
              <Button disabled={salvar.isPending} onClick={() => salvar.mutate(false)}>
                Salvar rascunho
              </Button>
              <Button
                variant="primary"
                disabled={salvar.isPending || faltando.length > 0 || sugestoes.length > 0}
                onClick={() => salvar.mutate(true)}
              >
                Marcar seção como conferida
              </Button>
            </div>
          </footer>
        )}
      </div>
      <ComoUsa secao={secao} p={p} />
    </div>
  );
}

/* ───────────── A aba ───────────── */

export function ConfiguracaoIa(props: { config: ConfigAgente; aoVerBase: () => void }) {
  const [params, setParams] = useSearchParams();
  const admin = useEhAdmin();
  const q = usePerfilIa();
  const passo = (params.get('secao') as Passo | null) ?? 'visao';
  const ir = (p: Passo) => {
    if (p === 'base') return props.aoVerBase();
    const n = new URLSearchParams(params);
    n.set('aba', 'configuracao');
    if (p === 'visao') n.delete('secao');
    else n.set('secao', p);
    setParams(n, { replace: true });
    window.scrollTo({ top: 0 });
  };
  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const tela = q.data;
  const ordem = tela.secoes.map((s) => s.id);
  const proxima = (atual: Passo) => {
    const i = ordem.indexOf(atual as SecaoStatusIa['id']);
    const seguinte = tela.secoes.slice(i + 1).find((s) => !s.conferida && s.id !== 'base');
    ir(seguinte ? seguinte.id : 'visao');
  };

  return (
    <div className="ia-config">
      <nav className="ia-passos" aria-label="Seções da configuração da IA">
        <button
          type="button"
          className="ia-passo"
          aria-current={passo === 'visao' ? 'page' : undefined}
          onClick={() => ir('visao')}
        >
          <span className="ia-passo__marca" data-tipo="visao" aria-hidden="true">
            <Icon name="layout-dashboard" size={12} />
          </span>
          Visão geral · {tela.prontidao}%
        </button>
        {tela.secoes.map((s) => {
          const m = marcaDoPasso(s);
          return (
            <button
              key={s.id}
              type="button"
              className="ia-passo"
              aria-current={passo === s.id ? 'page' : undefined}
              onClick={() => ir(s.id)}
            >
              <span className="ia-passo__marca" data-tipo={m.classe} aria-hidden="true">
                {m.sinal}
              </span>
              {s.titulo}
              <span className="pp-sr">{s.conferida ? ' (conferida)' : ' (falta)'}</span>
            </button>
          );
        })}
      </nav>
      <div className="ia-config__conteudo">
        {passo === 'visao' && <VisaoGeral tela={tela} config={props.config} ir={ir} admin={admin} />}
        {passo === 'prova' && <ProvaIa admin={admin} />}
        {passo !== 'visao' && passo !== 'prova' && passo !== 'base' && (
          <EditorSecao key={passo} secao={passo} tela={tela} admin={admin} proxima={() => proxima(passo)} />
        )}
      </div>
    </div>
  );
}
