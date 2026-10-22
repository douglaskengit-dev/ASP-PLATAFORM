import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { NovoContatoInput } from "@/lib/orgaos/types";
import { contatosDoCliente } from "@/lib/orgaos/validacao-api";
import { contatoParaGravar, primeiroErro, temErros, validarContato } from "@/lib/validacao";

export const runtime = "nodejs";

/** Atualiza um contato do cliente — usado no "Atualizar contato" da
 * abertura de projeto. Mesmas regras do cadastro (lib/validacao/cliente.ts),
 * com o próprio contato fora da checagem de repetidos. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; contatoId: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const existentes = await contatosDoCliente(params.id);
  if (!existentes.some((c) => c.id === params.contatoId)) {
    return NextResponse.json({ erro: "Contato não encontrado neste cliente." }, { status: 404 });
  }

  const body = (await req.json()) as NovoContatoInput;
  const resultado = validarContato({ ...body, id: params.contatoId }, existentes);
  if (temErros(resultado)) {
    return NextResponse.json(
      { erro: primeiroErro(resultado), erros: resultado.erros, avisos: resultado.avisos },
      { status: 400 }
    );
  }

  const supabase = getSupabaseRouteClient();
  const { data: contato, error } = await supabase
    .from("gp_orgaos_contatos")
    .update(contatoParaGravar(body))
    .eq("id", params.contatoId)
    .eq("orgao_id", params.id)
    .select("*")
    .single();
  if (error || !contato) {
    return NextResponse.json(
      { erro: "Falha ao salvar o contato: " + (error?.message || "erro desconhecido") },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, contato, avisos: resultado.avisos });
}
