-- ============================================================================
-- ASP — Administração de usuários sem dado ambíguo ou duplicado.
--
-- 1) gp_profiles.updated_at (já existe desde o início) passa a ser a VERSÃO
--    do usuário: o trigger trg_gp_profiles_updated_at a renova em todo
--    update. A API grava com a versão lida e devolve 409 ("Outro
--    administrador alterou este usuário às HH:MM") se ela mudou.
-- 2) Nunca sem administrador: o trigger trg_gp_profiles_guarda_admin barra
--    rebaixar, desativar ou excluir o ÚLTIMO admin ativo (erro
--    'gp_ultimo_admin'). Usa um lock de transação, então dois admins se
--    rebaixando ao mesmo tempo não deixam o sistema sem nenhum.
-- 3) E-mail único sem diferença de caixa/espaço: índice
--    uq_gp_profiles_email_chave em lower(btrim(email)). Se o banco JÁ TEM
--    e-mails repetidos, o índice NÃO é criado: sai um NOTICE por grupo.
--    Resolva (exclua/ajuste o duplicado) e rode de novo. A API confere do
--    mesmo jeito enquanto isso.
--
-- Backfill: NENHUM (nomes, e-mails e perfis existentes ficam como estão).
-- Idempotente: pode rodar de novo.
-- ============================================================================

-- 1) Versão
alter table public.gp_profiles add column if not exists updated_at timestamptz not null default now();

create or replace function public.gp_profiles_tocar_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_gp_profiles_updated_at on public.gp_profiles;
create trigger trg_gp_profiles_updated_at
  before update on public.gp_profiles
  for each row execute function public.gp_profiles_tocar_updated_at();

-- 2) Último administrador ativo
create or replace function public.gp_profiles_guarda_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.perfil = 'admin' and old.ativo
     and (tg_op = 'DELETE' or new.perfil is distinct from 'admin' or new.ativo is distinct from true) then
    -- Serializa quem tira acesso de admin; a contagem abaixo já enxerga o
    -- que a transação concorrente gravou.
    perform pg_advisory_xact_lock(hashtext('gp_profiles_ultimo_admin'));
    if not exists (select 1 from public.gp_profiles p where p.id <> old.id and p.perfil = 'admin' and p.ativo) then
      raise exception 'gp_ultimo_admin' using hint = 'Promova outro usuário a Administrador antes.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_gp_profiles_guarda_admin on public.gp_profiles;
create trigger trg_gp_profiles_guarda_admin
  before update of perfil, ativo or delete on public.gp_profiles
  for each row execute function public.gp_profiles_guarda_admin();

-- 3) E-mail único (NOTICE com os conflitos, se houver)
do $$
declare
  g record;
  qtd int := 0;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_profiles_email_chave') then
    for g in
      select lower(btrim(email)) as chave,
             string_agg(format('"%s" (%s, %s)', email, coalesce(nullif(btrim(nome_completo), ''), 'sem nome'), id), ', ' order by created_at) as itens
        from public.gp_profiles
       where coalesce(btrim(email), '') <> ''
       group by 1 having count(*) > 1
    loop
      qtd := qtd + 1;
      raise notice 'gp_profiles: e-mails que são o MESMO e-mail (chave "%"): %', g.chave, g.itens;
    end loop;
    if qtd = 0 then
      create unique index uq_gp_profiles_email_chave
        on public.gp_profiles (lower(btrim(email))) where coalesce(btrim(email), '') <> '';
    else
      raise notice 'gp_profiles: % grupo(s) de e-mails repetidos — índice uq_gp_profiles_email_chave NÃO criado. Exclua/ajuste o duplicado e rode de novo.', qtd;
    end if;
  end if;

  -- Sem administrador ativo nenhum: o trigger acima não cria um — avisa.
  if not exists (select 1 from public.gp_profiles where perfil = 'admin' and ativo) then
    raise notice 'gp_profiles: NENHUM administrador ativo — ative um pelo SQL (update gp_profiles set ativo = true, perfil = ''admin'' where email = ''...'').';
  end if;
end $$;

notify pgrst, 'reload schema';
