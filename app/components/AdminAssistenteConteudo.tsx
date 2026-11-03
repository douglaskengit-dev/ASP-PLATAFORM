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
interface Uso {
  por_dia: { dia: string; perguntas: number; chamadas: number }[];
  hoje: { perguntas: number; chamadas: number };
  tem_chamadas: boolean;
  tempo_medio_s: number | null;
  top_perguntas: { pergunta: string; vezes: number }[];
  top_pessoas: { nome: string; perguntas: number }[];
  provedores: Record<string, number>;
}

const ROTULO_PROVEDOR: Record<string, string> = {
  cloudflare: "IA gratuita (Cloudflare)", anthropic: "Anthropic", "anthropic-reserva": "Anthropic (reserva)",
  cache: "Resposta guardada", filtro: "Recusa automática",
};
const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Perguntas por dia (uma série: barras finas na cor primária, número ao
 *  passar o mouse ou focar) + tabela, e os números de hoje. */
function UsoRobo({ uso }: { uso: Uso }) {
  const [foco, setFoco] = useState<number | null>(null);
  const max = Math.max(1, ...uso.por_dia.map((d) => d.perguntas));
  const atual = foco == null ? null : uso.por_dia[foco];
  const tiles: [string, string][] = [
    ["Perguntas hoje", String(uso.hoje.perguntas)],
    ...(uso.tem_chamadas ? [["Chamadas à IA hoje", String(uso.hoje.chamadas)] as [string, string]] : []),
    ["Tempo médio de resposta", uso.tempo_medio_s == null ? "—" : `${uso.tempo_medio_s.toLocaleString("pt-BR")} s`],
  ];
  return (
    <section className="card">
      <h2>Uso do robô</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
        {tiles.map(([n, v]) => <div key={n} className="kpi"><div className="kpi-nome">{n}</div><div className="kpi-valor">{v}</div></div>)}
      </div>
      <p className="detalhe" style={{ marginTop: 0 }}>
        A cota gratuita da IA renova às 21h (Brasília). Cada pergunta usa de 1 a 6 chamadas à IA, conforme as consultas ao banco.
      </p>
      <h3 style={{ fontSize: 14, margin: "8px 0 4px" }}>Perguntas por dia</h3>
      <p className="detalhe" style={{ margin: "0 0 6px", minHeight: 18 }} aria-live="polite">
        {atual ? `${diaCurto(atual.dia)}: ${atual.perguntas} ${atual.perguntas === 1 ? "pergunta" : "perguntas"}${uso.tem_chamadas ? ` · ${atual.chamadas} chamadas à IA` : ""}` : `Máximo no período: ${max}`}
      </p>
      <div role="img" aria-label="Gráfico de perguntas por dia; os valores estão na tabela abaixo" onMouseLeave={() => setFoco(null)}
        style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120, borderBottom: "1px solid var(--borda)" }}>
        {uso.por_dia.map((d, i) => (
          <div key={d.dia} tabIndex={0} onMouseEnter={() => setFoco(i)} onFocus={() => setFoco(i)} onBlur={() => setFoco(null)}
            aria-label={`${diaCurto(d.dia)}: ${d.perguntas} perguntas`}
            style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default", outline: "none" }}>
            <div style={{
              width: "100%", height: `${(d.perguntas / max) * 100}%`, minHeight: d.perguntas ? 2 : 0,
              background: "var(--primaria)", borderRadius: "4px 4px 0 0", opacity: foco == null || foco === i ? 1 : 0.45,
            }} />
          </div>
        ))}
      </div>
      <div className="detalhe" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
        <span>{uso.por_dia[0] && diaCurto(uso.por_dia[0].dia)}</span>
        <span>{uso.por_dia.length > 0 && diaCurto(uso.por_dia[uso.por_dia.length - 1].dia)}</span>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary className="detalhe" style={{ cursor: "pointer" }}>Ver tabela</summary>
        <table className="tabela" style={{ marginTop: 6 }}>
          <thead><tr><th>Dia</th><th>Perguntas</th>{uso.tem_chamadas && <th>Chamadas à IA</th>}</tr></thead>
          <tbody>
            {uso.por_dia.filter((d) => d.perguntas).map((d) => (
              <tr key={d.dia}><td>{diaCurto(d.dia)}</td><td>{d.perguntas}</td>{uso.tem_chamadas && <td>{d.chamadas}</td>}</tr>
            ))}
          </tbody>
        </table>
      </details>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 14 }}>
        <div>
          <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Perguntas mais repetidas</h3>
          {!uso.top_perguntas.length ? <p className="vazio">Nenhuma pergunta repetida.</p> : (
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5 }}>
              {uso.top_perguntas.map((p) => <li key={p.pergunta}>{p.pergunta} <span className="detalhe">({p.vezes}×)</span></li>)}
            </ol>
          )}
        </div>
        <div>
          <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Quem mais usa</h3>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5 }}>
            {uso.top_pessoas.map((p) => <li key={p.nome}>{p.nome} <span className="detalhe">({p.perguntas})</span></li>)}
          </ol>
        </div>
        <div>
          <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Quem respondeu</h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5 }}>
            {Object.entries(uso.provedores).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k}>{ROTULO_PROVEDOR[k] || k} <span className="detalhe">({v})</span></li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

