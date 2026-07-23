-- Subetapas de revisão/aprovação para as macrofases "Relatório" e "Relatório
-- de Limpeza": envio p/ revisão → revisão → aprovação → aprovado, com desvio
-- para "reenvio necessário" caso a revisão reprove. Indexado por número da
-- macrofase (etapa), então cada uma tem progresso independente.
-- Ver lib/processos/subetapas.ts para a lógica de transição de estados.
alter table gp_processos add column if not exists subetapas jsonb not null default '{}'::jsonb;
