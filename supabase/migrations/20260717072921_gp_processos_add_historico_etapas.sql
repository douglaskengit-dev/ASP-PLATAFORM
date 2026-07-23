alter table gp_processos add column if not exists historico_etapas jsonb not null default '[]'::jsonb;
