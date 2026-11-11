-- Vídeos ligados ao resto do CRM (v131). Dono: api.
-- O vídeo ganha o texto do post do Reels (a redatora escreve; a pessoa copia ao postar) e, quando a
-- chamada do fim pede para comentar uma palavra, a regra do Comente e receba nasce com ele (alvo
-- 'video', esperando o post), como os carrosséis da v126. O CRM reconhece o Reels pelo texto (ou a
-- pessoa escolhe) e a regra passa a valer para aquela publicação. O Argos passa a ver os vídeos.

ALTER TABLE comercial.videos
  -- O texto que vai embaixo do Reels e as hashtags (sem o #).
  ADD COLUMN texto_post        text NOT NULL DEFAULT '',
  ADD COLUMN hashtags          text[] NOT NULL DEFAULT '{}',
  -- O texto ainda é o da redatora (a pessoa não mexeu): mostra o selo "escrito pela redatora".
  ADD COLUMN texto_da_redatora boolean NOT NULL DEFAULT false,
  -- O Reels no Instagram (depois de reconhecido) e quando o vídeo foi baixado pela última vez.
  ADD COLUMN midia_id          text,
  ADD COLUMN midia_link        text,
  ADD COLUMN publicado_em      timestamptz,
  ADD COLUMN baixado_em        timestamptz;

ALTER TABLE comercial.instagram_regras DROP CONSTRAINT IF EXISTS instagram_regras_alvo_check;
ALTER TABLE comercial.instagram_regras
  ADD CONSTRAINT instagram_regras_alvo_check
  CHECK (alvo IN ('publicacao', 'proxima', 'todas', 'carrossel', 'video'));

ALTER TABLE comercial.instagram_regras
  -- O vídeo de onde a regra nasceu (apagar o vídeo não apaga a regra que já está valendo).
  ADD COLUMN video_id integer REFERENCES comercial.videos (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX instagram_regras_video_idx ON comercial.instagram_regras (video_id)
  WHERE video_id IS NOT NULL;
CREATE INDEX instagram_regras_esperando_video_idx ON comercial.instagram_regras (conta_id)
  WHERE alvo = 'video';

-- O Argos: um vídeo por linha, com o resultado do Comente e receba. Só quem vê a conta inteira
-- (os vídeos são do administrador): o recorte por pessoa não enxerga nada aqui.
CREATE VIEW cerebro.videos WITH (security_barrier = true) AS
SELECT v.id AS video_id, v.conta_id AS unidade_id, v.titulo,
       CASE WHEN v.midia_id IS NOT NULL THEN 'publicado' ELSE v.situacao END AS situacao,
       v.opcoes->>'assunto' AS assunto,
       round(v.duracao_original)::int AS segundos_gravados,
       round(v.duracao_final)::int AS segundos_editado,
       nullif(v.opcoes->'chamada'->>'tipo', 'nenhuma') AS chamada,
       nullif(v.opcoes->'chamada'->>'palavra', '') AS palavra_da_chamada,
       left(v.texto_post, 500) AS texto_post,
       v.criado_em, v.pronto_em, v.publicado_em, v.midia_link AS link_no_instagram,
       u.nome AS criado_por,
       (SELECT count(*)::int FROM comercial.instagram_interacoes i WHERE i.regra_id = r.id) AS comentaram,
       (SELECT count(*)::int FROM comercial.instagram_interacoes i WHERE i.regra_id = r.id AND i.direct = 'enviado') AS receberam_direct,
       (SELECT count(*)::int FROM comercial.instagram_interacoes i WHERE i.regra_id = r.id AND i.abriu_em IS NOT NULL) AS abriram_link,
       (SELECT count(DISTINCT i.empresa_id)::int FROM comercial.instagram_interacoes i WHERE i.regra_id = r.id) AS viraram_lead
  FROM comercial.videos v
  LEFT JOIN cadastro.usuarios u ON u.id = v.criado_por
  LEFT JOIN comercial.instagram_regras r ON r.video_id = v.id AND r.conta_id = v.conta_id
 WHERE v.situacao <> 'enviando'
   AND ((SELECT tudo FROM cerebro_priv.escopo()) OR v.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND (SELECT cerebro_priv.dono()) IS NULL;
