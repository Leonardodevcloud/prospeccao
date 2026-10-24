import {
  CAMPOS_IMPORTACAO,
  type CampoImportacao,
  ROTULO_CAMPO_IMPORTACAO,
  UFS,
} from '@prospeccao/shared/importacao';
import { formatarTelefone } from '@prospeccao/shared/normalizar';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type Campanha, type ImportacaoLeads, type Nicho, type PreviaImportacao } from '../api';
import { fmtNumero } from '../formatar';
import { fmtTamanho, lerBase64 } from '../paginas/EmailMarca';
import { Modal } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';
import { useEquipe } from './Sessao';

type Passo = 'arquivo' | 'colunas' | 'destino' | 'andamento';

const MAX_BYTES = 15 * 1024 * 1024;
const GRAVANDO = new Set(['na_fila', 'gravando', 'funil']);

/** Atraso curto entre a escolha da coluna e a prévia (para não pedir a cada clique). */
function useAtrasado<T>(valor: T, ms = 350): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

const PASSOS: { id: Passo; rotulo: string }[] = [
  { id: 'arquivo', rotulo: 'Arquivo' },
  { id: 'colunas', rotulo: 'Colunas' },
  { id: 'destino', rotulo: 'Destino' },
  { id: 'andamento', rotulo: 'Importação' },
];

function Passos({ atual }: { atual: Passo }) {
  const i = PASSOS.findIndex((p) => p.id === atual);
  return (
    <ol className="passos-importacao" aria-label="Etapas">
      {PASSOS.map((p, j) => (
        <li key={p.id} className="passo-imp" data-estado={j < i ? 'feito' : j === i ? 'atual' : undefined}>
          <span className="passos-importacao__n">{j < i ? <Icon name="check" size={12} /> : j + 1}</span>
          {p.rotulo}
        </li>
      ))}
    </ol>
  );
}

/* ───────────── 1. Arquivo ───────────── */

