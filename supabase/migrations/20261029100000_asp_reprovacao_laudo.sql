-- ============================================================================
-- ASP — Fase 9: categoria de reprovação "Laudo/Laboratório" ('laudo').
--
-- Os checks da categoria (gp_relatorios e gp_fase_historico, criados na
-- migração das Fases 5/9) passam a aceitar 'laudo'. Ela só é oferecida — e
-- aceita pela API — ao reprovar o relatório de EXECUÇÃO (fase 9); o banco
-- aceita o valor nas duas tabelas e a regra por tipo fica na API.
-- Idempotente: derruba e recria os dois checks com a lista nova (só amplia a
-- lista — nenhuma linha existente passa a violar). Nenhum dado é alterado.
-- ============================================================================

do $$
begin
  alter table public.gp_relatorios drop constraint if exists ck_gp_relatorios_motivo_categoria;
  alter table public.gp_relatorios add constraint ck_gp_relatorios_motivo_categoria
    check (motivo_categoria is null or motivo_categoria in ('dados_incorretos', 'fotos', 'texto', 'medicao', 'laudo', 'formatacao', 'outro'));

  alter table public.gp_fase_historico drop constraint if exists ck_gp_fase_historico_motivo_categoria;
  alter table public.gp_fase_historico add constraint ck_gp_fase_historico_motivo_categoria
    check (motivo_categoria is null or motivo_categoria in ('dados_incorretos', 'fotos', 'texto', 'medicao', 'laudo', 'formatacao', 'outro'));
end $$;
