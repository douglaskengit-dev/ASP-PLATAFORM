-- ============================================================================
-- ASP — Dashboards: configuração de cada usuário (KPIs e quadros visíveis,
-- fixados e minimizados), por painel. Cada pessoa lê e grava só a sua.
-- Pode rodar mais de uma vez.
-- ============================================================================

create table if not exists public.gp_dashboard_preferencias (
  usuario_id uuid not null references public.gp_profiles (id) on delete cascade,
  painel text not null check (painel in ('operacoes','gerencia','comercial')),
  config jsonb not null default '{}'::jsonb check (pg_column_size(config) <= 16384),
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, painel)
);

alter table public.gp_dashboard_preferencias enable row level security;
drop policy if exists gp_dashboard_preferencias_select on public.gp_dashboard_preferencias;
create policy gp_dashboard_preferencias_select on public.gp_dashboard_preferencias for select to authenticated
  using (usuario_id = auth.uid());
drop policy if exists gp_dashboard_preferencias_insert on public.gp_dashboard_preferencias;
create policy gp_dashboard_preferencias_insert on public.gp_dashboard_preferencias for insert to authenticated
  with check (usuario_id = auth.uid());
drop policy if exists gp_dashboard_preferencias_update on public.gp_dashboard_preferencias;
create policy gp_dashboard_preferencias_update on public.gp_dashboard_preferencias for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
drop policy if exists gp_dashboard_preferencias_delete on public.gp_dashboard_preferencias;
create policy gp_dashboard_preferencias_delete on public.gp_dashboard_preferencias for delete to authenticated
  using (usuario_id = auth.uid());

-- PostgREST: recarrega o cache do schema.
notify pgrst, 'reload schema';
