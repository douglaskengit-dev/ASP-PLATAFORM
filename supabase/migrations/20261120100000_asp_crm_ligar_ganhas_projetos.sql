-- Liga as oportunidades ganhas antigas (de antes do botão "Abrir projeto") aos
-- projetos que já existem, só quando não há dúvida:
--   * a oportunidade é ganha, tem cliente e data do ganho e ainda não tem projeto;
--   * o projeto é do mesmo cliente, não está na lixeira nem ligado a outra
--     oportunidade, e foi aberto entre 30 dias antes e 180 dias depois do ganho;
--   * a oportunidade tem um único projeto nessa janela, e esse projeto é
--     candidato de uma única oportunidade.
-- As que ficarem de fora são ligadas na ficha ("Ligar a projeto existente").
-- Precisa da migração 20261118100000 (coluna projeto_id). Pode rodar mais de uma vez.

with ganhas as (
  select p.id, p.orgao_id, p.resultado_em
  from public.gp_processos p
  where p.resultado = 'ganha' and p.projeto_id is null and p.orgao_id is not null and p.resultado_em is not null
),
livres as (
  select j.id, j.cliente_id,
         coalesce(j.data_abertura::date, (j.criado_em at time zone 'America/Sao_Paulo')::date) as dia
  from public.gp_projetos j
  where j.excluido_em is null
    and not exists (select 1 from public.gp_processos x where x.projeto_id = j.id)
),
pares as (
  select g.id as processo_id, l.id as projeto_id
  from ganhas g
  join livres l on l.cliente_id = g.orgao_id
   and l.dia between g.resultado_em - 30 and g.resultado_em + 180
),
unicos as (
  select pr.processo_id, pr.projeto_id
  from pares pr
  where (select count(*) from pares a where a.processo_id = pr.processo_id) = 1
    and (select count(*) from pares b where b.projeto_id = pr.projeto_id) = 1
)
update public.gp_processos p
set projeto_id = u.projeto_id, updated_at = now()
from unicos u
where p.id = u.processo_id and p.projeto_id is null;
