-- ============================================================================
-- ASP — Follow-up (CRM): título da oportunidade vinculado ao Procedimento.
-- O título é o nome do procedimento escolhido no Catálogo; "Outros" deixa
-- procedimento_id nulo e o título em texto livre. O id não muda quando o
-- procedimento é renomeado; excluir o procedimento só solta o vínculo.
-- Pode rodar mais de uma vez.
-- ============================================================================
alter table public.gp_processos add column if not exists procedimento_id uuid references public.gp_procedimentos (id) on delete set null;
create index if not exists idx_gp_processos_procedimento on public.gp_processos (procedimento_id);

-- Oportunidades que já existem com o título igual ao nome de um procedimento.
update public.gp_processos p set procedimento_id = pr.id
  from public.gp_procedimentos pr
  where p.procedimento_id is null and lower(btrim(p.titulo)) = lower(btrim(pr.nome));
