-- ============================================================================
-- ASP — Fase 10: ENCERRAMENTO da OS, ENTREGA ao cliente e conclusão do
-- projeto.
--
-- 1) gp_inspecoes ganha o encerramento:
--    encerrada_em               data do encerramento (Brasília) — null = aberta
--    encerrada_por              quem encerrou
--    encerramento_manual        true = encerrada ignorando pendências
--                               (Admin/Gerência)
--    encerramento_justificativa justificativa do encerramento manual
--    encerramento_pendencias    jsonb: lista (texto) das pendências ignoradas
--    Check: encerrada só com quem encerrou; manual só com justificativa.
-- 2) gp_fase_historico.acao passa a aceitar 'encerrar' e 'reabrir' (além de
--    'avancar', 'aprovar', 'reprovar', 'assinar'). O check original foi
--    criado inline (nome gerado pelo Postgres, normalmente
--    gp_fase_historico_acao_check): todo check de gp_fase_historico que
--    fale de "acao" é derrubado e recriado como ck_gp_fase_historico_acao.
-- 3) gp_projetos ganha concluido_em / concluido_automaticamente: preenchidos
--    pela API quando a última OS ativa do projeto é encerrada; limpos ao
--    reabrir, criar ou restaurar uma OS.
-- 4) gp_entregas: registro da entrega ao cliente (os arquivos vão por fora —
--    e-mail, impresso, pendrive…). Soft delete. RLS: leitura para os perfis
--    ASP; escrita Admin/Gerência/Comercial.
--
-- Backfill: NENHUM. OSs que já estão na fase 10 continuam "não encerradas"
-- até alguém encerrar pela tela; nenhum projeto é marcado como concluído
-- por esta migração.
-- Idempotente: pode rodar de novo. Se o banco já tiver dados que violam um
-- check novo, ele NÃO é criado: sai um NOTICE e a migração segue.
-- ============================================================================

-- 1) gp_inspecoes
alter table public.gp_inspecoes add column if not exists encerrada_em date;
alter table public.gp_inspecoes add column if not exists encerrada_por uuid references public.gp_profiles (id);
alter table public.gp_inspecoes add column if not exists encerramento_manual boolean not null default false;
alter table public.gp_inspecoes add column if not exists encerramento_justificativa text;
alter table public.gp_inspecoes add column if not exists encerramento_pendencias jsonb;
create index if not exists idx_gp_inspecoes_encerrada on public.gp_inspecoes (projeto_id) where encerrada_em is not null;

do $$
declare
  qtd int;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_inspecoes_encerramento') then
    select count(*) into qtd from public.gp_inspecoes
     where (encerrada_em is not null and encerrada_por is null)
        or (encerramento_manual and coalesce(btrim(encerramento_justificativa), '') = '');
    if qtd = 0 then
      alter table public.gp_inspecoes add constraint ck_gp_inspecoes_encerramento
        check ((encerrada_em is null or encerrada_por is not null)
           and (not encerramento_manual or coalesce(btrim(encerramento_justificativa), '') <> ''));
    else
      raise notice 'gp_inspecoes: % OS(s) com encerramento incompleto — check ck_gp_inspecoes_encerramento NÃO criado. Corrija e rode de novo.', qtd;
    end if;
  end if;
end $$;

-- 2) gp_fase_historico.acao
do $$
declare
  c record;
  qtd int;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.gp_fase_historico'::regclass
       and contype = 'c'
       and conname <> 'ck_gp_fase_historico_acao'
       and pg_get_constraintdef(oid) ilike '%acao%'
       and pg_get_constraintdef(oid) not ilike '%motivo_categoria%'
  loop
    execute format('alter table public.gp_fase_historico drop constraint %I', c.conname);
    raise notice 'gp_fase_historico: check % derrubado (recriado como ck_gp_fase_historico_acao).', c.conname;
  end loop;

  select count(*) into qtd from public.gp_fase_historico
   where acao not in ('avancar', 'aprovar', 'reprovar', 'assinar', 'encerrar', 'reabrir');
  if qtd > 0 then
    raise notice 'gp_fase_historico: % linha(s) com ação fora da lista — check ck_gp_fase_historico_acao NÃO criado.', qtd;
  else
    alter table public.gp_fase_historico drop constraint if exists ck_gp_fase_historico_acao;
    alter table public.gp_fase_historico add constraint ck_gp_fase_historico_acao
      check (acao in ('avancar', 'aprovar', 'reprovar', 'assinar', 'encerrar', 'reabrir'));
  end if;
end $$;

-- 3) gp_projetos
alter table public.gp_projetos add column if not exists concluido_em timestamptz;
alter table public.gp_projetos add column if not exists concluido_automaticamente boolean not null default false;

-- 4) gp_entregas
create table if not exists public.gp_entregas (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references public.gp_inspecoes (id) on delete cascade,
  data date not null,
  contato_id uuid references public.gp_orgaos_contatos (id) on delete set null,
  contato_nome text,                                     -- nome no momento da entrega
  meio text not null,
  meio_outro text,
  arquivos jsonb not null default '[]'::jsonb,           -- [{chave, tipo, id, caminho, nome, hash, data}]
  observacao text,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references public.gp_profiles (id)
);
create index if not exists idx_gp_entregas_inspecao_id on public.gp_entregas (inspecao_id);
create index if not exists idx_gp_entregas_contato_id on public.gp_entregas (contato_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_entregas_meio') then
    alter table public.gp_entregas add constraint ck_gp_entregas_meio
      check (meio in ('email', 'impresso', 'pendrive', 'outro')
         and (meio <> 'outro' or coalesce(btrim(meio_outro), '') <> ''));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_entregas_arquivos') then
    alter table public.gp_entregas add constraint ck_gp_entregas_arquivos
      check (jsonb_typeof(arquivos) = 'array' and jsonb_array_length(arquivos) > 0);
  end if;
end $$;

alter table public.gp_entregas enable row level security;
drop policy if exists gp_entregas_select on public.gp_entregas;
create policy gp_entregas_select on public.gp_entregas for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_entregas_insert on public.gp_entregas;
create policy gp_entregas_insert on public.gp_entregas for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin', 'gerencia', 'comercial'));
drop policy if exists gp_entregas_update on public.gp_entregas;
create policy gp_entregas_update on public.gp_entregas for update to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'gerencia', 'comercial'));
drop policy if exists gp_entregas_delete on public.gp_entregas;
create policy gp_entregas_delete on public.gp_entregas for delete to authenticated
  using (public.gp_perfil_atual_asp() = 'admin');
