import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { prepararFotoDeFundo } from './fundosImagem';

/**
 * Fundos que a própria pessoa envia (como no Meet). Quem é do time guarda na conta (aparece em
 * qualquer computador); o convidado de fora, só neste navegador.
 */

export interface FundoPessoal {
  id: string;
  nome: string;
  url: string;
}

export const LIMITE_PESSOAIS = 5;
const CHAVE_LOCAL = 'reuniao:meus-fundos';

interface Local {
  n: number;
  nome: string;
  imagem: string;
}

function lerLocais(): Local[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? '[]') as Local[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const nomeDoArquivo = (f: File) =>
  f.name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .slice(0, 40) || 'Meu fundo';

export function useFundosPessoais(doTime: boolean): {
  lista: FundoPessoal[];
  carregado: boolean;
  enviando: boolean;
  erro: string | null;
  podeEnviar: boolean;
  enviar: (f: File) => Promise<string | null>;
  tirar: (id: string) => void;
} {
  const cliente = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [locais, setLocais] = useState<Local[]>(() => (doTime ? [] : lerLocais()));
  const [enviandoLocal, setEnviandoLocal] = useState(false);
  const q = useQuery({
    queryKey: ['meus-fundos'],
    queryFn: () => api<{ fundos: { id: number; nome: string }[]; limite: number }>('/meus-fundos'),
    enabled: doTime,
    staleTime: 60_000,
  });
  const enviarConta = useMutation({
    mutationFn: async (f: File) => {
      const imagem = await prepararFotoDeFundo(f, 1920);
      return api<{ fundos: { id: number; nome: string }[] }>('/meus-fundos', {
        metodo: 'POST',
        corpo: { nome: nomeDoArquivo(f), imagem },
      });
    },
    onSuccess: (r) => cliente.setQueryData(['meus-fundos'], { ...r, limite: LIMITE_PESSOAIS }),
  });
  const tirarConta = useMutation({
    mutationFn: (n: string) =>
      api<{ fundos: { id: number; nome: string }[] }>(`/meus-fundos/${n}`, { metodo: 'DELETE' }),
    onSuccess: (r) => cliente.setQueryData(['meus-fundos'], { ...r, limite: LIMITE_PESSOAIS }),
  });

  const lista: FundoPessoal[] = useMemo(
    () =>
      doTime
        ? (q.data?.fundos ?? []).map((x) => ({
            id: `meu:${x.id}`,
            nome: x.nome,
            url: `/api/meus-fundos/${x.id}`,
          }))
        : locais.map((x) => ({ id: `local:${x.n}`, nome: x.nome, url: x.imagem })),
    [doTime, q.data, locais],
  );

  const enviar = async (f: File): Promise<string | null> => {
    setErro(null);
    if (lista.length >= LIMITE_PESSOAIS) {
      setErro(`Dá para ter até ${LIMITE_PESSOAIS} fundos seus. Tire um para enviar outro.`);
      return null;
    }
    try {
      if (doTime) {
        const r = await enviarConta.mutateAsync(f);
        const novo = r.fundos[r.fundos.length - 1];
        return novo ? `meu:${novo.id}` : null;
      }
      setEnviandoLocal(true);
      // No navegador: um pouco menor, para caber no espaço que ele reserva.
      const imagem = await prepararFotoDeFundo(f, 1280);
      const n = Math.max(0, ...locais.map((x) => x.n)) + 1;
      const novos = [...locais, { n, nome: nomeDoArquivo(f), imagem }];
      localStorage.setItem(CHAVE_LOCAL, JSON.stringify(novos));
      setLocais(novos);
      return `local:${n}`;
    } catch (x) {
      setErro(
        x instanceof DOMException && /quota/i.test(x.name)
          ? 'Não coube mais imagem neste navegador. Tire um fundo para enviar outro.'
          : x instanceof Error
            ? x.message
            : 'Não deu para usar esta imagem.',
      );
      return null;
    } finally {
      setEnviandoLocal(false);
    }
  };

  const tirar = (id: string) => {
    setErro(null);
    const [tipo, n] = id.split(':');
    if (tipo === 'meu') tirarConta.mutate(n!);
    else {
      const novos = locais.filter((x) => String(x.n) !== n);
      try {
        localStorage.setItem(CHAVE_LOCAL, JSON.stringify(novos));
      } catch {
        // sem espaço: some só desta vez
      }
      setLocais(novos);
    }
  };

  return {
    lista,
    carregado: !doTime || !q.isPending,
    enviando: enviarConta.isPending || enviandoLocal,
    erro,
    podeEnviar: lista.length < LIMITE_PESSOAIS,
    enviar,
    tirar,
  };
}
