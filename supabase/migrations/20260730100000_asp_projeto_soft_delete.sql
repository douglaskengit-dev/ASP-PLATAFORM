-- ============================================================================
-- ASP — Exclusão em duas etapas do projeto (lixeira / soft delete).
-- Excluir marca excluido_em; o projeto some das listas mas fica recuperável
-- por 30 dias. Depois disso é apagado de vez (limpeza preguiçosa no GET).
-- ============================================================================
alter table public.gp_projetos add column if not exists excluido_em timestamptz;
alter table public.gp_projetos add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_projetos_excluido on public.gp_projetos (excluido_em);
