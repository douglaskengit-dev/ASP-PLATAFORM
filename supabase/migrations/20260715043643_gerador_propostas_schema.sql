-- Bucket privado para TRs, DOCX gerados e ofícios
-- (Obs.: a tabela gp_propostas do modelo original foi omitida nesta recriação
-- por estar em desuso — nenhuma rota da aplicação a referencia.)
insert into storage.buckets (id, name, public)
values ('gp-arquivos', 'gp-arquivos', false)
on conflict (id) do nothing;
