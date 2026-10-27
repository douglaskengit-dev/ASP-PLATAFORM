-- ============================================================================
-- ASP — Pendências de campo: avisos da execução (fase 7) às 11h, 16h e 17h30.
--
-- A rotina do banco (pg_cron) chama o app (pg_net) nos três horários de
-- Brasília; o app confere as OSs em execução hoje e avisa a EQUIPE AGENDADA
-- do que falta — fotos da coleta e o RDO do dia —, no sino e no celular
-- (push). As 17h30 só valem no último dia da execução.
--
--   gp_config_interna              token que o app confere em cada chamada
--                                  (gerado aqui; nenhum segredo vai para a
--                                  Vercel). Sem policy: só o service role lê.
--   gp_pendencias_campo_envios     um aviso por pessoa, dia e turno — a mesma
--                                  chamada repetida não duplica.
--   gp_pendencias_campo_silencio   "Não avisar mais hoje" (por pessoa e dia).
--
-- Horários em UTC (Brasília = UTC−3, sem horário de verão):
--   11h → 14:00 · 16h → 19:00 · 17h30 → 20:30. Todos os dias da semana —
--   a execução pode cair em fim de semana; sem execução hoje, nada é enviado.
-- Idempotente. Usa só $$.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 1) Token interno ------------------------------------------------------------
create table if not exists public.gp_config_interna (
  chave text primary key,
  valor text not null,
  criado_em timestamptz not null default now()
);
alter table public.gp_config_interna enable row level security;
insert into public.gp_config_interna (chave, valor)
  values ('cron_token', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
  on conflict (chave) do nothing;

-- 2) Envios (idempotência) ----------------------------------------------------
create table if not exists public.gp_pendencias_campo_envios (
  data date not null,
  turno text not null check (turno in ('11h', '16h', '17h30')),
  usuario_id uuid not null references public.gp_profiles (id) on delete cascade,
  oss uuid[] not null default '{}',
  enviado_em timestamptz not null default now(),
  primary key (data, turno, usuario_id)
);
alter table public.gp_pendencias_campo_envios enable row level security;

-- 3) "Não avisar mais hoje" ---------------------------------------------------
create table if not exists public.gp_pendencias_campo_silencio (
  usuario_id uuid not null references public.gp_profiles (id) on delete cascade,
  data date not null,
  criado_em timestamptz not null default now(),
  primary key (usuario_id, data)
);
alter table public.gp_pendencias_campo_silencio enable row level security;
drop policy if exists gp_pendencias_campo_silencio_select on public.gp_pendencias_campo_silencio;
create policy gp_pendencias_campo_silencio_select on public.gp_pendencias_campo_silencio
  for select to authenticated using (usuario_id = auth.uid());
drop policy if exists gp_pendencias_campo_silencio_insert on public.gp_pendencias_campo_silencio;
create policy gp_pendencias_campo_silencio_insert on public.gp_pendencias_campo_silencio
  for insert to authenticated with check (usuario_id = auth.uid() and public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_pendencias_campo_silencio_delete on public.gp_pendencias_campo_silencio;
create policy gp_pendencias_campo_silencio_delete on public.gp_pendencias_campo_silencio
  for delete to authenticated using (usuario_id = auth.uid());

-- 4) Rotinas agendadas ----------------------------------------------------------
select cron.unschedule(jobname) from cron.job
 where jobname in ('asp-pendencias-11h', 'asp-pendencias-16h', 'asp-pendencias-17h30');

select cron.schedule('asp-pendencias-11h', '0 14 * * *', $$
  select net.http_post(
    url := 'https://asp-plataform.vercel.app/api/cron/pendencias-campo',
    body := '{"turno":"11h"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-token', (select valor from public.gp_config_interna where chave = 'cron_token')),
    timeout_milliseconds := 30000)
$$);
select cron.schedule('asp-pendencias-16h', '0 19 * * *', $$
  select net.http_post(
    url := 'https://asp-plataform.vercel.app/api/cron/pendencias-campo',
    body := '{"turno":"16h"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-token', (select valor from public.gp_config_interna where chave = 'cron_token')),
    timeout_milliseconds := 30000)
$$);
select cron.schedule('asp-pendencias-17h30', '30 20 * * *', $$
  select net.http_post(
    url := 'https://asp-plataform.vercel.app/api/cron/pendencias-campo',
    body := '{"turno":"17h30"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-token', (select valor from public.gp_config_interna where chave = 'cron_token')),
    timeout_milliseconds := 30000)
$$);

notify pgrst, 'reload schema';
