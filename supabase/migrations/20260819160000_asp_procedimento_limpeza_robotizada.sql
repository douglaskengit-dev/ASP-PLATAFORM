-- ============================================================================
-- ASP — Limpeza robotizada vira um dado do procedimento, não uma lista de
-- códigos fixa no código-fonte.
--
-- Até aqui, "este procedimento usa o modelo de relatório da limpeza
-- robotizada" era decidido comparando o código do procedimento contra dois
-- valores fixos em lib/asp/relatorio.ts (CVS 6 de 12/01/2011 e POP 001). Cada
-- procedimento novo que precisasse desse modelo exigia editar aquele array e
-- publicar um deploy — mesmo sendo uma escolha que, por natureza, é do
-- Catálogo, não do código.
--
-- Agora é uma coluna: quem cadastra o procedimento marca a caixinha, sem
-- mexer em código. Populada TRUE para os dois procedimentos que já usavam o
-- modelo, para não mudar nada do que já funciona.
-- ============================================================================
alter table public.gp_procedimentos
  add column if not exists limpeza_robotizada boolean not null default false;

comment on column public.gp_procedimentos.limpeza_robotizada is
  'Usa o modelo de relatório da limpeza robotizada (Sanitização, Coletas, Análise Físico Química e Laboratorial…) em vez do modelo padrão de batimetria.';

update public.gp_procedimentos
set limpeza_robotizada = true
where lower(regexp_replace(codigo, '\s+', '', 'g')) in ('cvs6de12/01/2011', 'pop001')
  and not limpeza_robotizada;

notify pgrst, 'reload schema';
