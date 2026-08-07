-- ============================================================================
-- ASP — Cada procedimento define o "formato" do seu relatório.
-- O modelo .docx é o mesmo; muda quais tópicos entram. Guardamos a lista de
-- números de tópicos visíveis (0 = capa, 1..10 = seções). NULL significa
-- "todos", preservando o comportamento dos procedimentos já cadastrados.
-- ============================================================================
alter table public.gp_procedimentos add column if not exists topicos jsonb;

comment on column public.gp_procedimentos.topicos is
  'Tópicos visíveis do relatório para este procedimento (ex.: [0,1,2,3,5,7,9,10]). NULL = todos.';

notify pgrst, 'reload schema';
