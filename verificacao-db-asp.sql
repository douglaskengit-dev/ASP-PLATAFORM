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
  ('gp_relatorio_visualizacoes','relatorio_id'), ('gp_relatorio_visualizacoes','usuario_id'), ('gp_relatorio_visualizacoes','em')
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
) r
order by status desc, tabela, coluna;