const FILTROS: [string, string][] = [
  ["negativas", "👎 Negativas"], ["todas", "Todas"], ["positivas", "👍 Positivas"],
  ["recusas", "Fora do escopo"], ["reservas", "Respostas de reserva"],
];
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const caixa = { border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 12px" } as const;

interface CasoBateria { pergunta: string; descricao: string }
interface ResultadoBateria { passou: boolean; motivos: string[]; resposta: string; consultas: string[]; ms: number }

/** Roda as perguntas de teste uma a uma (cada uma é uma chamada ao servidor,
 *  para não estourar o tempo) e mostra o que passou. Gasta cota da IA. */
function BateriaTestes() {
  const [casos, setCasos] = useState<CasoBateria[]>([]);
  const [resultados, setResultados] = useState<(ResultadoBateria | null)[]>([]);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar() {
    if (!confirm("Rodar as perguntas de teste? Elas usam a IA de verdade e gastam parte da cota do dia (cerca de 30 chamadas).")) return;
    setErro(null);
    setRodando(true);
    try {
      const l = await fetch("/api/assistente/testes").then((x) => x.json());
      if (!l.ok) throw new Error(l.erro || "Falha ao carregar os testes.");
      setCasos(l.casos);
      const res: (ResultadoBateria | null)[] = l.casos.map(() => null);
      setResultados([...res]);
      for (let i = 0; i < l.casos.length; i++) {
        const r = await fetch("/api/assistente/testes", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indice: i }),
        }).then((x) => x.json()).catch(() => ({ ok: false, erro: "Falha de conexão." }));
        res[i] = r.ok ? r : { passou: false, motivos: [r.erro || "Falha"], resposta: "", consultas: [], ms: 0 };
        setResultados([...res]);
      }
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setRodando(false);
    }
  }

  const feitos = resultados.filter(Boolean) as ResultadoBateria[];
  const passaram = feitos.filter((r) => r.passou).length;
  return (
    <section className="card">
      <h2>Teste do robô</h2>
      <p className="detalhe" style={{ marginTop: 0 }}>
        Faz {casos.length || 14} perguntas ao robô com a IA e o banco reais (com o seu acesso) e confere o comportamento: recusa fora do escopo,
        consulta certa para cada pergunta, dúvida de uso pelo manual e nenhum texto técnico na resposta. Rode depois de mudanças no robô ou no manual.
      </p>
      <button type="button" className="btn-azul" disabled={rodando} onClick={rodar}>{rodando ? `Rodando… ${feitos.length}/${casos.length}` : "Rodar teste"}</button>
      {erro && <p className="msg erro">{erro}</p>}
      {casos.length > 0 && (
        <>
          <p style={{ margin: "10px 0 6px", fontWeight: 600 }}>
            {feitos.length < casos.length ? `${feitos.length} de ${casos.length} feitos` : `${passaram} de ${casos.length} passaram`}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {casos.map((c, i) => {
              const r = resultados[i];
              return (
                <details key={c.pergunta} style={{ ...caixa, padding: "6px 10px" }}>
                  <summary style={{ cursor: "pointer", fontSize: 13.5 }}>
                    <span aria-hidden="true">{!r ? "…" : r.passou ? "✅" : "❌"}</span>{" "}
                    <strong>{c.pergunta}</strong> <span className="detalhe">— {c.descricao}{r && !r.passou ? ` · ${r.motivos.join("; ")}` : ""}</span>
                    <span className="sr-only">{!r ? "aguardando" : r.passou ? "passou" : "falhou"}</span>
                  </summary>
                  {r && (
                    <div style={{ fontSize: 13, marginTop: 6 }}>
                      <p className="detalhe" style={{ margin: "0 0 4px" }}>
                        Consultas: {r.consultas.length ? r.consultas.join(", ") : "nenhuma"} · {(r.ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s
                      </p>
                      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.resposta || "(sem resposta)"}</p>
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export default function AdminAssistenteConteudo() {
  const [filtro, setFiltro] = useState("negativas");
  const [dias, setDias] = useState(30);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
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
      setUso(r.uso || null);
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

      {uso && <UsoRobo uso={uso} />}

      <BateriaTestes />

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
