-- ============================================================================
-- ASP — Cadastro do tanque na inspeção.
--
-- Dimensões, capacidade e material entram uma vez, ao criar a inspeção dentro
-- do projeto, e alimentam a identificação do tanque em todo relatório gerado
-- depois. Antes eram redigitados a cada relatório, e o mesmo tanque saía com
-- medidas diferentes de um documento para o outro.
--
--   tanque  { "formato": "circular" | "retangular",
--             "diametro": 12.5,      -- circular (m)
--             "comprimento": null,   -- retangular (m)
--             "largura": null,       -- retangular (m)
--             "altura": 8,           -- m
--             "capacidade": 1500,    -- nominal, de placa (m³)
--             "material": "Aço carbono" }
--           Comprimentos em METROS e capacidade em M³ — as unidades em que o
--           relatório apresenta esses valores. As medidas do outro formato
--           ficam nulas, para não sobrar diâmetro em tanque retangular.
--           NULL = inspeção anterior a esta mudança; a tela mostra "não
--           cadastrado" e o cadastro é preenchido pelo botão de editar.
-- ============================================================================
alter table public.gp_inspecoes add column if not exists tanque jsonb;

comment on column public.gp_inspecoes.tanque is
  'Cadastro do tanque desta inspeção: {formato, diametro|comprimento+largura, altura (m), capacidade (m³), material}.';

notify pgrst, 'reload schema';
