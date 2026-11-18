import { FilesetResolver, ImageSegmenter, type MPMask } from '@mediapipe/tasks-vision';

/**
 * Recorte da pessoa nas reuniões (fundo com imagem ou desfocado), feito por nós.
 *
 * O recorte pronto da biblioteca pedia ao modelo só "é pessoa / é fundo" e disfarçava a borda com um
 * borrão fixo: sobrava um contorno do fundo real em volta do cabelo e do ombro, e a borda tremia.
 * Aqui o mesmo modelo (leve, roda no navegador, sem custo) devolve a CONFIANÇA de cada ponto, e três
 * passos cuidam da borda:
 *   1. memória entre quadros  — parado, a borda não "ferve"; em movimento, acompanha na hora;
 *   2. borda guiada pela imagem — a máscara (256 px) é ampliada seguindo as cores da câmera, então
 *      ela encosta no contorno de verdade em vez de virar um degrau borrado;
 *   3. leve aperto na borda   — o que é dúvida fica com o cenário, não com a sala.
 * No desfoque, a pessoa não entra na conta do borrão (sem a "aura" da cor da roupa em volta dela).
 */

/** As mesmas opções que a sala já usava. */
export interface OpcoesDoRecorte {
  imagePath?: string;
  blurRadius?: number;
  backgroundDisabled?: boolean;
}

/** De onde vêm o motor e o modelo (o teste troca por arquivos locais). */
export interface CaminhosDoRecorte {
  motor: string;
  modelo: string;
}

/** Tem que ser a mesma versão do pacote `@mediapipe/tasks-vision` instalado. */
const VERSAO_DO_MOTOR = '0.10.14';

