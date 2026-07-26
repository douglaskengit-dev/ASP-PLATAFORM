-- ============================================================================
-- ASP — Função do usuário (Coordenador / Engenheiro / Técnico).
-- A "Área" (Comercial/Operação/Gerência) é derivada do gp_profiles.perfil e
-- não vira coluna. A Função é um atributo informativo, opcional.
-- ============================================================================
alter table public.gp_profiles add column if not exists funcao text;

alter table public.gp_profiles drop constraint if exists gp_profiles_funcao_check;
alter table public.gp_profiles
  add constraint gp_profiles_funcao_check
  check (funcao is null or funcao in ('Coordenador', 'Engenheiro', 'Técnico'));
