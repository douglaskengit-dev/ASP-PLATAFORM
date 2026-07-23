-- ============================================================================
-- Schema unificado do Gerador de Propostas (ETAPA 1 do plano de migração)
-- Adaptado de YannHayafugi/Gerador_de_Proposta_Securitizacao (schema.sql v2)
-- Prefixo gp_ para isolar do outro sistema que divide este projeto Supabase.
-- ============================================================================

-- 1. GP_PROFILES — usuários do gerador (paralelo ao profiles do outro app)
create table if not exists public.gp_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  nome_completo text,
  perfil text not null default 'visualizador'
    check (perfil in ('admin', 'editor', 'visualizador')),
  pode_editar_analises boolean not null default false,
  pode_excluir_analises boolean not null default false,
  -- default FALSE: pool de auth compartilhado com outro sistema; admin ativa quem é do gerador
  ativo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user_gp()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.gp_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_gp on auth.users;
create trigger on_auth_user_created_gp
  after insert on auth.users
  for each row execute procedure public.handle_new_user_gp();

-- 1.1 GP_ORGAOS — cadastro central de órgãos (entes)
create table if not exists public.gp_orgaos (
  id uuid primary key default gen_random_uuid(),
  criado_por uuid references public.gp_profiles (id),
  tipo_ente text not null check (tipo_ente in ('Município', 'Estado')),
  razao_social text not null,
  cnpj text,
  cidade text not null,
  uf text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_gp_orgaos_razao_social on public.gp_orgaos (razao_social);
create unique index if not exists idx_gp_orgaos_cnpj_unico on public.gp_orgaos (cnpj) where cnpj is not null;

-- 1.2 GP_ORGAOS_CONTATOS
create table if not exists public.gp_orgaos_contatos (
  id uuid primary key default gen_random_uuid(),
  orgao_id uuid not null references public.gp_orgaos (id) on delete cascade,
  nome_completo text not null,
  cargo text not null,
  telefone text,
  email text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_gp_orgaos_contatos_orgao_id on public.gp_orgaos_contatos (orgao_id);

-- 2. GP_CADASTROS_TR — um registro por TR analisado (auditoria da IA)
create table if not exists public.gp_cadastros_tr (
  id uuid primary key default gen_random_uuid(),
  criado_por uuid references public.gp_profiles (id),
  orgao_id uuid references public.gp_orgaos (id),
  classificacao text not null check (classificacao in ('Município', 'Estado')),
  nome_ente text not null,
  uf text not null,
  nome_responsavel text not null,
  cargo text not null,
  telefone text,
  email text not null,
  objeto_tr text not null default 'Securitizacao',
  nome_arquivo_tr text not null,
  resultado_bruto_ia jsonb not null,
  status text not null default 'em_analise' check (status in ('em_analise', 'concluida')),
  relatorio_gerado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_gp_cadastros_tr_criado_por on public.gp_cadastros_tr (criado_por);
create index if not exists idx_gp_cadastros_tr_orgao_id on public.gp_cadastros_tr (orgao_id);

-- 3. GP_ACHADOS_TR — achados da análise, com ciência/comentário
create table if not exists public.gp_achados_tr (
  id uuid primary key default gen_random_uuid(),
  cadastro_id uuid not null references public.gp_cadastros_tr (id) on delete cascade,
  achado_id text not null,
  item_numero text not null,
  titulo text not null,
  texto text not null,
  comentario_obrigatorio boolean not null default false,
  ciente boolean not null default false,
  comentario text,
  ciente_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cadastro_id, achado_id)
);
create index if not exists idx_gp_achados_tr_cadastro_id on public.gp_achados_tr (cadastro_id);

-- 3.1 GP_ACHADOS_TR_HISTORICO — trilha de auditoria (append-only)
create table if not exists public.gp_achados_tr_historico (
  id uuid primary key default gen_random_uuid(),
  achado_id uuid not null references public.gp_achados_tr (id) on delete cascade,
  versao int not null,
  ciente_anterior boolean not null,
  comentario_anterior text,
  ciente_novo boolean not null,
  comentario_novo text,
  justificativa_edicao text not null,
  editado_por uuid references public.gp_profiles (id),
  editado_em timestamptz not null default now()
);
create index if not exists idx_gp_achados_tr_hist_achado_id on public.gp_achados_tr_historico (achado_id);

-- 4. GP_PROCESSOS — Follow-up unificado (substitui gp_propostas; início limpo por decisão D5)
create table if not exists public.gp_processos (
  id uuid primary key default gen_random_uuid(),
  criado_por uuid references public.gp_profiles (id),
  orgao_id uuid references public.gp_orgaos (id),      -- D6: cliente referencia órgão
  titulo text not null,
  etapa int not null default 0,
  documentos jsonb not null default '{}'::jsonb,
  arquivos jsonb not null default '{}'::jsonb,
  tr_nome text,
  cadastro_tr_id uuid references public.gp_cadastros_tr (id),  -- liga a análise do TR ao processo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_gp_processos_criado_por on public.gp_processos (criado_por);
create index if not exists idx_gp_processos_orgao_id on public.gp_processos (orgao_id);

-- 4.1 GP_OFICIOS já existe (catálogo do drop); ganha vínculo com usuário e órgão
alter table public.gp_oficios add column if not exists criado_por uuid references public.gp_profiles (id);
alter table public.gp_oficios add column if not exists orgao_id uuid references public.gp_orgaos (id);

-- 5. RLS
alter table public.gp_profiles enable row level security;
alter table public.gp_orgaos enable row level security;
alter table public.gp_orgaos_contatos enable row level security;
alter table public.gp_cadastros_tr enable row level security;
alter table public.gp_achados_tr enable row level security;
alter table public.gp_achados_tr_historico enable row level security;
alter table public.gp_processos enable row level security;

-- órgãos e contatos: compartilhados entre usuários ativos do gerador
drop policy if exists "gp_orgaos_select" on public.gp_orgaos;
create policy "gp_orgaos_select" on public.gp_orgaos for select to authenticated
  using (exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));
drop policy if exists "gp_orgaos_insert" on public.gp_orgaos;
create policy "gp_orgaos_insert" on public.gp_orgaos for insert to authenticated
  with check (exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));
drop policy if exists "gp_orgaos_update" on public.gp_orgaos;
create policy "gp_orgaos_update" on public.gp_orgaos for update to authenticated
  using (exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));

