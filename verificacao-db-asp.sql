-- ============================================================================
-- ASP — Script de GARANTIA do banco (projeto ayqdqwnrgbiqjwjpccuj).
-- Idempotente: pode rodar quantas vezes quiser, só cria o que falta.
-- Rode inteiro no SQL Editor. No fim, um relatório mostra o status.
-- ============================================================================

-- ============================================================================
-- ASP — Exclusão em duas etapas do projeto (lixeira / soft delete).
-- Excluir marca excluido_em; o projeto some das listas mas fica recuperável
-- por 30 dias. Depois disso é apagado de vez (limpeza preguiçosa no GET).
-- ============================================================================
alter table public.gp_projetos add column if not exists excluido_em timestamptz;
alter table public.gp_projetos add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_projetos_excluido on public.gp_projetos (excluido_em);

-- ============================================================================
-- ASP — Lixeira (soft delete) também para inspeções e clientes (gp_orgaos).
-- Mesma lógica do projeto: excluir marca excluido_em; recuperável por 30 dias.
-- ============================================================================
alter table public.gp_inspecoes add column if not exists excluido_em timestamptz;
alter table public.gp_inspecoes add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_inspecoes_excluido on public.gp_inspecoes (excluido_em);

alter table public.gp_orgaos add column if not exists excluido_em timestamptz;
alter table public.gp_orgaos add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_orgaos_excluido on public.gp_orgaos (excluido_em);

-- ============================================================================
-- ASP — PWA Fase 3: notificações push (Web Push / VAPID).
-- Guarda as assinaturas do navegador (PushSubscription) por usuário. O envio
-- é feito pelo servidor (service role) com a chave VAPID privada; o cliente
-- só registra/apaga a própria assinatura.
-- ============================================================================

create table if not exists public.gp_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.gp_profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_gp_push_subs_usuario on public.gp_push_subscriptions (usuario_id);

alter table public.gp_push_subscriptions enable row level security;

-- Cada usuário só enxerga/gerencia as próprias assinaturas.
drop policy if exists gp_push_subs_select on public.gp_push_subscriptions;
create policy gp_push_subs_select on public.gp_push_subscriptions for select to authenticated
  using (usuario_id = auth.uid());
drop policy if exists gp_push_subs_insert on public.gp_push_subscriptions;
create policy gp_push_subs_insert on public.gp_push_subscriptions for insert to authenticated
  with check (usuario_id = auth.uid());
drop policy if exists gp_push_subs_delete on public.gp_push_subscriptions;
create policy gp_push_subs_delete on public.gp_push_subscriptions for delete to authenticated
  using (usuario_id = auth.uid());

-- ============================================================================
-- ASP — Lixeira (soft delete) também para as coletas/medições.
-- Mesma lógica de projeto/inspeção/cliente: excluir marca excluido_em; a
-- medição some da lista mas fica recuperável por 30 dias, e depois é apagada
-- de vez (limpeza preguiçosa no GET da inspeção).
-- ============================================================================
alter table public.gp_coletas add column if not exists excluido_em timestamptz;
alter table public.gp_coletas add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_coletas_excluido on public.gp_coletas (excluido_em);

-- ============================================================================
-- ASP — Medição aprovada: marca qual coleta vale para o relatório.
-- Só uma por inspeção (a API limpa as demais ao aprovar). Guardamos quem
-- aprovou e quando, para rastreabilidade de qual medição gerou o documento.
-- ============================================================================
alter table public.gp_coletas add column if not exists aprovada_em timestamptz;
alter table public.gp_coletas add column if not exists aprovada_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_coletas_aprovada on public.gp_coletas (inspecao_id, aprovada_em);

-- ============================================================================
-- ASP — Catálogo editável: procedimentos e equipamentos com especificações.
-- Substitui a lista fixa em lib/asp/procedimentos.ts. As especificações são
-- pares rótulo/valor (jsonb), do jeito que saem no relatório: duas colunas.
-- ============================================================================
create table if not exists public.gp_equipamentos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, nome text not null,
  especificacoes jsonb not null default '[]'::jsonb,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create table if not exists public.gp_procedimentos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique, nome text not null, metodos text,
  equipamentos jsonb not null default '[]'::jsonb,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.gp_equipamentos enable row level security;
alter table public.gp_procedimentos enable row level security;
-- Todos leem; Operações, Gerência e Admin mantêm.
drop policy if exists gp_equip_select on public.gp_equipamentos;
create policy gp_equip_select on public.gp_equipamentos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_equip_write on public.gp_equipamentos;
create policy gp_equip_write on public.gp_equipamentos for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));
drop policy if exists gp_proc_select on public.gp_procedimentos;
create policy gp_proc_select on public.gp_procedimentos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_proc_write on public.gp_procedimentos;
create policy gp_proc_write on public.gp_procedimentos for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));
alter table public.gp_equipamentos add column if not exists fotos jsonb not null default (chr(91)||chr(93))::jsonb;

