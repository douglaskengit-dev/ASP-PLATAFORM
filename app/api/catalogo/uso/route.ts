import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { ehUuid } from "@/lib/asp/coleta-api";
import { tipoCatalogo, usoDoItem } from "@/lib/asp/catalogo-api";
import { decisaoExclusao, textoRenomeacao, textoUso, totalUso } from "@/lib/validacao";

export const runtime = "nodejs";

/** Onde um item do Catálogo é usado: ?tipo=procedimento&id=...
 *  Alimenta a confirmação do renomear ("X OSs, Y checklists, Z rascunhos…")
 *  e a escolha entre Excluir (sem uso) e Desativar (em uso). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const tipo = tipoCatalogo(req.nextUrl.searchParams.get("tipo"));
  const id = req.nextUrl.searchParams.get("id");
  if (!tipo || !ehUuid(id)) return NextResponse.json({ erro: "Tipo ou id inválido." }, { status: 400 });
  const { uso, erro } = await usoDoItem(tipo, id);
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  if (!uso) return NextResponse.json({ erro: "Item não encontrado." }, { status: 404 });
  return NextResponse.json({
    ok: true, uso, total: totalUso(uso), texto: textoUso(tipo, uso),
    renomeacao: textoRenomeacao(tipo, uso), decisao: decisaoExclusao(uso),
  });
}
