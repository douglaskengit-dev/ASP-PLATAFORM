import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { FERRAMENTAS, executarFerramenta } from "@/lib/assistente/ferramentas";
import { SISTEMA_ASSISTENTE, contextoDaSessao } from "@/lib/assistente/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODELO = process.env.ASSISTENTE_MODEL || "claude-opus-5-5";
/** Rodadas de ferramenta por pergunta (evita laço sem fim). */
const MAX_RODADAS = 6;
const MAX_MENSAGENS = 20;
const MAX_CARACTERES = 4000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada.");
  client = new Anthropic({ apiKey });
  return client;
}

interface MensagemChat { papel: "usuario" | "assistente"; texto: string }

/** Assistente da plataforma: responde dúvidas de uso (manual) e consulta os
 *  dados do sistema com ferramentas só de leitura, sob o RLS de quem pergunta.
 *  O histórico vem do navegador (só texto) a cada pergunta. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });

  const corpo = (await req.json().catch(() => null)) as { mensagens?: MensagemChat[] } | null;
  const historico = (Array.isArray(corpo?.mensagens) ? corpo!.mensagens : [])
    .filter((m) => (m?.papel === "usuario" || m?.papel === "assistente") && typeof m.texto === "string" && m.texto.trim())
    .slice(-MAX_MENSAGENS);
  while (historico.length && historico[0].papel !== "usuario") historico.shift();
  if (!historico.length || historico[historico.length - 1].papel !== "usuario") {
    return NextResponse.json({ erro: "Envie uma pergunta." }, { status: 400 });
  }

  const mensagens: Anthropic.Beta.BetaMessageParam[] = historico.map((m) => ({
    role: m.papel === "usuario" ? "user" : "assistant",
    content: m.texto.slice(0, MAX_CARACTERES),
  }));
  const sb = getSupabaseRouteClient();
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  try {
    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      const resp = await getClient().beta.messages.create({
        model: MODELO,
        max_tokens: 8000,
        output_config: { effort: "low" },
        // Recusa da IA principal: a API refaz a pergunta num modelo reserva.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [
          // tools + este bloco ficam no cache; o contexto do dia vem depois
          { type: "text", text: SISTEMA_ASSISTENTE, cache_control: { type: "ephemeral" } },
          { type: "text", text: contextoDaSessao(profile.nome_completo, profile.perfil, hoje) },
        ],
        tools: FERRAMENTAS,
        messages: mensagens,
      } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);

      if (resp.stop_reason === "refusal") {
        return NextResponse.json({ resposta: "Não posso ajudar com isso. Pergunte sobre o uso da plataforma ou sobre os projetos e OS." });
      }
      if (resp.stop_reason !== "tool_use") {
        const texto = resp.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        return NextResponse.json({ resposta: texto || "Não consegui montar uma resposta. Tente reformular a pergunta." });
      }
      // conteúdo inteiro (com blocos de raciocínio) volta para a próxima rodada
      mensagens.push({ role: "assistant", content: resp.content as Anthropic.Beta.BetaContentBlockParam[] });
      const usos = resp.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const resultados = await Promise.all(usos.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          const r = await executarFerramenta(sb, u.name, (u.input || {}) as Record<string, unknown>);
          return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r) };
        } catch (e: any) {
          console.error("assistente/ferramenta:", u.name, e);
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Falha na consulta: ${e?.message || e}` };
        }
      }));
      mensagens.push({ role: "user", content: resultados });
    }
    return NextResponse.json({ resposta: "A pergunta exigiu consultas demais. Tente ser mais específico (ex.: cite o cliente ou a OS)." });
  } catch (e) {
    console.error("assistente:", e);
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ erro: "Muitas perguntas ao mesmo tempo. Aguarde alguns segundos e tente de novo." }, { status: 429 });
    }
    if (e instanceof Anthropic.AuthenticationError || (e instanceof Error && /ANTHROPIC_API_KEY/.test(e.message))) {
      return NextResponse.json({ erro: "O assistente não está configurado (chave da IA)." }, { status: 503 });
    }
    return NextResponse.json({ erro: "O assistente não conseguiu responder agora. Tente de novo." }, { status: 502 });
  }
}
