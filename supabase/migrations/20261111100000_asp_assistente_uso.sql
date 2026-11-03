-- ============================================================================
-- ASP — Robô ASP: dados de uso no registro das respostas (painel do admin).
--   chamadas_ia  quantas vezes a IA foi chamada para a resposta (consultas e
--                correções contam; 0 = resposta guardada ou recusa do filtro)
--   duracao_ms   tempo total da resposta no servidor
-- Idempotente. Usa só $$.
-- ============================================================================

alter table public.gp_assistente_respostas add column if not exists chamadas_ia smallint not null default 0;
alter table public.gp_assistente_respostas add column if not exists duracao_ms integer;
