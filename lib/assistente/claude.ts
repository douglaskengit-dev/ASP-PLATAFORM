/** Assistente pela API da Anthropic (opcional: ASSISTENTE_PROVEDOR=anthropic).
 *  Manda o manual inteiro no prompt, em cache. */
import Anthropic from "@anthropic-ai/sdk";
import { FERRAMENTAS } from "./ferramentas";
import { SISTEMA_ASSISTENTE } from "./prompt";
import { ErroAssistente, MAX_RODADAS, MSG_RODADAS, type PedidoAssistente } from "./tipos";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ErroAssistente(503, "O assistente não está configurado (chave da IA).");
  client = new Anthropic({ apiKey });
  return client;
}

export async function responderClaude({ historico, contexto, executar }: PedidoAssistente): Promise<string> {
  const mensagens: Anthropic.Beta.BetaMessageParam[] = historico.map((m) => ({
    role: m.papel === "usuario" ? "user" : "assistant", content: m.texto,
  }));
  try {
    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      const resp = await getClient().beta.messages.create({
        model: process.env.ASSISTENTE_MODEL || "claude-opus-5-5",
        max_tokens: 8000,
        output_config: { effort: "low" },
        // Recusa da IA principal: a API refaz a pergunta num modelo reserva.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [
          // tools + este bloco ficam no cache; o contexto do dia vem depois
          { type: "text", text: SISTEMA_ASSISTENTE, cache_control: { type: "ephemeral" } },
          { type: "text", text: contexto },
        ],
        tools: FERRAMENTAS,
        messages: mensagens,
      } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);

      if (resp.stop_reason === "refusal") return "Não posso ajudar com isso. Pergunte sobre o uso da plataforma ou sobre os projetos e OS.";
      if (resp.stop_reason !== "tool_use") {
        const texto = resp.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        return texto || "Não consegui montar uma resposta. Tente reformular a pergunta.";
      }
      // conteúdo inteiro (com blocos de raciocínio) volta para a próxima rodada
      mensagens.push({ role: "assistant", content: resp.content as Anthropic.Beta.BetaContentBlockParam[] });
      const usos = resp.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const resultados = await Promise.all(usos.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const r = await executar(u.name, (u.input || {}) as Record<string, unknown>);
        return { type: "tool_result", tool_use_id: u.id, content: r.conteudo, ...(r.erro ? { is_error: true } : {}) };
      }));
      mensagens.push({ role: "user", content: resultados });
    }
    return MSG_RODADAS;
  } catch (e) {
    if (e instanceof ErroAssistente) throw e;
    console.error("assistente/claude:", e);
    if (e instanceof Anthropic.RateLimitError) throw new ErroAssistente(429, "Muitas perguntas ao mesmo tempo. Aguarde alguns segundos e tente de novo.");
    if (e instanceof Anthropic.AuthenticationError) throw new ErroAssistente(503, "O assistente não está configurado (chave da IA).");
    throw new ErroAssistente(502, "O assistente não conseguiu responder agora. Tente de novo.");
  }
}
