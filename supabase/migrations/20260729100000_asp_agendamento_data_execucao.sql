-- ============================================================================
-- ASP — Agendamento: data prevista de execução no mesmo registro.
-- Além da data da visita (data_visita), o agendamento passa a guardar a data
-- prevista de execução, para aparecer no calendário e nos avisos.
-- ============================================================================
alter table public.gp_agendamentos add column if not exists data_execucao date;
