import { nichoEntrada, PORTES, ROTULO_PORTE } from '@prospeccao/shared/dominio';
import { Badge, Button, EmptyState, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type Nicho } from '../api';
import { Drawer } from '../componentes/Drawer';
import { CampoLista, ErroDaApi, limparLista, Mensagem } from '../componentes/Formulario';
import { formatarCnae } from '../formatar';

type Rascunho = {
  nome: string;
  cnaes: string[];
  termosMaps: string[];
  palavrasPositivas: string[];
  palavrasNegativas: string[];
  cargosAlvo: string[];
  portes: string[];
  idadeMinimaAnos: string;
  excluirMei: boolean;
};

const VAZIO: Rascunho = {
  nome: '',
  cnaes: [],
  termosMaps: [],
  palavrasPositivas: ['entrega', 'delivery', 'motoboy'],
  palavrasNegativas: [],
  cargosAlvo: ['sócio-administrador'],
  portes: [...PORTES],
  idadeMinimaAnos: '0',
  excluirMei: true,
};

function FormNicho({ nicho, aoFechar }: { nicho: Nicho | null; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState<Rascunho>(
    nicho
      ? { ...nicho, cnaes: nicho.cnaes.map(formatarCnae), idadeMinimaAnos: String(nicho.idadeMinimaAnos) }
      : VAZIO,
  );
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const lista = (campo: keyof Rascunho) => (v: string[]) => setF({ ...f, [campo]: v });

  const salvar = useMutation({
    mutationFn: (dados: unknown) =>
      nicho
        ? api<Nicho>(`/nichos/${nicho.id}`, { metodo: 'PATCH', corpo: dados })
        : api<Nicho>('/nichos', { metodo: 'POST', corpo: dados }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['nichos'] });
      aoFechar();
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const r = nichoEntrada.safeParse({
      ...f,
      cnaes: limparLista(f.cnaes),
      termosMaps: limparLista(f.termosMaps),
      palavrasPositivas: limparLista(f.palavrasPositivas),
      palavrasNegativas: limparLista(f.palavrasNegativas),
      cargosAlvo: limparLista(f.cargosAlvo),
    });
    if (!r.success) return setErroLocal(r.error.issues[0]?.message ?? 'Confira os campos.');
    setErroLocal(null);
    salvar.mutate(r.data);
  };

  const alternarPorte = (p: string) =>
    setF({ ...f, portes: f.portes.includes(p) ? f.portes.filter((x) => x !== p) : [...f.portes, p] });

  return (
    <Drawer
      titulo={nicho ? `Editar ${nicho.nome}` : 'Novo nicho'}
      barra={nicho ? 'Editar nicho' : 'Novo nicho'}
      aoFechar={aoFechar}
    >
      <form className="drawer__corpo form" onSubmit={enviar} noValidate>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>
            {nicho ? nicho.nome : 'Novo nicho'}
          </h2>
          <p className="quieto" style={{ margin: '2px 0 0', fontSize: 13 }}>
            O perfil diz ao motor quem procurar na base de CNPJ e no Google Maps.
          </p>
        </div>
        <TextField
          rotulo="Nome"
          value={f.nome}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, nome: e.target.value })}
          placeholder="Ex.: Pet shop"
        />
        <CampoLista
          id="cnaes"
          rotulo="CNAEs"
          valor={f.cnaes}
          aoMudar={lista('cnaes')}
          exemplo={'4789-0/04'}
          dica="Um por linha. Confira os códigos na Concla (IBGE). Vale CNAE principal ou secundário."
        />
        <CampoLista
          id="termos"
          rotulo="Busca no Google Maps"
          valor={f.termosMaps}
          aoMudar={lista('termosMaps')}
          exemplo={'pet shop\nagropecuária'}
          dica="Um termo por linha; cada termo roda em cada cidade da campanha."
        />
        <CampoLista
          id="positivas"
          rotulo="Palavras que indicam entrega"
          valor={f.palavrasPositivas}
          aoMudar={lista('palavrasPositivas')}
          dica="Usadas no score (Fase 2), ao ler site e Instagram."
        />
        <CampoLista
          id="negativas"
          rotulo="Palavras que descartam"
          valor={f.palavrasNegativas}
          aoMudar={lista('palavrasNegativas')}
          exemplo={'oficina\nfunilaria'}
          dica="Lugar do Maps com uma delas no nome ou na categoria não entra na campanha."
        />
        <CampoLista
          id="cargos"
          rotulo="Cargos do decisor"
          valor={f.cargosAlvo}
          aoMudar={lista('cargosAlvo')}
          exemplo={'sócio-administrador\ngerente de logística'}
          dica="Em ordem de prioridade; usados na busca do LinkedIn (Fase 2)."
        />
        <fieldset className="campo">
          <legend>Porte</legend>
          <div className="opcoes">
            {PORTES.map((p) => (
              <label key={p} className="opcao">
                <input type="checkbox" checked={f.portes.includes(p)} onChange={() => alternarPorte(p)} />
                {ROTULO_PORTE[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <TextField
          rotulo="Idade mínima da empresa (anos)"
          inputMode="numeric"
          value={f.idadeMinimaAnos}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setF({ ...f, idadeMinimaAnos: e.target.value })
          }
          dica="0 aceita empresas abertas este ano."
        />
        <label className="opcao">
          <input
            type="checkbox"
            checked={f.excluirMei}
            onChange={(e) => setF({ ...f, excluirMei: e.target.checked })}
          />
          <span>
            Deixar MEI de fora
            <span className="campo__dica" style={{ display: 'block' }}>
              Microempreendedor individual não tem volume para contratar entregas: não aparece nos leads nem
              gasta enriquecimento.
            </span>
          </span>
        </label>
        {erroLocal && <Mensagem tipo="erro">{erroLocal}</Mensagem>}
        <ErroDaApi erro={salvar.error} />
        <div className="acoes">
          <Button variant="primary" type="submit" icon="check" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : nicho ? 'Salvar nicho' : 'Criar nicho'}
          </Button>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export function Nichos() {
  const cliente = useQueryClient();
  const [editando, setEditando] = useState<Nicho | 'novo' | null>(null);
  const nichos = useQuery({ queryKey: ['nichos'], queryFn: () => api<Nicho[]>('/nichos') });
  const desativar = useMutation({
    mutationFn: (id: number) => api(`/nichos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['nichos'] }),
  });

  return (
    <>
      <div className="topo">
        <div>
          <h1>Nichos</h1>
          <p>Perfis de quem prospectar: CNAEs, termos de busca no Maps e quem decide.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditando('novo')}>
          Novo nicho
        </Button>
      </div>

      <ErroDaApi erro={nichos.error ?? desativar.error} />

      {nichos.data?.length === 0 ? (
        <div className="pp-panel">
          <EmptyState
            icone="store"
            titulo="Nenhum nicho cadastrado"
            texto="Comece por um nicho, como autopeças ou pet shop. Depois crie uma campanha com ele."
            acao={
              <Button size="sm" variant="primary" icon="plus" onClick={() => setEditando('novo')}>
                Novo nicho
              </Button>
            }
          />
        </div>
      ) : (
        <div className="pp-tablewrap">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Nicho</th>
                <th>CNAEs</th>
                <th>Busca no Maps</th>
                <th>Decisor</th>
                <th>Campanhas</th>
                <th>
                  <span className="pp-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {nichos.data?.map((n) => (
                <tr key={n.id}>
                  <td>
                    <b style={{ fontWeight: 500 }}>{n.nome}</b>
                  </td>
                  <td>
                    <span className="mono">{n.cnaes.map(formatarCnae).join(' · ')}</span>
                  </td>
                  <td>{n.termosMaps.join(', ')}</td>
                  <td className="quieto">{n.cargosAlvo[0] ?? '—'}</td>
                  <td>
                    {n.campanhasEmAndamento ? (
                      <Badge tone="brand">{n.campanhasEmAndamento} em andamento</Badge>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button variant="ghost" size="sm" onClick={() => setEditando(n)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={n.campanhasEmAndamento > 0 || desativar.isPending}
                      title={
                        n.campanhasEmAndamento > 0 ? 'Encerre as campanhas deste nicho antes' : undefined
                      }
                      onClick={() => {
                        if (confirm(`Desativar o nicho "${n.nome}"?`)) desativar.mutate(n.id);
                      }}
                    >
                      Desativar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <FormNicho nicho={editando === 'novo' ? null : editando} aoFechar={() => setEditando(null)} />
      )}
    </>
  );
}
