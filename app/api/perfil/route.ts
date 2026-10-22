import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { CAMPOS_USUARIO, carregarUsuarios } from "@/lib/asp/usuario-api";
import { normalizarEspacos, primeiroErro, ROTULOS_USUARIO, temErros, validarUsuario } from "@/lib/validacao";

export const runtime = "nodejs";

/** "Meu perfil": o próprio usuário troca o nome completo. Mesmas regras da
 *  Administração (nome + sobrenome ⛔; homônimo, iniciais e "documentos
 *  mantêm o nome antigo" ⚠️). Só o nome — perfil/ativo/função são do admin. */
export async function PATCH(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const extras = Object.keys(body).filter((k) => k !== "nomeCompleto");
  if (extras.length) return NextResponse.json({ erro: `Campo não permitido: ${extras.join(", ")}.` }, { status: 400 });
  if (typeof body.nomeCompleto !== "string" && body.nomeCompleto !== null) {
    return NextResponse.json({ erro: "Nome completo: valor inválido.", campo: "nomeCompleto" }, { status: 400 });
  }

  const nome = normalizarEspacos(body.nomeCompleto);
  const { usuarios, erro } = await carregarUsuarios();
  if (erro) return NextResponse.json({ erro }, { status: 500 });

  const r = validarUsuario({ nomeCompleto: nome }, { usuarios, modo: "editar", id: profile.id, nomeAnterior: profile.nome_completo });
  if (temErros(r)) {
    return NextResponse.json({ erro: primeiroErro(r, ROTULOS_USUARIO), erros: r.erros, avisos: r.avisos }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("gp_profiles")
    .update({ nome_completo: nome, updated_at: new Date().toISOString() })
    .eq("id", profile.id)
    .select(CAMPOS_USUARIO)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[perfil] nome:", error.message);
    return NextResponse.json({ erro: "Não foi possível salvar o nome. Tente de novo em instantes." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, usuario: data, avisos: r.avisos });
}
