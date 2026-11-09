-- Cargo e registro profissional do usuário (ex.: "Engenheiro responsável CREA 0000000000 / SP").
-- Sai nas assinaturas do relatório, depois do nome.
alter table public.gp_profiles add column if not exists registro_profissional text;
