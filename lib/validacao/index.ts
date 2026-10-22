/** Validação de dados compartilhada (navegador + API). Ponto único de
 * importação: `import { … } from "@/lib/validacao"`.
 *
 * Princípio: o que é digitado não pode ficar ambíguo nem duplicado. Erros
 * (⛔) bloqueiam e a API repete a checagem; avisos (⚠️) só alertam. Cada
 * fase do fluxo ganha seu arquivo de regras (projeto.ts = Fase 1;
 * ordemServico.ts + agendamento.ts = Fase 2; medicao.ts + coleta.ts +
 * checklist.ts = Fase 3; relatorio.ts = Fase 4; aprovacao.ts = Fases 5/9;
 * periodo.ts + execucao.ts = Fase 6). */
export * from "./resultado";
export * from "./texto";
export * from "./formatos";
export * from "./codigoProjeto";
export * from "./projeto";
export * from "./cliente";
export * from "./feriados";
export * from "./ordemServico";
export * from "./periodo";
export * from "./agendamento";
export * from "./execucao";
export * from "./medicao";
export * from "./coleta";
export * from "./checklist";
export * from "./relatorio";
export * from "./aprovacao";
