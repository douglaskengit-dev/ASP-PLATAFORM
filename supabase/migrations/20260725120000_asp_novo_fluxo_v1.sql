-- ============================================================================
-- ASP — Novo fluxo de Inspeção/Execução (T2 do briefing COWORK-ASP)
-- Projeto (1 pedido de compra) -> N Inspeções -> fases 2..10 por inspeção.
-- Reaproveita gp_orgaos (cliente) e gp_profiles (usuários/perfis).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PERFIS — enum ampliado (admin/comercial/operacoes/gerencia)
--    Decisão do briefing: constraint AMPLA — aceita os perfis antigos
--    (editor/visualizador) e os novos ao mesmo tempo, para ninguém perder
--    acesso durante a migração. O admin reatribui cada usuário depois.
-- ----------------------------------------------------------------------------
alter table public.gp_profiles drop constraint if exists gp_profiles_perfil_check;
alter table public.gp_profiles
  add constraint gp_profiles_perfil_check
  check (perfil in ('admin', 'comercial', 'operacoes', 'gerencia', 'editor', 'visualizador'));

-- Função auxiliar: perfil do usuário autenticado (ativo). NULL se inativo.
create or replace function public.gp_perfil_atual_asp()
returns text
language sql
stable
security definer set search_path = public
as $$
  select p.perfil from public.gp_profiles p
  where p.id = auth.uid() and p.ativo
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 1. GP_PROJETOS — 1 projeto = 1 pedido de compra (fase 1, Comercial)
-- ----------------------------------------------------------------------------
create table if not exists public.gp_projetos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.gp_orgaos (id),      -- reaproveita cadastro de órgão
  codigo_projeto text,
  pedido_compra text,
  endereco text,                                         -- obra pode diferir do endereço do cliente
  responsavel_projeto text,
  data_abertura date not null default current_date,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_gp_projetos_cliente_id on public.gp_projetos (cliente_id);
create index if not exists idx_gp_projetos_criado_por on public.gp_projetos (criado_por);

-- ----------------------------------------------------------------------------
-- 2. GP_INSPECOES — N por projeto; carrega as fases 2..10
-- ----------------------------------------------------------------------------
create table if not exists public.gp_inspecoes (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.gp_projetos (id) on delete cascade,
  identificacao text not null,                           -- ex.: "Tanque TQ-01"
  fase int not null default 2,                           -- fases correm por inspeção
  status_relatorio_inspecao text not null default 'pendente',
  status_relatorio_execucao text not null default 'pendente',
  ferramenta_coleta text not null default 'sedimento',
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_gp_inspecoes_projeto_id on public.gp_inspecoes (projeto_id);

-- ----------------------------------------------------------------------------
-- 3. GP_COLETAS — dados de campo (medidor de sedimento). jsonb + PDF.
-- ----------------------------------------------------------------------------
create table if not exists public.gp_coletas (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references public.gp_inspecoes (id) on delete cascade,
  tipo text not null default 'sedimento',
  dados jsonb not null default '{}'::jsonb,              -- medição completa, não só o PDF
  pdf_path text,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_gp_coletas_inspecao_id on public.gp_coletas (inspecao_id);

-- ----------------------------------------------------------------------------
-- 4. GP_RELATORIOS — inspeção/execução, versionados (cada reenvio = nova linha)
-- ----------------------------------------------------------------------------
create table if not exists public.gp_relatorios (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references public.gp_inspecoes (id) on delete cascade,
  tipo text not null check (tipo in ('inspecao', 'execucao')),
  versao int not null default 1,
  arquivo_path text,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'em_aprovacao', 'aprovado', 'ajustar', 'assinado')),
  motivo_ajuste text,
  aprovado_por uuid references public.gp_profiles (id),
  enviado_por uuid references public.gp_profiles (id),
  enviado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_gp_relatorios_inspecao_id on public.gp_relatorios (inspecao_id);

-- ----------------------------------------------------------------------------
-- 5. GP_AGENDAMENTOS — checklist (fases 2 e 6). Checklist como jsonb extensível.
-- ----------------------------------------------------------------------------
create table if not exists public.gp_agendamentos (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references public.gp_inspecoes (id) on delete cascade,
  tipo text not null check (tipo in ('inspecao', 'execucao')),
  data_visita date,
  equipe jsonb not null default '[]'::jsonb,
  equipamentos jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,          -- itens extensíveis: NR-33, NR-10, EPIs...
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_gp_agendamentos_inspecao_id on public.gp_agendamentos (inspecao_id);

-- ----------------------------------------------------------------------------
-- 6. GP_FASE_HISTORICO — auditoria de fases (append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.gp_fase_historico (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references public.gp_inspecoes (id) on delete cascade,
  fase_de int,
  fase_para int,
  acao text not null check (acao in ('avancar', 'aprovar', 'reprovar', 'assinar')),
  motivo text,
  autor uuid references public.gp_profiles (id),
  data_autenticacao timestamptz not null default now(),
  criado_em timestamptz not null default now()
);
create index if not exists idx_gp_fase_historico_inspecao_id on public.gp_fase_historico (inspecao_id);

-- ============================================================================
-- RLS — leitura ampla (todo usuário ativo lê); escrita amarrada ao perfil.
-- A validação fina de "qual fase cada perfil movimenta" fica na API; o RLS
-- garante o mínimo por perfil. Perfis antigos (editor/visualizador) NÃO
-- ganham escrita no fluxo novo — só admin/comercial/operacoes/gerencia.
-- ============================================================================
alter table public.gp_projetos       enable row level security;
alter table public.gp_inspecoes      enable row level security;
alter table public.gp_coletas        enable row level security;
alter table public.gp_relatorios     enable row level security;
alter table public.gp_agendamentos   enable row level security;
alter table public.gp_fase_historico enable row level security;

-- helper de leitura: qualquer usuário ativo
-- (inline via gp_perfil_atual_asp() is not null)

-- ---- GP_PROJETOS ----------------------------------------------------------
drop policy if exists gp_projetos_select on public.gp_projetos;
create policy gp_projetos_select on public.gp_projetos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_projetos_insert on public.gp_projetos;
create policy gp_projetos_insert on public.gp_projetos for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin', 'comercial', 'gerencia'));
drop policy if exists gp_projetos_update on public.gp_projetos;
create policy gp_projetos_update on public.gp_projetos for update to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'comercial', 'gerencia'));
drop policy if exists gp_projetos_delete on public.gp_projetos;
create policy gp_projetos_delete on public.gp_projetos for delete to authenticated
  using (public.gp_perfil_atual_asp() = 'admin');

-- ---- GP_INSPECOES ---------------------------------------------------------
drop policy if exists gp_inspecoes_select on public.gp_inspecoes;
create policy gp_inspecoes_select on public.gp_inspecoes for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_inspecoes_insert on public.gp_inspecoes;
create policy gp_inspecoes_insert on public.gp_inspecoes for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin', 'comercial', 'gerencia'));
-- update: comercial/operacoes/gerencia movimentam fases (validação fina na API)
drop policy if exists gp_inspecoes_update on public.gp_inspecoes;
create policy gp_inspecoes_update on public.gp_inspecoes for update to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'comercial', 'operacoes', 'gerencia'));
drop policy if exists gp_inspecoes_delete on public.gp_inspecoes;
create policy gp_inspecoes_delete on public.gp_inspecoes for delete to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'comercial'));

