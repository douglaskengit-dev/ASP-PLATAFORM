-- Ofícios gerados pelo Gerador de Ofício (para o drop do Follow-up)
create table if not exists public.gp_oficios (
  id text primary key,
  assunto text not null default '',
  destinatario text not null default '',
  contrato text not null default '',
  data timestamptz not null default now(),
  arquivo text not null
);
alter table public.gp_oficios enable row level security;