function EscolherArquivo(props: { aoAnalisar: (imp: ImportacaoLeads) => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [nome, setNome] = useState<string | null>(null);
  const analisar = useMutation({
    mutationFn: async (f: File) =>
      api<ImportacaoLeads>('/importacoes-leads/analisar', {
        metodo: 'POST',
        corpo: { nome: f.name, mime: f.type, base64: await lerBase64(f) },
      }),
    onSuccess: props.aoAnalisar,
  });
  const escolher = (f: File | undefined) => {
    setErro(null);
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setErro(`O arquivo tem ${fmtTamanho(f.size)}. O limite é 15 MB: divida a lista em partes.`);
      return;
    }
    setNome(f.name);
    analisar.mutate(f);
  };
  const soltar = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setArrastando(false);
    escolher(e.dataTransfer.files[0]);
  };

  return (
    <div className="pilha" style={{ gap: 12 }}>
      <label
        className="soltar-arquivo"
        data-arrastando={arrastando || undefined}
        data-ocupado={analisar.isPending || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
      >
        <input
          type="file"
          className="pp-sr"
          accept=".xlsx,.xlsm,.csv,.txt,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={analisar.isPending}
          onChange={(e) => escolher(e.target.files?.[0])}
        />
        {analisar.isPending ? (
          <>
            <span className="girando" aria-hidden="true" />
            <b>Lendo {nome}…</b>
            <span className="quieto">Reconhecendo as colunas. PDF pode levar até um minuto.</span>
          </>
        ) : (
          <>
            <Icon name="file-text" size={28} />
            <b>Arraste a lista aqui ou clique para escolher</b>
            <span className="quieto">Excel (.xlsx), CSV ou PDF, até 15 MB</span>
          </>
        )}
      </label>
      {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
      <ErroDaApi erro={analisar.error} />
      <ul className="dicas-importacao">
        <li>
          Pode ser em qualquer formato: o sistema descobre sozinho o que é cada coluna (empresa, contato,
          telefone, e-mail, CNPJ, cidade…). Você confere antes de importar.
        </li>
        <li>Linhas repetidas viram um lead só, e quem já está nos seus leads não é duplicado.</li>
        <li>Os contatos que vêm do seu arquivo são só da sua conta.</li>
      </ul>
    </div>
  );
}

/* ───────────── 2. Colunas e prévia ───────────── */

function Colunas(props: {
  imp: ImportacaoLeads;
  mapa: CampoImportacao[];
  setMapa: (m: CampoImportacao[]) => void;
  cabecalho: number | null;
  setCabecalho: (c: number | null) => void;
  padrao: { cidade: string; uf: string };
  setPadrao: (p: { cidade: string; uf: string }) => void;
  previa: PreviaImportacao | undefined;
  carregando: boolean;
  erro: unknown;
}) {
  const { imp, mapa, previa } = props;
  const colunas = imp.colunas ?? [];
  const usado = (c: CampoImportacao, i: number) =>
    !['telefone', 'whatsapp', 'email', 'observacao', 'ignorar'].includes(c) &&
    mapa.some((m, j) => m === c && j !== i);

  return (
    <div className="grade-importacao">
      <div className="pilha" style={{ gap: 10, minWidth: 0 }}>
        <div className="barra" style={{ justifyContent: 'space-between' }}>
          <span className="quieto" style={{ fontSize: 13 }}>
            {imp.arquivo} · {fmtNumero(imp.linhasDoArquivo ?? 0)} linhas
          </span>
          <Badge tone={imp.leitura === 'ia' ? 'brand' : 'outline'}>
            {imp.leitura === 'ia' ? 'Colunas reconhecidas pela IA' : 'Colunas reconhecidas automaticamente'}
          </Badge>
        </div>
        {(imp.resultado.avisos ?? []).map((a) => (
          <Mensagem key={a} tipo="aviso">
            {a}
          </Mensagem>
        ))}
        {imp.formato !== 'pdf' && (imp.inicio?.length ?? 0) > 1 && (
          <div className="campo" style={{ maxWidth: 420 }}>
            <label htmlFor="imp-cabecalho">Linha com o nome das colunas</label>
            <select
              id="imp-cabecalho"
              className="filtro"
              value={props.cabecalho ?? ''}
              onChange={(e) => props.setCabecalho(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">O arquivo não tem (já começa nos dados)</option>
              {imp.inicio?.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a linha do arquivo é a própria posição
                <option key={i} value={i}>
                  Linha {i + 1}: {l.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="tabela-rolavel">
          <table className="tabela-colunas">
            <thead>
              <tr>
                <th className="cab-col">Coluna do arquivo</th>
                <th className="cab-col">Exemplos</th>
                <th className="cab-col">É o quê?</th>
              </tr>
            </thead>
            <tbody>
              {colunas.map((c) => {
                const campo = mapa[c.indice] ?? 'ignorar';
                return (
                  <tr key={c.indice} className="linha-col" data-ignorada={campo === 'ignorar' || undefined}>
                    <td className="celula-col">
                      <b>{c.cabecalho ?? `Coluna ${c.indice + 1}`}</b>
                    </td>
                    <td className="celula-col quieto">
                      {c.exemplos.length ? (
                        c.exemplos.slice(0, 2).map((x) => (
                          <span key={x} className="exemplo-coluna" title={x}>
                            {x}
                          </span>
                        ))
                      ) : (
                        <span>vazia</span>
                      )}
                    </td>
                    <td className="celula-col celula-col--campo">
                      <label className="pp-sr" htmlFor={`imp-col-${c.indice}`}>
                        O que é a coluna {c.cabecalho ?? c.indice + 1}
                      </label>
                      <select
                        id={`imp-col-${c.indice}`}
                        className="filtro"
                        value={campo}
                        onChange={(e) => {
                          const novo = [...mapa];
                          while (novo.length < colunas.length) novo.push('ignorar');
                          novo[c.indice] = e.target.value as CampoImportacao;
                          props.setMapa(novo);
                        }}
                      >
                        {CAMPOS_IMPORTACAO.map((x) => (
                          <option key={x} value={x} disabled={usado(x, c.indice)}>
                            {ROTULO_CAMPO_IMPORTACAO[x]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="previa-importacao" aria-live="polite">
        <h3 className="subtitulo" style={{ margin: 0 }}>
          Como vai ficar {props.carregando && <span className="girando girando--p" aria-hidden="true" />}
        </h3>
        <ErroDaApi erro={props.erro} />
        {previa && (
          <>
            <div className="numeros-importacao">
              <div className="num-imp">
                <b className="num-imp__v">{fmtNumero(previa.leads)}</b>
                <span className="num-imp__r">leads</span>
              </div>
              <div className="num-imp">
                <b className="num-imp__v">{fmtNumero(previa.comTelefone)}</b>
                <span className="num-imp__r">com telefone</span>
              </div>
              <div className="num-imp">
                <b className="num-imp__v">{fmtNumero(previa.comEmail)}</b>
                <span className="num-imp__r">com e-mail</span>
              </div>
              <div className="num-imp">
                <b className="num-imp__v">{fmtNumero(previa.comContato)}</b>
                <span className="num-imp__r">com contato</span>
              </div>
            </div>
            <ul className="avisos-importacao">
              {previa.repetidas > 0 && (
                <li>{fmtNumero(previa.repetidas)} linhas repetidas foram juntadas no mesmo lead.</li>
              )}
              {previa.semNome > 0 && (
                <li>{fmtNumero(previa.semNome)} linhas sem nome de empresa nem de contato ficam de fora.</li>
              )}
              {previa.jaNaConta > 0 && (
                <li>{fmtNumero(previa.jaNaConta)} já estão nos seus leads (pelo CNPJ): não duplicam.</li>
              )}
              {previa.semContato > 0 && (
                <li>
                  {fmtNumero(previa.semContato)} sem telefone, e-mail nem CNPJ: só ficam bons se enriquecer.
                </li>
              )}
            </ul>
            {(previa.semCidade > 0 || props.padrao.cidade) && (
              <div className="caixa pilha" style={{ gap: 8 }}>
                <span style={{ fontSize: 13 }}>
                  {previa.semCidade > 0 ? (
                    <>
                      <b>{fmtNumero(previa.semCidade)} leads sem cidade.</b> Informe a cidade deles (sem ela,
                      ficam de fora):
                    </>
                  ) : (
                    'Cidade usada para quem não tem:'
                  )}
                </span>
                <div className="form__duas" style={{ gridTemplateColumns: '1fr 90px' }}>
                  <div className="campo">
                    <label htmlFor="imp-cidade">Cidade</label>
                    <input
                      id="imp-cidade"
                      className="filtro"
                      value={props.padrao.cidade}
                      placeholder="Ex.: Salvador"
                      onChange={(e) => props.setPadrao({ ...props.padrao, cidade: e.target.value })}
                    />
                  </div>
                  <div className="campo">
                    <label htmlFor="imp-uf">UF</label>
                    <select
                      id="imp-uf"
                      className="filtro"
                      value={props.padrao.uf}
                      onChange={(e) => props.setPadrao({ ...props.padrao, uf: e.target.value })}
                    >
                      <option value="">—</option>
                      {UFS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
            {previa.amostra.length > 0 && (
              <ul className="amostra-importacao">
                {previa.amostra.slice(0, 4).map((l) => (
                  <li key={`${l.empresa}-${l.linhas[0]}`} className="amostra-imp">
                    <b>{l.empresa}</b>
                    <span className="quieto amostra-imp__det">
                      {[
                        l.contato && `${l.contato}${l.cargo ? ` (${l.cargo})` : ''}`,
                        l.telefones[0] && formatarTelefone(l.telefones[0].numero),
                        l.emails[0],
                        l.cidade && `${l.cidade}${l.uf ? `/${l.uf}` : ''}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'sem contato'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/* ───────────── 3. Destino ───────────── */

export interface Destino {
  tipo: 'nova' | 'campanha';
  nome: string;
  nichoId: string;
  campanhaId: string;
  enriquecer: boolean;
  funil: boolean;
  responsavelId: string;
}

function EscolherDestino(props: { d: Destino; setD: (d: Destino) => void; leads: number }) {
  const { d, setD } = props;
  const nichos = useQuery({ queryKey: ['nichos'], queryFn: () => api<Nicho[]>('/nichos') });
  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });
  const equipe = useEquipe();
  const abertas = campanhas.data?.filter((c) => c.status !== 'encerrada') ?? [];
  const pessoas = equipe.data?.usuarios.filter((u) => u.ativo && !u.convitePendente) ?? [];

  return (
    <div className="pilha" style={{ gap: 16 }}>
      <fieldset className="pilha" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
        <legend className="subtitulo" style={{ marginBottom: 8 }}>
          Para onde vão os {fmtNumero(props.leads)} leads
        </legend>
        <label className="opcao-cartao" data-marcada={d.tipo === 'nova' || undefined}>
          <input
            type="radio"
            name="imp-destino"
            checked={d.tipo === 'nova'}
            onChange={() => setD({ ...d, tipo: 'nova' })}
          />
          <span className="opcao-cartao__texto">
            <b>Uma lista nova</b>
            <span className="quieto opcao-cartao__dica">Aparece em Campanhas como lista importada.</span>
          </span>
        </label>
        {d.tipo === 'nova' && (
          <div className="form__duas" style={{ paddingLeft: 28 }}>
            <div className="campo">
              <label htmlFor="imp-nome">Nome da lista</label>
              <input
                id="imp-nome"
                className="filtro"
                maxLength={120}
                value={d.nome}
                onChange={(e) => setD({ ...d, nome: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="imp-nicho">Nicho</label>
              <select
                id="imp-nicho"
                className="filtro"
                value={d.nichoId}
                onChange={(e) => setD({ ...d, nichoId: e.target.value })}
              >
                <option value="">Escolha…</option>
                {nichos.data?.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nome}
                  </option>
                ))}
              </select>
              <span className="campo__dica">Os sinais do nicho guiam a nota e o enriquecimento.</span>
            </div>
          </div>
        )}
        <label className="opcao-cartao" data-marcada={d.tipo === 'campanha' || undefined}>
          <input
            type="radio"
            name="imp-destino"
            checked={d.tipo === 'campanha'}
            disabled={!abertas.length}
            onChange={() => setD({ ...d, tipo: 'campanha' })}
          />
          <span className="opcao-cartao__texto">
            <b>Uma campanha que já existe</b>
            <span className="quieto opcao-cartao__dica">
              {abertas.length
                ? 'Os leads entram junto com os que a busca achou.'
                : 'Você ainda não tem campanha.'}
            </span>
          </span>
        </label>
        {d.tipo === 'campanha' && (
          <div className="campo" style={{ paddingLeft: 28, maxWidth: 420 }}>
            <label htmlFor="imp-campanha">Campanha</label>
            <select
              id="imp-campanha"
              className="filtro"
              value={d.campanhaId}
              onChange={(e) => setD({ ...d, campanhaId: e.target.value })}
            >
              <option value="">Escolha…</option>
              {abertas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      <div className="pilha" style={{ gap: 8 }}>
        <span className="subtitulo">O que fazer com eles</span>
        <label className="opcao-cartao" data-marcada={d.enriquecer || undefined}>
          <input
            type="checkbox"
            checked={d.enriquecer}
            onChange={(e) => setD({ ...d, enriquecer: e.target.checked })}
          />
          <span className="opcao-cartao__texto">
            <b>Enriquecer</b>
            <span className="quieto opcao-cartao__dica">
              Busca site, Instagram, CNPJ e sócios, confere o WhatsApp e dá a nota de cada lead. Conta no
              limite de leads do seu plano.
            </span>
          </span>
        </label>
        <label className="opcao-cartao" data-marcada={d.funil || undefined}>
          <input
            type="checkbox"
            checked={d.funil}
            onChange={(e) => setD({ ...d, funil: e.target.checked })}
          />
          <span className="opcao-cartao__texto">
            <b>Mandar para o funil</b>
            <span className="quieto opcao-cartao__dica">
              Entram em "A abordar" com a cadência de follow-up.
            </span>
          </span>
        </label>
        {d.funil && (
          <div className="campo" style={{ paddingLeft: 28, maxWidth: 420 }}>
            <label htmlFor="imp-resp">Quem recebe</label>
            <select
              id="imp-resp"
              className="filtro"
              value={d.responsavelId}
              onChange={(e) => setD({ ...d, responsavelId: e.target.value })}
            >
              <option value="">Rodízio da equipe (como os outros leads)</option>
              {pessoas.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── 4. Andamento ───────────── */

function Andamento(props: { imp: ImportacaoLeads }) {
  const { imp } = props;
  const r = imp.resultado;
  const gravando = GRAVANDO.has(imp.status);
  const pct = imp.total ? Math.round((imp.gravados / imp.total) * 100) : 0;
  return (
    <div className="pilha" style={{ gap: 12 }}>
      {gravando ? (
        <>
          <div className="etapa-campanha__topo">
            <b>
              <span className="vivo" aria-hidden="true" />{' '}
              {imp.status === 'funil' ? 'Colocando no funil…' : 'Gravando os leads…'}
            </b>
            <span className="mono">
              {fmtNumero(imp.gravados)} de {fmtNumero(imp.total)}
            </span>
          </div>
          <div
            className="barra-progresso"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <p className="quieto" style={{ margin: 0 }}>
            Pode fechar esta janela: a importação continua e o resultado aparece no card da lista em
            Campanhas.
          </p>
        </>
      ) : imp.status === 'erro' ? (
        <Mensagem tipo="erro">
          A importação falhou e vai tentar de novo sozinha em instantes. Se continuar, fale com o suporte do
          Prospect Team.
        </Mensagem>
      ) : (
        <>
          <Mensagem tipo="ok">
            {fmtNumero(imp.total)} leads importados em <b>{imp.campanha?.nome}</b>.
          </Mensagem>
          <ul className="resumo-importacao">
            {r.novas != null && (
              <li>
                {fmtNumero(r.novas)} empresas novas e {fmtNumero(r.existentes ?? 0)} que o sistema já conhecia
                (os dados foram juntados).
              </li>
            )}
            {!!r.enriquecer && (
              <li>{fmtNumero(r.enriquecer)} foram para o enriquecimento: acompanhe no card da lista.</li>
            )}
            {r.funil && (
              <li>
                {fmtNumero(r.funil.adicionadas)} entraram no funil
                {r.funil.jaNoFunil ? `; ${fmtNumero(r.funil.jaNoFunil)} já estavam lá` : ''}
                {r.funil.duplicadas
                  ? `; ${fmtNumero(r.funil.duplicadas)} têm o mesmo telefone de um lead do funil e ficaram de fora`
                  : ''}
                .
              </li>
            )}
            {!!r.semCidade && <li>{fmtNumero(r.semCidade)} ficaram de fora por não ter cidade.</li>}
            {!!r.semNome && <li>{fmtNumero(r.semNome)} linhas sem nome ficaram de fora.</li>}
          </ul>
          {imp.erro && <Mensagem tipo="aviso">{imp.erro}</Mensagem>}
        </>
      )}
    </div>
  );
}

/* ───────────── O assistente ───────────── */

/**
 * Importar leads que o cliente já tem: arquivo → colunas (com a prévia) → destino → andamento.
 * `campanha` já escolhe o destino (botão "Importar mais leads" do card da lista).
 */
export function ImportarLeads(props: { aoFechar: () => void; campanha?: Campanha }) {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const [passo, setPasso] = useState<Passo>('arquivo');
  const [imp, setImp] = useState<ImportacaoLeads | null>(null);
  const [mapa, setMapa] = useState<CampoImportacao[]>([]);
  const [cabecalho, setCabecalho] = useState<number | null>(null);
  const [padrao, setPadrao] = useState({ cidade: '', uf: '' });
  const [destino, setDestino] = useState<Destino>({
    tipo: props.campanha ? 'campanha' : 'nova',
    nome: '',
    nichoId: props.campanha ? String(props.campanha.nichoId) : '',
    campanhaId: props.campanha ? String(props.campanha.id) : '',
    enriquecer: false,
    funil: false,
    responsavelId: '',
  });

  const pedidoPrevia = useAtrasado(
    useMemo(
      () => ({
        mapa,
        cabecalho,
        cidadePadrao: padrao.cidade.trim() || null,
        ufPadrao: padrao.uf || null,
      }),
      [mapa, cabecalho, padrao],
    ),
  );
  const previa = useQuery({
    queryKey: ['importacao', imp?.id, 'previa', pedidoPrevia],
    queryFn: () =>
      api<PreviaImportacao>(`/importacoes-leads/${imp?.id}/previa`, { metodo: 'POST', corpo: pedidoPrevia }),
    enabled: !!imp && imp.status === 'analisada' && pedidoPrevia.mapa.length > 0,
    placeholderData: (anterior) => anterior,
  });

  // Mudou a linha do cabeçalho: os exemplos de cada coluna mudam (a prévia já guardou a escolha).
  const atual = useQuery({
    queryKey: ['importacao', imp?.id, cabecalho],
    queryFn: () => api<ImportacaoLeads>(`/importacoes-leads/${imp?.id}`),
    enabled: !!imp && passo === 'colunas' && cabecalho !== (imp?.cabecalho ?? null) && previa.isFetched,
  });
  const imp2 = atual.data ?? imp;

  const andamento = useQuery({
    queryKey: ['importacao', imp?.id, 'andamento'],
    queryFn: () => api<ImportacaoLeads>(`/importacoes-leads/${imp?.id}`),
    enabled: !!imp && passo === 'andamento',
    refetchInterval: (q) => (!q.state.data || GRAVANDO.has(q.state.data.status) ? 2000 : false),
  });
  const terminou = andamento.data && !GRAVANDO.has(andamento.data.status);
  useEffect(() => {
    if (terminou) {
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
      cliente.invalidateQueries({ queryKey: ['empresas'] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
    }
  }, [terminou, cliente]);

  const importar = useMutation({
    mutationFn: () =>
      api<ImportacaoLeads>(`/importacoes-leads/${imp?.id}/importar`, {
        metodo: 'POST',
        corpo: {
          ...pedidoPrevia,
          destino:
            destino.tipo === 'nova'
              ? { nova: { nome: destino.nome.trim(), nichoId: Number(destino.nichoId) } }
              : { campanhaId: Number(destino.campanhaId) },
          enriquecer: destino.enriquecer,
          funil: destino.funil
            ? { responsavelId: destino.responsavelId ? Number(destino.responsavelId) : null }
            : null,
        },
      }),
    onSuccess: () => setPasso('andamento'),
  });

  const leads = previa.data
    ? previa.data.leads - (padrao.cidade && padrao.uf ? 0 : previa.data.semCidade)
    : 0;
  const destinoOk =
    destino.tipo === 'nova' ? destino.nome.trim().length >= 2 && !!destino.nichoId : !!destino.campanhaId;
  const desistir = () => {
    if (imp && imp.status === 'analisada' && passo !== 'andamento')
      void api(`/importacoes-leads/${imp.id}`, { metodo: 'DELETE' }).catch(() => undefined);
    props.aoFechar();
  };

  let rodape: ReactNode = null;
  if (passo === 'colunas')
    rodape = (
      <>
        <Button variant="ghost" onClick={() => setPasso('arquivo')}>
          Trocar arquivo
        </Button>
        <Button variant="primary" disabled={!leads || previa.isFetching} onClick={() => setPasso('destino')}>
          {leads
            ? `Continuar com ${fmtNumero(leads)} leads`
            : previa.data?.leads
              ? 'Informe a cidade dos leads'
              : 'Nenhum lead ainda'}
        </Button>
      </>
    );
  else if (passo === 'destino')
    rodape = (
      <>
        <Button variant="ghost" onClick={() => setPasso('colunas')}>
          Voltar
        </Button>
        <Button
          variant="primary"
          icon="send"
          disabled={!destinoOk || importar.isPending}
          onClick={() => importar.mutate()}
        >
          {importar.isPending ? 'Importando…' : `Importar ${fmtNumero(leads)} leads`}
        </Button>
      </>
    );
  else if (passo === 'andamento')
    rodape = (
      <>
        <Button variant="ghost" onClick={props.aoFechar}>
          Fechar
        </Button>
        {terminou && andamento.data?.campanha && (
          <Button
            variant="primary"
            icon="users"
            onClick={() => {
              props.aoFechar();
              navegar(`/?campanhaId=${andamento.data?.campanha?.id}&situacao=todos`);
            }}
          >
            Ver os leads
          </Button>
        )}
      </>
    );

  return (
    <Modal
      titulo="Importar leads"
      subtitulo="Traga a lista que você já tem: o sistema organiza, junta repetidos e coloca nos seus leads."
      largura="larga"
      aoFechar={passo === 'andamento' ? props.aoFechar : desistir}
      rodape={rodape}
    >
      <div className="pilha" style={{ gap: 16 }}>
        <Passos atual={passo} />
        {passo === 'arquivo' && (
          <EscolherArquivo
            aoAnalisar={(i) => {
              setImp(i);
              setMapa((i.colunas ?? []).map((c) => c.campo));
              setCabecalho(i.cabecalho ?? null);
              setDestino((d) => ({ ...d, nome: d.nome || i.arquivo.replace(/\.[^.]+$/, '').slice(0, 120) }));
              setPasso('colunas');
            }}
          />
        )}
        {passo === 'colunas' && imp2 && (
          <Colunas
            imp={imp2}
            mapa={mapa}
            setMapa={setMapa}
            cabecalho={cabecalho}
            setCabecalho={setCabecalho}
            padrao={padrao}
            setPadrao={setPadrao}
            previa={previa.data}
            carregando={previa.isFetching}
            erro={previa.error}
          />
        )}
        {passo === 'destino' && (
          <>
            <EscolherDestino d={destino} setD={setDestino} leads={leads} />
            <ErroDaApi erro={importar.error} />
          </>
        )}
        {passo === 'andamento' && andamento.data && <Andamento imp={andamento.data} />}
        {passo === 'andamento' && !andamento.data && <div className="esqueleto" style={{ height: 80 }} />}
      </div>
    </Modal>
  );
}
