-- ============================================================================
-- ASP — PWA Fase 3: notificações push (Web Push / VAPID).
-- Guarda as assinaturas do navegador (PushSubscription) por usuário. O envio
-- é feito pelo servidor (service role) com a chave VAPID privada; o cliente
-- só registra/apaga a própria assinatura.
-- ============================================================================

create table if not exists public.gp_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.gp_profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_gp_push_subs_usuario on public.gp_push_subscriptions (usuario_id);

alter table public.gp_push_subscriptions enable row level security;

-- Cada usuário só enxerga/gerencia as próprias assinaturas.
drop policy if exists gp_push_subs_select on public.gp_push_subscriptions;
create policy gp_push_subs_select on public.gp_push_subscriptions for select to authenticated
  using (usuario_id = auth.uid());
drop policy if exists gp_push_subs_insert on public.gp_push_subscriptions;
create policy gp_push_subs_insert on public.gp_push_subscriptions for insert to authenticated
  with check (usuario_id = auth.uid());
drop policy if exists gp_push_subs_delete on public.gp_push_subscriptions;
create policy gp_push_subs_delete on public.gp_push_subscriptions for delete to authenticated
  using (usuario_id = auth.uid());
