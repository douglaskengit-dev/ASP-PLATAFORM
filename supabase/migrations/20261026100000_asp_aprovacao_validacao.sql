-- ============================================================================
-- ASP — Fases 5/9: aprovação do relatório sem ambiguidade nem duplicata, e a
-- versão ASSINADA do relatório.
--
-- 1) gp_relatorios ganha:
--    motivo_categoria   categoria da reprovação (Dados incorretos, Fotos,
--                       Texto/redação, Medição, Formatação, Outro).
--    avaliado_por/_em   quem aprovou OU reprovou, e quando (aprovado_por
--                       continua só para a aprovação).
--    assinado_path/_hash/_por/_em  a versão assinada (PDF) do relatório
--                       aprovado — o documento final. status → 'assinado'.
-- 2) gp_fase_historico ganha:
--    motivo_categoria   mesma categoria, no histórico da reprovação.
--    relatorio_id       relatório avaliado/assinado naquela movimentação.
--    chave_idempotencia Idempotency-Key do envio (fila offline / duplo
--                       clique): única — a mesma ação não entra 2x.
-- 3) gp_inspecoes.cadastro_atualizado_em: quando TAG, procedimento ou tanque
--    mudaram (aviso "a OS mudou depois do envio do relatório").
-- 4) gp_relatorio_visualizacoes(relatorio_id, usuario_id, em): quem já
--    baixou cada versão (aviso "aprovar sem ter aberto o arquivo"). Gravada
--    pela rota de download (chave de serviço).
-- 5) Checks: categoria na lista; status 'assinado' só com o arquivo
--    assinado; a mesma versão assinada (hash) uma vez por OS.
--    Se o banco JÁ tiver dados que violam um check/índice, ele NÃO é criado:
--    sai um NOTICE e a migração segue. Corrija e rode de novo (idempotente).
--    Nenhum dado existente é alterado por esta migração.
-- ============================================================================

-- 1) gp_relatorios
alter table public.gp_relatorios add column if not exists motivo_categoria text;
alter table public.gp_relatorios add column if not exists avaliado_por uuid references public.gp_profiles (id);
alter table public.gp_relatorios add column if not exists avaliado_em timestamptz;
alter table public.gp_relatorios add column if not exists assinado_path text;
alter table public.gp_relatorios add column if not exists assinado_hash text;
alter table public.gp_relatorios add column if not exists assinado_por uuid references public.gp_profiles (id);
alter table public.gp_relatorios add column if not exists assinado_em timestamptz;

-- 2) gp_fase_historico
alter table public.gp_fase_historico add column if not exists motivo_categoria text;
alter table public.gp_fase_historico add column if not exists relatorio_id uuid
  references public.gp_relatorios (id) on delete set null;
alter table public.gp_fase_historico add column if not exists chave_idempotencia uuid;
create unique index if not exists uq_gp_fase_historico_chave
  on public.gp_fase_historico (chave_idempotencia) where chave_idempotencia is not null;

-- 3) gp_inspecoes
alter table public.gp_inspecoes add column if not exists cadastro_atualizado_em timestamptz;

-- 4) Visualizações (downloads) por usuário e versão
create table if not exists public.gp_relatorio_visualizacoes (
  id uuid primary key default gen_random_uuid(),
  relatorio_id uuid not null references public.gp_relatorios (id) on delete cascade,
  usuario_id uuid not null references public.gp_profiles (id) on delete cascade,
  em timestamptz not null default now(),
  unique (relatorio_id, usuario_id)
);
alter table public.gp_relatorio_visualizacoes enable row level security;
drop policy if exists gp_relatorio_visualizacoes_select on public.gp_relatorio_visualizacoes;
create policy gp_relatorio_visualizacoes_select on public.gp_relatorio_visualizacoes for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_relatorio_visualizacoes_insert on public.gp_relatorio_visualizacoes;
create policy gp_relatorio_visualizacoes_insert on public.gp_relatorio_visualizacoes for insert to authenticated
  with check (usuario_id = auth.uid() and public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_relatorio_visualizacoes_update on public.gp_relatorio_visualizacoes;
create policy gp_relatorio_visualizacoes_update on public.gp_relatorio_visualizacoes for update to authenticated
  using (usuario_id = auth.uid());

-- 5) Checks e índice
do $$
declare
  qtd int;
  lista text;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_motivo_categoria') then
    alter table public.gp_relatorios add constraint ck_gp_relatorios_motivo_categoria
      check (motivo_categoria is null or motivo_categoria in ('dados_incorretos', 'fotos', 'texto', 'medicao', 'formatacao', 'outro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_fase_historico_motivo_categoria') then
    alter table public.gp_fase_historico add constraint ck_gp_fase_historico_motivo_categoria
      check (motivo_categoria is null or motivo_categoria in ('dados_incorretos', 'fotos', 'texto', 'medicao', 'formatacao', 'outro'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_assinado_arquivo') then
    select count(*), string_agg(format('OS %s %s v%s', inspecao_id, tipo, versao), ', ') into qtd, lista
    from public.gp_relatorios where status = 'assinado' and assinado_path is null;
    if qtd > 0 then
      raise notice 'Check "assinado só com arquivo assinado" NÃO criado — % relatório(s) com status assinado sem o arquivo: %. Envie a versão assinada (ou volte o status para aprovado) e rode de novo.', qtd, lista;
    else
      alter table public.gp_relatorios add constraint ck_gp_relatorios_assinado_arquivo
        check (status <> 'assinado' or assinado_path is not null);
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_assinado_hash') then
    select string_agg(format('OS %s', inspecao_id), ', ') into lista
    from (
      select inspecao_id from public.gp_relatorios
      where assinado_hash is not null and excluido_em is null
      group by inspecao_id, assinado_hash having count(*) > 1
    ) d;
    if lista is not null then
      raise notice 'Índice "versão assinada única por OS" NÃO criado — arquivos assinados repetidos em: %', lista;
    else
      create unique index uq_gp_relatorios_assinado_hash
        on public.gp_relatorios (inspecao_id, assinado_hash) where assinado_hash is not null and excluido_em is null;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
