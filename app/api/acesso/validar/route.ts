/** Confere o link de /definir-senha antes de pedir a senha (público).
 * Não consome o link. Devolve o estado: valido | expirado | usado | invalido. */
import { NextRequest, NextResponse } from "next/server";
import { buscarLinkPorToken, mesmaOrigem, perfilAtivo } from "@/lib/asp/acesso-api";
import { estadoLink, MSG_ESTADO_LINK } from "@/lib/validacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  try {
    const link = await buscarLinkPorToken(token);
    const perfil = await perfilAtivo(link?.usuario_id || null);
    const estado = estadoLink(link, new Date(), perfil.ativo);
    if (estado !== "valido") {
      return NextResponse.json(
        // E-mail só para preencher "Pedir novo link" — quem tem o link já o recebeu nesse e-mail.
        { ok: false, estado, erro: MSG_ESTADO_LINK[estado], ...(link && estado !== "invalido" ? { email: link.email } : {}) },
        { status: estado === "invalido" ? 404 : 410 }
      );
    }
    return NextResponse.json({ ok: true, estado, tipo: link!.tipo, email: perfil.email || link!.email, expiraEm: link!.expira_em });
  } catch (e: any) {
    console.error("[acesso/validar]", e?.message || e);
    return NextResponse.json({ erro: "Não foi possível conferir o link. Tente de novo em instantes." }, { status: 500 });
  }
}
