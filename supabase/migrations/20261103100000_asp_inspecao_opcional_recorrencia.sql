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

-- PostgREST: recarrega o cache do schema.
notify pgrst, 'reload schema';
