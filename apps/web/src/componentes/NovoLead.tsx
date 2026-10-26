import { UFS } from '@prospeccao/shared/importacao';
import { Button } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ErroApi } from '../api';
import { Modal } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';
import { usePipelines } from './Pipelines';
import { useEquipe, useSessao } from './Sessao';

export interface InicialNovoLead {
  empresa?: string;
  contato?: string;
  telefone?: string;
  /** Conversa de "Não identificados" que vira este lead (as mensagens vêm junto). */
  telefoneConversa?: string;
  etapaId?: number;
  pipelineId?: number;
}

/**
 * Cadastrar um lead à mão: no quadro do funil (botão "Novo lead" ou o + da coluna) ou a partir de
 * uma conversa do WhatsApp de um número que não é lead.
 */
export function NovoLead(props: {
  inicial?: InicialNovoLead;
  aoFechar: () => void;
  aoCriar: (empresaId: number) => void;
}) {
  const ini = props.inicial ?? {};
  const cliente = useQueryClient();
  const sessao = useSessao();
  const admin = sessao.data?.papel === 'admin';
  const equipe = useEquipe();
  const pipelines = usePipelines();
  const pipeline = pipelines.data?.find((p) => p.id === ini.pipelineId) ?? pipelines.data?.[0];
  const [f, setF] = useState({
    empresa: ini.empresa ?? '',
    contato: ini.contato ?? '',
    cargo: '',
    telefone: ini.telefone ?? '',
    whatsapp: true,
    email: '',
    cidade: '',
    uf: '',
    cnpj: '',
    site: '',
    instagram: '',
    observacao: '',
    etapaId: ini.etapaId ? String(ini.etapaId) : '',
    // Administrador: o rodízio da equipe decide; vendedor: fica com quem cadastrou.
    responsavelId: '',
    agente: false,
    enriquecer: false,
  });
  const [mais, setMais] = useState(false);
  const responsavelPadrao = admin ? '' : String(sessao.data?.id ?? '');
  const criar = useMutation({
    mutationFn: () =>
      api<{ empresaId: number; jaExistia: boolean }>('/funil/leads', {
        metodo: 'POST',
        corpo: {
          empresa: f.empresa,
          contato: f.contato || null,
          cargo: f.cargo || null,
          telefone: f.telefone || null,
          whatsapp: f.whatsapp,
          email: f.email || null,
          cidade: f.cidade || null,
          uf: f.uf || null,
          cnpj: f.cnpj || null,
          site: f.site || null,
          instagram: f.instagram || null,
          observacao: f.observacao || null,
          etapaId: f.etapaId ? Number(f.etapaId) : null,
          responsavelId:
            f.responsavelId || responsavelPadrao ? Number(f.responsavelId || responsavelPadrao) : null,
          agente: f.agente,
          enriquecer: f.enriquecer,
          telefoneConversa: ini.telefoneConversa ?? null,
        },
      }),
    onSuccess: (r) => {
      for (const k of ['quadro', 'empresas', 'conversas', 'nao-identificados', 'campanhas', 'pipelines'])
        cliente.invalidateQueries({ queryKey: [k] });
      props.aoCriar(r.empresaId);
    },
  });
  const existente =
    criar.error instanceof ErroApi && criar.error.codigo === 'lead_existente'
      ? (criar.error.detalhes as unknown as { empresaId: number } | undefined)?.empresaId
      : undefined;
  const pessoas = equipe.data?.usuarios.filter((u) => u.ativo && !u.convitePendente) ?? [];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <Modal
      titulo={ini.telefoneConversa ? 'Criar lead desta conversa' : 'Novo lead'}
      subtitulo={
        ini.telefoneConversa
          ? 'As mensagens deste número vêm junto para a conversa do lead.'
          : 'Entra direto no funil. Só o nome é obrigatório.'
      }
      aoFechar={props.aoFechar}
      rodape={
        <>
          <Button variant="ghost" onClick={props.aoFechar}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            icon="plus"
            type="submit"
            form="form-novo-lead"
            disabled={criar.isPending || f.empresa.trim().length < 2}
          >
            {criar.isPending ? 'Cadastrando…' : 'Cadastrar lead'}
          </Button>
        </>
      }
    >
      <form
        id="form-novo-lead"
        className="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          criar.mutate();
        }}
      >
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="nl-empresa">Empresa (ou nome da pessoa)</label>
            <input
              id="nl-empresa"
              className="filtro"
              maxLength={160}
              value={f.empresa}
              onChange={set('empresa')}
              // biome-ignore lint/a11y/noAutofocus: o formulário abre por um clique em "Novo lead".
              autoFocus
            />
          </div>
          <div className="campo">
            <label htmlFor="nl-contato">Com quem fala</label>
            <input
              id="nl-contato"
              className="filtro"
              maxLength={120}
              value={f.contato}
              onChange={set('contato')}
            />
          </div>
        </div>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="nl-tel">Telefone</label>
            <input
              id="nl-tel"
              className="filtro"
              inputMode="tel"
              placeholder="(71) 99999-1234"
              value={f.telefone}
              onChange={set('telefone')}
            />
            <label className="opcao" style={{ marginTop: 4 }}>
              <input
                type="checkbox"
                checked={f.whatsapp}
                onChange={(e) => setF({ ...f, whatsapp: e.target.checked })}
              />
              <span>É WhatsApp</span>
            </label>
          </div>
          <div className="campo">
            <label htmlFor="nl-email">E-mail</label>
            <input id="nl-email" className="filtro" type="email" value={f.email} onChange={set('email')} />
          </div>
        </div>
        <div className="form__duas" style={{ gridTemplateColumns: '1fr 110px' }}>
          <div className="campo">
            <label htmlFor="nl-cidade">Cidade</label>
            <input
              id="nl-cidade"
              className="filtro"
              maxLength={80}
              value={f.cidade}
              onChange={set('cidade')}
            />
          </div>
          <div className="campo">
            <label htmlFor="nl-uf">UF</label>
            <select id="nl-uf" className="filtro" value={f.uf} onChange={set('uf')}>
              <option value="">Pelo DDD</option>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        {mais ? (
          <>
            <div className="form__duas">
              <div className="campo">
                <label htmlFor="nl-cargo">Cargo</label>
                <input
                  id="nl-cargo"
                  className="filtro"
                  maxLength={80}
                  value={f.cargo}
                  onChange={set('cargo')}
                />
              </div>
              <div className="campo">
                <label htmlFor="nl-cnpj">CNPJ</label>
                <input
                  id="nl-cnpj"
                  className="filtro"
                  inputMode="numeric"
                  value={f.cnpj}
                  onChange={set('cnpj')}
                />
                <span className="campo__dica">Com o CNPJ, a razão social e os sócios vêm da Receita.</span>
              </div>
            </div>
            <div className="form__duas">
              <div className="campo">
                <label htmlFor="nl-site">Site</label>
                <input
                  id="nl-site"
                  className="filtro"
                  placeholder="www.empresa.com.br"
                  value={f.site}
                  onChange={set('site')}
                />
              </div>
              <div className="campo">
                <label htmlFor="nl-insta">Instagram</label>
                <input
                  id="nl-insta"
                  className="filtro"
                  placeholder="@empresa"
                  value={f.instagram}
                  onChange={set('instagram')}
                />
              </div>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="link-botao"
            style={{ justifySelf: 'start' }}
            onClick={() => setMais(true)}
          >
            + Cargo, CNPJ, site e Instagram
          </button>
        )}
        <div className="campo">
          <label htmlFor="nl-obs">Observação</label>
          <textarea
            id="nl-obs"
            className="filtro"
            rows={2}
            maxLength={2000}
            placeholder="Ex.: indicado pelo João; quer cotação de entregas para 3 lojas"
            value={f.observacao}
            onChange={set('observacao')}
          />
        </div>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="nl-etapa">Entra em</label>
            <select id="nl-etapa" className="filtro" value={f.etapaId} onChange={set('etapaId')}>
              <option value="">{pipeline?.etapas[0]?.nome ?? 'A abordar'} (padrão)</option>
              {pipelines.data?.map((p) => (
                <optgroup key={p.id} label={p.nome}>
                  {p.etapas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="nl-resp">Quem cuida</label>
            <select
              id="nl-resp"
              className="filtro"
              value={f.responsavelId || responsavelPadrao}
              onChange={set('responsavelId')}
            >
              <option value="">Rodízio da equipe</option>
              {pessoas.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="opcao">
          <input
            type="checkbox"
            checked={f.agente}
            onChange={(e) => setF({ ...f, agente: e.target.checked })}
          />
          <span>
            A IA conduz a conversa com este lead
            <span className="campo__dica" style={{ display: 'block' }}>
              Ela aborda pelo WhatsApp (se ainda não houver conversa) e responde. Quando alguém da equipe
              responder, pela tela ou pelo celular, ela para sozinha.
            </span>
          </span>
        </label>
        <label className="opcao">
          <input
            type="checkbox"
            checked={f.enriquecer}
            onChange={(e) => setF({ ...f, enriquecer: e.target.checked })}
          />
          <span>
            Enriquecer
            <span className="campo__dica" style={{ display: 'block' }}>
              Busca site, Instagram, CNPJ e sócios e confere o WhatsApp. Conta no limite de leads do seu
              plano.
            </span>
          </span>
        </label>
        {existente ? (
          <Mensagem tipo="aviso">
            {(criar.error as Error).message}{' '}
            <button type="button" className="link-botao" onClick={() => props.aoCriar(existente)}>
              Abrir o lead
            </button>
          </Mensagem>
        ) : (
          <ErroDaApi erro={criar.error} />
        )}
      </form>
    </Modal>
  );
}
