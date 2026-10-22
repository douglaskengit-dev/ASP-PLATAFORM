-- ============================================================================
-- ASP — Fase 2: Ordem de Serviço (OS) e agendamento sem ambiguidade.
--
-- 1) Agendamento "data a definir": nasce sem data_visita (já é nullable),
--    com a_definir = true e um "lembrar em" opcional. Ao receber a data,
--    vira agendamento normal (a_definir = false).
-- 2) Remarcação substitui: o agendamento antigo NÃO é apagado — ganha
--    substituido_em/substituido_por e sai das listas ativas, conflitos,
--    notificações e resumos; fica no histórico ("Remarcado de … para …").
--    Ativo = substituido_em is null.
-- 3) Identificação da OS única no projeto (entre as não excluídas), sem
--    acento/caixa/espaço/hífen/sublinhado/ponto — mesma regra de
--    lib/validacao/ordemServico.ts (a API já barra; o índice fecha a
--    corrida). Se o banco JÁ tiver repetidas, o índice não é criado: sai um
--    NOTICE com a lista e a migração segue. Corrija (renomear a OS) e rode
--    de novo — é idempotente.
-- ============================================================================

-- 1) Data a definir
alter table public.gp_agendamentos alter column data_visita drop not null;
alter table public.gp_agendamentos add column if not exists a_definir boolean not null default false;
alter table public.gp_agendamentos add column if not exists lembrar_em date;

-- 2) Remarcação
alter table public.gp_agendamentos add column if not exists substituido_em timestamptz;
alter table public.gp_agendamentos add column if not exists substituido_por uuid
  references public.gp_agendamentos (id) on delete set null;

-- "A definir" nunca tem data.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_a_definir') then
    alter table public.gp_agendamentos
      add constraint ck_gp_agendamentos_a_definir check (not a_definir or data_visita is null);
  end if;
end $$;

-- Conflitos do dia (equipe/equipamento) e avisos do Dashboard leem só os ativos.
create index if not exists idx_gp_agendamentos_data_ativos
  on public.gp_agendamentos (data_visita) where substituido_em is null;
create index if not exists idx_gp_agendamentos_a_definir
  on public.gp_agendamentos (lembrar_em) where a_definir and substituido_em is null;

-- 3) Identificação da OS única no projeto
do $$
declare
  repetidas text;
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_inspecoes_identificacao_norm') then
    return;
  end if;

  select string_agg(format('%s (%s OSs no projeto %s)', ident, qtd, projeto_id), ', ')
    into repetidas
  from (
    select projeto_id,
      lower(regexp_replace(translate(identificacao,
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '[[:space:]._-]+', '', 'g')) as ident,
      count(*) as qtd
    from public.gp_inspecoes
    where excluido_em is null
    group by 1, 2
    having count(*) > 1
  ) d;

  if repetidas is not null then
    raise notice 'Índice de identificação única da OS NÃO criado — repetidas: %', repetidas;
  else
    create unique index uq_gp_inspecoes_identificacao_norm
      on public.gp_inspecoes (projeto_id, lower(regexp_replace(translate(identificacao,
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '[[:space:]._-]+', '', 'g')))
      where excluido_em is null;
  end if;
end $$;

notify pgrst, 'reload schema';
