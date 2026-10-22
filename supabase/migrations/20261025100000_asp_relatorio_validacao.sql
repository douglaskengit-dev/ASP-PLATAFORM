-- ============================================================================
-- ASP — Fase 4: relatório de inspeção/execução sem ambiguidade nem duplicata.
--
-- 1) gp_relatorios ganha:
--    arquivo_hash    SHA-256 dos bytes do arquivo (PDF/DOCX). O mesmo arquivo
--                    não entra 2x na mesma OS. Linhas antigas ficam null.
--    substituido_em/_por  uma versão nova enviada enquanto outra estava em
--                    aprovação SUBSTITUI a anterior: ela vira 'substituido'
--                    (sai da fila da Gerência) e aponta para a nova.
-- 2) status aceita 'substituido'.
-- 3) Índices únicos (entre os relatórios NÃO excluídos):
--    · (OS, tipo, versão)           — a versão é calculada uma vez, no insert;
--    · um rascunho por (OS, tipo)   — gerar de novo atualiza o mesmo;
--    · um em aprovação por (OS, tipo);
--    · mesmo arquivo (hash) por OS.
--    Se o banco JÁ tiver dados que violam um índice, ele NÃO é criado: sai um
--    NOTICE com a lista e a migração segue. Corrija (exclua o rascunho a mais,
--    reprove/aprove a versão antiga…) e rode de novo — é idempotente.
--    Nenhum dado existente é alterado por esta migração.
-- ============================================================================

-- 1) Colunas
alter table public.gp_relatorios add column if not exists arquivo_hash text;
alter table public.gp_relatorios add column if not exists substituido_em timestamptz;
alter table public.gp_relatorios add column if not exists substituido_por uuid
  references public.gp_relatorios (id) on delete set null;

-- 2) Status 'substituido' (o check original não tem nome próprio: troca
--    qualquer check de status da tabela pelo nomeado abaixo).
do $$
declare
  c record;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_status') then
    for c in
      select conname from pg_constraint
      where conrelid = 'public.gp_relatorios'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.gp_relatorios drop constraint %I', c.conname);
    end loop;
    alter table public.gp_relatorios add constraint ck_gp_relatorios_status
      check (status in ('rascunho', 'em_aprovacao', 'aprovado', 'ajustar', 'assinado', 'substituido'));
  end if;
end $$;

create index if not exists idx_gp_relatorios_inspecao_ativos
  on public.gp_relatorios (inspecao_id, tipo) where excluido_em is null;

-- 3) Índices únicos
do $$
declare
  repetidas text;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_versao') then
    select string_agg(format('OS %s %s v%s (%s linhas)', inspecao_id, tipo, versao, qtd), ', ') into repetidas
    from (
      select inspecao_id, tipo, versao, count(*) as qtd from public.gp_relatorios
      where excluido_em is null group by 1, 2, 3 having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "versão única por OS/tipo" NÃO criado — versões repetidas: %', repetidas;
    else
      create unique index uq_gp_relatorios_versao
        on public.gp_relatorios (inspecao_id, tipo, versao) where excluido_em is null;
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_rascunho') then
    select string_agg(format('OS %s %s (%s rascunhos)', inspecao_id, tipo, qtd), ', ') into repetidas
    from (
      select inspecao_id, tipo, count(*) as qtd from public.gp_relatorios
      where excluido_em is null and status = 'rascunho' group by 1, 2 having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "um rascunho por OS/tipo" NÃO criado — mais de um rascunho em: %', repetidas;
    else
      create unique index uq_gp_relatorios_rascunho
        on public.gp_relatorios (inspecao_id, tipo) where excluido_em is null and status = 'rascunho';
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_em_aprovacao') then
    select string_agg(format('OS %s %s (%s em aprovação)', inspecao_id, tipo, qtd), ', ') into repetidas
    from (
      select inspecao_id, tipo, count(*) as qtd from public.gp_relatorios
      where excluido_em is null and status = 'em_aprovacao' group by 1, 2 having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "um relatório em aprovação por OS/tipo" NÃO criado — mais de um em aprovação em: %', repetidas;
    else
      create unique index uq_gp_relatorios_em_aprovacao
        on public.gp_relatorios (inspecao_id, tipo) where excluido_em is null and status = 'em_aprovacao';
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_arquivo_hash') then
    select string_agg(format('OS %s', inspecao_id), ', ') into repetidas
    from (
      select inspecao_id from public.gp_relatorios
      where arquivo_hash is not null and excluido_em is null
      group by inspecao_id, arquivo_hash having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "arquivo único por OS" NÃO criado — arquivos repetidos em: %', repetidas;
    else
      create unique index uq_gp_relatorios_arquivo_hash
        on public.gp_relatorios (inspecao_id, arquivo_hash) where arquivo_hash is not null and excluido_em is null;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
