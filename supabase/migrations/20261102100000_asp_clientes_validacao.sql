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

notify pgrst, 'reload schema';
