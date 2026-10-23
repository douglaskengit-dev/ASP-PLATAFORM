-- ============================================================================
-- ASP — Script de GARANTIA do banco (projeto ayqdqwnrgbiqjwjpccuj —
-- https://supabase.com/dashboard/project/ayqdqwnrgbiqjwjpccuj).
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

-- ============================================================================
-- ASP — Coleta de fotos da execução (fase 7).
-- Checklist fotográfico por inspeção: tanque, robô no local, coletas de água
-- antes/depois da limpeza (pH e cloro com valor) e a limpeza (antes, durante
-- e depois — mínimo 3 fotos cada). As fotos entram sozinhas no Relatório de
-- Execução. `agua_potavel` no procedimento define se as coletas de água já
-- nascem marcadas como necessárias; depois a escolha é por inspeção.
-- Itens (jsonb), por vaga:
--   { "tanque_geral":  { "caminho": "fotos-execucao/<id>/tanque_geral/1.jpg", "por": …, "em": … },
--     "agua_antes_ph": { "caminho": …, "valor": 7.2, "por": …, "em": … },
--     "limpeza_antes": [ { "caminho": …, "por": …, "em": … }, … ] }
-- Coleta incompleta só AVISA (ao avançar a fase 7 e no relatório).
-- ============================================================================
alter table public.gp_procedimentos
  add column if not exists agua_potavel boolean not null default false;

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

-- ============================================================================
-- ASP — RDO (Registro Diário de Operação).
-- Um RDO por projeto por dia (cobre uma ou mais inspeções), numerado por
-- projeto (nº 001…), preenchido na Execução e entregue como .docx. Documento
-- separado do Relatório de Execução. Lixeira como as demais tabelas; o dia é
-- único só entre os ativos (índice parcial). Sem RDO, a conclusão da Execução
-- só AVISA.
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

-- ============================================================================
-- ASP — Código do projeto único (Fase 1, validação da abertura).
--
-- O código (NN/INICIAIS/AA, ex.: 37/MG/26) não pode se repetir no sistema,
-- nem com projetos na lixeira. Compara normalizado: sem espaços e em
-- maiúsculas — "37/mg/ 26" = "37/MG/26" (mesma regra de
-- lib/validacao/codigoProjeto.ts; a API já grava normalizado).
--
-- Se o banco JÁ tiver códigos repetidos, o índice não é criado (falharia):
-- sai um NOTICE listando os repetidos e a migração segue. A API continua
-- barrando repetição nova. Corrija os repetidos (editar o projeto) e rode de
-- novo — é idempotente.
-- ============================================================================
do $$
declare
  repetidos text;
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_projetos_codigo_norm') then
    return;
  end if;

  select string_agg(format('%s (%s projetos)', codigo, qtd), ', ')
    into repetidos
  from (
    select upper(regexp_replace(codigo_projeto, '\s', '', 'g')) as codigo, count(*) as qtd
    from public.gp_projetos
    where codigo_projeto is not null
    group by 1
    having count(*) > 1
  ) d;

  if repetidos is not null then
    raise notice 'Índice de código único NÃO criado — códigos repetidos: %', repetidos;
  else
    create unique index uq_gp_projetos_codigo_norm
      on public.gp_projetos (upper(regexp_replace(codigo_projeto, '\s', '', 'g')))
      where codigo_projeto is not null;
  end if;
end $$;

-- ============================================================================
-- ASP — Fase 2: Ordem de Serviço (OS) e agendamento sem ambiguidade.
--
-- 1) Agendamento "data a definir": nasce sem data_visita (já é nullable),
--    com a_definir = true e um "lembrar em" opcional. Ao receber a data,
--    vira agendamento normal (a_definir = false).
-- 2) Remarcação substitui: o agendamento antigo NÃO é apagado — ganha
--    substituido_em/substituido_por e sai das listas ativas, conflitos,
--    notificações e resumos; fica no histórico ("Remarcado de … para …").
--    Ativo = substituido_em is null.
-- 3) Identificação da OS única no projeto (entre as não excluídas), sem
--    acento/caixa/espaço/hífen/sublinhado/ponto — mesma regra de
--    lib/validacao/ordemServico.ts (a API já barra; o índice fecha a
--    corrida). Se o banco JÁ tiver repetidas, o índice não é criado: sai um
--    NOTICE com a lista e a migração segue. Corrija (renomear a OS) e rode
--    de novo — é idempotente.
-- ============================================================================

-- 1) Data a definir
alter table public.gp_agendamentos alter column data_visita drop not null;
alter table public.gp_agendamentos add column if not exists a_definir boolean not null default false;
alter table public.gp_agendamentos add column if not exists lembrar_em date;

-- 2) Remarcação
alter table public.gp_agendamentos add column if not exists substituido_em timestamptz;
alter table public.gp_agendamentos add column if not exists substituido_por uuid
  references public.gp_agendamentos (id) on delete set null;

-- "A definir" nunca tem data.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_a_definir') then
    alter table public.gp_agendamentos
      add constraint ck_gp_agendamentos_a_definir check (not a_definir or data_visita is null);
  end if;
end $$;

-- Conflitos do dia (equipe/equipamento) e avisos do Dashboard leem só os ativos.
create index if not exists idx_gp_agendamentos_data_ativos
  on public.gp_agendamentos (data_visita) where substituido_em is null;
create index if not exists idx_gp_agendamentos_a_definir
  on public.gp_agendamentos (lembrar_em) where a_definir and substituido_em is null;

-- 3) Identificação da OS única no projeto
do $$
declare
  repetidas text;
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_inspecoes_identificacao_norm') then
    return;
  end if;

  select string_agg(format('%s (%s OSs no projeto %s)', ident, qtd, projeto_id), ', ')
    into repetidas
  from (
    select projeto_id,
      lower(regexp_replace(translate(identificacao,
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '[[:space:]._-]+', '', 'g')) as ident,
      count(*) as qtd
    from public.gp_inspecoes
    where excluido_em is null
    group by 1, 2
    having count(*) > 1
  ) d;

  if repetidas is not null then
    raise notice 'Índice de identificação única da OS NÃO criado — repetidas: %', repetidas;
  else
    create unique index uq_gp_inspecoes_identificacao_norm
      on public.gp_inspecoes (projeto_id, lower(regexp_replace(translate(identificacao,
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '[[:space:]._-]+', '', 'g')))
      where excluido_em is null;
  end if;
end $$;


-- ============================================================================
-- ASP — Fase 3: coleta de dados da OS sem ambiguidade nem duplicata.
--
-- 1) gp_coletas ganha:
--    data_coleta     dia da coleta (fuso de Brasília), obrigatório. As
--                    linhas antigas recebem o dia do criado_em.
--    responsavel_id  quem mediu (usuário cadastrado) — medição do medidor.
--    descricao       descrição do anexo (PDF avulso), obrigatória no anexo.
--    dados_hash      SHA-256 da medição normalizada (lib/validacao/medicao.ts
--                    → chaveMedicao); a mesma medição não entra 2x na OS.
--    arquivo_hash    SHA-256 dos bytes do PDF; o mesmo PDF não entra 2x.
--    aprovacao_retirada_em/_por  editar a medição aprovada retira a
--                    aprovação; fica registrado quando e por quem.
-- 2) Dados: coleta 'sedimento' sem medição (dados = {}) e com PDF vira
--    'anexo' com descrição "Anexo (migrado)". Anexo e coleta na lixeira
--    perdem a aprovação (só medição ativa vale para o relatório).
-- 3) Índices únicos (entre as coletas NÃO excluídas):
--    · uma medição aprovada por OS;
--    · mesma medição (dados_hash) / mesmo PDF (arquivo_hash) por OS.
--    Se o banco JÁ tiver duas aprovadas na mesma OS, o índice não é criado:
--    sai um NOTICE com a lista e a migração segue. Corrija (desaprove uma)
--    e rode de novo — é idempotente. Os de hash nascem vazios (colunas
--    novas), mas seguem o mesmo padrão.
-- ============================================================================

-- 1) Colunas
alter table public.gp_coletas add column if not exists data_coleta date;
update public.gp_coletas
  set data_coleta = (criado_em at time zone 'America/Sao_Paulo')::date
  where data_coleta is null;
alter table public.gp_coletas
  alter column data_coleta set default ((now() at time zone 'America/Sao_Paulo')::date);
alter table public.gp_coletas alter column data_coleta set not null;

alter table public.gp_coletas add column if not exists responsavel_id uuid
  references public.gp_profiles (id) on delete set null;
alter table public.gp_coletas add column if not exists descricao text;
alter table public.gp_coletas add column if not exists dados_hash text;
alter table public.gp_coletas add column if not exists arquivo_hash text;
alter table public.gp_coletas add column if not exists aprovacao_retirada_em timestamptz;
alter table public.gp_coletas add column if not exists aprovacao_retirada_por uuid
  references public.gp_profiles (id) on delete set null;

-- 2) Dados
update public.gp_coletas
  set tipo = 'anexo',
      descricao = coalesce(nullif(btrim(descricao), ''), 'Anexo (migrado)')
  where tipo = 'sedimento'
    and (dados is null or dados = '{}'::jsonb)
    and pdf_path is not null;
update public.gp_coletas
  set descricao = 'Anexo (migrado)'
  where tipo = 'anexo' and coalesce(btrim(descricao), '') = '';
update public.gp_coletas
  set aprovada_em = null, aprovada_por = null
  where aprovada_em is not null and (tipo = 'anexo' or excluido_em is not null);

-- Anexo sempre com descrição.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_coletas_anexo_descricao') then
    alter table public.gp_coletas
      add constraint ck_gp_coletas_anexo_descricao check (tipo <> 'anexo' or coalesce(btrim(descricao), '') <> '');
  end if;
end $$;

create index if not exists idx_gp_coletas_inspecao_ativas
  on public.gp_coletas (inspecao_id) where excluido_em is null;

-- 3) Índices únicos
do $$
declare
  repetidas text;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_aprovada_por_os') then
    select string_agg(format('OS %s (%s aprovadas)', inspecao_id, qtd), ', ')
      into repetidas
    from (
      select inspecao_id, count(*) as qtd
      from public.gp_coletas
      where aprovada_em is not null and excluido_em is null
      group by 1 having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "uma medição aprovada por OS" NÃO criado — OSs com mais de uma aprovada: %', repetidas;
    else
      create unique index uq_gp_coletas_aprovada_por_os
        on public.gp_coletas (inspecao_id) where aprovada_em is not null and excluido_em is null;
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_dados_hash') then
    select string_agg(format('OS %s', inspecao_id), ', ') into repetidas
    from (
      select inspecao_id from public.gp_coletas
      where dados_hash is not null and excluido_em is null
      group by inspecao_id, dados_hash having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "medição única por OS" NÃO criado — medições repetidas em: %', repetidas;
    else
      create unique index uq_gp_coletas_dados_hash
        on public.gp_coletas (inspecao_id, dados_hash) where dados_hash is not null and excluido_em is null;
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_arquivo_hash') then
    select string_agg(format('OS %s', inspecao_id), ', ') into repetidas
    from (
      select inspecao_id from public.gp_coletas
      where arquivo_hash is not null and excluido_em is null
      group by inspecao_id, arquivo_hash having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "PDF único por OS" NÃO criado — PDFs repetidos em: %', repetidas;
    else
      create unique index uq_gp_coletas_arquivo_hash
        on public.gp_coletas (inspecao_id, arquivo_hash) where arquivo_hash is not null and excluido_em is null;
    end if;
  end if;
end $$;

-- ============================================================================
-- ASP — Fase 4: relatório de inspeção/execução sem ambiguidade nem duplicata.
--
-- 1) gp_relatorios ganha:
--    arquivo_hash    SHA-256 dos bytes do arquivo (PDF/DOCX). O mesmo arquivo
--                    não entra 2x na mesma OS. Linhas antigas ficam null.
--    substituido_em/_por  uma versão nova enviada enquanto outra estava em
--                    aprovação SUBSTITUI a anterior: ela vira 'substituido'
--                    (sai da fila da Gerência) e aponta para a nova.
-- 2) status aceita 'substituido'.
-- 3) Índices únicos (entre os relatórios NÃO excluídos):
--    · (OS, tipo, versão)           — a versão é calculada uma vez, no insert;
--    · um rascunho por (OS, tipo)   — gerar de novo atualiza o mesmo;
--    · um em aprovação por (OS, tipo);
--    · mesmo arquivo (hash) por OS.
--    Se o banco JÁ tiver dados que violam um índice, ele NÃO é criado: sai um
--    NOTICE com a lista e a migração segue. Corrija (exclua o rascunho a mais,
--    reprove/aprove a versão antiga…) e rode de novo — é idempotente.
--    Nenhum dado existente é alterado por esta migração.
-- ============================================================================

