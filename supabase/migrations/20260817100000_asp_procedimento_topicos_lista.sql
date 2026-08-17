-- ============================================================================
-- ASP — Os tópicos passam a pertencer ao PROCEDIMENTO, não ao arquivo .docx.
--
-- Até aqui a lista de seções era lida do modelo a cada abertura de tela. Isso
-- mantinha modelo e sistema sempre iguais, mas impedia editar os tópicos sem
-- mexer no Word — e um procedimento sem modelo ficava preso à lista padrão.
--
-- Agora a lista mora aqui e é editável no Catálogo. O modelo continua útil:
-- serve para IMPORTAR as seções de uma vez ("Importar do modelo"), e daí em
-- diante a verdade é esta coluna.
--
--   topicos_lista  [{ "numero": 1, "titulo": "Identificação do local",
--                     "ativo": true }, …]
--                  A ordem do array é a ordem no relatório; `numero` é apenas
--                  o número de origem, útil para casar com o modelo.
--                  Vazio/NULL = ainda não configurado; usa o modelo ou o padrão.
-- ============================================================================
alter table public.gp_procedimentos
  add column if not exists topicos_lista jsonb not null default '[]'::jsonb;

comment on column public.gp_procedimentos.topicos_lista is
  'Tópicos do relatório deste procedimento: [{numero, titulo, ativo}]. Editável no Catálogo; pode ser importada do modelo .docx.';

notify pgrst, 'reload schema';
