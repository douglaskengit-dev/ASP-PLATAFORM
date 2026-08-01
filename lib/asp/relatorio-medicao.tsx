/**
 * Relatório da medição em PDF, gerado no navegador a partir do estado salvo
 * do medidor — o mesmo objeto que já vai para o banco.
 *
 * Por que não reaproveitar o "Exportar em PDF" da ferramenta: aquele botão usa
 * a impressão do navegador, que salva o arquivo fora do alcance da página. Sem
 * acesso ao arquivo, não há como anexá-lo à inspeção. Aqui montamos o PDF por
 * código (@react-pdf/renderer, já usado no projeto) e devolvemos um Blob, que
 * pode ser enviado direto como coleta.
 */
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";

const cor = { titulo: "#0f5cad", linha: "#c7cdd6", fraco: "#5b6472" };

const s = StyleSheet.create({
  pagina: { padding: 34, fontSize: 9.5, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", color: cor.titulo, marginBottom: 2 },
  sub: { fontSize: 9, color: cor.fraco, marginBottom: 14 },
  h2: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6, color: cor.titulo },
  linha: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: cor.linha, paddingVertical: 3 },
  rot: { width: "48%", color: cor.fraco },
  val: { width: "52%", fontFamily: "Helvetica-Bold" },
  celula: { flex: 1, textAlign: "center", paddingVertical: 2.5, fontSize: 8 },
  cabecalho: { flexDirection: "row", backgroundColor: "#eef2f7", borderBottomWidth: 0.5, borderBottomColor: cor.linha },
  rodape: { position: "absolute", bottom: 20, left: 34, right: 34, fontSize: 7.5, color: cor.fraco, textAlign: "center" },
});

function fmt(v: any, casas = 2): string {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toFixed(casas).replace(".", ",");
}

const NOME_FORMATO: Record<string, string> = {
  circulo: "Cilíndrico (círculo)", quadrado: "Quadrado", retangulo: "Retângulo",
  ngon: "N-ágono", custom: "Personalizado",
};

export interface CabecalhoMedicao {
  inspecao: string;
  projeto?: string;
  cliente?: string;
}

/** Monta o PDF do relatório técnico da medição. */
export async function gerarPdfMedicao(estado: any, cab: CabecalhoMedicao): Promise<Blob> {
  const r = estado?.resultado || {};
  const un = estado?.unit === "cm" ? "cm" : "m";
  const linhas: number = Number(estado?.rows) || 0;
  const colunas: number = Number(estado?.cols) || 0;
  const valores: any[][] = Array.isArray(estado?.values) ? estado.values : [];
  const modo = estado?.gridMode === "radial" ? "Leque"
    : estado?.gridMode === "paralelo" ? "Vetores paralelos" : "Retangular";

  const doc = (
    <Document>
      <Page size="A4" style={s.pagina}>
        <Text style={s.h1}>Relatório Técnico da Medição</Text>
        <Text style={s.sub}>
          {cab.inspecao}
          {cab.projeto ? ` · ${cab.projeto}` : ""}
          {cab.cliente ? ` · ${cab.cliente}` : ""}
          {` · emitido em ${new Date().toLocaleString("pt-BR")}`}
        </Text>

        <Text style={s.h2}>Parâmetros do tanque</Text>
        {[
          ["Formato", NOME_FORMATO[estado?.formato || "circulo"] || "Cilíndrico"],
          [estado?.formato === "quadrado" || estado?.formato === "retangulo" ? "Comprimento" : "Diâmetro",
            `${fmt(estado?.dimValue)} ${un}`],
          ...(estado?.formato === "retangulo" ? [["Largura", `${fmt(estado?.largura)} ${un}`]] : []),
          ["Altura do tanque", `${fmt(estado?.height)} ${un}`],
          ["Área do fundo", `${fmt(r.areaM2)} m²`],
          ["Volume total do tanque", `${fmt(r.volTankM3)} m³`],
        ].map(([k, v]) => (
          <View style={s.linha} key={k as string}>
            <Text style={s.rot}>{k}</Text><Text style={s.val}>{v}</Text>
          </View>
        ))}

        <Text style={s.h2}>Resultado da batimetria</Text>
        {[
          ["Volume de sedimento", `${fmt(r.volSedM3, 3)} m³  (${fmt(r.volSedL, 0)} L)`],
          ["Faixa estimada (±5%)", `${fmt((r.volSedM3 || 0) * 0.95, 3)} a ${fmt((r.volSedM3 || 0) * 1.05, 3)} m³`],
          ["Ocupação do tanque", `${fmt(r.pct, 1)} %`],
          ["Altura média de sedimento", `${fmt(r.alturaMedia, 3)} m`],
          ["Incerteza da superfície", r.volUncM3 != null ? `± ${fmt(r.volUncM3, 3)} m³` : "—"],
          ["Método de cálculo", r.metodo === "idw" ? "Integral IDW (polar)"
            : r.metodo === "idw-grid" ? "Integral IDW (grade)" : "Média × área"],
          ["Pontos utilizados", `${r.pontos ?? "—"} de ${linhas * colunas}`],
          ["Disposição dos pontos", `${modo} — ${linhas} × ${colunas}`],
        ].map(([k, v]) => (
          <View style={s.linha} key={k as string}>
            <Text style={s.rot}>{k}</Text><Text style={s.val}>{v}</Text>
          </View>
        ))}

        <Text style={s.rodape}>
          ASP Serviços Industriais — documento gerado automaticamente pelo medidor de sedimento.
        </Text>
      </Page>

      {linhas > 0 && colunas > 0 && (
        <Page size="A4" style={s.pagina}>
          <Text style={s.h2}>Matriz de pontos — espessura de sedimento ({un})</Text>
          <View style={s.cabecalho}>
            <Text style={[s.celula, { fontFamily: "Helvetica-Bold" }]}>#</Text>
            {Array.from({ length: colunas }, (_, j) => (
              <Text key={j} style={[s.celula, { fontFamily: "Helvetica-Bold" }]}>{j + 1}</Text>
            ))}
          </View>
          {Array.from({ length: linhas }, (_, i) => (
            <View key={i} style={s.linha}>
              <Text style={[s.celula, { fontFamily: "Helvetica-Bold" }]}>{String.fromCharCode(65 + i)}</Text>
              {Array.from({ length: colunas }, (_, j) => (
                <Text key={j} style={s.celula}>
                  {valores[i]?.[j] == null ? "—" : fmt(valores[i][j], 3)}
                </Text>
              ))}
            </View>
          ))}
          <Text style={s.rodape}>
            ASP Serviços Industriais — documento gerado automaticamente pelo medidor de sedimento.
          </Text>
        </Page>
      )}
    </Document>
  );

  return pdf(doc).toBlob();
}
