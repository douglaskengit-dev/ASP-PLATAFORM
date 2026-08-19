-- ============================================================================
-- ASP — Backfill de topicos_lista a partir da configuração antiga (topicos).
--
-- A migration 20260817100000 criou topicos_lista com default '[]', mas não
-- copiou nada da coluna antiga: um procedimento que já tinha `topicos`
-- configurado (ex.: [0,1,2,3,4,5,6,8,9,10]) passou a aparecer no Catálogo
-- como "ainda não configurado", quando a configuração continuava no banco,
-- só que numa coluna que ninguém lia mais.
--
-- A aplicação já reconstruía isso EM TODA LEITURA (topicosDoProcedimento, em
-- lib/asp/relatorio.ts) — esta migration faz a mesma conta, uma vez só, para
-- fechar a lacuna que ficou desde 20260817100000. O código de leitura
-- continua existindo como rede de proteção (para uma linha nova que chegue
-- com `topicos` preenchido e `topicos_lista` ainda vazia), mas deixa de ser
-- o único lugar onde a resposta correta existe.
--
-- Mesmas duas condições de segurança que topicosDoProcedimento já aplica —
-- reconstruir com os títulos do modelo padrão (batimetria, 1 a 10) só é
-- confiável quando o procedimento REALMENTE usa esse modelo:
--
--   1. Não é procedimento de limpeza robotizada (CVS 6 / POP 001), cujo
--      relatório segue outro modelo — onde 8, 9 e 10 são Sanitização, Coleta
--      das amostras e Limpeza robotizada, não os títulos de batimetria.
--   2. Não tem modelo próprio (template_path), que pode numerar as seções
--      de outro jeito.
--
-- Fora dessas duas exceções, `topicos` só pode ter sido preenchido contra o
-- modelo padrão da ASP — é a única lista que existia antes da 20260817100000.
-- ============================================================================
with topicos_padrao(numero, titulo) as (
  values
    (1, 'Identificação do local'),
    (2, 'Identificação do tanque'),
    (3, 'Métodos'),
    (4, 'Equipamentos utilizados'),
    (5, 'Equipe de trabalho'),
    (6, 'Dados reservatório'),
    (7, 'Batimetria'),
    (8, 'Foto da Inspeção Visual Interna'),
    (9, 'Conclusão'),
    (10, 'Recomendações')
)
update public.gp_procedimentos p
set topicos_lista = (
  select jsonb_agg(
    jsonb_build_object(
      'numero', tp.numero,
      'titulo', tp.titulo,
      'titulo_origem', tp.titulo,
      'ativo', p.topicos @> to_jsonb(tp.numero)
    )
    order by tp.numero
  )
  from topicos_padrao tp
)
where p.topicos_lista = '[]'::jsonb
  and jsonb_typeof(p.topicos) = 'array'
  and coalesce(p.template_path, '') = ''
  -- mesma normalização de ehLimpezaRobotizada (lib/asp/relatorio.ts):
  -- minúsculas, sem nenhum espaço em branco.
  and lower(regexp_replace(p.codigo, '\s+', '', 'g')) not in ('cvs6de12/01/2011', 'pop001');
