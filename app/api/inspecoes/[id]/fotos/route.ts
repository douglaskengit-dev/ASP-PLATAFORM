import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { uploadArquivo, baixarArquivo, removerArquivos } from "@/lib/processos/arquivos";
import {
  slotPorId, registroVazio, fotoRepetida,
  type FotoColetada, type ItemColetado, type RegistroFotosExecucao,
} from "@/lib/asp/fotos-execucao";
import { erroValorColeta, formatoImagem, FOTO_MAX_BYTES } from "@/lib/validacao";

import { garantirOsAberta, lerOS } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

/** Coleta de fotos da execução (gp_fotos_execucao), uma por inspeção.
 *  Mesmos perfis do checklist de equipamentos: Operações (com admin e
 *  Gerência) grava; todos leem. Arquivos no bucket privado, via cliente
 *  admin, sempre sob `fotos-execucao/<inspeção>/`. */
const PERFIS = ["admin", "operacoes", "gerencia"];
const TABELA = "gp_fotos_execucao";

type Supa = ReturnType<typeof getSupabaseRouteClient>;
type Linha = RegistroFotosExecucao & { id: string; atualizado_em: string };

const prefixo = (inspecaoId: string) => `fotos-execucao/${inspecaoId}/`;

/** Padrão das coletas de água: vem do procedimento da inspeção. Coluna
 *  ausente (migration não rodada) ou procedimento sem cadastro = false. */
async function aguaPotavelDoProcedimento(supabase: Supa, inspecaoId: string): Promise<boolean | null> {
  const { data: insp } = await supabase.from("gp_inspecoes").select("id, procedimento").eq("id", inspecaoId).maybeSingle();
  if (!insp) return null;                                   // inspeção inexistente / sem acesso
  if (!insp.procedimento) return false;
  const { data: proc } = await supabase.from("gp_procedimentos")
    .select("agua_potavel").eq("codigo", insp.procedimento).limit(1).maybeSingle();
  return !!(proc as any)?.agua_potavel;
}

/** Registro da inspeção; cria na primeira gravação, com as coletas de água
 *  marcadas conforme o procedimento. Depois disso a escolha é manual. */
async function garantirRegistro(supabase: Supa, inspecaoId: string, autor: string): Promise<Linha | string> {
  const { data } = await supabase.from(TABELA).select("*").eq("inspecao_id", inspecaoId).maybeSingle();
  if (data) return data as Linha;
  const padrao = await aguaPotavelDoProcedimento(supabase, inspecaoId);
  if (padrao === null) return "OS não encontrada.";
  const { data: novo, error } = await supabase.from(TABELA)
    .insert({ inspecao_id: inspecaoId, agua_antes: padrao, agua_depois: padrao, itens: {}, criado_por: autor })
    .select("*").single();
  if (novo) return novo as Linha;
  // corrida com outra gravação simultânea (unique em inspecao_id): relê
  const { data: outro } = await supabase.from(TABELA).select("*").eq("inspecao_id", inspecaoId).maybeSingle();
  return (outro as Linha) || error?.message || "Falha ao criar a coleta de fotos.";
}

/** Lê-modifica-grava em `itens` com trava otimista (atualizado_em): duas
 *  fotos enviadas juntas — ou a fila offline sincronizando — não se apagam. */
async function alterar(
  supabase: Supa, inspecaoId: string, autor: string,
  mudar: (r: Linha) => Partial<RegistroFotosExecucao> | string,
): Promise<Linha | string> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const atual = await garantirRegistro(supabase, inspecaoId, autor);
    if (typeof atual === "string") return atual;
    const mudanca = mudar(atual);
    if (typeof mudanca === "string") return mudanca;
    const { data, error } = await supabase.from(TABELA)
      .update({ ...mudanca, atualizado_em: new Date().toISOString() })
      .eq("id", atual.id).eq("atualizado_em", atual.atualizado_em)
      .select("*").maybeSingle();
    if (error) return error.message;
    if (data) return data as Linha;
    // outro gravou no meio do caminho: tenta de novo sobre a versão nova
  }
  return "A coleta foi alterada ao mesmo tempo por outra pessoa. Tente de novo.";
}