-- 1) Colunas
alter table public.gp_relatorios add column if not exists arquivo_hash text;
alter table public.gp_relatorios add column if not exists substituido_em timestamptz;
alter table public.gp_relatorios add column if not exists substituido_por uuid
  references public.gp_relatorios (id) on delete set null;

-- 2) Status 'substituido' (o check original não tem nome próprio: troca
--    qualquer check de status da tabela pelo nomeado abaixo).
do $$
declare
  c record;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_status') then
    for c in
      select conname from pg_constraint
      where conrelid = 'public.gp_relatorios'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.gp_relatorios drop constraint %I', c.conname);
    end loop;
    alter table public.gp_relatorios add constraint ck_gp_relatorios_status
      check (status in ('rascunho', 'em_aprovacao', 'aprovado', 'ajustar', 'assinado', 'substituido'));
  end if;
end $$;

create index if not exists idx_gp_relatorios_inspecao_ativos
  on public.gp_relatorios (inspecao_id, tipo) where excluido_em is null;

-- 3) Índices únicos
do $$
declare
  repetidas text;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_versao') then
    select string_agg(format('OS %s %s v%s (%s linhas)', inspecao_id, tipo, versao, qtd), ', ') into repetidas
    from (
      select inspecao_id, tipo, versao, count(*) as qtd from public.gp_relatorios
      where excluido_em is null group by 1, 2, 3 having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "versão única por OS/tipo" NÃO criado — versões repetidas: %', repetidas;
    else
      create unique index uq_gp_relatorios_versao
        on public.gp_relatorios (inspecao_id, tipo, versao) where excluido_em is null;
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_rascunho') then
    select string_agg(format('OS %s %s (%s rascunhos)', inspecao_id, tipo, qtd), ', ') into repetidas
    from (
      select inspecao_id, tipo, count(*) as qtd from public.gp_relatorios
      where excluido_em is null and status = 'rascunho' group by 1, 2 having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "um rascunho por OS/tipo" NÃO criado — mais de um rascunho em: %', repetidas;
    else
      create unique index uq_gp_relatorios_rascunho
        on public.gp_relatorios (inspecao_id, tipo) where excluido_em is null and status = 'rascunho';
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_em_aprovacao') then
    select string_agg(format('OS %s %s (%s em aprovação)', inspecao_id, tipo, qtd), ', ') into repetidas
    from (
      select inspecao_id, tipo, count(*) as qtd from public.gp_relatorios
      where excluido_em is null and status = 'em_aprovacao' group by 1, 2 having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "um relatório em aprovação por OS/tipo" NÃO criado — mais de um em aprovação em: %', repetidas;
    else
      create unique index uq_gp_relatorios_em_aprovacao
        on public.gp_relatorios (inspecao_id, tipo) where excluido_em is null and status = 'em_aprovacao';
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_arquivo_hash') then
    select string_agg(format('OS %s', inspecao_id), ', ') into repetidas
    from (
      select inspecao_id from public.gp_relatorios
      where arquivo_hash is not null and excluido_em is null
      group by inspecao_id, arquivo_hash having count(*) > 1
    ) d;
    if repetidas is not null then
      raise notice 'Índice "arquivo único por OS" NÃO criado — arquivos repetidos em: %', repetidas;
    else
      create unique index uq_gp_relatorios_arquivo_hash
        on public.gp_relatorios (inspecao_id, arquivo_hash) where arquivo_hash is not null and excluido_em is null;
    end if;
  end if;
end $$;

-- ============================================================================
-- ASP — Fases 5/9: aprovação do relatório sem ambiguidade nem duplicata, e a
-- versão ASSINADA do relatório.
--
-- 1) gp_relatorios ganha:
--    motivo_categoria   categoria da reprovação (Dados incorretos, Fotos,
--                       Texto/redação, Medição, Formatação, Outro).
--    avaliado_por/_em   quem aprovou OU reprovou, e quando (aprovado_por
--                       continua só para a aprovação).
--    assinado_path/_hash/_por/_em  a versão assinada (PDF) do relatório
--                       aprovado — o documento final. status → 'assinado'.
-- 2) gp_fase_historico ganha:
--    motivo_categoria   mesma categoria, no histórico da reprovação.
--    relatorio_id       relatório avaliado/assinado naquela movimentação.
--    chave_idempotencia Idempotency-Key do envio (fila offline / duplo
--                       clique): única — a mesma ação não entra 2x.
-- 3) gp_inspecoes.cadastro_atualizado_em: quando TAG, procedimento ou tanque
--    mudaram (aviso "a OS mudou depois do envio do relatório").
-- 4) gp_relatorio_visualizacoes(relatorio_id, usuario_id, em): quem já
--    baixou cada versão (aviso "aprovar sem ter aberto o arquivo"). Gravada
--    pela rota de download (chave de serviço).
-- 5) Checks: categoria na lista; status 'assinado' só com o arquivo
--    assinado; a mesma versão assinada (hash) uma vez por OS.
--    Se o banco JÁ tiver dados que violam um check/índice, ele NÃO é criado:
--    sai um NOTICE e a migração segue. Corrija e rode de novo (idempotente).
--    Nenhum dado existente é alterado por esta migração.
-- ============================================================================

-- 1) gp_relatorios
alter table public.gp_relatorios add column if not exists motivo_categoria text;
alter table public.gp_relatorios add column if not exists avaliado_por uuid references public.gp_profiles (id);
alter table public.gp_relatorios add column if not exists avaliado_em timestamptz;
alter table public.gp_relatorios add column if not exists assinado_path text;
alter table public.gp_relatorios add column if not exists assinado_hash text;
alter table public.gp_relatorios add column if not exists assinado_por uuid references public.gp_profiles (id);
alter table public.gp_relatorios add column if not exists assinado_em timestamptz;

-- 2) gp_fase_historico
alter table public.gp_fase_historico add column if not exists motivo_categoria text;
alter table public.gp_fase_historico add column if not exists relatorio_id uuid
  references public.gp_relatorios (id) on delete set null;
alter table public.gp_fase_historico add column if not exists chave_idempotencia uuid;
create unique index if not exists uq_gp_fase_historico_chave
  on public.gp_fase_historico (chave_idempotencia) where chave_idempotencia is not null;

-- 3) gp_inspecoes
alter table public.gp_inspecoes add column if not exists cadastro_atualizado_em timestamptz;

-- 4) Visualizações (downloads) por usuário e versão
create table if not exists public.gp_relatorio_visualizacoes (
  id uuid primary key default gen_random_uuid(),
  relatorio_id uuid not null references public.gp_relatorios (id) on delete cascade,
  usuario_id uuid not null references public.gp_profiles (id) on delete cascade,
  em timestamptz not null default now(),
  unique (relatorio_id, usuario_id)
);
alter table public.gp_relatorio_visualizacoes enable row level security;
drop policy if exists gp_relatorio_visualizacoes_select on public.gp_relatorio_visualizacoes;
create policy gp_relatorio_visualizacoes_select on public.gp_relatorio_visualizacoes for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_relatorio_visualizacoes_insert on public.gp_relatorio_visualizacoes;
create policy gp_relatorio_visualizacoes_insert on public.gp_relatorio_visualizacoes for insert to authenticated
  with check (usuario_id = auth.uid() and public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_relatorio_visualizacoes_update on public.gp_relatorio_visualizacoes;
create policy gp_relatorio_visualizacoes_update on public.gp_relatorio_visualizacoes for update to authenticated
  using (usuario_id = auth.uid());

-- 5) Checks e índice
do $$
declare
  qtd int;
  lista text;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_motivo_categoria') then
    alter table public.gp_relatorios add constraint ck_gp_relatorios_motivo_categoria
      check (motivo_categoria is null or motivo_categoria in ('dados_incorretos', 'fotos', 'texto', 'medicao', 'formatacao', 'outro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_fase_historico_motivo_categoria') then
    alter table public.gp_fase_historico add constraint ck_gp_fase_historico_motivo_categoria
      check (motivo_categoria is null or motivo_categoria in ('dados_incorretos', 'fotos', 'texto', 'medicao', 'formatacao', 'outro'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_assinado_arquivo') then
    select count(*), string_agg(format('OS %s %s v%s', inspecao_id, tipo, versao), ', ') into qtd, lista
    from public.gp_relatorios where status = 'assinado' and assinado_path is null;
    if qtd > 0 then
      raise notice 'Check "assinado só com arquivo assinado" NÃO criado — % relatório(s) com status assinado sem o arquivo: %. Envie a versão assinada (ou volte o status para aprovado) e rode de novo.', qtd, lista;
    else
      alter table public.gp_relatorios add constraint ck_gp_relatorios_assinado_arquivo
        check (status <> 'assinado' or assinado_path is not null);
    end if;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_assinado_hash') then
    select string_agg(format('OS %s', inspecao_id), ', ') into lista
    from (
      select inspecao_id from public.gp_relatorios
      where assinado_hash is not null and excluido_em is null
      group by inspecao_id, assinado_hash having count(*) > 1
    ) d;
    if lista is not null then
      raise notice 'Índice "versão assinada única por OS" NÃO criado — arquivos assinados repetidos em: %', lista;
    else
      create unique index uq_gp_relatorios_assinado_hash
        on public.gp_relatorios (inspecao_id, assinado_hash) where assinado_hash is not null and excluido_em is null;
    end if;
  end if;
end $$;

-- ============================================================================
-- ASP — Fase 6: agendamento da EXECUÇÃO sem ambiguidade.
--
-- 1) gp_agendamentos.data_fim (date, opcional): a execução pode durar vários
--    dias — data_visita = início, data_fim = último dia (null = um dia só).
--    Só a execução tem período; a inspeção continua de um dia.
-- 2) Checks: data_fim ≥ data_visita; data_fim só em execução; "a definir"
--    também sem data_fim. Se o banco JÁ tiver linhas que violam, o check NÃO
--    é criado: sai um NOTICE com a lista e a migração segue. Corrija e rode
--    de novo (idempotente). Nenhum dado existente é alterado.
-- 3) Uma execução ATIVA (não substituída, com data) por OS. A remarcação já
--    substitui a anterior do mesmo tipo (Fase 2), então dois períodos ativos
--    sobrepostos na mesma OS não deveriam existir; o índice fecha a corrida
--    (dois envios ao mesmo tempo). A API tira a anterior de cena ANTES de
--    gravar a nova, para o índice não barrar a remarcação legítima.
--    (Exclusion constraint com daterange exigiria btree_gist — dispensável:
--    uma ativa por OS já impede qualquer sobreposição.)
-- 4) Índice para os conflitos por período (equipe/equipamento em outro local).
-- ============================================================================

-- 1) Período da execução
alter table public.gp_agendamentos add column if not exists data_fim date;

