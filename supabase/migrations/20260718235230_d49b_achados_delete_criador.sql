-- D49b: criador do cadastro pode apagar os achados dele (necessário para
-- finalizar o próprio rascunho, que apaga e reinsere os achados).
DROP POLICY IF EXISTS gp_achados_tr_delete ON gp_achados_tr;
CREATE POLICY gp_achados_tr_delete ON gp_achados_tr FOR DELETE
USING (EXISTS (
  SELECT 1 FROM gp_cadastros_tr c
  JOIN gp_profiles p ON p.id = auth.uid()
  WHERE c.id = gp_achados_tr.cadastro_id AND p.ativo
    AND (p.perfil = 'admin' OR p.pode_excluir_analises OR p.pode_editar_analises OR c.criado_por = auth.uid())
));
