-- ============================================================================
-- ASP — Permissões de registro em campo por função (Técnico e Auxiliar
-- acrescentam os dados durante a execução: batimetria, medições, coleta de
-- fotos e preparação de RDO).
--
-- 1) gp_funcoes ganha três marcas (boolean, padrão false):
--      pode_registrar_medicao  "Registrar medições / batimetria": criar e
--                              editar coletas (medidor, digitar, importar,
--                              anexar PDF; data e responsável ao salvar)
--      pode_registrar_fotos    "Registrar coleta de fotos": enviar/trocar/
--                              remover foto de uma vaga, pH/cloro e as
--                              caixinhas (gp_fotos_execucao)
--      pode_preparar_rdo       "Preparar RDO": criar/editar o RDO e gerar o
--                              .docx
--    Regra efetiva (API + RLS): o PERFIL já permite (admin, operacoes,
--    gerencia — como antes) OU a função do usuário tem a marca, qualquer que
--    seja o perfil (ex.: perfil comercial + função Técnico registra).
--    NÃO dão: aprovar medição, ações de fase, excluir/restaurar coleta ou
--    RDO (lixeira), relatórios, agendamentos, checklist, tanque/procedimento.
-- 2) Carga (idempotente, pela chave_seed; só quando a coluna é criada por
--    esta migração — rodar de novo NÃO religa o que o administrador
--    desligou): Coordenador, Engenheiro, Técnico e Auxiliar = as três
--    marcas; Supervisor = nenhuma (o administrador liga se quiser).
-- 3) gp_funcao_permite(flag): a função do usuário logado (perfil ativo) tem
--    a marca? Security definer; usada nas policies abaixo. Função
--    desativada continua valendo para quem já a tem (mesma regra da tela e
--    da API — desativar só tira a função do seletor).
-- 4) RLS: policies NOVAS (permissivas, somam às de perfil, que ficam como
--    estão) de INSERT e UPDATE em gp_coletas, gp_fotos_execucao e gp_rdos
--    para quem tem a marca. Em gp_coletas e gp_rdos só linha ativa
--    (excluido_em nulo, antes e depois): a marca não manda para a lixeira
--    nem restaura. Coleta nova pela função nasce sem aprovação. DELETE: sem
--    mudança (só perfis). Storage: sem policies — o app grava os arquivos
--    com a chave de serviço, depois de conferir a permissão na API.
-- 5) Trigger de versão (updated_at) e gp_salvar_permissoes_funcoes passam a
--    considerar as três marcas novas.
--
-- Idempotente: pode rodar de novo.
-- ============================================================================

-- 1) Colunas (anota quais nasceram agora, para a carga do passo 2)
create temp table if not exists tmp_gp_marcas_novas (k text primary key);
do $$
declare
  k text;
begin
  foreach k in array array['pode_registrar_medicao', 'pode_registrar_fotos', 'pode_preparar_rdo'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'gp_funcoes' and column_name = k) then
      execute format('alter table public.gp_funcoes add column %I boolean not null default false', k);
      insert into tmp_gp_marcas_novas values (k) on conflict do nothing;
    end if;
  end loop;
end $$;

-- 5) Versão: mudar uma marca nova também troca updated_at.
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
        new.pode_editar_revisao, new.lideranca_equipe,
        new.pode_registrar_medicao, new.pode_registrar_fotos, new.pode_preparar_rdo)
       is distinct from
       (old.nome, old.nome_rdo, old.ativo, old.pode_aprovar_medicao, old.pode_excluir_projetos,
        old.pode_editar_revisao, old.lideranca_equipe,
        old.pode_registrar_medicao, old.pode_registrar_fotos, old.pode_preparar_rdo) then
      new.updated_at := clock_timestamp();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end $$;

-- 5) Matriz de permissões: grava tudo ou nada, conferindo a versão.
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
           pode_registrar_medicao = coalesce((it ->> 'pode_registrar_medicao')::boolean, pode_registrar_medicao),
           pode_registrar_fotos = coalesce((it ->> 'pode_registrar_fotos')::boolean, pode_registrar_fotos),
           pode_preparar_rdo = coalesce((it ->> 'pode_preparar_rdo')::boolean, pode_preparar_rdo),
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