-- 2) Checks
do $$
declare
  qtd int;
  lista text;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_data_fim') then
    select count(*), string_agg(format('%s (OS %s: %s → %s)', id, inspecao_id, data_visita, data_fim), ', ') into qtd, lista
    from public.gp_agendamentos
    where data_fim is not null and (data_visita is null or data_fim < data_visita);
    if qtd > 0 then
      raise notice 'Check "data_fim ≥ data_visita" NÃO criado — % agendamento(s) com fim antes do início (ou sem início): %. Corrija as datas e rode de novo.', qtd, lista;
    else
      alter table public.gp_agendamentos add constraint ck_gp_agendamentos_data_fim
        check (data_fim is null or (data_visita is not null and data_fim >= data_visita));
    end if;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_data_fim_execucao') then
    select count(*), string_agg(format('%s (OS %s, %s)', id, inspecao_id, tipo), ', ') into qtd, lista
    from public.gp_agendamentos
    where data_fim is not null and (tipo <> 'execucao' or a_definir);
    if qtd > 0 then
      raise notice 'Check "período só na execução" NÃO criado — % agendamento(s) de inspeção/a definir com data_fim: %. Limpe a data_fim e rode de novo.', qtd, lista;
    else
      alter table public.gp_agendamentos add constraint ck_gp_agendamentos_data_fim_execucao
        check (data_fim is null or (tipo = 'execucao' and not a_definir));
    end if;
  end if;
end $$;

-- 3) Uma execução ativa (com data) por OS
do $$
declare
  lista text;
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_agendamentos_execucao_ativa') then
    return;
  end if;
  select string_agg(format('OS %s (%s ativas)', inspecao_id, qtd), ', ') into lista
  from (
    select inspecao_id, count(*) as qtd
    from public.gp_agendamentos
    where tipo = 'execucao' and substituido_em is null and not a_definir
    group by inspecao_id
    having count(*) > 1
  ) d;
  if lista is not null then
    raise notice 'Índice "uma execução ativa por OS" NÃO criado — OSs com mais de um agendamento de execução ativo: %. Remarque/exclua os excedentes e rode de novo.', lista;
  else
    create unique index uq_gp_agendamentos_execucao_ativa
      on public.gp_agendamentos (inspecao_id)
      where tipo = 'execucao' and substituido_em is null and not a_definir;
  end if;
end $$;

-- 4) Conflitos por período
create index if not exists idx_gp_agendamentos_periodo_ativos
  on public.gp_agendamentos (data_visita, data_fim) where substituido_em is null;

-- ============================================================================
-- ASP — Fase 7: unidade e limite de aviso do cloro livre por procedimento.
--
-- 1) gp_procedimentos.cloro_unidade ('mg/L' | 'PPM', padrão 'mg/L'): a
--    unidade escolhida aparece em todo lugar onde o valor do cloro é
--    mostrado ou escrito — card da coleta de fotos, frase do RDO (CVS 6) e
--    legendas/valores do Relatório de Execução.
-- 2) gp_procedimentos.cloro_limite_aviso (numeric > 0, padrão 5): acima dele
--    a coleta de fotos AVISA (não bloqueia) — valor alto demais costuma ser
--    erro de digitação.
-- Idempotente; nenhum dado existente é alterado (as linhas antigas recebem
-- os padrões). Hash e data de captura das fotos (gp_fotos_execucao.itens) e
-- os campos novos do RDO (gp_rdos.dados) vivem no jsonb — sem coluna nova.
-- ============================================================================

alter table public.gp_procedimentos add column if not exists cloro_unidade text not null default 'mg/L';
alter table public.gp_procedimentos add column if not exists cloro_limite_aviso numeric not null default 5;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_procedimentos_cloro_unidade') then
    alter table public.gp_procedimentos add constraint ck_gp_procedimentos_cloro_unidade
      check (cloro_unidade in ('mg/L', 'PPM'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_procedimentos_cloro_limite_aviso') then
    alter table public.gp_procedimentos add constraint ck_gp_procedimentos_cloro_limite_aviso
      check (cloro_limite_aviso > 0);
  end if;
end $$;


-- ============================================================================
-- ASP — Fase 9: categoria de reprovação "Laudo/Laboratório" ('laudo').
--
-- Os checks da categoria (gp_relatorios e gp_fase_historico, criados na
-- migração das Fases 5/9) passam a aceitar 'laudo'. Ela só é oferecida — e
-- aceita pela API — ao reprovar o relatório de EXECUÇÃO (fase 9); o banco
-- aceita o valor nas duas tabelas e a regra por tipo fica na API.
-- Idempotente: derruba e recria os dois checks com a lista nova (só amplia a
-- lista — nenhuma linha existente passa a violar). Nenhum dado é alterado.
-- ============================================================================

do $$
begin
  alter table public.gp_relatorios drop constraint if exists ck_gp_relatorios_motivo_categoria;
  alter table public.gp_relatorios add constraint ck_gp_relatorios_motivo_categoria
    check (motivo_categoria is null or motivo_categoria in ('dados_incorretos', 'fotos', 'texto', 'medicao', 'laudo', 'formatacao', 'outro'));

  alter table public.gp_fase_historico drop constraint if exists ck_gp_fase_historico_motivo_categoria;
  alter table public.gp_fase_historico add constraint ck_gp_fase_historico_motivo_categoria
    check (motivo_categoria is null or motivo_categoria in ('dados_incorretos', 'fotos', 'texto', 'medicao', 'laudo', 'formatacao', 'outro'));
end $$;

-- ============================================================================
-- ASP — Fase 10: ENCERRAMENTO da OS, ENTREGA ao cliente e conclusão do
-- projeto.
--
-- 1) gp_inspecoes ganha o encerramento:
--    encerrada_em               data do encerramento (Brasília) — null = aberta
--    encerrada_por              quem encerrou
--    encerramento_manual        true = encerrada ignorando pendências
--                               (Admin/Gerência)
--    encerramento_justificativa justificativa do encerramento manual
--    encerramento_pendencias    jsonb: lista (texto) das pendências ignoradas
--    Check: encerrada só com quem encerrou; manual só com justificativa.
-- 2) gp_fase_historico.acao passa a aceitar 'encerrar' e 'reabrir' (além de
--    'avancar', 'aprovar', 'reprovar', 'assinar'). O check original foi
--    criado inline (nome gerado pelo Postgres, normalmente
--    gp_fase_historico_acao_check): todo check de gp_fase_historico que
--    fale de "acao" é derrubado e recriado como ck_gp_fase_historico_acao.
-- 3) gp_projetos ganha concluido_em / concluido_automaticamente: preenchidos
--    pela API quando a última OS ativa do projeto é encerrada; limpos ao
--    reabrir, criar ou restaurar uma OS.
-- 4) gp_entregas: registro da entrega ao cliente (os arquivos vão por fora —
--    e-mail, impresso, pendrive…). Soft delete. RLS: leitura para os perfis
--    ASP; escrita Admin/Gerência/Comercial.
--
-- Backfill: NENHUM. OSs que já estão na fase 10 continuam "não encerradas"
-- até alguém encerrar pela tela; nenhum projeto é marcado como concluído
-- por esta migração.
-- Idempotente: pode rodar de novo. Se o banco já tiver dados que violam um
-- check novo, ele NÃO é criado: sai um NOTICE e a migração segue.
-- ============================================================================

-- 1) gp_inspecoes
alter table public.gp_inspecoes add column if not exists encerrada_em date;
alter table public.gp_inspecoes add column if not exists encerrada_por uuid references public.gp_profiles (id);
alter table public.gp_inspecoes add column if not exists encerramento_manual boolean not null default false;
alter table public.gp_inspecoes add column if not exists encerramento_justificativa text;
alter table public.gp_inspecoes add column if not exists encerramento_pendencias jsonb;
create index if not exists idx_gp_inspecoes_encerrada on public.gp_inspecoes (projeto_id) where encerrada_em is not null;

do $$
declare
  qtd int;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_inspecoes_encerramento') then
    select count(*) into qtd from public.gp_inspecoes
     where (encerrada_em is not null and encerrada_por is null)
        or (encerramento_manual and coalesce(btrim(encerramento_justificativa), '') = '');
    if qtd = 0 then
      alter table public.gp_inspecoes add constraint ck_gp_inspecoes_encerramento
        check ((encerrada_em is null or encerrada_por is not null)
           and (not encerramento_manual or coalesce(btrim(encerramento_justificativa), '') <> ''));
    else
      raise notice 'gp_inspecoes: % OS(s) com encerramento incompleto — check ck_gp_inspecoes_encerramento NÃO criado. Corrija e rode de novo.', qtd;
    end if;
  end if;
end $$;

-- 2) gp_fase_historico.acao
do $$
declare
  c record;
  qtd int;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.gp_fase_historico'::regclass
       and contype = 'c'
       and conname <> 'ck_gp_fase_historico_acao'
       and pg_get_constraintdef(oid) ilike '%acao%'
       and pg_get_constraintdef(oid) not ilike '%motivo_categoria%'
  loop
    execute format('alter table public.gp_fase_historico drop constraint %I', c.conname);
    raise notice 'gp_fase_historico: check % derrubado (recriado como ck_gp_fase_historico_acao).', c.conname;
  end loop;

  select count(*) into qtd from public.gp_fase_historico
   where acao not in ('avancar', 'aprovar', 'reprovar', 'assinar', 'encerrar', 'reabrir');
  if qtd > 0 then
    raise notice 'gp_fase_historico: % linha(s) com ação fora da lista — check ck_gp_fase_historico_acao NÃO criado.', qtd;
  else
    alter table public.gp_fase_historico drop constraint if exists ck_gp_fase_historico_acao;
    alter table public.gp_fase_historico add constraint ck_gp_fase_historico_acao
      check (acao in ('avancar', 'aprovar', 'reprovar', 'assinar', 'encerrar', 'reabrir'));
  end if;
end $$;

-- 3) gp_projetos
alter table public.gp_projetos add column if not exists concluido_em timestamptz;
alter table public.gp_projetos add column if not exists concluido_automaticamente boolean not null default false;

-- 4) gp_entregas
create table if not exists public.gp_entregas (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references public.gp_inspecoes (id) on delete cascade,
  data date not null,
  contato_id uuid references public.gp_orgaos_contatos (id) on delete set null,
  contato_nome text,                                     -- nome no momento da entrega
  meio text not null,
  meio_outro text,
  arquivos jsonb not null default '[]'::jsonb,           -- [{chave, tipo, id, caminho, nome, hash, data}]
  observacao text,
  criado_por uuid references public.gp_profiles (id),
  criado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references public.gp_profiles (id)
);
create index if not exists idx_gp_entregas_inspecao_id on public.gp_entregas (inspecao_id);
create index if not exists idx_gp_entregas_contato_id on public.gp_entregas (contato_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_entregas_meio') then
    alter table public.gp_entregas add constraint ck_gp_entregas_meio
      check (meio in ('email', 'impresso', 'pendrive', 'outro')
         and (meio <> 'outro' or coalesce(btrim(meio_outro), '') <> ''));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_entregas_arquivos') then
    alter table public.gp_entregas add constraint ck_gp_entregas_arquivos
      check (jsonb_typeof(arquivos) = 'array' and jsonb_array_length(arquivos) > 0);
  end if;
end $$;

alter table public.gp_entregas enable row level security;
drop policy if exists gp_entregas_select on public.gp_entregas;
create policy gp_entregas_select on public.gp_entregas for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_entregas_insert on public.gp_entregas;
create policy gp_entregas_insert on public.gp_entregas for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin', 'gerencia', 'comercial'));
drop policy if exists gp_entregas_update on public.gp_entregas;
create policy gp_entregas_update on public.gp_entregas for update to authenticated
  using (public.gp_perfil_atual_asp() in ('admin', 'gerencia', 'comercial'));
drop policy if exists gp_entregas_delete on public.gp_entregas;
create policy gp_entregas_delete on public.gp_entregas for delete to authenticated
  using (public.gp_perfil_atual_asp() = 'admin');

-- ============================================================================
-- ASP — Catálogo sem dado ambíguo ou duplicado (procedimentos e equipamentos).
--
-- 1) Chaves de comparação (funções imutáveis, usadas pelos índices e pela
--    API — lib/validacao/catalogo.ts faz a MESMA conta em TypeScript):
--      gp_chave_codigo(t)  minúsculo, sem acento, sem espaço nem pontuação
--                          ("PO 011" = "PO011" = "po-011")
--      gp_chave_nome(t)    minúsculo, sem acento, espaços colapsados
-- 2) Índices únicos pela chave:
--      uq_gp_procedimentos_codigo_chave   código do procedimento
--      uq_gp_procedimentos_nome_chave     nome do procedimento
--      uq_gp_equipamentos_nome_chave      nome do equipamento
--    Se o banco JÁ TEM itens que colidem, o índice NÃO é criado: sai um
--    NOTICE por grupo, listando os itens. Renomeie (ou exclua/desative) no
--    Catálogo e rode de novo. A API confere do mesmo jeito enquanto isso.
-- 3) Desativar em vez de excluir item em uso: ativo / desativado_em /
--    desativado_por nas duas tabelas. atualizado_em já existe (versão para
--    a checagem de "outra pessoa salvou"); garantido aqui por segurança.
-- 4) gp_renomear_procedimento(id, antigo, novo, versao): troca o código e
--    leva a troca, na MESMA transação, para gp_inspecoes.procedimento,
--    gp_checklist_equipamentos.procedimento e o snapshot dos RASCUNHOS de
--    relatório (gp_relatorios.dados->d->procedimento). Relatórios enviados,
--    aprovados e assinados ficam como estão — são documentos históricos.
--    gp_renomear_equipamento(id, antigo, novo, versao): troca o nome (o slug
--    não muda) e atualiza o nome nos checklists (itens com o mesmo slug, OS
--    não encerrada) e nos agendamentos ativos de hoje em diante / a definir.
--    gp_uso_catalogo(tipo, id): quantas referências o item tem (confirmação
--    do renomear e decisão excluir × desativar).
--    As três só podem ser chamadas pela chave de serviço (API).
--
-- Backfill: NENHUM. Todos os itens existentes ficam ativos; slugs, códigos e
-- nomes não são alterados.
-- Idempotente: pode rodar de novo.
-- ============================================================================