drop policy if exists "gp_orgaos_contatos_select" on public.gp_orgaos_contatos;
create policy "gp_orgaos_contatos_select" on public.gp_orgaos_contatos for select to authenticated
  using (exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));
drop policy if exists "gp_orgaos_contatos_insert" on public.gp_orgaos_contatos;
create policy "gp_orgaos_contatos_insert" on public.gp_orgaos_contatos for insert to authenticated
  with check (exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));

-- perfis: usuário ativo vê todos; edita a si mesmo ou admin edita qualquer um
drop policy if exists "gp_profiles_select" on public.gp_profiles;
create policy "gp_profiles_select" on public.gp_profiles for select to authenticated
  using (id = auth.uid() or exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));
drop policy if exists "gp_profiles_update" on public.gp_profiles;
create policy "gp_profiles_update" on public.gp_profiles for update to authenticated
  using (id = auth.uid()
         or exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.perfil = 'admin' and p.ativo));

-- cadastros_tr: dono ou admin
drop policy if exists "gp_cadastros_tr_select" on public.gp_cadastros_tr;
create policy "gp_cadastros_tr_select" on public.gp_cadastros_tr for select to authenticated
  using (criado_por = auth.uid()
         or exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.perfil = 'admin' and p.ativo));
drop policy if exists "gp_cadastros_tr_insert" on public.gp_cadastros_tr;
create policy "gp_cadastros_tr_insert" on public.gp_cadastros_tr for insert to authenticated
  with check (criado_por = auth.uid());
drop policy if exists "gp_cadastros_tr_update" on public.gp_cadastros_tr;
create policy "gp_cadastros_tr_update" on public.gp_cadastros_tr for update to authenticated
  using (exists (select 1 from public.gp_profiles p where p.id = auth.uid()
                 and (p.perfil = 'admin' or (criado_por = auth.uid() and p.pode_editar_analises))));
