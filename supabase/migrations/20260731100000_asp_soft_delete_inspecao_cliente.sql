-- ============================================================================
-- ASP — Lixeira (soft delete) também para inspeções e clientes (gp_orgaos).
-- Mesma lógica do projeto: excluir marca excluido_em; recuperável por 30 dias.
-- ============================================================================
alter table public.gp_inspecoes add column if not exists excluido_em timestamptz;
alter table public.gp_inspecoes add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_inspecoes_excluido on public.gp_inspecoes (excluido_em);

alter table public.gp_orgaos add column if not exists excluido_em timestamptz;
alter table public.gp_orgaos add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_orgaos_excluido on public.gp_orgaos (excluido_em);
