import { useSyncExternalStore } from 'react';
import { api, ErroApi } from '../api';
import { type Credenciais, Linha, telefone } from './ligacao';

/**
 * O discador da lista de ligação: pede o próximo lead, liga e, terminado o "Como foi?", espera a
 * pausa e liga para o próximo. Em paralelo (2 ou 3 linhas), liga para vários ao mesmo tempo: o
 * primeiro que atende vai para você; se outro atender enquanto você fala, ele ouve o recado de que
 * você retorna em instantes e volta para o começo da fila.
 */

export interface ItemDaLista {
  id: number;
  empresaId: number;
  nome: string;
  telefone: string;
  situacao: 'na_fila' | 'chamando' | 'feito' | 'retornar' | 'pulado';
  resultado: string | null;
  tentativa: number;
  ligacaoId: number | null;
  duracaoSegundos: number | null;
  situacaoLigacao: string | null;
}

export interface ListaAtual {
  id: number;
  nome: string;
  linhas: number;
  tentarProximo: boolean;
  pausaSegundos: number;
  situacao: 'ativa' | 'pausada';
  criadaEm: string;
  itens: ItemDaLista[];
  foraDoHorario: boolean;
  horario: string;
}

export interface LinhaNaTela {
  ligacaoId: number;
  itemId: number;
  nome: string;
  telefone: string;
  fase: 'conectando' | 'chamando' | 'tocando' | 'atendida' | 'recado' | 'encerrada';
  comVoce: boolean;
}

export interface EstadoDiscador {
  carregado: boolean;
  lista: ListaAtual | null;
  /** O discador está ligando (a aba precisa ficar aberta). */
  rodando: boolean;
  linhas: LinhaNaTela[];
  /** Próxima ligação às (ms), durante a pausa entre uma e outra. */
  proximaEm: number | null;
  concluida: boolean;
  erro: string | null;
}

/** Tempo máximo tocando numa linha em paralelo antes de desistir. */
const TOQUE_MAXIMO = 35_000;

class Discador {
  estado: EstadoDiscador = {
    carregado: false,
    lista: null,
    rodando: false,
    linhas: [],
    proximaEm: null,
    concluida: false,
    erro: null,
  };
  private ouvintes = new Set<() => void>();
  private abertas = new Map<number, { linha: Linha; item: { id: number; nome: string; telefone: string } }>();
  private recadoAudio: AudioBuffer | null = null;
  private telefoneLivre = true;
  private pausa: ReturnType<typeof setTimeout> | null = null;
  private enchendo = false;

  constructor() {
    telefone.assinar(() => this.telefoneMudou());
  }

  assinar = (f: () => void) => {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  };
  ler = () => this.estado;
  private mudar(p: Partial<EstadoDiscador>) {
    this.estado = { ...this.estado, ...p };
    for (const f of this.ouvintes) f();
  }
  private atualizarLinhas() {
    const comVoce = telefone.estado.ligacao?.id;
    this.mudar({
      linhas: [...this.abertas.values()].map(({ linha, item }) => ({
        ligacaoId: linha.dados.id,
        itemId: item.id,
        nome: item.nome,
        telefone: item.telefone,
        fase: (linha as Linha & { recado?: boolean }).recado ? 'recado' : linha.fase,
        comVoce: linha.dados.id === comVoce,
      })),
    });
  }

  async carregar(): Promise<ListaAtual | null> {
    try {
      const lista = await api<ListaAtual | null>('/ligacoes/listas/atual');
      this.mudar({ lista, carregado: true });
      return lista;
    } catch {
      this.mudar({ carregado: true });
      return this.estado.lista;
    }
  }

  usar(lista: ListaAtual | null) {
    this.mudar({ lista, carregado: true, concluida: false, erro: null });
  }

  /** Começa (ou continua) a discar. Chamado no clique: o navegador libera o microfone assim. */
  async comecar(): Promise<void> {
    const l = this.estado.lista;
    if (!l || this.estado.rodando) return;
    if (!(await telefone.prepararAudio(true))) return;
    if (l.situacao === 'pausada')
      this.usar(await api<ListaAtual>(`/ligacoes/listas/${l.id}/continuar`, { metodo: 'POST' }));
    if (l.linhas > 1 && !this.recadoAudio)
      this.recadoAudio = await telefone.audio('/ligacoes/aviso?tipo=retorno');
    this.mudar({ rodando: true, erro: null, concluida: false, proximaEm: null });
    void this.encher();
  }

