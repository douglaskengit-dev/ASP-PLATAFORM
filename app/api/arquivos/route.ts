import { NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

/** Lista os documentos do novo fluxo agrupados por Projeto → Inspeção:
 * coletas (PDF do medidor) e relatórios versionados (inspeção/execução),
 * com o PDF do laudo do laboratório de cada relatório de execução (Fase 8).
 * RDOs são do projeto (um por dia, cobrindo uma ou mais inspeções) e vêm em
 * `rdos`, no nível do projeto. Alimenta a aba Arquivos e a seção "Arquivos
 * do projeto" da inspeção. Só retorna itens que têm arquivo anexado. */
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
        " relatorios:gp_relatorios(id, tipo, versao, status, arquivo_path, assinado_path, enviado_em, laudo:dados->laudoPdf, laudoDepois:dados->laudoPdfDepois))"
    )
    .order("criado_em", { ascending: false });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  // RDOs numa consulta à parte: sem a tabela (migration ainda não rodada) a
  // aba continua funcionando, só sem eles.
  const { data: rdos } = await supabase
    .from("gp_rdos")
    .select("id, projeto_id, numero, data, inspecoes, arquivo_path, arquivo_em")
    .is("excluido_em", null)
    .not("arquivo_path", "is", null)
    .order("data", { ascending: false });

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
      // Nomes das inspeções cobertas saem de TODAS as do projeto, não só das
      // que têm arquivo.
      const nomes = new Map<string, string>((p.inspecoes || []).map((i: any) => [i.id, i.identificacao]));
      const rdosDoProjeto = (rdos || [])
        .filter((r: any) => r.projeto_id === p.id)
        .map((r: any) => ({
          id: r.id, numero: r.numero, data: r.data, arquivo_em: r.arquivo_em,
          inspecoes: (r.inspecoes || []).map((id: string) => nomes.get(id)).filter(Boolean),
        }));
      return { ...p, inspecoes, rdos: rdosDoProjeto };
    })
    .filter((p: any) => p.inspecoes.length > 0 || p.rdos.length > 0);

  return NextResponse.json({ ok: true, projetos: resultado });
}
