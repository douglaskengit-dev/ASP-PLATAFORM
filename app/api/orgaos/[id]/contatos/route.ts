import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { NovoContatoInput } from "@/lib/orgaos/types";
import { contatosDoCliente } from "@/lib/orgaos/validacao-api";
import { contatoParaGravar, primeiroErro, temErros, validarContato } from "@/lib/validacao";

export const runtime = "nodejs";

/** Adiciona um novo contato a um órgão já cadastrado — usado tanto pela
 * tela de órgãos quanto pelo botão "Adicionar contato" nas telas de análise
 * de TR e geração de proposta. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  // Regras em lib/validacao/cliente.ts: nome/cargo/e-mail obrigatórios,
  // e-mail válido, nome e e-mail sem repetir dentro do mesmo cliente.
  const body = (await req.json()) as NovoContatoInput;
  const resultado = validarContato(body, await contatosDoCliente(params.id));
  if (temErros(resultado)) {
    return NextResponse.json(
      { erro: primeiroErro(resultado), erros: resultado.erros, avisos: resultado.avisos },
      { status: 400 }
    );
  }

  const supabase = getSupabaseRouteClient();

  const { data: orgao, error: erroOrgao } = await supabase
    .from("gp_orgaos")
    .select("id")
    .eq("id", params.id)
    .single();
  if (erroOrgao || !orgao) {
    return NextResponse.json({ erro: "Órgão não encontrado." }, { status: 404 });
  }

  const { data: contato, error } = await supabase
    .from("gp_orgaos_contatos")
    .insert({ orgao_id: params.id, ...contatoParaGravar(body) })
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