-- 1) Chaves
create or replace function public.gp_chave_codigo(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(
    lower(translate(coalesce(t, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
    '[^a-z0-9]', '', 'g')
$$;

create or replace function public.gp_chave_nome(t text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(t, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
    '\s+', ' ', 'g'))
$$;

-- 3) Colunas
alter table public.gp_procedimentos add column if not exists ativo boolean not null default true;
alter table public.gp_procedimentos add column if not exists desativado_em timestamptz;
alter table public.gp_procedimentos add column if not exists desativado_por uuid references public.gp_profiles (id);
alter table public.gp_procedimentos add column if not exists atualizado_em timestamptz not null default now();
alter table public.gp_equipamentos add column if not exists ativo boolean not null default true;
alter table public.gp_equipamentos add column if not exists desativado_em timestamptz;
alter table public.gp_equipamentos add column if not exists desativado_por uuid references public.gp_profiles (id);
alter table public.gp_equipamentos add column if not exists atualizado_em timestamptz not null default now();

-- 2) Índices únicos pela chave (NOTICE com os conflitos, se houver)
do $$
declare
  g record;
  qtd int;
begin
  -- código do procedimento
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_procedimentos_codigo_chave') then
    qtd := 0;
    for g in
      select public.gp_chave_codigo(codigo) as chave,
             string_agg(format('"%s" (%s)', codigo, nome), ', ' order by codigo) as itens
        from public.gp_procedimentos
       where public.gp_chave_codigo(codigo) <> ''
       group by 1 having count(*) > 1
    loop
      qtd := qtd + 1;
      raise notice 'gp_procedimentos: códigos que são o MESMO código (chave "%"): %', g.chave, g.itens;
    end loop;
    if qtd = 0 then
      create unique index uq_gp_procedimentos_codigo_chave
        on public.gp_procedimentos (public.gp_chave_codigo(codigo)) where public.gp_chave_codigo(codigo) <> '';
    else
      raise notice 'gp_procedimentos: % grupo(s) de códigos repetidos — índice uq_gp_procedimentos_codigo_chave NÃO criado. Renomeie no Catálogo (o renomear leva o código novo às OSs) e rode de novo.', qtd;
    end if;
  end if;

  -- nome do procedimento
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_procedimentos_nome_chave') then
    qtd := 0;
    for g in
      select public.gp_chave_nome(nome) as chave,
             string_agg(format('"%s" (%s)', nome, codigo), ', ' order by codigo) as itens
        from public.gp_procedimentos
       where public.gp_chave_nome(nome) <> ''
       group by 1 having count(*) > 1
    loop
      qtd := qtd + 1;
      raise notice 'gp_procedimentos: nomes repetidos (chave "%"): %', g.chave, g.itens;
    end loop;
    if qtd = 0 then
      create unique index uq_gp_procedimentos_nome_chave
        on public.gp_procedimentos (public.gp_chave_nome(nome)) where public.gp_chave_nome(nome) <> '';
    else
      raise notice 'gp_procedimentos: % grupo(s) de nomes repetidos — índice uq_gp_procedimentos_nome_chave NÃO criado. Renomeie no Catálogo e rode de novo.', qtd;
    end if;
  end if;

  -- nome do equipamento
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_equipamentos_nome_chave') then
    qtd := 0;
    for g in
      select public.gp_chave_nome(nome) as chave,
             string_agg(format('"%s" (slug %s)', nome, slug), ', ' order by slug) as itens
        from public.gp_equipamentos
       where public.gp_chave_nome(nome) <> ''
       group by 1 having count(*) > 1
    loop
      qtd := qtd + 1;
      raise notice 'gp_equipamentos: nomes repetidos (chave "%"): %', g.chave, g.itens;
    end loop;
    if qtd = 0 then
      create unique index uq_gp_equipamentos_nome_chave
        on public.gp_equipamentos (public.gp_chave_nome(nome)) where public.gp_chave_nome(nome) <> '';
    else
      raise notice 'gp_equipamentos: % grupo(s) de nomes repetidos — índice uq_gp_equipamentos_nome_chave NÃO criado. Renomeie no Catálogo e rode de novo.', qtd;
    end if;
  end if;

  -- Itens sem código / sem nome não entram nos índices, mas a API já não
  -- aceita salvar assim: avisa para corrigir.
  select count(*) into qtd from public.gp_procedimentos
   where public.gp_chave_codigo(codigo) = '' or public.gp_chave_nome(nome) = '';
  if qtd > 0 then
    raise notice 'gp_procedimentos: % procedimento(s) sem código ou sem nome — complete no Catálogo.', qtd;
  end if;
  select count(*) into qtd from public.gp_equipamentos where public.gp_chave_nome(nome) = '';
  if qtd > 0 then
    raise notice 'gp_equipamentos: % equipamento(s) sem nome — complete no Catálogo.', qtd;
  end if;
end $$;

-- 4) Funções da API
create or replace function public.gp_renomear_procedimento(
  p_id uuid, p_antigo text, p_novo text, p_versao timestamptz
) returns jsonb
language plpgsql as $$
declare
  v_versao timestamptz;
  n_os int := 0;
  n_check int := 0;
  n_rasc int := 0;
begin
  if coalesce(btrim(p_novo), '') = '' then
    raise exception 'gp_catalogo: código novo vazio';
  end if;
  update public.gp_procedimentos
     set codigo = p_novo, atualizado_em = now()
   where id = p_id and codigo = p_antigo and atualizado_em = p_versao
   returning atualizado_em into v_versao;
  if not found then
    raise exception 'gp_catalogo_versao' using hint = 'O procedimento mudou desde que foi aberto.';
  end if;
  if p_novo is distinct from p_antigo then
    update public.gp_inspecoes set procedimento = p_novo where procedimento = p_antigo;
    get diagnostics n_os = row_count;
    update public.gp_checklist_equipamentos set procedimento = p_novo where procedimento = p_antigo;
    get diagnostics n_check = row_count;
    update public.gp_relatorios
       set dados = jsonb_set(dados, '{d,procedimento}', to_jsonb(p_novo))
     where excluido_em is null and status = 'rascunho'
       and jsonb_typeof(dados -> 'd') = 'object'
       and dados -> 'd' ->> 'procedimento' = p_antigo;
    get diagnostics n_rasc = row_count;
  end if;
  return jsonb_build_object('versao', v_versao, 'oss', n_os, 'checklists', n_check, 'rascunhos', n_rasc);
end $$;

create or replace function public.gp_renomear_equipamento(
  p_id uuid, p_antigo text, p_novo text, p_versao timestamptz
) returns jsonb
language plpgsql as $$
declare
  v_versao timestamptz;
  v_slug text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  n_check int := 0;
  n_ag int := 0;
begin
  if coalesce(btrim(p_novo), '') = '' then
    raise exception 'gp_catalogo: nome novo vazio';
  end if;
  update public.gp_equipamentos
     set nome = p_novo, atualizado_em = now()
   where id = p_id and nome = p_antigo and atualizado_em = p_versao
   returning atualizado_em, slug into v_versao, v_slug;
  if not found then
    raise exception 'gp_catalogo_versao' using hint = 'O equipamento mudou desde que foi aberto.';
  end if;
  if p_novo is distinct from p_antigo then
    -- Checklists: item com o mesmo slug, em OS ainda não encerrada.
    update public.gp_checklist_equipamentos c
       set itens = (
         select jsonb_agg(case when it ->> 'slug' = v_slug then jsonb_set(it, '{nome}', to_jsonb(p_novo)) else it end order by ord)
           from jsonb_array_elements(c.itens) with ordinality as x(it, ord))
     where jsonb_typeof(c.itens) = 'array'
       and c.itens @> jsonb_build_array(jsonb_build_object('slug', v_slug))
       and not exists (select 1 from public.gp_inspecoes i where i.id = c.inspecao_id and i.encerrada_em is not null);
    get diagnostics n_check = row_count;
    -- Agendamentos ativos (não substituídos) de hoje em diante ou a definir.
    -- Os passados são histórico e ficam com o nome que tinham.
    update public.gp_agendamentos a
       set equipamentos = (
         select jsonb_agg(case when jsonb_typeof(e) = 'string' and public.gp_chave_nome(e #>> '{}') = public.gp_chave_nome(p_antigo)
                               then to_jsonb(p_novo) else e end order by ord)
           from jsonb_array_elements(a.equipamentos) with ordinality as x(e, ord))
     where jsonb_typeof(a.equipamentos) = 'array'
       and a.substituido_em is null
       and (a.a_definir or a.data_visita >= v_hoje)
       and exists (select 1 from jsonb_array_elements(a.equipamentos) e
                    where jsonb_typeof(e) = 'string' and public.gp_chave_nome(e #>> '{}') = public.gp_chave_nome(p_antigo));
    get diagnostics n_ag = row_count;
  end if;
  return jsonb_build_object('versao', v_versao, 'checklists', n_check, 'agendamentos', n_ag);
end $$;

create or replace function public.gp_uso_catalogo(p_tipo text, p_id uuid) returns jsonb
language plpgsql stable as $$
declare
  v_codigo text;
  v_slug text;
  v_nome text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
begin
  if p_tipo = 'procedimento' then
    select codigo into v_codigo from public.gp_procedimentos where id = p_id;
    if not found then return null; end if;
    select jsonb_build_object(
      'oss', (select count(*) from public.gp_inspecoes where procedimento = v_codigo and excluido_em is null),
      'ossLixeira', (select count(*) from public.gp_inspecoes where procedimento = v_codigo and excluido_em is not null),
      'checklists', (select count(*) from public.gp_checklist_equipamentos where procedimento = v_codigo),
      'rascunhos', (select count(*) from public.gp_relatorios
                     where excluido_em is null and status = 'rascunho' and dados -> 'd' ->> 'procedimento' = v_codigo),
      'relatorios', (select count(*) from public.gp_relatorios
                     where not (excluido_em is null and status = 'rascunho') and dados -> 'd' ->> 'procedimento' = v_codigo)
    ) into r;
    return r;
  elsif p_tipo = 'equipamento' then
    select slug, nome into v_slug, v_nome from public.gp_equipamentos where id = p_id;
    if not found then return null; end if;
    select jsonb_build_object(
      'procedimentos', (select count(*) from public.gp_procedimentos
                         where jsonb_typeof(equipamentos) = 'array' and equipamentos @> jsonb_build_array(v_slug)),
      'checklists', (select count(*) from public.gp_checklist_equipamentos
                      where jsonb_typeof(itens) = 'array' and itens @> jsonb_build_array(jsonb_build_object('slug', v_slug))),
      'agendamentosFuturos', (select count(*) from public.gp_agendamentos a
                      where jsonb_typeof(a.equipamentos) = 'array' and a.substituido_em is null
                        and (a.a_definir or a.data_visita >= v_hoje)
                        and exists (select 1 from jsonb_array_elements(a.equipamentos) e
                                     where jsonb_typeof(e) = 'string' and public.gp_chave_nome(e #>> '{}') = public.gp_chave_nome(v_nome))),
      'agendamentos', (select count(*) from public.gp_agendamentos a
                      where jsonb_typeof(a.equipamentos) = 'array'
                        and exists (select 1 from jsonb_array_elements(a.equipamentos) e
                                     where jsonb_typeof(e) = 'string' and public.gp_chave_nome(e #>> '{}') = public.gp_chave_nome(v_nome))),
      'relatorios', (select count(*) from public.gp_relatorios
                      where jsonb_typeof(dados -> 'equipIds') = 'array' and dados -> 'equipIds' @> jsonb_build_array(v_slug))
    ) into r;
    return r;
  end if;
  return null;
end $$;

-- Só a API (chave de serviço) chama as funções que escrevem em várias tabelas.
revoke all on function public.gp_renomear_procedimento(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.gp_renomear_equipamento(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.gp_uso_catalogo(text, uuid) from public, anon, authenticated;
grant execute on function public.gp_renomear_procedimento(uuid, text, text, timestamptz) to service_role;
grant execute on function public.gp_renomear_equipamento(uuid, text, text, timestamptz) to service_role;
grant execute on function public.gp_uso_catalogo(text, uuid) to service_role;

-- PostgREST: recarrega o cache do schema (evita "Could not find the column").
notify pgrst, 'reload schema';

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

-- Segurança: só administradores alteram perfil, função, status ou e-mail
-- (a policy gp_profiles_update deixa cada um atualizar a própria linha).
create or replace function public.gp_profiles_protege_campos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if exists (select 1 from public.gp_profiles p where p.id = auth.uid() and p.perfil = 'admin' and p.ativo) then
    return new;
  end if;
  if new.perfil is distinct from old.perfil
     or new.ativo is distinct from old.ativo
     or new.funcao is distinct from old.funcao
     or new.email is distinct from old.email
     or new.id is distinct from old.id then
    raise exception 'Somente administradores podem alterar perfil, função, status ou e-mail.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_gp_profiles_protege_campos on public.gp_profiles;
create trigger trg_gp_profiles_protege_campos
  before update on public.gp_profiles
  for each row execute function public.gp_profiles_protege_campos();


-- ============================================================================
-- ASP — Clientes sem dado ambíguo ou duplicado (parte 2: exclusão, contatos
-- em uso, concorrência).
--
-- 1) Contato desativado em vez de excluído quando está em uso:
--    gp_orgaos_contatos.ativo / desativado_em / desativado_por. Desativado
--    some das NOVAS escolhas (projeto, entrega, RDO, proposta) e continua
--    aparecendo onde já foi usado. Excluir de vez só sem uso (a API confere).
-- 2) Versão para "outra pessoa alterou" (409):
--    gp_orgaos_contatos.updated_at (nova) e gp_orgaos.updated_at (já existe),
--    renovadas por trigger. No cliente, só os dados cadastrais contam como
--    alteração — salvar o aviso do cliente não gera conflito com quem está
--    editando o cadastro.
-- 3) gp_atualizar_contato(id, versao, nome, cargo, telefone, email, projetos):
--    grava o contato (só se a versão é a lida) e, na MESMA transação, leva o
--    nome novo a gp_projetos.responsavel_projeto dos projetos indicados
--    (a API calcula quais: projetos DESTE cliente com o nome antigo). RDOs,
--    relatórios e gp_entregas.contato_nome são histórico e não mudam.
--    Só pode ser chamada pela chave de serviço (API).
--
-- Backfill: NENHUM. Todos os contatos existentes ficam ativos; nomes, cidades
-- e responsáveis não são alterados. Um NOTICE lista contatos repetidos
-- (mesmo e-mail no mesmo cliente) que já existam, para ajuste manual.
-- Idempotente: pode rodar de novo.
-- ============================================================================

-- 1) Colunas
alter table public.gp_orgaos_contatos add column if not exists ativo boolean not null default true;
alter table public.gp_orgaos_contatos add column if not exists desativado_em timestamptz;
alter table public.gp_orgaos_contatos add column if not exists desativado_por uuid references public.gp_profiles (id);
alter table public.gp_orgaos_contatos add column if not exists updated_at timestamptz not null default now();
alter table public.gp_orgaos add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_gp_projetos_cliente_id on public.gp_projetos (cliente_id);

-- 2) Versão renovada a cada alteração
create or replace function public.gp_orgaos_contatos_tocar_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_gp_orgaos_contatos_updated_at on public.gp_orgaos_contatos;
create trigger trg_gp_orgaos_contatos_updated_at
  before update on public.gp_orgaos_contatos
  for each row execute function public.gp_orgaos_contatos_tocar_updated_at();

create or replace function public.gp_orgaos_tocar_updated_at() returns trigger
language plpgsql as $$
begin
  if (new.razao_social, new.cnpj, new.cidade, new.uf, new.tipo_ente, new.endereco, new.excluido_em)
     is distinct from
     (old.razao_social, old.cnpj, old.cidade, old.uf, old.tipo_ente, old.endereco, old.excluido_em) then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_gp_orgaos_updated_at on public.gp_orgaos;
create trigger trg_gp_orgaos_updated_at
  before update on public.gp_orgaos
  for each row execute function public.gp_orgaos_tocar_updated_at();

-- 3) Contato: grava + leva o nome novo aos projetos (mesma transação)
create or replace function public.gp_atualizar_contato(
  p_id uuid, p_versao timestamptz, p_nome text, p_cargo text, p_telefone text, p_email text, p_projetos uuid[]
) returns jsonb
language plpgsql as $$
declare
  v_orgao uuid;
  v_antigo text;
  v_linha public.gp_orgaos_contatos%rowtype;
  n_proj int := 0;
begin
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'gp_contato: nome vazio';
  end if;
  select orgao_id, nome_completo into v_orgao, v_antigo
    from public.gp_orgaos_contatos
   where id = p_id and updated_at = p_versao
   for update;
  if not found then
    raise exception 'gp_contato_versao' using hint = 'O contato mudou desde que foi aberto.';
  end if;
  update public.gp_orgaos_contatos
     set nome_completo = p_nome, cargo = p_cargo, telefone = p_telefone, email = p_email
   where id = p_id
   returning * into v_linha;
  if p_nome is distinct from v_antigo and coalesce(array_length(p_projetos, 1), 0) > 0 then
    update public.gp_projetos
       set responsavel_projeto = p_nome
     where id = any(p_projetos) and cliente_id = v_orgao;
    get diagnostics n_proj = row_count;
  end if;
  return jsonb_build_object('versao', v_linha.updated_at, 'projetos', n_proj, 'contato', to_jsonb(v_linha));
end $$;

revoke all on function public.gp_atualizar_contato(uuid, timestamptz, text, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.gp_atualizar_contato(uuid, timestamptz, text, text, text, text, uuid[]) to service_role;

-- Contatos repetidos já existentes (mesmo e-mail no mesmo cliente): só avisa.
do $$
declare
  g record;
  qtd int := 0;
begin
  for g in
    select o.razao_social as cliente, lower(btrim(c.email)) as chave,
           string_agg(format('"%s" (%s)', c.nome_completo, c.id), ', ' order by c.created_at) as itens
      from public.gp_orgaos_contatos c
      join public.gp_orgaos o on o.id = c.orgao_id
     where coalesce(btrim(c.email), '') <> ''
     group by o.razao_social, c.orgao_id, lower(btrim(c.email))
    having count(*) > 1
  loop
    qtd := qtd + 1;
    raise notice 'gp_orgaos_contatos: cliente "%" tem contatos com o MESMO e-mail (%): %', g.cliente, g.chave, g.itens;
  end loop;
  if qtd > 0 then
    raise notice 'gp_orgaos_contatos: % grupo(s) de contatos repetidos — desative ou exclua o duplicado no cadastro do cliente.', qtd;
  end if;
end $$;


-- ============================================================================
-- ASP — OS com ou sem inspeção + cliente com serviço recorrente.
--
-- 1) gp_inspecoes.com_inspecao (boolean, padrão true): false = OS SEM
--    inspeção — nasce na fase 6 (Agendamento de Execução) e nunca passa
--    pelas fases 2–5. Todas as OSs existentes ficam com true (nada muda).
-- 2) gp_projetos.com_inspecao_padrao (boolean, padrão true): resposta de
--    "Haverá inspeção?" na abertura do projeto — padrão das OSs novas dele
--    (cada OS pode ser diferente).
-- 3) gp_orgaos: serviço recorrente do cliente.
--      recorrente               boolean, padrão false
--      periodicidade_meses      3 | 6 | 12 — obrigatória quando recorrente
--      aviso_antecedencia_dias  dias antes do vencimento em que o lembrete
--                               abre (padrão 30)
--    O trigger da versão (updated_at) passa a considerar esses campos.
-- 4) gp_fase_historico.acao aceita 'alterar_inspecao' (troca de "Haverá
--    inspeção?" numa OS aberta: quem, quando, fase de → para; o texto
--    "Sim → Não" vai em motivo).
-- 5) gp_lembretes_recorrencia: um registro por cliente e vencimento — a
--    chave única (orgao_id, vencimento) garante no máximo UM lembrete
--    (notificação ao Comercial/Gerência) por ciclo. Escrita só pela chave
--    de serviço (API); leitura para os perfis ASP.
--
-- Backfill: NENHUM. Nenhum cliente é marcado como recorrente; nenhuma OS
-- muda de fase.
-- Idempotente: pode rodar de novo. Se o banco já tiver dados que violam um
-- check novo, ele NÃO é criado: sai um NOTICE e a migração segue.
-- ============================================================================

-- 1) e 2) OS com/sem inspeção
alter table public.gp_inspecoes add column if not exists com_inspecao boolean not null default true;
alter table public.gp_projetos add column if not exists com_inspecao_padrao boolean not null default true;

