-- D34: time trabalha em conjunto nos mesmos processos — qualquer usuário
-- ativo (independente de ter criado ou não) pode ver e editar os
-- processos e as análises de TR. "Quem criou" continua só visível para
-- admin (isso é feito na API, não no banco). Exclusão continua restrita
-- ao criador ou a um admin, por segurança.

alter policy gp_processos_select on gp_processos
  using (exists (select 1 from gp_profiles p where p.id = auth.uid() and p.ativo));

alter policy gp_processos_update on gp_processos
  using (exists (select 1 from gp_profiles p where p.id = auth.uid() and p.ativo));

alter policy gp_cadastros_tr_select on gp_cadastros_tr
  using (exists (select 1 from gp_profiles p where p.id = auth.uid() and p.ativo));