-- ============================================================================
-- ASP — Checklist de equipamentos levados a campo.
-- Um por etapa (inspeção e execução), pré-carregado pelo procedimento do
-- Catálogo e complementável. Cada item guarda quem conferiu, quando e uma
-- observação (avaria, substituição, número de série).
-- ============================================================================
create table if not exists public.gp_checklist_equipamentos (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references public.gp_inspecoes (id) on delete cascade,
  tipo text not null check (tipo in ('inspecao','execucao')),
  procedimento text,
  itens jsonb not null default '[]'::jsonb,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (inspecao_id, tipo)
);
create index if not exists idx_gp_checklist_inspecao on public.gp_checklist_equipamentos (inspecao_id);

alter table public.gp_checklist_equipamentos enable row level security;
drop policy if exists gp_checklist_select on public.gp_checklist_equipamentos;
create policy gp_checklist_select on public.gp_checklist_equipamentos for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_checklist_write on public.gp_checklist_equipamentos;
create policy gp_checklist_write on public.gp_checklist_equipamentos for all to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'))
  with check (public.gp_perfil_atual_asp() in ('admin','operacoes','gerencia'));

-- ============================================================================
-- ASP — Aviso do cliente: exigências a lembrar antes de ir a campo (crachá,
-- horário de acesso, EPI específico). Vale para TODOS os projetos e inspeções
-- daquele cliente, por isso mora no cadastro do cliente e não no projeto.
-- ============================================================================
alter table public.gp_orgaos add column if not exists avisos text;

-- ============================================================================
-- ASP — Consolidação de colunas que estavam só em SQL avulso:
--   1. gp_orgaos.endereco — endereço da sede; sugerido como "Endereço da
--      obra" ao criar projetos do cliente.
--   2. gp_relatorios.dados — snapshot jsonb do formulário "Gerar Relatório";
--      permite reabrir o rascunho para edição com tudo preenchido.
--   3. gp_relatorios.excluido_em/por — lixeira (soft delete) dos relatórios,
--      mesma lógica de projeto/inspeção/coleta.
-- ============================================================================
alter table public.gp_orgaos add column if not exists endereco text;

alter table public.gp_relatorios add column if not exists dados jsonb;
alter table public.gp_relatorios add column if not exists excluido_em timestamptz;
alter table public.gp_relatorios add column if not exists excluido_por uuid references public.gp_profiles (id);
create index if not exists idx_gp_relatorios_excluido on public.gp_relatorios (excluido_em);

-- ============================================================================
-- ASP — Cadastro do tanque na inspeção.
-- Dimensões, capacidade e material entram uma vez, na criação da inspeção
-- (dentro do projeto), e alimentam a identificação do tanque em todo relatório
-- gerado depois. Antes disso eram redigitados a cada relatório, e o mesmo
-- tanque saía com medidas diferentes de um documento para o outro.
-- Formato do jsonb — comprimentos em METROS, capacidade em M³:
--   { "formato": "circular", "diametro": 12.5, "comprimento": null,
--     "largura": null, "altura": 8, "capacidade": 1500,
--     "material": "Aço carbono" }
-- Inspeções criadas antes disto ficam com tanque nulo: a tela mostra "não
-- cadastrado" e o cadastro é preenchido pelo botão de editar da inspeção.
-- ============================================================================
alter table public.gp_inspecoes add column if not exists tanque jsonb;

-- PostgREST: recarrega o cache do schema (evita "Could not find the column").
notify pgrst, 'reload schema';

-- ============================================================================
-- RELATÓRIO DE VERIFICAÇÃO — tudo deve sair como "OK".
-- ============================================================================
with esperado(tabela, coluna) as (values
  ('gp_orgaos','endereco'), ('gp_orgaos','avisos'),
  ('gp_orgaos','excluido_em'),
  ('gp_orgaos_contatos','nome_completo'),
  ('gp_projetos','endereco'), ('gp_projetos','excluido_em'),
  ('gp_inspecoes','excluido_em'), ('gp_inspecoes','tanque'),
  ('gp_coletas','excluido_em'), ('gp_coletas','aprovada_em'),
  ('gp_relatorios','dados'), ('gp_relatorios','excluido_em'),
  ('gp_equipamentos','especificacoes'), ('gp_equipamentos','fotos'),
  ('gp_procedimentos','metodos'), ('gp_procedimentos','equipamentos'),
  ('gp_checklist_equipamentos','itens'),
  ('gp_push_subscriptions','endpoint')
)
select e.tabela, e.coluna,
  case when c.column_name is not null then 'OK' else '*** FALTANDO ***' end as status
from esperado e
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = e.tabela and c.column_name = e.coluna
order by status desc, e.tabela, e.coluna;
