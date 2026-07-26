-- ============================================================================
-- ASP — Agendamento (hora) + Notificações in-app.
-- equipe/equipamentos continuam em jsonb (agora a equipe guarda usuários:
-- [{ id, nome }]). Adiciona a hora da visita e uma tabela de notificações
-- para avisar os envolvidos quando uma inspeção é agendada.
-- ============================================================================

-- Hora da visita (a data segue em data_visita).
alter table public.gp_agendamentos add column if not exists hora text;

-- Notificações in-app, uma por destinatário.
create table if not exists public.gp_notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.gp_profiles (id) on delete cascade,
  tipo text not null default 'agendamento',
  titulo text not null,
  mensagem text,
  link text,
  inspecao_id uuid references public.gp_inspecoes (id) on delete cascade,
  lida boolean not null default false,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now()
);
create index if not exists idx_gp_notificacoes_usuario on public.gp_notificacoes (usuario_id, lida);

alter table public.gp_notificacoes enable row level security;

-- Cada um vê e atualiza (marca como lida) apenas as suas notificações.
drop policy if exists gp_notificacoes_select on public.gp_notificacoes;
create policy gp_notificacoes_select on public.gp_notificacoes for select to authenticated
  using (usuario_id = auth.uid());
drop policy if exists gp_notificacoes_update on public.gp_notificacoes;
create policy gp_notificacoes_update on public.gp_notificacoes for update to authenticated
  using (usuario_id = auth.uid());
-- Qualquer usuário do fluxo pode gerar notificações (ao agendar).
drop policy if exists gp_notificacoes_insert on public.gp_notificacoes;
create policy gp_notificacoes_insert on public.gp_notificacoes for insert to authenticated
  with check (public.gp_perfil_atual_asp() is not null);
