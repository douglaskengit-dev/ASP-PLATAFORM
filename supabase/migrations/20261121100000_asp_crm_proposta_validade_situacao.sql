-- ============================================================================
-- ASP — Follow-up (CRM): validade e situação de cada versão da proposta.
--   validade  : até quando a proposta vale (opcional, não antes do envio).
--   situacao  : enviada (padrão), aceita ou recusada. Só uma versão aceita por
--               oportunidade. "Vencida" e "substituída" não são gravadas: a
--               tela calcula pela validade e pela versão mais nova.
-- Também cria a policy de UPDATE que faltava: sem ela o anexo enviado junto
-- com a versão não ficava registrado (o arquivo subia, mas a versão não
-- apontava para ele).
-- Acerto inicial: nas oportunidades já fechadas, a versão mais nova vira
-- aceita (ganha) ou recusada (perdida). Pode rodar mais de uma vez.
-- ============================================================================

alter table public.gp_processo_propostas add column if not exists validade date;
alter table public.gp_processo_propostas add column if not exists situacao text not null default 'enviada';
alter table public.gp_processo_propostas add column if not exists situacao_em date;
alter table public.gp_processo_propostas add column if not exists situacao_por uuid references public.gp_profiles (id) on delete set null;

alter table public.gp_processo_propostas drop constraint if exists gp_processo_propostas_situacao_check;
alter table public.gp_processo_propostas add constraint gp_processo_propostas_situacao_check
  check (situacao in ('enviada','aceita','recusada'));
alter table public.gp_processo_propostas drop constraint if exists gp_processo_propostas_validade_check;
alter table public.gp_processo_propostas add constraint gp_processo_propostas_validade_check
  check (validade is null or validade >= data);

create unique index if not exists uq_gp_processo_propostas_aceita
  on public.gp_processo_propostas (processo_id) where situacao = 'aceita';

drop policy if exists gp_processo_propostas_update on public.gp_processo_propostas;
create policy gp_processo_propostas_update on public.gp_processo_propostas for update to authenticated
  using (public.gp_perfil_atual_asp() in ('admin','gerencia','comercial'))
  with check (public.gp_perfil_atual_asp() in ('admin','gerencia','comercial'));

-- Acerto inicial: só a versão mais nova de cada oportunidade fechada.
with ultima as (
  select distinct on (pp.processo_id) pp.id, p.resultado, p.resultado_em
  from public.gp_processo_propostas pp
  join public.gp_processos p on p.id = pp.processo_id
  where p.resultado in ('ganha','perdida')
  order by pp.processo_id, pp.versao desc
)
update public.gp_processo_propostas pp
   set situacao = case when u.resultado = 'ganha' then 'aceita' else 'recusada' end,
       situacao_em = coalesce(u.resultado_em::date, pp.data)
  from ultima u
 where pp.id = u.id
   and pp.situacao = 'enviada'
   and not exists (select 1 from public.gp_processo_propostas o
                    where o.processo_id = pp.processo_id and o.situacao = 'aceita');

-- PostgREST: recarrega o cache do schema.
notify pgrst, 'reload schema';
