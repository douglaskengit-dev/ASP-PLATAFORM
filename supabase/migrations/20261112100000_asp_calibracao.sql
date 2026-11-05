-- ============================================================================
-- ASP — Calibração dos equipamentos.
--
-- Alguns equipamentos do Catálogo precisam de calibração (marcação
-- exige_calibracao). Cada um tem UNIDADES físicas (nº de série/patrimônio) e
-- cada unidade a sua calibração: data, validade, certificado, laboratório e o
-- PDF do certificado (opcional). Registrar uma calibração nova guarda a
-- anterior no histórico — nada é sobrescrito.
--
--   gp_equipamentos.exige_calibracao   o equipamento exige calibração
--   gp_equipamento_unidades            unidades + a calibração VIGENTE (cópia
--                                      da mais recente do histórico)
--   gp_calibracoes                     histórico de calibrações por unidade
--   gp_calibracao_avisos               um aviso por unidade, vencimento e
--                                      etapa (30 dias, 7 dias, no dia e uma
--                                      vez por semana depois de vencida) —
--                                      a rotina repetida não duplica.
--
-- A rotina do banco (pg_cron + pg_net) chama /api/cron/calibracao todo dia
-- às 8h de Brasília (11:00 UTC); o app avisa TODOS os usuários ativos (sino
-- + celular). Usa o mesmo token de gp_config_interna das pendências de campo.
-- Idempotente. Usa só $$.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 0) Token interno (já criado pela migração das pendências de campo) -------
create table if not exists public.gp_config_interna (
  chave text primary key,
  valor text not null,
  criado_em timestamptz not null default now()
);
alter table public.gp_config_interna enable row level security;
insert into public.gp_config_interna (chave, valor)
  values ('cron_token', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
  on conflict (chave) do nothing;

-- 1) Equipamento exige calibração ---------------------------------------------
alter table public.gp_equipamentos add column if not exists exige_calibracao boolean not null default false;

-- 2) Unidades -----------------------------------------------------------------
create table if not exists public.gp_equipamento_unidades (
  id uuid primary key default gen_random_uuid(),
  equipamento_id uuid not null references public.gp_equipamentos (id) on delete cascade,
  identificacao text not null check (length(btrim(identificacao)) > 0),
  observacao text,
  ativo boolean not null default true,
  -- calibração vigente (a mais recente de gp_calibracoes)
  calibrado_em date,
  vence_em date,
  validade_meses int check (validade_meses is null or validade_meses between 1 and 120),
  certificado text,
  laboratorio text,
  certificado_path text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.gp_profiles (id) on delete set null
);
create unique index if not exists uq_gp_equip_unidades_ident
  on public.gp_equipamento_unidades (equipamento_id, lower(btrim(identificacao)));
create index if not exists idx_gp_equip_unidades_vence on public.gp_equipamento_unidades (vence_em);

-- 3) Histórico ----------------------------------------------------------------
create table if not exists public.gp_calibracoes (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.gp_equipamento_unidades (id) on delete cascade,
  calibrado_em date not null,
  vence_em date not null,
  validade_meses int check (validade_meses is null or validade_meses between 1 and 120),
  certificado text,
  laboratorio text,
  certificado_path text,
  registrado_por uuid references public.gp_profiles (id) on delete set null,
  registrado_em timestamptz not null default now(),
  check (vence_em > calibrado_em)
);
create index if not exists idx_gp_calibracoes_unidade on public.gp_calibracoes (unidade_id, calibrado_em desc);

-- 4) Avisos enviados (idempotência) -------------------------------------------
create table if not exists public.gp_calibracao_avisos (
  unidade_id uuid not null references public.gp_equipamento_unidades (id) on delete cascade,
  vence_em date not null,
  etapa text not null,
  usuarios int not null default 0,
  enviado_em timestamptz not null default now(),
  primary key (unidade_id, vence_em, etapa)
);

-- 5) RLS: todos do ASP leem; Operações, Gerência e Admin mantêm (como o
--    Catálogo). Avisos: sem policy — só o service role.
alter table public.gp_equipamento_unidades enable row level security;
alter table public.gp_calibracoes enable row level security;
alter table public.gp_calibracao_avisos enable row level security;

drop policy if exists gp_equip_unidades_select on public.gp_equipamento_unidades;
create policy gp_equip_unidades_select on public.gp_equipamento_unidades for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_equip_unidades_write on public.gp_equipamento_unidades;
create policy gp_equip_unidades_write on public.gp_equipamento_unidades for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));

drop policy if exists gp_calibracoes_select on public.gp_calibracoes;
create policy gp_calibracoes_select on public.gp_calibracoes for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_calibracoes_write on public.gp_calibracoes;
create policy gp_calibracoes_write on public.gp_calibracoes for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));

-- 6) Rotina diária às 8h de Brasília --------------------------------------------
select cron.unschedule(jobname) from cron.job where jobname = 'asp-calibracao';
select cron.schedule('asp-calibracao', '0 11 * * *', $$
  select net.http_post(
    url := 'https://asp-plataform.vercel.app/api/cron/calibracao',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-token', (select valor from public.gp_config_interna where chave = 'cron_token')),
    timeout_milliseconds := 30000)
$$);

notify pgrst, 'reload schema';
