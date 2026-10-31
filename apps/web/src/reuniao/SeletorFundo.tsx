import { CONFIG_FUNDOS_PADRAO } from '@prospeccao/shared/fundos';
import { Icon } from '@prospeccao/ui';
import { useEffect, useRef, useState } from 'react';
import type { InfoSala } from './api';
import type { OpcaoFundo } from './fundos';
import { imagemDoFundo, type MarcaDoFundo } from './fundosImagem';

/** Cor, logo, configuração e fotos da empresa para montar os fundos desta sala. */
export function marcaDaSala(info: InfoSala): MarcaDoFundo {
  return {
    cor: info.empresa.cor,
    logo: info.fundos?.logo ?? null,
    config: info.fundos?.config ?? CONFIG_FUNDOS_PADRAO,
    fotos: info.fundos?.fotos ?? [],
  };
}

/** Miniatura (montada no navegador, já com a logo no lugar). */
export function useMiniatura(id: string, m: MarcaDoFundo | null, largura = 320): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const efeito = id === 'nenhum' || id.startsWith('desfoque');
  // Os desfoques mostram o escritório borrado (só para dar a ideia).
  const base = efeito ? 'cena:escritorio' : id;
  // Só monta de novo quando muda o que aparece na imagem (não a cada desenho da tela).
  const ref = useRef(m);
  ref.current = m;
  const chave = JSON.stringify([
    m?.cor,
    m?.logo,
    m?.config.lugares[base] ?? null,
    base.startsWith('foto:')
      ? m?.fotos.find((f) => `foto:${f.id}` === base)?.url
      : (m?.pessoais?.find((p) => p.id === base)?.url ?? null),
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a chave resume a marca usada na imagem
  useEffect(() => {
    let vivo = true;
    imagemDoFundo(base, ref.current, largura)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setUrl(null));
    return () => {
      vivo = false;
    };
  }, [base, chave, largura]);
  return url;
}

function Miniatura(props: {
  opcao: OpcaoFundo;
  m: MarcaDoFundo;
  ativo: boolean;
  padrao: boolean;
  desligado?: boolean;
  aoEscolher: (id: string) => void;
  /** Fundo da própria pessoa: dá para tirar. */
  aoTirar?: (id: string) => void;
}) {
  const { opcao } = props;
  const url = useMiniatura(opcao.id, props.m);
  const desfoque = opcao.id === 'desfoque-leve' ? 3 : opcao.id === 'desfoque-forte' ? 7 : 0;
  const botao = (
    <button
      type="button"
      className="fundo-op"
      aria-pressed={props.ativo}
      disabled={props.desligado}
      title={opcao.nome}
      onClick={() => props.aoEscolher(opcao.id)}
    >
      <span className="fundo-op__img" data-nenhum={opcao.id === 'nenhum' || undefined}>
        {opcao.id === 'nenhum' ? (
          <Icon name="circle-x" size={22} label="Sem fundo" />
        ) : url ? (
          <img
            src={url}
            alt=""
            style={desfoque ? { filter: `blur(${desfoque}px)`, transform: 'scale(1.12)' } : undefined}
          />
        ) : null}
        {desfoque > 0 && (
          <span className="fundo-op__icone" aria-hidden="true">
            <Icon name="sparkles" size={18} />
          </span>
        )}
        {props.padrao && <span className="fundo-op__selo">Padrão</span>}
      </span>
      <span className="fundo-op__nome">{opcao.nome}</span>
    </button>
  );
  if (!props.aoTirar) return botao;
  return (
    <span className="fundo-op__caixa">
      {botao}
      <button
        type="button"
        className="fundo-op__tirar"
        aria-label={`Tirar o fundo ${opcao.nome}`}
        title="Tirar este fundo"
        onClick={() => props.aoTirar?.(opcao.id)}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

/** "Enviar imagem": o quadradinho com o + no fim dos fundos da pessoa. */
function EnviarFundo(props: { enviando: boolean; aoEnviar: (f: File) => void }) {
  return (
    <label className="fundo-op fundo-op--enviar">
      <input
        className="pp-sr"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={props.enviando}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) props.aoEnviar(f);
        }}
      />
      <span className="fundo-op__img fundo-op__img--enviar">
        <Icon name={props.enviando ? 'loader' : 'plus'} spin={props.enviando} size={20} />
      </span>
      <span className="fundo-op__nome">{props.enviando ? 'Enviando…' : 'Enviar imagem'}</span>
    </label>
  );
}

const GRUPOS: { id: OpcaoFundo['grupo']; nome: (empresa: string) => string }[] = [
  { id: 'pessoais', nome: () => 'Seus fundos' },
  { id: 'efeitos', nome: () => 'Efeitos' },
  { id: 'empresa', nome: (e) => `Da ${e}` },
  { id: 'simples', nome: () => 'Cenários' },
];

/** Os fundos para escolher: em grupos (painel da sala) ou numa faixa só (antessala). */
export function GradeDeFundos(props: {
  opcoes: OpcaoFundo[];
  escolhido: string;
  m: MarcaDoFundo;
  padrao: string | null;
  empresa: string;
  agrupar?: boolean;
  colunas?: number;
  desligado?: boolean;
  aoEscolher: (id: string) => void;
  /** Fundos da própria pessoa: enviar e tirar (sem isso, o grupo "Seus fundos" não aparece). */
  pessoais?: {
    podeEnviar: boolean;
    enviando: boolean;
    erro: string | null;
    aoEnviar: (f: File) => void;
    aoTirar: (id: string) => void;
  };
}) {
  const grade = (lista: OpcaoFundo[], comEnviar = false) => (
    <div className="fundos-grade" data-colunas={props.colunas ?? 3}>
      {lista.map((o) => (
        <Miniatura
          key={o.id}
          opcao={o}
          m={props.m}
          ativo={o.id === props.escolhido}
          padrao={o.id === props.padrao}
          desligado={props.desligado}
          aoEscolher={props.aoEscolher}
          aoTirar={o.grupo === 'pessoais' ? props.pessoais?.aoTirar : undefined}
        />
      ))}
      {comEnviar && props.pessoais?.podeEnviar && (
        <EnviarFundo enviando={props.pessoais.enviando} aoEnviar={props.pessoais.aoEnviar} />
      )}
    </div>
  );
  if (!props.agrupar) return grade(props.opcoes);
  return (
    <div className="fundos-grupos">
      {GRUPOS.map((g) => {
        const lista = props.opcoes.filter((o) => o.grupo === g.id);
        const meus = g.id === 'pessoais' && !!props.pessoais;
        if (!lista.length && !meus) return null;
        return (
          <section key={g.id} className="fundos-grupo" aria-label={g.nome(props.empresa)}>
            <h3 className="fundos-grupo__titulo">{g.nome(props.empresa)}</h3>
            {grade(lista, meus)}
            {meus && props.pessoais?.erro && <p className="fundos-grupo__erro">{props.pessoais.erro}</p>}
            {meus && !lista.length && (
              <p className="fundos-grupo__nota">Envie uma foto sua (JPG ou PNG): a gente ajusta o tamanho.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
