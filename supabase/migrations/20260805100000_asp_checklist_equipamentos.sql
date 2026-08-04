-- ============================================================================
-- ASP — Checklist de equipamentos levados a campo.
-- Um por etapa (inspeção e execução), pré-carregado pelo procedimento do
-- Catálogo e complementável. Cada item guarda quem conferiu, quando e uma
-- observação (avaria, substituição, número de série).
-- ============================================================================
create table if not exists public.gp_checklist_equipamentos (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references public.gp_inspecoes (id) on delete cascade,
  tipo text not null check (tipo in ('inspecao','execucao')),
  procedimento text,
  itens jsonb not null default '[]'::jsonb,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (inspecao_id, tipo)
);
create index if not exists idx_gp_checklist_inspecao on public.gp_checklist_equipamentos (inspecao_id);

alter table public.gp_checklist_equipamentos enable row level security;
drop policy if exists gp_checklist_select on public.gp_checklist_equipamentos;
create policy gp_checklist_select on public.gp_checklist_equipamentos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_checklist_write on public.gp_checklist_equipamentos;
create policy gp_checklist_write on public.gp_checklist_equipamentos for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));
