-- ============================================================================
-- ASP — Fase 3: coleta de dados da OS sem ambiguidade nem duplicata.
--
-- 1) gp_coletas ganha:
--    data_coleta     dia da coleta (fuso de Brasília), obrigatório. As
--                    linhas antigas recebem o dia do criado_em.
--    responsavel_id  quem mediu (usuário cadastrado) — medição do medidor.
--    descricao       descrição do anexo (PDF avulso), obrigatória no anexo.
--    dados_hash      SHA-256 da medição normalizada (lib/validacao/medicao.ts
--                    → chaveMedicao); a mesma medição não entra 2x na OS.
--    arquivo_hash    SHA-256 dos bytes do PDF; o mesmo PDF não entra 2x.
--    aprovacao_retirada_em/_por  editar a medição aprovada retira a
--                    aprovação; fica registrado quando e por quem.
-- 2) Dados: coleta 'sedimento' sem medição (dados = {}) e com PDF vira
--    'anexo' com descrição "Anexo (migrado)". Anexo e coleta na lixeira
--    perdem a aprovação (só medição ativa vale para o relatório).
-- 3) Índices únicos (entre as coletas NÃO excluídas):
--    · uma medição aprovada por OS;
--    · mesma medição (dados_hash) / mesmo PDF (arquivo_hash) por OS.
--    Se o banco JÁ tiver duas aprovadas na mesma OS, o índice não é criado:
--    sai um NOTICE com a lista e a migração segue. Corrija (desaprove uma)
--    e rode de novo — é idempotente. Os de hash nascem vazios (colunas
--    novas), mas seguem o mesmo padrão.
-- ============================================================================

-- 1) Colunas
alter table public.gp_coletas add column if not exists data_coleta date;
update public.gp_coletas
  set data_coleta = (criado_em at time zone 'America/Sao_Paulo')::date
  where data_coleta is null;
alter table public.gp_coletas
  alter column data_coleta set default ((now() at time zone 'America/Sao_Paulo')::date);
alter table public.gp_coletas alter column data_coleta set not null;

alter table public.gp_coletas add column if not exists responsavel_id uuid
  references public.gp_profiles (id) on delete set null;
alter table public.gp_coletas add column if not exists descricao text;
alter table public.gp_coletas add column if not exists dados_hash text;
alter table public.gp_coletas add column if not exists arquivo_hash text;
alter table public.gp_coletas add column if not exists aprovacao_retirada_em timestamptz;
alter table public.gp_coletas add column if not exists aprovacao_retirada_por uuid
  references public.gp_profiles (id) on delete set null;

-- 2) Dados
update public.gp_coletas
  set tipo = 'anexo',
      descricao = coalesce(nullif(btrim(descricao), ''), 'Anexo (migrado)')
  where tipo = 'sedimento'
    and (dados is null or dados = '{}'::jsonb)
    and pdf_path is not null;
update public.gp_coletas
  set descricao = 'Anexo (migrado)'
  where tipo = 'anexo' and coalesce(btrim(descricao), '') = '';
update public.gp_coletas
  set aprovada_em = null, aprovada_por = null
  where aprovada_em is not null and (tipo = 'anexo' or excluido_em is not null);

-- Anexo sempre com descrição.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_coletas_anexo_descricao') then
    alter table public.gp_coletas
      add constraint ck_gp_coletas_anexo_descricao check (tipo <> 'anexo' or coalesce(btrim(descricao), '') <> '');
  end if;
end $$;

create index if not exists idx_gp_coletas_inspecao_ativas
  on public.gp_coletas (inspecao_id) where excluido_em is null;

-- 3) Índices únicos
do $$
declare
  repetidas text;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_aprovada_por_os') then
    select string_agg(format('OS %s (%s aprovadas)', inspecao_id, qtd), ', ')
      into repetidas
    from (
      select inspecao_id, count(*) as qtd
      from public.gp_coletas
      where aprovada_em is not null and excluido_em is null
      group by 1 having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "uma medição aprovada por OS" NÃO criado — OSs com mais de uma aprovada: %', repetidas;
    else
      create unique index uq_gp_coletas_aprovada_por_os
        on public.gp_coletas (inspecao_id) where aprovada_em is not null and excluido_em is null;
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_dados_hash') then
    select string_agg(format('OS %s', inspecao_id), ', ') into repetidas
    from (
      select inspecao_id from public.gp_coletas
      where dados_hash is not null and excluido_em is null
      group by inspecao_id, dados_hash having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "medição única por OS" NÃO criado — medições repetidas em: %', repetidas;
    else
      create unique index uq_gp_coletas_dados_hash
        on public.gp_coletas (inspecao_id, dados_hash) where dados_hash is not null and excluido_em is null;
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_arquivo_hash') then
    select string_agg(format('OS %s', inspecao_id), ', ') into repetidas
    from (
      select inspecao_id from public.gp_coletas
      where arquivo_hash is not null and excluido_em is null
      group by inspecao_id, arquivo_hash having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "PDF único por OS" NÃO criado — PDFs repetidos em: %', repetidas;
    else
      create unique index uq_gp_coletas_arquivo_hash
        on public.gp_coletas (inspecao_id, arquivo_hash) where arquivo_hash is not null and excluido_em is null;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
