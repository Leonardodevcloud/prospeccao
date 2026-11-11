import { MODULOS } from '@prospeccao/shared/planos';
import {
  ESTILOS_LEGENDA,
  type EstiloLegenda,
  fmtDuracao,
  MODOS_IMAGENS,
  type ModoImagens,
  type MusicaDoVideo,
  type OpcoesVideo,
  opcoesVideoEntrada,
  type ResumoVideo,
  RITMOS,
  type RitmoCortes,
  ROTULO_CHAMADA,
  ROTULO_MUSICA,
  ROTULO_SITUACAO_VIDEO,
  TIPOS_VIDEO,
  type TipoChamada,
} from '@prospeccao/shared/videos';
import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { LinkAjuda } from '../componentes/Ajuda';
import { Modal } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin } from '../componentes/Sessao';
import { fmtNumero, fmtQuando } from '../formatar';
import {
  duracaoDoArquivo,
  enviarVideo,
  type SituacaoVideos,
  useArquivo,
  useListaVideos,
  useSituacaoVideos,
} from '../video/dados';
import { FotosDaEmpresa } from '../video/Enfeites';

/**
 * Vídeos com IA (módulo à parte, só o administrador): a lista dos vídeos e o envio de um novo. A
 * revisão de cada vídeo fica em VideoDetalhe.
 */

