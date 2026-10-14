"use client";

/** Coleta de fotos da execução (fase 7): checklist fotográfico de campo.
 *
 * Card, não modal, pelo mesmo motivo do checklist de equipamentos: é
 * progresso, e em campo a pessoa vai tirando as fotos item a item. Cada vaga
 * mostra ✓/pendente, miniatura e os botões de câmera e galeria — no celular
 * "📷 Foto" abre direto a câmera traseira.
 *
 * As fotos são comprimidas no aparelho antes de subir (lado maior ~1600 px)
 * e vão pela camada offline (enviarArquivo/enviarJson): sem rede, entram na
 * fila e sobem ao reconectar. As vagas e a conta de pendências vêm de
 * lib/asp/fotos-execucao.ts — a mesma fonte do aviso de fase e do relatório.
 *
 * Coleta incompleta não trava nada: o aviso aparece ao avançar a fase e no
 * formulário do Relatório de Execução.
 *
 * `embutido`: dentro de uma SecaoRecolhivel (página da inspeção) — sem card
 * nem título próprios. Mesmo recolhido o componente segue montado, e a fila
 * e os envios em andamento são avisados à página (onLocais) para ela abrir
 * a seção e mostrar a contagem no resumo. */
import { useCallback, useEffect, useRef, useState } from "react";
import { enviarArquivo, enviarJson } from "@/lib/pwa/sync";
import { comprimirImagem } from "@/lib/pwa/imagem";
import {
  SECOES_FOTOS, fotosDoSlot, valorDoSlot, numeroBr, lerNumero, secaoExigida,
  situacaoDosItens, progressoColeta,
  type RegistroFotosExecucao, type SlotFoto, type SecaoFotos, type ItemColetado,
} from "@/lib/asp/fotos-execucao";

/** Foto que ficou na fila offline — só existe neste aparelho até sincronizar. */
interface FotoLocal { chave: string; slot: string; url: string }

const btn: React.CSSProperties = { padding: "6px 10px", fontSize: 12.5, lineHeight: 1.2, cursor: "pointer", border: "none" };
const campo: React.CSSProperties = {
  width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 13,
};

function Selo({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <span style={{
      fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
      background: ok ? "#dcfce7" : "#fef3c7", color: ok ? "#166534" : "#92400e",
    }}>{texto}</span>
  );
}

/** Miniatura clicável (abre a foto inteira); ✕ remove. Fora do componente
 *  para não ser recriada a cada render (a imagem piscaria). */
function Miniatura({ src, tamanho, onRemover, naFila }: {
  src: string; tamanho: number | string; onRemover?: () => void; naFila?: boolean;
}) {
  return (
    <div style={{ position: "relative", width: tamanho, aspectRatio: "4 / 3", borderRadius: 8, overflow: "hidden",
      background: "var(--bg-suave)", border: "1px solid var(--borda)", flexShrink: 0 }}>
      <a href={src} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </a>
      {naFila && (
        <span style={{ position: "absolute", left: 4, bottom: 4, fontSize: 10.5, fontWeight: 700, padding: "1px 6px",
          borderRadius: 999, background: "#fef3c7", color: "#92400e" }}>na fila</span>
      )}
      {onRemover && (
        <button type="button" title="Remover foto" onClick={onRemover}
          style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: "50%", border: "none",
            background: "rgba(0,0,0,.6)", color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: "26px", padding: 0 }}>✕</button>
      )}
    </div>
  );
}

