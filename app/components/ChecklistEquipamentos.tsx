"use client";

/** Checklist dos equipamentos levados a campo, por etapa (inspeção/execução).
 *
 * É um CARD e não um modal de propósito: checklist é progresso, e progresso
 * precisa ficar visível sem clique — em campo a pessoa confere item a item
 * enquanto carrega a van, e um modal fecharia a cada toque fora. O modal
 * aparece só para COMPOR a lista (escolher do Catálogo), que aí sim é edição.
 *
 * A lista nasce do procedimento DA OS (o mesmo do topo da página — não há
 * um procedimento próprio do checklist) e aceita itens extras. Cada item
 * guarda quem conferiu (usuário da sessão), quando (relógio do servidor) e
 * uma observação (avaria, nº de série). Regras em lib/validacao/checklist.ts:
 * item repetido bloqueia; refazer a lista mantém a conferência dos itens que
 * ficam.
 *
 * `embutido`: dentro de uma SecaoRecolhivel (página da inspeção) — a seção
 * já dá o card e o título; aqui fica só o conteúdo. */
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import AvisoCliente from "./AvisoCliente";
import { MensagensCampo, ResumoValidacao } from "./MensagensCampo";
import {
  chaveItemChecklist, EquipamentoCatalogo, ItemChecklist, ROTULOS_CHECKLIST, temErros, validarItensChecklist,
} from "@/lib/validacao";

type Item = ItemChecklist & { conferido: boolean };
interface Checklist { id: string; tipo: "inspecao" | "execucao"; procedimento: string | null; itens: Item[] }

const campo: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 13,
};

