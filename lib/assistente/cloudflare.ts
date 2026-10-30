/**
 * Assistente pelo Cloudflare Workers AI (plano gratuito: 10.000 neurons/dia,
 * renovados às 00:00 UTC = 21h de Brasília). Formato nativo de function
 * calling do Workers AI: tools {name, description, parameters}; a resposta
 * traz result.tool_calls [{name, arguments}] e o resultado volta como
 * mensagem role "tool".
 */
import { FERRAMENTAS } from "./ferramentas";
import { trechosDoManual } from "./manual-busca";
import { INSTRUCOES_ASSISTENTE } from "./prompt";
import { ErroAssistente, MAX_RODADAS, MSG_RODADAS, type PedidoAssistente } from "./tipos";

/** 131 mil tokens de contexto, function calling e o menor custo por token
 *  entre os modelos com ferramentas do Workers AI. */
export const MODELO_CLOUDFLARE_PADRAO = "@cf/meta/llama-4-scout-17b-16e-instruct";
/** Resultado de ferramenta maior que isto é cortado (economiza cota). */
const MAX_RESULTADO = 12000;

interface ChamadaCf { name: string; arguments?: unknown; parameters?: unknown }
interface MensagemCf { role: "system" | "user" | "assistant" | "tool"; content: string; name?: string }

const TOOLS_CF = FERRAMENTAS.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema }));
const NOMES = new Set(FERRAMENTAS.map((t) => t.name));

function entradaDe(c: ChamadaCf): Record<string, unknown> {
  const a = c.arguments ?? c.parameters ?? {};
  if (typeof a === "string") { try { return JSON.parse(a) || {}; } catch { return {}; } }
  return (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
}

/** Alguns modelos escrevem a chamada como JSON no texto em vez de tool_calls. */
function chamadaNoTexto(texto: string): ChamadaCf | null {
  const t = texto.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!t.startsWith("{")) return null;
  try {
    const j = JSON.parse(t);
    return j && typeof j.name === "string" && NOMES.has(j.name) ? j : null;
  } catch { return null; }
}

async function rodar(modelo: string, mensagens: MensagemCf[]): Promise<{ texto: string; chamadas: ChamadaCf[] }> {
  const conta = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  if (!conta || !token) throw new ErroAssistente(503, "O assistente não está configurado (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN).");
  const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/ai/run/${modelo}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: mensagens, tools: TOOLS_CF, max_tokens: 1500, temperature: 0.2 }),
  });
  const j = await resp.json().catch(() => null) as any;
  if (!resp.ok || !j?.success) {
    const msg = JSON.stringify(j?.errors || j || resp.status);
    console.error("assistente/cloudflare:", resp.status, msg);
    if (resp.status === 429 || /neuron|daily|limit|quota|capacity/i.test(msg)) {
      throw new ErroAssistente(429, "O limite diário gratuito do assistente acabou. Ele volta às 21h (horário de Brasília).");
    }
    if (resp.status === 401 || resp.status === 403) throw new ErroAssistente(503, "O assistente não está configurado (token do Cloudflare inválido).");
    throw new ErroAssistente(502, "O assistente não conseguiu responder agora. Tente de novo.");
  }
  const r = j.result || {};
  const texto = typeof r.response === "string" ? r.response : (r.response != null ? JSON.stringify(r.response) : "");
  const chamadas: ChamadaCf[] = Array.isArray(r.tool_calls) ? r.tool_calls.map((c: any) => c.function || c) : [];
  return { texto, chamadas };
}

export async function responderCloudflare({ historico, contexto, executar }: PedidoAssistente): Promise<string> {
  const modelo = process.env.ASSISTENTE_MODEL || MODELO_CLOUDFLARE_PADRAO;
  const pergunta = historico[historico.length - 1].texto;
  const mensagens: MensagemCf[] = [
    { role: "system", content: `${INSTRUCOES_ASSISTENTE}\n\n${contexto}\n\n=== TRECHOS DO MANUAL DO USUÁRIO ===\n${trechosDoManual(pergunta)}` },
    ...historico.map((m): MensagemCf => ({ role: m.papel === "usuario" ? "user" : "assistant", content: m.texto })),
  ];
  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const { texto, chamadas } = await rodar(modelo, mensagens);
    const pedidas = chamadas.length ? chamadas : [chamadaNoTexto(texto)].filter((c): c is ChamadaCf => !!c);
    if (!pedidas.length) return texto.trim() || "Não consegui montar uma resposta. Tente reformular a pergunta.";
    for (const c of pedidas) {
      const entrada = entradaDe(c);
      const r = NOMES.has(c.name) ? await executar(c.name, entrada) : { conteudo: `Ferramenta desconhecida: ${c.name}`, erro: true };
      mensagens.push({ role: "assistant", content: JSON.stringify({ name: c.name, arguments: entrada }) });
      mensagens.push({ role: "tool", name: c.name, content: r.conteudo.slice(0, MAX_RESULTADO) });
    }
  }
  return MSG_RODADAS;
}
