import {
  ENTREGA,
  ENTREGAS,
  type Entrega,
  frasePromocao,
  LIMITE_ARQUIVO_DIRECT,
  type PublicacaoCarrossel,
  type RegraDoCarrossel,
  TIPOS_ARQUIVO_DIRECT,
} from '@prospeccao/shared/carrosseis-publicacao';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, ErroApi } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { usePipelines } from '../componentes/Pipelines';
import { useEquipe, useSessao } from '../componentes/Sessao';
import { fmtNumero, fmtQuando, formatarTelefone } from '../formatar';

/**
 * A aba Publicação do editor: o passo a passo para postar, a regra do Comente e receba que nasceu
 * com o carrossel (a palavra, o que vai no direct, para onde vai o lead) e o post, reconhecido
 * pela legenda ou escolhido à mão.
 */

export interface PostRecente {
  midiaId: string;
  legenda: string | null;
  tipo: string | null;
  imagem: string | null;
  link: string | null;
  em: string | null;
  comentarios: number | null;
}

export const usePublicacao = (id: number) =>
  useQuery({
    queryKey: ['carrosseis', id, 'publicacao'],
    queryFn: () => api<PublicacaoCarrossel>(`/carrosseis/${id}/publicacao`),
    // Esperando o post: confere de tempos em tempos (a rotina liga a regra quando o post aparece).
    refetchInterval: (q) => (q.state.data?.situacao === 'esperando' ? 60_000 : false),
  });

const ROTULO_TIPO: Record<string, string> = {
  REELS: 'Reels',
  VIDEO: 'Vídeo',
  IMAGE: 'Foto',
  CAROUSEL_ALBUM: 'Carrossel',
};

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const fmtBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

