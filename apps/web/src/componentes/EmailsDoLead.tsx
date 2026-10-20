import { Badge, Panel } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type ClasseResposta, ROTULO_CLASSE } from '../api';
import { fmtHora } from '../formatar';

interface EmailsLead {
  envios: {
    id: number;
    email: string;
    passo: number;
    status: string;
    assunto: string | null;
    enviadoEm: string | null;
    abertoEm: string | null;
    aberturas: number;
    clicadoEm: string | null;
    respondidoEm: string | null;
    campanhaNome: string;
  }[];
  respostas: {
    id: number;
    deEmail: string;
    assunto: string | null;
    texto: string;
    recebidoEm: string;
    classe: ClasseResposta;
    resumo: string | null;
  }[];
}

/** E-mails de prospecção que o lead recebeu e o que ele respondeu (some se não houver nenhum). */
export function EmailsDoLead(props: { empresaId: number }) {
  const q = useQuery({
    queryKey: ['email', 'lead', props.empresaId],
    queryFn: () => api<EmailsLead>(`/email/lead/${props.empresaId}`),
  });
  const d = q.data;
  if (!d || (!d.envios.length && !d.respostas.length)) return null;
  return (
    <Panel titulo="E-mails" contagem={d.envios.length + d.respostas.length}>
      <ul className="lista-simples emails-lead">
        {d.respostas.map((r) => (
          <li key={`r${r.id}`}>
            <span>
              <Badge tone={r.classe === 'interessado' ? 'brand' : 'neutral'}>{ROTULO_CLASSE[r.classe]}</Badge>{' '}
              respondeu {fmtHora(r.recebidoEm)}
            </span>
            <p className="emails-lead__texto">{r.resumo ?? r.texto.slice(0, 300)}</p>
            <Link to={`/email?aba=respostas&resposta=${r.id}`} className="link-botao">
              Ver e responder
            </Link>
          </li>
        ))}
        {d.envios.map((e) => (
          <li key={`e${e.id}`}>
            <span>
              <b>{e.passo}º e-mail</b> · {e.campanhaNome} · <span className="mono">{e.email}</span>
            </span>
            <span className="quieto">
              {e.status === 'na_fila'
                ? 'na fila para enviar'
                : e.status === 'enviado'
                  ? `enviado ${fmtHora(e.enviadoEm)}${e.abertoEm ? ` · abriu ${fmtHora(e.abertoEm)}` : ' · não abriu'}${e.clicadoEm ? ' · clicou' : ''}${e.respondidoEm ? ' · respondeu' : ''}`
                  : e.status === 'devolvido'
                    ? 'voltou: o endereço não existe'
                    : 'não enviado'}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
