-- ============================================================================
-- ASP — Aviso do cliente: exigências a lembrar antes de ir a campo (crachá,
-- horário de acesso, EPI específico). Vale para TODOS os projetos e inspeções
-- daquele cliente, por isso mora no cadastro do cliente e não no projeto.
-- ============================================================================
alter table public.gp_orgaos add column if not exists avisos text;
