import {
  CORES_ETIQUETA,
  type ConfigAtendimento,
  type CorEtiqueta,
  type Etiqueta,
  type ResultadoImportacaoCarteira,
} from '@prospeccao/shared/carteira';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Etiqueta as Chip } from '../carteira/Atendimento';
import {
  COR_ETIQUETA,
  type ConfigCompleta,
  useConfigAtendimento,
  usePessoasAtendimento,
} from '../carteira/dados';
import { LinkAjuda } from '../componentes/Ajuda';
import { ForaDoPlano } from '../componentes/ForaDoPlano';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useRecurso } from '../componentes/Sessao';
import { fmtNome, fmtNumero } from '../formatar';

/**
 * Configurações › Atendimento: liga o atendimento com carteira (plano Escala) e define para onde vai
 * quem chama, a carteira, as etiquetas e o encerramento. Só o administrador muda.
 */
export function RegrasAtendimento() {
  const noPlano = useRecurso('carteira');
  const q = useConfigAtendimento();
  return (
    <div className="pilha" style={{ gap: 16 }}>
      <div className="topo">
        <div>
          <h1>Atendimento</h1>
          <p>
            Conversas com fila, carteira, protocolo e encerramento. Só o administrador muda estas regras.{' '}
            <LinkAjuda artigo="atendimento-carteira" />
          </p>
        </div>
      </div>
      {!noPlano ? (
        <ForaDoPlano recurso="carteira" />
      ) : q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : q.data ? (
        <Conteudo d={q.data} />
      ) : (
        <ErroDaApi erro={q.error} />
      )}
    </div>
  );
}

