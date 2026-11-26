import {
  MAX_VERSOES,
  MODOS_MELHORAR,
  type ModoMelhorar,
  type PreviaPorteiro,
  ROTULO_MODO_MELHORAR,
  versoesParecidas,
} from '@prospeccao/shared/porteiro';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { ErroDaApi, Mensagem } from './Formulario';

/*
 * Ajudas da escrita: "Melhorar com IA" (corrigir, mais claro, mais cordial, mais curto, com a
 * diferença marcada antes de usar), o aviso da proteção do número enquanto escreve e as versões de
 * uma mensagem pronta (respostas rápidas, cadência, sequência). O corretor do navegador fica ligado
 * em português nas caixas de texto (spellCheck + lang="pt-BR").
 */

/* ───────────────────────────── Diferença palavra a palavra ───────────────────────────── */

type Pedaco = { tipo: 'igual' | 'tirou' | 'pos'; texto: string };

/** Diferença por palavra (LCS), para mostrar o que a IA mudou. */
export function diferenca(antes: string, depois: string): Pedaco[] {
  const a = antes.split(/(\s+)/);
  const b = depois.split(/(\s+)/);
  // Textos longos: sem a tabela inteira (fica pesado); mostra só o novo.
  if (a.length * b.length > 400_000) return [{ tipo: 'pos', texto: depois }];
  const m = a.length;
  const n = b.length;
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      (t[i] as number[])[j] =
        a[i] === b[j]
          ? ((t[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((t[i + 1] as number[])[j] as number, (t[i] as number[])[j + 1] as number);
  const r: Pedaco[] = [];
  const somar = (tipo: Pedaco['tipo'], texto: string) => {
    const ult = r.at(-1);
    if (ult && ult.tipo === tipo) ult.texto += texto;
    else r.push({ tipo, texto });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      somar('igual', a[i] as string);
      i++;
      j++;
    } else if (((t[i + 1] as number[])[j] as number) >= ((t[i] as number[])[j + 1] as number)) {
      somar('tirou', a[i] as string);
      i++;
    } else {
      somar('pos', b[j] as string);
      j++;
    }
  }
  while (i < m) somar('tirou', a[i++] as string);
  while (j < n) somar('pos', b[j++] as string);
  return r;
}

export function DiferencaTexto(props: { antes: string; depois: string }) {
  const pedacos = useMemo(() => diferenca(props.antes, props.depois), [props.antes, props.depois]);
  return (
    <p className="diferenca">
      {pedacos.map((p, i) =>
        p.tipo === 'igual' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: os pedaços não mudam de ordem
          <span key={i}>{p.texto}</span>
        ) : p.tipo === 'tirou' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: os pedaços não mudam de ordem
          <del key={i}>{p.texto}</del>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: os pedaços não mudam de ordem
          <ins key={i}>{p.texto}</ins>
        ),
      )}
    </p>
  );
}

/* ───────────────────────────── Melhorar com IA ───────────────────────────── */

/**
 * Botão "Melhorar com IA" e a prévia: escolhe o jeito, a IA reescreve (sem mexer em números e
 * links), a diferença aparece marcada e a pessoa usa ou descarta. Vale em todos os planos.
 */
