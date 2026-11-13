-- Follow-up como CRM: etapas comerciais, dados da oportunidade, resultado,
-- próxima ação e atividades. Pode rodar mais de uma vez.

-- 1) Dados da oportunidade -----------------------------------------------------
alter table public.gp_processos add column if not exists resultado text not null default 'aberta';
alter table public.gp_processos add column if not exists resultado_em date;
alter table public.gp_processos add column if not exists motivo_perda text;
alter table public.gp_processos add column if not exists motivo_perda_detalhe text;
alter table public.gp_processos add column if not exists valor numeric(14,2);
alter table public.gp_processos add column if not exists origem text;
alter table public.gp_processos add column if not exists responsavel_id uuid references public.gp_profiles (id) on delete set null;
alter table public.gp_processos add column if not exists contato_id uuid references public.gp_orgaos_contatos (id) on delete set null;
alter table public.gp_processos add column if not exists previsao_fechamento date;
alter table public.gp_processos add column if not exists proxima_acao text;
alter table public.gp_processos add column if not exists proxima_acao_em date;
-- 1 = etapas antigas (8 macrofases); 2 = etapas comerciais (5).
alter table public.gp_processos add column if not exists etapas_versao int not null default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gp_processos_resultado_chk') then
    alter table public.gp_processos add constraint gp_processos_resultado_chk check (resultado in ('aberta','ganha','perdida'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gp_processos_valor_chk') then
    alter table public.gp_processos add constraint gp_processos_valor_chk check (valor is null or valor >= 0);
  end if;
end $$;

create index if not exists idx_gp_processos_responsavel on public.gp_processos (responsavel_id);
create index if not exists idx_gp_processos_proxima_acao on public.gp_processos (proxima_acao_em) where resultado = 'aberta';

-- 2) Etapas antigas → comerciais ---------------------------------------------
-- Antigas: 0 Abertura, 1 Dados Iniciais do Cliente, 2 Agendar visita,
-- 3 Coleta de dados de Campo, 4 Relatório, 5 Agendar execução,
-- 6 Relatório de Limpeza, 7 Finalizado.
-- Novas: 0 Prospecção, 1 Qualificação, 2 Visita técnica, 3 Proposta,
-- 4 Negociação. Da antiga 5 em diante a venda já fechou: vira Negociação
-- com resultado "ganha" (data = primeira entrada na antiga 5 ou depois).
create or replace function pg_temp.gp_etapa_nova(e int) returns int language sql immutable as $$
  select case when e <= 1 then e when e in (2, 3) then 2 when e = 4 then 3 else 4 end
$$;

update public.gp_processos p set
  etapa = pg_temp.gp_etapa_nova(p.etapa),
  resultado = case when p.etapa >= 5 then 'ganha' else p.resultado end,
  resultado_em = case when p.etapa >= 5 then coalesce(
      (select min((h->>'data_autenticacao')::date) from jsonb_array_elements(coalesce(p.historico_etapas, '[]'::jsonb)) h
        where (h->>'etapa') ~ '^\d+$' and (h->>'etapa')::int >= 5 and (h->>'data_autenticacao') ~ '^\d{4}-\d{2}-\d{2}$'),
      p.updated_at::date)
    else p.resultado_em end,
  historico_etapas = coalesce((
    select jsonb_agg(
      case when (t.h->>'etapa') ~ '^\d+$'
        then t.h || jsonb_build_object('etapa', pg_temp.gp_etapa_nova((t.h->>'etapa')::int), 'etapa_antiga', (t.h->>'etapa')::int)
        else t.h end
      order by t.ord)
    from jsonb_array_elements(coalesce(p.historico_etapas, '[]'::jsonb)) with ordinality as t(h, ord)
  ), '[]'::jsonb),
  etapas_versao = 2
where p.etapas_versao = 1;

-- Processos criados daqui em diante já nascem nas etapas novas.
alter table public.gp_processos alter column etapas_versao set default 2;

-- Responsável inicial = quem abriu o processo.
update public.gp_processos set responsavel_id = criado_por where responsavel_id is null and criado_por is not null;

-- 3) Atividades (linha do tempo) ------------------------------------------------
create table if not exists public.gp_processo_atividades (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.gp_processos (id) on delete cascade,
  tipo text not null check (tipo in ('ligacao','email','whatsapp','reuniao','visita','nota')),
  descricao text not null,
  data date not null,
  criado_por uuid references public.gp_profiles (id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_gp_processo_atividades_processo on public.gp_processo_atividades (processo_id, data desc);

alter table public.gp_processo_atividades enable row level security;
drop policy if exists gp_processo_atividades_select on public.gp_processo_atividades;
create policy gp_processo_atividades_select on public.gp_processo_atividades for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
drop policy if exists gp_processo_atividades_insert on public.gp_processo_atividades;
create policy gp_processo_atividades_insert on public.gp_processo_atividades for insert to authenticated
  with check (public.gp_perfil_atual_asp() in ('admin','gerencia','comercial') and criado_por = auth.uid());
drop policy if exists gp_processo_atividades_delete on public.gp_processo_atividades;
create policy gp_processo_atividades_delete on public.gp_processo_atividades for delete to authenticated
  using (criado_por = auth.uid() or public.gp_perfil_atual_asp() = 'admin');

-- 4) Lembrete da próxima ação (um por oportunidade e data) ---------------------
create table if not exists public.gp_lembretes_proxima_acao (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.gp_processos (id) on delete cascade,
  data date not null,
  notificado_em timestamptz not null default now()
);
create unique index if not exists uq_gp_lembretes_proxima_acao on public.gp_lembretes_proxima_acao (processo_id, data);
alter table public.gp_lembretes_proxima_acao enable row level security;
drop policy if exists gp_lembretes_proxima_acao_select on public.gp_lembretes_proxima_acao;
create policy gp_lembretes_proxima_acao_select on public.gp_lembretes_proxima_acao for select to authenticated
  using (public.gp_perfil_atual_asp() is not null);
-- Sem policy de insert/update/delete: só a chave de serviço (API) grava.
