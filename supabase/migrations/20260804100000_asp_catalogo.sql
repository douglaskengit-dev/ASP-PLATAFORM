-- ============================================================================
-- ASP — Catálogo editável: procedimentos e equipamentos com especificações.
-- Substitui a lista fixa em lib/asp/procedimentos.ts. As especificações são
-- pares rótulo/valor (jsonb), do jeito que saem no relatório: duas colunas.
-- ============================================================================
create table if not exists public.gp_equipamentos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, nome text not null,
  especificacoes jsonb not null default '[]'::jsonb,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create table if not exists public.gp_procedimentos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique, nome text not null, metodos text,
  equipamentos jsonb not null default '[]'::jsonb,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.gp_equipamentos enable row level security;
alter table public.gp_procedimentos enable row level security;
-- Todos leem; Operações, Gerência e Admin mantêm.
drop policy if exists gp_equip_select on public.gp_equipamentos;
create policy gp_equip_select on public.gp_equipamentos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_equip_write on public.gp_equipamentos;
create policy gp_equip_write on public.gp_equipamentos for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));
drop policy if exists gp_proc_select on public.gp_procedimentos;
create policy gp_proc_select on public.gp_procedimentos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_proc_write on public.gp_procedimentos;
create policy gp_proc_write on public.gp_procedimentos for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));
