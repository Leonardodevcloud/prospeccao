import type { Participant, RemoteAudioTrack, Room } from 'livekit-client';
import { api, ErroApi } from '../api';

/**
 * A ligação no navegador. Cada ligação é uma "linha" (uma sala do LiveKit com o lado de lá). A
 * ligação da tela é a linha que o `telefone` assumiu: ela recebe o seu microfone, toca o som do
 * lead, grava a sua voz, a do lead e a conversa junta (no navegador, sem custo de gravação na nuvem)
 * e manda os arquivos quando termina. Na lista de ligação em paralelo, o discador abre até 3 linhas
 * sem microfone; a primeira que atende é assumida aqui.
 */

export type FaseLigacao =
  | 'parado'
  | 'preparando'
  | 'chamando'
  | 'tocando'
  | 'em_andamento'
  | 'encerrada'
  | 'falhou';

export interface DadosLigacao {
  id: number;
  telefone: string;
  numeroEmpresa: string;
  lead: string | null;
  empresaId: number | null;
  gravar: boolean;
  aviso: { texto: string; falado: boolean } | null;
  listaItemId?: number | null;
  direcao?: 'saida' | 'entrada';
}

export type Credenciais = DadosLigacao & { url: string; token: string };

export interface EstadoLigacao {
  fase: FaseLigacao;
  ligacao: DadosLigacao | null;
  /** Quando atendeu (para o cronômetro). */
  atendidaEm: number | null;
  /** Duração final (s) depois de desligar. */
  duracao: number;
  atendeu: boolean;
  mudo: boolean;
  /** "tocando" (aviso falado) | "ler" (o comercial lê) | null. */
  aviso: 'tocando' | 'ler' | null;
  /** Mandando os arquivos da gravação. */
  enviando: boolean;
  gravacaoFalhou: boolean;
  erro: string | null;
  /** Painel aberto (fecha depois do "Como foi?"). */
  aberto: boolean;
}

const INICIAL: EstadoLigacao = {
  fase: 'parado',
  ligacao: null,
  atendidaEm: null,
  duracao: 0,
  atendeu: false,
  mudo: false,
  aviso: null,
  enviando: false,
  gravacaoFalhou: false,
  erro: null,
  aberto: false,
};

/** O lado de lá: o lead (ligação feita) ou quem ligou (recebida, sip_…). */
const ehDoOutroLado = (identidade: string) => identidade === 'lead' || identidade.startsWith('sip_');

