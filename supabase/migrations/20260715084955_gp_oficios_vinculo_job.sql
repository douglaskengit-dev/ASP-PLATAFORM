-- Vincula ofício ao processo que o consumiu (some do drop enquanto vinculado)
alter table public.gp_oficios add column if not exists job_id text;
