-- D51: feedbacks (erros e sugestões de melhoria) enviados pelos usuários;
-- aparecem para o admin nas notificações até serem resolvidos.
CREATE TABLE IF NOT EXISTS gp_feedbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('erro','sugestao')),
  mensagem text NOT NULL,
  pagina text,
  criado_por uuid NOT NULL REFERENCES gp_profiles(id),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','resolvido')),
  resolvido_por uuid REFERENCES gp_profiles(id),
  resolvido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gp_feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gp_feedbacks_select ON gp_feedbacks;
CREATE POLICY gp_feedbacks_select ON gp_feedbacks FOR SELECT
USING (
  criado_por = auth.uid()
  OR EXISTS (SELECT 1 FROM gp_profiles p WHERE p.id = auth.uid() AND p.ativo AND p.perfil = 'admin')
);

DROP POLICY IF EXISTS gp_feedbacks_insert ON gp_feedbacks;
CREATE POLICY gp_feedbacks_insert ON gp_feedbacks FOR INSERT
WITH CHECK (
  criado_por = auth.uid()
  AND EXISTS (SELECT 1 FROM gp_profiles p WHERE p.id = auth.uid() AND p.ativo)
);

DROP POLICY IF EXISTS gp_feedbacks_update ON gp_feedbacks;
CREATE POLICY gp_feedbacks_update ON gp_feedbacks FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p WHERE p.id = auth.uid() AND p.ativo AND p.perfil = 'admin'
));
