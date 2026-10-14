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

/**
 * Exclui o usuário definitivamente (perfil + conta de login).
 * Se ele já tiver registros vinculados (projetos, inspeções, coletas etc.),
 * o banco bloqueia a exclusão para não perder o histórico — nesse caso a
 * orientação é desativá-lo.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const check = await exigirAdmin();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });

  if (params.id === check.profile.id) {
    return NextResponse.json({ erro: "Você não pode excluir o próprio usuário." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Remove primeiro o perfil: se houver registros vinculados, a FK falha aqui
  // (código 23503) sem ter apagado nada — a conta de login continua intacta.
  const { error: erroPerfil } = await admin.from("gp_profiles").delete().eq("id", params.id);
  if (erroPerfil) {
    if (erroPerfil.code === "23503") {
      return NextResponse.json(
        {
          erro:
            "Este usuário possui registros vinculados (projetos, inspeções, coletas etc.) e não pode ser excluído. Desmarque \"Ativo\" para bloquear o acesso mantendo o histórico.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ erro: erroPerfil.message }, { status: 500 });
  }

  const { error: erroAuth } = await admin.auth.admin.deleteUser(params.id);
  if (erroAuth && erroAuth.status !== 404) {
    return NextResponse.json({ erro: erroAuth.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
