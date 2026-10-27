-- ============================================================================
-- ASP — Coleta de fotos da execução: higienização do robô (água potável).
--
-- gp_fotos_execucao.robo_higienizacao  a seção "Higienização do robô" (foto
--   do procedimento + foto do robô higienizado) é exigida nesta OS. Como as
--   coletas de água, nasce com o valor de gp_procedimentos.agua_potavel e
--   depois é manual, por OS.
--
-- Carga (só quando a coluna é criada agora): liga a seção nas coletas já
-- existentes de OSs abertas, até a fase 7, cujo procedimento é de água
-- potável. OSs da fase 8 em diante não ganham pendência retroativa.
-- A vaga nova "Coleta de água para envio de análise" vive no jsonb `itens`
-- — sem coluna nova. Idempotente.
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'gp_fotos_execucao'
                   and column_name = 'robo_higienizacao') then
    alter table public.gp_fotos_execucao add column robo_higienizacao boolean not null default false;
    update public.gp_fotos_execucao f set robo_higienizacao = true
      from public.gp_inspecoes i
     where i.id = f.inspecao_id
       and i.encerrada_em is null
       and i.fase <= 7
       and exists (select 1 from public.gp_procedimentos p
                   where p.codigo = i.procedimento and p.agua_potavel);
  end if;
end $$;

comment on column public.gp_fotos_execucao.robo_higienizacao is
  'Seção "Higienização do robô" exigida nesta OS (procedimento + robô higienizado). Nasce de gp_procedimentos.agua_potavel; depois é manual.';

notify pgrst, 'reload schema';
