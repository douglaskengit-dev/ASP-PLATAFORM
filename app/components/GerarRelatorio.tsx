"use client";

/** Geração do Relatório Técnico a partir do template da ASP.
 *
 * O formulário já vem preenchido com o que o sistema sabe (cliente, endereço,
 * tanque, volume de sedimento da medição, equipe do agendamento) e permite
 * revisar tudo antes de gerar. Cada tópico pode ser desmarcado — a seção some
 * do documento e os números seguintes são reajustados. */
import { useMemo, useState } from "react";
import Modal from "./Modal";
import { gerarRelatorioDocx, TOPICOS_PADRAO, type DadosRelatorio, type ImagemRelatorio } from "@/lib/asp/relatorio";

interface Props {
  onFechar: () => void;
  /** Dados já conhecidos da inspeção/projeto. */
  inicial: Partial<DadosRelatorio>;
  /** Nome do arquivo sugerido (sem extensão). */
  nomeArquivo: string;
}

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 };

export default function GerarRelatorio({ onFechar, inicial, nomeArquivo }: Props) {
  const [d, setD] = useState<Partial<DadosRelatorio>>(inicial);
  const [visiveis, setVisiveis] = useState<Record<number, boolean>>(
    Object.fromEntries(TOPICOS_PADRAO.map((t) => [t.numero, true]))
  );
  const [imagens, setImagens] = useState<{ arquivo: File; legenda: string; topico: number }[]>([]);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const set = (k: keyof DadosRelatorio) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD((v) => ({ ...v, [k]: e.target.value }));

  const qtdOcultos = useMemo(() => TOPICOS_PADRAO.filter((t) => !visiveis[t.numero]).length, [visiveis]);

  async function gerar() {
    setErro(null);
    if (!d.titulo?.trim()) { setErro("Informe o título do relatório."); return; }
    setGerando(true);
    try {
      const imgs: ImagemRelatorio[] = [];
      for (const im of imagens) {
        const ext = im.arquivo.name.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        imgs.push({
          dados: await im.arquivo.arrayBuffer(),
          extensao: ext as "png" | "jpeg",
          legenda: im.legenda || im.arquivo.name.replace(/\.[^.]+$/, ""),
          topico: im.topico,
        });
      }
      const blob = await gerarRelatorioDocx({
        titulo: d.titulo || "", cliente: d.cliente || "", endereco: d.endereco || "",
        unidade: d.unidade, contato: d.contato,
        dataExecucao: d.dataExecucao, dataRelatorio: d.dataRelatorio,
        tag: d.tag, area: d.area, material: d.material,
        capacidadeNominal: d.capacidadeNominal, alturaTanque: d.alturaTanque, diametro: d.diametro,
        observacoesTanque: d.observacoesTanque,
        metodos: d.metodos, equipamentos: d.equipamentos, equipe: d.equipe,
        volumeSedimento: d.volumeSedimento, observacoes: d.observacoes, conclusao: d.conclusao,
        topicos: TOPICOS_PADRAO.map((t) => ({ ...t, visivel: visiveis[t.numero] !== false })),
        imagens: imgs,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nomeArquivo}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o relatório.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <Modal titulo="📄 Gerar Relatório Técnico" largo onFechar={onFechar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p className="detalhe" style={{ margin: 0 }}>
          Preenche o modelo oficial da ASP mantendo timbre, cabeçalho e rodapé. Formatação conforme
          ABNT (NBR 14724): Arial 12, entrelinha 1,5, texto justificado, margens 3/2/3/2 cm e
          legendas de figura em Arial 10.
        </p>

        <div>
          <strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>
            Tópicos do relatório {qtdOcultos > 0 && <span className="detalhe">— {qtdOcultos} oculto(s), os demais são renumerados</span>}
          </strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
            {TOPICOS_PADRAO.map((t) => (
              <label key={t.numero} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={visiveis[t.numero] !== false}
                  onChange={(e) => setVisiveis((v) => ({ ...v, [t.numero]: e.target.checked }))} />
                <span>{t.numero}. {t.titulo}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div><label style={rotulo}>Título do relatório *</label>
            <input style={campo} value={d.titulo || ""} onChange={set("titulo")} placeholder="ex.: Batimetria — Tanque TQ-01" /></div>
          <div><label style={rotulo}>Cliente</label>
            <input style={campo} value={d.cliente || ""} onChange={set("cliente")} /></div>
          <div><label style={rotulo}>Endereço</label>
            <input style={campo} value={d.endereco || ""} onChange={set("endereco")} /></div>
          <div><label style={rotulo}>Unidade</label>
            <input style={campo} value={d.unidade || ""} onChange={set("unidade")} /></div>
          <div><label style={rotulo}>Contato</label>
            <input style={campo} value={d.contato || ""} onChange={set("contato")} /></div>
          <div><label style={rotulo}>Data de execução</label>
            <input style={campo} value={d.dataExecucao || ""} onChange={set("dataExecucao")} placeholder="dd/mm/aaaa" /></div>
          <div><label style={rotulo}>Data do relatório</label>
            <input style={campo} value={d.dataRelatorio || ""} onChange={set("dataRelatorio")} placeholder="dd/mm/aaaa" /></div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div><label style={rotulo}>TAG</label><input style={campo} value={d.tag || ""} onChange={set("tag")} /></div>
          <div><label style={rotulo}>Área</label><input style={campo} value={d.area || ""} onChange={set("area")} /></div>
          <div><label style={rotulo}>Material</label><input style={campo} value={d.material || ""} onChange={set("material")} /></div>
          <div><label style={rotulo}>Capacidade nominal</label><input style={campo} value={d.capacidadeNominal || ""} onChange={set("capacidadeNominal")} /></div>
          <div><label style={rotulo}>Altura do tanque</label><input style={campo} value={d.alturaTanque || ""} onChange={set("alturaTanque")} /></div>
          <div><label style={rotulo}>Diâmetro</label><input style={campo} value={d.diametro || ""} onChange={set("diametro")} /></div>
          <div><label style={rotulo}>Volume de sedimento</label><input style={campo} value={d.volumeSedimento || ""} onChange={set("volumeSedimento")} /></div>
        </div>

        {visiveis[3] !== false && (
          <div><label style={rotulo}>3. Métodos</label>
            <textarea style={{ ...campo, minHeight: 70 }} value={d.metodos || ""} onChange={set("metodos")} /></div>
        )}
        {visiveis[4] !== false && (
          <div><label style={rotulo}>4. Equipamentos utilizados</label>
            <textarea style={{ ...campo, minHeight: 60 }} value={d.equipamentos || ""} onChange={set("equipamentos")} /></div>
        )}
        {visiveis[5] !== false && (
          <div><label style={rotulo}>5. Equipe de trabalho</label>
            <input style={campo} value={d.equipe || ""} onChange={set("equipe")} /></div>
        )}
        {visiveis[9] !== false && (
          <div><label style={rotulo}>9. Observações</label>
            <textarea style={{ ...campo, minHeight: 60 }} value={d.observacoes || ""} onChange={set("observacoes")} /></div>
        )}
        {visiveis[10] !== false && (
          <div><label style={rotulo}>10. Conclusão</label>
            <textarea style={{ ...campo, minHeight: 70 }} value={d.conclusao || ""} onChange={set("conclusao")} /></div>
        )}

        <div>
          <label style={rotulo}>Figuras (entram com legenda “Figura N – …” conforme ABNT)</label>
          <input type="file" accept="image/png,image/jpeg" multiple
            onChange={(e) => {
              const fs = Array.from(e.target.files || []);
              setImagens((prev) => [...prev, ...fs.map((f) => ({ arquivo: f, legenda: "", topico: 7 }))]);
            }} />
          {imagens.map((im, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 8, alignItems: "end" }}>
              <span className="detalhe" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{im.arquivo.name}</span>
              <input style={campo} placeholder="Legenda da figura" value={im.legenda}
                onChange={(e) => setImagens((p) => p.map((x, k) => k === i ? { ...x, legenda: e.target.value } : x))} />
              <select style={campo} value={im.topico}
                onChange={(e) => setImagens((p) => p.map((x, k) => k === i ? { ...x, topico: Number(e.target.value) } : x))}>
                {TOPICOS_PADRAO.map((t) => <option key={t.numero} value={t.numero}>{t.numero}. {t.titulo}</option>)}
              </select>
              <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                onClick={() => setImagens((p) => p.filter((_, k) => k !== i))}>Remover</button>
            </div>
          ))}
        </div>

        {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn-azul btn-sec" onClick={onFechar} disabled={gerando}>Cancelar</button>
          <button className="btn-azul" onClick={gerar} disabled={gerando}>
            {gerando ? "Gerando…" : "Gerar e baixar (.docx)"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