-- 3) Cliente recorrente
alter table public.gp_orgaos add column if not exists recorrente boolean not null default false;
alter table public.gp_orgaos add column if not exists periodicidade_meses int;
alter table public.gp_orgaos add column if not exists aviso_antecedencia_dias int not null default 30;

do $$
declare
  qtd int;
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_orgaos_periodicidade') then
    select count(*) into qtd from public.gp_orgaos
     where (periodicidade_meses is not null and periodicidade_meses not in (3, 6, 12))
        or (recorrente and periodicidade_meses is null);
    if qtd = 0 then
      alter table public.gp_orgaos add constraint ck_gp_orgaos_periodicidade
        check ((periodicidade_meses is null or periodicidade_meses in (3, 6, 12))
           and (not recorrente or periodicidade_meses is not null));
    else
      raise notice 'gp_orgaos: % cliente(s) com periodicidade inválida — check ck_gp_orgaos_periodicidade NÃO criado.', qtd;
    end if;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_orgaos_aviso_antecedencia') then
    select count(*) into qtd from public.gp_orgaos
     where aviso_antecedencia_dias < 0 or aviso_antecedencia_dias > 365;
    if qtd = 0 then
      alter table public.gp_orgaos add constraint ck_gp_orgaos_aviso_antecedencia
        check (aviso_antecedencia_dias between 0 and 365);
    else
      raise notice 'gp_orgaos: % cliente(s) com aviso de antecedência fora de 0–365 — check NÃO criado.', qtd;
    end if;
  end if;
