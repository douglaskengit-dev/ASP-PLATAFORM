import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { executarFerramenta } from "@/lib/assistente/ferramentas";
import { contextoDaSessao } from "@/lib/assistente/prompt";
import { responderCloudflare } from "@/lib/assistente/cloudflare";
import { responderClaude } from "@/lib/assistente/claude";
import { carregarPagina, contextoDaPagina } from "@/lib/assistente/pagina";
import { exemplosAprovados, registrarResposta } from "@/lib/assistente/registro";
import { sugestoesDeContinuacao } from "@/lib/assistente/continuacao";
import { guardarResposta, respostaGuardada, versaoDoCache } from "@/lib/assistente/cache";
import { precisaDoBanco } from "@/lib/assistente/verificacao";
import { limiteDiario, msgLimite, perguntasHoje, temReservaAnthropic } from "@/lib/assistente/limite";
import { finalizarResposta, foraDoEscopoObvio, MSG_FORA_DO_ESCOPO } from "@/lib/assistente/escopo";
import { ErroAssistente, type ExecutarFerramenta, type MensagemChat } from "@/lib/assistente/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MENSAGENS = 20;
const MAX_CARACTERES = 4000;

/** O que o robô está fazendo, para mostrar enquanto a resposta não chega. */
const ETAPA_DA_CONSULTA: Record<string, string> = {
  buscar_projetos: "Procurando projetos…", detalhar_projeto: "Abrindo o projeto…",
  buscar_os: "Procurando OS…", detalhar_os: "Abrindo a OS…", buscar_clientes: "Procurando clientes…",
  agenda: "Olhando a agenda…", indicadores: "Calculando os números do Dashboard…", minhas_pendencias: "Juntando as suas pendências…",
};

type Profile = NonNullable<Awaited<ReturnType<typeof getProfileAtual>>>;
interface Saida { status: number; corpo: Record<string, unknown> }

/** Assistente da plataforma: responde dúvidas de uso (manual) e consulta os
 *  dados do sistema com ferramentas só de leitura, sob o RLS de quem pergunta.
 *  O histórico vem do navegador (só texto) a cada pergunta. IA: Cloudflare
 *  Workers AI (padrão, gratuito) ou Anthropic (ASSISTENTE_PROVEDOR=anthropic).
 *
 *  Com "Accept: application/x-ndjson" a resposta vem em linhas JSON: antes,
 *  as etapas ({ etapa }) — o que o robô está fazendo —, e por último o
 *  resultado ({ fim: true, status, ... }). O texto da IA só aparece depois de
 *  conferido com o banco; nunca vai pela metade para a tela. */
