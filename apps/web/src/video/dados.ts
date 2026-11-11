import type { DetalheVideo, OpcoesVideo, ResumoVideo, RevisaoVideo } from '@prospeccao/shared/videos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErroApi } from '../api';
import { enviarImagem } from '../carrossel/dados';

/** Vídeos com IA: as consultas da tela e o envio do vídeo em partes. */

export interface SituacaoVideos {
  modulo: boolean;
  armazenamento: boolean;
  servico: boolean;
  franquia: { usados: number; limite: number | null };
  limiteSegundos: number;
  limiteBytes: number;
  tamanhoParte: number;
  /** O que a tela pode oferecer (v129). */
  recursos: { imagensGeradas: boolean; musica: boolean };
  fotosDaEmpresa: number;
}

export interface FotoDaEmpresa {
  id: number;
  nome: string;
  descricao: string | null;
  url: string | null;
}

export type DetalheComFila = DetalheVideo & { naFrente: number };

const EDITANDO = new Set(['na_fila', 'editando']);

export function useSituacaoVideos() {
  return useQuery({
    queryKey: ['videos', 'situacao'],
    queryFn: () => api<SituacaoVideos>('/videos/situacao'),
  });
}

export function useListaVideos() {
  return useQuery({
    queryKey: ['videos', 'lista'],
    queryFn: () => api<{ videos: ResumoVideo[]; franquia: SituacaoVideos['franquia'] }>('/videos'),
    // Enquanto algum vídeo está na fila ou sendo editado, a lista acompanha.
    refetchInterval: (q) => (q.state.data?.videos.some((v) => EDITANDO.has(v.situacao)) ? 4000 : false),
  });
}

export function useVideo(id: number) {
  return useQuery({
    queryKey: ['videos', id],
    queryFn: () => api<DetalheComFila>(`/videos/${id}`),
    refetchInterval: (q) => (q.state.data && EDITANDO.has(q.state.data.situacao) ? 3000 : false),
  });
}

/** Link temporário do vídeo pronto, da capa, do original, de uma imagem ou da música (vale 1 hora). */
export function useArquivo(
  id: number,
  tipo: 'final' | 'capa' | 'original' | 'imagem' | 'musica' | 'previa' | 'previa-video',
  ligado: boolean,
  chave?: string,
  imagem?: string,
) {
  return useQuery({
    queryKey: ['videos', id, 'arquivo', tipo, imagem ?? '', chave ?? ''],
    queryFn: () =>
      api<{ url: string }>(
        `/videos/${id}/arquivo?tipo=${tipo}${imagem ? `&imagem=${encodeURIComponent(imagem)}` : ''}`,
      ),
    enabled: ligado,
    staleTime: 40 * 60_000,
  });
}

export function useFotosDaEmpresa(ligado: boolean) {
  return useQuery({
    queryKey: ['videos', 'fotos'],
    queryFn: () => api<{ fotos: FotoDaEmpresa[] }>('/videos/fotos'),
    enabled: ligado,
    staleTime: 30 * 60_000,
  });
}

/** Foto sua para uma imagem do vídeo (ou para pôr uma imagem nova num momento do editado). */
export function useFotoPropria(id: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (e: { arquivo: File; imagem?: string; em?: number }) => {
      const q = e.imagem ? `imagem=${encodeURIComponent(e.imagem)}` : `em=${e.em ?? 0}`;
      return enviarImagem<DetalheVideo>(`/videos/${id}/imagens/foto?${q}`, e.arquivo);
    },
    onSuccess: (d) => {
      cliente.setQueryData<DetalheComFila>(['videos', id], (x) =>
        x ? { ...x, ...d } : { ...d, naFrente: 0 },
      );
    },
  });
}

export function useRevisao(id: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (
      r: Omit<RevisaoVideo, 'versao' | 'cortes' | 'palavras' | 'momentos' | 'imagens'> &
        Partial<Pick<RevisaoVideo, 'cortes' | 'palavras' | 'momentos' | 'imagens'>>,
    ) => {
      const atual = cliente.getQueryData<DetalheComFila>(['videos', id]);
      return api<DetalheVideo>(`/videos/${id}/revisao`, {
        metodo: 'PUT',
        corpo: { cortes: [], palavras: [], momentos: [], imagens: [], ...r, versao: atual?.versao ?? 1 },
      });
    },
    onSuccess: (d) => {
      cliente.setQueryData<DetalheComFila>(['videos', id], (x) =>
        x ? { ...x, ...d } : { ...d, naFrente: 0 },
      );
      void cliente.invalidateQueries({ queryKey: ['videos', 'lista'] });
    },
  });
}

/** Lê a duração do arquivo no navegador, antes de mandar (vídeo longo demais nem sobe). */
export function duracaoDoArquivo(arquivo: File): Promise<number | null> {
  return new Promise((ok) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(arquivo);
    const fim = (d: number | null) => {
      URL.revokeObjectURL(url);
      ok(d);
    };
    v.preload = 'metadata';
    v.onloadedmetadata = () => fim(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => fim(null);
    setTimeout(() => fim(null), 8000);
    v.src = url;
  });
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enviarParte(caminho: string, corpo: Blob): Promise<void> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      const r = await fetch(`/api${caminho}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream' },
        body: corpo,
      });
      if (r.ok) return;
      const dados = await r.json().catch(() => null);
      const erro = new ErroApi(
        r.status,
        dados?.erro?.codigo ?? 'erro',
        dados?.erro?.mensagem ?? `Não deu para enviar (erro ${r.status}).`,
      );
      if (r.status < 500 || tentativa >= 2) throw erro;
    } catch (erro) {
      if (erro instanceof ErroApi || tentativa >= 2)
        throw erro instanceof ErroApi
          ? erro
          : new ErroApi(
              0,
              'sem_conexao',
              'A conexão caiu no meio do envio. Confira a internet e tente de novo.',
            );
    }
    await esperar(1500 * (tentativa + 1));
  }
}

/** Manda o vídeo em partes e põe na fila de edição. `aoAndar` recebe de 0 a 1. */
export async function enviarVideo(
  arquivo: File,
  dados: { titulo: string; opcoes: OpcoesVideo; duracao: number | null },
  aoAndar: (fracao: number) => void,
): Promise<DetalheVideo> {
  const { id, tamanhoParte } = await api<{ id: number; tamanhoParte: number }>('/videos', {
    metodo: 'POST',
    corpo: { nome: arquivo.name, tipo: arquivo.type || 'video/mp4', bytes: arquivo.size, ...dados },
  });
  const total = Math.max(1, Math.ceil(arquivo.size / tamanhoParte));
  try {
    for (let n = 0; n < total; n++) {
      await enviarParte(
        `/videos/${id}/partes/${n + 1}`,
        arquivo.slice(n * tamanhoParte, (n + 1) * tamanhoParte),
      );
      aoAndar((n + 1) / total);
    }
    return await api<DetalheVideo>(`/videos/${id}/concluir`, { metodo: 'POST', corpo: { partes: total } });
  } catch (erro) {
    // Não deixa um envio pela metade na lista.
    await api(`/videos/${id}`, { metodo: 'DELETE' }).catch(() => undefined);
    throw erro;
  }
}