end $$;

-- Versão (updated_at) do cliente: a recorrência é dado cadastral.
create or replace function public.gp_orgaos_tocar_updated_at() returns trigger
language plpgsql as $$
begin
  if (new.razao_social, new.cnpj, new.cidade, new.uf, new.tipo_ente, new.endereco, new.excluido_em,
      new.recorrente, new.periodicidade_meses, new.aviso_antecedencia_dias)
     is distinct from
     (old.razao_social, old.cnpj, old.cidade, old.uf, old.tipo_ente, old.endereco, old.excluido_em,
      old.recorrente, old.periodicidade_meses, old.aviso_antecedencia_dias) then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_gp_orgaos_updated_at on public.gp_orgaos;
create trigger trg_gp_orgaos_updated_at
  before update on public.gp_orgaos
  for each row execute function public.gp_orgaos_tocar_updated_at();

-- 4) gp_fase_historico.acao (+ 'alterar_inspecao')
do $$
declare
  c record;
  qtd int;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.gp_fase_historico'::regclass
       and contype = 'c'
       and conname <> 'ck_gp_fase_historico_acao'
       and pg_get_constraintdef(oid) ilike '%acao%'
       and pg_get_constraintdef(oid) not ilike '%motivo_categoria%'
  loop
    execute format('alter table public.gp_fase_historico drop constraint %I', c.conname);
    raise notice 'gp_fase_historico: check % derrubado (recriado como ck_gp_fase_historico_acao).', c.conname;
  end loop;

  select count(*) into qtd from public.gp_fase_historico
   where acao not in ('avancar', 'aprovar', 'reprovar', 'assinar', 'encerrar', 'reabrir', 'alterar_inspecao');
  if qtd > 0 then
    raise notice 'gp_fase_historico: % linha(s) com ação fora da lista — check ck_gp_fase_historico_acao NÃO recriado.', qtd;
  else
    alter table public.gp_fase_historico drop constraint if exists ck_gp_fase_historico_acao;
    alter table public.gp_fase_historico add constraint ck_gp_fase_historico_acao
      check (acao in ('avancar', 'aprovar', 'reprovar', 'assinar', 'encerrar', 'reabrir', 'alterar_inspecao'));
  end if;
end $$;

-- 5) Lembretes de serviço recorrente (dedupe por cliente + vencimento)
create table if not exists public.gp_lembretes_recorrencia (
  id uuid primary key default gen_random_uuid(),
  orgao_id uuid not null references public.gp_orgaos (id) on delete cascade,
  vencimento date not null,
  notificado_em timestamptz not null default now(),
  destinatarios int not null default 0
);
create unique index if not exists uq_gp_lembretes_recorrencia_ciclo
  on public.gp_lembretes_recorrencia (orgao_id, vencimento);

alter table public.gp_lembretes_recorrencia enable row level security;
drop policy if exists gp_lembretes_recorrencia_select on public.gp_lembretes_recorrencia;
create policy gp_lembretes_recorrencia_select on public.gp_lembretes_recorrencia for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
-- Sem policy de insert/update/delete: só a chave de serviço (API) grava.


-- ============================================================================
-- ASP — Acesso por e-mail: convite (24 h) e redefinição de senha (1 h).
-- gp_links_acesso guarda só o SHA-256 do token do link (auditoria do envio
-- e do uso); gp_acesso_tentativas = limite do "Esqueci minha senha".
-- Sem policy: só a chave de serviço (API). Desativar invalida os links.
-- ============================================================================
-- 1) Links
create table if not exists public.gp_links_acesso (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.gp_profiles (id) on delete set null,
  email text not null,
  tipo text not null,
  token_hash text not null,
  criado_por uuid references public.gp_profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usado_em timestamptz,
  uso_ip text,
  invalidado_em timestamptz,
  invalidado_motivo text,
  destino text,
  ip text,
  user_agent text,
  envio_status text not null default 'pendente',
  envio_erro text,
  enviado_em timestamptz
);

alter table public.gp_links_acesso add column if not exists uso_ip text;
alter table public.gp_links_acesso add column if not exists invalidado_em timestamptz;
alter table public.gp_links_acesso add column if not exists invalidado_motivo text;
alter table public.gp_links_acesso add column if not exists destino text;
alter table public.gp_links_acesso add column if not exists envio_status text not null default 'pendente';
alter table public.gp_links_acesso add column if not exists envio_erro text;
alter table public.gp_links_acesso add column if not exists enviado_em timestamptz;

alter table public.gp_links_acesso drop constraint if exists ck_gp_links_acesso_tipo;
alter table public.gp_links_acesso add constraint ck_gp_links_acesso_tipo
  check (tipo in ('convite', 'redefinicao'));
alter table public.gp_links_acesso drop constraint if exists ck_gp_links_acesso_envio;
alter table public.gp_links_acesso add constraint ck_gp_links_acesso_envio
  check (envio_status in ('pendente', 'enviado', 'nao_configurado', 'falhou'));
-- Convite no máximo 24 h; redefinição no máximo 1 h (folga de 1 min).
alter table public.gp_links_acesso drop constraint if exists ck_gp_links_acesso_prazo;
alter table public.gp_links_acesso add constraint ck_gp_links_acesso_prazo
  check (expira_em > criado_em and expira_em <= criado_em
    + case when tipo = 'convite' then interval '24 hours 1 minute' else interval '1 hour 1 minute' end);

create unique index if not exists uq_gp_links_acesso_token on public.gp_links_acesso (token_hash);
create index if not exists idx_gp_links_acesso_usuario on public.gp_links_acesso (usuario_id, tipo, criado_em desc);
create index if not exists idx_gp_links_acesso_email on public.gp_links_acesso (email);

alter table public.gp_links_acesso enable row level security;
revoke all on public.gp_links_acesso from anon, authenticated;
-- Sem policy: só a chave de serviço (API) lê e grava.

-- 2) Tentativas do "Esqueci minha senha"
create table if not exists public.gp_acesso_tentativas (
  id bigint generated always as identity primary key,
  chave text not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_gp_acesso_tentativas_chave on public.gp_acesso_tentativas (chave, criado_em desc);

alter table public.gp_acesso_tentativas enable row level security;
revoke all on public.gp_acesso_tentativas from anon, authenticated;

-- 3) Desativar invalida os links pendentes
create or replace function public.gp_links_acesso_invalida_desativado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ativo is distinct from true and old.ativo is true then
    update public.gp_links_acesso
       set invalidado_em = now(), invalidado_motivo = 'usuario_desativado'
     where usuario_id = new.id and usado_em is null and invalidado_em is null;
  end if;
  return new;
end $$;

drop trigger if exists trg_gp_links_acesso_desativado on public.gp_profiles;
create trigger trg_gp_links_acesso_desativado
  after update of ativo on public.gp_profiles
  for each row execute function public.gp_links_acesso_invalida_desativado();

-- ============================================================================
-- ASP — Funções do usuário gerenciadas pelo administrador (gp_funcoes) e
-- permissões por função.
--
-- Antes: gp_profiles.funcao só aceitava 'Coordenador', 'Engenheiro' ou
-- 'Técnico' (check gp_profiles_funcao_check) e o código decidia as
-- permissões pelo NOME da função (funcao === 'Coordenador').
-- Agora:
-- 1) gp_funcoes: nome (único exato + único normalizado via gp_chave_nome),
--    nome_rdo (cargo no RDO; vazio vira "<nome> de operações"), ordem,
--    ativo e as permissões (todas false por padrão):
--      pode_aprovar_medicao   aprovar a medição da coleta
--      pode_excluir_projetos  excluir/restaurar projetos, OSs e clientes
--                             (lixeira)
--      pode_editar_revisao    corrigir à mão revisão/código do relatório
--      lideranca_equipe       conta como liderança da equipe (aviso
--                             "equipe sem liderança" da execução)
--    updated_at é a VERSÃO (409 "outro administrador alterou"); mudar só a
--    ordem não troca a versão.
-- 2) Carga inicial (idempotente, pela chave_seed — renomear depois NÃO faz a
--    função voltar ao rodar de novo):
--      1 Coordenador  "Coordenador de operações"  todas as permissões
--      2 Engenheiro   "Engenheiro de operações"   liderança
--      3 Técnico      "Técnico de operações"      —
--      4 Auxiliar     "Auxiliar de operações"     —   (nova)
--      5 Supervisor   "Supervisor de operações"   —   (nova)
--    = exatamente o comportamento de antes para quem já tem função.
-- 3) gp_profiles.funcao: sai o check fixo; entra a FK
--    fk_gp_profiles_funcao → gp_funcoes(nome) ON UPDATE CASCADE (renomear a
--    função atualiza os usuários) ON DELETE RESTRICT (função em uso não se
--    exclui). Se algum usuário tem função que não existe em gp_funcoes, a FK
--    NÃO é criada: sai um NOTICE por valor. Ajuste (Administração de
--    usuários) ou cadastre a função e rode de novo. A API valida do mesmo
--    jeito enquanto isso.
-- 4) RLS: todos os perfis ASP ativos leem; só admin grava (a API usa a chave
--    de serviço). gp_salvar_permissoes_funcoes(jsonb): grava a matriz de
--    permissões de uma vez, conferindo a versão de cada linha — só a chave
--    de serviço chama.
--
-- Backfill: NENHUM em gp_profiles (as funções gravadas ficam como estão).
-- Idempotente: pode rodar de novo.
-- ============================================================================

-- Mesma chave de nome do Catálogo (repetida aqui para a migração rodar sozinha).
create or replace function public.gp_chave_nome(t text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(t, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
    '\s+', ' ', 'g'))
$$;

-- 1) Tabela
create table if not exists public.gp_funcoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_rdo text,
  ordem int not null default 0,
  ativo boolean not null default true,
  pode_aprovar_medicao boolean not null default false,
  pode_excluir_projetos boolean not null default false,
  pode_editar_revisao boolean not null default false,
  lideranca_equipe boolean not null default false,
  chave_seed text,
  criado_por uuid references public.gp_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gp_funcoes add column if not exists nome_rdo text;
alter table public.gp_funcoes add column if not exists ordem int not null default 0;
alter table public.gp_funcoes add column if not exists ativo boolean not null default true;
alter table public.gp_funcoes add column if not exists pode_aprovar_medicao boolean not null default false;
alter table public.gp_funcoes add column if not exists pode_excluir_projetos boolean not null default false;
alter table public.gp_funcoes add column if not exists pode_editar_revisao boolean not null default false;
alter table public.gp_funcoes add column if not exists lideranca_equipe boolean not null default false;
alter table public.gp_funcoes add column if not exists chave_seed text;
alter table public.gp_funcoes add column if not exists criado_por uuid references public.gp_profiles (id) on delete set null;
alter table public.gp_funcoes add column if not exists created_at timestamptz not null default now();
alter table public.gp_funcoes add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_gp_funcoes_nome') then
    alter table public.gp_funcoes add constraint uq_gp_funcoes_nome unique (nome);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_gp_funcoes_chave_seed') then
    alter table public.gp_funcoes add constraint uq_gp_funcoes_chave_seed unique (chave_seed);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_gp_funcoes_nome') then
    alter table public.gp_funcoes add constraint ck_gp_funcoes_nome
      check (btrim(nome) <> '' and nome = btrim(nome) and char_length(nome) <= 60);
  end if;
end $$;

create unique index if not exists uq_gp_funcoes_nome_chave on public.gp_funcoes (public.gp_chave_nome(nome));
create index if not exists idx_gp_funcoes_ordem on public.gp_funcoes (ativo desc, ordem, nome);

