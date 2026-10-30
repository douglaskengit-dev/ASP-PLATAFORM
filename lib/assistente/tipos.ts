export interface MensagemChat { papel: "usuario" | "assistente"; texto: string }

/** Roda uma ferramenta e devolve o resultado já em texto (JSON). */
export type ExecutarFerramenta = (nome: string, entrada: Record<string, unknown>) => Promise<{ conteudo: string; erro?: boolean }>;

export interface PedidoAssistente {
  historico: MensagemChat[];
  /** Data de hoje e quem pergunta. */
  contexto: string;
  executar: ExecutarFerramenta;
}

/** Erro com mensagem já pronta para o usuário. */
export class ErroAssistente extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}

/** Rodadas de ferramenta por pergunta (evita laço sem fim). */
export const MAX_RODADAS = 6;
export const MSG_RODADAS = "A pergunta exigiu consultas demais. Tente ser mais específico (ex.: cite o cliente ou a OS).";
