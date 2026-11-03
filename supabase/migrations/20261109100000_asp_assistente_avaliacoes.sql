-- ============================================================================
-- ASP — Robô ASP (assistente): registro das respostas, avaliação 👍/👎 e
-- exemplos aprovados.
--
--   gp_assistente_respostas  uma linha por resposta do robô: pergunta,
--                            resposta, página, consultas feitas, se foi
--                            recusa (fora do escopo) ou resposta de reserva
--                            (montada pelo servidor), e a avaliação de quem
--                            perguntou (+1 / −1, comentário opcional).
--                            Cada um vê e avalia só as suas; o admin vê todas.
--                            Quem perguntou só pode alterar a avaliação
--                            (grant por coluna).
--   gp_assistente_exemplos   pares pergunta → resposta revisados pelo admin
--                            (a partir de uma resposta boa ou escritos à mão).
--                            Vão no prompt do robô como exemplos para TODOS os
--                            usuários: o admin tira o que nem todos podem ver.
--                            Todos leem; só o admin grava.
-- Idempotente. Usa só $$.
-- ============================================================================

-- 1) Respostas ---------------------------------------------------------------
create table if not exists public.gp_assistente_respostas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references public.gp_profiles (id) on delete cascade,
  pergunta text not null,
  resposta text not null,
  pagina text,
  consultas text[] not null default '{}',
  fora_do_escopo boolean not null default false,
  reserva boolean not null default false,
  provedor text,
  avaliacao smallint check (avaliacao in (-1, 1)),
  comentario text check (char_length(comentario) <= 1000),
  avaliado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists gp_assistente_respostas_criado_idx on public.gp_assistente_respostas (criado_em desc);
create index if not exists gp_assistente_respostas_usuario_idx on public.gp_assistente_respostas (usuario_id, criado_em desc);

alter table public.gp_assistente_respostas enable row level security;

drop policy if exists gp_assistente_respostas_insert on public.gp_assistente_respostas;
create policy gp_assistente_respostas_insert on public.gp_assistente_respostas for insert to authenticated
  with check (usuario_id = auth.uid() and public.gp_perfil_atual_asp() is not null);

drop policy if exists gp_assistente_respostas_select on public.gp_assistente_respostas;
create policy gp_assistente_respostas_select on public.gp_assistente_respostas for select to authenticated
  using (usuario_id = auth.uid() or public.gp_perfil_atual_asp() = 'admin');

drop policy if exists gp_assistente_respostas_update on public.gp_assistente_respostas;
create policy gp_assistente_respostas_update on public.gp_assistente_respostas for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists gp_assistente_respostas_delete on public.gp_assistente_respostas;
create policy gp_assistente_respostas_delete on public.gp_assistente_respostas for delete to authenticated
  using (public.gp_perfil_atual_asp() = 'admin');

-- quem perguntou só mexe na avaliação
revoke update on public.gp_assistente_respostas from authenticated;
grant update (avaliacao, comentario, avaliado_em) on public.gp_assistente_respostas to authenticated;

-- 2) Exemplos ----------------------------------------------------------------
create table if not exists public.gp_assistente_exemplos (
  id uuid primary key default gen_random_uuid(),
  pergunta text not null check (char_length(pergunta) between 1 and 1000),
  resposta text not null check (char_length(resposta) between 1 and 4000),
  ativo boolean not null default true,
  origem_id uuid references public.gp_assistente_respostas (id) on delete set null,
  criado_por uuid default auth.uid() references public.gp_profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.gp_assistente_exemplos enable row level security;

drop policy if exists gp_assistente_exemplos_select on public.gp_assistente_exemplos;
create policy gp_assistente_exemplos_select on public.gp_assistente_exemplos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);

drop policy if exists gp_assistente_exemplos_write on public.gp_assistente_exemplos;
create policy gp_assistente_exemplos_write on public.gp_assistente_exemplos for all to authenticated
  using (public.gp_perfil_atual_asp() = 'admin')
  with check (public.gp_perfil_atual_asp() = 'admin');