-- nome_rdo vazio → "<nome> de operações"; versão só muda se algo além da
-- ordem mudou.
create or replace function public.gp_funcoes_antes_gravar() returns trigger
language plpgsql as $$
begin
  if coalesce(btrim(new.nome_rdo), '') = '' then
    new.nome_rdo := new.nome || ' de operações';
  else
    new.nome_rdo := btrim(new.nome_rdo);
  end if;
  if tg_op = 'UPDATE' then
    if (new.nome, new.nome_rdo, new.ativo, new.pode_aprovar_medicao, new.pode_excluir_projetos,
        new.pode_editar_revisao, new.lideranca_equipe)
       is distinct from
       (old.nome, old.nome_rdo, old.ativo, old.pode_aprovar_medicao, old.pode_excluir_projetos,
        old.pode_editar_revisao, old.lideranca_equipe) then
      new.updated_at := clock_timestamp();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_gp_funcoes_antes_gravar on public.gp_funcoes;
create trigger trg_gp_funcoes_antes_gravar
  before insert or update on public.gp_funcoes
  for each row execute function public.gp_funcoes_antes_gravar();

-- 4) RLS
alter table public.gp_funcoes enable row level security;
drop policy if exists gp_funcoes_select on public.gp_funcoes;
create policy gp_funcoes_select on public.gp_funcoes for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_funcoes_write on public.gp_funcoes;
create policy gp_funcoes_write on public.gp_funcoes for all to authenticated
  using (public.gp_perfil_atual_asp() = 'admin')
  with check (public.gp_perfil_atual_asp() = 'admin');

-- 2) Carga inicial (idempotente pela chave_seed; não sobrescreve o que o
--    administrador já mudou).
insert into public.gp_funcoes
  (chave_seed, nome, nome_rdo, ordem, pode_aprovar_medicao, pode_excluir_projetos, pode_editar_revisao, lideranca_equipe)
select v.chave_seed, v.nome, v.nome_rdo, v.ordem, v.aprovar, v.excluir, v.revisao, v.lideranca
  from (values
    ('coordenador', 'Coordenador', 'Coordenador de operações', 1, true,  true,  true,  true),
    ('engenheiro',  'Engenheiro',  'Engenheiro de operações',  2, false, false, false, true),
    ('tecnico',     'Técnico',     'Técnico de operações',     3, false, false, false, false),
    ('auxiliar',    'Auxiliar',    'Auxiliar de operações',    4, false, false, false, false),
    ('supervisor',  'Supervisor',  'Supervisor de operações',  5, false, false, false, false)
  ) as v(chave_seed, nome, nome_rdo, ordem, aprovar, excluir, revisao, lideranca)
 where not exists (select 1 from public.gp_funcoes f where f.chave_seed = v.chave_seed)
   and not exists (select 1 from public.gp_funcoes f where public.gp_chave_nome(f.nome) = public.gp_chave_nome(v.nome));

-- 3) gp_profiles.funcao: check fixo → FK por nome (NOTICE se há órfãos)
alter table public.gp_profiles drop constraint if exists gp_profiles_funcao_check;

do $$
declare
  g record;
  qtd int := 0;
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_gp_profiles_funcao') then
    for g in
      select p.funcao, count(*) as n,
             string_agg(coalesce(nullif(btrim(p.nome_completo), ''), p.email, p.id::text), ', ' order by p.nome_completo) as quem
        from public.gp_profiles p
       where p.funcao is not null
         and not exists (select 1 from public.gp_funcoes f where f.nome = p.funcao)
       group by p.funcao
    loop
      qtd := qtd + 1;
      raise notice 'gp_profiles: função "%" (% usuário(s): %) não existe em gp_funcoes.', g.funcao, g.n, g.quem;
    end loop;
    if qtd = 0 then
      alter table public.gp_profiles
        add constraint fk_gp_profiles_funcao foreign key (funcao)
        references public.gp_funcoes (nome) on update cascade on delete restrict;
    else
      raise notice 'gp_profiles: % função(ões) sem cadastro — FK fk_gp_profiles_funcao NÃO criada. Cadastre a função em Administração de usuários → Funções (ou troque a função desses usuários) e rode de novo.', qtd;
    end if;
  end if;
end $$;

create index if not exists idx_gp_profiles_funcao on public.gp_profiles (funcao);

-- 4) Matriz de permissões: grava tudo ou nada, conferindo a versão.
--    p_itens = [{ "id": uuid, "versao": timestamptz, "pode_aprovar_medicao": bool, ... }]
create or replace function public.gp_salvar_permissoes_funcoes(p_itens jsonb)
returns jsonb
language plpgsql as $$
declare
  it jsonb;
  v_versao timestamptz;
  saida jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'gp_funcoes: itens inválidos';
  end if;
  for it in select * from jsonb_array_elements(p_itens)
  loop
    update public.gp_funcoes
       set pode_aprovar_medicao = coalesce((it ->> 'pode_aprovar_medicao')::boolean, pode_aprovar_medicao),
           pode_excluir_projetos = coalesce((it ->> 'pode_excluir_projetos')::boolean, pode_excluir_projetos),
           pode_editar_revisao = coalesce((it ->> 'pode_editar_revisao')::boolean, pode_editar_revisao),
           lideranca_equipe = coalesce((it ->> 'lideranca_equipe')::boolean, lideranca_equipe)
     where id = (it ->> 'id')::uuid
       and updated_at = (it ->> 'versao')::timestamptz
     returning updated_at into v_versao;
    if not found then
      raise exception 'gp_funcoes_versao' using hint = it ->> 'id';
    end if;
    saida := saida || jsonb_build_array(jsonb_build_object('id', it ->> 'id', 'versao', v_versao));
  end loop;
  return saida;
end $$;

revoke all on function public.gp_salvar_permissoes_funcoes(jsonb) from public, anon, authenticated;
grant execute on function public.gp_salvar_permissoes_funcoes(jsonb) to service_role;

