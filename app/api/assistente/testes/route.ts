import { NextRequest, NextResponse } from "next/server";
import { mesmaOrigem } from "@/lib/asp/acesso-api";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { executarFerramenta } from "@/lib/assistente/ferramentas";
import { contextoDaSessao } from "@/lib/assistente/prompt";
import { responderCloudflare } from "@/lib/assistente/cloudflare";
import { responderClaude } from "@/lib/assistente/claude";
import { finalizarResposta, foraDoEscopoObvio, MSG_FORA_DO_ESCOPO } from "@/lib/assistente/escopo";
import { exemplosAprovados } from "@/lib/assistente/registro";
import { avaliarCaso, CASOS } from "@/lib/assistente/bateria";
import { ErroAssistente, type ExecutarFerramenta } from "@/lib/assistente/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

async function exigirAdmin() {
  const profile = await getProfileAtual();
  if (!profile) return { erro: NextResponse.json({ erro: "Sessão expirada." }, { status: 401 }) };
  if (profile.perfil !== "admin") return { erro: NextResponse.json({ erro: "Somente o administrador." }, { status: 403 }) };
  return { profile };
}

/** Lista dos casos (a página roda um por vez, para não estourar o tempo). */
export async function GET() {
  const r = await exigirAdmin();
  if (r.erro) return r.erro;
  return NextResponse.json({ ok: true, casos: CASOS.map((c) => ({ pergunta: c.pergunta, descricao: c.descricao })) });
}

/** Roda um caso com a IA e o banco reais, com o acesso do admin. Não entra
 *  no registro de respostas nem nas respostas guardadas. */
export async function POST(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const r = await exigirAdmin();
  if (r.erro) return r.erro;
  const profile = r.profile!;
  const b = (await req.json().catch(() => null)) as { indice?: unknown } | null;
  const caso = CASOS[Number(b?.indice)];
  if (!caso) return NextResponse.json({ erro: "Caso inválido." }, { status: 400 });

  const inicio = Date.now();
  const consultas: string[] = [];
  let resposta: string;
  let fora = false;
  if (foraDoEscopoObvio(caso.pergunta)) {
    resposta = MSG_FORA_DO_ESCOPO;
    fora = true;
  } else {
    const sb = getSupabaseRouteClient();
    const executar: ExecutarFerramenta = async (nome, entrada) => {
      consultas.push(nome);
      try {
        return { conteudo: JSON.stringify(await executarFerramenta(sb, nome, entrada, { id: profile.id, perfil: profile.perfil })) };
      } catch (e: any) {
        return { conteudo: `Falha na consulta: ${e?.message || e}`, erro: true };
      }
    };
    const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const exemplos = await exemplosAprovados(sb).catch(() => "");
    const pedido = {
      historico: [{ papel: "usuario" as const, texto: caso.pergunta }],
      contexto: [contextoDaSessao(profile.nome_completo, profile.perfil, hoje), exemplos].filter(Boolean).join("\n"),
      executar,
      registro: { reserva: false, chamadas: 0 },
    };
    try {
      const final = finalizarResposta(process.env.ASSISTENTE_PROVEDOR === "anthropic" ? await responderClaude(pedido) : await responderCloudflare(pedido));
      resposta = final.resposta;
      fora = !!final.fora_do_escopo;
    } catch (e) {
      const msg = e instanceof ErroAssistente ? e.message : "O assistente não conseguiu responder.";
      return NextResponse.json({ ok: true, passou: false, motivos: [msg], resposta: "", consultas, ms: Date.now() - inicio });
    }
  }
  const avaliacao = avaliarCaso(caso, resposta, consultas, fora);
  return NextResponse.json({ ok: true, ...avaliacao, resposta, consultas: Array.from(new Set(consultas)), ms: Date.now() - inicio });
}
