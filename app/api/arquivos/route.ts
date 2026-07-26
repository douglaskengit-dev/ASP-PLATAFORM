import { NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

/** Lista os documentos do novo fluxo agrupados por Projeto → Inspeção:
 * coletas (PDF do medidor) e relatórios versionados (inspeção/execução).
 * Alimenta a aba Arquivos. Só retorna itens que têm arquivo anexado. */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();

  const { data: projetos, error } = await supabase
    .from("gp_projetos")
    .select(
      "id, codigo_projeto, pedido_compra, criado_em, cliente:gp_orgaos(id, razao_social)," +
        " inspecoes:gp_inspecoes(id, identificacao, fase," +
        " coletas:gp_coletas(id, tipo, pdf_path, criado_em)," +
        " relatorios:gp_relatorios(id, tipo, versao, status, arquivo_path, enviado_em))"
    )
    .order("criado_em", { ascending: false });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  // Mantém só inspeções com algum arquivo, e projetos com alguma inspeção com arquivo.
  const resultado = (projetos || [])
    .map((p: any) => {
      const inspecoes = (p.inspecoes || [])
        .map((i: any) => ({
          id: i.id,
          identificacao: i.identificacao,
          fase: i.fase,
          coletas: (i.coletas || []).filter((c: any) => c.pdf_path),
          relatorios: (i.relatorios || []).filter((r: any) => r.arquivo_path),
        }))
        .filter((i: any) => i.coletas.length > 0 || i.relatorios.length > 0);
      return { ...p, inspecoes };
    })
    .filter((p: any) => p.inspecoes.length > 0);

  return NextResponse.json({ ok: true, projetos: resultado });
}
