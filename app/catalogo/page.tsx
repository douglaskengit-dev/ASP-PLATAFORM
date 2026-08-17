"use client";

/** ASP — Catálogo: procedimentos e equipamentos usados no Relatório Técnico.
 *
 * A aba mostra apenas as listas; criar e editar acontece em modal, para a
 * tela não virar um formulário gigante. O procedimento sugere equipamentos e
 * o texto de métodos; cada equipamento tem ficha de especificações (pares
 * rótulo/valor, como saem no relatório) e fotos. */
import { useCallback, useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import { TOPICOS_PADRAO, TOPICO_CAPA, lerTopicosDoModelo } from "@/lib/asp/relatorio";

/** Tópicos que o relatório pode ter — o procedimento escolhe quais entram. */
const TODOS_TOPICOS = [TOPICO_CAPA, ...TOPICOS_PADRAO];

interface Espec { rotulo: string; valor: string }
interface Foto { caminho: string; legenda?: string }
interface Equipamento {
  id: string; slug: string; nome: string;
  especificacoes: Espec[]; fotos: Foto[]; ordem: number;
}
interface Procedimento {
  id: string; codigo: string; nome: string; metodos: string | null;
  equipamentos: string[]; ordem: number;
  /** Tópicos do relatório para este procedimento. null = todos. */
  topicos: number[] | null;
  /** Modelo .docx próprio (storage). Vazio = modelo padrão da ASP. */
  template_path: string | null;
  /** Tópicos próprios deste procedimento: título + posição (`apos`). */
  topicos_extras: { titulo: string; apos?: number }[];
}

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rot: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 };
const grade: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
};
const linha: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
  padding: "10px 0", borderBottom: "1px solid var(--borda)", flexWrap: "wrap",
};

