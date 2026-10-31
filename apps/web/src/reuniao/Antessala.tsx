import { useMediaDevices, useTrackVolume } from '@livekit/components-react';
import { Avatar, Button, Icon } from '@prospeccao/ui';
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalTrack,
  type LocalVideoTrack,
  VideoPresets,
} from 'livekit-client';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ErroApi } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { apiSala, type InfoSala, type Liberado, type ResultadoEntrada } from './api';
import {
  aplicarFundo,
  fundoInicial,
  fundoSemEspelho,
  lembrarFundo,
  opcoesDeFundo,
  suportaFundos,
} from './fundos';
import { pedirCapturaDaAba, podeGravarAba } from './gravador';
import { AntesDeAbrir, quandoReuniao } from './PaginaReuniao';
import { GradeDeFundos, marcaDaSala } from './SeletorFundo';
import { destravarSons, ehCelular } from './sons';

/** O que a pessoa escolheu antes de entrar (vale dentro da sala). */
export interface Escolhas {
  microfone: boolean;
  camera: boolean;
  microfoneId: string | undefined;
  cameraId: string | undefined;
  altoFalanteId: string | undefined;
  /** No celular: câmera da frente (user) ou de trás (environment). */
  frente: 'user' | 'environment';
  /** Quem conduz no computador: a aba já liberada para a gravação (pedida no clique de entrar). */
  captura: MediaStream | null;
  /** Fundo da câmera (nenhum, desfoque, cenário ou foto da empresa). */
  fundo: string;
}

const NOME_GUARDADO = 'reuniao:nome';
const chaveVolta = (codigo: string) => `reuniao:${codigo}:participante`;

function lerLocal(chave: string, onde: Storage | undefined): string | null {
  try {
    return onde?.getItem(chave) ?? null;
  } catch {
    return null;
  }
}
function gravarLocal(chave: string, valor: string, onde: Storage | undefined) {
  try {
    onde?.setItem(chave, valor);
  } catch {
    // modo privado: sem lembrar
  }
}

/**
 * Prévia de UM aparelho (câmera ou microfone), separada da outra: sem câmera no computador, o
 * microfone continua funcionando (antes, um pedido só derrubava os dois).
 */
function usePrevia<T extends LocalTrack>(
  ligado: boolean,
  chave: string,
  criar: () => Promise<T>,
  aoErro: (e: Error) => void,
): T | undefined {
  const [faixa, setFaixa] = useState<T>();
  const criarRef = useRef(criar);
  criarRef.current = criar;
  const erroRef = useRef(aoErro);
  erroRef.current = aoErro;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a chave resume as opções do aparelho
  useEffect(() => {
    if (!ligado) return;
    let vivo = true;
    let criada: T | undefined;
    criarRef
      .current()
      .then((t) => {
        if (!vivo) return t.stop();
        criada = t;
        setFaixa(t);
      })
      .catch((e: Error) => vivo && erroRef.current(e));
    return () => {
      vivo = false;
      criada?.stop();
      setFaixa(undefined);
    };
  }, [ligado, chave]);
  return faixa;
}

/** Explica por que a câmera ou o microfone não ligou, do jeito que a pessoa resolve. */
function porQueNaoLigou(e: Error, o: 'a câmera' | 'o microfone'): string {
  const t = `${e.name} ${e.message}`;
  const O = o === 'a câmera' ? 'A câmera' : 'O microfone';
  if (/notallowed|permission|denied/i.test(t))
    return `O navegador não deixou usar ${o}. Clique no cadeado ao lado do endereço, permita ${o} e recarregue a página.`;
  if (/notfound|devicesnotfound|overconstrained/i.test(t))
    return o === 'a câmera'
      ? 'Não encontramos câmera neste aparelho. Você entra só com o microfone (dá para ligar a câmera depois).'
      : 'Não encontramos microfone neste aparelho. Conecte um fone com microfone e recarregue a página.';
  if (/notreadable|trackstart|could not start|in use/i.test(t))
    return `${O} está sendo usado por outro programa ou outra aba (outra reunião, Teams, Zoom…). Feche e clique de novo no botão.`;
  return `Não deu para ligar ${o}. Recarregue a página e tente de novo.`;
}

