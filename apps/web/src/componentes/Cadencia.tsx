import { Badge, Button } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api, type ConfigCadencia, type DetalheFunil, type MensagemPronta, MODELOS_MENSAGEM } from '../api';
import { fmtNome, formatarTelefone } from '../formatar';
import { Drawer } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';

/** Link do WhatsApp com a mensagem já escrita. */
export function linkWhatsapp(telefone: string, texto: string): string {
  const digitos = telefone.replace(/\D/g, '');
  const numero = digitos.length >= 12 && digitos.startsWith('55') ? digitos : `55${digitos}`;
  return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

/** Atualiza tudo que mostra o lead depois de um envio. */
function useAtualizarFunil(empresaId: number) {
  const cliente = useQueryClient();
  return (d?: DetalheFunil) => {
    if (d) cliente.setQueryData(['funil', empresaId], d);
    cliente.invalidateQueries({ queryKey: ['funil', empresaId] });
    cliente.invalidateQueries({ queryKey: ['quadro'] });
    cliente.invalidateQueries({ queryKey: ['empresas'] });
  };
}

/**
 * A próxima mensagem da cadência, pronta para mandar: abre no WhatsApp com o texto e, depois,
 * registra o envio com um clique (o lead avança e o próximo follow-up é marcado sozinho).
 */
export function ProximaMensagem(props: { empresaId: number; aoRegistrar?: () => void }) {
  const { empresaId } = props;
  const atualizar = useAtualizarFunil(empresaId);
  const q = useQuery({
    queryKey: ['funil', empresaId, 'mensagem'],
    queryFn: () => api<MensagemPronta>(`/funil/${empresaId}/mensagem`),
  });
  const [texto, setTexto] = useState('');
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    setTexto(q.data?.texto ?? '');
    setAberta(false);
  }, [q.data?.texto]);

  const registrar = useMutation({
    mutationFn: () =>
      api<DetalheFunil>(`/funil/${empresaId}/atividades`, {
        metodo: 'POST',
        corpo: { tipo: 'whatsapp', direcao: 'enviada', texto, contato: q.data?.telefone ?? null },
      }),
    onSuccess: (d) => {
      atualizar(d);
      setAberta(false);
      props.aoRegistrar?.();
    },
  });

  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const m = q.data;
  if (!m.modelo) return null;

  return (
    <div className="pilha" style={{ gap: 12 }}>
      <div className="mensagem-topo">
        <b>{m.rotulo}</b>
        {m.tentativa > 0 && (
          <Badge tone={m.tentativa >= m.totalTentativas ? 'warning' : 'neutral'}>
            Mensagem {m.tentativa} de {m.totalTentativas}
          </Badge>
        )}
      </div>
      <div className="campo">
        <label htmlFor={`msg-${empresaId}`}>Mensagem (pode ajustar antes de mandar)</label>
        <textarea id={`msg-${empresaId}`} rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      {!m.telefone ? (
        <Mensagem tipo="aviso">Este lead não tem telefone. Registre o contato pelo canal que usar.</Mensagem>
      ) : aberta ? (
        <div className="confirmar">
          <span>Mandou a mensagem para {formatarTelefone(m.telefone)}?</span>
          <div className="acoes">
            <Button
              size="sm"
              variant="primary"
              icon="check"
              disabled={registrar.isPending || !texto.trim()}
              onClick={() => registrar.mutate()}
            >
              {registrar.isPending ? 'Registrando…' : 'Sim, registrar envio'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAberta(false)}>
              Não mandei
            </Button>
          </div>
        </div>
      ) : (
        <div className="acoes">
          <Button
            variant="primary"
            icon="message-circle"
            href={linkWhatsapp(m.telefone, texto)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setAberta(true)}
          >
            Abrir no WhatsApp
          </Button>
          <span className="quieto mono" style={{ fontSize: 13 }}>
            {formatarTelefone(m.telefone)}
          </span>
        </div>
      )}
      <ErroDaApi erro={registrar.error} />
    </div>
  );
}

/** Painel rápido aberto pelo botão do card no quadro. */
export function EnvioRapido(props: { empresaId: number; nome: string; aoFechar: () => void }) {
  return (
    <Drawer
      titulo={`WhatsApp para ${fmtNome(props.nome)}`}
      barra={`WhatsApp · ${fmtNome(props.nome)}`}
      aoFechar={props.aoFechar}
    >
      <div className="drawer__corpo">
        <ProximaMensagem empresaId={props.empresaId} aoRegistrar={props.aoFechar} />
      </div>
    </Drawer>
  );
}

const lerDias = (s: string) =>
  s
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => n >= 1 && n <= 60);

/** Resumo em texto da cadência: "1ª mensagem → 2 dias → 2ª → …". */
export function resumoCadencia(
  c: Pick<ConfigCadencia, 'diasFollowup' | 'diasEncerrar' | 'encerrarSemResposta'>,
) {
  const passos = ['1ª mensagem'];
  c.diasFollowup.forEach((d, i) => {
    passos.push(`espera ${d} ${d === 1 ? 'dia útil' : 'dias úteis'}`, `${i + 2}ª mensagem`);
  });
  passos.push(
    c.encerrarSemResposta
      ? `sem resposta em ${c.diasEncerrar} ${c.diasEncerrar === 1 ? 'dia' : 'dias'}: vai para Perdido`
      : 'sem resposta: fica em Abordado para você decidir',
  );
  return passos.join(' → ');
}