export const CAMINHOS_PADRAO: CaminhosDoRecorte = {
  motor: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSAO_DO_MOTOR}/wasm`,
  modelo:
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
};

/** Ajustes do recorte (num lugar só, para calibrar). */
export const AJUSTE = {
  /** Quanto do quadro novo entra quando a pessoa está parada (menor = borda mais calma). */
  memoriaParado: 0.34,
  /** Diferença entre quadros a partir da qual é movimento (aí vale o quadro novo). */
  movimentoDe: 0.25,
  movimentoAte: 0.6,
  /** Maior lado do passo que refina a borda. */
  ladoDoRefino: 640,
  /** Quanto as cores precisam ser parecidas para um ponto "puxar" o vizinho (menor = borda mais colada). */
  toleranciaDeCor: 0.05,
  /** Faixa de confiança que vira borda: com imagem aperta mais (não vaza a sala). */
  bordaImagem: [0.5, 0.85] as const,
  bordaDesfoque: [0.3, 0.75] as const,
  /** Quantos pontos da câmera a borda é amaciada (imagem, desfoque). */
  maciez: [1.5, 3] as const,
  /** Maior lado do fundo desfocado. */
  ladoDoDesfoque: 320,
} as const;

const VERTICE = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** 1. Memória entre quadros (na resolução da máscara). */
const FRAG_MEMORIA = `#version 300 es
precision highp float;
uniform sampler2D u_nova;
uniform sampler2D u_anterior;
uniform bool u_inverter;
uniform bool u_primeiro;
uniform float u_parado;
uniform vec2 u_movimento;
in vec2 v_uv;
out vec4 cor;
void main() {
  float nova = texelFetch(u_nova, ivec2(gl_FragCoord.xy), 0).r;
  if (u_inverter) nova = 1.0 - nova;
  nova = clamp(nova, 0.0, 1.0);
  float antes = texture(u_anterior, v_uv).r;
  float k = mix(u_parado, 1.0, smoothstep(u_movimento.x, u_movimento.y, abs(nova - antes)));
  if (u_primeiro) k = 1.0;
  cor = vec4(vec3(mix(antes, nova, k)), 1.0);
}`;

/** 2. Amplia a máscara seguindo as cores da câmera (filtro bilateral conjunto). */
const FRAG_REFINO = `#version 300 es
precision highp float;
uniform sampler2D u_quadro;
uniform sampler2D u_mascara;
uniform vec2 u_passo;
uniform float u_cor;
in vec2 v_uv;
out vec4 cor;
void main() {
  vec3 centro = texture(u_quadro, v_uv).rgb;
  float soma = 0.0;
  float peso = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 d = vec2(float(x), float(y));
      vec2 uv = v_uv + d * u_passo;
      vec3 dc = texture(u_quadro, uv).rgb - centro;
      float p = exp(-dot(d, d) / 4.5) * exp(-dot(dc, dc) / (2.0 * u_cor * u_cor));
      soma += texture(u_mascara, uv).r * p;
      peso += p;
    }
  }
  cor = vec4(vec3(soma / max(peso, 1e-4)), 1.0);
}`;

/** Desfoque do fundo em duas passadas; a pessoa não entra na conta. */
const FRAG_DESFOQUE = `#version 300 es
precision highp float;
uniform sampler2D u_fonte;
uniform sampler2D u_mascara;
uniform vec2 u_passo;
uniform bool u_primeira;
in vec2 v_uv;
out vec4 cor;
void main() {
  vec4 soma = vec4(0.0);
  float total = 0.0;
  for (int i = -10; i <= 10; i++) {
    float f = float(i);
    float g = exp(-f * f / 32.0);
    vec2 uv = v_uv + f * u_passo;
    vec4 c = texture(u_fonte, uv);
    if (u_primeira) {
      float fundo = 1.0 - smoothstep(0.12, 0.5, texture(u_mascara, uv).r);
      c = vec4(c.rgb * fundo, fundo);
    }
    soma += c * g;
    total += g;
  }
  cor = soma / total;
}`;

/** 3. Junta pessoa e fundo no tamanho da câmera. */
const FRAG_FINAL = `#version 300 es
precision highp float;
uniform sampler2D u_quadro;
uniform sampler2D u_mascara;
uniform sampler2D u_fundo;
uniform bool u_desfoque;
uniform vec2 u_borda;
uniform vec2 u_escala;
uniform vec2 u_suave;
in vec2 v_uv;
out vec4 cor;
void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec3 pessoa = texture(u_quadro, uv).rgb;
  // Média de cinco pontos: tira o dente da borda sem devolver o contorno do fundo.
  float m = texture(u_mascara, uv).r * 0.4
    + (texture(u_mascara, uv + vec2(u_suave.x, 0.0)).r + texture(u_mascara, uv - vec2(u_suave.x, 0.0)).r
    + texture(u_mascara, uv + vec2(0.0, u_suave.y)).r + texture(u_mascara, uv - vec2(0.0, u_suave.y)).r) * 0.15;
  float a = smoothstep(u_borda.x, u_borda.y, m);
  vec3 fundo;
  if (u_desfoque) {
    vec4 b = texture(u_fundo, uv);
    // Onde quase tudo em volta é pessoa não há fundo para mostrar: fica o próprio quadro.
    fundo = mix(pessoa, b.rgb / max(b.a, 0.004), smoothstep(0.0, 0.06, b.a));
  } else {
    fundo = texture(u_fundo, (uv - 0.5) * u_escala + 0.5).rgb;
  }
  cor = vec4(mix(fundo, pessoa, a), 1.0);
}`;

type GL = WebGL2RenderingContext;
type Tela = OffscreenCanvas | HTMLCanvasElement;

interface Alvo {
  textura: WebGLTexture;
  quadro: WebGLFramebuffer;
  largura: number;
  altura: number;
}

function compilar(gl: GL, tipo: number, fonte: string): WebGLShader {
  const s = gl.createShader(tipo);
  if (!s) throw new Error('Sem shader.');
  gl.shaderSource(s, fonte);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const erro = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader do recorte: ${erro}`);
  }
  return s;
}

interface Programa {
  programa: WebGLProgram;
  u: (nome: string) => WebGLUniformLocation | null;
}

