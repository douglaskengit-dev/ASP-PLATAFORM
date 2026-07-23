-- D49: "Pode editar/excluir análises salvas" passa a valer para QUALQUER
-- análise (modelo colaborativo), não só as criadas pelo próprio usuário.
-- Leitura de achados/histórico alinhada à dos cadastros (todo usuário ativo).

-- gp_cadastros_tr -----------------------------------------------------------
DROP POLICY IF EXISTS gp_cadastros_tr_update ON gp_cadastros_tr;
CREATE POLICY gp_cadastros_tr_update ON gp_cadastros_tr FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo
    AND (p.perfil = 'admin' OR p.pode_editar_analises OR gp_cadastros_tr.criado_por = auth.uid())
));

DROP POLICY IF EXISTS gp_cadastros_tr_delete ON gp_cadastros_tr;
CREATE POLICY gp_cadastros_tr_delete ON gp_cadastros_tr FOR DELETE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo
    AND (p.perfil = 'admin' OR p.pode_excluir_analises)
));

-- gp_achados_tr -------------------------------------------------------------
DROP POLICY IF EXISTS gp_achados_tr_select ON gp_achados_tr;
CREATE POLICY gp_achados_tr_select ON gp_achados_tr FOR SELECT
USING (EXISTS (
  SELECT 1 FROM gp_profiles p WHERE p.id = auth.uid() AND p.ativo
));

DROP POLICY IF EXISTS gp_achados_tr_insert ON gp_achados_tr;
CREATE POLICY gp_achados_tr_insert ON gp_achados_tr FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM gp_cadastros_tr c
  JOIN gp_profiles p ON p.id = auth.uid()
  WHERE c.id = gp_achados_tr.cadastro_id AND p.ativo
    AND (p.perfil = 'admin' OR p.pode_editar_analises OR c.criado_por = auth.uid())
));

DROP POLICY IF EXISTS gp_achados_tr_update ON gp_achados_tr;
CREATE POLICY gp_achados_tr_update ON gp_achados_tr FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo
    AND (p.perfil = 'admin' OR p.pode_editar_analises)
));

DROP POLICY IF EXISTS gp_achados_tr_delete ON gp_achados_tr;
CREATE POLICY gp_achados_tr_delete ON gp_achados_tr FOR DELETE
USING (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo
    AND (p.perfil = 'admin' OR p.pode_excluir_analises OR p.pode_editar_analises)
));

-- gp_achados_tr_historico ---------------------------------------------------
DROP POLICY IF EXISTS gp_achados_hist_select ON gp_achados_tr_historico;
CREATE POLICY gp_achados_hist_select ON gp_achados_tr_historico FOR SELECT
USING (EXISTS (
  SELECT 1 FROM gp_profiles p WHERE p.id = auth.uid() AND p.ativo
));

DROP POLICY IF EXISTS gp_achados_hist_insert ON gp_achados_tr_historico;
CREATE POLICY gp_achados_hist_insert ON gp_achados_tr_historico FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM gp_profiles p
  WHERE p.id = auth.uid() AND p.ativo
    AND (p.perfil = 'admin' OR p.pode_editar_analises)
));
