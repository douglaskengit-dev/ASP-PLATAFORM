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