-- ---- GP_COLETAS (Operações) ----------------------------------------------
drop policy if exists gp_coletas_select on public.gp_coletas;
create policy gp_coletas_select on public.gp_coletas for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_coletas_insert on public.gp_coletas;
create policy gp_coletas_insert on public.gp_coletas for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin', 'operacoes', 'gerencia'));
drop policy if exists gp_coletas_update on public.gp_coletas;
create policy gp_coletas_update on public.gp_coletas for update to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'operacoes', 'gerencia'));
drop policy if exists gp_coletas_delete on public.gp_coletas;
create policy gp_coletas_delete on public.gp_coletas for delete to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'operacoes'));

-- ---- GP_RELATORIOS (Operações envia, Gerência aprova) ---------------------
drop policy if exists gp_relatorios_select on public.gp_relatorios;
create policy gp_relatorios_select on public.gp_relatorios for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_relatorios_insert on public.gp_relatorios;
create policy gp_relatorios_insert on public.gp_relatorios for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin', 'operacoes', 'gerencia'));
drop policy if exists gp_relatorios_update on public.gp_relatorios;
create policy gp_relatorios_update on public.gp_relatorios for update to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'operacoes', 'gerencia'));

-- ---- GP_AGENDAMENTOS (Comercial) ------------------------------------------
drop policy if exists gp_agendamentos_select on public.gp_agendamentos;
create policy gp_agendamentos_select on public.gp_agendamentos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_agendamentos_insert on public.gp_agendamentos;
create policy gp_agendamentos_insert on public.gp_agendamentos for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin', 'comercial', 'gerencia'));
drop policy if exists gp_agendamentos_update on public.gp_agendamentos;
create policy gp_agendamentos_update on public.gp_agendamentos for update to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'comercial', 'gerencia'));

-- ---- GP_FASE_HISTORICO (append-only) --------------------------------------
drop policy if exists gp_fase_historico_select on public.gp_fase_historico;
create policy gp_fase_historico_select on public.gp_fase_historico for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_fase_historico_insert on public.gp_fase_historico;
create policy gp_fase_historico_insert on public.gp_fase_historico for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin', 'comercial', 'operacoes', 'gerencia'));
