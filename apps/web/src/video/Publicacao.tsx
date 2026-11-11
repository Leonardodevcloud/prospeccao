import { type DetalheVideo, LIMITE_TEXTO_POST, textoComHashtags } from '@prospeccao/shared/videos';
import { Badge, Button } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { PainelPublicacao, usePublicacao } from '../carrossel/Publicacao';
import { ErroDaApi } from '../componentes/Formulario';

/**
 * A aba Publicação do vídeo (v131): o texto do post do Reels (a redatora escreve; a pessoa ajusta e
 * copia ao postar) e, embaixo, a mesma regra do Comente e receba dos carrosséis, que nasce sozinha
 * quando o fim do vídeo pede para comentar uma palavra.
 */

const separarHashtags = (t: string) =>
  t
    .split(/[\s,;]+/)
    .map((h) => h.replace(/^#+/, '').trim())
    .filter(Boolean);

export function AbaPublicacao(props: { v: DetalheVideo; aoBaixar: () => void }) {
  const { v } = props;
  const cliente = useQueryClient();
  const [texto, setTexto] = useState(v.textoPost);
  const [tags, setTags] = useState(v.hashtags.map((h) => `#${h}`).join(' '));
  const [salvo, setSalvo] = useState(true);
  const [daRedatora, setDaRedatora] = useState(v.textoDaRedatora);
  const atualizar = (d: DetalheVideo) => {
    cliente.setQueryData(['videos', v.id], (antes: object | undefined) => ({ ...antes, ...d }));
    // O texto muda o reconhecimento do Reels (e a redatora pode ter reescrito o direct).
    void cliente.invalidateQueries({ queryKey: ['videos', v.id, 'publicacao'] });
  };
  const salvar = useMutation({
    mutationFn: () =>
      api<DetalheVideo>(`/videos/${v.id}/publicacao/texto`, {
        metodo: 'PUT',
        corpo: { texto, hashtags: separarHashtags(tags) },
      }),
    onSuccess: (d) => {
      setSalvo(true);
      setDaRedatora(false);
      atualizar(d);
    },
  });
  const redatora = useMutation({
    mutationFn: () =>
      api<DetalheVideo & { daRedatora: boolean }>(`/videos/${v.id}/publicacao/texto`, { metodo: 'POST' }),
    onSuccess: (d) => {
      setTexto(d.textoPost);
      setTags(d.hashtags.map((h) => `#${h}`).join(' '));
      setDaRedatora(d.daRedatora);
      setSalvo(true);
      atualizar(d);
    },
  });
  // Vídeo pronto sem texto ainda: a redatora escreve na primeira vez que a aba abre.
  const pediu = useRef(false);
  useEffect(() => {
    if (pediu.current || v.textoPost.trim()) return;
    if (v.situacao !== 'pronto' && v.situacao !== 'revisar') return;
    pediu.current = true;
    redatora.mutate();
  }, [v.textoPost, v.situacao, redatora]);

  const completo = textoComHashtags(texto, separarHashtags(tags));
  const salvarAntes = async () => {
    if (!salvo) await salvar.mutateAsync();
  };

  return (
    <div className="video__publicacao">
      <section className="pub__cartao" aria-label="Texto do post">
        <div className="pub__titulo">
          <b>Texto do post</b>
          {daRedatora && (
            <span className="pub__redatora">
              <img src="/carrosseis/time/redatora.jpg" alt="" />
              escrito pela redatora
            </span>
          )}
        </div>
        <div className="campo">
          <label htmlFor="video-texto-post">O que vai embaixo do Reels</label>
          <textarea
            id="video-texto-post"
            className="filtro"
            rows={7}
            maxLength={LIMITE_TEXTO_POST}
            value={texto}
            disabled={redatora.isPending}
            placeholder={redatora.isPending ? 'A redatora está escrevendo…' : ''}
            onChange={(e) => {
              setTexto(e.target.value);
              setSalvo(false);
            }}
          />
        </div>
        <div className="campo">
          <label htmlFor="video-hashtags">Hashtags</label>
          <input
            id="video-hashtags"
            className="filtro"
            value={tags}
            disabled={redatora.isPending}
            placeholder="#autopecas #freios"
            onChange={(e) => {
              setTags(e.target.value);
              setSalvo(false);
            }}
          />
        </div>
        <span className="campo__dica">
          {completo.length.toLocaleString('pt-BR')} de {LIMITE_TEXTO_POST.toLocaleString('pt-BR')} · as
          primeiras 125 letras aparecem antes do “mais”. É por este texto que o CRM reconhece o Reels.
        </span>
        <ErroDaApi erro={salvar.error ?? redatora.error} />
        <div className="pub__acoes">
          <Button
            size="sm"
            variant={salvo ? 'secondary' : 'primary'}
            onClick={() => salvar.mutate()}
            disabled={salvo || salvar.isPending}
          >
            {salvar.isPending ? 'Salvando…' : salvo ? 'Texto salvo' : 'Salvar o texto'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => redatora.mutate()} disabled={redatora.isPending}>
            {redatora.isPending ? 'A redatora está escrevendo…' : 'Pedir outro à redatora'}
          </Button>
        </div>
      </section>
      <PainelPublicacao
        peca={{ tipo: 'video', id: v.id }}
        legenda={completo}
        salvarAntes={salvarAntes}
        aoMudarSituacao={() => void cliente.invalidateQueries({ queryKey: ['videos', v.id] })}
        aoBaixar={props.aoBaixar}
      />
    </div>
  );
}

/** O selo do topo: a regra do vídeo esperando o post, ligada, ou nada. */
export function SeloPublicacao(props: { videoId: number; ligado: boolean }) {
  const q = usePublicacao({ tipo: 'video', id: props.videoId });
  if (!props.ligado) return null;
  const p = q.data;
  if (!p?.regra) return null;
  const palavra = p.regra.palavras[0];
  if (p.situacao === 'publicado') return <Badge tone="brand">Comente {palavra} · no Instagram</Badge>;
  if (p.situacao === 'esperando' || p.situacao === 'nao_achado')
    return <Badge tone="warning">Comente {palavra} · esperando o post</Badge>;
  return null;
}