export async function POST(req: NextRequest) {
  // sessão antes de abrir o fluxo (a renovação do login grava cookies)
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  const sb = getSupabaseRouteClient();

  if (!(req.headers.get("accept") || "").includes("application/x-ndjson")) {
    const { status, corpo } = await processar(req, profile, sb, () => {});
    return NextResponse.json(corpo, { status });
  }
  const codificador = new TextEncoder();
  const fluxo = new ReadableStream({
    async start(controle) {
      const enviar = (o: Record<string, unknown>) => controle.enqueue(codificador.encode(JSON.stringify(o) + "\n"));
      try {
        const { status, corpo } = await processar(req, profile, sb, (etapa) => enviar({ etapa }));
        enviar({ fim: true, status, ...corpo });
      } catch {
        enviar({ fim: true, status: 502, erro: "O assistente não conseguiu responder agora. Tente de novo." });
      }
      controle.close();
    },
  });
  return new Response(fluxo, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

async function processar(req: NextRequest, profile: Profile, sb: ReturnType<typeof getSupabaseRouteClient>, aoEtapa: (texto: string) => void): Promise<Saida> {
  const inicio = Date.now();
  const corpo = (await req.json().catch(() => null)) as { mensagens?: MensagemChat[]; pagina?: string } | null;
  const historico = (Array.isArray(corpo?.mensagens) ? corpo!.mensagens : [])
    .filter((m) => (m?.papel === "usuario" || m?.papel === "assistente") && typeof m.texto === "string" && m.texto.trim())
    .slice(-MAX_MENSAGENS)
    .map((m) => ({ papel: m.papel, texto: m.texto.slice(0, MAX_CARACTERES) }));
  while (historico.length && historico[0].papel !== "usuario") historico.shift();
  if (!historico.length || historico[historico.length - 1].papel !== "usuario") {
    return { status: 400, corpo: { erro: "Envie uma pergunta." } };
  }

  const pergunta = historico[historico.length - 1].texto;
  const provedor = process.env.ASSISTENTE_PROVEDOR === "anthropic" ? "anthropic" : "cloudflare";

  // assunto claramente alheio à ASP: recusa sem gastar a cota da IA
  if (foraDoEscopoObvio(pergunta)) {
    const id = await registrarResposta(sb, { pergunta, resposta: MSG_FORA_DO_ESCOPO, pagina: corpo?.pagina, consultas: [], foraDoEscopo: true, provedor: "filtro" });
    return { status: 200, corpo: { resposta: MSG_FORA_DO_ESCOPO, fora_do_escopo: true, id } };
  }

  const consultas: string[] = [];
  const executar: ExecutarFerramenta = async (nome, entrada) => {
    consultas.push(nome);
    aoEtapa(ETAPA_DA_CONSULTA[nome] || "Consultando o banco…");
    try {
      return { conteudo: JSON.stringify(await executarFerramenta(sb, nome, entrada, { id: profile.id, perfil: profile.perfil })) };
    } catch (e: any) {
      console.error("assistente/ferramenta:", nome, e);
      return { conteudo: `Falha na consulta: ${e?.message || e}`, erro: true };
    }
  };
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  // página aberta (OS, projeto ou cliente): "esta OS" passa a valer para ela
  const [pagina, exemplos] = await Promise.all([
    carregarPagina(sb, corpo?.pagina).catch(() => null),
    exemplosAprovados(sb).catch(() => ""),
  ]);
  const contexto = [contextoDaSessao(profile.nome_completo, profile.perfil, hoje), pagina && contextoDaPagina(pagina), exemplos].filter(Boolean).join("\n");
  const registro = { reserva: false, chamadas: 0 };
  const pedido = { historico, contexto, executar, naPagina: !!pagina, registro, aoEtapa };

  // dúvida de uso sem conversa anterior e fora de página de dados: pode vir
  // (e ir) para as respostas guardadas, sem gastar a cota da IA
  const podeGuardar = historico.length === 1 && !pagina && !precisaDoBanco(pergunta);
  const versao = versaoDoCache(exemplos);
  if (podeGuardar) {
    const guardada = await respostaGuardada(pergunta, versao).catch(() => null);
    if (guardada) {
      const id = await registrarResposta(sb, { pergunta, resposta: guardada, pagina: corpo?.pagina, consultas: [], provedor: "cache" });
      return { status: 200, corpo: { resposta: guardada, id, sugestoes: [] } };
    }
  }

  aoEtapa("Pensando…");
  // limite diário por pessoa (o admin não tem)
  const limite = limiteDiario();
  if (limite > 0 && profile.perfil !== "admin") {
    const feitas = await perguntasHoje(sb, profile.id, hoje).catch(() => null);
    if (feitas != null && feitas >= limite) return { status: 429, corpo: { erro: msgLimite(limite) } };
  }

  // cota gratuita do Cloudflare acabou: se configurado, a Anthropic responde
  let usado = provedor;
  const responder = async () => {
    if (provedor === "anthropic") return responderClaude(pedido);
    try {
      return await responderCloudflare(pedido);
    } catch (e) {
      if (!(e instanceof ErroAssistente && e.status === 429 && temReservaAnthropic())) throw e;
      consultas.length = 0;
      registro.reserva = false;
      usado = "anthropic-reserva";
      return responderClaude(pedido);
    }
  };

  try {
    const final = finalizarResposta(await responder());
    const primeiroNome = (profile.nome_completo || "").trim().split(/\s+/)[0];
    if (podeGuardar && !consultas.length && !final.fora_do_escopo && !registro.reserva && !(primeiroNome && final.resposta.includes(primeiroNome))) {
      await guardarResposta(pergunta, final.resposta, versao).catch(() => {});
    }
    const id = await registrarResposta(sb, {
      pergunta, resposta: final.resposta, pagina: corpo?.pagina, consultas, foraDoEscopo: final.fora_do_escopo, reserva: registro.reserva, provedor: usado,
      chamadasIa: registro.chamadas, duracaoMs: Date.now() - inicio,
    });
    const sugestoes = final.fora_do_escopo ? [] : sugestoesDeContinuacao(final.resposta, consultas, pergunta);
    return { status: 200, corpo: { ...final, id, sugestoes } };
  } catch (e) {
    if (e instanceof ErroAssistente) return { status: e.status, corpo: { erro: e.message } };
    console.error("assistente:", e);
    return { status: 502, corpo: { erro: "O assistente não conseguiu responder agora. Tente de novo." } };
  }
}
