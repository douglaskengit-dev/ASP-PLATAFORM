-- ============================================================================
-- ASP — Lixeira (soft delete) também para as coletas/medições.
-- Mesma lógica de projeto/inspeção/cliente: excluir marca excluido_em; a
-- medição some da lista mas fica recuperável por 30 dias, e depois é apagada
-- de vez (limpeza preguiçosa no GET da inspeção).
-- ============================================================================
alter table public.gp_coletas add column if not exists excluido_em timestamptz;
alter table public.gp_coletas add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_coletas_excluido on public.gp_coletas (excluido_em);
