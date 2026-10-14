-- ============================================================================
-- ASP — Coleta de fotos da execução.
--
-- Checklist fotográfico de campo, um por inspeção, preenchido na fase 7
-- (Execução) e consumido pelo Relatório de Execução: as fotos já entram no
-- formulário do relatório nas seções certas, sem novo upload manual.
--
--   agua_antes / agua_depois  coletas de água antes/depois da limpeza são
--                             necessárias (água potável). Nascem com o valor
--                             de gp_procedimentos.agua_potavel e depois são
--                             manuais, por inspeção.
--   limpeza_confirmada        a equipe confirma que as fotos da limpeza foram
--                             tiradas durante o serviço.
--   itens                     fotos por vaga do checklist (ids definidos em
--                             lib/asp/fotos-execucao.ts):
--     { "tanque_geral":   { "caminho": "fotos-execucao/<id>/tanque_geral/1.jpg",
--                           "por": "Fulano", "em": "2026-10-14T…" },
--       "agua_antes_ph":  { "caminho": "…", "valor": 7.2, "por": …, "em": … },
--       "limpeza_antes":  [ { "caminho": "…", "por": …, "em": … }, … ] }
--                             Vagas de limpeza (antes/durante/depois) são
--                             listas — pedem no mínimo 3 fotos cada.
--
-- Coleta incompleta só gera AVISO (ao avançar a fase 7 e no relatório),
-- nunca bloqueia. Arquivos no bucket privado gp-arquivos, via cliente admin.
-- ============================================================================
alter table public.gp_procedimentos
  add column if not exists agua_potavel boolean not null default false;

comment on column public.gp_procedimentos.agua_potavel is
  'Serviço em água potável: a coleta de fotos da execução já nasce pedindo as coletas de água antes e depois da limpeza.';

create table if not exists public.gp_fotos_execucao (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null unique references public.gp_inspecoes (id) on delete cascade,
  agua_antes boolean not null default false,
  agua_depois boolean not null default false,
  limpeza_confirmada boolean not null default false,
  itens jsonb not null default '{}'::jsonb,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.gp_fotos_execucao enable row level security;
drop policy if exists gp_fotos_execucao_select on public.gp_fotos_execucao;
create policy gp_fotos_execucao_select on public.gp_fotos_execucao for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_fotos_execucao_write on public.gp_fotos_execucao;
create policy gp_fotos_execucao_write on public.gp_fotos_execucao for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));

notify pgrst, 'reload schema';
