-- ============================================================================
-- ASP — RDO (Registro Diário de Operação).
--
-- Um RDO por PROJETO por DIA, preenchido no bloco de Execução e entregue ao
-- cliente como .docx (modelo /templates/rdo-asp.docx). Pode cobrir mais de
-- uma inspeção do projeto — um dia limpando dois tanques é um RDO só.
-- Documento separado: NÃO entra no Relatório de Execução.
--
--   numero        sequência por projeto (RDO nº 001, 002…), calculada na API.
--                 Conta também os excluídos, para um número nunca ser reusado.
--   inspecoes     inspeções cobertas (uuid[] — sem FK; a API valida que são
--                 do mesmo projeto).
--   dados         conteúdo do formulário (cabeçalho, equipe, tempo,
--                 equipamentos, atividades, fiscalização, DDSMS, assinaturas)
--                 — forma em lib/asp/rdo.ts (DadosRdo).
--   arquivo_path  .docx gerado no navegador e enviado depois (pode ficar para
--                 mais tarde sem rede): rdos/<projeto>/RDO-<nº>-<data>.docx.
--   arquivo_em    quando o arquivo foi enviado; atualizado_em posterior a ele
--                 = arquivo desatualizado ("Gerar arquivo" de novo).
--
-- Exclusão em duas etapas (lixeira), como projeto/inspeção/coleta. O dia só
-- é único entre os RDOs ativos (índice parcial).
-- RDO ausente ao concluir a Execução só gera AVISO, nunca bloqueia.
-- ============================================================================
create table if not exists public.gp_rdos (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.gp_projetos (id) on delete cascade,
  data date not null,
  numero int not null,
  inspecoes uuid[] not null default '{}',
  dados jsonb not null default '{}'::jsonb,
  arquivo_path text,
  arquivo_em timestamptz,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references public.gp_profiles (id)
);
create unique index if not exists uq_gp_rdos_projeto_data
  on public.gp_rdos (projeto_id, data) where excluido_em is null;
create unique index if not exists uq_gp_rdos_projeto_numero on public.gp_rdos (projeto_id, numero);
create index if not exists idx_gp_rdos_inspecoes on public.gp_rdos using gin (inspecoes);
create index if not exists idx_gp_rdos_excluido on public.gp_rdos (excluido_em);

alter table public.gp_rdos enable row level security;
drop policy if exists gp_rdos_select on public.gp_rdos;
create policy gp_rdos_select on public.gp_rdos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_rdos_write on public.gp_rdos;
create policy gp_rdos_write on public.gp_rdos for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));

notify pgrst, 'reload schema';
