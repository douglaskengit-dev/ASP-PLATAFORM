/** Validação de dados compartilhada (navegador + API). Ponto único de
 * importação: `import { … } from "@/lib/validacao"`.
 *
 * Princípio: o que é digitado não pode ficar ambíguo nem duplicado. Erros
 * (⛔) bloqueiam e a API repete a checagem; avisos (⚠️) só alertam. Cada
 * fase do fluxo ganha seu arquivo de regras (projeto.ts = Fase 1;
 * ordemServico.ts + agendamento.ts = Fase 2). */
export * from "./resultado";
export * from "./texto";
export * from "./formatos";
export * from "./codigoProjeto";
export * from "./projeto";
export * from "./cliente";
export * from "./feriados";
export * from "./ordemServico";
export * from "./agendamento";