function programa(gl: GL, vertice: WebGLShader, frag: string): Programa {
  const p = gl.createProgram();
  if (!p) throw new Error('Sem programa.');
  const f = compilar(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(p, vertice);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Recorte: ${gl.getProgramInfoLog(p)}`);
  const locais = new Map<string, WebGLUniformLocation | null>();
  return {
    programa: p,
    u: (nome) => {
      if (!locais.has(nome)) locais.set(nome, gl.getUniformLocation(p, nome));
      return locais.get(nome) ?? null;
    },
  };
}

function textura(gl: GL): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('Sem textura.');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function alvo(gl: GL, largura: number, altura: number): Alvo {
  const t = textura(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, largura, altura, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const q = gl.createFramebuffer();
  if (!q) throw new Error('Sem framebuffer.');
  gl.bindFramebuffer(gl.FRAMEBUFFER, q);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { textura: t, quadro: q, largura, altura };
}

/** Tamanho que cabe em `lado` mantendo a proporção (nunca maior que o original). */
export function caber(largura: number, altura: number, lado: number): [number, number] {
  const e = Math.min(1, lado / Math.max(largura, altura));
  return [Math.max(2, Math.round(largura * e)), Math.max(2, Math.round(altura * e))];
}

/** Escala para a imagem de fundo cobrir o quadro sem esticar (corta o que sobra, pelo centro). */
export function escalaParaCobrir(lq: number, aq: number, li: number, ai: number): [number, number] {
  const quadro = lq / aq;
  const imagem = li / ai;
  return imagem > quadro ? [quadro / imagem, 1] : [1, imagem / quadro];
}

/** Quanto o desfoque abre a cada amostra (no fundo reduzido), a partir da força pedida pela sala. */
export function passoDoDesfoque(forca: number): number {
  return Math.max(0.25, Math.min(1.6, forca / 22));
}

/** A parte de desenho: recebe o quadro e a máscara e entrega a câmera com o fundo trocado. */
class Pintor {
  private gl: GL;
  private vao: WebGLVertexArrayObject;
  private quad: WebGLBuffer;
  private pMemoria: Programa;
  private pRefino: Programa;
  private pDesfoque: Programa;
  private pFinal: Programa;
  private tQuadro: WebGLTexture;
  private tFundo: WebGLTexture;
  private fundo: { largura: number; altura: number } | null = null;
  private memoria: [Alvo, Alvo] | null = null;
  private lendo = 0;
  private temMemoria = false;
  private refino: [Alvo, Alvo] | null = null;
  private borrao: [Alvo, Alvo] | null = null;
  private largura = 0;
  private altura = 0;

  constructor(private tela: Tela) {
    const gl = tela.getContext('webgl2', { premultipliedAlpha: false, antialias: false }) as GL | null;
    if (!gl) throw new Error('Este navegador não tem o que o fundo da câmera precisa (WebGL 2).');
    this.gl = gl;
    const v = compilar(gl, gl.VERTEX_SHADER, VERTICE);
    this.pMemoria = programa(gl, v, FRAG_MEMORIA);
    this.pRefino = programa(gl, v, FRAG_REFINO);
    this.pDesfoque = programa(gl, v, FRAG_DESFOQUE);
    this.pFinal = programa(gl, v, FRAG_FINAL);
    gl.deleteShader(v);
    const vao = gl.createVertexArray();
    const quad = gl.createBuffer();
    if (!vao || !quad) throw new Error('Sem geometria.');
    this.vao = vao;
    this.quad = quad;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.tQuadro = textura(gl);
    this.tFundo = textura(gl);
  }

  /** O motor que separa a pessoa mexe no mesmo contexto: antes de cada passo, deixa tudo como precisamos. */
  private preparar(p: Programa, destino: Alvo | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, destino ? destino.quadro : null);
    gl.viewport(0, 0, destino ? destino.largura : this.largura, destino ? destino.altura : this.altura);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    // biome-ignore lint/correctness/useHookAtTopLevel: é o useProgram do WebGL, não um hook do React
    gl.useProgram(p.programa);
    gl.bindVertexArray(this.vao);
  }

  private ligar(p: Programa, nome: string, unidade: number, t: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unidade);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(p.u(nome), unidade);
  }

  private desenhar() {
    const gl = this.gl;
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  private soltarTodos(lista: readonly Alvo[] | null) {
    for (const a of lista ?? []) this.soltar(a);
  }

  private soltar(a: Alvo | null) {
    if (!a) return;
    this.gl.deleteTexture(a.textura);
    this.gl.deleteFramebuffer(a.quadro);
  }

  private ajustarTamanho(largura: number, altura: number) {
    if (largura === this.largura && altura === this.altura) return;
    this.largura = largura;
    this.altura = altura;
    if (this.tela.width !== largura) this.tela.width = largura;
    if (this.tela.height !== altura) this.tela.height = altura;
    const gl = this.gl;
    this.soltarTodos(this.refino);
    this.soltarTodos(this.borrao);
    const [lr, ar] = caber(largura, altura, AJUSTE.ladoDoRefino);
    this.refino = [alvo(gl, lr, ar), alvo(gl, lr, ar)];
    const [lb, ab] = caber(largura, altura, AJUSTE.ladoDoDesfoque);
    this.borrao = [alvo(gl, lb, ab), alvo(gl, lb, ab)];
  }

  /** A máscara nova (só vale dentro da resposta do motor) entra na memória. */
  guardarMascara(mascara: MPMask, inverter: boolean) {
    const gl = this.gl;
    const { width, height } = mascara;
    if (!this.memoria || this.memoria[0].largura !== width || this.memoria[0].altura !== height) {
      this.soltarTodos(this.memoria);
      this.memoria = [alvo(gl, width, height), alvo(gl, width, height)];
      this.temMemoria = false;
      this.lendo = 0;
    }
    const antes = this.memoria[this.lendo]!;
    const depois = this.memoria[1 - this.lendo]!;
    const p = this.pMemoria;
    this.preparar(p, depois);
    this.ligar(p, 'u_nova', 0, mascara.getAsWebGLTexture());
    this.ligar(p, 'u_anterior', 1, antes.textura);
    gl.uniform1i(p.u('u_inverter'), inverter ? 1 : 0);
    gl.uniform1i(p.u('u_primeiro'), this.temMemoria ? 0 : 1);
    gl.uniform1f(p.u('u_parado'), AJUSTE.memoriaParado);
    gl.uniform2f(p.u('u_movimento'), AJUSTE.movimentoDe, AJUSTE.movimentoAte);
    this.desenhar();
    this.lendo = 1 - this.lendo;
    this.temMemoria = true;
  }

  /** Esquece a memória (a câmera mudou). */
  esquecer() {
    this.temMemoria = false;
  }

  definirFundo(imagem: ImageBitmap | null) {
    const gl = this.gl;
    if (!imagem) {
      this.fundo = null;
      return;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tFundo);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imagem);
    this.fundo = { largura: imagem.width, altura: imagem.height };
  }

  enviarQuadro(quadro: VideoFrame) {
    const gl = this.gl;
    this.ajustarTamanho(quadro.displayWidth, quadro.displayHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tQuadro);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quadro);
  }

  /** Desenha o quadro já enviado. `desfoque` = força pedida (sem ela, usa a imagem de fundo). */
  pintar(desfoque: number | null): boolean {
    const gl = this.gl;
    if (!this.memoria || !this.temMemoria || !this.refino || !this.borrao) return false;
    if (desfoque === null && !this.fundo) return false;
    const bruta = this.memoria[this.lendo]!;

    // Duas passadas: a primeira cobre a dúvida da máscara (o passo acompanha o tamanho de um ponto
    // dela), a segunda, mais curta, alisa o serrilhado que sobra sem sair do contorno.
    const r = this.pRefino;
    const [grossa, fina] = this.refino;
    for (const [destino, origem, passo] of [
      [grossa, bruta.textura, 0.75],
      [fina, grossa.textura, 0.3],
    ] as const) {
      this.preparar(r, destino);
      this.ligar(r, 'u_quadro', 0, this.tQuadro);
      this.ligar(r, 'u_mascara', 1, origem);
      gl.uniform2f(r.u('u_passo'), passo / bruta.largura, passo / bruta.altura);
      gl.uniform1f(r.u('u_cor'), AJUSTE.toleranciaDeCor);
      this.desenhar();
    }
    const refinada = fina;

    let fundo = this.tFundo;
    if (desfoque !== null) {
      const [ida, volta] = this.borrao;
      const passo = passoDoDesfoque(desfoque);
      const d = this.pDesfoque;
      this.preparar(d, ida);
      this.ligar(d, 'u_fonte', 0, this.tQuadro);
      this.ligar(d, 'u_mascara', 1, refinada.textura);
      gl.uniform2f(d.u('u_passo'), passo / ida.largura, 0);
      gl.uniform1i(d.u('u_primeira'), 1);
      this.desenhar();
      this.preparar(d, volta);
      this.ligar(d, 'u_fonte', 0, ida.textura);
      this.ligar(d, 'u_mascara', 1, refinada.textura);
      gl.uniform2f(d.u('u_passo'), 0, passo / ida.altura);
      gl.uniform1i(d.u('u_primeira'), 0);
      this.desenhar();
      fundo = volta.textura;
    }

    const f = this.pFinal;
    this.preparar(f, null);
    this.ligar(f, 'u_quadro', 0, this.tQuadro);
    this.ligar(f, 'u_mascara', 1, refinada.textura);
    this.ligar(f, 'u_fundo', 2, fundo);
    gl.uniform1i(f.u('u_desfoque'), desfoque !== null ? 1 : 0);
    const borda = desfoque !== null ? AJUSTE.bordaDesfoque : AJUSTE.bordaImagem;
    gl.uniform2f(f.u('u_borda'), borda[0], borda[1]);
    const maciez = AJUSTE.maciez[desfoque !== null ? 1 : 0];
    gl.uniform2f(f.u('u_suave'), maciez / this.largura, maciez / this.altura);
    const escala = this.fundo
      ? escalaParaCobrir(this.largura, this.altura, this.fundo.largura, this.fundo.altura)
      : ([1, 1] as [number, number]);
    gl.uniform2f(f.u('u_escala'), escala[0], escala[1]);
    this.desenhar();
    return true;
  }

  limpar() {
    const gl = this.gl;
    this.soltarTodos(this.memoria);
    this.soltarTodos(this.borrao);
    this.soltarTodos(this.refino);
    gl.deleteTexture(this.tQuadro);
    gl.deleteTexture(this.tFundo);
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
    for (const p of [this.pMemoria, this.pRefino, this.pDesfoque, this.pFinal]) gl.deleteProgram(p.programa);
    this.memoria = null;
    this.borrao = null;
    this.refino = null;
  }
}

const imagens = new Map<string, Promise<ImageBitmap>>();
function abrirImagem(caminho: string): Promise<ImageBitmap> {
  let p = imagens.get(caminho);
  if (!p) {
    p = new Promise<HTMLImageElement>((ok, falhou) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => ok(i);
      i.onerror = () => falhou(new Error('Não deu para abrir a imagem de fundo.'));
      i.src = caminho;
    }).then((i) => createImageBitmap(i));
    // Só o último fundo fica guardado (são imagens grandes).
    imagens.clear();
    imagens.set(caminho, p);
    p.catch(() => imagens.delete(caminho));
  }
  return p;
}

interface Saida {
  enqueue: (quadro: VideoFrame) => void;
}

/**
 * O "transformador" que a sala entrega ao LiveKit: recebe cada quadro da câmera e devolve com o fundo.
 * Tem o mesmo jeito do da biblioteca (init, restart, destroy, update, options), para o resto da sala
 * continuar igual.
 */
export class TransformadorDeRecorte {
  options: OpcoesDoRecorte;
  transformer?: TransformStream<VideoFrame, VideoFrame>;
  private pintor: Pintor | null = null;
  private motor: ImageSegmenter | null = null;
  private tela: Tela | null = null;
  private parado = false;
  private ultimoTempo = 0;
  private fundoPosto: string | null = null;
  /** Como o motor está rodando (para o teste e para o aviso no console). */
  modo: 'placa' | 'processador' | null = null;

  constructor(
    opcoes: OpcoesDoRecorte,
    private caminhos: CaminhosDoRecorte = CAMINHOS_PADRAO,
  ) {
    this.options = { ...opcoes };
  }

  static get suportado(): boolean {
    try {
      return (
        typeof OffscreenCanvas !== 'undefined' &&
        typeof VideoFrame !== 'undefined' &&
        typeof createImageBitmap !== 'undefined' &&
        !!document.createElement('canvas').getContext('webgl2')
      );
    } catch {
      return false;
    }
  }

  async init({ outputCanvas }: { outputCanvas?: Tela | null; inputElement?: unknown }): Promise<void> {
    if (!outputCanvas) throw new TypeError('O recorte precisa de uma tela para desenhar.');
    this.tela = outputCanvas;
    this.pintor = new Pintor(outputCanvas);
    this.fundoPosto = null;
    this.parado = false;
    this.transformer = new TransformStream({ transform: (q, saida) => this.transform(q, saida) });
    const arquivos = await FilesetResolver.forVisionTasks(this.caminhos.motor);
    const criar = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(arquivos, {
        baseOptions: { modelAssetPath: this.caminhos.modelo, delegate },
        canvas: outputCanvas,
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    try {
      this.motor = await criar('GPU');
      this.modo = 'placa';
    } catch {
      // Sem placa de vídeo que sirva: roda no processador (mais lento, mas funciona).
      this.motor = await criar('CPU');
      this.modo = 'processador';
    }
    await this.porFundo();
  }

  async restart(opcoes: { outputCanvas?: Tela | null; inputElement?: unknown }): Promise<void> {
    await this.destroy();
    await this.init(opcoes);
  }

  async destroy(): Promise<void> {
    this.parado = true;
    try {
      this.motor?.close();
    } catch {
      // já fechado
    }
    this.motor = null;
    this.pintor?.limpar();
    this.pintor = null;
    this.tela = null;
    this.fundoPosto = null;
  }

  /** Troca de fundo com a câmera ligada (a sala chama pelo `switchTo`). */
  async update(opcoes: OpcoesDoRecorte): Promise<void> {
    this.options = { ...this.options, ...opcoes };
    await this.porFundo();
  }

  private async porFundo(): Promise<void> {
    const caminho = this.options.imagePath;
    if (!this.pintor) return;
    if (typeof caminho !== 'string') {
      this.fundoPosto = null;
      this.pintor.definirFundo(null);
      return;
    }
    if (this.fundoPosto === caminho) return;
    const imagem = await abrirImagem(caminho);
    // Enquanto abria, a pessoa pode ter escolhido outro fundo.
    if (this.pintor && this.options.imagePath === caminho) {
      this.pintor.definirFundo(imagem);
      this.fundoPosto = caminho;
    }
  }

  async transform(quadro: VideoFrame, saida: Saida): Promise<void> {
    let passouDireto = false;
    try {
      if (!(quadro instanceof VideoFrame) || quadro.codedWidth === 0 || quadro.codedHeight === 0) return;
      const desfoque = typeof this.options.blurRadius === 'number' ? this.options.blurRadius : null;
      const temFundo = desfoque !== null || typeof this.options.imagePath === 'string';
      const pintor = this.pintor;
      const motor = this.motor;
      if (this.parado || this.options.backgroundDisabled || !temFundo || !pintor || !motor || !this.tela) {
        saida.enqueue(quadro);
        passouDireto = true;
        return;
      }
      // O motor exige tempos sempre crescentes.
      const agora = Math.max(performance.now(), this.ultimoTempo + 1);
      this.ultimoTempo = agora;
      motor.segmentForVideo(quadro, agora, (r) => {
        const mascaras = r.confidenceMasks;
        const m = mascaras?.[0];
        // Modelo de uma saída: ela é a pessoa. Com várias classes, a primeira é o fundo.
        if (m) pintor.guardarMascara(m, (mascaras?.length ?? 1) > 1);
        r.close();
      });
      pintor.enviarQuadro(quadro);
      if (pintor.pintar(desfoque)) {
        saida.enqueue(new VideoFrame(this.tela, { timestamp: quadro.timestamp || Date.now() * 1000 }));
      }
      // Sem máscara ou sem a imagem ainda: não manda nada, para a sala de verdade nunca aparecer.
    } catch (e) {
      console.error('[fundo da câmera] não deu para tratar o quadro:', e);
    } finally {
      if (!passouDireto) quadro.close();
    }
  }
}