const resposta = (r: Linha | string, status = 500) =>
  typeof r === "string"
    ? NextResponse.json({ erro: r }, { status: r === "OS não encontrada." ? 404 : status })
    : NextResponse.json({ ok: true, registro: r });

/** GET → registro (ou os padrões do procedimento, se ainda não existe).
 *  GET ?caminho=… → serve a foto. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = getSupabaseRouteClient();

  const caminho = req.nextUrl.searchParams.get("caminho");
  if (caminho !== null) {
    if (!caminho.startsWith(prefixo(params.id)) || caminho.includes("..")) {
      return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
    }
    try {
      const buf = await baixarArquivo(caminho);
      const ext = caminho.split(".").pop()?.toLowerCase() || "jpg";
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return new NextResponse(new Uint8Array(buf), {
        // o caminho leva o timestamp do envio: trocar a foto muda a URL
        headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400" },
      });
    } catch {
      return NextResponse.json({ erro: "Imagem não encontrada." }, { status: 404 });
    }
  }

  const { data, error } = await supabase.from(TABELA).select("*").eq("inspecao_id", params.id).maybeSingle();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  let registro: RegistroFotosExecucao | null = data as RegistroFotosExecucao | null;
  if (!registro) {
    const padrao = await aguaPotavelDoProcedimento(supabase, params.id);
    if (padrao === null) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
    registro = { ...registroVazio(padrao), inspecao_id: params.id };
  }
  // OS encerrada: a tela fica só leitura (a gravação também recusa).
  const encerrada = !!(await lerOS(params.id))?.encerrada_em;
  return NextResponse.json({ ok: true, podeEditar: PERFIS.includes(profile.perfil) && !encerrada, encerrada, registro });
}

const HASH = /^[0-9a-f]{64}$/;
const CAPTURA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const msgRepetida = (onde: string) => `Esta foto já está na coleta (${onde}). Use outra foto.`;

/** Envia uma foto (multipart: arquivo + slot + hash + capturada_em?). Vaga
 *  simples é substituída (o arquivo anterior sai do storage); vaga de várias
 *  fotos acumula. Fase 7: só JPEG/PNG de verdade (pelos bytes), até 10 MB, e
 *  a mesma foto (hash do original, calculado no aparelho antes da
 *  compressão) não entra duas vezes. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Coleta de fotos é responsabilidade de Operações." }, { status: 403 });
  }
  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(params.id);
  if (travada) return travada;
  const form = await req.formData();
  const f = form.get("arquivo");
  const slotId = String(form.get("slot") || "");
  const def = slotPorId(slotId);
  if (!def) return NextResponse.json({ erro: "Item da coleta inválido." }, { status: 400 });
  if (!(f instanceof Blob) || !(f as File).name) {
    return NextResponse.json({ erro: "Envie a imagem no campo 'arquivo'." }, { status: 400 });
  }
  const arquivo = f as File;
  if (arquivo.size > FOTO_MAX_BYTES) {
    return NextResponse.json({ erro: "Foto com mais de 10 MB. Reduza a resolução e envie de novo." }, { status: 400 });
  }
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const fmt = formatoImagem(bytes);
  if (fmt !== "jpeg" && fmt !== "png") {
    return NextResponse.json({ erro: "O arquivo não é uma foto JPEG ou PNG válida." }, { status: 400 });
  }
  const ext = fmt === "png" ? "png" : "jpg";
  const hashInformado = String(form.get("hash") || "").toLowerCase();
  // Fila offline antiga (sem hash do original): vale o hash do que chegou.
  const hash = HASH.test(hashInformado) ? hashInformado : createHash("sha256").update(bytes).digest("hex");
  const capturaInformada = String(form.get("capturada_em") || "");
  const capturada_em = CAPTURA.test(capturaInformada) ? capturaInformada : null;

  const supabase = getSupabaseRouteClient();
  // Repetida? Responde antes de gastar o upload (a checagem se repete
  // dentro da gravação, contra envios simultâneos).
  const { data: existente } = await supabase.from(TABELA).select("itens").eq("inspecao_id", params.id).maybeSingle();
  const ja = fotoRepetida(existente as RegistroFotosExecucao | null, hash, slotId);
  if (ja) return NextResponse.json({ erro: msgRepetida(ja), repetida: true, slot: slotId }, { status: 409 });

  const caminho = `${prefixo(params.id)}${slotId}/${Date.now()}.${ext}`;
  try {
    await uploadArquivo(caminho, Buffer.from(bytes), fmt === "png" ? "image/png" : "image/jpeg");
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar a foto." }, { status: 500 });
  }

  const foto: FotoColetada = {
    caminho, por: profile.nome_completo || profile.email || null, em: new Date().toISOString(), hash, capturada_em,
  };
  const troca = { anterior: null as string | null, repetida: false };
  const r = await alterar(supabase, params.id, profile.id, (atual) => {
    const onde = fotoRepetida(atual, hash, slotId);
    if (onde) { troca.repetida = true; return msgRepetida(onde); }
    const itens = { ...(atual.itens || {}) };
    if (def.slot.minimo) {
      const lista = Array.isArray(itens[slotId]) ? (itens[slotId] as FotoColetada[]) : [];
      itens[slotId] = [...lista, foto];
    } else {
      const antes = (itens[slotId] && !Array.isArray(itens[slotId]) ? itens[slotId] : {}) as ItemColetado;
      troca.anterior = antes.caminho || null;
      itens[slotId] = { ...antes, ...foto };
    }
    return { itens };
  });
  if (typeof r === "string") {
    await removerArquivos([caminho]);           // não deixa órfão no storage
    return resposta(r, troca.repetida ? 409 : 500);
  }
  if (troca.anterior && troca.anterior !== caminho) await removerArquivos([troca.anterior]);
  return resposta(r);
}

/** Caixinhas e valores: { agua_antes?, agua_depois?, limpeza_confirmada?,
 *  valor?: { slot, valor: number | null } }. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Coleta de fotos é responsabilidade de Operações." }, { status: 403 });
  }
  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(params.id);
  if (travada) return travada;
  const b = await req.json().catch(() => ({}));
  const flags: Partial<RegistroFotosExecucao> = {};
  for (const k of ["agua_antes", "agua_depois", "limpeza_confirmada"] as const) {
    if (typeof b?.[k] === "boolean") flags[k] = b[k];
  }
  let valor: { slot: string; valor: number | null } | null = null;
  if (b?.valor) {
    const def = slotPorId(String(b.valor.slot || ""));
    const v = b.valor.valor;
    if (!def?.slot.valor) return NextResponse.json({ erro: "Item sem valor medido." }, { status: 400 });
    if (v !== null && (typeof v !== "number" || !isFinite(v))) {
      return NextResponse.json({ erro: "Valor inválido." }, { status: 400 });
    }
    const erroValor = erroValorColeta(def.slot, v);
    if (erroValor) return NextResponse.json({ erro: erroValor }, { status: 400 });
    valor = { slot: def.slot.id, valor: v };
  }

  const r = await alterar(getSupabaseRouteClient(), params.id, profile.id, (atual) => {
    if (!valor) return flags;
    const itens = { ...(atual.itens || {}) };
    const antes = (itens[valor.slot] && !Array.isArray(itens[valor.slot]) ? itens[valor.slot] : {}) as ItemColetado;
    itens[valor.slot] = { ...antes, valor: valor.valor };
    return { ...flags, itens };
  });
  return resposta(r);
}

/** Remove uma foto: { caminho } (ou ?caminho=). O valor medido da vaga fica. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Coleta de fotos é responsabilidade de Operações." }, { status: 403 });
  }
  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(params.id);
  if (travada) return travada;
  const b = await req.json().catch(() => ({}));
  const caminho = String(b?.caminho || req.nextUrl.searchParams.get("caminho") || "");
  if (!caminho.startsWith(prefixo(params.id)) || caminho.includes("..")) {
    return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  }
  const r = await alterar(getSupabaseRouteClient(), params.id, profile.id, (atual) => {
    const itens = { ...(atual.itens || {}) };
    for (const [k, v] of Object.entries(itens)) {
      if (Array.isArray(v)) itens[k] = v.filter((f) => f.caminho !== caminho);
      else if (v?.caminho === caminho) itens[k] = { valor: v.valor ?? null };
    }
    return { itens };
  });
  if (typeof r !== "string") await removerArquivos([caminho]);
  return resposta(r);
}