export function MelhorarComIa(props: { texto: string; aoUsar: (novo: string) => void; desligado?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [resultado, setResultado] = useState<{ modo: ModoMelhorar; antes: string; texto: string } | null>(
    null,
  );
  const caixa = useRef<HTMLSpanElement>(null);
  const melhorar = useMutation({
    mutationFn: (modo: ModoMelhorar) =>
      api<{ texto: string }>('/porteiro/melhorar', { metodo: 'POST', corpo: { texto: props.texto, modo } }),
    onSuccess: (r, modo) => setResultado({ modo, antes: props.texto, texto: r.texto }),
  });
  const aberto = menu || !!resultado || !!melhorar.error;
  // Clique fora ou Esc fecha o menu e a prévia (a prévia descartada não muda o texto).
  useEffect(() => {
    if (!aberto) return;
    const fechar = () => {
      setMenu(false);
      setResultado(null);
      melhorar.reset();
    };
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar();
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && fechar();
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto, melhorar.reset]);
  const vazio = !props.texto.trim();
  return (
    <span className="melhorar" ref={caixa}>
      <button
        type="button"
        className="botao-icone"
        title={vazio ? 'Escreva algo para a IA melhorar' : 'Melhorar com IA'}
        aria-label="Melhorar com IA"
        aria-expanded={menu}
        disabled={vazio || props.desligado || melhorar.isPending}
        onClick={() => setMenu((x) => !x)}
      >
        <Icon name={melhorar.isPending ? 'loader' : 'wand-sparkles'} size={18} spin={melhorar.isPending} />
      </button>
      {menu && (
        <span className="melhorar__menu" role="menu" aria-label="Melhorar com IA">
          <span className="melhorar__titulo">Melhorar com IA</span>
          {MODOS_MELHORAR.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitem"
              className="melhorar__opcao"
              onClick={() => {
                setMenu(false);
                setResultado(null);
                melhorar.mutate(m);
              }}
            >
              <b>{ROTULO_MODO_MELHORAR[m].nome}</b>
              <small className="quieto">{ROTULO_MODO_MELHORAR[m].dica}</small>
            </button>
          ))}
        </span>
      )}
      {(resultado || melhorar.error) && (
        <span className="melhorar__previa" role="dialog" aria-label="Prévia do texto melhorado">
          {resultado ? (
            <>
              <span className="melhorar__titulo">
                <Icon name="wand-sparkles" size={12} /> {ROTULO_MODO_MELHORAR[resultado.modo].nome}: o que
                mudou
              </span>
              <DiferencaTexto antes={resultado.antes} depois={resultado.texto} />
              <span className="melhorar__acoes">
                <Button size="sm" variant="ghost" onClick={() => setResultado(null)}>
                  Descartar
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  onClick={() => {
                    props.aoUsar(resultado.texto);
                    setResultado(null);
                  }}
                >
                  Usar este texto
                </Button>
              </span>
            </>
          ) : (
            <>
              <ErroDaApi erro={melhorar.error} />
              <span className="melhorar__acoes">
                <Button size="sm" variant="ghost" onClick={() => melhorar.reset()}>
                  Fechar
                </Button>
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

/* ───────────────────────────── Aviso enquanto escreve ───────────────────────────── */

/** O texto depois de a pessoa parar de digitar um pouco. */
function useTextoParado(texto: string, ms = 700): string {
  const [parado, setParado] = useState(texto);
  useEffect(() => {
    const t = setTimeout(() => setParado(texto), ms);
    return () => clearTimeout(t);
  }, [texto, ms]);
  return parado;
}

/**
 * Proteção do número, antes de mandar: se este texto já foi para muita gente, avisa enquanto a
 * pessoa escreve (e oferece variar com a IA). Só para o WhatsApp.
 */
export function AvisoAoEscrever(props: {
  empresaId: number;
  texto: string;
  aoVariar?: () => void;
  variando?: boolean;
}) {
  const texto = useTextoParado(props.texto.trim());
  const palavras = texto.split(/\s+/).filter(Boolean).length;
  const q = useQuery({
    queryKey: ['porteiro', 'previa', props.empresaId, texto],
    queryFn: () =>
      api<PreviaPorteiro>('/porteiro/previa', {
        metodo: 'POST',
        corpo: { empresaId: props.empresaId, texto },
      }),
    enabled: palavras >= 6 && !texto.startsWith('/'),
    staleTime: 20_000,
    retry: false,
  });
  const p = q.data;
  if (!p || p.nivel === 'ok' || !p.mensagem || texto !== props.texto.trim()) return null;
  return (
    <div className={`aviso-escrever aviso-escrever--${p.nivel}`} role="status">
      <Icon name={p.nivel === 'segura' ? 'lock' : 'circle-help'} size={14} />
      <span>
        <b>Proteção do número:</b> {p.mensagem}
      </span>
      {props.aoVariar && (
        <Button size="sm" variant="ghost" icon="sparkles" disabled={props.variando} onClick={props.aoVariar}>
          {props.variando ? 'Reescrevendo…' : 'Variar com a IA'}
        </Button>
      )}
    </div>
  );
}

/* ───────────────────────────── Versões de uma mensagem pronta ───────────────────────────── */

/**
 * Até mais 2 versões da mensagem (a cada envio o sistema sorteia uma). Avisa na hora quando uma
 * versão ficou parecida demais com outra; "Gerar com a IA" escreve as que faltam.
 */
export function VersoesDoTexto(props: {
  id: string;
  texto: string;
  versoes: string[];
  aoMudar: (v: string[]) => void;
  desligado?: boolean;
  /** Variáveis aceitas, para a dica (ex.: {nome}, {empresa}). */
  dica?: string;
}) {
  const extras = props.versoes;
  const faltam = MAX_VERSOES - 1 - extras.filter((v) => v.trim()).length;
  const par = versoesParecidas([props.texto, ...extras]);
  const gerar = useMutation({
    mutationFn: () =>
      api<{ versoes: string[] }>('/porteiro/versoes', {
        metodo: 'POST',
        corpo: { texto: props.texto, evitar: extras.filter((v) => v.trim()), quantas: Math.max(1, faltam) },
      }),
    onSuccess: (r) => {
      const atuais = extras.filter((v) => v.trim());
      props.aoMudar([...atuais, ...r.versoes].slice(0, MAX_VERSOES - 1));
    },
  });
  const set = (i: number, v: string) => {
    const nova = [...extras];
    nova[i] = v;
    props.aoMudar(nova);
  };
  const mostrar = extras.length ? extras : [];
  return (
    <div className="versoes">
      <div className="versoes__topo">
        <span className="versoes__titulo">
          Versões <span className="quieto">(a cada envio o sistema sorteia uma: protege o número)</span>
        </span>
        <span className="versoes__acoes">
          {!props.desligado && extras.length < MAX_VERSOES - 1 && (
            <button type="button" className="link-botao" onClick={() => props.aoMudar([...extras, ''])}>
              + Versão
            </button>
          )}
          {!props.desligado && faltam > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon="sparkles"
              disabled={!props.texto.trim() || gerar.isPending}
              onClick={() => gerar.mutate()}
            >
              {gerar.isPending ? 'Escrevendo…' : 'Gerar com a IA'}
            </Button>
          )}
        </span>
      </div>
      {mostrar.map((v, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: as versões são editadas no lugar
        <div key={i} className="versoes__item">
          <label htmlFor={`${props.id}-v${i}`} className="pp-sr">
            Versão {i + 2}
          </label>
          <textarea
            id={`${props.id}-v${i}`}
            rows={3}
            maxLength={2000}
            spellCheck
            lang="pt-BR"
            placeholder={`Versão ${i + 2}: a mesma informação com outras palavras`}
            disabled={props.desligado}
            value={v}
            data-parecida={par && par[1] === i + 1 ? true : undefined}
            onChange={(e) => set(i, e.target.value)}
          />
          {!props.desligado && (
            <button
              type="button"
              className="versoes__tirar"
              aria-label={`Tirar a versão ${i + 2}`}
              onClick={() => props.aoMudar(extras.filter((_, k) => k !== i))}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ))}
      {par && (
        <Mensagem tipo="aviso">
          {par[1] === 0 ? 'A mensagem principal' : `A versão ${par[1] + 1}`} está parecida demais com{' '}
          {par[0] === 0 ? 'a principal' : `a versão ${par[0] + 1}`}: para o WhatsApp, conta como o mesmo
          texto. Mude mais as palavras.
        </Mensagem>
      )}
      {props.dica && !!mostrar.length && <span className="campo__dica">{props.dica}</span>}
      <ErroDaApi erro={gerar.error} />
    </div>
  );
}
