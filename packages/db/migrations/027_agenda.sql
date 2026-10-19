-- Agenda: reuniões com data e hora, tarefas, lembretes. Dono: api.

CREATE TABLE IF NOT EXISTS comercial.tarefas (
  id                      bigserial PRIMARY KEY,
  -- Lead da tarefa (opcional: "preparar proposta padrão" não tem lead).
  empresa_id              bigint REFERENCES comercial.oportunidades (empresa_id) ON DELETE CASCADE,
  usuario_id              integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  tipo                    text NOT NULL DEFAULT 'tarefa'
                          CHECK (tipo IN ('tarefa', 'ligacao', 'reuniao', 'visita')),
  titulo                  text NOT NULL,
  descricao               text,
  inicio                  timestamptz NOT NULL,
  fim                     timestamptz,
  -- Link do Meet/Zoom ou endereço da visita.
  local                   text,
  concluida_em            timestamptz,
  criado_por              integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  lembrete_lead_em        timestamptz,   -- quando o lembrete foi para o lead
  lembrete_usuario_em     timestamptz,   -- quando o aviso foi para o vendedor
  criado_em               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tarefas_agenda_idx ON comercial.tarefas (usuario_id, inicio)
  WHERE concluida_em IS NULL;
CREATE INDEX IF NOT EXISTS tarefas_empresa_idx ON comercial.tarefas (empresa_id, inicio);
CREATE INDEX IF NOT EXISTS tarefas_lembrete_idx ON comercial.tarefas (inicio)
  WHERE concluida_em IS NULL AND tipo IN ('reuniao', 'visita');

CREATE TABLE IF NOT EXISTS comercial.config_agenda (
  id                       boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Lembrete para o lead pelo WhatsApp, X minutos antes da reunião.
  lembrete_lead            boolean NOT NULL DEFAULT true,
  lembrete_lead_minutos    integer NOT NULL DEFAULT 120 CHECK (lembrete_lead_minutos BETWEEN 10 AND 2880),
  texto_lembrete_lead      text NOT NULL DEFAULT '{saudacao} Passando para confirmar nossa conversa {quando}. Até lá! {remetente}, da Tutts',
  -- Aviso para o vendedor (na tela e, se ele tiver WhatsApp cadastrado, no WhatsApp).
  lembrete_usuario_minutos integer NOT NULL DEFAULT 30 CHECK (lembrete_usuario_minutos BETWEEN 5 AND 1440),
  lembrete_usuario_whatsapp boolean NOT NULL DEFAULT false,
  duracao_reuniao_min      integer NOT NULL DEFAULT 30 CHECK (duracao_reuniao_min BETWEEN 5 AND 480)
);
INSERT INTO comercial.config_agenda (id) VALUES (true) ON CONFLICT DO NOTHING;
