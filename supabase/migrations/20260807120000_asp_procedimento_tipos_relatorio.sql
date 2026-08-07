-- ============================================================================
-- ASP — Tipos de relatório vinculados ao procedimento.
--
-- Cada procedimento pode ter o seu próprio modelo .docx e acrescentar tópicos
-- "genéricos" (título + texto + fotos) aos blocos especializados que já
-- existem. Assim dá para ter vários tipos de relatório sem um formulário novo
-- para cada um.
--
--   template_path   caminho do .docx no storage. NULL = modelo padrão da ASP.
--   topicos_extras  [{ "titulo": "Ensaio de estanqueidade" }, …]
--                   Entram antes da Conclusão, numerados na sequência.
-- ============================================================================
alter table public.gp_procedimentos add column if not exists template_path text;
alter table public.gp_procedimentos add column if not exists topicos_extras jsonb not null default '[]'::jsonb;

comment on column public.gp_procedimentos.template_path is
  'Modelo .docx próprio deste procedimento (storage). NULL usa /templates/relatorio-asp-v3.docx.';
comment on column public.gp_procedimentos.topicos_extras is
  'Tópicos genéricos (título + texto + fotos) acrescentados ao relatório deste procedimento.';

notify pgrst, 'reload schema';
