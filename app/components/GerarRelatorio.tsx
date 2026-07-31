"use client";

/** Geração do Relatório Técnico a partir do template da ASP.
 *
 * A tela é organizada por tópico: cada um tem uma caixa de seleção e, logo
 * abaixo, os campos daquele tópico e o envio de fotos correspondente. Ao
 * desmarcar, a seção sai do documento e os números seguintes são reajustados.
 * A capa é o tópico 0 e também pode ser omitida. */
import { useMemo, useState } from "react";
import Modal from "./Modal";
import {
  gerarRelatorioDocx, TOPICOS_PADRAO, TOPICO_CAPA,
  type DadosRelatorio, type ImagemRelatorio,
} from "@/lib/asp/relatorio";

export interface UsuarioRelatorio { id: string; nome: string; perfil: string; funcao: string | null }

interface Props {
  onFechar: () => void;
  inicial: Partial<DadosRelatorio>;
  nomeArquivo: string;
  /** Usuários da base — a lista de envolvidos sai daqui. */
  usuarios: UsuarioRelatorio[];
}

interface FotoTopico { arquivo: File; legenda: string; topico: number }

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 };
const grade: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
};

const TODOS_TOPICOS = [TOPICO_CAPA, ...TOPICOS_PADRAO];

export default function GerarRelatorio({ onFechar, inicial, nomeArquivo, usuarios }: Props) {
  const [d, setD] = useState<Partial<DadosRelatorio>>(inicial);
  const [visiveis, setVisiveis] = useState<Record<number, boolean>>(
    Object.fromEntries(TODOS_TOPICOS.map((t) => [t.numero, true]))
  );
  const [equipeIds, setEquipeIds] = useState<string[]>([]);
  const [fotos, setFotos] = useState<FotoTopico[]>([]);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const set = (k: keyof DadosRelatorio) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setD((v) => ({ ...v, [k]: e.target.value }));

  const ativo = (n: number) => visiveis[n] !== false;
  const qtdOcultos = useMemo(() => TODOS_TOPICOS.filter((t) => !ativo(t.numero)).length, [visiveis]);

  const nomesEquipe = useMemo(
    () => usuarios.filter((u) => equipeIds.includes(u.id))
      .map((u) => (u.funcao ? `${u.nome} (${u.funcao})` : u.nome)).join(", "),
    [usuarios, equipeIds]
  );

  function addFotos(lista: FileList | null, topico: number) {
    const fs = Array.from(lista || []);
    if (fs.length === 0) return;
    setFotos((p) => [...p, ...fs.map((f) => ({ arquivo: f, legenda: "", topico }))]);
  }

  async function gerar() {
    setErro(null);
    if (ativo(0) && !d.titulo?.trim()) { setErro("Informe o título do relatório (capa)."); return; }
    setGerando(true);
    try {
      const imgs: ImagemRelatorio[] = [];
      for (const f of fotos) {
        if (!ativo(f.topico)) continue;               // tópico oculto: ignora a foto
        const ext = f.arquivo.type.includes("png") || f.arquivo.name.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        imgs.push({
          dados: await f.arquivo.arrayBuffer(),
          extensao: ext as "png" | "jpeg",
          legenda: f.legenda || f.arquivo.name.replace(/\.[^.]+$/, ""),
          topico: f.topico,
        });
      }
      const blob = await gerarRelatorioDocx({
        titulo: d.titulo || "", cliente: d.cliente || "", endereco: d.endereco || "",
        unidade: d.unidade, contato: d.contato,
        dataExecucao: d.dataExecucao, dataRelatorio: d.dataRelatorio,
        tag: d.tag, area: d.area, material: d.material,
        capacidadeNominal: d.capacidadeNominal, alturaTanque: d.alturaTanque, diametro: d.diametro,
        observacoesTanque: d.observacoesTanque,
        metodos: d.metodos, equipamentos: d.equipamentos,
        equipe: nomesEquipe || d.equipe,
        volumeSedimento: d.volumeSedimento, observacoes: d.observacoes, conclusao: d.conclusao,
        topicos: TODOS_TOPICOS.map((t) => ({ ...t, visivel: ativo(t.numero) })),
        imagens: imgs,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${nomeArquivo}.docx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o relatório.");
    } finally {
      setGerando(false);
    }
  }

  /** Bloco de fotos de um tópico. */
  function BlocoFotos({ topico }: { topico: number }) {
    const minhas = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.topico === topico);
    return (
      <div style={{ marginTop: 10 }}>
        <label style={rotulo}>Fotos deste tópico (legenda “Figura N – …” conforme ABNT)</label>
        <input type="file" accept="image/png,image/jpeg" multiple
          onChange={(e) => { addFotos(e.target.files, topico); e.target.value = ""; }} />
        {minhas.map(({ f, i }) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 6, alignItems: "center" }}>
            <span className="detalhe" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{f.arquivo.name}</span>
            <input style={campo} placeholder="Legenda da figura" value={f.legenda}
              onChange={(e) => setFotos((p) => p.map((x, k) => k === i ? { ...x, legenda: e.target.value } : x))} />
            <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
              onClick={() => setFotos((p) => p.filter((_, k) => k !== i))}>Remover</button>
          </div>
        ))}
      </div>
    );
  }

  /** Um tópico: cabeçalho com seleção + campos logo abaixo quando ativo. */
  function Topico({ numero, titulo, children }: { numero: number; titulo: string; children?: React.ReactNode }) {
    const on = ativo(numero);
    return (
      <div style={{
        border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 12px",
        opacity: on ? 1 : 0.55, background: on ? "transparent" : "var(--bg-suave)",
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>
          <input type="checkbox" checked={on}
            onChange={(e) => setVisiveis((v) => ({ ...v, [numero]: e.target.checked }))} />
          <span>{numero === 0 ? titulo : `${numero}. ${titulo}`}</span>
        </label>
        {on && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {children}
            <BlocoFotos topico={numero} />
          </div>
        )}
      </div>
    );
  }

  return (
    <Modal titulo="📄 Gerar Relatório Técnico" largo onFechar={onFechar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="detalhe" style={{ margin: 0 }}>
          Preenche o modelo oficial da ASP mantendo timbre, cabeçalho e rodapé. Formatação conforme
          ABNT (NBR 14724): Arial 12, entrelinha 1,5, texto justificado, margens 3/2/3/2 cm e legendas
          de figura em Arial 10. {qtdOcultos > 0 && <strong>{qtdOcultos} tópico(s) oculto(s) — os demais são renumerados.</strong>}
        </p>

        <Topico numero={0} titulo={TOPICO_CAPA.titulo}>
          <div style={grade}>
            <div><label style={rotulo}>Título do relatório *</label>
              <input style={campo} value={d.titulo || ""} onChange={set("titulo")} placeholder="ex.: Batimetria — Tanque TQ-01" /></div>
            <div><label style={rotulo}>Cliente</label>
              <input style={campo} value={d.cliente || ""} onChange={set("cliente")} /></div>
            <div><label style={rotulo}>Endereço</label>
              <input style={campo} value={d.endereco || ""} onChange={set("endereco")} /></div>
            <div><label style={rotulo}>Data do relatório</label>
              <input style={campo} value={d.dataRelatorio || ""} onChange={set("dataRelatorio")} placeholder="dd/mm/aaaa" /></div>
          </div>
        </Topico>

        <Topico numero={1} titulo="Identificação do local">
          <div style={grade}>
            <div><label style={rotulo}>Unidade</label><input style={campo} value={d.unidade || ""} onChange={set("unidade")} /></div>
            <div><label style={rotulo}>Contato</label><input style={campo} value={d.contato || ""} onChange={set("contato")} /></div>
            <div><label style={rotulo}>Data de execução</label><input style={campo} value={d.dataExecucao || ""} onChange={set("dataExecucao")} placeholder="dd/mm/aaaa" /></div>
          </div>
        </Topico>

        <Topico numero={2} titulo="Identificação do tanque">
          <div style={grade}>
            <div><label style={rotulo}>TAG</label><input style={campo} value={d.tag || ""} onChange={set("tag")} /></div>
            <div><label style={rotulo}>Área</label><input style={campo} value={d.area || ""} onChange={set("area")} /></div>
            <div><label style={rotulo}>Material</label><input style={campo} value={d.material || ""} onChange={set("material")} /></div>
            <div><label style={rotulo}>Capacidade nominal</label><input style={campo} value={d.capacidadeNominal || ""} onChange={set("capacidadeNominal")} /></div>
            <div><label style={rotulo}>Altura do tanque</label><input style={campo} value={d.alturaTanque || ""} onChange={set("alturaTanque")} /></div>
            <div><label style={rotulo}>Diâmetro</label><input style={campo} value={d.diametro || ""} onChange={set("diametro")} /></div>
          </div>
          <div><label style={rotulo}>Observações</label>
            <textarea style={{ ...campo, minHeight: 56 }} value={d.observacoesTanque || ""} onChange={set("observacoesTanque")} /></div>
        </Topico>

        <Topico numero={3} titulo="Métodos">
          <textarea style={{ ...campo, minHeight: 76 }} value={d.metodos || ""} onChange={set("metodos")}
            placeholder="Descreva o método de inspeção empregado." />
        </Topico>

        <Topico numero={4} titulo="Equipamentos utilizados">
          <textarea style={{ ...campo, minHeight: 60 }} value={d.equipamentos || ""} onChange={set("equipamentos")} />
        </Topico>

        <Topico numero={5} titulo="Equipe de trabalho">
          <label style={rotulo}>Envolvidos — selecione entre os usuários cadastrados</label>
          {usuarios.length === 0 ? (
            <p className="vazio" style={{ margin: 0 }}>Nenhum usuário disponível.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
              {usuarios.map((u) => (
                <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={equipeIds.includes(u.id)}
                    onChange={(e) => setEquipeIds((p) => e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id))} />
                  <span>{u.nome}{u.funcao ? <span className="detalhe"> · {u.funcao}</span> : null}</span>
                </label>
              ))}
            </div>
          )}
          {nomesEquipe && <p className="detalhe" style={{ margin: "6px 0 0" }}>No relatório: {nomesEquipe}</p>}
        </Topico>

        <Topico numero={6} titulo="Dados reservatório" />

        <Topico numero={7} titulo="Batimetria">
          <div><label style={rotulo}>Volume de sedimento</label>
            <input style={campo} value={d.volumeSedimento || ""} onChange={set("volumeSedimento")} placeholder="ex.: 12,480 m³" /></div>
          <p className="detalhe" style={{ margin: 0 }}>As figuras deste tópico entram no lugar do marcador de imagens da batimetria.</p>
        </Topico>

        <Topico numero={8} titulo="Imagens do fundo do tanque" />

        <Topico numero={9} titulo="Observações">
          <textarea style={{ ...campo, minHeight: 60 }} value={d.observacoes || ""} onChange={set("observacoes")} />
        </Topico>

        <Topico numero={10} titulo="Conclusão">
          <textarea style={{ ...campo, minHeight: 76 }} value={d.conclusao || ""} onChange={set("conclusao")} />
        </Topico>

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