function Conteudo(props: { d: ConfigCompleta }) {
  const admin = useEhAdmin();
  const cliente = useQueryClient();
  const [f, setF] = useState<ConfigAtendimento>(props.d.config);
  const [motivos, setMotivos] = useState(props.d.config.motivos.join('\n'));
  const [salvo, setSalvo] = useState(false);
  useEffect(() => {
    setF(props.d.config);
    setMotivos(props.d.config.motivos.join('\n'));
  }, [props.d.config]);
  const salvar = useMutation({
    mutationFn: () =>
      api<ConfigAtendimento>('/carteira/config', {
        metodo: 'PUT',
        corpo: {
          ...f,
          motivos: motivos
            .split('\n')
            .map((m) => m.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: (config) => {
      cliente.setQueryData<ConfigCompleta>(['carteira', 'config'], (x) => (x ? { ...x, config } : x));
      // Ligar ou desligar muda as Conversas e a visão dos sem dono: a sessão relê.
      cliente.invalidateQueries({ queryKey: ['sessao'] });
      cliente.invalidateQueries({ queryKey: ['carteira'] });
      setSalvo(true);
    },
  });
  const ro = !admin;
  const set = <K extends keyof ConfigAtendimento>(k: K, v: ConfigAtendimento[K]) => {
    setSalvo(false);
    setF({ ...f, [k]: v });
  };
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };

  return (
    <>
      <form className="pilha" style={{ gap: 16 }} onSubmit={enviar}>
        <section className="tel-card regras-topo">
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.ativo}
              disabled={ro}
              onChange={(e) => set('ativo', e.target.checked)}
            />
            <span>
              <b>Atendimento ligado</b> <Badge tone="brand">Plano Escala</Badge>
              <span className="campo__dica">
                Ligado, as Conversas viram filas (Minha carteira, Fila geral, Aguardando, Encerrados) e cada
                contato do cliente abre um atendimento com protocolo.
              </span>
            </span>
          </label>
        </section>

        <div className="tel-grade">
          <section className="tel-card">
            <h2>Para onde vai quem chama</h2>
            <ol className="regras-passos">
              <li>
                <b>O cliente tem dono:</b> cai na fila <b>Minha carteira</b> do vendedor, com aviso no sino e
                no celular.
              </li>
              <li>
                <b>Não tem dono:</b> cai na <b>Fila geral</b>, que todos veem.
              </li>
            </ol>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.viraDono}
                disabled={ro}
                onChange={(e) => set('viraDono', e.target.checked)}
              />
              <span>
                <b>Quem atender da Fila geral vira o dono do cliente</b>
                <span className="campo__dica">
                  A carteira cresce sozinha. Dá para trocar o dono depois, na conversa.
                </span>
              </span>
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.esperaDonoMin != null}
                disabled={ro}
                onChange={(e) => set('esperaDonoMin', e.target.checked ? 10 : null)}
              />
              <span>
                <b>
                  Se o dono não responder, aparece também na Fila geral depois de{' '}
                  <input
                    type="number"
                    className="filtro regras-numero"
                    min={1}
                    max={240}
                    aria-label="Minutos esperando o dono"
                    disabled={ro || f.esperaDonoMin == null}
                    value={f.esperaDonoMin ?? 10}
                    onChange={(e) =>
                      set('esperaDonoMin', Math.min(240, Math.max(1, Number(e.target.value) || 1)))
                    }
                  />{' '}
                  minutos
                </b>
                <span className="campo__dica">
                  Com o selo “carteira de fulano, sem resposta”. O cliente continua na carteira dele.
                </span>
              </span>
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.pausaVaiGeral}
                disabled={ro}
                onChange={(e) => set('pausaVaiGeral', e.target.checked)}
              />
              <span>
                <b>Dono em pausa: vai direto para a Fila geral</b>
                <span className="campo__dica">
                  Cada pessoa marca Disponível ou Em pausa no menu, embaixo do nome.
                </span>
              </span>
            </label>
          </section>

          <section className="tel-card">
            <h2>Encerramento e mensagens</h2>
            <div className="campo">
              <label htmlFor="regras-motivos">Motivos de encerramento (um por linha)</label>
              <textarea
                id="regras-motivos"
                rows={6}
                disabled={ro}
                value={motivos}
                onChange={(e) => {
                  setSalvo(false);
                  setMotivos(e.target.value);
                }}
              />
            </div>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.mandarEncerramento}
                disabled={ro}
                onChange={(e) => set('mandarEncerramento', e.target.checked)}
              />
              <span>
                <b>Mandar a mensagem de encerramento</b> (quem encerra pode desmarcar na hora)
              </span>
            </label>
            {f.mandarEncerramento && (
              <div className="campo">
                <label htmlFor="regras-msg">Mensagem de encerramento</label>
                <textarea
                  id="regras-msg"
                  rows={3}
                  maxLength={500}
                  disabled={ro}
                  value={f.msgEncerramento}
                  onChange={(e) => set('msgEncerramento', e.target.value)}
                />
                <span className="campo__dica">
                  <code>{'{nome}'}</code> vira o primeiro nome do contato e <code>{'{protocolo}'}</code>, o
                  número do atendimento.
                </span>
              </div>
            )}
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.pesquisa}
                disabled={ro}
                onChange={(e) => set('pesquisa', e.target.checked)}
              />
              <span>
                <b>Pedir a nota de 1 a 5 ao encerrar</b> (vai na mesma mensagem, para não mandar duas)
              </span>
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.encerrarSemRespostaH != null}
                disabled={ro}
                onChange={(e) => set('encerrarSemRespostaH', e.target.checked ? 24 : null)}
              />
              <span>
                <b>
                  Encerrar sozinho quando o cliente não responder em{' '}
                  <input
                    type="number"
                    className="filtro regras-numero"
                    min={1}
                    max={720}
                    aria-label="Horas sem resposta do cliente"
                    disabled={ro || f.encerrarSemRespostaH == null}
                    value={f.encerrarSemRespostaH ?? 24}
                    onChange={(e) =>
                      set('encerrarSemRespostaH', Math.min(720, Math.max(1, Number(e.target.value) || 1)))
                    }
                  />{' '}
                  horas
                </b>
                <span className="campo__dica">
                  Com o motivo “Cliente não respondeu”, sem mandar mensagem.
                </span>
              </span>
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.protocoloNaPrimeira}
                disabled={ro}
                onChange={(e) => set('protocoloNaPrimeira', e.target.checked)}
              />
              <span>
                <b>Mandar o protocolo na primeira resposta</b> de cada atendimento (vai no fim da mensagem)
              </span>
            </label>
          </section>
        </div>

        {admin && (
          <div className="regras-salvar">
            <ErroDaApi erro={salvar.error} />
            {salvo && <Mensagem tipo="ok">Regras salvas.</Mensagem>}
            <Button type="submit" variant="primary" icon="check" disabled={salvar.isPending}>
              {salvar.isPending ? 'Salvando…' : 'Salvar as regras'}
            </Button>
          </div>
        )}
      </form>
      <div className="tel-grade">
        <Carteira d={props.d} />
        <Etiquetas etiquetas={props.d.etiquetas} />
      </div>
    </>
  );
}

