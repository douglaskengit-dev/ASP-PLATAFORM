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

notify pgrst, 'reload schema';
