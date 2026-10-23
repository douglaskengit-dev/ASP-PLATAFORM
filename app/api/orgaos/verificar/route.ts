import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { cidadesDaUf, clientesConflitantes } from "@/lib/orgaos/validacao-api";

export const runtime = "nodejs";

/** Checagem ao vivo do cadastro de cliente: devolve os clientes (inclusive
 * na lixeira) com o mesmo CNPJ ou razão social parecida e, com ?uf=, as
 * grafias de cidade já usadas naquela UF. A tela roda
 * lib/validacao/cliente.ts com eles, igual à API ao salvar.
 * ?cnpj=&razaoSocial=&uf=&excluirId= (excluirId = cliente em edição). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const excluirId = sp.get("excluirId");
  const [clientes, cidades] = await Promise.all([
    sp.get("cnpj") || sp.get("razaoSocial")
      ? clientesConflitantes(sp.get("cnpj") || "", sp.get("razaoSocial") || "", excluirId)
      : Promise.resolve([]),
    cidadesDaUf(sp.get("uf"), excluirId),
  ]);
  return NextResponse.json({ ok: true, clientes, cidades });
}
