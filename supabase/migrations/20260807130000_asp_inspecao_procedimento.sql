-- ============================================================================
-- ASP — Procedimento da inspeção.
--
-- Guarda o CÓDIGO do procedimento do Catálogo (ex.: "PR-BAT-001"). Definido ao
-- criar a inspeção, ele determina o formato do relatório (tópicos, seções
-- próprias e modelo .docx) e já vem preenchido no "Gerar Relatório".
--
-- Guardamos o código, e não o id, porque é assim que o relatório referencia o
-- procedimento hoje — e o código é o que aparece no documento.
-- ============================================================================
alter table public.gp_inspecoes add column if not exists procedimento text;

comment on column public.gp_inspecoes.procedimento is
  'Código do procedimento do Catálogo (gp_procedimentos.codigo) usado nesta inspeção.';

notify pgrst, 'reload schema';