  /** Para de discar: as linhas tocando são desligadas e voltam para a fila. */
  async pausar(): Promise<void> {
    const l = this.estado.lista;
    this.parar();
    await this.soltarLinhas();
    if (l)
      this.usar(await api<ListaAtual>(`/ligacoes/listas/${l.id}/pausar`, { metodo: 'POST' }).catch(() => l));
  }

  async encerrar(): Promise<void> {
    const l = this.estado.lista;
    this.parar();
    await this.soltarLinhas();
    if (l) await api(`/ligacoes/listas/${l.id}/encerrar`, { metodo: 'POST' }).catch(() => undefined);
    if (!telefone.ocupado) telefone.liberarAudio(true);
    this.mudar({ lista: null, concluida: false });
  }

  /** Pula a pausa e liga já para o próximo. */
  agora() {
    if (this.pausa) clearTimeout(this.pausa);
    this.pausa = null;
    this.mudar({ proximaEm: null });
    void this.encher();
  }

  async pular(itemId: number) {
    const l = await api<ListaAtual | null>(`/ligacoes/listas/itens/${itemId}/pular`, { metodo: 'POST' });
    this.mudar({ lista: l });
  }

  private parar() {
    if (this.pausa) clearTimeout(this.pausa);
    this.pausa = null;
    this.mudar({ rodando: false, proximaEm: null });
  }

  /** Desliga as linhas que ainda tocam (a que está com você continua). */
  private async soltarLinhas() {
    const comVoce = telefone.estado.ligacao?.id;
    await Promise.all(
      [...this.abertas.entries()]
        .filter(([id]) => id !== comVoce)
        .map(async ([id, { linha, item }]) => {
          this.abertas.delete(id);
          await linha.sair();
          await api(`/ligacoes/${id}/desligar`, { metodo: 'POST' }).catch(() => undefined);
          await api(`/ligacoes/listas/itens/${item.id}/devolver`, { metodo: 'POST' }).catch(() => undefined);
        }),
    );
    this.atualizarLinhas();
  }

  /** Terminou o "Como foi?" de uma ligação: espera a pausa e segue a lista. */
  private telefoneMudou() {
    const livre = telefone.livre;
    const antes = this.telefoneLivre;
    this.telefoneLivre = livre;
    this.atualizarLinhas();
    if (!this.estado.rodando || antes || !livre) return;
    void this.carregar();
    const pausa = (this.estado.lista?.pausaSegundos ?? 0) * 1000;
    if (pausa <= 0) {
      void this.encher();
      return;
    }
    this.mudar({ proximaEm: Date.now() + pausa });
    if (this.pausa) clearTimeout(this.pausa);
    this.pausa = setTimeout(() => {
      this.pausa = null;
      this.mudar({ proximaEm: null });
      void this.encher();
    }, pausa);
  }

  /** Abre linhas até o limite da lista (só quando você está livre). */
  private async encher(): Promise<void> {
    if (this.enchendo) return;
    this.enchendo = true;
    try {
      while (this.estado.rodando && !this.pausa && telefone.livre) {
        const l = this.estado.lista;
        if (!l || this.abertas.size >= l.linhas) break;
        let item: { id: number; empresaId: number; telefone: string; nome: string } | null;
        try {
          item = (await api<{ item: typeof item }>(`/ligacoes/listas/${l.id}/proximo`, { metodo: 'POST' }))
            .item;
        } catch (e) {
          this.parar();
          this.mudar({ erro: e instanceof ErroApi ? e.message : 'Não deu para seguir a lista agora.' });
          break;
        }
        if (!item) {
          if (!this.abertas.size) {
            this.parar();
            this.mudar({ concluida: true });
            if (!telefone.ocupado) telefone.liberarAudio(true);
            await this.carregar();
          }
          break;
        }
        await this.abrir(item, l.linhas === 1);
      }
    } finally {
      this.enchendo = false;
      void this.carregar();
    }
  }

