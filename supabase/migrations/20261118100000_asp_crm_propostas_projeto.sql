-- ============================================================================
-- ASP — Follow-up (CRM), itens 5 a 8:
--   1) Versões da proposta de cada oportunidade (valor, data, observação e
--      arquivo opcional). A última versão define o valor da oportunidade.
--   2) Oportunidade ganha → projeto aberto a partir dela (gp_processos.projeto_id).
--   3) Lembrete de serviço recorrente → oportunidade criada no Follow-up
--      (gp_lembretes_recorrencia.processo_id).
-- A ficha 360° do cliente usa só o que já existe. Pode rodar mais de uma vez.
-- ============================================================================

-- 1) Versões da proposta --------------------------------------------------------
create table if not exists public.gp_processo_propostas (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.gp_processos (id) on delete cascade,
  versao int not null check (versao >= 1),
  data date not null,
  valor numeric(14,2) check (valor is null or valor >= 0),
  observacao text check (observacao is null or char_length(observacao) <= 2000),
  arquivo text,
  arquivo_nome text,
  criado_por uuid references public.gp_profiles (id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index if not exists uq_gp_processo_propostas_versao on public.gp_processo_propostas (processo_id, versao);

alter table public.gp_processo_propostas enable row level security;
drop policy if exists gp_processo_propostas_select on public.gp_processo_propostas;
create policy gp_processo_propostas_select on public.gp_processo_propostas for select to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','gerencia','comercial'));
drop policy if exists gp_processo_propostas_insert on public.gp_processo_propostas;
create policy gp_processo_propostas_insert on public.gp_processo_propostas for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin','gerencia','comercial') and criado_por = auth.uid());
drop policy if exists gp_processo_propostas_delete on public.gp_processo_propostas;
create policy gp_processo_propostas_delete on public.gp_processo_propostas for delete to authenticated
  using (criado_por = auth.uid() or public.gp_perfil_atual_asp() = 'admin');

-- 2) Oportunidade ganha → projeto ------------------------------------------------
alter table public.gp_processos add column if not exists projeto_id uuid references public.gp_projetos (id) on delete set null;
create index if not exists idx_gp_processos_projeto on public.gp_processos (projeto_id);

-- 3) Recorrência → oportunidade ---------------------------------------------------
alter table public.gp_lembretes_recorrencia add column if not exists processo_id uuid references public.gp_processos (id) on delete set null;

-- PostgREST: recarrega o cache do schema.
notify pgrst, 'reload schema';
