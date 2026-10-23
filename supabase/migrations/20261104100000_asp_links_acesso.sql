-- ============================================================================
-- ASP — Acesso por e-mail: convite (primeiro acesso) e redefinição de senha.
--
-- 1) gp_links_acesso: um registro por link emitido (auditoria de quem pediu,
--    para quem, tipo, quando, resultado do envio e uso). O link do e-mail
--    leva só um token aleatório; aqui fica APENAS o SHA-256 dele
--    (token_hash) — nem quem lê o banco consegue montar o link. Prazo nosso:
--    convite 24 h, redefinição 1 h (expira_em). Uso único (usado_em).
--    Emitir outro do mesmo tipo invalida os pendentes (invalidado_em).
--    O Supabase não guarda link nenhum: na hora de definir a senha o servidor
--    gera e consome um OTP de recuperação no mesmo instante, então o
--    "Email OTP Expiration" do Supabase não precisa ser alterado.
-- 2) gp_acesso_tentativas: pedidos de "Esqueci minha senha" para o limite
--    (3 por e-mail / 15 min; 10 por IP / hora). Chave = hash do e-mail/IP.
-- 3) Desativar o usuário (gp_profiles.ativo → false) invalida os links
--    pendentes dele (trigger). Excluir: usuario_id vira null (a linha fica
--    para auditoria) e o link deixa de valer.
-- 4) RLS ligado SEM policy nas duas tabelas e sem grants para anon/
--    authenticated: só a chave de serviço (API) lê e grava.
--
-- Backfill: NENHUM. Idempotente: pode rodar de novo.
-- ============================================================================

-- 1) Links
create table if not exists public.gp_links_acesso (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.gp_profiles (id) on delete set null,
  email text not null,
  tipo text not null,
  token_hash text not null,
  criado_por uuid references public.gp_profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usado_em timestamptz,
  uso_ip text,
  invalidado_em timestamptz,
  invalidado_motivo text,
  destino text,
  ip text,
  user_agent text,
  envio_status text not null default 'pendente',
  envio_erro text,
  enviado_em timestamptz
);

alter table public.gp_links_acesso add column if not exists uso_ip text;
alter table public.gp_links_acesso add column if not exists invalidado_em timestamptz;
alter table public.gp_links_acesso add column if not exists invalidado_motivo text;
alter table public.gp_links_acesso add column if not exists destino text;
alter table public.gp_links_acesso add column if not exists envio_status text not null default 'pendente';
alter table public.gp_links_acesso add column if not exists envio_erro text;
alter table public.gp_links_acesso add column if not exists enviado_em timestamptz;

alter table public.gp_links_acesso drop constraint if exists ck_gp_links_acesso_tipo;
alter table public.gp_links_acesso add constraint ck_gp_links_acesso_tipo
  check (tipo in ('convite', 'redefinicao'));
alter table public.gp_links_acesso drop constraint if exists ck_gp_links_acesso_envio;
alter table public.gp_links_acesso add constraint ck_gp_links_acesso_envio
  check (envio_status in ('pendente', 'enviado', 'nao_configurado', 'falhou'));
-- Convite no máximo 24 h; redefinição no máximo 1 h (folga de 1 min).
alter table public.gp_links_acesso drop constraint if exists ck_gp_links_acesso_prazo;
alter table public.gp_links_acesso add constraint ck_gp_links_acesso_prazo
  check (expira_em > criado_em and expira_em <= criado_em
    + case when tipo = 'convite' then interval '24 hours 1 minute' else interval '1 hour 1 minute' end);

create unique index if not exists uq_gp_links_acesso_token on public.gp_links_acesso (token_hash);
create index if not exists idx_gp_links_acesso_usuario on public.gp_links_acesso (usuario_id, tipo, criado_em desc);
create index if not exists idx_gp_links_acesso_email on public.gp_links_acesso (email);

alter table public.gp_links_acesso enable row level security;
revoke all on public.gp_links_acesso from anon, authenticated;
-- Sem policy: só a chave de serviço (API) lê e grava.

-- 2) Tentativas do "Esqueci minha senha"
create table if not exists public.gp_acesso_tentativas (
  id bigint generated always as identity primary key,
  chave text not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_gp_acesso_tentativas_chave on public.gp_acesso_tentativas (chave, criado_em desc);

alter table public.gp_acesso_tentativas enable row level security;
revoke all on public.gp_acesso_tentativas from anon, authenticated;

-- 3) Desativar invalida os links pendentes
create or replace function public.gp_links_acesso_invalida_desativado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ativo is distinct from true and old.ativo is true then
    update public.gp_links_acesso
       set invalidado_em = now(), invalidado_motivo = 'usuario_desativado'
     where usuario_id = new.id and usado_em is null and invalidado_em is null;
  end if;
  return new;
end $$;

drop trigger if exists trg_gp_links_acesso_desativado on public.gp_profiles;
create trigger trg_gp_links_acesso_desativado
  after update of ativo on public.gp_profiles
  for each row execute function public.gp_links_acesso_invalida_desativado();

-- PostgREST: recarrega o cache do schema.
notify pgrst, 'reload schema';
