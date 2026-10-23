/** Admin: envia por e-mail o link de acesso de um usuário.
 *   { tipo: "convite" }     → "Reenviar convite" (24 h) — só para quem nunca entrou
 *   { tipo: "redefinicao" } → "Enviar link de redefinição" (1 h)
 * Emitir um link novo invalida os anteriores do mesmo tipo. Se o e-mail não
 * sair, a resposta traz o motivo e o link (só agora, só para o admin) para
 * "Copiar link" — no banco fica só o hash. */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { emitirLinkAcesso, mesmaOrigem } from "@/lib/asp/acesso-api";
import { tipoLinkValido } from "@/lib/validacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const eu = await getProfileAtual();
  if (!eu) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (eu.perfil !== "admin") return NextResponse.json({ erro: "Apenas administradores podem gerenciar usuários." }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const tipo = body?.tipo;
  if (!tipoLinkValido(tipo)) return NextResponse.json({ erro: "Tipo de link inválido." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: alvo } = await admin.from("gp_profiles").select("id, email, nome_completo, ativo").eq("id", params.id).maybeSingle();
  if (!alvo) return NextResponse.json({ erro: "Usuário não encontrado (excluído por outro administrador?). Recarregue a página." }, { status: 404 });
  if (!(alvo as any).ativo) {
    return NextResponse.json({ erro: "Usuário inativo — marque \"Ativo\" antes de enviar um link de acesso." }, { status: 409 });
  }

  if (tipo === "convite") {
    const { data: au, error } = await admin.auth.admin.getUserById(params.id);
    if (error || !au?.user) {
      return NextResponse.json({ erro: "Não foi possível consultar o login do usuário. Tente de novo em instantes." }, { status: 502 });
    }
    if (au.user.last_sign_in_at) {
      return NextResponse.json({ erro: "Este usuário já acessou o sistema — use \"Enviar link de redefinição\"." }, { status: 409 });
    }
  }

  const r = await emitirLinkAcesso({ usuario: alvo as any, tipo, criadoPor: eu.id, req, devolverLinkSeFalhar: true });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 500 });
  return NextResponse.json(r);
}
