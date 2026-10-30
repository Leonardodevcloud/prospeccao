/**
 * Sons de aviso da sala (alguém entrou, saiu, levantou a mão, mandou mensagem, pediu para entrar).
 * Gerados no próprio navegador (nada para baixar) e curtos, como no Meet. Dá para desligar em
 * "Mais opções"; a escolha fica guardada neste aparelho.
 */

export type Som = 'entrou' | 'saiu' | 'mao' | 'mensagem' | 'espera';

const CHAVE = 'reuniao:sons';
let contexto: AudioContext | null = null;

/** Notas de cada aviso: [frequência em Hz, início em s, duração em s]. */
const NOTAS: Record<Som, [number, number, number][]> = {
  // Subindo: alguém chegou.
  entrou: [
    [784, 0, 0.16],
    [1175, 0.12, 0.28],
  ],
  // Descendo: alguém saiu.
  saiu: [
    [988, 0, 0.16],
    [659, 0.12, 0.28],
  ],
  // Três toques claros: pede atenção sem assustar.
  mao: [
    [1047, 0, 0.14],
    [1319, 0.11, 0.14],
    [1568, 0.22, 0.3],
  ],
  // Um toque curto e baixo.
  mensagem: [[880, 0, 0.12]],
  // Campainha (duas vezes): alguém espera na porta.
  espera: [
    [1319, 0, 0.22],
    [1047, 0.2, 0.32],
    [1319, 0.7, 0.22],
    [1047, 0.9, 0.32],
  ],
};
const VOLUME: Record<Som, number> = { entrou: 0.16, saiu: 0.13, mao: 0.18, mensagem: 0.1, espera: 0.2 };

export function sonsLigados(): boolean {
  try {
    return globalThis.localStorage?.getItem(CHAVE) !== 'nao';
  } catch {
    return true;
  }
}

export function guardarSons(ligados: boolean) {
  try {
    globalThis.localStorage?.setItem(CHAVE, ligados ? 'sim' : 'nao');
  } catch {
    // modo privado: vale só agora
  }
}

/**
 * O navegador só deixa tocar som depois de um toque ou clique na página. Chamar no primeiro toque
 * (e ao entrar na sala, que já é um clique).
 */
export function destravarSons() {
  try {
    const Ctx =
      globalThis.AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    contexto ??= new Ctx();
    if (contexto.state === 'suspended') void contexto.resume().catch(() => undefined);
  } catch {
    contexto = null;
  }
}

export function tocar(som: Som) {
  if (!sonsLigados()) return;
  destravarSons();
  const c = contexto;
  if (!c) return;
  if (c.state === 'running') notas(c, som);
  // Recém-liberado: toca assim que o navegador soltar o áudio.
  else
    void c.resume().then(
      () => c.state === 'running' && notas(c, som),
      () => undefined,
    );
}

function notas(c: AudioContext, som: Som) {
  const agora = c.currentTime + 0.02;
  const saida = c.createGain();
  saida.gain.value = VOLUME[som];
  saida.connect(c.destination);
  for (const [freq, inicio, dur] of NOTAS[som]) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Ataque rápido e queda suave (soa como um sino, sem estalo).
    env.gain.setValueAtTime(0, agora + inicio);
    env.gain.linearRampToValueAtTime(1, agora + inicio + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, agora + inicio + dur);
    osc.connect(env);
    env.connect(saida);
    osc.start(agora + inicio);
    osc.stop(agora + inicio + dur + 0.05);
  }
}

/** Aba em segundo plano: o título pisca o aviso até a pessoa voltar. */
let tituloOriginal: string | null = null;
let piscando: ReturnType<typeof setInterval> | null = null;
export function avisarNaAba(texto: string) {
  if (typeof document === 'undefined' || !document.hidden) return;
  tituloOriginal ??= document.title;
  if (piscando) clearInterval(piscando);
  let liga = true;
  document.title = texto;
  piscando = setInterval(() => {
    liga = !liga;
    document.title = liga ? texto : (tituloOriginal ?? '');
  }, 1200);
  const voltar = () => {
    if (document.hidden) return;
    if (piscando) clearInterval(piscando);
    piscando = null;
    if (tituloOriginal !== null) document.title = tituloOriginal;
    tituloOriginal = null;
    document.removeEventListener('visibilitychange', voltar);
  };
  document.addEventListener('visibilitychange', voltar);
}

/** Celular ou tablet (tela de toque): escolhe câmera frontal/traseira em vez da lista de aparelhos. */
export function ehCelular(): boolean {
  try {
    return !!globalThis.matchMedia?.('(pointer: coarse)').matches && (navigator.maxTouchPoints ?? 0) > 0;
  } catch {
    return false;
  }
}
