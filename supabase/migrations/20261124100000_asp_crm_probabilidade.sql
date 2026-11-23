-- ============================================================================
-- ASP — Follow-up (CRM): percentual próprio da Previsão de Vendas Ponderada.
--   probabilidade: de 0 a 100, digitada na ficha da oportunidade. Quando
--   preenchida, vale no lugar do percentual da temperatura (Frio 15%, Morno
--   50%, Quente 85%) e define a faixa: abaixo de 35% Frio, abaixo de 70%
--   Morno, daí para cima Quente. Nula = vale a temperatura.
-- Pode rodar mais de uma vez.
-- ============================================================================

alter table public.gp_processos add column if not exists probabilidade numeric(5,2);
alter table public.gp_processos drop constraint if exists gp_processos_probabilidade_check;
alter table public.gp_processos add constraint gp_processos_probabilidade_check
  check (probabilidade is null or (probabilidade >= 0 and probabilidade <= 100));

-- PostgREST: recarrega o cache do schema.
notify pgrst, 'reload schema';
