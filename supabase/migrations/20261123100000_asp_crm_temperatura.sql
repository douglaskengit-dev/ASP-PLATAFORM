-- ============================================================================
-- ASP — Follow-up (CRM): temperatura da oportunidade para a Previsão de Vendas
-- Ponderada (valor × probabilidade).
--   temperatura: frio (15%), morno (50%) ou quente (85%) escolhida pelo
--   Comercial na ficha. Nula = automática: proposta aceita → quente; etapa
--   Negociação → morno; etapa Proposta (ou com proposta enviada) → frio;
--   antes da proposta → sem temperatura (fora da previsão).
-- Os percentuais e a regra automática ficam no código (lib/validacao/crm.ts).
-- Pode rodar mais de uma vez.
-- ============================================================================

alter table public.gp_processos add column if not exists temperatura text;
alter table public.gp_processos drop constraint if exists gp_processos_temperatura_check;
alter table public.gp_processos add constraint gp_processos_temperatura_check
  check (temperatura is null or temperatura in ('frio','morno','quente'));

-- PostgREST: recarrega o cache do schema.
notify pgrst, 'reload schema';
