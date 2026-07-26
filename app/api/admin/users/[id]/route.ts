import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getProfileAtual } from "@/lib/supabase/route";

export const runtime = "nodejs";

async function exigirAdmin() {
  const profile = await getProfileAtual();
  if (!profile) return { erro: "Não autenticado.", status: 401 as const };
  if (profile.perfil !== "admin")
    return { erro: "Apenas administradores podem gerenciar usuários.", status: 403 as const };
  return { profile };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const check = await exigirAdmin();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });

  const body = await req.json();
  const { nomeCompleto, perfil, ativo, funcao, senha } = body || {};

  const admin = getSupabaseAdmin();

  // Redefinição de senha (auth) — opcional.
  if (senha !== undefined) {
    if (typeof senha !== "string" || senha.length < 6) {
      return NextResponse.json({ erro: "A nova senha deve ter ao menos 6 caracteres." }, { status: 400 });
    }
    const { error: erroSenha } = await admin.auth.admin.updateUserById(params.id, { password: senha });
    if (erroSenha) return NextResponse.json({ erro: erroSenha.message }, { status: 500 });
  }

  const campos = {
    ...(nomeCompleto !== undefined ? { nome_completo: nomeCompleto } : {}),
    ...(perfil !== undefined ? { perfil } : {}),
    ...(ativo !== undefined ? { ativo } : {}),
    ...(funcao !== undefined ? { funcao: funcao || null } : {}),
  };
  if (Object.keys(campos).length > 0) {
    const { error } = await admin.from("gp_profiles").update(campos).eq("id", params.id);
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