drop policy if exists "gp_cadastros_tr_delete" on public.gp_cadastros_tr;
create policy "gp_cadastros_tr_delete" on public.gp_cadastros_tr for delete to authenticated
  using (exists (select 1 from public.gp_profiles p where p.id = auth.uid()
                 and (p.perfil = 'admin' or (criado_por = auth.uid() and p.pode_excluir_analises))));

-- achados: seguem a permissão do cadastro-pai
drop policy if exists "gp_achados_tr_select" on public.gp_achados_tr;
create policy "gp_achados_tr_select" on public.gp_achados_tr for select to authenticated
  using (exists (select 1 from public.gp_cadastros_tr c where c.id = gp_achados_tr.cadastro_id
                 and (c.criado_por = auth.uid()
                      or exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.perfil = 'admin'))));
drop policy if exists "gp_achados_tr_insert" on public.gp_achados_tr;
create policy "gp_achados_tr_insert" on public.gp_achados_tr for insert to authenticated
  with check (exists (select 1 from public.gp_cadastros_tr c
                      where c.id = gp_achados_tr.cadastro_id and c.criado_por = auth.uid()));
drop policy if exists "gp_achados_tr_update" on public.gp_achados_tr;
create policy "gp_achados_tr_update" on public.gp_achados_tr for update to authenticated
  using (exists (select 1 from public.gp_cadastros_tr c
                 join public.gp_profiles p on p.id = auth.uid()
                 where c.id = gp_achados_tr.cadastro_id
                 and (p.perfil = 'admin' or (c.criado_por = auth.uid() and p.pode_editar_analises))));
drop policy if exists "gp_achados_tr_delete" on public.gp_achados_tr;
create policy "gp_achados_tr_delete" on public.gp_achados_tr for delete to authenticated
  using (exists (select 1 from public.gp_cadastros_tr c
                 join public.gp_profiles p on p.id = auth.uid()
                 where c.id = gp_achados_tr.cadastro_id
                 and (p.perfil = 'admin' or (c.criado_por = auth.uid() and p.pode_excluir_analises))));

-- histórico: append-only
drop policy if exists "gp_achados_hist_select" on public.gp_achados_tr_historico;
create policy "gp_achados_hist_select" on public.gp_achados_tr_historico for select to authenticated
  using (exists (select 1 from public.gp_achados_tr a
                 join public.gp_cadastros_tr c on c.id = a.cadastro_id
                 where a.id = gp_achados_tr_historico.achado_id
                 and (c.criado_por = auth.uid()
                      or exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.perfil = 'admin'))));
drop policy if exists "gp_achados_hist_insert" on public.gp_achados_tr_historico;
create policy "gp_achados_hist_insert" on public.gp_achados_tr_historico for insert to authenticated
  with check (exists (select 1 from public.gp_achados_tr a
                      join public.gp_cadastros_tr c on c.id = a.cadastro_id
                      join public.gp_profiles p on p.id = auth.uid()
                      where a.id = gp_achados_tr_historico.achado_id
                      and (p.perfil = 'admin' or (c.criado_por = auth.uid() and p.pode_editar_analises))));

-- processos: dono ou admin (mesmo padrão dos cadastros_tr)
drop policy if exists "gp_processos_select" on public.gp_processos;
create policy "gp_processos_select" on public.gp_processos for select to authenticated
  using (criado_por = auth.uid()
         or exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.perfil = 'admin' and p.ativo));
drop policy if exists "gp_processos_insert" on public.gp_processos;
create policy "gp_processos_insert" on public.gp_processos for insert to authenticated
  with check (criado_por = auth.uid());
drop policy if exists "gp_processos_update" on public.gp_processos;
create policy "gp_processos_update" on public.gp_processos for update to authenticated
  using (criado_por = auth.uid()
         or exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.perfil = 'admin' and p.ativo));
drop policy if exists "gp_processos_delete" on public.gp_processos;
create policy "gp_processos_delete" on public.gp_processos for delete to authenticated
  using (criado_por = auth.uid()
         or exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.perfil = 'admin' and p.ativo));
