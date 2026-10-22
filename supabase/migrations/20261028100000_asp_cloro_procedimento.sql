-- ============================================================================
-- ASP — Fase 7: unidade e limite de aviso do cloro livre por procedimento.
--
-- 1) gp_procedimentos.cloro_unidade ('mg/L' | 'PPM', padrão 'mg/L'): a
--    unidade escolhida aparece em todo lugar onde o valor do cloro é
--    mostrado ou escrito — card da coleta de fotos, frase do RDO (CVS 6) e
--    legendas/valores do Relatório de Execução.
-- 2) gp_procedimentos.cloro_limite_aviso (numeric > 0, padrão 5): acima dele
--    a coleta de fotos AVISA (não bloqueia) — valor alto demais costuma ser
--    erro de digitação.
-- Idempotente; nenhum dado existente é alterado (as linhas antigas recebem
-- os padrões). Hash e data de captura das fotos (gp_fotos_execucao.itens) e
-- os campos novos do RDO (gp_rdos.dados) vivem no jsonb — sem coluna nova.
-- ============================================================================

alter table public.gp_procedimentos add column if not exists cloro_unidade text not null default 'mg/L';
alter table public.gp_procedimentos add column if not exists cloro_limite_aviso numeric not null default 5;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_procedimentos_cloro_unidade') then
    alter table public.gp_procedimentos add constraint ck_gp_procedimentos_cloro_unidade
      check (cloro_unidade in ('mg/L', 'PPM'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_procedimentos_cloro_limite_aviso') then
    alter table public.gp_procedimentos add constraint ck_gp_procedimentos_cloro_limite_aviso
      check (cloro_limite_aviso > 0);
  end if;
end $$;

notify pgrst, 'reload schema';
