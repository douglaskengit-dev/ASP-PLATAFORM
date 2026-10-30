import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { executarFerramenta } from "@/lib/assistente/ferramentas";
import { contextoDaSessao } from "@/lib/assistente/prompt";
import { responderCloudflare } from "@/lib/assistente/cloudflare";
import { responderClaude } from "@/lib/assistente/claude";
import { finalizarResposta, foraDoEscopoObvio, MSG_FORA_DO_ESCOPO } from "@/lib/assistente/escopo";
import { ErroAssistente, type ExecutarFerramenta, type MensagemChat } from "@/lib/assistente/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MENSAGENS = 20;
const MAX_CARACTERES = 4000;

/** Assistente da plataforma: responde dúvidas de uso (manual) e consulta os
 *  dados do sistema com ferramentas só de leitura, sob o RLS de quem pergunta.
 *  O histórico vem do navegador (só texto) a cada pergunta. IA: Cloudflare
 *  Workers AI (padrão, gratuito) ou Anthropic (ASSISTENTE_PROVEDOR=anthropic). */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });

  const corpo = (await req.json().catch(() => null)) as { mensagens?: MensagemChat[] } | null;
  const historico = (Array.isArray(corpo?.mensagens) ? corpo!.mensagens : [])
    .filter((m) => (m?.papel === "usuario" || m?.papel === "assistente") && typeof m.texto === "string" && m.texto.trim())
    .slice(-MAX_MENSAGENS)
    .map((m) => ({ papel: m.papel, texto: m.texto.slice(0, MAX_CARACTERES) }));
  while (historico.length && historico[0].papel !== "usuario") historico.shift();
  if (!historico.length || historico[historico.length - 1].papel !== "usuario") {
    return NextResponse.json({ erro: "Envie uma pergunta." }, { status: 400 });
  }

  // assunto claramente alheio à ASP: recusa sem gastar a cota da IA
  if (foraDoEscopoObvio(historico[historico.length - 1].texto)) {
    return NextResponse.json({ resposta: MSG_FORA_DO_ESCOPO, fora_do_escopo: true });
  }

  const sb = getSupabaseRouteClient();
  const executar: ExecutarFerramenta = async (nome, entrada) => {
    try {
      return { conteudo: JSON.stringify(await executarFerramenta(sb, nome, entrada)) };
    } catch (e: any) {
      console.error("assistente/ferramenta:", nome, e);
      return { conteudo: `Falha na consulta: ${e?.message || e}`, erro: true };
    }
  };
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const pedido = { historico, contexto: contextoDaSessao(profile.nome_completo, profile.perfil, hoje), executar };

  try {
    const resposta = process.env.ASSISTENTE_PROVEDOR === "anthropic" ? await responderClaude(pedido) : await responderCloudflare(pedido);
    return NextResponse.json(finalizarResposta(resposta));
  } catch (e) {
    if (e instanceof ErroAssistente) return NextResponse.json({ erro: e.message }, { status: e.status });
    console.error("assistente:", e);
    return NextResponse.json({ erro: "O assistente não conseguiu responder agora. Tente de novo." }, { status: 502 });
  }
}