export function PainelPublicacao(props: {
  carrosselId: number;
  legenda: string;
  /** Salva o que está na tela antes de mexer no post (o carrossel muda de situação). */
  salvarAntes: () => Promise<void>;
  aoMudarSituacao: () => void;
  aoBaixar: () => void;
}) {
  const q = usePublicacao(props.carrosselId);
  const cliente = useQueryClient();
  const [escolher, setEscolher] = useState(false);
  const [copiado, setCopiado] = useState(false);
  // A troca de situação (publicado ou de volta) é vista pelo efeito abaixo.
  const atualizar = (p: PublicacaoCarrossel) => {
    cliente.setQueryData(['carrosseis', props.carrosselId, 'publicacao'], p);
    cliente.invalidateQueries({ queryKey: ['carrosseis', 'lista'] });
  };
  const post = useMutation({
    mutationFn: async (midiaId: string | null) => {
      await props.salvarAntes();
      return api<PublicacaoCarrossel>(`/carrosseis/${props.carrosselId}/publicacao/post`, {
        metodo: midiaId ? 'POST' : 'DELETE',
        corpo: midiaId ? { midiaId } : undefined,
      });
    },
    onSuccess: (p) => {
      setEscolher(false);
      atualizar(p);
    },
  });
  // A situação mudou sozinha (a rotina reconheceu o post enquanto a aba estava aberta).
  const situacao = q.data?.situacao;
  const vista = useRef(situacao);
  const aoMudar = useRef(props.aoMudarSituacao);
  aoMudar.current = props.aoMudarSituacao;
  useEffect(() => {
    if (!situacao) return;
    const antes = vista.current;
    vista.current = situacao;
    if (antes && antes !== situacao && (antes === 'publicado') !== (situacao === 'publicado'))
      aoMudar.current();
  }, [situacao]);

  if (q.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  const p = q.data;
  const palavra = p.regra?.palavras[0] ?? p.palavraDoSlide;

  const copiar = async () => {
    await navigator.clipboard?.writeText(props.legenda).catch(() => undefined);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };
  const acoesDePostar = (
    <div className="pub__acoes">
      <Button size="sm" variant="primary" icon="copy" onClick={copiar} disabled={!props.legenda.trim()}>
        {copiado ? 'Legenda copiada' : 'Copiar a legenda'}
      </Button>
      <Button size="sm" variant="secondary" icon="download" onClick={props.aoBaixar}>
        Baixar as imagens
      </Button>
    </div>
  );

  let topo: ReactNode;
  if (p.situacao === 'publicado') {
    topo = (
      <div className="pub__cartao">
        <div className="pub__titulo">
          <b>Publicado no Instagram</b>
          {p.regra && (
            <Badge tone={p.regra.ligada ? 'brand' : 'neutral'}>
              {p.regra.ligada ? 'regra ligada' : 'regra desligada'}
            </Badge>
          )}
        </div>
        {p.post && (
          <div className="pub__post">
            <span className="pub__capa" aria-hidden="true">
              {p.post.imagem ? (
                <img src={p.post.imagem} alt="" referrerPolicy="no-referrer" />
              ) : (
                <Icon name="image" size={18} />
              )}
            </span>
            <span className="pub__post-info">
              <span>
                {[
                  p.post.tipo && (ROTULO_TIPO[p.post.tipo] ?? p.post.tipo),
                  p.post.em && `postado ${fmtQuando(p.post.em)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {p.post.link && (
                <a href={p.post.link} target="_blank" rel="noreferrer">
                  Abrir o post no Instagram
                </a>
              )}
            </span>
          </div>
        )}
        {p.numeros && p.regra && (
          <dl className="pub__numeros">
            <div>
              <dt>Comentaram {palavra}</dt>
              <dd>{fmtNumero(p.numeros.comentaram)}</dd>
            </div>
            <div>
              <dt>Receberam o direct</dt>
              <dd>{fmtNumero(p.numeros.receberam)}</dd>
            </div>
            {p.regra.entrega !== 'conversa' && (
              <div>
                <dt>Abriram o link</dt>
                <dd>{fmtNumero(p.numeros.abriram)}</dd>
              </div>
            )}
            <div>
              <dt>Responderam</dt>
              <dd>{fmtNumero(p.numeros.responderam)}</dd>
            </div>
            <div>
              <dt>Viraram lead</dt>
              <dd>{fmtNumero(p.numeros.leads)}</dd>
            </div>
          </dl>
        )}
        <div className="pub__acoes">
          {p.regra && (
            <Link to={`/instagram/regra/${p.regra.id}`} className="botao-link">
              Ver quem comentou
            </Link>
          )}
          {p.regra && p.post && (
            <Button size="sm" variant="ghost" onClick={() => post.mutate(null)} disabled={post.isPending}>
              Não é este post
            </Button>
          )}
        </div>
        <span className="campo__dica">
          O carrossel ficou como Publicado e só para leitura. Para fazer outro parecido, use Duplicar na
          lista.
        </span>
      </div>
    );
  } else if (p.situacao === 'sem_instagram') {
    topo = (
      <div className="pub__cartao">
        <div className="pub__titulo">
          <b>{p.instagram.noPlano ? 'Falta conectar o Instagram' : 'O Comente e receba não está no plano'}</b>
          <Badge tone="neutral">regra parada</Badge>
        </div>
        <p className="pub__texto">
          {p.instagram.noPlano
            ? `O último slide pede para comentar ${palavra}, mas sem o Instagram conectado ninguém recebe o direct. A regra fica salva e começa a esperar o post assim que você conectar.`
            : `O último slide pede para comentar ${palavra}. Para o CRM responder quem comentar, o plano precisa ter o Instagram.`}
        </p>
        <div className="pub__acoes">
          {p.instagram.noPlano ? (
            <Link to="/instagram?aba=conexao" className="botao-link botao-link--prim">
              Conectar o Instagram
            </Link>
          ) : (
            <Link to="/meu-plano" className="botao-link botao-link--prim">
              Ver o plano
            </Link>
          )}
        </div>
        <span className="campo__dica">
          Para trocar a chamada do último slide, peça na Conversa ou edite o slide.
        </span>
      </div>
    );
  } else if (p.situacao === 'sem_regra') {
    topo = (
      <div className="pub__cartao">
        <div className="pub__titulo">
          <b>Postar no Instagram</b>
        </div>
        <ol className="pub__passos">
          <Passo ok={!!p.baixadoEm}>
            Baixar as imagens{p.baixadoEm ? ` · baixadas ${fmtQuando(p.baixadoEm)}` : ''}
          </Passo>
          <Passo ok={false}>Postar no Instagram com a legenda deste carrossel</Passo>
        </ol>
        {acoesDePostar}
        <span className="campo__dica">
          Para o CRM responder quem comentar, o botão do último slide precisa ser “Comente PALAVRA” (ex.:
          Comente QUERO).
        </span>
      </div>
    );
  } else {
    const esperando = p.situacao === 'esperando' || p.situacao === 'nao_achado';
    topo = (
      <div className={p.situacao === 'nao_achado' ? 'pub__cartao pub__cartao--aviso' : 'pub__cartao'}>
        <div className="pub__titulo">
          <b>
            {p.situacao === 'rascunho'
              ? 'Rascunho: a regra espera você terminar'
              : p.situacao === 'nao_achado'
                ? 'Ainda não vimos o post'
                : 'Esperando você postar'}
          </b>
          <Badge tone="warning">{p.situacao === 'rascunho' ? 'rascunho' : 'regra pronta'}</Badge>
        </div>
        {p.situacao === 'nao_achado' ? (
          <p className="pub__texto">
            O carrossel está pronto desde {p.esperandoDesde ? fmtQuando(p.esperandoDesde) : 'alguns dias'} e
            nenhum post do Instagram tem essa legenda. Se você já postou com outro texto, escolha o post
            abaixo. Se ainda vai postar, a regra continua esperando.
          </p>
        ) : (
          <ol className="pub__passos">
            <Passo ok>
              Regra do <b>{palavra}</b> criada com o direct abaixo
            </Passo>
            <Passo ok={!!p.baixadoEm}>
              {p.baixadoEm ? `Imagens baixadas ${fmtQuando(p.baixadoEm)}` : 'Baixar as imagens'}
            </Passo>
            {p.situacao === 'rascunho' && (
              <Passo ok={false}>Marcar o carrossel como pronto (botão lá em cima)</Passo>
            )}
            <Passo ok={false}>Postar no Instagram com a legenda deste carrossel</Passo>
            <Passo ok={false}>O CRM reconhece o post pela legenda e liga a regra sozinho</Passo>
          </ol>
        )}
        {!escolher && p.situacao !== 'nao_achado' && (
          <div className="pub__acoes">
            <Button size="sm" variant="primary" icon="copy" onClick={copiar} disabled={!props.legenda.trim()}>
              {copiado ? 'Legenda copiada' : 'Copiar a legenda'}
            </Button>
            {esperando || p.situacao === 'rascunho' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEscolher(true)}
                disabled={!p.instagram.conectado}
              >
                Já postei: escolher o post
              </Button>
            ) : null}
          </div>
        )}
        {(escolher || p.situacao === 'nao_achado') && (
          <EscolherPost
            palavra={palavra ?? ''}
            ocupado={post.isPending}
            aoEscolher={(id) => post.mutate(id)}
            aoFechar={p.situacao === 'nao_achado' ? undefined : () => setEscolher(false)}
          />
        )}
        <span className="campo__dica">
          {p.podeReconhecer
            ? `Pode trocar uma palavra ou outra na legenda ao postar: o CRM reconhece mesmo assim. Até o post aparecer, quem comentar ${palavra} em outra publicação não recebe nada.`
            : 'A legenda está curta demais para o CRM reconhecer o post sozinho: depois de postar, toque em “Já postei: escolher o post”.'}
        </span>
      </div>
    );
  }

  return (
    <div className="pub">
      {topo}
      {post.error && <ErroDaApi erro={post.error} />}
      {p.regra && p.instagram.noPlano && (
        <FormRegra
          key={p.regra.id}
          p={p}
          regra={p.regra}
          carrosselId={props.carrosselId}
          aoSalvar={atualizar}
        />
      )}
    </div>
  );
}

function Passo(props: { ok: boolean; children: ReactNode }) {
  return (
    <li className="pub__passo" data-ok={props.ok || undefined}>
      <Icon name={props.ok ? 'check' : 'circle-dashed'} size={16} />
      <span>
        {props.children}
        {!props.ok && <span className="pp-sr"> (falta)</span>}
      </span>
    </li>
  );
}

function EscolherPost(props: {
  palavra: string;
  ocupado: boolean;
  aoEscolher: (midiaId: string) => void;
  aoFechar?: () => void;
}) {
  const q = useQuery({
    queryKey: ['carrosseis', 'publicacao', 'posts'],
    queryFn: () => api<{ posts: PostRecente[] }>('/carrosseis/publicacao/posts'),
    staleTime: 30_000,
  });
  return (
    <div className="pub__escolher">
      <div className="pub__titulo">
        <span className="campo__rotulo">Últimas publicações</span>
        {props.aoFechar && (
          <button type="button" className="link-botao" onClick={props.aoFechar}>
            Cancelar
          </button>
        )}
      </div>
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 120 }} />
      ) : q.error ? (
        <ErroDaApi erro={q.error} />
      ) : !q.data?.posts.length ? (
        <p className="quieto">Nenhuma publicação no Instagram ainda.</p>
      ) : (
        <ul className="pub__posts">
          {q.data.posts.map((x) => (
            <li key={x.midiaId}>
              <span className="pub__capa pub__capa--p" aria-hidden="true">
                {x.imagem ? (
                  <img src={x.imagem} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <Icon name="image" size={14} />
                )}
              </span>
              <span className="pub__post-info">
                <span className="pub__legenda">{x.legenda?.split('\n')[0] || 'Sem legenda'}</span>
                <small>
                  {[
                    x.tipo && (ROTULO_TIPO[x.tipo] ?? x.tipo),
                    x.em && fmtQuando(x.em),
                    x.comentarios != null &&
                      `${fmtNumero(x.comentarios)} comentário${x.comentarios === 1 ? '' : 's'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => props.aoEscolher(x.midiaId)}
                disabled={props.ocupado}
              >
                É este
              </Button>
            </li>
          ))}
        </ul>
      )}
      <span className="campo__dica">
        Quem já comentou {props.palavra} no post escolhido, nos últimos 7 dias, também recebe o direct.
      </span>
    </div>
  );
}

/* ───────────────────────────── A regra ───────────────────────────── */

interface Campos {
  palavra: string;
  outras: string;
  entrega: Entrega;
  mensagem: string;
  botaoTexto: string;
  link: string;
  divulgarId: string;
  whatsapp: string;
  resposta: string;
  etapaId: string;
  responsavelId: string;
  iaContinua: boolean;
  ligada: boolean;
}

const camposDe = (r: RegraDoCarrossel, p: PublicacaoCarrossel): Campos => ({
  palavra: r.palavras[0] ?? '',
  outras: r.palavras.slice(1).join(', '),
  entrega: r.entrega,
  mensagem: r.mensagem,
  botaoTexto: r.botaoTexto,
  link: r.link,
  divulgarId: r.divulgarId ? String(r.divulgarId) : '',
  whatsapp: r.whatsapp || p.whatsappDaEmpresa || '',
  resposta: r.respostas[0] ?? '',
  etapaId: r.etapaId ? String(r.etapaId) : '',
  responsavelId: r.responsavelId ? String(r.responsavelId) : '',
  iaContinua: r.iaContinua,
  ligada: r.ligada,
});

function FormRegra(props: {
  p: PublicacaoCarrossel;
  regra: RegraDoCarrossel;
  carrosselId: number;
  aoSalvar: (p: PublicacaoCarrossel) => void;
}) {
  const { p, regra } = props;
  const [f, setF] = useState<Campos>(() => camposDe(regra, p));
  const [salvo, setSalvo] = useState(true);
  const [daRedatora, setDaRedatora] = useState(false);
  const pipelines = usePipelines();
  const equipe = useEquipe();
  const sessao = useSessao();
  const temIa = sessao.data?.conta.modulos.includes('agente_ia') ?? true;
  const pessoas = (equipe.data?.usuarios ?? []).filter((u) => u.ativo);
  const set = <K extends keyof Campos>(k: K, v: Campos[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setSalvo(false);
  };
  const promo = p.promocoes.find((x) => String(x.id) === f.divulgarId);

  const salvar = useMutation({
    mutationFn: () =>
      api<PublicacaoCarrossel>(`/carrosseis/${props.carrosselId}/publicacao`, {
        metodo: 'PUT',
        corpo: {
          palavras: [f.palavra, ...f.outras.split(/[,;\s]+/)].map((x) => x.trim()).filter(Boolean),
          respostas: f.resposta.trim() ? [f.resposta.trim()] : [],
          entrega: f.entrega,
          mensagem: f.mensagem,
          botaoTexto: f.botaoTexto,
          link: f.link,
          divulgarId: f.divulgarId ? Number(f.divulgarId) : null,
          whatsapp: f.whatsapp,
          iaContinua: f.iaContinua && temIa,
          etapaId: f.etapaId ? Number(f.etapaId) : null,
          responsavelId: f.responsavelId ? Number(f.responsavelId) : null,
          ligada: f.ligada,
        },
      }),
    onSuccess: (x) => {
      setSalvo(true);
      props.aoSalvar(x);
    },
  });
  const redatora = useMutation({
    mutationFn: () =>
      api<{ mensagem: string; botao: string; daRedatora: boolean }>(
        `/carrosseis/${props.carrosselId}/publicacao/direct`,
        {
          metodo: 'POST',
          corpo: {
            entrega: f.entrega,
            palavra: f.palavra || 'QUERO',
            divulgarId: f.entrega === 'promocao' && f.divulgarId ? Number(f.divulgarId) : null,
            material:
              f.entrega === 'link' ? f.link : f.entrega === 'arquivo' ? (regra.arquivo?.nome ?? '') : '',
          },
        },
      ),
    onSuccess: (x) => {
      setF((y) => ({ ...y, mensagem: x.mensagem, botaoTexto: x.botao || y.botaoTexto }));
      setDaRedatora(x.daRedatora);
      setSalvo(false);
    },
  });
  const arquivo = useMutation({
    mutationFn: async (a: File) => {
      if (!(TIPOS_ARQUIVO_DIRECT as readonly string[]).includes(a.type))
        throw new ErroApi(422, 'tipo', 'Envie um PDF, JPG ou PNG.');
      if (a.size > LIMITE_ARQUIVO_DIRECT) throw new ErroApi(422, 'tamanho', 'O arquivo pode ter até 10 MB.');
      const r = await fetch(`/api/carrosseis/${props.carrosselId}/publicacao/arquivo`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': a.type, 'x-nome-arquivo': encodeURIComponent(a.name) },
        body: a,
      });
      const dados = await r.json().catch(() => null);
      if (!r.ok)
        throw new ErroApi(
          r.status,
          dados?.erro?.codigo ?? 'erro',
          dados?.erro?.mensagem ?? 'Não deu para enviar o arquivo.',
        );
      return dados as PublicacaoCarrossel;
    },
    onSuccess: (x) => {
      props.aoSalvar(x);
      setF((y) => ({ ...y, entrega: 'arquivo', botaoTexto: y.botaoTexto || ENTREGA.arquivo.botao }));
    },
  });

  const trocarEntrega = (e: Entrega) => {
    setSalvo(false);
    setF((x) => {
      const botaoPadrao = Object.values(ENTREGA).some((d) => d.botao === x.botaoTexto) || !x.botaoTexto;
      return { ...x, entrega: e, botaoTexto: botaoPadrao ? ENTREGA[e].botao : x.botaoTexto };
    });
  };

  return (
    <form
      className="pub__form"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <span className="pub__secao">Quem comentar</span>
      <div className="form__duas">
        <div className="campo">
          <label htmlFor="pub-palavra">Palavra</label>
          <input
            id="pub-palavra"
            className="filtro mono"
            value={f.palavra}
            maxLength={40}
            onChange={(e) => set('palavra', e.target.value.replace(/\s+/g, '').toUpperCase())}
          />
        </div>
        <div className="campo">
          <label htmlFor="pub-outras">Também vale</label>
          <input
            id="pub-outras"
            className="filtro mono"
            value={f.outras}
            placeholder="separe por vírgula"
            onChange={(e) => set('outras', e.target.value.toUpperCase())}
          />
        </div>
      </div>
      <span className="campo__dica pub__dica-palavra">
        {p.palavraDoSlide && p.palavraDoSlide !== f.palavra
          ? `O botão do último slide diz “Comente ${p.palavraDoSlide}”: use a mesma palavra.`
          : 'A mesma do botão do último slide. Sem acento e sem diferença de maiúscula.'}
      </span>

      <fieldset className="campo">
        <legend>O que a pessoa recebe</legend>
        <div className="pub__entregas">
          {ENTREGAS.map((e) => (
            <label key={e} className="pub__entrega" data-ativo={f.entrega === e || undefined}>
              <input
                type="radio"
                name="pub-entrega"
                checked={f.entrega === e}
                onChange={() => trocarEntrega(e)}
              />
              <span>
                <b>{ENTREGA[e].nome}</b>
                <small>{ENTREGA[e].dica}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {f.entrega === 'link' && (
        <div className="campo">
          <label htmlFor="pub-link">Endereço do link</label>
          <input
            id="pub-link"
            className="filtro"
            value={f.link}
            placeholder="seusite.com.br/pagina"
            onChange={(e) => set('link', e.target.value)}
          />
        </div>
      )}
      {f.entrega === 'arquivo' && (
        <div className="campo">
          <span className="campo__rotulo">Arquivo</span>
          {regra.arquivo ? (
            <div className="pub__arquivo">
              <Icon name="file-text" size={18} />
              <span className="pub__post-info">
                <a
                  href={`/api/carrosseis/${props.carrosselId}/publicacao/arquivo`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {regra.arquivo.nome}
                </a>
                <small>
                  {regra.arquivo.tipo === 'application/pdf' ? 'PDF' : 'Imagem'} ·{' '}
                  {fmtBytes(regra.arquivo.bytes)}
                </small>
              </span>
              <label className="link-botao pub__trocar">
                Trocar
                <input
                  type="file"
                  className="pp-sr"
                  accept={TIPOS_ARQUIVO_DIRECT.join(',')}
                  onChange={(e) => e.target.files?.[0] && arquivo.mutate(e.target.files[0])}
                />
              </label>
            </div>
          ) : (
            <label className="pub__enviar">
              <Icon name="upload" size={18} />
              <span>
                {arquivo.isPending ? 'Enviando…' : 'Escolher o arquivo (PDF, JPG ou PNG até 10 MB)'}
              </span>
              <input
                type="file"
                className="pp-sr"
                accept={TIPOS_ARQUIVO_DIRECT.join(',')}
                disabled={arquivo.isPending}
                onChange={(e) => e.target.files?.[0] && arquivo.mutate(e.target.files[0])}
              />
            </label>
          )}
          <span className="campo__dica">O CRM guarda o arquivo e o botão do direct abre ele.</span>
          {arquivo.error && <ErroDaApi erro={arquivo.error} />}
        </div>
      )}
      {f.entrega === 'promocao' && (
        <>
          {p.promocoes.length ? (
            <div className="campo">
              <label htmlFor="pub-promo">Promoção</label>
              <select
                id="pub-promo"
                className="filtro"
                value={f.divulgarId}
                onChange={(e) => set('divulgarId', e.target.value)}
              >
                <option value="">Escolha a promoção</option>
                {p.promocoes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.titulo}
                    {x.precoPor ? `: ${x.precoPor}` : ''}
                  </option>
                ))}
              </select>
              {promo && (
                <span className="campo__dica">
                  Sai exatamente assim: {frasePromocao(promo) || 'sem preço cadastrado'}. O botão abre o
                  WhatsApp da empresa com o pedido já escrito.
                </span>
              )}
            </div>
          ) : (
            <Mensagem tipo="aviso">
              Nenhuma promoção cadastrada. Cadastre em Carrosséis › O que divulgar e volte aqui.
            </Mensagem>
          )}
          <div className="campo">
            <label htmlFor="pub-whats">WhatsApp</label>
            <input
              id="pub-whats"
              className="filtro mono"
              value={f.whatsapp}
              placeholder="(71) 99999-0000"
              onChange={(e) => set('whatsapp', e.target.value)}
              onBlur={() => f.whatsapp && set('whatsapp', formatarTelefone(f.whatsapp))}
            />
            {p.whatsappDaEmpresa && (
              <span className="campo__dica">O número conectado no CRM: as conversas caem em Conversas.</span>
            )}
          </div>
        </>
      )}

      <div className="campo">
        <div className="pub__rotulo-direct">
          <label htmlFor="pub-direct">Direct que a pessoa recebe</label>
          {daRedatora && (
            <span className="pub__redatora">
              <img src="/carrosseis/time/redatora.jpg" alt="" />
              escrito pela redatora
            </span>
          )}
        </div>
        <textarea
          id="pub-direct"
          className="filtro"
          rows={5}
          maxLength={900}
          value={f.mensagem}
          onChange={(e) => {
            set('mensagem', e.target.value);
            setDaRedatora(false);
          }}
        />
        <span className="campo__dica">
          {'{nome}'} vira o primeiro nome de quem comentou.
          {p.redatora && (
            <>
              {' '}
              <button
                type="button"
                className="link-botao"
                onClick={() => redatora.mutate()}
                disabled={redatora.isPending}
              >
                {redatora.isPending ? 'A redatora está escrevendo…' : 'Pedir à redatora para escrever'}
              </button>
            </>
          )}
        </span>
        {redatora.error && <ErroDaApi erro={redatora.error} />}
      </div>
      {f.entrega !== 'conversa' && (
        <div className="campo">
          <label htmlFor="pub-botao">Texto do botão</label>
          <input
            id="pub-botao"
            className="filtro"
            value={f.botaoTexto}
            maxLength={20}
            onChange={(e) => set('botaoTexto', e.target.value)}
          />
          <span className="campo__dica">Até 20 letras. Cada toque conta em “Abriram o link”.</span>
        </div>
      )}
      <div className="campo">
        <label htmlFor="pub-resposta">Resposta no comentário</label>
        <input
          id="pub-resposta"
          className="filtro"
          value={f.resposta}
          maxLength={300}
          placeholder="Deixe vazio para não responder em público"
          onChange={(e) => set('resposta', e.target.value)}
        />
      </div>

      <span className="pub__secao">Quem responder o direct</span>
      <div className="form__duas">
        <div className="campo">
          <label htmlFor="pub-etapa">Entra no funil em</label>
          <select
            id="pub-etapa"
            className="filtro"
            value={f.etapaId}
            onChange={(e) => set('etapaId', e.target.value)}
          >
            <option value="">{pipelines.data?.[0]?.etapas[0]?.nome ?? 'A abordar'} (padrão)</option>
            {pipelines.data?.map((pl) => (
              <optgroup key={pl.id} label={pl.nome}>
                {pl.etapas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="pub-resp">Quem atende</label>
          <select
            id="pub-resp"
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
      </div>
      <label className="opcao">
        <input
          type="checkbox"
          checked={f.iaContinua && temIa}
          disabled={!temIa}
          onChange={(e) => set('iaContinua', e.target.checked)}
        />
        <span>
          <b>A IA continua a conversa no direct</b>
          <span className="campo__dica" style={{ display: 'block' }}>
            {temIa
              ? 'Pede o WhatsApp e passa para a equipe quando a pessoa quiser comprar.'
              : 'Precisa do módulo WhatsApp + Agente de IA. Sem ele, a equipe responde em Conversas.'}
          </span>
        </span>
      </label>
      <label className="opcao">
        <input type="checkbox" checked={f.ligada} onChange={(e) => set('ligada', e.target.checked)} />
        <span>
          <b>Regra ligada</b>
        </span>
      </label>

      <ErroDaApi erro={salvar.error} />
      <div className="pub__rodape">
        <span className="quieto" aria-live="polite">
          {salvar.isPending ? 'Salvando…' : salvo ? 'Regra salva' : 'Alterações ainda não salvas'}
        </span>
        <Button type="submit" size="sm" variant={salvo ? 'secondary' : 'primary'} disabled={salvar.isPending}>
          Salvar a regra
        </Button>
      </div>
      <span className="campo__dica pub__nota">
        A regra também aparece em Instagram › Comente e receba, marcada com o nome deste carrossel.
        {p.instagram.usuario ? ` Responde pelo @${p.instagram.usuario}.` : ''}
      </span>
      {p.situacao === 'publicado' && regra.criadoEm && (
        <span className="campo__dica">Regra criada {fmtHora(regra.criadoEm)}.</span>
      )}
    </form>
  );
}
