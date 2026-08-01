-- ============================================================================
-- ASP — Medição aprovada: marca qual coleta vale para o relatório.
-- Só uma por inspeção (a API limpa as demais ao aprovar). Guardamos quem
-- aprovou e quando, para rastreabilidade de qual medição gerou o documento.
-- ============================================================================
alter table public.gp_coletas add column if not exists aprovada_em timestamptz;
alter table public.gp_coletas add column if not exists aprovada_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_coletas_aprovada on public.gp_coletas (inspecao_id, aprovada_em);