/** Melhor formato de áudio que este navegador grava (Opus). */
function formatoAudio(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'])
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

class Gravacao {
  private pedacos: Blob[] = [];
  private gravador: MediaRecorder;
  readonly tipo: string;
  constructor(stream: MediaStream) {
    const tipo = formatoAudio();
    this.gravador = new MediaRecorder(
      stream,
      tipo ? { mimeType: tipo, audioBitsPerSecond: 32_000 } : undefined,
    );
    this.tipo = (this.gravador.mimeType || tipo || 'audio/webm').split(';')[0]!;
    this.gravador.ondataavailable = (e) => {
      if (e.data.size) this.pedacos.push(e.data);
    };
    // Pedaços de 5 s: se a aba travar no fim, o que foi gravado não se perde.
    this.gravador.start(5_000);
  }
  parar(): Promise<Blob> {
    return new Promise((resolve) => {
      if (this.gravador.state === 'inactive') return resolve(new Blob(this.pedacos, { type: this.tipo }));
      this.gravador.onstop = () => resolve(new Blob(this.pedacos, { type: this.tipo }));
      this.gravador.stop();
    });
  }
}

export type FaseLinha = 'conectando' | 'chamando' | 'tocando' | 'atendida' | 'encerrada';

/** Uma sala de ligação (o navegador entra sem publicar nada até a linha ser assumida). */
export class Linha {
  sala: Room | null = null;
  fase: FaseLinha = 'conectando';
  desde = Date.now();
  remota: RemoteAudioTrack | null = null;
  aoMudar: (l: Linha) => void = () => undefined;
  constructor(readonly dados: Credenciais) {}

  async conectar(): Promise<void> {
    const { Room, RoomEvent, Track } = await import('livekit-client');
    const sala = new Room({ adaptiveStream: false, dynacast: false });
    this.sala = sala;
    const ler = (p: Participant) => {
      if (!ehDoOutroLado(p.identity)) return;
      const st = p.attributes['sip.callStatus'];
      if ((st === 'ringing' || st === 'automation') && this.fase === 'chamando') this.mudar('tocando');
      // Recebida: quem ligou já está "ativo" (a ligação foi atendida pela plataforma).
      if (st === 'active' || (!st && p.identity.startsWith('sip_'))) this.mudar('atendida');
    };
    sala
      .on(RoomEvent.ParticipantConnected, ler)
      .on(RoomEvent.ParticipantAttributesChanged, (_a, p) => ler(p))
      .on(RoomEvent.TrackSubscribed, (trilha, _pub, p) => {
        if (!ehDoOutroLado(p.identity) || trilha.kind !== Track.Kind.Audio) return;
        this.remota = trilha as RemoteAudioTrack;
        this.aoMudar(this);
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        if (ehDoOutroLado(p.identity)) this.mudar('encerrada');
      })
      .on(RoomEvent.Disconnected, () => this.mudar('encerrada'));
    await sala.connect(this.dados.url, this.dados.token, { autoSubscribe: true });
    if (this.fase === 'conectando') this.fase = 'chamando';
    for (const p of sala.remoteParticipants.values()) ler(p);
  }

  private mudar(f: FaseLinha) {
    if (this.fase === 'encerrada' || this.fase === f) return;
    // Não volta de "atendida" para "tocando".
    if (this.fase === 'atendida' && f !== 'encerrada') return;
    this.fase = f;
    this.aoMudar(this);
  }

  async publicar(trilha: MediaStreamTrack): Promise<void> {
    const { Track } = await import('livekit-client');
    await this.sala?.localParticipant.publishTrack(trilha, { source: Track.Source.Microphone, dtx: false });
  }

  async sair(): Promise<void> {
    this.fase = 'encerrada';
    await this.sala?.disconnect().catch(() => undefined);
  }
}

class Telefone {
  estado: EstadoLigacao = INICIAL;
  private ouvintes = new Set<() => void>();
  private linha: Linha | null = null;
  private contexto: AudioContext | null = null;
  private microfone: MediaStreamTrack | null = null;
  private fonteMic: MediaStreamAudioSourceNode | null = null;
  private saida: MediaStreamAudioDestinationNode | null = null;
  private conversa: MediaStreamAudioDestinationNode | null = null;
  private somDoLead: HTMLMediaElement | null = null;
  private trilhaLead: MediaStreamTrack | null = null;
  private avisoAudio: AudioBuffer | null = null;
  private gravacoes: { voce?: Gravacao; lead?: Gravacao; conversa?: Gravacao } = {};
  private encerrando = false;
  /** O discador da lista segura o microfone entre uma ligação e outra. */
  private manterAudio = false;

  assinar = (f: () => void) => {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  };
  ler = () => this.estado;
  private mudar(p: Partial<EstadoLigacao>) {
    this.estado = { ...this.estado, ...p };
    for (const f of this.ouvintes) f();
  }

  get ocupado(): boolean {
    return ['preparando', 'chamando', 'tocando', 'em_andamento'].includes(this.estado.fase);
  }

  /** Livre para assumir uma ligação (nada em curso e o "Como foi?" já salvo). */
  get livre(): boolean {
    return !this.ocupado && !this.estado.aberto && !this.estado.enviando;
  }

  /**
   * Microfone e som (precisa ser chamado direto no clique: o navegador só libera assim). Devolve
   * false se o navegador não liberou o microfone.
   */
  async prepararAudio(manter = false): Promise<boolean> {
    this.manterAudio ||= manter;
    if (this.microfone && this.contexto && this.microfone.readyState === 'live') return true;
    this.contexto ??= new AudioContext();
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.microfone = mic.getAudioTracks()[0] ?? null;
    } catch {
      this.mudar({
        ...INICIAL,
        aberto: true,
        fase: 'falhou',
        erro: 'O navegador não liberou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.',
      });
      this.liberarAudio(true);
      return false;
    }
    const ctx = this.contexto;
    // O que sai para o lead: o seu microfone (e o aviso de gravação, quando ele toca).
    this.saida = ctx.createMediaStreamDestination();
    if (this.microfone) {
      this.fonteMic = ctx.createMediaStreamSource(new MediaStream([this.microfone]));
      this.fonteMic.connect(this.saida);
    }
    return true;
  }

  /** Solta o microfone (o fim da lista, ou depois de uma ligação avulsa). */
  liberarAudio(forcar = false) {
    if (this.manterAudio && !forcar) return;
    this.manterAudio = false;
    this.microfone?.stop();
    this.microfone = null;
    this.fonteMic = null;
    this.saida = null;
    void this.contexto?.close().catch(() => undefined);
    this.contexto = null;
  }

  /** Ligação avulsa pela ficha (ou pelo número digitado). */
  async ligar(alvo: { telefone: string; empresaId: number | null; lead?: string | null }): Promise<void> {
    if (!this.livre) return;
    this.mudar({ ...INICIAL, fase: 'preparando', aberto: true });
    if (!(await this.prepararAudio())) return;
    let dados: Credenciais;
    try {
      dados = await api('/ligacoes', {
        metodo: 'POST',
        corpo: { telefone: alvo.telefone, empresaId: alvo.empresaId },
      });
    } catch (e) {
      this.mudar({ fase: 'falhou', erro: (e as Error).message });
      this.liberarAudio();
      return;
    }
    const linha = new Linha(dados);
    try {
      await this.assumir(linha);
      await api(`/ligacoes/${dados.id}/discar`, { metodo: 'POST' });
    } catch (e) {
      await this.falhou(linha, e);
    }
  }

  /** Atender uma ligação recebida (o clique no aviso). */
  async atender(id: number): Promise<void> {
    if (!this.livre) return;
    this.mudar({ ...INICIAL, fase: 'preparando', aberto: true });
    if (!(await this.prepararAudio())) return;
    let dados: Credenciais;
    try {
      dados = await api(`/ligacoes/${id}/atender`, { metodo: 'POST' });
    } catch (e) {
      this.mudar({ fase: 'falhou', erro: (e as Error).message });
      this.liberarAudio();
      return;
    }
    const linha = new Linha(dados);
    try {
      await this.assumir(linha);
    } catch (e) {
      await this.falhou(linha, e);
    }
  }

  private async falhou(linha: Linha, e: unknown) {
    const msg = e instanceof ErroApi ? e.message : 'Não deu para completar a ligação. Tente de novo.';
    this.mudar({ fase: 'falhou', erro: msg });
    await api(`/ligacoes/${linha.dados.id}/estado`, {
      metodo: 'POST',
      corpo: { evento: 'falhou', motivo: msg.slice(0, 200) },
    }).catch(() => undefined);
    await linha.sair();
    this.limparLigacao();
    this.liberarAudio();
  }

  /**
   * A linha vira a ligação da tela: entra na sala (se ainda não entrou), manda o microfone, toca o
   * som do lado de lá e, quando atende, grava. O discador usa isto com a linha que atendeu primeiro.
   */
  async assumir(linha: Linha): Promise<void> {
    if (!this.contexto || !this.saida) throw new Error('Microfone não preparado');
    this.encerrando = false;
    this.gravacoes = {};
    this.linha = linha;
    const ctx = this.contexto;
    this.conversa = ctx.createMediaStreamDestination();
    this.fonteMic?.connect(this.conversa);
    const d = linha.dados;
    if (d.aviso?.falado && !this.avisoAudio)
      void fetch('/api/ligacoes/aviso', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? ctx.decodeAudioData(b) : null))
        .then((a) => {
          this.avisoAudio = a;
        })
        .catch(() => undefined);
    this.mudar({
      ...INICIAL,
      aberto: true,
      ligacao: d,
      fase: linha.fase === 'atendida' ? 'em_andamento' : 'chamando',
    });
    linha.aoMudar = (l) => this.linhaMudou(l);
    if (!linha.sala) await linha.conectar();
    await linha.publicar(this.saida.stream.getAudioTracks()[0]!);
    this.linhaMudou(linha);
  }

  private linhaMudou(l: Linha) {
    if (l !== this.linha) return;
    if (l.remota && !this.somDoLead) this.ouvirLead(l.remota);
    if (l.fase === 'tocando' && this.estado.fase === 'chamando') {
      this.mudar({ fase: 'tocando' });
      void this.contar('tocando');
    } else if (l.fase === 'atendida' && !this.estado.atendeu) void this.atendeu();
    else if (l.fase === 'encerrada') void this.terminar('o outro lado desligou');
  }

  private ouvirLead(remota: RemoteAudioTrack) {
    const el = remota.attach();
    el.style.display = 'none';
    document.body.appendChild(el);
    this.somDoLead = el;
    this.trilhaLead = remota.mediaStreamTrack;
    if (this.contexto && this.conversa)
      this.contexto
        .createMediaStreamSource(new MediaStream([remota.mediaStreamTrack]))
        .connect(this.conversa);
    if (this.estado.atendeu && !this.gravacoes.lead) this.gravarLead();
  }

  private async atendeu() {
    const l = this.estado.ligacao;
    if (!l) return;
    this.mudar({ fase: 'em_andamento', atendeu: true, atendidaEm: Date.now() });
    void this.contar('atendeu');
    if (l.gravar && typeof MediaRecorder !== 'undefined') {
      try {
        if (this.microfone) this.gravacoes.voce = new Gravacao(new MediaStream([this.microfone]));
        if (this.conversa) this.gravacoes.conversa = new Gravacao(this.conversa.stream);
        if (this.trilhaLead) this.gravarLead();
      } catch {
        this.mudar({ gravacaoFalhou: true });
      }
    }
    if (l.aviso) {
      if (l.aviso.falado && this.avisoAudio && this.contexto && this.saida) {
        // O aviso entra na ligação (o lead ouve) e na conversa gravada; você ouve junto.
        const f = this.contexto.createBufferSource();
        f.buffer = this.avisoAudio;
        f.connect(this.saida);
        if (this.conversa) f.connect(this.conversa);
        f.connect(this.contexto.destination);
        f.onended = () => this.mudar({ aviso: null });
        this.mudar({ aviso: 'tocando' });
        f.start();
      } else this.mudar({ aviso: 'ler' });
    }
  }

  private gravarLead() {
    if (!this.trilhaLead || !this.estado.ligacao?.gravar) return;
    try {
      this.gravacoes.lead = new Gravacao(new MediaStream([this.trilhaLead]));
    } catch {
      this.mudar({ gravacaoFalhou: true });
    }
  }

  private contar(evento: 'tocando' | 'atendeu' | 'encerrou', motivo?: string) {
    const l = this.estado.ligacao;
    if (!l) return Promise.resolve();
    return api(`/ligacoes/${l.id}/estado`, { metodo: 'POST', corpo: { evento, motivo } }).catch(
      () => undefined,
    );
  }

  avisoLido() {
    this.mudar({ aviso: null });
  }

  alternarMudo() {
    const mudo = !this.estado.mudo;
    if (this.microfone) this.microfone.enabled = !mudo;
    this.mudar({ mudo });
  }

  /** Tecla do teclado (para o menu de voz do outro lado: "digite 1"). */
  async tecla(digito: string) {
    const codigo = '0123456789*#'.indexOf(digito);
    const sala = this.linha?.sala;
    if (codigo < 0 || !sala) return;
    const valor = digito === '*' ? 10 : digito === '#' ? 11 : codigo;
    await sala.localParticipant.publishDtmf(valor, digito).catch(() => undefined);
  }

  async desligar() {
    const l = this.estado.ligacao;
    if (l) await api(`/ligacoes/${l.id}/desligar`, { metodo: 'POST' }).catch(() => undefined);
    await this.terminar('desligou');
  }

  /** Fim da ligação (quem desligou, o outro lado ou a sala): para as gravações e manda os arquivos. */
  private async terminar(motivo: string) {
    if (this.encerrando || !this.ocupado) return;
    this.encerrando = true;
    const l = this.estado.ligacao;
    const duracao = this.estado.atendidaEm ? Math.round((Date.now() - this.estado.atendidaEm) / 1000) : 0;
    const atendeu = this.estado.atendeu;
    this.mudar({ fase: 'encerrada', duracao, aviso: null });
    await this.contar('encerrou', motivo);
    // Para as gravações antes de sair da sala (a trilha do lead acaba junto com a sala).
    const gravacoes = this.gravacoes;
    this.gravacoes = {};
    const blobs = await Promise.all(
      (['voce', 'lead', 'conversa'] as const).map(async (q) => {
        const g = gravacoes[q];
        return g ? { quem: q, tipo: g.tipo, blob: await g.parar() } : null;
      }),
    );
    await this.linha?.sair();
    if (l && blobs.some((b) => b?.blob.size)) {
      this.mudar({ enviando: true });
      for (const b of blobs) {
        if (!b?.blob.size) continue;
        // Até 3 tentativas (internet oscilando).
        let ok = false;
        for (let i = 0; i < 3 && !ok; i++) {
          ok = await fetch(`/api/ligacoes/${l.id}/audios/${b.quem}?deslocamento=0`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': b.tipo },
            body: b.blob,
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!ok) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
        if (!ok) this.mudar({ gravacaoFalhou: true });
      }
      this.mudar({ enviando: false });
    }
    this.limparLigacao();
    this.liberarAudio();
    // Na lista, quem não atendeu não precisa de "Como foi?": já vai como "não atendeu".
    if (l?.listaItemId && !atendeu) {
      await api(`/ligacoes/${l.id}/resultado`, { metodo: 'POST', corpo: { resultado: 'nao_atendeu' } }).catch(
        () => undefined,
      );
      this.fechar();
    }
  }

  /** O número desconhecido virou lead: a ligação passa a ser dele. */
  vincularLead(empresaId: number, nome: string) {
    const l = this.estado.ligacao;
    if (l) this.mudar({ ligacao: { ...l, empresaId, lead: nome } });
  }

  /** Fecha o painel (depois do "Como foi?"). */
  fechar() {
    if (this.ocupado) return;
    this.mudar({ ...INICIAL });
  }

  private limparLigacao() {
    this.somDoLead?.remove();
    this.somDoLead = null;
    this.trilhaLead = null;
    this.conversa = null;
    this.linha = null;
  }

  /** Toca um áudio (o recado de retorno) numa linha que não é a da tela e sai dela no fim. */
  async recado(linha: Linha, audio: AudioBuffer | null): Promise<void> {
    const ctx = this.contexto;
    if (!ctx || !audio) {
      await linha.sair();
      return;
    }
    const destino = ctx.createMediaStreamDestination();
    const f = ctx.createBufferSource();
    f.buffer = audio;
    f.connect(destino);
    await linha.publicar(destino.stream.getAudioTracks()[0]!).catch(() => undefined);
    await new Promise<void>((resolve) => {
      f.onended = () => resolve();
      f.start();
      setTimeout(resolve, (audio.duration + 2) * 1000);
    });
    await linha.sair();
  }

  /** Decodifica um mp3 da api (o recado de retorno). */
  async audio(caminho: string): Promise<AudioBuffer | null> {
    const ctx = this.contexto;
    if (!ctx) return null;
    try {
      const r = await fetch(`/api${caminho}`, { credentials: 'same-origin' });
      return r.ok ? await ctx.decodeAudioData(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
}

export const telefone = new Telefone();

/** Não deixa fechar a aba no meio da ligação sem avisar. */
if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if (telefone.ocupado || telefone.estado.enviando) e.preventDefault();
  });

// Só no desenvolvimento: deixa as telas de conferência mostrarem cada fase sem ligar de verdade.
if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __telefone: Telefone }).__telefone = telefone;