export default function ChecklistEquipamentos({ inspecaoId, etapa, procedimento, clienteId, embutido, onResumo, onErro }: {
  inspecaoId: string;
  /** Etapa corrente da inspeção — define qual checklist é o principal. */
  etapa: "inspecao" | "execucao";
  /** Procedimento da OS (código do Catálogo) — o checklist segue ele. */
  procedimento?: string | null;
  /** Cliente da inspeção — o aviso dele é repetido aqui, pois é na hora de
   *  conferir os equipamentos que a exigência precisa ser lembrada. */
  clienteId?: string | null;
  /** Sem card nem título próprios (a SecaoRecolhivel já os dá). */
  embutido?: boolean;
  /** Resumo para a seção recolhida: "Inspeção 5/7 · Execução 0/6". */
  onResumo?: (texto: string) => void;
  /** Avisa a página do erro, para ela abrir a seção recolhida. */
  onErro?: (erro: string | null) => void;
}) {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [procedimentos, setProcedimentos] = useState<any[]>([]);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [compondo, setCompondo] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [erroLista, setErroLista] = useState<string | null>(null);

  const carregar = useCallback(() => {
    fetch(`/api/checklist?inspecaoId=${inspecaoId}`).then((r) => r.ok ? r.json() : {})
      .then((d: any) => {
        setChecklists((d.checklists || []).map((c: any) => ({ ...c, itens: c.itens || [] })));
        setPodeEditar(!!d.podeEditar);
      }).catch(() => {});
  }, [inspecaoId]);

  useEffect(() => {
    carregar();
    fetch("/api/catalogo").then((r) => r.ok ? r.json() : {}).then((d: any) => {
      setProcedimentos(d.procedimentos || []);
      setEquipamentos(d.equipamentos || []);
    }).catch(() => {});
  }, [carregar]);

  const atual = useMemo(() => checklists.find((c) => c.tipo === etapa) || null, [checklists, etapa]);
  const outro = useMemo(() => checklists.find((c) => c.tipo !== etapa) || null, [checklists, etapa]);

  useEffect(() => {
    if (!onResumo) return;
    const parte = (tipo: "inspecao" | "execucao", rotulo: string) => {
      const c = checklists.find((x) => x.tipo === tipo);
      return c ? `${rotulo} ${c.itens.filter((i) => i.conferido).length}/${c.itens.length}` : null;
    };
    const partes = [parte("inspecao", "Inspeção"), parte("execucao", "Execução")].filter(Boolean);
    onResumo(partes.length ? partes.join(" · ") : "Nenhum checklist montado");
  }, [checklists]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onErro?.(erro); }, [erro]);   // eslint-disable-line react-hooks/exhaustive-deps

  const catalogo: EquipamentoCatalogo[] = useMemo(
    () => equipamentos.filter((e) => e.slug && e.nome).map((e) => ({ slug: e.slug, nome: e.nome })),
    [equipamentos]
  );
  const procOS = procedimentos.find((p) => p.codigo === procedimento) || null;

  /** Abre a montagem: refazer parte da lista atual (Catálogo marcado + avulsos
   *  no texto); lista nova parte dos equipamentos previstos no procedimento. */
  function abrirMontagem() {
    setErroLista(null);
    if (atual) {
      setSelecionados(atual.itens.map((i) => i.slug || "").filter(Boolean));
      setExtra(atual.itens.filter((i) => !i.slug).map((i) => i.nome).join("\n"));
    } else {
      setSelecionados(procOS?.equipamentos || []);
      setExtra("");
    }
    setCompondo(true);
  }

  /** A lista como ficará: itens do Catálogo marcados + avulsos (um por linha). */
  const itensMontados = useMemo(() => [
    ...catalogo.filter((e) => selecionados.includes(e.slug)).map((e) => ({ slug: e.slug as string | null, nome: e.nome })),
    ...extra.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).map((nome) => ({ slug: null as string | null, nome })),
  ], [catalogo, selecionados, extra]);
  const resultadoLista = useMemo(() => validarItensChecklist(itensMontados, catalogo), [itensMontados, catalogo]);
  /** Itens já conferidos da lista atual que vão sair (perdem a conferência). */
  const saemConferidos = useMemo(() => {
    if (!atual) return [];
    const novas = new Set(itensMontados.map((i) => chaveItemChecklist(i, catalogo)));
    return atual.itens.filter((i) => i.conferido && !novas.has(chaveItemChecklist(i, catalogo)));
  }, [atual, itensMontados, catalogo]);

  async function criarChecklist() {
    if (temErros(resultadoLista)) return;
    setSalvando(true); setErro(null); setErroLista(null);
    try {
      const res = await fetch("/api/checklist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspecaoId, tipo: etapa, itens: itensMontados }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErroLista(d?.erro || "Falha ao montar o checklist."); return; }
      setCompondo(false); setExtra(""); carregar();
    } catch {
      setErroLista("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setSalvando(false);
    }
  }

  /** Grava UM item: o servidor junta a mudança no que está gravado e carimba
   *  quem conferiu e quando (sessão + relógio do servidor). */
  async function gravarItem(c: Checklist, i: number, mudanca: { conferido?: boolean; obs?: string }) {
    const chave = chaveItemChecklist(c.itens[i], catalogo);
    // Otimista: marca na hora; o carimbo definitivo vem da resposta.
    setChecklists((p) => p.map((x) => x.id !== c.id ? x : {
      ...x,
      itens: x.itens.map((y, k) => k !== i ? y : { ...y, ...mudanca, ...(mudanca.conferido === false ? { por: null, em: null } : {}) }),
    }));
    try {
      const res = await fetch("/api/checklist", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, chave, ...mudanca }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.erro || "Falha ao salvar o checklist."); carregar(); return; }
      setErro(null);
      if (d.checklist) setChecklists((p) => p.map((x) => x.id === c.id ? { ...d.checklist, itens: d.checklist.itens || [] } : x));
    } catch {
      setErro("Sem conexão — a conferência não foi salva."); carregar();
    }
  }

  function alternar(c: Checklist, i: number) {
    gravarItem(c, i, { conferido: !c.itens[i].conferido });
  }

  function anotar(c: Checklist, i: number, obs: string) {
    gravarItem(c, i, { obs });
  }

  function render(c: Checklist, principal: boolean) {
    const feitos = c.itens.filter((i) => i.conferido).length;
    const total = c.itens.length;
    const completo = total > 0 && feitos === total;
    return (
      <div key={c.id} style={{ marginTop: principal ? 8 : 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13.5, textTransform: "capitalize" }}>{c.tipo}</strong>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            background: completo ? "#dcfce7" : "#fef3c7", color: completo ? "#166534" : "#92400e",
          }}>
            {feitos} de {total} conferido(s)
          </span>
          {procedimento && <span className="detalhe" style={{ margin: 0 }}>· {procedimento}</span>}
        </div>

        {c.itens.map((it, i) => (
          <div key={chaveItemChecklist(it, catalogo) || i} style={{ borderBottom: "1px solid var(--borda)", padding: "8px 0" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: podeEditar ? "pointer" : "default" }}>
              <input type="checkbox" checked={it.conferido} disabled={!podeEditar} style={{ marginTop: 3, width: 18, height: 18 }}
                onChange={() => alternar(c, i)} />
              <span style={{ flex: 1 }}>
                <span style={{
                  color: "var(--texto)", fontWeight: 600,
                  textDecoration: it.conferido ? "line-through" : "none",
                  opacity: it.conferido ? 0.65 : 1,
                }}>{it.nome}</span>
                {it.conferido && it.por && (
                  <span className="detalhe" style={{ display: "block" }}>
                    Conferido por {it.por} em {it.em ? new Date(it.em).toLocaleString("pt-BR") : "—"}
                  </span>
                )}
              </span>
            </label>
            {podeEditar && (
              <input style={{ ...campo, marginTop: 6 }} placeholder="Observação (avaria, substituição, nº de série)"
                defaultValue={it.obs || ""} onBlur={(e) => { if (e.target.value !== (it.obs || "")) anotar(c, i, e.target.value); }} />
            )}
            {!podeEditar && it.obs && <span className="detalhe" style={{ display: "block" }}>{it.obs}</span>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={embutido ? undefined : "card"} style={embutido ? undefined : { marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: embutido ? "flex-end" : "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {!embutido && <h3 style={{ margin: 0 }}>Checklist de equipamentos</h3>}
        {podeEditar && (
          <button className="btn-azul" onClick={abrirMontagem}>
            {atual ? "Refazer lista" : "Montar lista"}
          </button>
        )}
      </div>
      <p className="detalhe" style={{ marginTop: 6 }}>
        Conferência dos equipamentos levados a campo, uma para cada etapa. A lista nasce do
        procedimento e aceita itens avulsos.
      </p>
      {erro && <p className="erro-texto" style={{ margin: "6px 0 0" }}>{erro}</p>}

      <AvisoCliente clienteId={clienteId} compacto />

      {!atual && !outro && <p className="vazio" style={{ margin: "8px 0 0" }}>Nenhum checklist montado.</p>}
      {atual && render(atual, true)}
      {outro && render(outro, false)}

      {compondo && (
        <Modal titulo={`Montar checklist — ${etapa}`} onFechar={() => setCompondo(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 }}>Procedimento da OS</span>
              <span className="detalhe" style={{ margin: 0 }}>
                {procedimento ? `${procedimento}${procOS ? ` — ${procOS.nome}` : ""}` : "não definido — escolha no topo da página"}
                {" "}(muda no topo da página; o checklist acompanha)
              </span>
              {procOS && (procOS.equipamentos || []).length > 0 && (
                <button type="button" className="secao-link" style={{ display: "block", marginTop: 4 }}
                  onClick={() => setSelecionados((p) => Array.from(new Set([...p, ...(procOS.equipamentos || [])])))}>
                  Marcar os equipamentos previstos no procedimento
                </button>
              )}
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 }}>Equipamentos do catálogo</label>
              {equipamentos.length === 0 ? (
                <p className="vazio" style={{ margin: 0 }}>Nenhum equipamento no catálogo.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
                  {equipamentos.map((e) => (
                    <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                      <input type="checkbox" checked={selecionados.includes(e.slug)}
                        onChange={(ev) => setSelecionados((p) => ev.target.checked ? [...p, e.slug] : p.filter((s) => s !== e.slug))} />
                      <span>{e.nome}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 }}>Itens avulsos (um por linha)</label>
              <textarea style={{ ...campo, minHeight: 70 }} value={extra} onChange={(e) => setExtra(e.target.value)}
                placeholder={"Ex.: Cabo reserva 50 m\nGerador portátil"} />
            </div>
            <MensagensCampo r={resultadoLista} campo="itens" />
            {atual && (
              <p className="detalhe" style={{ margin: 0 }}>
                Os itens que continuam na lista mantêm a conferência e a observação.
                {saemConferidos.length > 0 && (
                  <span className="val-aviso"> ⚠️ Saem da lista já conferidos: {saemConferidos.map((i) => i.nome).join(", ")}.</span>
                )}
              </p>
            )}
            <ResumoValidacao r={resultadoLista} rotulos={ROTULOS_CHECKLIST} />
            {erroLista && <p className="val-msg val-erro">⛔ {erroLista}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={() => setCompondo(false)}>Cancelar</button>
              <button className="btn-azul" disabled={salvando || temErros(resultadoLista) || itensMontados.length === 0} onClick={criarChecklist}>
                {salvando ? "Salvando…" : "Salvar lista"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
