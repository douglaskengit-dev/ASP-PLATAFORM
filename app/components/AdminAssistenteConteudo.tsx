"use client";

/** Admin: o que perguntaram ao Robô ASP, o que ele respondeu e como foi
 *  avaliado (/admin/assistente). Uma resposta boa vira exemplo aprovado —
 *  revisado à mão, porque o exemplo vai no prompt para TODOS os usuários. */
import { useCallback, useEffect, useState } from "react";

interface Resposta {
  id: string; pergunta: string; resposta: string; pagina: string | null; consultas: string[];
  fora_do_escopo: boolean; reserva: boolean; provedor: string | null; avaliacao: 1 | -1 | null;
  comentario: string | null; criado_em: string; usuario: { nome_completo: string | null; perfil: string | null } | null;
}
interface Exemplo { id?: string; pergunta: string; resposta: string; ativo?: boolean; origem_id?: string | null }
interface Resumo { total: number; positivas: number; negativas: number; recusas: number; reservas: number }

const FILTROS: [string, string][] = [
  ["negativas", "👎 Negativas"], ["todas", "Todas"], ["positivas", "👍 Positivas"],
  ["recusas", "Fora do escopo"], ["reservas", "Respostas de reserva"],
];
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const caixa = { border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 12px" } as const;

export default function AdminAssistenteConteudo() {
  const [filtro, setFiltro] = useState("negativas");
  const [dias, setDias] = useState(30);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [exemplos, setExemplos] = useState<Exemplo[]>([]);
  const [editando, setEditando] = useState<Exemplo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [r, e] = await Promise.all([
        fetch(`/api/assistente/respostas?filtro=${filtro}&dias=${dias}`).then((x) => x.json()),
        fetch("/api/assistente/exemplos").then((x) => x.json()),
      ]);
      if (!r.ok) throw new Error(r.erro || "Falha ao carregar.");
      setRespostas(r.respostas);
      setResumo(r.resumo);
      setExemplos(e.ok ? e.exemplos : []);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }, [filtro, dias]);
  useEffect(() => { carregar(); }, [carregar]);

  async function salvarExemplo(ex: Exemplo) {
    const resp = await fetch("/api/assistente/exemplos", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ex),
    }).then((x) => x.json()).catch(() => ({ erro: "Falha de conexão." }));
    if (!resp.ok) { setErro(resp.erro || "Não foi possível salvar."); return; }
    setEditando(null);
    carregar();
  }

  async function limparGuardadas() {
    if (!confirm("Apagar todas as respostas guardadas das dúvidas de uso? Elas voltam a ser geradas pela IA.")) return;
    const r = await fetch("/api/assistente/cache", { method: "DELETE" }).then((x) => x.json()).catch(() => ({}));
    alert(r.ok ? "Respostas guardadas apagadas." : r.erro || "Não foi possível apagar.");
  }

  async function excluirExemplo(id: string) {
    if (!confirm("Excluir este exemplo? O robô deixa de usá-lo.")) return;
    await fetch(`/api/assistente/exemplos?id=${id}`, { method: "DELETE" });
    carregar();
  }

  const kpis: [string, number][] = resumo
    ? [["Perguntas", resumo.total], ["👍 Úteis", resumo.positivas], ["👎 Ruins", resumo.negativas], ["Fora do escopo", resumo.recusas], ["Reserva", resumo.reservas]]
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {resumo && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          {kpis.map(([n, v]) => (
            <div key={n} className="kpi"><div className="kpi-nome">{n}</div><div className="kpi-valor">{v}</div></div>
          ))}
        </div>
      )}

      <section className="card">
        <h2>Respostas do robô</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
          {FILTROS.map(([k, rotulo]) => (
            <button key={k} type="button" className={filtro === k ? "btn-azul" : "btn-doc"} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{rotulo}</button>
          ))}
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período" style={{ marginLeft: "auto" }}>
            {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Últimos {d} dias</option>)}
          </select>
        </div>
        <p className="detalhe" style={{ marginTop: 0 }}>
          “Resposta guardada” é uma dúvida de uso repetida, respondida sem gastar a cota da IA (um 👎 a tira da memória;{" "}
          <button type="button" className="assistente-link" onClick={limparGuardadas}>apagar todas</button>).
          “Reserva” é quando a IA citou algo que não veio do banco e o sistema montou a resposta só com os dados encontrados.
        </p>
        {erro && <p className="msg erro">{erro}</p>}
        {carregando ? <p className="vazio">Carregando…</p> : !respostas.length ? <p className="vazio">Nada neste filtro.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {respostas.map((r) => (
              <article key={r.id} style={caixa}>
                <div className="detalhe" style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12.5 }}>
                  <span>{quando(r.criado_em)}</span>
                  <span>· {r.usuario?.nome_completo || "—"} ({r.usuario?.perfil || "—"})</span>
                  {r.avaliacao === 1 && <span>· 👍</span>}
                  {r.avaliacao === -1 && <span>· 👎</span>}
                  {r.fora_do_escopo && <span className="chip">fora do escopo</span>}
                  {r.reserva && <span className="chip">reserva</span>}
                  {r.provedor === "cache" && <span className="chip">resposta guardada</span>}
                  {r.consultas?.length > 0 && <span>· consultas: {r.consultas.join(", ")}</span>}
                  {r.pagina && <span>· na página {r.pagina}</span>}
                </div>
                <p style={{ margin: "6px 0", fontWeight: 600 }}>{r.pergunta}</p>
                <details>
                  <summary className="detalhe" style={{ cursor: "pointer" }}>Resposta</summary>
                  <p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, margin: "6px 0" }}>{r.resposta}</p>
                </details>
                {r.comentario && <p style={{ margin: "6px 0", fontSize: 13.5 }}><strong>Comentário:</strong> {r.comentario}</p>}
                {!r.fora_do_escopo && (
                  <button type="button" className="btn-doc" style={{ marginTop: 6 }}
                    onClick={() => setEditando({ pergunta: r.pergunta, resposta: r.resposta, origem_id: r.id })}>
                    {r.avaliacao === -1 ? "Escrever a resposta certa como exemplo" : "Virar exemplo"}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Exemplos aprovados</h2>
        <p className="detalhe" style={{ marginTop: 0 }}>
          Os exemplos ativos (até 8, os mais recentes) ensinam ao robô o tom e o formato das respostas, para <strong>todos os usuários</strong>.
          Revise o texto e tire dados que nem todos podem ver. O robô sempre consulta o banco de novo: os dados do exemplo não são repetidos como fato.
        </p>
        {editando
          ? <EditorExemplo inicial={editando} onSalvar={salvarExemplo} onCancelar={() => setEditando(null)} />
          : <button type="button" className="btn-azul" onClick={() => setEditando({ pergunta: "", resposta: "" })}>+ Novo exemplo</button>}
        {!exemplos.length ? <p className="vazio">Nenhum exemplo ainda.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {exemplos.map((ex) => (
              <article key={ex.id} style={{ ...caixa, opacity: ex.ativo ? 1 : 0.6 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{ex.pergunta}</p>
                <p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, margin: "6px 0" }}>{ex.resposta}</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className="btn-doc" onClick={() => setEditando(ex)}>Editar</button>
                  <button type="button" className="btn-doc" onClick={() => salvarExemplo({ ...ex, ativo: !ex.ativo })}>{ex.ativo ? "Desativar" : "Ativar"}</button>
                  <button type="button" className="btn-perigo" onClick={() => excluirExemplo(ex.id!)}>Excluir</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EditorExemplo({ inicial, onSalvar, onCancelar }: { inicial: Exemplo; onSalvar: (e: Exemplo) => void; onCancelar: () => void }) {
  const [pergunta, setPergunta] = useState(inicial.pergunta);
  const [resposta, setResposta] = useState(inicial.resposta);
  const campo = { display: "block", width: "100%", marginTop: 4, padding: "8px 10px", border: "1px solid var(--borda)", borderRadius: 8, fontSize: 14 } as const;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSalvar({ ...inicial, pergunta, resposta }); }}
      style={{ ...caixa, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      <label>Pergunta<textarea value={pergunta} onChange={(e) => setPergunta(e.target.value)} rows={2} maxLength={1000} style={campo} /></label>
      <label>Resposta ideal<textarea value={resposta} onChange={(e) => setResposta(e.target.value)} rows={6} maxLength={4000} style={campo} /></label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn-azul" disabled={!pergunta.trim() || !resposta.trim()}>Salvar exemplo</button>
        <button type="button" className="btn-doc" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