-- 2) Carga: só nas colunas criadas agora (rodar de novo não religa o que o
--    administrador desligou). Depois do trigger novo: troca a versão, então
--    quem estava com a matriz aberta recarrega antes de gravar por cima.
do $$
declare
  k text;
begin
  for k in select t.k from tmp_gp_marcas_novas t loop
    execute format(
      'update public.gp_funcoes set %I = true where chave_seed in (%L, %L, %L, %L)',
      k, 'coordenador', 'engenheiro', 'tecnico', 'auxiliar');
    raise notice 'gp_funcoes: coluna % criada (Coordenador, Engenheiro, Técnico e Auxiliar = sim; Supervisor = não).', k;
  end loop;
end $$;
drop table if exists tmp_gp_marcas_novas;

-- 3) A função do usuário logado tem a marca? (perfil ativo; marca
--    desconhecida = false). Lista fechada de marcas: nada de SQL dinâmico.
create or replace function public.gp_funcao_permite(flag text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select case flag
             when 'pode_registrar_medicao' then f.pode_registrar_medicao
             when 'pode_registrar_fotos'   then f.pode_registrar_fotos
             when 'pode_preparar_rdo'      then f.pode_preparar_rdo
             when 'pode_aprovar_medicao'   then f.pode_aprovar_medicao
             when 'pode_excluir_projetos'  then f.pode_excluir_projetos
             when 'pode_editar_revisao'    then f.pode_editar_revisao
             when 'lideranca_equipe'       then f.lideranca_equipe
             else false
           end
      from public.gp_profiles p
      join public.gp_funcoes f on f.nome = p.funcao
     where p.id = auth.uid() and p.ativo
     limit 1), false);
$$;

revoke all on function public.gp_funcao_permite(text) from public, anon;
grant execute on function public.gp_funcao_permite(text) to authenticated, service_role;

-- 4) RLS — policies novas (as de perfil e as de DELETE ficam como estão).
-- gp_coletas: registrar medições / batimetria
drop policy if exists gp_coletas_funcao_insert on public.gp_coletas;
create policy gp_coletas_funcao_insert on public.gp_coletas for insert to authenticated
  with check (excluido_em is null and aprovada_em is null
              and public.gp_funcao_permite('pode_registrar_medicao'));
drop policy if exists gp_coletas_funcao_update on public.gp_coletas;
create policy gp_coletas_funcao_update on public.gp_coletas for update to authenticated
  using (excluido_em is null and public.gp_funcao_permite('pode_registrar_medicao'))
  with check (excluido_em is null and public.gp_funcao_permite('pode_registrar_medicao'));

-- gp_fotos_execucao: registrar coleta de fotos (remover uma foto é UPDATE em
-- itens; apagar o registro inteiro segue só por perfil)
drop policy if exists gp_fotos_execucao_funcao_insert on public.gp_fotos_execucao;
create policy gp_fotos_execucao_funcao_insert on public.gp_fotos_execucao for insert to authenticated
  with check (public.gp_funcao_permite('pode_registrar_fotos'));
drop policy if exists gp_fotos_execucao_funcao_update on public.gp_fotos_execucao;
create policy gp_fotos_execucao_funcao_update on public.gp_fotos_execucao for update to authenticated
  using (public.gp_funcao_permite('pode_registrar_fotos'))
  with check (public.gp_funcao_permite('pode_registrar_fotos'));

-- gp_rdos: preparar RDO
drop policy if exists gp_rdos_funcao_insert on public.gp_rdos;
create policy gp_rdos_funcao_insert on public.gp_rdos for insert to authenticated
  with check (excluido_em is null and public.gp_funcao_permite('pode_preparar_rdo'));
drop policy if exists gp_rdos_funcao_update on public.gp_rdos;
create policy gp_rdos_funcao_update on public.gp_rdos for update to authenticated
  using (excluido_em is null and public.gp_funcao_permite('pode_preparar_rdo'))
  with check (excluido_em is null and public.gp_funcao_permite('pode_preparar_rdo'));

notify pgrst, 'reload schema';
