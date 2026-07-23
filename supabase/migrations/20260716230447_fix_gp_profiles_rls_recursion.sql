-- As policies de gp_profiles consultavam a própria gp_profiles dentro da
-- condição USING, causando recursão infinita (erro 42P17 -> 500 no PostgREST).
-- Função security definer resolve o "sou eu mesmo ativo/admin?" sem reacionar
-- a RLS de gp_profiles (o dono da função, postgres, faz bypass de RLS).
create or replace function gp_perfil_atual()
returns table(ativo boolean, perfil text)
language sql
stable
security definer
set search_path = public
as $$
  select ativo, perfil from gp_profiles where id = auth.uid();
$$;

drop policy if exists gp_profiles_select on gp_profiles;
create policy gp_profiles_select on gp_profiles
for select
using (
  id = auth.uid()
  or exists (select 1 from gp_perfil_atual() where ativo)
);

drop policy if exists gp_profiles_update on gp_profiles;
create policy gp_profiles_update on gp_profiles
for update
using (
  id = auth.uid()
  or exists (select 1 from gp_perfil_atual() where ativo and perfil = 'admin')
);
