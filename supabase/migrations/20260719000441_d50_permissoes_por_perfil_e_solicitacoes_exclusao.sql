-- D50: permissões de análises passam a ser derivadas do perfil (role):
--   admin = edita e exclui tudo; editor = edita (exclusão só via solicitação
--   aprovada pelo admin); visualizador = só consulta.
-- Os campos pode_editar_analises/pode_excluir_analises deixam de ser usados.

-- gp_cadastros_tr -----------------------------------------------------------
DROP POLICY IF EXISTS gp_cadastros_tr_insert ON gp_cadastros_tr;
CREATE POLICY gp_cadastros_tr_insert ON gp_cadastros_tr FOR INSERT
WITH CHECK (
  criado_por = auth.uid()
  AND EXISTS (SELECT 1 FROM gp_profiles p WHERE p.id = auth.uid() AND p.ativo AND p.perfil IN ('admin','editor'))
);

DROP POLICY IF EXISTS gp_cadastros_tr_update ON gp_cadastros_tr;
CREATE POLICY gp_cadastros_tr_update ON gp_cadastros_tr FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo AND p.perfil IN ('admin','editor')
));

DROP POLICY IF EXISTS gp_cadastros_tr_delete ON gp_cadastros_tr;
CREATE POLICY gp_cadastros_tr_delete ON gp_cadastros_tr FOR DELETE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo AND p.perfil = 'admin'
));

-- gp_achados_tr -------------------------------------------------------------
DROP POLICY IF EXISTS gp_achados_tr_insert ON gp_achados_tr;
CREATE POLICY gp_achados_tr_insert ON gp_achados_tr FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo AND p.perfil IN ('admin','editor')
));

DROP POLICY IF EXISTS gp_achados_tr_update ON gp_achados_tr;
CREATE POLICY gp_achados_tr_update ON gp_achados_tr FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo AND p.perfil IN ('admin','editor')
));

DROP POLICY IF EXISTS gp_achados_tr_delete ON gp_achados_tr;
CREATE POLICY gp_achados_tr_delete ON gp_achados_tr FOR DELETE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo AND p.perfil IN ('admin','editor')
));

-- gp_achados_tr_historico ---------------------------------------------------
DROP POLICY IF EXISTS gp_achados_hist_insert ON gp_achados_tr_historico;
CREATE POLICY gp_achados_hist_insert ON gp_achados_tr_historico FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo AND p.perfil IN ('admin','editor')
));

-- Solicitações de exclusão (editor pede, admin decide) -----------------------
CREATE TABLE IF NOT EXISTS gp_solicitacoes_exclusao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cadastro_id uuid REFERENCES gp_cadastros_tr(id) ON DELETE SET NULL,
  descricao_cadastro text NOT NULL,
  solicitado_por uuid NOT NULL REFERENCES gp_profiles(id),
  motivo text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovada','recusada')),
  decidido_por uuid REFERENCES gp_profiles(id),
  decidido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gp_solicitacoes_exclusao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gp_solic_excl_select ON gp_solicitacoes_exclusao;
CREATE POLICY gp_solic_excl_select ON gp_solicitacoes_exclusao FOR SELECT
USING (EXISTS (SELECT 1 FROM gp_profiles p WHERE p.id = auth.uid() AND p.ativo));

DROP POLICY IF EXISTS gp_solic_excl_insert ON gp_solicitacoes_exclusao;
CREATE POLICY gp_solic_excl_insert ON gp_solicitacoes_exclusao FOR INSERT
WITH CHECK (
  solicitado_por = auth.uid()
  AND EXISTS (SELECT 1 FROM gp_profiles p WHERE p.id = auth.uid() AND p.ativo AND p.perfil IN ('admin','editor'))
);

DROP POLICY IF EXISTS gp_solic_excl_update ON gp_solicitacoes_exclusao;
CREATE POLICY gp_solic_excl_update ON gp_solicitacoes_exclusao FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo AND p.perfil = 'admin'
));
