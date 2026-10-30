/**
 * Envio da gravação feita no navegador: pedaços de 2 segundos, um de cada vez e na ordem.
 *
 * Cada pedaço fica guardado no próprio computador (IndexedDB) até a api confirmar que recebeu. Se a
 * internet cair, tenta de novo sozinho; se a aba fechar, o que faltou sobe na próxima vez que o
 * sistema for aberto neste navegador. Com a internet fraca, o envio espera (a reunião tem a
 * prioridade) e o que ficou para trás sobe depois.
 */

const BANCO = 'reuniao-gravacoes';
const PEDACOS = 'pedacos';
const ENVIOS = 'envios';

interface RegistroEnvio {
  local: string;
  codigo: string;
  credencial: string;
  gravacaoId: string | null;
  /** Quantos pedaços a gravação teve (preenchido quando ela termina). */
  total: number | null;
}
interface RegistroPedaco {
  local: string;
  n: number;
  dados: Blob;
}

/* ───────── IndexedDB (falhar aqui nunca impede a gravação: só deixa de guardar a cópia) ───────── */

let bancoAberto: Promise<IDBDatabase | null> | null = null;
function banco(): Promise<IDBDatabase | null> {
  bancoAberto ??= new Promise((resolve) => {
    try {
      const pedido = indexedDB.open(BANCO, 1);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains(PEDACOS))
          db.createObjectStore(PEDACOS, { keyPath: ['local', 'n'] });
        if (!db.objectStoreNames.contains(ENVIOS)) db.createObjectStore(ENVIOS, { keyPath: 'local' });
      };
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return bancoAberto;
}

async function operar<T>(
  loja: string,
  modo: IDBTransactionMode,
  fazer: (s: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await banco();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(loja, modo);
      const pedido = fazer(t.objectStore(loja));
      t.oncomplete = () => resolve(pedido?.result);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

const guardarEnvio = (r: RegistroEnvio) => operar(ENVIOS, 'readwrite', (s) => s.put(r));
const apagarEnvio = (local: string) => operar(ENVIOS, 'readwrite', (s) => s.delete(local));
const guardarPedaco = (r: RegistroPedaco) => operar(PEDACOS, 'readwrite', (s) => s.put(r));
const apagarPedaco = (local: string, n: number) => operar(PEDACOS, 'readwrite', (s) => s.delete([local, n]));

/* ───────── Pedidos à api ───────── */

class Recusado extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

async function pedir(
  codigo: string,
  credencial: string,
  caminho: string,
  init: { method: string; body?: BodyInit; json?: unknown },
): Promise<unknown> {
  const r = await fetch(`/api/salas/${codigo}${caminho}`, {
    method: init.method,
    credentials: 'same-origin',
    headers: {
      'x-credencial-sala': credencial,
      'content-type': init.json !== undefined ? 'application/json' : 'application/octet-stream',
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    // 4xx: não adianta repetir (gravação fechada, credencial vencida). 5xx e queda: repetir.
    if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)
      throw new Recusado(
        r.status,
        dados?.erro?.codigo ?? 'erro',
        dados?.erro?.mensagem ?? `Erro ${r.status}`,
      );
    throw new Error(`HTTP ${r.status}`);
  }
  return dados;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Envios desta aba (a retomada não mexe neles). */
const ativos = new Set<string>();

/* ───────── Uma gravação sendo enviada ───────── */

export interface Criacao {
  tipo: 'sala' | 'audio';
  identidade?: string;
  nome?: string;
  trilhaId?: string;
  mime: string;
}

export class EnvioEmPedacos {
  readonly local = crypto.randomUUID();
  private gravacaoId: string | null = null;
  private criacao: Promise<string | null>;
  private proximo = 0;
  private fila: { n: number; dados: Blob }[] = [];
  private rodando = false;
  private terminou = false;
  private total: number | null = null;
  private desistiu = false;
  /** Bytes que ainda faltam subir. */
  pendentes = 0;
  enviados = 0;
  /** Chamado quando algo muda (para a tela mostrar o progresso). */
  aoMudar: () => void = () => undefined;
  /** A api recusou (ex.: outra pessoa já grava). */
  aoRecusar: (motivo: string, codigo: string) => void = () => undefined;

  constructor(
    private readonly codigo: string,
    private readonly credencial: string,
    criacao: Criacao,
    /** Momento em que o gravador começou (performance.now()). */
    inicio: number,
    /** Enquanto devolver false (internet fraca, apresentando a tela), o envio espera. */
    private readonly podeEnviar: () => boolean,
  ) {
    ativos.add(this.local);
    void guardarEnvio({ local: this.local, codigo, credencial, gravacaoId: null, total: null });
    this.criacao = this.criar(criacao, inicio);
  }

  private async criar(c: Criacao, inicio: number): Promise<string | null> {
    for (let tentativa = 0; ; tentativa++) {
      try {
        const r = (await pedir(this.codigo, this.credencial, '/gravacoes', {
          method: 'POST',
          json: { ...c, desdeMs: Math.max(0, Math.round(performance.now() - inicio)) },
        })) as { id: string };
        this.gravacaoId = r.id;
        await guardarEnvio({
          local: this.local,
          codigo: this.codigo,
          credencial: this.credencial,
          gravacaoId: r.id,
          total: this.total,
        });
        return r.id;
      } catch (erro) {
        if (erro instanceof Recusado) {
          this.desistir();
          this.aoRecusar(erro.message, erro.codigo);
          return null;
        }
        await esperar(Math.min(10_000, 1000 * 2 ** tentativa));
      }
    }
  }

  get id() {
    return this.gravacaoId;
  }

  /** Um pedaço novo do gravador. */
  adicionar(dados: Blob) {
    if (this.desistiu || !dados.size) return;
    const n = this.proximo++;
    this.fila.push({ n, dados });
    this.pendentes += dados.size;
    void guardarPedaco({ local: this.local, n, dados });
    this.aoMudar();
    void this.enviar();
  }

  /** O gravador parou: depois do último pedaço, avisa a api quantos foram. */
  async concluir(): Promise<void> {
    this.terminou = true;
    this.total = this.proximo;
    if (this.gravacaoId)
      void guardarEnvio({
        local: this.local,
        codigo: this.codigo,
        credencial: this.credencial,
        gravacaoId: this.gravacaoId,
        total: this.total,
      });
    await this.enviar();
  }

  private desistir() {
    this.desistiu = true;
    this.fila = [];
    this.pendentes = 0;
    void apagarEnvio(this.local);
    this.aoMudar();
  }

  private async enviar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const id = await this.criacao;
      if (!id) return;
      let falhas = 0;
      while (this.fila.length && !this.desistiu) {
        // Reunião primeiro: com a internet apertada, segura o envio (o pedaço já está guardado).
        if (!this.podeEnviar() && !this.terminou) {
          await esperar(1000);
          continue;
        }
        const p = this.fila[0]!;
        try {
          await pedir(this.codigo, this.credencial, `/gravacoes/${id}/pedacos/${p.n}`, {
            method: 'PUT',
            body: p.dados,
          });
          this.fila.shift();
          this.pendentes -= p.dados.size;
          this.enviados += p.dados.size;
          falhas = 0;
          void apagarPedaco(this.local, p.n);
          this.aoMudar();
        } catch (erro) {
          if (erro instanceof Recusado) {
            this.desistir();
            return;
          }
          falhas++;
          await esperar(Math.min(15_000, 500 * 2 ** falhas));
        }
      }
      if (this.terminou && !this.fila.length && !this.desistiu && this.total !== null) {
        for (let tentativa = 0; tentativa < 8; tentativa++) {
          try {
            await pedir(this.codigo, this.credencial, `/gravacoes/${id}/concluir`, {
              method: 'POST',
              json: { pedacos: this.total },
            });
            break;
          } catch (erro) {
            if (erro instanceof Recusado) break;
            await esperar(Math.min(15_000, 1000 * 2 ** tentativa));
          }
        }
        void apagarEnvio(this.local);
        this.aoMudar();
      }
    } finally {
      this.rodando = false;
    }
    // Chegou pedaço enquanto fechava a rodada.
    if (this.fila.length && !this.desistiu) void this.enviar();
  }

  /** Terminou de subir tudo (ou desistiu). */
  get vazio() {
    return this.desistiu || (this.terminou && !this.fila.length && !this.rodando);
  }
}

/**
 * O que ficou para trás de uma reunião anterior (a aba fechou antes de subir tudo): sobe agora.
 * Roda ao abrir o sistema; não faz nada se não houver pendência.
 */
export async function retomarEnviosPendentes(): Promise<void> {
  try {
    // Não cria o banco à toa em quem nunca gravou.
    const lista = await indexedDB.databases?.();
    if (lista && !lista.some((b) => b.name === BANCO)) return;
  } catch {
    return;
  }
  const envios = ((await operar(ENVIOS, 'readonly', (s) => s.getAll())) ?? []) as RegistroEnvio[];
  for (const e of envios) {
    if (ativos.has(e.local)) continue;
    const pedacos = ((await operar(PEDACOS, 'readonly', (s) =>
      s.getAll(IDBKeyRange.bound([e.local, 0], [e.local, Number.MAX_SAFE_INTEGER])),
    )) ?? []) as RegistroPedaco[];
    if (!e.gravacaoId) {
      for (const p of pedacos) await apagarPedaco(e.local, p.n);
      await apagarEnvio(e.local);
      continue;
    }
    try {
      for (const p of pedacos.sort((a, b) => a.n - b.n)) {
        await pedir(e.codigo, e.credencial, `/gravacoes/${e.gravacaoId}/pedacos/${p.n}`, {
          method: 'PUT',
          body: p.dados,
        });
        await apagarPedaco(e.local, p.n);
      }
      if (e.total !== null)
        await pedir(e.codigo, e.credencial, `/gravacoes/${e.gravacaoId}/concluir`, {
          method: 'POST',
          json: { pedacos: e.total },
        });
      await apagarEnvio(e.local);
    } catch (erro) {
      // Recusado (gravação já montada ou credencial vencida): não há mais o que fazer com estes pedaços.
      if (erro instanceof Recusado) {
        for (const p of pedacos) await apagarPedaco(e.local, p.n);
        await apagarEnvio(e.local);
      }
      // Sem internet: fica para a próxima vez.
    }
  }
}
