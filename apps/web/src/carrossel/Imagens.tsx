import type { FotoCarrossel } from '@prospeccao/shared/carrosseis';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { enviarImagem, urlFoto } from './dados';

/**
 * As imagens feitas pela IA nos carrosséis (v132): no pedido ao time (gerar o que faltar, a foto do
 * produto para a capa num cenário novo, um post de referência de estilo) e, no editor, os cenários
 * para o produto de uma foto. Cada imagem passa pelo revisor visual antes de aparecer aqui.
 */

export interface ImagensDoPedido {
  gerarImagens: boolean;
  fotoProdutoId: number | null;
  referenciaId: number | null;
}

export const IMAGENS_VAZIAS: ImagensDoPedido = {
  gerarImagens: false,
  fotoProdutoId: null,
  referenciaId: null,
};

const enviadas = (fotos: FotoCarrossel[]) => fotos.filter((f) => (f.origem ?? 'enviada') === 'enviada');

/** O bloco "Imagens" do pedido ao time. */
export function CamposDeImagens(props: {
  ligadas: boolean;
  fotos: FotoCarrossel[];
  valor: ImagensDoPedido;
  mudar: (v: ImagensDoPedido) => void;
}) {
  const { valor, mudar } = props;
  const entrada = useRef<HTMLInputElement>(null);
  const [referencia, setReferencia] = useState<{ nome: string; estilo: string | null } | null>(null);
  const enviar = useMutation({
    mutationFn: (a: File) =>
      enviarImagem<{ id: number; estilo: string | null }>(
        `/carrosseis/referencias?nome=${encodeURIComponent(a.name.slice(0, 80))}`,
        a,
      ).then((r) => ({ ...r, nome: a.name })),
    onSuccess: (r) => {
      setReferencia({ nome: r.nome, estilo: r.estilo });
      mudar({ ...valor, referenciaId: r.id });
    },
  });
  const produtos = enviadas(props.fotos);
  if (!props.ligadas)
    return (
      <p className="quieto novo-time__imagens-desligadas">
        <Icon name="image" size={14} /> Imagens feitas pela IA ainda não estão ligadas nesta plataforma: o
        time usa só as fotos da empresa.
      </p>
    );
  return (
    <fieldset className="campo novo-time__imagens">
      <legend>Imagens</legend>
      <label className="opcao">
        <input
          type="checkbox"
          checked={valor.gerarImagens}
          onChange={(e) => mudar({ ...valor, gerarImagens: e.target.checked })}
        />
        <span>
          A IA pode gerar as imagens que faltarem
          <span className="campo__dica" style={{ display: 'block' }}>
            Sem texto e nas cores da marca, até 3 por carrossel, só onde nenhuma foto da empresa combina. O
            revisor visual confere cada uma.
          </span>
        </span>
      </label>

      <div className="campo">
        <label htmlFor="novo-produto">Foto do produto para a capa</label>
        <select
          id="novo-produto"
          className="filtro"
          value={valor.fotoProdutoId ?? ''}
          onChange={(e) => mudar({ ...valor, fotoProdutoId: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Nenhuma</option>
          {produtos.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
        <span className="campo__dica">
          {produtos.length
            ? 'O produto fica igual. A IA tira o fundo e põe num cenário novo para a capa.'
            : 'Envie a foto do produto em Fotos da empresa para usar aqui.'}
        </span>
      </div>

      <div className="campo">
        <span className="campo__rotulo">Referência de estilo</span>
        {referencia ? (
          <div className="novo-time__referencia">
            <Icon name="image" size={16} />
            <span>
              <b>{referencia.nome}</b>
              <span className="campo__dica" style={{ display: 'block' }}>
                {referencia.estilo
                  ? `O time leu: ${referencia.estilo}`
                  : 'Guardada. O time usa a composição e o clima.'}
              </span>
            </span>
            <button
              type="button"
              className="link-botao"
              onClick={() => {
                setReferencia(null);
                mudar({ ...valor, referenciaId: null });
              }}
            >
              Tirar
            </button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon="upload"
            onClick={() => entrada.current?.click()}
            disabled={enviar.isPending}
          >
            {enviar.isPending ? 'O time está lendo…' : 'Enviar um post de que você gostou'}
          </Button>
        )}
        <input
          ref={entrada}
          type="file"
          className="pp-sr"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const a = e.target.files?.[0];
            e.target.value = '';
            if (a) enviar.mutate(a);
          }}
        />
        <span className="campo__dica">
          O time usa a composição e o clima, com as suas cores e fontes. Não copia a arte de ninguém.
        </span>
        <ErroDaApi erro={enviar.error} />
      </div>
    </fieldset>
  );
}

/** "Cenários para o produto" no editor: o produto da foto do slide em três fundos novos. */
export function CenariosDoProduto(props: {
  fotoId: number;
  carrosselId: number;
  escolhida: number | null;
  aoUsar: (id: number) => void;
}) {
  const cliente = useQueryClient();
  const chave = ['carrosseis', 'fotos', props.fotoId, 'cenarios'];
  const q = useQuery({
    queryKey: chave,
    queryFn: () => api<{ cenarios: FotoCarrossel[] }>(`/carrosseis/fotos/${props.fotoId}/cenarios`),
  });
  const gerar = useMutation({
    mutationFn: () =>
      api<{ feitos: FotoCarrossel[]; reprovados: number }>(`/carrosseis/fotos/${props.fotoId}/cenarios`, {
        metodo: 'POST',
        corpo: { carrosselId: props.carrosselId },
      }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: chave });
      void cliente.invalidateQueries({ queryKey: ['carrosseis', 'fotos'] });
    },
  });
  const lista = q.data?.cenarios ?? [];
  return (
    <div className="cenarios">
      <div className="cenarios__topo">
        <span className="campo__rotulo">Cenários para o produto</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => gerar.mutate()}
          disabled={gerar.isPending}
        >
          {gerar.isPending ? 'Fazendo 3 cenários…' : lista.length ? 'Gerar outros 3' : 'Gerar 3 cenários'}
        </Button>
      </div>
      {gerar.isPending && (
        <p className="quieto">Leva cerca de um minuto: cada cenário passa pelo revisor visual.</p>
      )}
      {lista.length > 0 && (
        <ul className="cenarios__lista">
          <li>
            <button
              type="button"
              className="cenarios__opcao"
              aria-pressed={props.escolhida === props.fotoId}
              onClick={() => props.aoUsar(props.fotoId)}
            >
              <img src={urlFoto(props.fotoId, 240)} alt="" loading="lazy" />
              <span>A sua foto</span>
            </button>
          </li>
          {lista.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="cenarios__opcao"
                aria-pressed={props.escolhida === f.id}
                onClick={() => props.aoUsar(f.id)}
              >
                <img src={urlFoto(f.id, 240)} alt="" loading="lazy" />
                <span>{props.escolhida === f.id ? 'No slide' : 'Usar'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {gerar.data && (
        <p className="campo__dica cenarios__conferido">
          <Icon name="badge-check" size={14} />{' '}
          {gerar.data.feitos.length
            ? `Conferido pelo revisor visual: produto igual ao da foto, sem texto nem marca estranha.${gerar.data.reprovados ? ` ${gerar.data.reprovados} reprovado${gerar.data.reprovados > 1 ? 's' : ''} e descartado${gerar.data.reprovados > 1 ? 's' : ''}.` : ''}`
            : 'O revisor visual reprovou os três (o produto mudou ou apareceu texto). Tente de novo.'}
        </p>
      )}
      {gerar.error && <ErroDaApi erro={gerar.error} />}
      {!lista.length && !gerar.isPending && !gerar.data && (
        <p className="campo__dica">O produto fica igual. Só o fundo e a luz mudam.</p>
      )}
    </div>
  );
}
