/** Lado servidor da Fase 3 (coleta de dados da OS): lê do banco o contexto
 *  que lib/validacao/coleta.ts precisa e concentra o que /api/coletas e
 *  /api/coletas/[id] repetem — leitura do corpo (JSON ou multipart), PDF
 *  (bytes + SHA-256) e conflito ao restaurar da lixeira. Lê com a chave de
 *  serviço. Não é rota: só funções. */
import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  arquivoRepetido, chaveMedicao, ColetaRef, ContextoColeta, DadosColeta, descreverColeta, EstadoMedidor, hojeBrasil,
  medicaoRepetida, ResultadoValidacao, validarColeta, validarPdf,
} from "@/lib/validacao";
import type { Tanque } from "@/lib/asp/tanque";

export const PERFIS_COLETA = ["admin", "operacoes", "gerencia"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function ehUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function sha256(dados: string | Uint8Array): string {
  return createHash("sha256").update(dados).digest("hex");
}

/** SHA-256 da medição (chave canônica), ou null se não há leitura. */
export function hashMedicao(dados: EstadoMedidor | null | undefined): string | null {
  const k = chaveMedicao(dados);
  return k ? sha256(k) : null;
}

/** Linha de gp_coletas → referência para as regras de duplicidade. */
export function paraColetaRef(c: any): ColetaRef {
  return {
    id: c.id, tipo: c.tipo, chave: chaveMedicao(c.dados), arquivoHash: c.arquivo_hash || null,
    dataColeta: c.data_coleta || null, descricao: c.descricao || null, criadoEm: c.criado_em || null,
  };
}

export interface InfoOSColeta {
  id: string;
  tanque: Tanque | null;
  /** Agendamento ativo de inspeção mais recente. */
  dataAgendamento: string | null;
  equipeAgendada: { id: string; nome: string }[];
}

/** OS (existe e não está na lixeira) + agendamento de inspeção ativo. */
export async function infoOSColeta(inspecaoId: string): Promise<InfoOSColeta | null> {
  if (!ehUuid(inspecaoId)) return null;
  const admin = getSupabaseAdmin();
  const [os, ag] = await Promise.all([
    admin.from("gp_inspecoes").select("id, tanque, excluido_em").eq("id", inspecaoId).maybeSingle(),
    admin.from("gp_agendamentos").select("data_visita, equipe, criado_em")
      .eq("inspecao_id", inspecaoId).eq("tipo", "inspecao").is("substituido_em", null)
      .not("data_visita", "is", null)
      .order("criado_em", { ascending: false }).limit(1),
  ]);
  if (!os.data || os.data.excluido_em) return null;
  const a: any = (ag.data || [])[0];
  return {
    id: os.data.id,
    tanque: (os.data.tanque as Tanque) || null,
    dataAgendamento: a?.data_visita || null,
    equipeAgendada: (a?.equipe || []).filter((m: any) => m && m.id),
  };
}

/** Contexto completo para validar uma coleta desta OS. null = OS não existe
 *  (ou está na lixeira). `usuarios` traz o nome do responsável. */
export async function contextoColeta(inspecaoId: string): Promise<{
  ctx: ContextoColeta; info: InfoOSColeta; usuarios: { id: string; nome: string }[];
} | null> {
  const info = await infoOSColeta(inspecaoId);
  if (!info) return null;
  const admin = getSupabaseAdmin();
  const [coletas, ativos] = await Promise.all([
    admin.from("gp_coletas").select("id, tipo, dados, arquivo_hash, data_coleta, descricao, criado_em")
      .eq("inspecao_id", inspecaoId).is("excluido_em", null),
    admin.from("gp_profiles").select("id, nome_completo, email").eq("ativo", true),
  ]);
  const usuarios = (ativos.data || []).map((u: any) => ({ id: u.id, nome: u.nome_completo || u.email || "usuário" }));
  return {
    info,
    usuarios,
    ctx: {
      hoje: hojeBrasil(),
      dataAgendamento: info.dataAgendamento,
      usuariosAtivos: usuarios.map((u) => u.id),
      coletas: (coletas.data || []).map(paraColetaRef),
      tanque: info.tanque,
    },
  };
}

/** Corpo de POST/PATCH de coleta — JSON ou multipart (campos + PDF). */
export interface CorpoColeta {
  id?: string;
  inspecaoId?: string;
  tipo?: string;
  dados?: EstadoMedidor;
  dataColeta?: string;
  responsavelId?: string;
  descricao?: string;
  /** PDF enviado (bytes já lidos). */
  arquivo?: { bytes: Uint8Array; tamanho: number } | null;
  aprovar?: boolean;
  restaurar?: boolean;
  /** Campos presentes no corpo (PATCH só mexe no que veio). */
  presentes: Set<string>;
}

/** Lê o corpo. JSON de `dados` inválido no multipart → erro (400), nunca {}. */
export async function lerCorpoColeta(req: Request): Promise<{ corpo?: CorpoColeta; erro?: string }> {
  const tipoConteudo = req.headers.get("content-type") || "";
  const presentes = new Set<string>();
  const corpo: CorpoColeta = { presentes };
  const texto = (v: unknown) => (typeof v === "string" ? v : undefined);

  if (tipoConteudo.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { return { erro: "Envio inválido (formulário corrompido)." }; }
    for (const k of ["id", "inspecaoId", "tipo", "dataColeta", "responsavelId", "descricao"] as const) {
      const v = form.get(k);
      if (typeof v === "string") { (corpo as any)[k] = v; presentes.add(k); }
    }
    const dadosRaw = form.get("dados");
    if (typeof dadosRaw === "string" && dadosRaw.trim()) {
      try { corpo.dados = JSON.parse(dadosRaw); } catch { return { erro: "Os dados da medição chegaram corrompidos (JSON inválido). Tente salvar de novo." }; }
      if (!corpo.dados || typeof corpo.dados !== "object" || Array.isArray(corpo.dados)) return { erro: "Os dados da medição chegaram em formato inválido." };
      presentes.add("dados");
    }
    const f = form.get("arquivo");
    if (f instanceof Blob && f.size > 0) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      corpo.arquivo = { bytes, tamanho: f.size };
    }
  } else {
    let b: any;
    try { b = await req.json(); } catch { return { erro: "Envio inválido (JSON corrompido)." }; }
    if (!b || typeof b !== "object") return { erro: "Envio inválido." };
    for (const k of ["id", "inspecaoId", "tipo", "dataColeta", "responsavelId", "descricao"] as const) {
      if (k in b) { (corpo as any)[k] = texto(b[k]) ?? (b[k] == null ? "" : String(b[k])); presentes.add(k); }
    }
    if ("dados" in b) {
      if (b.dados != null && (typeof b.dados !== "object" || Array.isArray(b.dados))) return { erro: "Os dados da medição chegaram em formato inválido." };
      corpo.dados = b.dados || {};
      presentes.add("dados");
    }
    for (const k of ["aprovar", "restaurar"]) if (k in b) { (corpo as any)[k] = b[k]; presentes.add(k); }
  }
  // Repetição segura (fila offline/duplo clique): o id da coleta pode vir no
  // corpo ou no cabeçalho Idempotency-Key.
  if (!corpo.id) {
    const chave = req.headers.get("idempotency-key");
    if (chave) corpo.id = chave;
  }
  return { corpo };
}

