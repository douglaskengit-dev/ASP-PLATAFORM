import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { clientesConflitantes } from "@/lib/orgaos/validacao-api";

export const runtime = "nodejs";

/** Checagem ao vivo do cadastro de cliente: devolve os clientes (inclusive
 * na lixeira) com o mesmo CNPJ ou razão social parecida. A tela roda
 * lib/validacao/cliente.ts com eles, igual à API ao salvar.
 * ?cnpj=&razaoSocial=&excluirId= (excluirId = cliente em edição). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const clientes = await clientesConflitantes(sp.get("cnpj") || "", sp.get("razaoSocial") || "", sp.get("excluirId"));
  return NextResponse.json({ ok: true, clientes });
}