/** Nível do microfone em 10 barrinhas (para a pessoa ver que está captando a voz). */
function Medidor(props: { faixa: LocalAudioTrack | undefined }) {
  const volume = useTrackVolume(props.faixa);
  const acesas = Math.min(10, Math.round(volume * 30));
  return (
    <div className="as__medidor">
      <span>Seu microfone</span>
      <meter className="pp-sr" min={0} max={10} value={acesas} aria-label="Volume do microfone" />
      <div className="as__barras" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: barrinhas fixas do medidor
          <span key={i} data-aceso={i < acesas || undefined} />
        ))}
      </div>
      <span style={{ color: acesas > 1 ? 'var(--brand)' : undefined, fontWeight: 500 }}>
        {props.faixa ? (acesas > 1 ? 'Captando sua voz' : 'Fale algo para testar') : 'Desligado'}
      </span>
    </div>
  );
}

function Seletor(props: {
  id: string;
  rotulo: string;
  tipo: MediaDeviceKind;
  valor: string | undefined;
  aoMudar: (id: string) => void;
}) {
  const aparelhos = useMediaDevices({ kind: props.tipo });
  if (!aparelhos.length) return null;
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <select
        id={props.id}
        value={props.valor ?? aparelhos[0]?.deviceId}
        onChange={(e) => props.aoMudar(e.target.value)}
      >
        {aparelhos.map((a, i) => (
          <option key={a.deviceId || i} value={a.deviceId}>
            {a.label || `${props.rotulo} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Antessala(props: {
  info: InfoSala;
  agora: () => Date;
  aoAguardar: (r: { participanteId: string; segredo: string }, escolhas: Escolhas) => void;
  aoEntrar: (acesso: Liberado, escolhas: Escolhas) => void;
  aoRecusar: () => void;
  aoAtualizar: () => void;
}) {
  const { info } = props;
  const doTime = !!info.voce;
  const [testando, setTestando] = useState(false);
  const [nome, setNome] = useState(
    () => info.voce?.nome ?? lerLocal(NOME_GUARDADO, globalThis.localStorage) ?? '',
  );
  const [aceite, setAceite] = useState(doTime);
  const [microfone, setMicrofone] = useState(true);
  const [camera, setCamera] = useState(true);
  const [microfoneId, setMicrofoneId] = useState<string>();
  const [cameraId, setCameraId] = useState<string>();
  const [altoFalanteId, setAltoFalanteId] = useState<string>();
  // No celular não há lista de aparelhos: usa o padrão e um botão para virar a câmera.
  const [celular] = useState(ehCelular);
  const [frente, setFrente] = useState<'user' | 'environment'>('user');
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const [erroMicrofone, setErroMicrofone] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [entrando, setEntrando] = useState(false);

  const antes = info.situacao === 'antes' && !doTime;
  const mostrarPrevia = !antes || testando;

  // Prévia da câmera e do microfone, cada um no seu pedido (as mesmas escolhas valem dentro da sala).
  const usarMicId = !celular && microfoneId ? microfoneId : undefined;
  const usarCamId = !celular && cameraId ? cameraId : undefined;
  const audio = usePrevia<LocalAudioTrack>(
    mostrarPrevia && microfone,
    `mic:${usarMicId ?? ''}`,
    () =>
      createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(usarMicId ? { deviceId: usarMicId } : {}),
      }),
    (e) => setErroMicrofone(porQueNaoLigou(e, 'o microfone')),
  );
  const video = usePrevia<LocalVideoTrack>(
    mostrarPrevia && camera,
    `cam:${usarCamId ?? frente}`,
    () =>
      createLocalVideoTrack({
        resolution: VideoPresets.h720.resolution,
        ...(usarCamId ? { deviceId: usarCamId } : { facingMode: frente }),
      }),
    (e) => {
      setErroCamera(porQueNaoLigou(e, 'a câmera'));
      // Sem câmera: entra com ela desligada (o microfone segue normal).
      if (/notfound|devicesnotfound|overconstrained/i.test(`${e.name} ${e.message}`)) setCamera(false);
    },
  );
  // Fundo da câmera: já vem o que a pessoa usou da última vez (ou o padrão da empresa).
  const marcaFundo = useMemo(() => marcaDaSala(info), [info]);
  const opcoesFundo = useMemo(() => opcoesDeFundo(info.fundos, doTime), [info.fundos, doTime]);
  const [comFundos] = useState(suportaFundos);
  const [fundo, setFundo] = useState(() =>
    comFundos ? fundoInicial(opcoesFundo, info.fundos, doTime) : 'nenhum',
  );
  const [aplicandoFundo, setAplicandoFundo] = useState(false);
  const [erroFundo, setErroFundo] = useState<string | null>(null);
  const [todosFundos, setTodosFundos] = useState(false);
  useEffect(() => {
    if (!video) return;
    let vivo = true;
    setAplicandoFundo(true);
    aplicarFundo(video, fundo, marcaFundo)
      .catch(() => {
        if (!vivo) return;
        setErroFundo('Não deu para usar o fundo neste aparelho. A câmera segue sem efeito.');
        setFundo('nenhum');
      })
      .finally(() => vivo && setAplicandoFundo(false));
    return () => {
      vivo = false;
    };
  }, [video, fundo, marcaFundo]);
  const travado = doTime && !!info.fundos?.config.travar && opcoesFundo.length === 1;
  // Na faixa: os efeitos e os primeiros fundos (o escolhido sempre aparece); o resto em "Ver todos".
  const curtas = useMemo(() => {
    const lista = opcoesFundo.slice(0, 6);
    const esc = opcoesFundo.find((o) => o.id === fundo);
    if (esc && !lista.includes(esc)) lista[lista.length - 1] = esc;
    return lista;
  }, [opcoesFundo, fundo]);
  const elVideo = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = elVideo.current;
    if (!video || !el) return;
    video.attach(el);
    return () => {
      video.detach(el);
    };
  }, [video]);

  if (antes && !testando)
    return <AntesDeAbrir info={info} agora={props.agora} aoTestar={() => setTestando(true)} />;

  const escolhas: Escolhas = {
    microfone,
    camera,
    microfoneId: celular ? undefined : microfoneId,
    cameraId: celular ? undefined : cameraId,
    altoFalanteId: celular ? undefined : altoFalanteId,
    frente,
    captura: null,
    fundo,
  };
  const precisaAceite = info.gravar && !doTime;
  // Quem é do time, no computador, grava a reunião pelo navegador (o Chrome pede a aba no clique).
  const vaiGravar = doTime && info.gravacao === 'navegador' && podeGravarAba();

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    // O clique em "Entrar" libera os sons de aviso da sala (o navegador exige um toque antes).
    destravarSons();
    setErro(null);
    setEntrando(true);
    // Primeiro a aba para a gravação (tem que ser no clique). Cancelar não impede de entrar: a sala
    // mostra o botão para gravar depois.
    const captura = vaiGravar ? await pedirCapturaDaAba() : null;
    try {
      const volta = lerLocal(chaveVolta(info.codigo), globalThis.sessionStorage);
      const anterior = volta ? (JSON.parse(volta) as { participanteId: string; segredo: string }) : null;
      const r = await apiSala<ResultadoEntrada>(`/${info.codigo}/entrar`, {
        metodo: 'POST',
        corpo: { nome: nome.trim(), aceitouGravacao: aceite, ...(anterior ?? {}) },
      });
      if (!doTime) gravarLocal(NOME_GUARDADO, nome.trim(), globalThis.localStorage);
      if (r.estado === 'recusado') return props.aoRecusar();
      if (r.segredo)
        gravarLocal(
          chaveVolta(info.codigo),
          JSON.stringify({ participanteId: r.participanteId, segredo: r.segredo }),
          globalThis.sessionStorage,
        );
      // A prévia para: a sala pega a câmera e o microfone de novo (sem pedir permissão outra vez).
      video?.stop();
      audio?.stop();
      if (r.estado === 'aguardando') {
        for (const t of captura?.getTracks() ?? []) t.stop();
        props.aoAguardar({ participanteId: r.participanteId, segredo: r.segredo }, escolhas);
      } else props.aoEntrar(r, { ...escolhas, captura });
    } catch (x) {
      for (const t of captura?.getTracks() ?? []) t.stop();
      setErro(x);
      if (x instanceof ErroApi && (x.codigo === 'sala_fechada' || x.status === 410)) props.aoAtualizar();
    } finally {
      setEntrando(false);
    }
  };

  const reabrir = doTime && info.situacao === 'encerrada';
  return (
    <div className="as">
      <section className="as__previa" aria-label="Sua câmera e seu microfone">
        <div className="as__video">
          {video ? (
            <video
              ref={elVideo}
              muted
              playsInline
              autoPlay
              data-traseira={frente === 'environment' || undefined}
              data-sem-espelho={fundoSemEspelho(fundo) || undefined}
            />
          ) : (
            <div className="as__sem-camera">
              {nome.trim() ? <Avatar nome={nome} size={88} /> : <Icon name="video-off" size={28} />}
              <span>{camera ? 'Ligando a câmera…' : 'Câmera desligada'}</span>
            </div>
          )}
          {nome.trim() && <span className="as__nome">{nome.trim()}</span>}
          {video && aplicandoFundo && fundo !== 'nenhum' && (
            <span className="as__aplicando" role="status">
              <Icon name="loader" spin size={14} />
              Aplicando o fundo…
            </span>
          )}
          <div className="as__botoes">
            <button
              type="button"
              className="as__botao"
              data-desligado={!microfone || undefined}
              aria-pressed={!microfone}
              aria-label={microfone ? 'Desligar o microfone' : 'Ligar o microfone'}
              title={microfone ? 'Desligar o microfone' : 'Ligar o microfone'}
              onClick={() => {
                setErroMicrofone(null);
                setMicrofone((x) => !x);
              }}
            >
              <Icon name={microfone ? 'mic' : 'mic-off'} size={22} />
            </button>
            <button
              type="button"
              className="as__botao"
              data-desligado={!camera || undefined}
              aria-pressed={!camera}
              aria-label={camera ? 'Desligar a câmera' : 'Ligar a câmera'}
              title={camera ? 'Desligar a câmera' : 'Ligar a câmera'}
              onClick={() => {
                setErroCamera(null);
                setCamera((x) => !x);
              }}
            >
              <Icon name={camera ? 'video' : 'video-off'} size={22} />
            </button>
            {celular && camera && (
              <button
                type="button"
                className="as__botao"
                aria-label={frente === 'user' ? 'Usar a câmera de trás' : 'Usar a câmera da frente'}
                title={frente === 'user' ? 'Usar a câmera de trás' : 'Usar a câmera da frente'}
                onClick={() => setFrente((x) => (x === 'user' ? 'environment' : 'user'))}
              >
                <Icon name="switch-camera" size={22} />
              </button>
            )}
          </div>
        </div>
        <Medidor faixa={microfone ? audio : undefined} />
        {comFundos && camera && (
          <div className="as__fundos">
            <div className="as__fundos-cab">
              <b>Fundo</b>
              <span className="quieto">
                {travado
                  ? `${info.empresa.nome} definiu o fundo das reuniões.`
                  : 'Quem está na reunião vê o fundo escolhido, e a gravação também.'}
              </span>
            </div>
            {!travado && (
              <>
                <GradeDeFundos
                  opcoes={todosFundos ? opcoesFundo : curtas}
                  escolhido={fundo}
                  m={marcaFundo}
                  padrao={doTime ? (info.fundos?.config.padrao ?? null) : null}
                  empresa={info.empresa.nome}
                  agrupar={todosFundos}
                  colunas={todosFundos ? 4 : 6}
                  aoEscolher={(id) => {
                    setErroFundo(null);
                    setFundo(id);
                    lembrarFundo(id, doTime);
                  }}
                />
                {opcoesFundo.length > curtas.length && (
                  <button
                    type="button"
                    className="link-botao as__todos"
                    onClick={() => setTodosFundos((x) => !x)}
                  >
                    {todosFundos ? 'Ver menos' : `Ver todos os fundos (${opcoesFundo.length})`}
                  </button>
                )}
              </>
            )}
            {erroFundo && <Mensagem tipo="aviso">{erroFundo}</Mensagem>}
          </div>
        )}
        {erroCamera && <Mensagem tipo="aviso">{erroCamera}</Mensagem>}
        {erroMicrofone && <Mensagem tipo="aviso">{erroMicrofone}</Mensagem>}
        {!celular && (
          <div className="as__aparelhos">
            <Seletor
              id="as-cam"
              rotulo="Câmera"
              tipo="videoinput"
              valor={cameraId}
              aoMudar={(id) => {
                setErroCamera(null);
                setCamera(true);
                setCameraId(id);
              }}
            />
            <Seletor
              id="as-mic"
              rotulo="Microfone"
              tipo="audioinput"
              valor={microfoneId}
              aoMudar={(id) => {
                setErroMicrofone(null);
                setMicrofoneId(id);
              }}
            />
            <Seletor
              id="as-som"
              rotulo="Alto-falante"
              tipo="audiooutput"
              valor={altoFalanteId}
              aoMudar={setAltoFalanteId}
            />
          </div>
        )}
      </section>

      <form className="as__entrar" onSubmit={entrar} aria-label="Entrar na reunião">
        <div className="pilha" style={{ gap: 8 }}>
          <h1 className="rp__titulo">{info.titulo}</h1>
          <span className="quieto" style={{ fontSize: 14 }}>
            {quandoReuniao(info.inicio, info.fim)}
            {info.anfitriao ? ` · com ${info.anfitriao}` : ''}
          </span>
          {info.presentes.length > 0 && (
            <div className="as__quem">
              <span style={{ display: 'flex' }}>
                {info.presentes.slice(0, 3).map((p) => (
                  <span key={p} style={{ marginRight: -6 }}>
                    <Avatar nome={p} size={28} />
                  </span>
                ))}
              </span>
              <span style={{ marginLeft: 8 }}>
                {info.presentes.length === 1
                  ? `${info.presentes[0]} já está na sala`
                  : `${info.presentes.slice(0, 2).join(' e ')}${info.presentes.length > 2 ? ` e mais ${info.presentes.length - 2}` : ''} já estão na sala`}
              </span>
            </div>
          )}
        </div>

        {doTime ? (
          <Mensagem tipo="ok">Você entra como {info.voce?.nome}, do time.</Mensagem>
        ) : (
          <div className="campo">
            <label htmlFor="as-nome">Seu nome</label>
            <input
              id="as-nome"
              className="filtro"
              required
              minLength={2}
              maxLength={60}
              autoComplete="name"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
            <span className="campo__dica">É assim que as outras pessoas vão ver você.</span>
          </div>
        )}

        {info.gravar && (
          <div className="as__aviso">
            <p style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span className="ponto-gravando" style={{ marginTop: 5 }} aria-hidden="true" />
              <span>
                <b>Esta reunião será gravada{info.transcrever ? ' e transcrita' : ''}.</b> A gravação fica com{' '}
                {info.empresa.nome}, para registrar o que foi combinado.
              </span>
            </p>
            {precisaAceite && (
              <label className="as__aceite">
                <input
                  type="checkbox"
                  checked={aceite}
                  onChange={(e) => setAceite(e.target.checked)}
                  required
                />
                Entendi que a reunião será gravada
              </label>
            )}
          </div>
        )}

        {antes && (
          <Mensagem tipo="aviso">
            A sala abre às{' '}
            {new Date(info.abreEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Você
            já pode testar a câmera e o microfone.
          </Mensagem>
        )}
        <ErroDaApi erro={erro} />
        <div className="pilha" style={{ gap: 8 }}>
          <Button
            type="submit"
            variant="primary"
            className="as__grande"
            disabled={entrando || antes || (!doTime && nome.trim().length < 2) || (precisaAceite && !aceite)}
          >
            {entrando
              ? 'Entrando…'
              : reabrir
                ? 'Abrir a sala de novo'
                : vaiGravar
                  ? 'Entrar e gravar'
                  : 'Entrar na reunião'}
          </Button>
          <span className="rp__nota">
            {vaiGravar
              ? 'O navegador vai perguntar se pode compartilhar esta aba: clique em Compartilhar. É assim que a reunião é gravada, do jeito que você vê.'
              : 'Câmera e microfone podem ser desligados a qualquer momento.'}
          </span>
        </div>
      </form>
    </div>
  );
}