/** Configuração da cadência e dos modelos de mensagem. */
export function ConfigurarCadencia(props: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['cadencia'], queryFn: () => api<ConfigCadencia>('/funil/cadencia') });
  const [f, setF] = useState<{
    diasFollowup: string;
    diasEncerrar: string;
    encerrarSemResposta: boolean;
    diasCobrarProposta: string;
    remetente: string;
    modelos: ConfigCadencia['modelos'];
  } | null>(null);
  useEffect(() => {
    if (q.data && !f)
      setF({
        diasFollowup: q.data.diasFollowup.join(', '),
        diasEncerrar: String(q.data.diasEncerrar),
        encerrarSemResposta: q.data.encerrarSemResposta,
        diasCobrarProposta: q.data.diasCobrarProposta.join(', '),
        remetente: q.data.remetente,
        modelos: q.data.modelos,
      });
  }, [q.data, f]);

  const salvar = useMutation({
    mutationFn: () =>
      api<ConfigCadencia>('/funil/cadencia', {
        metodo: 'PUT',
        corpo: {
          diasFollowup: lerDias(f?.diasFollowup ?? ''),
          diasEncerrar: Number(f?.diasEncerrar) || 0,
          encerrarSemResposta: f?.encerrarSemResposta ?? true,
          diasCobrarProposta: lerDias(f?.diasCobrarProposta ?? ''),
          remetente: f?.remetente ?? '',
          modelos: f?.modelos,
        },
      }),
    onSuccess: (d) => {
      cliente.setQueryData(['cadencia'], d);
      cliente.invalidateQueries({ queryKey: ['quadro'] });
      cliente.invalidateQueries({ queryKey: ['funil'] });
      props.aoFechar();
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };
  const mudar = (campo: string, valor: unknown) => setF((v) => (v ? { ...v, [campo]: valor } : v));

  return (
    <Drawer titulo="Cadência de follow-up" barra="Funil" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {q.error && <ErroDaApi erro={q.error} />}
        {!f ? (
          <div className="esqueleto" />
        ) : (
          <form className="form" onSubmit={enviar}>
            <Mensagem tipo="ok">
              <b>Como fica:</b>{' '}
              {resumoCadencia({
                diasFollowup: lerDias(f.diasFollowup),
                diasEncerrar: Number(f.diasEncerrar) || 0,
                encerrarSemResposta: f.encerrarSemResposta,
              })}
              . Se ele responder em qualquer momento, a cadência para e o lead vai para Respondeu.
            </Mensagem>

            <div className="campo">
              <label htmlFor="cad-dias">Dias de espera entre as mensagens</label>
              <input
                id="cad-dias"
                className="filtro"
                inputMode="numeric"
                value={f.diasFollowup}
                onChange={(e) => mudar('diasFollowup', e.target.value)}
              />
              <span className="campo__dica">
                Um número por follow-up, separados por vírgula. "2, 3, 5" = 3 follow-ups depois da 1ª
                mensagem. Fim de semana não conta.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="cad-encerrar">Depois da última mensagem, esperar quantos dias</label>
              <input
                id="cad-encerrar"
                className="filtro"
                inputMode="numeric"
                value={f.diasEncerrar}
                onChange={(e) => mudar('diasEncerrar', e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.encerrarSemResposta}
                onChange={(e) => mudar('encerrarSemResposta', e.target.checked)}
              />
              Mover sozinho para "Perdido: sem resposta" quando esse prazo passar
            </label>
            <div className="campo">
              <label htmlFor="cad-proposta">Cobrar a proposta depois de quantos dias</label>
              <input
                id="cad-proposta"
                className="filtro"
                inputMode="numeric"
                value={f.diasCobrarProposta}
                onChange={(e) => mudar('diasCobrarProposta', e.target.value)}
              />
              <span className="campo__dica">
                "3, 7" = cobra 3 dias depois de mandar e de novo 7 dias depois.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="cad-remetente">Seu nome nas mensagens</label>
              <input
                id="cad-remetente"
                className="filtro"
                placeholder="Ex.: Leonardo"
                value={f.remetente}
                onChange={(e) => mudar('remetente', e.target.value)}
              />
            </div>

            <h3 className="subtitulo">Mensagens</h3>
            <span className="campo__dica" style={{ marginTop: -8 }}>
              Use {'{saudacao}'} ("Olá, Maria!"), {'{nome}'}, {'{empresa}'}, {'{cidade}'} e {'{remetente}'}.
            </span>
            {MODELOS_MENSAGEM.map((m) => (
              <div className="campo" key={m.id}>
                <label htmlFor={`cad-${m.id}`}>
                  {m.rotulo} <span className="quieto">· {m.quando}</span>
                </label>
                <textarea
                  id={`cad-${m.id}`}
                  rows={4}
                  value={f.modelos[m.id]}
                  onChange={(e) => mudar('modelos', { ...f.modelos, [m.id]: e.target.value })}
                />
              </div>
            ))}

            <ErroDaApi erro={salvar.error} />
            <div className="acoes">
              <Button type="submit" variant="primary" disabled={salvar.isPending}>
                {salvar.isPending ? 'Salvando…' : 'Salvar cadência'}
              </Button>
              <Button variant="ghost" onClick={props.aoFechar}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </div>
    </Drawer>
  );
}