  private async abrir(
    item: { id: number; empresaId: number; telefone: string; nome: string },
    sozinha: boolean,
  ) {
    let dados: Credenciais;
    try {
      dados = await api<Credenciais>('/ligacoes', {
        metodo: 'POST',
        corpo: { telefone: item.telefone, empresaId: item.empresaId, listaItemId: item.id },
      });
    } catch (e) {
      // Não deu para ligar para este (sem permissão, número bloqueado…): pula e segue.
      await api(`/ligacoes/listas/itens/${item.id}/devolver`, { metodo: 'POST' }).catch(() => undefined);
      await api(`/ligacoes/listas/itens/${item.id}/pular`, { metodo: 'POST' }).catch(() => undefined);
      if (e instanceof ErroApi && e.status >= 500) {
        this.parar();
        this.mudar({ erro: e.message });
      }
      return;
    }
    const linha = new Linha(dados);
    this.abertas.set(dados.id, { linha, item });
    this.atualizarLinhas();
    try {
      if (sozinha) await telefone.assumir(linha);
      else {
        linha.aoMudar = (x) => void this.linhaMudou(x);
        await linha.conectar();
      }
      await api(`/ligacoes/${dados.id}/discar`, { metodo: 'POST' });
      if (!sozinha)
        setTimeout(() => {
          if (linha.fase === 'chamando' || linha.fase === 'tocando') void this.naoAtendeu(linha);
        }, TOQUE_MAXIMO);
    } catch {
      await linha.sair();
      await api(`/ligacoes/${dados.id}/estado`, {
        metodo: 'POST',
        corpo: { evento: 'falhou', motivo: 'Não deu para completar a ligação.' },
      }).catch(() => undefined);
      this.abertas.delete(dados.id);
      await api(`/ligacoes/listas/itens/${item.id}/devolver`, { metodo: 'POST' }).catch(() => undefined);
    }
    // A linha sozinha é acompanhada pelo telefone: some daqui quando terminar.
    if (sozinha) this.acompanhar(linha);
  }

  private acompanhar(linha: Linha) {
    const sair = telefone.assinar(() => {
      if (telefone.estado.ligacao?.id === linha.dados.id && telefone.ocupado) return;
      if (telefone.estado.ligacao?.id === linha.dados.id && telefone.estado.aberto) return;
      this.abertas.delete(linha.dados.id);
      this.atualizarLinhas();
      sair();
      // Sem pausa (ou ela já passou): segue a lista.
      if (this.estado.rodando && !this.pausa) setTimeout(() => void this.encher(), 0);
    });
  }

  /** Uma linha em paralelo mudou: atendeu (vai para você, ou ouve o recado) ou terminou. */
  private async linhaMudou(linha: Linha) {
    this.atualizarLinhas();
    const id = linha.dados.id;
    if (linha.fase === 'tocando') {
      void api(`/ligacoes/${id}/estado`, { metodo: 'POST', corpo: { evento: 'tocando' } }).catch(
        () => undefined,
      );
      return;
    }
    if (linha.fase === 'atendida') {
      if (telefone.livre) {
        // A primeira que atende vai para você. As outras continuam tocando.
        linha.aoMudar = () => undefined;
        this.acompanhar(linha);
        await telefone.assumir(linha).catch(() => undefined);
        this.atualizarLinhas();
        return;
      }
      // Você já está numa ligação: o recado e, depois, o lead volta para o começo da fila.
      (linha as Linha & { recado?: boolean }).recado = true;
      linha.aoMudar = () => undefined;
      this.atualizarLinhas();
      await api(`/ligacoes/${id}/estado`, { metodo: 'POST', corpo: { evento: 'atendeu' } }).catch(
        () => undefined,
      );
      await telefone.recado(linha, this.recadoAudio);
      await api(`/ligacoes/${id}/retorno`, { metodo: 'POST' }).catch(() => undefined);
      this.abertas.delete(id);
      this.atualizarLinhas();
      void this.carregar();
      return;
    }
    if (linha.fase === 'encerrada') await this.naoAtendeu(linha);
  }

  private async naoAtendeu(linha: Linha) {
    const id = linha.dados.id;
    if (!this.abertas.has(id) || telefone.estado.ligacao?.id === id) return;
    this.abertas.delete(id);
    linha.aoMudar = () => undefined;
    await linha.sair();
    await api(`/ligacoes/${id}/desligar`, { metodo: 'POST' }).catch(() => undefined);
    await api(`/ligacoes/${id}/resultado`, { metodo: 'POST', corpo: { resultado: 'nao_atendeu' } }).catch(
      () => undefined,
    );
    this.atualizarLinhas();
    void this.encher();
  }
}

export const discador = new Discador();

export function useDiscador() {
  return useSyncExternalStore(discador.assinar, discador.ler);
}

/** Não deixa fechar a aba com a lista discando sem avisar. */
if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if (discador.estado.rodando) e.preventDefault();
  });

// Só no desenvolvimento: deixa as telas de conferência mostrarem as linhas sem ligar de verdade.
if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __discador: Discador }).__discador = discador;
