-- ============================================================================
-- ASP — Migração dos dados da base antiga (xyngrzennrozwcpgxmmm) para a base
-- oficial. Rodar no SQL Editor da base de DESTINO (ayqdqwnrgbiqjwjpccuj —
-- https://supabase.com/dashboard/project/ayqdqwnrgbiqjwjpccuj),
-- DEPOIS do script verificacao-db-asp.sql (que garante as tabelas).
--
-- Conteúdo: Catálogo completo (7 equipamentos + 2 procedimentos).
--
-- ATENÇÃO — CARGA INICIAL, UMA VEZ SÓ. Não rode de novo numa base em uso: o
-- Catálogo agora é mantido pela tela (aba Catálogo).
-- Por segurança, rodar de novo não duplica nada: cada linha só entra se NÃO
-- existir item (ativo OU desativado) com o mesmo slug, o mesmo nome ou o
-- mesmo código pela chave do Catálogo (sem caixa, acento e espaço extra; no
-- código, também sem pontuação — "PR BAT 001" = "PR-BAT-001"). Um item
-- renomeado ou desativado não "volta" por causa daqui — mas um item
-- EXCLUÍDO de vez voltaria (não há como saber que ele existiu).
-- ============================================================================

insert into public.gp_equipamentos (slug, nome, especificacoes, fotos, ordem)
select v.slug, v.nome, v.especificacoes, v.fotos, v.ordem from (values
 ('rov', 'ROV de inspeção visual',
  '[{"rotulo":"Descrição","valor":"Veículo submersível operado remotamente, com câmera de alta definição e iluminação LED"}]'::jsonb, '[]'::jsonb, 1),
 ('sonar', 'Sonar batimétrico',
  '[{"rotulo":"Descrição","valor":"Transdutor acoplado ao ROV para medição da distância até o sedimento"}]'::jsonb, '[]'::jsonb, 2),
 ('regua', 'Régua graduada de conferência',
  '[{"rotulo":"Descrição","valor":"Com peso de 0,15 m na extremidade, para validação das leituras do sonar"}]'::jsonb, '[]'::jsonb, 3),
 ('umbilical', 'Cabo umbilical',
  '[{"rotulo":"Descrição","valor":"Transmissão de dados e energia entre o ROV e a estação de superfície"}]'::jsonb, '[]'::jsonb, 4),
 ('estacao', 'Estação de superfície',
  '[{"rotulo":"Descrição","valor":"Console de comando com monitor e gravação das imagens"}]'::jsonb, '[]'::jsonb, 5),
 ('trena', 'Trena eletrônica',
  '[{"rotulo":"Descrição","valor":"Medição das dimensões do tanque"}]'::jsonb, '[]'::jsonb, 6),
 ('epi', 'EPIs de espaço confinado',
  '[{"rotulo":"Descrição","valor":"Conforme NR-33, incluindo detector de gases e cinto de segurança"}]'::jsonb, '[]'::jsonb, 7)
) as v (slug, nome, especificacoes, fotos, ordem)
where not exists (
  select 1 from public.gp_equipamentos e
   where e.slug = v.slug
      or btrim(regexp_replace(lower(translate(e.nome, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '\s+', ' ', 'g'))
       = btrim(regexp_replace(lower(translate(v.nome, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '\s+', ' ', 'g'))
);

insert into public.gp_procedimentos (codigo, nome, metodos, equipamentos, ordem)
select v.codigo, v.nome, v.metodos, v.equipamentos, v.ordem from (values
 ('PR-BAT-001', 'Batimetria por ROV com sonar',
  'O levantamento batimétrico foi executado por veículo submersível operado remotamente (ROV) equipado com sonar, sem necessidade de esvaziamento do reservatório.',
  '["rov","sonar","regua","umbilical","estacao","epi"]'::jsonb, 1),
 ('PR-INSP-002', 'Inspeção visual submersa',
  'A inspeção visual foi executada por veículo submersível operado remotamente (ROV), com registro em vídeo do costado e do fundo do reservatório.',
  '["rov","umbilical","estacao","epi"]'::jsonb, 2)
) as v (codigo, nome, metodos, equipamentos, ordem)
where not exists (
  select 1 from public.gp_procedimentos p
   where regexp_replace(lower(translate(p.codigo, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]', '', 'g')
       = regexp_replace(lower(translate(v.codigo, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]', '', 'g')
      or btrim(regexp_replace(lower(translate(p.nome, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '\s+', ' ', 'g'))
       = btrim(regexp_replace(lower(translate(v.nome, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '\s+', ' ', 'g'))
);

-- ============================================================================
-- OPCIONAL — clientes da base antiga (parecem teste do sistema anterior:
-- prefeituras, não clientes industriais). Descomente só se quiser levá-los.
-- ============================================================================
-- insert into public.gp_orgaos (tipo_ente, razao_social, cnpj, cidade, uf) values
--  ('Município', 'MUNICÍPIO DA ESTÂNCIA BALNEÁRIA DE PRAIA GRANDE', '46177531000155', 'São Paulo', 'SP'),
--  ('Município', 'Prefeitura Municipal de São Roque', '70946009000175', 'São Roque', 'SP')
-- on conflict do nothing;

notify pgrst, 'reload schema';
select (select count(*) from public.gp_equipamentos) as equipamentos,
       (select count(*) from public.gp_procedimentos) as procedimentos;