export default function CatalogoPage() {
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [procedimentos, setProcedimentos] = useState<Procedimento[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [enviandoModelo, setEnviandoModelo] = useState(false);
  /** Tópicos lidos do modelo do procedimento aberto. Vazio = usa os padrão. */
  const [topicosModelo, setTopicosModelo] = useState<{ numero: number; titulo: string }[]>([]);
  // Item aberto no modal (cópia local — só grava ao salvar).
  const [edEquip, setEdEquip] = useState<Equipamento | null>(null);
  const [edProc, setEdProc] = useState<Procedimento | null>(null);

  const carregar = useCallback(() => {
    fetch("/api/catalogo").then((r) => r.ok ? r.json() : {})
      .then((d: any) => {
        setEquipamentos((d.equipamentos || []).map((e: any) => ({ ...e, especificacoes: e.especificacoes || [], fotos: e.fotos || [] })));
        setProcedimentos((d.procedimentos || []).map((p: any) => ({
          ...p, equipamentos: p.equipamentos || [],
          topicos: Array.isArray(p.topicos) ? p.topicos : null,
          template_path: p.template_path || null,
          topicos_extras: Array.isArray(p.topicos_extras) ? p.topicos_extras : [],
        })));
        setPodeEditar(!!d.podeEditar);
      })
      .finally(() => setCarregando(false));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Ao abrir um procedimento, a lista de tópicos vem do MODELO dele — só assim
  // aparecem as seções que aquele relatório realmente tem (Anexos, Sanitização…).
  const modeloProc = edProc?.template_path || null;
  useEffect(() => {
    if (!edProc) { setTopicosModelo([]); return; }
    const url = modeloProc ? `/api/catalogo/template?caminho=${encodeURIComponent(modeloProc)}` : undefined;
    lerTopicosDoModelo(url).then(setTopicosModelo).catch(() => setTopicosModelo([]));
  }, [edProc?.id, modeloProc]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Capa + tópicos do modelo (ou os padrão, quando não há modelo próprio). */
  const topicosDisponiveis = topicosModelo.length > 0
    ? [TOPICO_CAPA, ...topicosModelo]
    : TODOS_TOPICOS;

  async function api(metodo: string, corpo?: any, query = "") {
    setErro(null);
    const res = await fetch(`/api/catalogo${query}`, {
      method: metodo,
      ...(corpo ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : {}),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErro(d?.erro || "Falha na operação."); return null; }
    return d;
  }

  async function salvar(tipo: "equipamento" | "procedimento", item: any) {
    // O código identifica o procedimento na inspeção e no relatório. Sem ele,
    // o item aparece nos seletores como se fosse "não definido".
    if (tipo === "procedimento" && !String(item.codigo || "").trim()) {
      setErro("Informe o código do procedimento (ex.: PO 011) — é por ele que a inspeção e o relatório o identificam.");
      return;
    }
    setSalvando(true);
    const dados = tipo === "equipamento"
      ? { slug: item.slug, nome: item.nome, especificacoes: item.especificacoes, fotos: item.fotos, ordem: item.ordem }
      : { codigo: item.codigo, nome: item.nome, metodos: item.metodos,
          equipamentos: item.equipamentos, ordem: item.ordem, topicos: item.topicos,
          template_path: item.template_path || null, topicos_extras: item.topicos_extras || [] };
    const r = item.id
      ? await api("PATCH", { tipo, id: item.id, dados })
      : await api("POST", { tipo, dados });
    setSalvando(false);
    if (r) { setEdEquip(null); setEdProc(null); carregar(); }
  }

  async function excluir(tipo: string, id: string, nome: string) {
    if (!confirm(`Excluir "${nome}" do catálogo?`)) return;
    await api("DELETE", undefined, `?tipo=${tipo}&id=${id}`);
    carregar();
  }

  async function enviarFoto(arquivo: File) {
    if (!edEquip) return;
    setEnviandoFoto(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      fd.append("slug", edEquip.slug || "equipamento");
      const res = await fetch("/api/catalogo/foto", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.erro || "Falha ao enviar a foto."); return; }
      setEdEquip({ ...edEquip, fotos: [...(edEquip.fotos || []), { caminho: d.caminho, legenda: "" }] });
    } finally {
      setEnviandoFoto(false);
    }
  }

  /** Envia o modelo .docx deste procedimento e guarda o caminho. */
  async function enviarModelo(arquivo: File) {
    if (!edProc) return;
    setEnviandoModelo(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      fd.append("codigo", edProc.codigo || "procedimento");
      const res = await fetch("/api/catalogo/template", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.erro || "Falha ao enviar o modelo."); return; }
      setEdProc({ ...edProc, template_path: d.caminho });
    } finally {
      setEnviandoModelo(false);
    }
  }

  const novoEquip = (): Equipamento => ({
    id: "", slug: `equip-${Date.now()}`, nome: "", especificacoes: [], fotos: [],
    ordem: equipamentos.length + 1,
  });
  const novoProc = (): Procedimento => ({
    id: "", codigo: "", nome: "", metodos: "", equipamentos: [], ordem: procedimentos.length + 1,
    topicos: null, template_path: null, topicos_extras: [],
  });

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;

  return (
    <div className="page-larga">
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Catálogo</h1>
        <p className="detalhe" style={{ margin: "4px 0 0" }}>
          Procedimentos e equipamentos usados no Relatório Técnico. O procedimento sugere os
          equipamentos e o texto de métodos; as especificações saem no relatório em duas colunas.
        </p>
      </header>
      {erro && <p className="erro-texto">{erro}</p>}
      {!podeEditar && <p className="detalhe">Somente consulta — edição restrita a Operações, Gerência e Admin.</p>}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Procedimentos ({procedimentos.length})</h3>
          {podeEditar && <button className="btn-azul" onClick={() => setEdProc(novoProc())}>+ Procedimento</button>}
        </div>
        {procedimentos.length === 0 ? (
          <p className="vazio" style={{ margin: "10px 0 0" }}>Nenhum procedimento cadastrado.</p>
        ) : procedimentos.map((p) => (
          <div key={p.id} style={linha}>
            <div>
              <strong style={{ color: "var(--texto)" }}>{p.codigo}</strong> — {p.nome}
              <span className="detalhe" style={{ display: "block" }}>
                {(p.equipamentos || []).length} equipamento(s) previsto(s)
                {p.metodos ? " · texto de métodos definido" : " · sem texto de métodos"}
              </span>
            </div>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn-dl btn-sec" onClick={() => setEdProc({ ...p })}>
                {podeEditar ? "Editar" : "Ver"}
              </button>
              {podeEditar && (
                <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                  onClick={() => excluir("procedimento", p.id, p.nome)}>Excluir</button>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Equipamentos ({equipamentos.length})</h3>
          {podeEditar && <button className="btn-azul" onClick={() => setEdEquip(novoEquip())}>+ Equipamento</button>}
        </div>
        {equipamentos.length === 0 ? (
          <p className="vazio" style={{ margin: "10px 0 0" }}>Nenhum equipamento cadastrado.</p>
        ) : equipamentos.map((e) => (
          <div key={e.id} style={linha}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {(e.fotos || [])[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/catalogo/foto?caminho=${encodeURIComponent(e.fotos[0].caminho)}`} alt=""
                  style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--borda)" }} />
              ) : (
                <span style={{ width: 44, height: 44, borderRadius: 6, border: "1px dashed var(--borda)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🛠</span>
              )}
              <div>
                <strong style={{ color: "var(--texto)" }}>{e.nome || "(sem nome)"}</strong>
                <span className="detalhe" style={{ display: "block" }}>
                  {(e.especificacoes || []).length} especificação(ões) · {(e.fotos || []).length} foto(s)
                </span>
              </div>
            </div>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn-dl btn-sec" onClick={() => setEdEquip({ ...e })}>
                {podeEditar ? "Editar" : "Ver"}
              </button>
              {podeEditar && (
                <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                  onClick={() => excluir("equipamento", e.id, e.nome)}>Excluir</button>
              )}
            </span>
          </div>
        ))}
      </div>

      {edProc && (
        <Modal titulo={edProc.id ? "Editar procedimento" : "Novo procedimento"} onFechar={() => setEdProc(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={grade}>
              <div><label style={rot}>Código *</label>
                <input style={campo} value={edProc.codigo} disabled={!podeEditar}
                  onChange={(ev) => setEdProc({ ...edProc, codigo: ev.target.value })} placeholder="ex.: PO 011" /></div>
              <div><label style={rot}>Nome</label>
                <input style={campo} value={edProc.nome} disabled={!podeEditar}
                  onChange={(ev) => setEdProc({ ...edProc, nome: ev.target.value })} /></div>
            </div>
            <div><label style={rot}>Texto sugerido para “Métodos”</label>
              <textarea style={{ ...campo, minHeight: 110 }} value={edProc.metodos || ""} disabled={!podeEditar}
                onChange={(ev) => setEdProc({ ...edProc, metodos: ev.target.value })} /></div>
            <div>
              <label style={rot}>Modelo do relatório (.docx)</label>
              <p className="detalhe" style={{ margin: "2px 0 6px" }}>
                Deixe em branco para usar o modelo padrão da ASP. Envie um arquivo próprio quando
                este procedimento gerar um tipo de relatório diferente.
              </p>
              {edProc.template_path ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="detalhe" style={{ margin: 0 }}>
                    Modelo próprio: {edProc.template_path.split("/").pop()}
                  </span>
                  {podeEditar && (
                    <button type="button" className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                      onClick={() => setEdProc({ ...edProc, template_path: null })}>Voltar ao padrão</button>
                  )}
                </div>
              ) : podeEditar && (
                <input type="file" accept=".docx" disabled={enviandoModelo}
                  onChange={(ev) => { const f = ev.target.files?.[0]; if (f) enviarModelo(f); ev.target.value = ""; }} />
              )}
              {enviandoModelo && <span className="detalhe">Enviando modelo…</span>}
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={{ ...rot, marginBottom: 0 }}>Tópicos do relatório</label>
                {podeEditar && (
                  <button type="button" className="btn-dl btn-sec"
                    onClick={() => setEdProc({ ...edProc, topicos: null })}>Usar todos</button>
                )}
              </div>
              <p className="detalhe" style={{ margin: "2px 0 6px" }}>
                {/* A condição é o MODELO PRÓPRIO, não a quantidade lida: sem
                    modelo a leitura cai no padrão e também devolve seções —
                    dizer "deste procedimento" ali seria falso. */}
                {edProc.template_path
                  ? `Seções lidas do modelo deste procedimento (${topicosModelo.length}). Sem marcação, entram todas.`
                  : `Modelo padrão da ASP (${topicosModelo.length} seções). Envie um modelo próprio acima para este procedimento ter as seções dele.`}
              </p>
              <div style={{ border: "1px solid var(--borda)", borderRadius: 8, overflow: "hidden" }}>
                {topicosDisponiveis.map((t, k) => {
                  const marcados = edProc.topicos;
                  const ativo = marcados === null || marcados.includes(t.numero);
                  return (
                    <label key={t.numero} style={{
                      display: "flex", gap: 10, alignItems: "center", fontSize: 13,
                      padding: "7px 10px", cursor: podeEditar ? "pointer" : "default",
                      borderTop: k === 0 ? "none" : "1px solid var(--borda)",
                      background: ativo ? "transparent" : "var(--bg-suave)",
                      opacity: ativo ? 1 : 0.6,
                    }}>
                      <input type="checkbox" disabled={!podeEditar} checked={ativo}
                        style={{ width: 16, height: 16, flexShrink: 0 }}
                        onChange={(ev) => {
                          // null (= todos) vira lista explícita ao primeiro clique
                          const base = marcados === null ? topicosDisponiveis.map((x) => x.numero) : marcados;
                          const novos = ev.target.checked
                            ? [...base, t.numero].sort((a, b) => a - b)
                            : base.filter((n) => n !== t.numero);
                          setEdProc({ ...edProc, topicos: novos });
                        }} />
                      <span style={{ width: 26, flexShrink: 0, fontWeight: 600, color: "var(--texto-suave)" }}>
                        {t.numero === 0 ? "—" : `${t.numero}.`}
                      </span>
                      <span>{t.numero === 0 ? "Capa" : t.titulo}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={{ ...rot, marginBottom: 0 }}>Tópicos próprios deste procedimento</label>
                {podeEditar && (
                  <button type="button" className="btn-dl btn-sec"
                    onClick={() => setEdProc({ ...edProc, topicos_extras: [...edProc.topicos_extras, { titulo: "", apos: 10 }] })}>
                    + Tópico
                  </button>
                )}
              </div>
              <p className="detalhe" style={{ margin: "2px 0 6px" }}>
                Tópicos que só este procedimento tem. Escolha em que posição entram — a numeração
                de todos se ajusta sozinha.
              </p>
              {edProc.topicos_extras.length === 0 && (
                <p className="detalhe" style={{ margin: 0 }}>Nenhum tópico próprio.</p>
              )}
              {edProc.topicos_extras.map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input style={campo} value={t.titulo} disabled={!podeEditar}
                    placeholder="Título do tópico (ex.: Ensaio de estanqueidade)"
                    onChange={(ev) => setEdProc({
                      ...edProc,
                      topicos_extras: edProc.topicos_extras.map((x, k) => k === i ? { ...x, titulo: ev.target.value } : x),
                    })} />
                  <select style={{ ...campo, width: "auto", minWidth: 190 }} disabled={!podeEditar}
                    value={String(t.apos ?? 10)}
                    onChange={(ev) => setEdProc({
                      ...edProc,
                      topicos_extras: edProc.topicos_extras.map((x, k) => k === i ? { ...x, apos: Number(ev.target.value) } : x),
                    })}>
                    <option value="0">Logo após a capa</option>
                    {topicosDisponiveis.filter((x) => x.numero > 0).map((tp) => (
                      <option key={tp.numero} value={String(tp.numero)}>Depois de “{tp.titulo}”</option>
                    ))}
                  </select>
                  {podeEditar && (
                    <button type="button" className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                      onClick={() => setEdProc({
                        ...edProc,
                        topicos_extras: edProc.topicos_extras.filter((_, k) => k !== i),
                      })}>Remover</button>
                  )}
                </div>
              ))}
            </div>

            <div>
              <label style={rot}>Equipamentos previstos</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
                {equipamentos.map((e) => (
                  <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" disabled={!podeEditar} checked={edProc.equipamentos.includes(e.slug)}
                      onChange={(ev) => setEdProc({
                        ...edProc,
                        equipamentos: ev.target.checked
                          ? [...edProc.equipamentos, e.slug]
                          : edProc.equipamentos.filter((s) => s !== e.slug),
                      })} />
                    <span>{e.nome}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={() => setEdProc(null)}>Fechar</button>
              {podeEditar && (
                <button className="btn-azul" disabled={salvando || !edProc.codigo.trim()}
                  onClick={() => salvar("procedimento", edProc)}>{salvando ? "Salvando…" : "Salvar"}</button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {edEquip && (
        <Modal titulo={edEquip.id ? "Editar equipamento" : "Novo equipamento"} largo onFechar={() => setEdEquip(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={grade}>
              <div><label style={rot}>Nome *</label>
                <input style={campo} value={edEquip.nome} disabled={!podeEditar}
                  onChange={(ev) => setEdEquip({ ...edEquip, nome: ev.target.value })}
                  placeholder="ex.: Submarino para a Batimetria" /></div>
              <div><label style={rot}>Identificador</label>
                <input style={campo} value={edEquip.slug} disabled={!podeEditar}
                  onChange={(ev) => setEdEquip({ ...edEquip, slug: ev.target.value })} /></div>
            </div>

            <div>
              <label style={rot}>Especificações (rótulo e valor)</label>
              {(edEquip.especificacoes || []).map((sp, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 6 }}>
                  <input style={campo} placeholder="Rótulo (ex.: Profundidade máxima)" value={sp.rotulo} disabled={!podeEditar}
                    onChange={(ev) => setEdEquip({ ...edEquip, especificacoes: edEquip.especificacoes.map((x, k) => k === i ? { ...x, rotulo: ev.target.value } : x) })} />
                  <input style={campo} placeholder="Valor (ex.: 152 m)" value={sp.valor} disabled={!podeEditar}
                    onChange={(ev) => setEdEquip({ ...edEquip, especificacoes: edEquip.especificacoes.map((x, k) => k === i ? { ...x, valor: ev.target.value } : x) })} />
                  {podeEditar && (
                    <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626", maxWidth: 110 }}
                      onClick={() => setEdEquip({ ...edEquip, especificacoes: edEquip.especificacoes.filter((_, k) => k !== i) })}>Remover</button>
                  )}
                </div>
              ))}
              {podeEditar && (
                <button className="btn-dl btn-sec"
                  onClick={() => setEdEquip({ ...edEquip, especificacoes: [...(edEquip.especificacoes || []), { rotulo: "", valor: "" }] })}>
                  + Linha de especificação
                </button>
              )}
            </div>

            <div>
              <label style={rot}>Fotos do equipamento</label>
              {podeEditar && (
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={enviandoFoto}
                  onChange={(ev) => { const f = ev.target.files?.[0]; if (f) enviarFoto(f); ev.target.value = ""; }} />
              )}
              {enviandoFoto && <span className="detalhe"> enviando…</span>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 8 }}>
                {(edEquip.fotos || []).map((f, i) => (
                  <div key={i} style={{ border: "1px solid var(--borda)", borderRadius: 8, padding: 6 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/catalogo/foto?caminho=${encodeURIComponent(f.caminho)}`} alt={f.legenda || ""}
                      style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 6 }} />
                    <input style={{ ...campo, marginTop: 6, fontSize: 12, padding: "6px 8px" }} placeholder="Legenda"
                      value={f.legenda || ""} disabled={!podeEditar}
                      onChange={(ev) => setEdEquip({ ...edEquip, fotos: edEquip.fotos.map((x, k) => k === i ? { ...x, legenda: ev.target.value } : x) })} />
                    {podeEditar && (
                      <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626", width: "100%", marginTop: 6 }}
                        onClick={() => {
                          fetch(`/api/catalogo/foto?caminho=${encodeURIComponent(f.caminho)}`, { method: "DELETE" }).catch(() => {});
                          setEdEquip({ ...edEquip, fotos: edEquip.fotos.filter((_, k) => k !== i) });
                        }}>Remover</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={() => setEdEquip(null)}>Fechar</button>
              {podeEditar && (
                <button className="btn-azul" disabled={salvando || !edEquip.nome.trim()}
                  onClick={() => salvar("equipamento", edEquip)}>{salvando ? "Salvando…" : "Salvar"}</button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