export function Videos() {
  const admin = useEhAdmin();
  const situacao = useSituacaoVideos();
  // v138: a página é a biblioteca; o "Novo vídeo" abre numa janela grande no centro.
  const [novo, setNovo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const fecharNovo = () => {
    if (enviando && !window.confirm('O vídeo ainda está sendo enviado. Fechar e cancelar o envio?')) return;
    setNovo(false);
  };
  if (!admin) return <Navigate to="/" replace />;
  if (situacao.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  if (situacao.error) return <ErroDaApi erro={situacao.error} />;
  if (!situacao.data.modulo) return <ModuloFora />;
  return (
    <div className="videos">
      <div className="topo">
        <div>
          <h1>Vídeos</h1>
          <p>Suba o vídeo falado: a IA corta, legenda e anima, sem nada em cima do rosto.</p>
        </div>
        <div className="acoes">
          <LinkAjuda artigo="videos">Como funciona</LinkAjuda>
          <Button variant="primary" icon="plus" onClick={() => setNovo(true)}>
            Novo vídeo
          </Button>
        </div>
      </div>
      {!situacao.data.armazenamento && (
        <Mensagem tipo="aviso">
          O armazenamento de arquivos não está ligado: os vídeos não podem ser enviados. Fale com a gente.
        </Mensagem>
      )}
      {situacao.data.armazenamento && !situacao.data.servico && (
        <Mensagem tipo="aviso">
          O serviço que edita os vídeos está fora do ar agora. Pode enviar: o vídeo espera na fila e é editado
          assim que ele voltar.
        </Mensagem>
      )}
      <Lista aoNovo={() => setNovo(true)} />
      {novo && (
        <Modal
          titulo="Novo vídeo"
          subtitulo="Suba o vídeo que você gravou falando: a IA corta, legenda, anima e fecha com a chamada."
          largura="larga"
          aoFechar={fecharNovo}
        >
          <NovoVideo situacao={situacao.data} aoEnviando={setEnviando} />
        </Modal>
      )}
    </div>
  );
}

function ModuloFora() {
  const m = MODULOS.videos;
  return (
    <section className="fora-plano" aria-labelledby="videos-fora">
      <span className="fora-plano__icone" aria-hidden="true">
        <Icon name="lock" size={22} />
      </span>
      <h1 id="videos-fora" className="fora-plano__titulo">
        {m.nome}
      </h1>
      <p className="fora-plano__texto">{m.descricao}</p>
      <p className="fora-plano__texto fora-plano__plano">
        <b>É um módulo à parte.</b> O preço e a franquia de vídeos aparecem ao assinar.
      </p>
      <Button variant="primary" href="/plano/assinar">
        Assinar o módulo
      </Button>
    </section>
  );
}

/* ───────────────────────────── Lista ───────────────────────────── */

type Filtro = 'todos' | 'revisar' | 'pronto';

const TOM: Record<ResumoVideo['situacao'], 'neutral' | 'brand' | 'warning' | 'danger' | 'outline'> = {
  enviando: 'neutral',
  na_fila: 'neutral',
  editando: 'outline',
  revisar: 'warning',
  pronto: 'brand',
  falhou: 'danger',
};

function Lista({ aoNovo }: { aoNovo: () => void }) {
  const q = useListaVideos();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  if (q.isPending) return <div className="esqueleto videos__lista" style={{ height: 320 }} />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const lista = q.data.videos.filter((v) => filtro === 'todos' || v.situacao === filtro);
  const { franquia } = q.data;
  return (
    <section className="videos__lista" aria-label="Seus vídeos">
      <div className="barra videos__barra">
        <div className="segmentos" role="radiogroup" aria-label="Mostrar">
          {(
            [
              ['todos', 'Todos'],
              ['revisar', 'Para revisar'],
              ['pronto', 'Prontos'],
            ] as const
          ).map(([id, rotulo]) => (
            <label key={id} className="segmento">
              <input
                type="radio"
                name="videos-filtro"
                className="pp-sr"
                checked={filtro === id}
                onChange={() => setFiltro(id)}
              />
              {rotulo}
            </label>
          ))}
        </div>
        {franquia.limite != null && (
          <span className="quieto videos__franquia">
            Vídeos no mês: <b className="mono">{fmtNumero(franquia.usados)}</b> de{' '}
            {fmtNumero(franquia.limite)}
          </span>
        )}
      </div>
      {!q.data.videos.length ? (
        <EmptyState
          icone="clapperboard"
          titulo="Nenhum vídeo ainda"
          texto="Grave falando para a câmera, com o celular em pé, e clique em Novo vídeo. Em poucos minutos o vídeo volta cortado, legendado e com a chamada no fim."
          acao={
            <Button variant="primary" icon="plus" onClick={aoNovo}>
              Novo vídeo
            </Button>
          }
        />
      ) : !lista.length ? (
        <p className="quieto">Nenhum vídeo nesta situação.</p>
      ) : (
        <ul className="videos__grade">
          {lista.map((v) => (
            <CartaoVideo key={v.id} v={v} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CartaoVideo({ v }: { v: ResumoVideo }) {
  const capa = useArquivo(v.id, 'capa', v.temCapa, v.prontoEm ?? undefined);
  const editando = v.situacao === 'na_fila' || v.situacao === 'editando';
  return (
    <li className="video-cartao">
      <Link to={`/videos/${v.id}`} className="video-cartao__capa" aria-label={`Abrir ${v.titulo}`}>
        {capa.data ? <img className="video-cartao__img" src={capa.data.url} alt="" loading="lazy" /> : null}
        <span className="video-cartao__selo">
          <Badge tone={TOM[v.situacao]}>
            {v.situacao === 'editando' ? `Editando · ${v.progresso}%` : ROTULO_SITUACAO_VIDEO[v.situacao]}
          </Badge>
        </span>
        {v.duracaoFinal != null && (
          <span className="video-cartao__tempo mono">{fmtDuracao(v.duracaoFinal)}</span>
        )}
        {editando && (
          <span className="video-cartao__barra" aria-hidden="true">
            <span style={{ width: `${Math.max(4, v.progresso)}%` }} />
          </span>
        )}
        {v.situacao === 'falhou' && <span className="video-cartao__falha">{v.erro}</span>}
      </Link>
      <div className="video-cartao__info">
        <Link to={`/videos/${v.id}`} className="video-cartao__titulo">
          {v.titulo}
        </Link>
        <span className="quieto video-cartao__meta">
          {v.situacao === 'revisar' && v.duvidas
            ? `${v.duvidas} ${v.duvidas === 1 ? 'corte' : 'cortes'} para você decidir`
            : v.duracaoOriginal != null && v.duracaoFinal != null
              ? `${fmtQuando(v.prontoEm ?? v.criadoEm)} · ${fmtDuracao(v.duracaoOriginal)} → ${fmtDuracao(v.duracaoFinal)}`
              : fmtQuando(v.criadoEm)}
        </span>
      </div>
    </li>
  );
}

/* ───────────────────────────── Novo vídeo ───────────────────────────── */

interface FormNovo {
  assunto: string;
  estilo: EstiloLegenda;
  ritmo: RitmoCortes;
  chamada: TipoChamada;
  palavra: string;
  frase: string;
  instrucoes: string;
  imagens: ModoImagens;
  musica: MusicaDoVideo;
  efeitos: boolean;
}

const FORM_INICIAL: FormNovo = {
  assunto: '',
  estilo: 'acesa',
  ritmo: 'dinamico',
  chamada: 'nenhuma',
  palavra: '',
  frase: '',
  instrucoes: '',
  imagens: 'ia',
  musica: 'ia',
  efeitos: true,
};

function NovoVideo({
  situacao,
  aoEnviando,
}: {
  situacao: SituacaoVideos;
  aoEnviando: (enviando: boolean) => void;
}) {
  const id = useId();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [duracao, setDuracao] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [f, setF] = useState<FormNovo>(FORM_INICIAL);
  const [andamento, setAndamento] = useState<number | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const set = <K extends keyof FormNovo>(k: K, v: FormNovo[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => aoEnviando(andamento != null), [andamento, aoEnviando]);
  const cheia = situacao.franquia.limite != null && situacao.franquia.usados >= situacao.franquia.limite;

  const escolher = async (a: File | null) => {
    setAviso(null);
    setArquivo(null);
    setDuracao(null);
    if (!a) return;
    if (
      !(TIPOS_VIDEO as readonly string[]).includes(a.type) &&
      !/\.(mp4|mov|m4v|webm|mkv|3gp)$/i.test(a.name)
    ) {
      setAviso('Esse arquivo não é um vídeo que dê para editar. Use MP4 ou MOV, como o celular grava.');
      return;
    }
    if (a.size > situacao.limiteBytes) {
      setAviso('O vídeo passa de 1 GB. Grave em 1080p (o padrão do celular) ou envie um trecho menor.');
      return;
    }
    const d = await duracaoDoArquivo(a);
    if (d != null && d > situacao.limiteSegundos + 1) {
      setAviso(
        `O vídeo tem ${fmtDuracao(d)}. O limite é ${fmtDuracao(situacao.limiteSegundos)}: corte um trecho no celular e envie de novo.`,
      );
      return;
    }
    setArquivo(a);
    setDuracao(d);
  };

  const enviar = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error('Escolha o vídeo.');
      const opcoes: OpcoesVideo = opcoesVideoEntrada.parse({
        assunto: f.assunto,
        estilo: f.estilo,
        ritmo: f.ritmo,
        transicao: 'alternada',
        chamada: { tipo: f.chamada, palavra: f.palavra, texto: f.frase },
        instrucoes: f.instrucoes,
        imagens: f.imagens,
        musica: situacao.recursos.musica ? f.musica : 'nenhuma',
        efeitos: f.efeitos,
      });
      setAndamento(0);
      return enviarVideo(arquivo, { titulo: f.assunto, opcoes, duracao }, setAndamento);
    },
    onSuccess: (v) => {
      void cliente.invalidateQueries({ queryKey: ['videos'] });
      setArquivo(null);
      setF(FORM_INICIAL);
      setAndamento(null);
      navegar(`/videos/${v.id}`);
    },
    onError: () => setAndamento(null),
  });

  const submeter = (e: FormEvent) => {
    e.preventDefault();
    if (!arquivo) {
      setAviso('Escolha o vídeo primeiro.');
      return;
    }
    if (f.chamada === 'comente' && !f.palavra.trim()) {
      setAviso('Escreva a palavra do "Comente…" da chamada no fim.');
      return;
    }
    if (f.chamada === 'texto' && !f.frase.trim()) {
      setAviso('Escreva a frase da chamada no fim.');
      return;
    }
    enviar.mutate();
  };

  return (
    <div className="videos__novo">
      <form className="videos__form videos__form--janela" onSubmit={submeter} aria-label="Novo vídeo">
        <label
          className="videos__soltar"
          data-arrastando={arrastando || undefined}
          data-escolhido={arquivo ? true : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            void escolher(e.dataTransfer.files[0] ?? null);
          }}
        >
          <Icon name={arquivo ? 'video' : 'upload'} size={26} />
          {arquivo ? (
            <>
              <span className="videos__soltar-titulo">{arquivo.name}</span>
              <span className="campo__dica">
                {duracao != null ? `${fmtDuracao(duracao)} · ` : ''}
                {(arquivo.size / 1024 / 1024).toFixed(0)} MB · clique para trocar
              </span>
            </>
          ) : (
            <>
              <span className="videos__soltar-titulo">Arraste o vídeo ou clique para escolher</span>
              <span className="campo__dica">
                Gravado em pé (9:16) ou deitado, até {fmtDuracao(situacao.limiteSegundos)}. A IA corta,
                legenda e anima.
              </span>
            </>
          )}
          <input
            ref={entrada}
            type="file"
            accept="video/*"
            className="pp-sr"
            onChange={(e) => void escolher(e.target.files?.[0] ?? null)}
          />
        </label>
        {aviso && <Mensagem tipo="aviso">{aviso}</Mensagem>}

        <div className="campo">
          <label htmlFor={`${id}-assunto`}>Sobre o que é o vídeo</label>
          <input
            id={`${id}-assunto`}
            className="filtro"
            value={f.assunto}
            maxLength={140}
            placeholder="Ex.: promoção de pastilha de freio até sábado"
            onChange={(e) => set('assunto', e.target.value)}
          />
          <span className="campo__dica">
            A IA usa para o título, as animações e as imagens, e para entender o que cortar. Opcional.
          </span>
        </div>

        <fieldset className="campo">
          <legend>Estilo da legenda</legend>
          <div className="videos__estilos">
            {ESTILOS_LEGENDA.map((e) => (
              <label key={e.id} className="videos__estilo" data-ativo={f.estilo === e.id || undefined}>
                <input
                  type="radio"
                  name={`${id}-estilo`}
                  className="pp-sr"
                  checked={f.estilo === e.id}
                  onChange={() => set('estilo', e.id)}
                />
                <span className={`videos__amostra videos__amostra--${e.id}`} aria-hidden="true">
                  {e.id === 'acesa' ? 'FORTE' : e.id === 'simples' ? 'Simples' : 'fala'}
                </span>
                <span className="videos__estilo-nome">{e.nome}</span>
              </label>
            ))}
          </div>
          <span className="campo__dica">Nas cores da identidade visual da empresa.</span>
        </fieldset>

        <fieldset className="campo">
          <legend>Imagens no vídeo</legend>
          <div className="videos__modos">
            {MODOS_IMAGENS.map((m) => {
              const semFotos = m.id === 'fotos' && !situacao.fotosDaEmpresa;
              const dica =
                m.id === 'ia' && !situacao.recursos.imagensGeradas
                  ? 'Usa as fotos da empresa (a geração de imagens não está ligada).'
                  : m.id === 'fotos'
                    ? situacao.fotosDaEmpresa
                      ? `Nada gerado pela IA. Hoje: ${situacao.fotosDaEmpresa} ${situacao.fotosDaEmpresa === 1 ? 'foto' : 'fotos'}.`
                      : 'A empresa ainda não tem fotos (suba em Carrosséis › Fotos).'
                    : m.dica;
              return (
                <label
                  key={m.id}
                  className="videos__modo"
                  data-ativo={f.imagens === m.id || undefined}
                  data-desligado={semFotos || undefined}
                >
                  <input
                    type="radio"
                    name={`${id}-imagens`}
                    checked={f.imagens === m.id}
                    disabled={semFotos}
                    onChange={() => set('imagens', m.id)}
                  />
                  <span>
                    <b>{m.nome}</b>
                    <span className="campo__dica">{dica}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <FotosDaEmpresa total={situacao.fotosDaEmpresa} />
        </fieldset>

        <div className="campo">
          <label htmlFor={`${id}-musica`}>Música de fundo</label>
          <select
            id={`${id}-musica`}
            className="filtro"
            value={situacao.recursos.musica ? f.musica : 'nenhuma'}
            disabled={!situacao.recursos.musica}
            onChange={(e) => set('musica', e.target.value as MusicaDoVideo)}
          >
            {(Object.keys(ROTULO_MUSICA) as MusicaDoVideo[]).map((m) => (
              <option key={m} value={m}>
                {ROTULO_MUSICA[m]}
              </option>
            ))}
          </select>
          <span className="campo__dica">
            {situacao.recursos.musica
              ? 'Feita para este vídeo. O volume baixa sozinho quando você fala.'
              : 'A música ainda não foi ligada na plataforma. Fale com a gente.'}
          </span>
        </div>

        <label className="videos__marcar">
          <input type="checkbox" checked={f.efeitos} onChange={(e) => set('efeitos', e.target.checked)} />
          <span>
            <b>Efeitos sonoros nas animações</b>
            <span className="campo__dica">Discretos: um toque ao marcar a lista, um sopro no número.</span>
          </span>
        </label>

        <div className="campo">
          <label htmlFor={`${id}-chamada`}>Chamada no fim</label>
          <select
            id={`${id}-chamada`}
            className="filtro"
            value={f.chamada}
            onChange={(e) => set('chamada', e.target.value as TipoChamada)}
          >
            {(Object.keys(ROTULO_CHAMADA) as TipoChamada[]).map((t) => (
              <option key={t} value={t}>
                {ROTULO_CHAMADA[t]}
              </option>
            ))}
          </select>
        </div>
        {f.chamada === 'comente' && (
          <div className="campo">
            <label htmlFor={`${id}-palavra`}>Palavra</label>
            <input
              id={`${id}-palavra`}
              className="filtro mono"
              value={f.palavra}
              maxLength={30}
              placeholder="QUERO"
              onChange={(e) => set('palavra', e.target.value.replace(/\s+/g, '').toUpperCase())}
            />
            <span className="campo__dica">
              Use a mesma de uma regra do <Link to="/instagram">Comente e receba</Link> para quem comentar
              receber no direct.
            </span>
          </div>
        )}
        {f.chamada !== 'nenhuma' && (
          <div className="campo">
            <label htmlFor={`${id}-frase`}>
              {f.chamada === 'texto' ? 'Frase da tela final' : 'Frase da tela final (opcional)'}
            </label>
            <input
              id={`${id}-frase`}
              className="filtro"
              value={f.frase}
              maxLength={80}
              onChange={(e) => set('frase', e.target.value)}
            />
          </div>
        )}

        <div className="campo">
          <label htmlFor={`${id}-ritmo`}>Ritmo dos cortes</label>
          <select
            id={`${id}-ritmo`}
            className="filtro"
            value={f.ritmo}
            onChange={(e) => set('ritmo', e.target.value as RitmoCortes)}
          >
            {RITMOS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
          <span className="campo__dica">{RITMOS.find((r) => r.id === f.ritmo)?.dica}.</span>
        </div>

        <div className="campo">
          <label htmlFor={`${id}-instrucoes`}>Instruções para a IA</label>
          <textarea
            id={`${id}-instrucoes`}
            rows={3}
            value={f.instrucoes}
            maxLength={600}
            placeholder="Ex.: não corte a parte em que falo o endereço da loja."
            onChange={(e) => set('instrucoes', e.target.value)}
          />
        </div>

        {andamento != null && (
          <div className="videos__envio" role="status">
            <span className="videos__envio-barra" aria-hidden="true">
              <span style={{ width: `${Math.round(andamento * 100)}%` }} />
            </span>
            <span className="campo__dica">
              Enviando o vídeo… {Math.round(andamento * 100)}%. Não feche esta tela até terminar.
            </span>
          </div>
        )}
        <ErroDaApi erro={enviar.error} />
        {cheia && (
          <Mensagem tipo="aviso">
            Os {situacao.franquia.limite} vídeos do mês já foram usados. Fale com a gente para aumentar; no
            dia 1º a franquia volta.
          </Mensagem>
        )}
        <Button
          type="submit"
          variant="primary"
          icon="sparkles"
          disabled={enviar.isPending || cheia || !situacao.armazenamento}
        >
          {enviar.isPending ? 'Enviando…' : 'Editar com a IA'}
        </Button>
        <span className="campo__dica">
          Fica pronto em poucos minutos. Depois de enviar, pode sair desta tela: o aviso chega no sino.
        </span>
      </form>
    </div>
  );
}
