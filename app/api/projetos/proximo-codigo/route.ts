import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { codigosDoAno, iniciaisDoPerfil, PERFIS_ESCRITA } from "@/lib/asp/projeto-validacao-api";
import { dataIsoValida, hojeBrasil, proximoCodigo } from "@/lib/validacao";

export const runtime = "nodejs";

/** Sugestão do próximo código NN/INICIAIS/AA para quem está abrindo o
 * projeto. NN = maior número do ano (de todos os usuários, lixeira inclusa)
 * + 1. ?data=AAAA-MM-DD (data de abertura; padrão hoje). É só sugestão: a
 * tela deixa editar e a unicidade é conferida ao salvar. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_ESCRITA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const pedida = req.nextUrl.searchParams.get("data") || "";
  const data = dataIsoValida(pedida) ? pedida : hojeBrasil();
  const iniciais = iniciaisDoPerfil(profile);
  const codigo = proximoCodigo(await codigosDoAno(data), iniciais, data);
  return NextResponse.json({ ok: true, codigo, iniciais });
}