-- PostgREST: recarrega o cache do schema.
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
  ('gp_procedimentos','agua_potavel'),
  ('gp_fotos_execucao','itens'), ('gp_fotos_execucao','agua_antes'),
  ('gp_rdos','dados'), ('gp_rdos','inspecoes'), ('gp_rdos','arquivo_em'),
  ('gp_push_subscriptions','endpoint'),
  ('gp_agendamentos','a_definir'), ('gp_agendamentos','lembrar_em'),
  ('gp_agendamentos','substituido_em'), ('gp_agendamentos','substituido_por'),
  ('gp_coletas','data_coleta'), ('gp_coletas','responsavel_id'), ('gp_coletas','descricao'),
  ('gp_coletas','dados_hash'), ('gp_coletas','arquivo_hash'), ('gp_coletas','aprovacao_retirada_em'),
  ('gp_coletas','aprovacao_retirada_por'),
  ('gp_relatorios','arquivo_hash'), ('gp_relatorios','substituido_em'), ('gp_relatorios','substituido_por'),
  ('gp_relatorios','motivo_categoria'), ('gp_relatorios','avaliado_por'), ('gp_relatorios','avaliado_em'),
  ('gp_relatorios','assinado_path'), ('gp_relatorios','assinado_hash'), ('gp_relatorios','assinado_por'),
  ('gp_relatorios','assinado_em'),
  ('gp_fase_historico','motivo_categoria'), ('gp_fase_historico','relatorio_id'), ('gp_fase_historico','chave_idempotencia'),
  ('gp_inspecoes','cadastro_atualizado_em'),
  ('gp_relatorio_visualizacoes','relatorio_id'), ('gp_relatorio_visualizacoes','usuario_id'), ('gp_relatorio_visualizacoes','em'),
  ('gp_agendamentos','data_fim'),
  ('gp_procedimentos','cloro_unidade'), ('gp_procedimentos','cloro_limite_aviso'),
  ('gp_inspecoes','encerrada_em'), ('gp_inspecoes','encerrada_por'), ('gp_inspecoes','encerramento_manual'),
  ('gp_inspecoes','encerramento_justificativa'), ('gp_inspecoes','encerramento_pendencias'),
  ('gp_projetos','concluido_em'), ('gp_projetos','concluido_automaticamente'),
  ('gp_entregas','inspecao_id'), ('gp_entregas','contato_id'), ('gp_entregas','arquivos'), ('gp_entregas','excluido_em'),
  ('gp_procedimentos','ativo'), ('gp_procedimentos','desativado_em'), ('gp_procedimentos','desativado_por'), ('gp_procedimentos','atualizado_em'),
  ('gp_equipamentos','ativo'), ('gp_equipamentos','desativado_em'), ('gp_equipamentos','desativado_por'), ('gp_equipamentos','atualizado_em'),
  ('gp_profiles','updated_at'),
  ('gp_orgaos_contatos','ativo'), ('gp_orgaos_contatos','desativado_em'), ('gp_orgaos_contatos','desativado_por'),
  ('gp_orgaos_contatos','updated_at'), ('gp_orgaos','updated_at'),
  ('gp_inspecoes','com_inspecao'), ('gp_projetos','com_inspecao_padrao'),
  ('gp_orgaos','recorrente'), ('gp_orgaos','periodicidade_meses'), ('gp_orgaos','aviso_antecedencia_dias'),
  ('gp_lembretes_recorrencia','orgao_id'), ('gp_lembretes_recorrencia','vencimento'), ('gp_lembretes_recorrencia','notificado_em'),
  ('gp_links_acesso','token_hash'), ('gp_links_acesso','expira_em'), ('gp_links_acesso','usado_em'),
  ('gp_links_acesso','invalidado_em'), ('gp_links_acesso','envio_status'), ('gp_links_acesso','envio_erro'),
  ('gp_acesso_tentativas','chave'), ('gp_acesso_tentativas','criado_em'),
  ('gp_funcoes','nome'), ('gp_funcoes','nome_rdo'), ('gp_funcoes','ordem'), ('gp_funcoes','ativo'),
  ('gp_funcoes','pode_aprovar_medicao'), ('gp_funcoes','pode_excluir_projetos'), ('gp_funcoes','pode_editar_revisao'),
  ('gp_funcoes','lideranca_equipe'), ('gp_funcoes','chave_seed'), ('gp_funcoes','criado_por'),
  ('gp_funcoes','created_at'), ('gp_funcoes','updated_at')
)
select * from (
  select e.tabela, e.coluna,
    case when c.column_name is not null then 'OK' else '*** FALTANDO ***' end as status
  from esperado e
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = e.tabela and c.column_name = e.coluna
  union all
  -- Índice do código único do projeto (pode ficar PENDENTE se há repetidos).
  select 'gp_projetos', 'índice código único',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_projetos_codigo_norm')
      then 'OK' else 'PENDENTE — códigos duplicados' end
  union all
  -- Identificação da OS única no projeto (pode ficar PENDENTE se há repetidas).
  select 'gp_inspecoes', 'índice identificação única (OS)',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_inspecoes_identificacao_norm')
      then 'OK' else 'PENDENTE — OSs com identificação repetida' end
  union all
  select 'gp_agendamentos', 'check a_definir sem data',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_a_definir')
      then 'OK' else '*** FALTANDO ***' end
  union all
  -- Fase 3: anexo com descrição; uma aprovada por OS; medição/PDF únicos por OS.
  select 'gp_coletas', 'check anexo com descrição',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_coletas_anexo_descricao')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_coletas', 'índice uma medição aprovada por OS',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_aprovada_por_os')
      then 'OK' else 'PENDENTE — OS com mais de uma medição aprovada' end
  union all
  select 'gp_coletas', 'índice medição única por OS',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_dados_hash')
      then 'OK' else 'PENDENTE — medições repetidas' end
  union all
  select 'gp_coletas', 'índice PDF único por OS',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_coletas_arquivo_hash')
      then 'OK' else 'PENDENTE — PDFs repetidos' end
  union all
  select 'gp_coletas', 'data_coleta obrigatória',
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gp_coletas'
      and column_name = 'data_coleta' and is_nullable = 'NO') then 'OK' else '*** FALTANDO ***' end
  union all
  -- Fase 4: status 'substituido'; versão/rascunho/em aprovação/arquivo únicos.
  select 'gp_relatorios', 'check status com substituido',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_status')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_relatorios', 'índice versão única por OS/tipo',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_versao')
      then 'OK' else 'PENDENTE — versões repetidas' end
  union all
  select 'gp_relatorios', 'índice um rascunho por OS/tipo',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_rascunho')
      then 'OK' else 'PENDENTE — mais de um rascunho' end
  union all
  select 'gp_relatorios', 'índice um em aprovação por OS/tipo',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_em_aprovacao')
      then 'OK' else 'PENDENTE — mais de um em aprovação' end
  union all
  select 'gp_relatorios', 'índice arquivo único por OS',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_arquivo_hash')
      then 'OK' else 'PENDENTE — arquivos repetidos' end
  union all
  -- Fases 5/9: categoria da reprovação; assinado com arquivo; assinada única;
  -- ação de fase sem duplicata (Idempotency-Key); visualizações com RLS.
  select 'gp_relatorios', 'check categoria da reprovação',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_motivo_categoria')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_fase_historico', 'check categoria da reprovação',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_fase_historico_motivo_categoria')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_relatorios', 'check assinado com arquivo',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_assinado_arquivo')
      then 'OK' else 'PENDENTE — assinado sem arquivo' end
  union all
  select 'gp_relatorios', 'índice versão assinada única por OS',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_relatorios_assinado_hash')
      then 'OK' else 'PENDENTE — assinadas repetidas' end
  union all
  select 'gp_fase_historico', 'índice chave de idempotência',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_fase_historico_chave')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_relatorio_visualizacoes', 'RLS ativo',
    case when exists (select 1 from pg_class where oid = to_regclass('public.gp_relatorio_visualizacoes') and relrowsecurity)
      then 'OK' else '*** FALTANDO ***' end
  union all
  -- Fase 6: período da execução; uma execução ativa por OS.
  select 'gp_agendamentos', 'check data_fim ≥ data_visita',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_data_fim')
      then 'OK' else 'PENDENTE — fim antes do início' end
  union all
  select 'gp_agendamentos', 'check período só na execução',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_agendamentos_data_fim_execucao')
      then 'OK' else 'PENDENTE — inspeção/a definir com data_fim' end
  union all
  select 'gp_agendamentos', 'índice uma execução ativa por OS',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_agendamentos_execucao_ativa')
      then 'OK' else 'PENDENTE — OS com mais de uma execução ativa' end
  union all
  -- Fase 7: unidade e limite de aviso do cloro por procedimento.
  select 'gp_procedimentos', 'check unidade do cloro (mg/L | PPM)',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_procedimentos_cloro_unidade')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_procedimentos', 'check limite de aviso do cloro > 0',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_procedimentos_cloro_limite_aviso')
      then 'OK' else '*** FALTANDO ***' end
  union all
  -- Fase 9: categoria "Laudo/Laboratório" ('laudo') aceita na reprovação.
  select 'gp_relatorios', 'check categoria aceita laudo',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_relatorios_motivo_categoria'
      and pg_get_constraintdef(oid) like '%''laudo''%') then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_fase_historico', 'check categoria aceita laudo',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_fase_historico_motivo_categoria'
      and pg_get_constraintdef(oid) like '%''laudo''%') then 'OK' else '*** FALTANDO ***' end
  union all
  -- Fase 10: ações encerrar/reabrir no histórico; encerramento consistente;
  -- entregas ao cliente com RLS.
  select 'gp_fase_historico', 'check ação aceita encerrar/reabrir',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_fase_historico_acao'
      and pg_get_constraintdef(oid) like '%''encerrar''%' and pg_get_constraintdef(oid) like '%''reabrir''%')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_inspecoes', 'check encerramento (quem/justificativa)',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_inspecoes_encerramento')
      then 'OK' else 'PENDENTE — encerramento incompleto' end
  union all
  select 'gp_entregas', 'check meio da entrega',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_entregas_meio')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_entregas', 'RLS ativo',
    case when exists (select 1 from pg_class where oid = to_regclass('public.gp_entregas') and relrowsecurity)
      then 'OK' else '*** FALTANDO ***' end
  union all
  -- Catálogo: código/nome únicos pela chave (PENDENTE = há repetidos; o
  -- NOTICE da migração lista quais), funções do renomear e do uso.
  select 'gp_procedimentos', 'índice código único (chave)',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_procedimentos_codigo_chave')
      then 'OK' else 'PENDENTE — códigos repetidos (veja os NOTICEs)' end
  union all
  select 'gp_procedimentos', 'índice nome único (chave)',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_procedimentos_nome_chave')
      then 'OK' else 'PENDENTE — nomes repetidos (veja os NOTICEs)' end
  union all
  select 'gp_equipamentos', 'índice nome único (chave)',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_equipamentos_nome_chave')
      then 'OK' else 'PENDENTE — nomes repetidos (veja os NOTICEs)' end
  union all
  select 'gp_procedimentos', 'função gp_renomear_procedimento',
    case when to_regprocedure('public.gp_renomear_procedimento(uuid,text,text,timestamptz)') is not null
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_equipamentos', 'função gp_renomear_equipamento',
    case when to_regprocedure('public.gp_renomear_equipamento(uuid,text,text,timestamptz)') is not null
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_procedimentos', 'função gp_uso_catalogo',
    case when to_regprocedure('public.gp_uso_catalogo(text,uuid)') is not null
      then 'OK' else '*** FALTANDO ***' end
  union all
  -- Usuários: versão (updated_at) renovada a cada update, último admin
  -- protegido e e-mail único sem diferença de caixa.
  select 'gp_profiles', 'trigger versão (updated_at)',
    case when exists (select 1 from pg_trigger where tgname = 'trg_gp_profiles_updated_at'
      and tgrelid = 'public.gp_profiles'::regclass) then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_profiles', 'trigger último admin ativo',
    case when exists (select 1 from pg_trigger where tgname = 'trg_gp_profiles_guarda_admin'
      and tgrelid = 'public.gp_profiles'::regclass) then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_profiles', 'trigger só admin altera perfil/função/status/e-mail',
    case when exists (select 1 from pg_trigger where tgname = 'trg_gp_profiles_protege_campos'
      and tgrelid = 'public.gp_profiles'::regclass) then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_profiles', 'índice e-mail único (sem caixa)',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_profiles_email_chave')
      then 'OK' else 'PENDENTE — e-mails repetidos (veja os NOTICEs)' end
  union all
  select 'gp_profiles', 'há administrador ativo',
    case when exists (select 1 from public.gp_profiles where perfil = 'admin' and ativo)
      then 'OK' else '*** NENHUM ADMIN ATIVO ***' end
  union all
  -- Clientes: versão (updated_at) do cliente e do contato, renomear contato
  -- levando o nome aos projetos.
  select 'gp_orgaos', 'trigger versão (updated_at)',
    case when exists (select 1 from pg_trigger where tgname = 'trg_gp_orgaos_updated_at'
      and tgrelid = 'public.gp_orgaos'::regclass) then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_orgaos_contatos', 'trigger versão (updated_at)',
    case when exists (select 1 from pg_trigger where tgname = 'trg_gp_orgaos_contatos_updated_at'
      and tgrelid = 'public.gp_orgaos_contatos'::regclass) then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_orgaos_contatos', 'função gp_atualizar_contato',
    case when to_regprocedure('public.gp_atualizar_contato(uuid,timestamptz,text,text,text,text,uuid[])') is not null
      then 'OK' else '*** FALTANDO ***' end
  union all
  -- OS com/sem inspeção e cliente recorrente: ação 'alterar_inspecao' no
  -- histórico, periodicidade válida e um lembrete por cliente/vencimento.
  select 'gp_fase_historico', 'check ação aceita alterar_inspecao',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_fase_historico_acao'
      and pg_get_constraintdef(oid) like '%''alterar_inspecao''%') then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_orgaos', 'check periodicidade (3/6/12, obrigatória se recorrente)',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_orgaos_periodicidade')
      then 'OK' else 'PENDENTE — periodicidade inválida (veja os NOTICEs)' end
  union all
  select 'gp_orgaos', 'check aviso de antecedência (0–365)',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_orgaos_aviso_antecedencia')
      then 'OK' else 'PENDENTE — aviso fora de 0–365 (veja os NOTICEs)' end
  union all
  select 'gp_lembretes_recorrencia', 'índice único cliente + vencimento',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_lembretes_recorrencia_ciclo')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_lembretes_recorrencia', 'RLS ligado',
    case when exists (select 1 from pg_class where oid = 'public.gp_lembretes_recorrencia'::regclass and relrowsecurity)
      then 'OK' else '*** FALTANDO ***' end
  union all
  -- Acesso por e-mail: token só em hash (único), prazos 24 h / 1 h, RLS sem
  -- policy (só a chave de serviço) e desativar invalida links pendentes.
  select 'gp_links_acesso', 'índice único token_hash',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_links_acesso_token')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_links_acesso', 'check prazo (convite 24 h / redefinição 1 h)',
    case when exists (select 1 from pg_constraint where conname = 'ck_gp_links_acesso_prazo')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_links_acesso', 'RLS ligado sem policy (só service role)',
    case when exists (select 1 from pg_class where oid = 'public.gp_links_acesso'::regclass and relrowsecurity)
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gp_links_acesso')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_acesso_tentativas', 'RLS ligado sem policy (só service role)',
    case when exists (select 1 from pg_class where oid = 'public.gp_acesso_tentativas'::regclass and relrowsecurity)
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gp_acesso_tentativas')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_profiles', 'trigger desativar invalida links de acesso',
    case when exists (select 1 from pg_trigger where tgname = 'trg_gp_links_acesso_desativado'
      and tgrelid = 'public.gp_profiles'::regclass) then 'OK' else '*** FALTANDO ***' end
  union all
  -- Funções do usuário (gp_funcoes) e permissões por função.
  select 'gp_funcoes', 'nome único (exato) — alvo da FK',
    case when exists (select 1 from pg_constraint where conname = 'uq_gp_funcoes_nome')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_funcoes', 'índice nome único (sem caixa/acento)',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_gp_funcoes_nome_chave')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_funcoes', 'trigger nome no RDO padrão / versão',
    case when exists (select 1 from pg_trigger where tgname = 'trg_gp_funcoes_antes_gravar'
      and tgrelid = 'public.gp_funcoes'::regclass) then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_funcoes', 'RLS ligado (lê: perfis ASP; grava: admin)',
    case when exists (select 1 from pg_class where oid = 'public.gp_funcoes'::regclass and relrowsecurity)
      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gp_funcoes' and policyname = 'gp_funcoes_select')
      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gp_funcoes' and policyname = 'gp_funcoes_write')
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_funcoes', 'carga inicial (Coordenador … Supervisor)',
    case when (select count(*) from public.gp_funcoes
               where chave_seed in ('coordenador','engenheiro','tecnico','auxiliar','supervisor')) = 5
      then 'OK' else 'PENDENTE — alguma função inicial não foi criada (nome já usado?)' end
  union all
  select 'gp_funcoes', 'função gp_salvar_permissoes_funcoes',
    case when to_regprocedure('public.gp_salvar_permissoes_funcoes(jsonb)') is not null
      then 'OK' else '*** FALTANDO ***' end
  union all
  select 'gp_profiles', 'sem check fixo de função (gp_profiles_funcao_check)',
    case when not exists (select 1 from pg_constraint where conname = 'gp_profiles_funcao_check')
      then 'OK' else '*** AINDA EXISTE ***' end
  union all
  select 'gp_profiles', 'FK função → gp_funcoes(nome) ON UPDATE CASCADE',
    case when exists (select 1 from pg_constraint where conname = 'fk_gp_profiles_funcao' and confupdtype = 'c')
      then 'OK' else 'PENDENTE — usuários com função não cadastrada (veja os NOTICEs)' end
) r
order by status desc, tabela, coluna;
