-- ============================================================================
-- ASP — Consolidação de colunas que estavam só em SQL avulso:
--   1. gp_orgaos.endereco — endereço da sede; sugerido como "Endereço da
--      obra" ao criar projetos do cliente.
--   2. gp_relatorios.dados — snapshot jsonb do formulário "Gerar Relatório";
--      permite reabrir o rascunho para edição com tudo preenchido.
--   3. gp_relatorios.excluido_em/por — lixeira (soft delete) dos relatórios,
--      mesma lógica de projeto/inspeção/coleta.
-- ============================================================================
alter table public.gp_orgaos add column if not exists endereco text;

alter table public.gp_relatorios add column if not exists dados jsonb;
alter table public.gp_relatorios add column if not exists excluido_em timestamptz;
alter table public.gp_relatorios add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_relatorios_excluido on public.gp_relatorios (excluido_em);