export default function ColetaFotosExecucao({ inspecaoId, onMudar, embutido, onLocais, onErro }: {
  inspecaoId: string;
  /** Avisa a página a cada mudança — o aviso de fase e o relatório usam. */
  onMudar?: (r: RegistroFotosExecucao) => void;
  /** Sem card nem título próprios (a SecaoRecolhivel já os dá). */
  embutido?: boolean;
  /** Fotos na fila offline deste aparelho e envios em andamento. */
  onLocais?: (n: { fila: number; enviando: number }) => void;
  /** Avisa a página do erro, para ela abrir a seção recolhida. */
  onErro?: (erro: string | null) => void;
}) {
  const [registro, setRegistro] = useState<RegistroFotosExecucao | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<Record<string, number>>({});
  const [locais, setLocais] = useState<FotoLocal[]>([]);
  const locaisRef = useRef<FotoLocal[]>([]);
  locaisRef.current = locais;

  const url = `/api/inspecoes/${inspecaoId}/fotos`;
  const urlFoto = (caminho: string) => `${url}?caminho=${encodeURIComponent(caminho)}`;

  const carregar = useCallback(() => {
    fetch(`/api/inspecoes/${inspecaoId}/fotos`).then((r) => r.ok ? r.json() : {})
      .then((d: any) => {
        if (d.registro) setRegistro({ ...d.registro, itens: d.registro.itens || {} });
        setPodeEditar(!!d.podeEditar);
      }).catch(() => {});
  }, [inspecaoId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (registro) onMudar?.(registro); }, [registro]);   // eslint-disable-line react-hooks/exhaustive-deps
  const emEnvio = Object.values(enviando).reduce((s, n) => s + n, 0);
  useEffect(() => { onLocais?.({ fila: locais.length, enviando: emEnvio }); }, [locais.length, emEnvio]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onErro?.(erro); }, [erro]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Fila offline esvaziou: as fotos locais já estão no servidor — recarrega.
  useEffect(() => {
    function aoSincronizar(ev: Event) {
      const n = (ev as CustomEvent).detail?.pendentes;
      if (n === 0 && locaisRef.current.length > 0) {
        locaisRef.current.forEach((l) => URL.revokeObjectURL(l.url));
        setLocais([]);
        carregar();
      }
    }
    window.addEventListener("asp:fila", aoSincronizar);
    return () => window.removeEventListener("asp:fila", aoSincronizar);
  }, [carregar]);

  /** Grava a resposta do servidor (ou desfaz a mudança otimista se falhou). */
  function aplicarResposta(res: { ok: boolean; queued: boolean; data?: any }, falha: string) {
    if (res.queued) return;
    if (!res.ok) { setErro(res.data?.erro || falha); carregar(); return; }
    if (res.data?.registro) setRegistro({ ...res.data.registro, itens: res.data.registro.itens || {} });
  }

  async function enviarFotos(slot: SlotFoto, lista: FileList | null) {
    const arquivos = Array.from(lista || []).slice(0, slot.minimo ? 20 : 1);
    if (arquivos.length === 0) return;
    setErro(null);
    // Uma por vez: a fila offline e a trava otimista do servidor preservam a
    // ordem, e o celular não comprime dez fotos de 8 MB ao mesmo tempo.
    for (const original of arquivos) {
      setEnviando((p) => ({ ...p, [slot.id]: (p[slot.id] || 0) + 1 }));
      try {
        const arquivo = await comprimirImagem(original);
        const res = await enviarArquivo(url, { slot: slot.id }, arquivo, `Foto da execução — ${slot.rotulo}`);
        if (res.queued) {
          const local: FotoLocal = { chave: `${slot.id}-${Date.now()}-${Math.random()}`, slot: slot.id, url: URL.createObjectURL(arquivo) };
          setLocais((p) => [...(slot.minimo ? p : p.filter((l) => l.slot !== slot.id)), local]);
        } else {
          aplicarResposta(res, "Falha ao enviar a foto.");
        }
      } finally {
        setEnviando((p) => ({ ...p, [slot.id]: Math.max(0, (p[slot.id] || 1) - 1) }));
      }
    }
  }

  async function remover(caminho: string) {
    if (!confirm("Remover esta foto da coleta?")) return;
    setErro(null);
    setRegistro((r) => r && {
      ...r,
      itens: Object.fromEntries(Object.entries(r.itens).map(([k, v]) => [k,
        Array.isArray(v) ? v.filter((f) => f.caminho !== caminho)
          : v?.caminho === caminho ? { valor: v.valor ?? null } : v])),
    });
    const res = await enviarJson(url, "DELETE", { caminho }, "Remover foto da execução");
    aplicarResposta(res, "Falha ao remover a foto.");
  }

  async function marcar(chave: "agua_antes" | "agua_depois" | "limpeza_confirmada", valor: boolean) {
    setErro(null);
    setRegistro((r) => r && { ...r, [chave]: valor });
    const res = await enviarJson(url, "PATCH", { [chave]: valor }, "Coleta de fotos da execução");
    aplicarResposta(res, "Falha ao salvar.");
  }

  async function salvarValor(slot: SlotFoto, texto: string) {
    const valor = lerNumero(texto);
    if (texto.trim() && valor === null) { setErro(`${slot.rotulo}: valor inválido — use números, ex.: 7,2.`); return; }
    if (valor === valorDoSlot(registro, slot.id)) return;
    setErro(null);
    setRegistro((r) => r && {
      ...r,
      itens: { ...r.itens, [slot.id]: { ...((r.itens[slot.id] as ItemColetado) || {}), valor } },
    });
    const res = await enviarJson(url, "PATCH", { valor: { slot: slot.id, valor } }, `Valor de ${slot.rotulo}`);
    aplicarResposta(res, "Falha ao salvar o valor.");
  }

  /** Botões de câmera e galeria. Câmera usa `capture` (abre a traseira no
   *  celular); galeria permite escolher fotos já tiradas — e várias de uma
   *  vez nas vagas de várias fotos. */
  function Botoes(slot: SlotFoto, temFoto: boolean) {
    if (!podeEditar) return null;
    const ocupado = (enviando[slot.id] || 0) > 0;
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <label className="btn-dl" style={{ ...btn, opacity: ocupado ? 0.6 : 1 }}>
          📷 {slot.minimo ? "Foto" : temFoto ? "Trocar" : "Foto"}
          <input type="file" accept="image/*" capture="environment" disabled={ocupado} style={{ display: "none" }}
            onChange={(e) => { enviarFotos(slot, e.target.files); e.target.value = ""; }} />
        </label>
        <label className="btn-dl btn-sec" style={{ ...btn, opacity: ocupado ? 0.6 : 1 }}>
          🖼 Galeria
          <input type="file" accept="image/*" multiple={!!slot.minimo} disabled={ocupado} style={{ display: "none" }}
            onChange={(e) => { enviarFotos(slot, e.target.files); e.target.value = ""; }} />
        </label>
        {ocupado && <span className="detalhe" style={{ margin: 0, alignSelf: "center" }}>Enviando…</span>}
      </div>
    );
  }

  /** Vaga de uma foto (com valor medido, quando pede). */
  function VagaSimples(slot: SlotFoto, completo: boolean) {
    const foto = fotosDoSlot(registro, slot.id)[0];
    const local = locais.filter((l) => l.slot === slot.id).pop();
    const valor = valorDoSlot(registro, slot.id);
    return (
      <div key={slot.id} style={{ border: "1px solid var(--borda)", borderRadius: 10, padding: 10,
        display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
          <strong style={{ fontSize: 13 }}>{slot.rotulo}</strong>
          <Selo ok={completo} texto={completo ? "✓" : "pendente"} />
        </div>
        {local ? <Miniatura src={local.url} tamanho="100%" naFila />
          : foto ? <Miniatura src={urlFoto(foto.caminho)} tamanho="100%" onRemover={podeEditar ? () => remover(foto.caminho) : undefined} />
          : (
            <div style={{ width: "100%", aspectRatio: "4 / 3", borderRadius: 8, border: "1px dashed var(--borda)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "var(--cinza)", fontSize: 12.5 }}>
              Sem foto
            </div>
          )}
        {slot.valor && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 3 }}>
              {slot.valor.nome}{slot.valor.unidade ? ` (${slot.valor.unidade})` : ""}
            </label>
            {/* key: valor gravado mudou (ex.: recarga) → o campo recomeça dele */}
            <input key={`${slot.id}-${valor ?? ""}`} style={campo} inputMode="decimal" disabled={!podeEditar}
              defaultValue={valor == null ? "" : numeroBr(valor)} placeholder={slot.valor.nome === "pH" ? "ex.: 7,2" : "ex.: 0,5"}
              onBlur={(e) => salvarValor(slot, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          </div>
        )}
        {foto?.por && !local && (
          <span className="detalhe" style={{ margin: 0, fontSize: 11.5 }}>
            {foto.por}{foto.em ? ` · ${new Date(foto.em).toLocaleString("pt-BR")}` : ""}
          </span>
        )}
        {Botoes(slot, !!foto || !!local)}
      </div>
    );
  }

  /** Vaga de várias fotos (limpeza antes/durante/depois), com mínimo. */
  function VagaMultipla(slot: SlotFoto, completo: boolean) {
    const fotos = fotosDoSlot(registro, slot.id);
    const meus = locais.filter((l) => l.slot === slot.id);
    const n = fotos.length + meus.length;
    return (
      <div key={slot.id} style={{ gridColumn: "1 / -1", border: "1px solid var(--borda)", borderRadius: 10, padding: 10,
        display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>{slot.rotulo}</strong>
          <Selo ok={completo} texto={`${completo ? "✓ " : ""}${n} de ${slot.minimo} (mín.)`} />
        </div>
        {n === 0 ? (
          <p className="vazio" style={{ margin: 0, fontSize: 12.5 }}>Nenhuma foto ainda.</p>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {fotos.map((f) => (
              <Miniatura key={f.caminho} src={urlFoto(f.caminho)} tamanho={104}
                onRemover={podeEditar ? () => remover(f.caminho) : undefined} />
            ))}
            {meus.map((l) => <Miniatura key={l.chave} src={l.url} tamanho={104} naFila />)}
          </div>
        )}
        {Botoes(slot, n > 0)}
      </div>
    );
  }

  function Secao(secao: SecaoFotos, situacao: ReturnType<typeof situacaoDosItens>) {
    const exigida = secaoExigida(registro, secao);
    const daSecao = situacao.filter((i) => i.secao.id === secao.id);
    const feitos = daSecao.filter((i) => i.completo).length;
    const guardadas = secao.slots.reduce((s, sl) => s + fotosDoSlot(registro, sl.id).length, 0);
    const ok = (id: string) => !!daSecao.find((i) => i.id === id)?.completo;
    return (
      <div key={secao.id} style={{ borderTop: "1px solid var(--borda)", paddingTop: 12, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{secao.titulo}</strong>
          {exigida && <Selo ok={feitos === daSecao.length} texto={`${feitos} de ${daSecao.length}`} />}
        </div>
        {secao.descricao && <p className="detalhe" style={{ margin: "2px 0 0" }}>{secao.descricao}</p>}
        {secao.flag && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13,
            cursor: podeEditar ? "pointer" : "default" }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={exigida} disabled={!podeEditar}
              onChange={(e) => marcar(secao.flag!, e.target.checked)} />
            <span>Necessário (água potável)</span>
          </label>
        )}
        {!exigida ? (
          <p className="detalhe" style={{ margin: "6px 0 0" }}>
            Não exigida nesta inspeção.
            {guardadas > 0 && ` ${guardadas} foto(s) já coletada(s) continuam guardadas e voltam se marcar de novo.`}
          </p>
        ) : (
          <>
            {secao.id === "limpeza" && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, fontSize: 13,
                cursor: podeEditar ? "pointer" : "default" }}>
                <input type="checkbox" style={{ width: 18, height: 18, marginTop: 1 }} checked={!!registro?.limpeza_confirmada}
                  disabled={!podeEditar} onChange={(e) => marcar("limpeza_confirmada", e.target.checked)} />
                <span>Confirmo que as fotos da limpeza foram tiradas durante o serviço.</span>
              </label>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 10 }}>
              {secao.slots.map((slot) => slot.minimo ? VagaMultipla(slot, ok(slot.id)) : VagaSimples(slot, ok(slot.id)))}
            </div>
          </>
        )}
      </div>
    );
  }

  const situacao = situacaoDosItens(registro);
  const { feitos, total } = progressoColeta(registro);

  return (
    <div className={embutido ? undefined : "card"} style={embutido ? undefined : { marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: embutido ? "flex-start" : "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {!embutido && <h3 style={{ margin: 0 }}>Coleta de fotos da execução</h3>}
        {registro && <Selo ok={total > 0 && feitos === total} texto={`${feitos} de ${total} itens`} />}
      </div>
      <p className="detalhe" style={{ marginTop: 6 }}>
        Fotos de campo que entram sozinhas no Relatório de Execução. Item faltando não impede de
        avançar — o sistema só avisa.
      </p>
      {erro && <p className="erro-texto" style={{ margin: "6px 0 0" }}>{erro}</p>}
      {locais.length > 0 && (
        <p className="detalhe" style={{ margin: "6px 0 0", color: "#c2410c" }}>
          Sem conexão — {locais.length} foto(s) na fila deste aparelho, enviadas ao reconectar.
        </p>
      )}
      {!registro ? <p className="vazio" style={{ margin: "8px 0 0" }}>Carregando…</p>
        : SECOES_FOTOS.map((s) => Secao(s, situacao))}
    </div>
  );
}