/** PDF do corpo: erro de formato/tamanho e SHA-256. */
export function examinarPdf(arquivo: CorpoColeta["arquivo"]): { erro: string | null; hash: string | null } {
  if (!arquivo) return { erro: null, hash: null };
  const erro = validarPdf(arquivo.bytes, arquivo.tamanho);
  return { erro, hash: erro ? null : sha256(arquivo.bytes) };
}

/** Restaurar uma coleta da lixeira não pode criar duplicata: devolve a
 *  mensagem do conflito com uma coleta ativa (mesma medição ou mesmo PDF),
 *  ou null. */
export async function conflitoAoRestaurarColeta(id: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data: c } = await admin.from("gp_coletas")
    .select("id, inspecao_id, tipo, dados, arquivo_hash, data_coleta, descricao, criado_em").eq("id", id).maybeSingle();
  if (!c) return null;
  const { data: ativas } = await admin.from("gp_coletas")
    .select("id, tipo, dados, arquivo_hash, data_coleta, descricao, criado_em")
    .eq("inspecao_id", c.inspecao_id).is("excluido_em", null).neq("id", id);
  const ref = paraColetaRef(c);
  const outras = (ativas || []).map(paraColetaRef);
  const igual = (ref.chave && outras.find((o) => o.chave === ref.chave))
    || (ref.arquivoHash && outras.find((o) => o.arquivoHash === ref.arquivoHash));
  return igual ? `Já existe ${descreverColeta(igual)} ativa nesta OS com o mesmo conteúdo. Exclua-a antes de restaurar esta.` : null;
}

/** Valida no servidor e diz se o erro é de duplicidade (→ 409). */
export function validarColetaServidor(d: DadosColeta, ctx: ContextoColeta): { resultado: ResultadoValidacao; duplicada: boolean } {
  const resultado = validarColeta(d, ctx);
  const duplicada = !!(medicaoRepetida(d.dados, ctx, d.id) || arquivoRepetido(d.arquivoHash, ctx, d.id));
  return { resultado, duplicada };
}
