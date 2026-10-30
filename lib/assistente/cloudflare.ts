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

/** Distância de edição: o modelo às vezes erra o nome ("bustar_projetos"). */
function distancia(a: string, b: string): number {
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = atual;
  }
  return ant[b.length];
}

/** Nome de ferramenta válido mais próximo (até 2 letras de diferença). */
function nomeValido(nome: string): string | null {
  if (NOMES.has(nome)) return nome;
  let melhor: string | null = null, menor = 3;
  for (const n of NOMES) { const d = distancia(nome, n); if (d < menor) { menor = d; melhor = n; } }
  return melhor;
}

function valorDe(v: string): unknown {
  if (/^["']/.test(v)) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
  return v === "null" || v === "None" ? null : v;
}

/** Chamadas escritas no texto em vez de tool_calls: JSON {"name", "arguments"}
 *  ou o formato do Llama [buscar_projetos(texto="Rhodia"), agenda(de="…")].
 *  Esse texto nunca vai para o usuário: a consulta roda e o modelo responde. */
function chamadasNoTexto(texto: string): ChamadaCf[] {
  const t = texto.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t);
      const nome = j && typeof j.name === "string" ? nomeValido(j.name) : null;
      if (nome) return [{ ...j, name: nome }];
    } catch {}
  }
  const chamadas: ChamadaCf[] = [];
  for (const m of t.matchAll(/\b([a-z_]{4,})\(([^()]*)\)/g)) {
    const nome = nomeValido(m[1]);
    if (!nome) continue;
    const args: Record<string, unknown> = {};
    for (const a of m[2].matchAll(/(\w+)\s*[=:]\s*("[^"]*"|'[^']*'|[^,\s)]+)/g)) args[a[1]] = valorDe(a[2]);
    chamadas.push({ name: nome, arguments: args });
  }
  // "[bustar_x(...)] ... usarei: [buscar_x(...)]" vira uma consulta só
  const vistas = new Set<string>();
  return chamadas.filter((c) => { const k = JSON.stringify(c); return !vistas.has(k) && !!vistas.add(k); });
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
    // resposta antiga com chamada vazada no texto não serve de exemplo ao modelo
    ...historico.map((m): MensagemCf => ({
      role: m.papel === "usuario" ? "user" : "assistant",
      content: m.papel === "assistente" && chamadasNoTexto(m.texto).length ? "(consulta feita)" : m.texto,
    })),
  ];
  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const { texto, chamadas } = await rodar(modelo, mensagens);
    const pedidas = chamadas.length ? chamadas : chamadasNoTexto(texto);
    if (!pedidas.length) return texto.trim() || "Não consegui montar uma resposta. Tente reformular a pergunta.";
    for (const c of pedidas) {
      const entrada = entradaDe(c);
      const nome = nomeValido(c.name) || c.name;
      const r = NOMES.has(nome) ? await executar(nome, entrada) : { conteudo: `Ferramenta desconhecida: ${c.name}`, erro: true };
      mensagens.push({ role: "assistant", content: JSON.stringify({ name: nome, arguments: entrada }) });
      mensagens.push({ role: "tool", name: nome, content: r.conteudo.slice(0, MAX_RESULTADO) });
    }
  }
  return MSG_RODADAS;
}