/* ───────────────────────────── Carteira ───────────────────────────── */

const MODELO_CSV =
  'cnpj ou telefone;e-mail do vendedor;nome do cliente\n12.345.678/0001-90;vendedor@empresa.com.br;Oficina do Joel\n(71) 99812-4410;vendedor@empresa.com.br;Mecânica Bom Jesus\n';

function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(arquivo);
  });
}

function Carteira(props: { d: ConfigCompleta }) {
  const admin = useEhAdmin();
  const cliente = useQueryClient();
  const pessoas = usePessoasAtendimento(admin);
  const [de, setDe] = useState<number | null>(null);
  const [para, setPara] = useState<number | null>(null);
  const [etiqueta, setEtiqueta] = useState('');
  const [resultado, setResultado] = useState<ResultadoImportacaoCarteira | null>(null);
  const [passados, setPassados] = useState<number | null>(null);
  const importar = useMutation({
    mutationFn: async (arquivo: File) => {
      const excel = /\.xlsx?$/i.test(arquivo.name) || arquivo.type.includes('spreadsheetml');
      const corpo = excel ? { xlsx: await lerBase64(arquivo) } : { csv: await arquivo.text() };
      return api<ResultadoImportacaoCarteira>('/carteira/importar', { metodo: 'POST', corpo });
    },
    onSuccess: (r) => {
      setResultado(r);
      cliente.invalidateQueries({ queryKey: ['carteira'] });
    },
  });
  const passar = useMutation({
    mutationFn: () =>
      api<{ passados: number }>('/carteira/passar', {
        metodo: 'POST',
        corpo: { de, para, etiqueta: etiqueta || undefined },
      }),
    onSuccess: (r) => {
      setPassados(r.passados);
      cliente.invalidateQueries({ queryKey: ['carteira'] });
    },
  });
  const escolher = (e: ChangeEvent<HTMLInputElement>) => {
    const arq = e.target.files?.[0];
    e.target.value = '';
    if (arq) {
      setResultado(null);
      importar.mutate(arq);
    }
  };
  const lista = pessoas.data?.pessoas ?? [];
  const c = props.d.carteira;
  return (
    <section className="tel-card">
      <h2>Carteira</h2>
      <div className="regras-numeros">
        <span>
          <b>{fmtNumero(c.comDono)}</b> clientes com dono
        </span>
        <span>
          <b>{fmtNumero(c.semDono)}</b> sem dono
        </span>
        <span>
          <b>{fmtNumero(c.vendedores)}</b> {c.vendedores === 1 ? 'vendedor' : 'vendedores'}
        </span>
      </div>
      {admin && (
        <>
          <div className="regras-bloco">
            <b>Importar a carteira por planilha</b>
            <span className="campo__dica">
              Uma linha por cliente: CNPJ ou telefone e o e-mail do vendedor (o nome é opcional). Cliente que
              ainda não está no CRM é criado; o que já está só ganha o dono. Excel (.xlsx) ou CSV.
            </span>
            <div className="acoes">
              <label className="pp-btn pp-btn--secondary pp-btn--sm regras-arquivo">
                <Icon name="upload" size={14} /> {importar.isPending ? 'Importando…' : 'Escolher planilha'}
                <input
                  type="file"
                  accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={importar.isPending}
                  onChange={escolher}
                />
              </label>
              <Button
                size="sm"
                variant="ghost"
                icon="download"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${MODELO_CSV}`)}`}
                download="modelo-carteira.csv"
              >
                Baixar o modelo
              </Button>
            </div>
            <ErroDaApi erro={importar.error} />
            {resultado && (
              <Mensagem
                tipo={resultado.semVendedor.length || resultado.naoEncontrados.length ? 'aviso' : 'ok'}
              >
                {fmtNumero(resultado.linhas)} linhas: {fmtNumero(resultado.atribuidos)} clientes ganharam dono
                e {fmtNumero(resultado.criados)} foram criados.
                {!!resultado.semVendedor.length && (
                  <> E-mail que não é da equipe: {resultado.semVendedor.slice(0, 5).join(', ')}.</>
                )}
                {!!resultado.naoEncontrados.length && (
                  <> Sem CNPJ ou telefone válido: {resultado.naoEncontrados.slice(0, 5).join(', ')}.</>
                )}
              </Mensagem>
            )}
          </div>
          <div className="regras-bloco">
            <b>Passar a carteira de uma pessoa para outra</b>
            <span className="campo__dica">
              Para férias ou saída: todos os clientes, ou só os de uma etiqueta.
            </span>
            <div className="regras-passar">
              <label className="pp-sr" htmlFor="passar-de">
                De
              </label>
              <select
                id="passar-de"
                className="filtro"
                value={de ?? ''}
                onChange={(e) => {
                  setPassados(null);
                  setDe(Number(e.target.value) || null);
                }}
              >
                <option value="">De quem…</option>
                {lista.map((p) => (
                  <option key={p.id} value={p.id}>
                    {fmtNome(p.nome)}
                  </option>
                ))}
              </select>
              <span className="quieto">para</span>
              <label className="pp-sr" htmlFor="passar-para">
                Para
              </label>
              <select
                id="passar-para"
                className="filtro"
                value={para ?? ''}
                onChange={(e) => {
                  setPassados(null);
                  setPara(Number(e.target.value) || null);
                }}
              >
                <option value="">Para quem…</option>
                {lista
                  .filter((p) => p.id !== de)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {fmtNome(p.nome)}
                    </option>
                  ))}
              </select>
              <label className="pp-sr" htmlFor="passar-etiqueta">
                Só com a etiqueta
              </label>
              <select
                id="passar-etiqueta"
                className="filtro"
                value={etiqueta}
                onChange={(e) => setEtiqueta(e.target.value)}
              >
                <option value="">Todos os clientes</option>
                {props.d.etiquetas.map((e) => (
                  <option key={e.id} value={e.nome}>
                    Só os com “{e.nome}”
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                icon="arrow-right-left"
                disabled={!de || !para || passar.isPending}
                onClick={() => passar.mutate()}
              >
                {passar.isPending ? 'Passando…' : 'Passar os clientes'}
              </Button>
            </div>
            <ErroDaApi erro={passar.error} />
            {passados != null && (
              <Mensagem tipo="ok">
                {passados === 1 ? '1 cliente passou' : `${fmtNumero(passados)} clientes passaram`} de
                carteira.
              </Mensagem>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ───────────────────────────── Etiquetas ───────────────────────────── */

const ROTULO_COR: Record<CorEtiqueta, string> = {
  cinza: 'Cinza',
  azul: 'Azul',
  verde: 'Verde',
  laranja: 'Laranja',
  vermelho: 'Vermelho',
  roxo: 'Roxo',
};

function Etiquetas(props: { etiquetas: Etiqueta[] }) {
  const admin = useEhAdmin();
  const cliente = useQueryClient();
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState<CorEtiqueta>('azul');
  const [editando, setEditando] = useState<{ id: number; nome: string; cor: CorEtiqueta } | null>(null);
  const aplicar = (lista: Etiqueta[]) =>
    cliente.setQueryData<ConfigCompleta>(['carteira', 'config'], (x) => (x ? { ...x, etiquetas: lista } : x));
  const criar = useMutation({
    mutationFn: () => api<Etiqueta[]>('/carteira/etiquetas', { metodo: 'POST', corpo: { nome, cor } }),
    onSuccess: (l) => {
      aplicar(l);
      setNome('');
    },
  });
  const salvar = useMutation({
    mutationFn: (e: { id: number; nome: string; cor: CorEtiqueta }) =>
      api<Etiqueta[]>(`/carteira/etiquetas/${e.id}`, { metodo: 'PUT', corpo: { nome: e.nome, cor: e.cor } }),
    onSuccess: (l) => {
      aplicar(l);
      setEditando(null);
      cliente.invalidateQueries({ queryKey: ['carteira', 'atendimentos'] });
    },
  });
  const apagar = useMutation({
    mutationFn: (id: number) => api<Etiqueta[]>(`/carteira/etiquetas/${id}`, { metodo: 'DELETE' }),
    onSuccess: aplicar,
  });
  return (
    <section className="tel-card">
      <h2>Etiquetas</h2>
      <p className="quieto">
        Valem no atendimento e no cliente. Filtram as filas e aparecem no painel do atendimento.
      </p>
      {props.etiquetas.length ? (
        <ul className="regras-etiquetas">
          {props.etiquetas.map((e) =>
            editando?.id === e.id ? (
              <li key={e.id} className="regras-etiquetas__editar">
                <label className="pp-sr" htmlFor={`etq-nome-${e.id}`}>
                  Nome
                </label>
                <input
                  id={`etq-nome-${e.id}`}
                  className="filtro"
                  maxLength={30}
                  value={editando.nome}
                  onChange={(x) => setEditando({ ...editando, nome: x.target.value })}
                />
                <SeletorCor
                  id={`etq-cor-${e.id}`}
                  cor={editando.cor}
                  aoMudar={(c) => setEditando({ ...editando, cor: c })}
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!editando.nome.trim() || salvar.isPending}
                  onClick={() => salvar.mutate(editando)}
                >
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>
                  Cancelar
                </Button>
              </li>
            ) : (
              <li key={e.id}>
                <Chip nome={e.nome} catalogo={props.etiquetas} />
                <span className="quieto">
                  {fmtNumero(e.usosMes ?? 0)} no atendimento este mês · {fmtNumero(e.clientes ?? 0)}{' '}
                  {e.clientes === 1 ? 'cliente' : 'clientes'}
                </span>
                {admin && (
                  <span className="regras-etiquetas__acoes">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="pencil"
                      aria-label={`Editar ${e.nome}`}
                      onClick={() => setEditando({ id: e.id, nome: e.nome, cor: e.cor })}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="trash-2"
                      aria-label={`Apagar ${e.nome}`}
                      disabled={apagar.isPending}
                      onClick={() => apagar.mutate(e.id)}
                    />
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="quieto">Nenhuma etiqueta ainda. Ex.: Pedido, Orçamento, Troca, Urgente.</p>
      )}
      {admin && (
        <div className="regras-etiquetas__nova">
          <label className="pp-sr" htmlFor="etq-nova">
            Nova etiqueta
          </label>
          <input
            id="etq-nova"
            className="filtro"
            maxLength={30}
            placeholder="Nova etiqueta"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (nome.trim()) criar.mutate();
              }
            }}
          />
          <SeletorCor id="etq-nova-cor" cor={cor} aoMudar={setCor} />
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            disabled={!nome.trim() || criar.isPending}
            onClick={() => criar.mutate()}
          >
            Criar
          </Button>
        </div>
      )}
      <ErroDaApi erro={criar.error ?? salvar.error ?? apagar.error} />
    </section>
  );
}

function SeletorCor(props: { id: string; cor: CorEtiqueta; aoMudar: (c: CorEtiqueta) => void }) {
  return (
    <>
      <label className="pp-sr" htmlFor={props.id}>
        Cor
      </label>
      <select
        id={props.id}
        className="filtro"
        value={props.cor}
        style={{ background: COR_ETIQUETA[props.cor].fundo, color: COR_ETIQUETA[props.cor].texto }}
        onChange={(e) => props.aoMudar(e.target.value as CorEtiqueta)}
      >
        {CORES_ETIQUETA.map((c) => (
          <option key={c} value={c}>
            {ROTULO_COR[c]}
          </option>
        ))}
      </select>
    </>
  );
}
