-- Policies para gp_oficios (RLS estava ligado sem policies — só a service key acessava).
-- Catálogo compartilhado entre usuários ativos do gerador, como gp_orgaos.
drop policy if exists "gp_oficios_select" on public.gp_oficios;
create policy "gp_oficios_select" on public.gp_oficios for select to authenticated
  using (exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));
drop policy if exists "gp_oficios_insert" on public.gp_oficios;
create policy "gp_oficios_insert" on public.gp_oficios for insert to authenticated
  with check (exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));
drop policy if exists "gp_oficios_update" on public.gp_oficios;
create policy "gp_oficios_update" on public.gp_oficios for update to authenticated
  using (exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.ativo));
