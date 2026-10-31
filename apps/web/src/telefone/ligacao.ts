import type { Participant, RemoteAudioTrack, Room } from 'livekit-client';
import { api, ErroApi } from '../api';

/**
 * A ligação no navegador: entra na sala do LiveKit com o microfone, pede à api para discar e
 * acompanha o lado do lead (tocando, atendeu, desligou). Grava a sua voz, a do lead e a conversa
 * junta (cada uma num arquivo, só no navegador, sem custo de gravação na nuvem) e manda tudo quando
 * a ligação termina. Uma ligação por vez; as telas acompanham pelo `telefone.estado`.
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
}

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

const IDENTIDADE_LEAD = 'lead';

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

class Telefone {
  estado: EstadoLigacao = INICIAL;
  private ouvintes = new Set<() => void>();
  private sala: Room | null = null;
  private contexto: AudioContext | null = null;
  private microfone: MediaStreamTrack | null = null;
  private conversa: MediaStreamAudioDestinationNode | null = null;
  private saida: MediaStreamAudioDestinationNode | null = null;
  private somDoLead: HTMLMediaElement | null = null;
  private trilhaLead: MediaStreamTrack | null = null;
  private avisoAudio: AudioBuffer | null = null;
  private gravacoes: { voce?: Gravacao; lead?: Gravacao; conversa?: Gravacao } = {};
  private encerrando = false;

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

  /**
   * Liga (precisa ser chamado direto no clique: o navegador só libera microfone e som assim).
   * Pede o microfone, prepara a sala na api, entra e manda discar.
   */
  async ligar(alvo: { telefone: string; empresaId: number | null; lead?: string | null }): Promise<void> {
    if (this.ocupado) return;
    this.encerrando = false;
    this.gravacoes = {};
    this.mudar({ ...INICIAL, fase: 'preparando', aberto: true });
    // O som da ligação passa por aqui (precisa nascer no clique).
    this.contexto = new AudioContext();
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.microfone = mic.getAudioTracks()[0] ?? null;
    } catch {
      this.mudar({
        fase: 'falhou',
        erro: 'O navegador não liberou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.',
      });
      this.limpar();
      return;
    }
    let dados: DadosLigacao & { url: string; token: string };
    try {
      dados = await api('/ligacoes', {
        metodo: 'POST',
        corpo: { telefone: alvo.telefone, empresaId: alvo.empresaId },
      });
    } catch (e) {
      this.mudar({ fase: 'falhou', erro: (e as Error).message });
      this.limpar();
      return;
    }
    this.mudar({ ligacao: dados });
    try {
      await this.entrar(dados);
      await api(`/ligacoes/${dados.id}/discar`, { metodo: 'POST' });
      this.mudar({ fase: this.estado.fase === 'preparando' ? 'chamando' : this.estado.fase });
    } catch (e) {
      const msg = e instanceof ErroApi ? e.message : 'Não deu para completar a ligação. Tente de novo.';
      this.mudar({ fase: 'falhou', erro: msg });
      await api(`/ligacoes/${dados.id}/estado`, {
        metodo: 'POST',
        corpo: { evento: 'falhou', motivo: msg.slice(0, 200) },
      }).catch(() => undefined);
      this.limpar();
    }
  }

  private async entrar(dados: DadosLigacao & { url: string; token: string }) {
    const { Room, RoomEvent, Track } = await import('livekit-client');
    const ctx = this.contexto!;
    // O que sai para o lead: o seu microfone (e o aviso de gravação, quando ele toca).
    this.saida = ctx.createMediaStreamDestination();
    // A conversa junta (para ouvir depois na ficha).
    this.conversa = ctx.createMediaStreamDestination();
    if (this.microfone) {
      const fonte = ctx.createMediaStreamSource(new MediaStream([this.microfone]));
      fonte.connect(this.saida);
      fonte.connect(this.conversa);
    }
    if (dados.aviso?.falado)
      void fetch('/api/ligacoes/aviso', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? ctx.decodeAudioData(b) : null))
        .then((a) => {
          this.avisoAudio = a;
        })
        .catch(() => undefined);

    const sala = new Room({ adaptiveStream: false, dynacast: false });
    this.sala = sala;
    const lerLead = (p: Participant) => {
      if (p.identity !== IDENTIDADE_LEAD) return;
      const st = p.attributes['sip.callStatus'];
      if (st === 'ringing' && this.estado.fase === 'chamando') {
        this.mudar({ fase: 'tocando' });
        void this.contar('tocando');
      }
      if (st === 'active' && !this.estado.atendeu) void this.atendeu();
    };
    sala
      .on(RoomEvent.ParticipantConnected, lerLead)
      .on(RoomEvent.ParticipantAttributesChanged, (_a, p) => lerLead(p))
      .on(RoomEvent.TrackSubscribed, (trilha, _pub, p) => {
        if (p.identity !== IDENTIDADE_LEAD || trilha.kind !== Track.Kind.Audio) return;
        const el = (trilha as RemoteAudioTrack).attach();
        el.style.display = 'none';
        document.body.appendChild(el);
        this.somDoLead = el;
        this.trilhaLead = trilha.mediaStreamTrack;
        const fonte = ctx.createMediaStreamSource(new MediaStream([trilha.mediaStreamTrack]));
        fonte.connect(this.conversa!);
        if (this.estado.atendeu && !this.gravacoes.lead) this.gravarLead();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        if (p.identity === IDENTIDADE_LEAD) void this.terminar('lead desligou');
      })
      .on(RoomEvent.Disconnected, () => {
        void this.terminar('sala fechou');
      });
    await sala.connect(dados.url, dados.token, { autoSubscribe: true });
    const trilha = this.saida.stream.getAudioTracks()[0]!;
    await sala.localParticipant.publishTrack(trilha, { source: Track.Source.Microphone, dtx: false });
    // Lead que já estava na sala (corrida entre discar e entrar).
    for (const p of sala.remoteParticipants.values()) lerLead(p);
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
        f.connect(this.conversa!);
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
    if (codigo < 0 || !this.sala) return;
    const valor = digito === '*' ? 10 : digito === '#' ? 11 : codigo;
    await this.sala.localParticipant.publishDtmf(valor, digito).catch(() => undefined);
  }

  async desligar() {
    const l = this.estado.ligacao;
    if (l) await api(`/ligacoes/${l.id}/desligar`, { metodo: 'POST' }).catch(() => undefined);
    await this.terminar('desligou');
  }

  /** Fim da ligação (quem desligou, o lead ou a sala): para as gravações e manda os arquivos. */
  private async terminar(motivo: string) {
    if (this.encerrando || !this.ocupado) return;
    this.encerrando = true;
    const l = this.estado.ligacao;
    const duracao = this.estado.atendidaEm ? Math.round((Date.now() - this.estado.atendidaEm) / 1000) : 0;
    this.mudar({ fase: 'encerrada', duracao, aviso: null });
    await this.contar('encerrou', motivo);
    const gravacoes = this.gravacoes;
    this.gravacoes = {};
    await this.sala?.disconnect().catch(() => undefined);
    if (l && Object.keys(gravacoes).length) {
      this.mudar({ enviando: true });
      for (const quem of ['voce', 'lead', 'conversa'] as const) {
        const g = gravacoes[quem];
        if (!g) continue;
        const blob = await g.parar();
        if (!blob.size) continue;
        // Até 3 tentativas (internet oscilando).
        let ok = false;
        for (let i = 0; i < 3 && !ok; i++) {
          ok = await fetch(`/api/ligacoes/${l.id}/audios/${quem}?deslocamento=0`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': g.tipo },
            body: blob,
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!ok) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
        if (!ok) this.mudar({ gravacaoFalhou: true });
      }
      this.mudar({ enviando: false });
    }
    this.limpar();
  }

  /** Fecha o painel (depois do "Como foi?"). */
  fechar() {
    if (this.ocupado) return;
    this.mudar({ ...INICIAL });
  }

  private limpar() {
    void this.sala?.disconnect().catch(() => undefined);
    this.microfone?.stop();
    this.microfone = null;
    this.somDoLead?.remove();
    this.somDoLead = null;
    this.trilhaLead = null;
    this.avisoAudio = null;
    void this.contexto?.close().catch(() => undefined);
    this.contexto = null;
    this.saida = null;
    this.conversa = null;
    this.sala = null;
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
