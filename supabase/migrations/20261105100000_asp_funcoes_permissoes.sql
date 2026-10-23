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

notify pgrst, 'reload schema';
