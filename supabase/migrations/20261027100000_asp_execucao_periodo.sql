-- ============================================================================
-- ASP — Fase 6: agendamento da EXECUÇÃO sem ambiguidade.
--
-- 1) gp_agendamentos.data_fim (date, opcional): a execução pode durar vários
--    dias — data_visita = início, data_fim = último dia (null = um dia só).
--    Só a execução tem período; a inspeção continua de um dia.
-- 2) Checks: data_fim ≥ data_visita; data_fim só em execução; "a definir"
--    também sem data_fim. Se o banco JÁ tiver linhas que violam, o check NÃO
--    é criado: sai um NOTICE com a lista e a migração segue. Corrija e rode
--    de novo (idempotente). Nenhum dado existente é alterado.
-- 3) Uma execução ATIVA (não substituída, com data) por OS. A remarcação já
--    substitui a anterior do mesmo tipo (Fase 2), então dois períodos ativos
--    sobrepostos na mesma OS não deveriam existir; o índice fecha a corrida
--    (dois envios ao mesmo tempo). A API tira a anterior de cena ANTES de
--    gravar a nova, para o índice não barrar a remarcação legítima.
--    (Exclusion constraint com daterange exigiria btree_gist — dispensável:
--    uma ativa por OS já impede qualquer sobreposição.)
-- 4) Índice para os conflitos por período (equipe/equipamento em outro local).
-- ============================================================================

-- 1) Período da execução
alter table public.gp_agendamentos add column if not exists data_fim date;

-- 2) Checks
do $$
declare
  qtd int;
  lista text;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_data_fim') then
    select count(*), string_agg(format('%s (OS %s: %s → %s)', id, inspecao_id, data_visita, data_fim), ', ') into qtd, lista
    from public.gp_agendamentos
    where data_fim is not null and (data_visita is null or data_fim < data_visita);
    if qtd > 0 then
      raise notice 'Check "data_fim ≥ data_visita" NÃO criado — % agendamento(s) com fim antes do início (ou sem início): %. Corrija as datas e rode de novo.', qtd, lista;
    else
      alter table public.gp_agendamentos add constraint ck_gp_agendamentos_data_fim
        check (data_fim is null or (data_visita is not null and data_fim >= data_visita));
    end if;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_data_fim_execucao') then
    select count(*), string_agg(format('%s (OS %s, %s)', id, inspecao_id, tipo), ', ') into qtd, lista
    from public.gp_agendamentos
    where data_fim is not null and (tipo <> 'execucao' or a_definir);
    if qtd > 0 then
      raise notice 'Check "período só na execução" NÃO criado — % agendamento(s) de inspeção/a definir com data_fim: %. Limpe a data_fim e rode de novo.', qtd, lista;
    else
      alter table public.gp_agendamentos add constraint ck_gp_agendamentos_data_fim_execucao
        check (data_fim is null or (tipo = 'execucao' and not a_definir));
    end if;
  end if;
end $$;

-- 3) Uma execução ativa (com data) por OS
do $$
declare
  lista text;
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_agendamentos_execucao_ativa') then
    return;
  end if;
  select string_agg(format('OS %s (%s ativas)', inspecao_id, qtd), ', ') into lista
  from (
    select inspecao_id, count(*) as qtd
    from public.gp_agendamentos
    where tipo = 'execucao' and substituido_em is null and not a_definir
    group by inspecao_id
    having count(*) > 1
  ) d;
  if lista is not null then
    raise notice 'Índice "uma execução ativa por OS" NÃO criado — OSs com mais de um agendamento de execução ativo: %. Remarque/exclua os excedentes e rode de novo.', lista;
  else
    create unique index uq_gp_agendamentos_execucao_ativa
      on public.gp_agendamentos (inspecao_id)
      where tipo = 'execucao' and substituido_em is null and not a_definir;
  end if;
end $$;

-- 4) Conflitos por período
create index if not exists idx_gp_agendamentos_periodo_ativos
  on public.gp_agendamentos (data_visita, data_fim) where substituido_em is null;

notify pgrst, 'reload schema';
