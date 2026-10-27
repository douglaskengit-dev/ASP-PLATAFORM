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
 * Fase 7 (validação, lib/validacao/fotosExecucao.ts): antes de comprimir, o
 * aparelho confere que o arquivo é imagem de verdade (até 10 MB; WebP, GIF,
 * BMP e HEIC são convertidos), calcula o SHA-256 do ORIGINAL — a mesma foto
 * não entra em duas vagas — e lê a data da câmera (EXIF), que a compressão
 * apaga. Mensagens ⛔/⚠️ ficam junto da vaga.
 *
 * `embutido`: dentro de uma SecaoRecolhivel (página da inspeção) — sem card
 * nem título próprios. Mesmo recolhido o componente segue montado, e a fila
 * e os envios em andamento são avisados à página (onLocais) para ela abrir
 * a seção e mostrar a contagem no resumo. */
import { useCallback, useEffect, useRef, useState } from "react";
import { enviarArquivo, enviarJson } from "@/lib/pwa/sync";
import { comprimirImagem } from "@/lib/pwa/imagem";
import { sha256Hex } from "@/lib/sha256";
import { dataCapturaExif } from "@/lib/asp/exif";
import { prepararImagemRelatorio } from "@/lib/asp/imagem-relatorio";
import {
  SECOES_FOTOS, fotosDoSlot, valorDoSlot, numeroBr, lerNumero, secaoExigida, gruposDaSecao,
  situacaoDosItens, progressoColeta, fotoRepetida, slotPorId, unidadeDoSlot, UNIDADE_CLORO_PADRAO,
  type RegistroFotosExecucao, type SlotFoto, type SecaoFotos, type ItemColetado, type UnidadeCloro,
} from "@/lib/asp/fotos-execucao";
import {
  FOTO_MAX_BYTES, addErro, erroValorColeta, formatoImagem, mesclar, novoResultado, validarColetaFotos,
  type Periodo,
} from "@/lib/validacao";
import {
  lerPreferenciaCopia, gravarPreferenciaCopia, ehIos, ehAparelhoDeToque, nomeCopia, baixarCopia, compartilharCopias,
} from "@/lib/pwa/copia-aparelho";
import { MensagensCampo } from "./MensagensCampo";

/** Foto que ficou na fila offline — só existe neste aparelho até sincronizar. */
interface FotoLocal { chave: string; slot: string; url: string; hash?: string }

const mb = (n: number) => (n / 1048576).toFixed(1).replace(".", ",");

const btn: React.CSSProperties = { cursor: "pointer" };
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

export default function ColetaFotosExecucao({
  inspecaoId, identificacao, onMudar, embutido, somentePendentes, onLocais, onErro, aguaPotavel,
  cloroUnidade = UNIDADE_CLORO_PADRAO, cloroLimiteAviso, periodoExecucao,
}: {
  inspecaoId: string;
  /** Identificação da OS (ex.: TQ-01) — entra no nome da cópia salva no aparelho. */
  identificacao?: string;
  /** Unidade do cloro do procedimento (Catálogo). */
  cloroUnidade?: UnidadeCloro;
  /** Acima disso, o cloro medido gera aviso (Catálogo; padrão 5). */
  cloroLimiteAviso?: number;
  /** Período da execução (Fase 6): foto com data da câmera fora dele avisa. */
  periodoExecucao?: Periodo | null;
  /** Procedimento da OS é de água potável (Catálogo): coleta de água
   *  desmarcada vira aviso (Fase 6) — não trava nada. */
  aguaPotavel?: boolean;
  /** Avisa a página a cada mudança — o aviso de fase e o relatório usam. */
  onMudar?: (r: RegistroFotosExecucao) => void;
  /** Sem card nem título próprios (a SecaoRecolhivel já os dá). */
  embutido?: boolean;
  /** Widget "Pendências de campo": mostra só as vagas que faltam (sem as
   *  caixinhas de seção nem o texto de ajuda). */
  somentePendentes?: boolean;
  /** Fotos na fila offline deste aparelho e envios em andamento. */
  onLocais?: (n: { fila: number; enviando: number }) => void;
  /** Avisa a página do erro, para ela abrir a seção recolhida. */
  onErro?: (erro: string | null) => void;
}) {
  const [registro, setRegistro] = useState<RegistroFotosExecucao | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** ⛔ da própria vaga (foto repetida, arquivo inválido, valor fora da
   *  faixa) — aparecem junto dela, não no topo. */
  const [errosVaga, setErrosVaga] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<Record<string, number>>({});
  const [locais, setLocais] = useState<FotoLocal[]>([]);
  const locaisRef = useRef<FotoLocal[]>([]);
  locaisRef.current = locais;
  const registroRef = useRef<RegistroFotosExecucao | null>(null);
  registroRef.current = registro;
  /** Cópia no aparelho das fotos da câmera (ligada por padrão, por aparelho). */
  const [salvarCopia, setSalvarCopia] = useState(true);
  const [toque, setToque] = useState(false);
  const [ios, setIos] = useState(false);
  /** iPhone: originais esperando o toque em "Salvar no aparelho", por vaga. */
  const [copiasIos, setCopiasIos] = useState<Record<string, { arquivo: File; nome: string }[]>>({});
  useEffect(() => {
    setSalvarCopia(lerPreferenciaCopia());
    setToque(ehAparelhoDeToque());
    setIos(ehIos());
  }, []);

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

  const erroVaga = (slotId: string, msg: string | null) =>
    setErrosVaga((p) => { const n = { ...p }; if (msg) n[slotId] = msg; else delete n[slotId]; return n; });

  /** Confere o arquivo ORIGINAL (tipo real, tamanho), calcula o hash e lê a
   *  data da câmera; converte o que não é JPEG/PNG; comprime. Devolve o que
   *  enviar ou a mensagem de erro. */
  async function prepararFoto(original: File): Promise<{ arquivo: File; hash: string; capturada: string | null } | string> {
    const nome = original.name || "foto";
    if (original.size > FOTO_MAX_BYTES) return `“${nome}” tem ${mb(original.size)} MB — o limite por foto é 10 MB.`;
    if (original.size === 0) return `“${nome}” está vazio.`;
    const bytes = new Uint8Array(await original.arrayBuffer());
    const fmt = formatoImagem(bytes);
    if (!fmt) return `“${nome}” não é uma imagem reconhecida. Envie JPEG ou PNG (WebP, GIF, BMP e HEIC são convertidos quando possível).`;
    const hash = await sha256Hex(bytes);
    const capturada = fmt === "jpeg" ? dataCapturaExif(bytes) : null;
    let base = original;
    if (fmt !== "jpeg" && fmt !== "png") {
      const prep = await prepararImagemRelatorio(original, nome);
      if ("erro" in prep) return prep.erro;
      base = prep.arquivo;
    }
    const arquivo = await comprimirImagem(base);
    const fmtFinal = formatoImagem(new Uint8Array(await arquivo.slice(0, 16).arrayBuffer()));
    if (fmtFinal !== "jpeg" && fmtFinal !== "png") return `Não foi possível preparar “${nome}”. Salve como JPEG e envie de novo.`;
    return { arquivo, hash, capturada };
  }

  /** "Limpeza — Durante" de uma vaga. */
  const rotuloVaga = (id: string) => { const d = slotPorId(id); return d ? `${d.secao.titulo} — ${d.slot.rotulo}` : id; };

  /** Foto da câmera do app: guarda o ORIGINAL no aparelho (Android baixa na
   *  hora; iPhone espera o toque em "Salvar no aparelho"). */
  function guardarCopia(slot: SlotFoto, arquivos: File[]) {
    if (!salvarCopia || !toque) return;
    const quando = new Date();
    const itens = arquivos.map((a, k) => ({ arquivo: a, nome: nomeCopia(identificacao, slot.id, a, arquivos.length > 1 ? k : 0, quando) }));
    if (ios) setCopiasIos((p) => ({ ...p, [slot.id]: [...(p[slot.id] || []), ...itens] }));
    else itens.forEach((i) => baixarCopia(i.arquivo, i.nome));
  }

  async function salvarCopiasIos(slotId: string) {
    const itens = copiasIos[slotId] || [];
    if (itens.length === 0) return;
    const r = await compartilharCopias(itens);
    if (r !== "cancelado") setCopiasIos((p) => { const n = { ...p }; delete n[slotId]; return n; });
  }

  async function enviarFotos(slot: SlotFoto, lista: FileList | null, daCamera = false) {
    const arquivos = Array.from(lista || []).slice(0, slot.minimo ? 20 : 1);
    if (arquivos.length === 0) return;
    if (daCamera) guardarCopia(slot, arquivos);
    setErro(null);
    erroVaga(slot.id, null);
    // Hash -> vaga das fotos ainda fora do registro: fila offline e esta leva.
    const pendentes = new Map<string, string>(locaisRef.current.filter((l) => l.hash).map((l) => [l.hash!, l.slot]));
    const problemas: string[] = [];
    // Uma por vez: a fila offline e a trava otimista do servidor preservam a
    // ordem, e o celular não comprime dez fotos de 8 MB ao mesmo tempo.
    for (const original of arquivos) {
      setEnviando((p) => ({ ...p, [slot.id]: (p[slot.id] || 0) + 1 }));
      try {
        const prep = await prepararFoto(original);
        if (typeof prep === "string") { problemas.push(prep); continue; }
        const pend = pendentes.get(prep.hash);
        const onde = fotoRepetida(registroRef.current, prep.hash, slot.id)
          || (pend && (pend !== slot.id || slot.minimo) ? rotuloVaga(pend) : null);
        if (onde) { problemas.push(`${original.name ? `“${original.name}”: ` : ""}a mesma foto já está em “${onde}”.`); continue; }
        pendentes.set(prep.hash, slot.id);
        const campos: Record<string, string> = { slot: slot.id, hash: prep.hash };
        if (prep.capturada) campos.capturada_em = prep.capturada;
        const res = await enviarArquivo(url, campos, prep.arquivo, `Foto da execução — ${slot.rotulo}`);
        if (res.queued) {
          const local: FotoLocal = {
            chave: `${slot.id}-${Date.now()}-${Math.random()}`, slot: slot.id, url: URL.createObjectURL(prep.arquivo), hash: prep.hash,
          };
          setLocais((p) => [...(slot.minimo ? p : p.filter((l) => l.slot !== slot.id)), local]);
        } else if (res.status === 409 && res.data?.repetida) {
          problemas.push(res.data.erro);
          carregar();
        } else {
          aplicarResposta(res, "Falha ao enviar a foto.");
        }
      } finally {
        setEnviando((p) => ({ ...p, [slot.id]: Math.max(0, (p[slot.id] || 1) - 1) }));
      }
    }
    if (problemas.length) erroVaga(slot.id, problemas.join(" "));
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
    setErrosVaga({});
    const res = await enviarJson(url, "DELETE", { caminho }, "Remover foto da execução");
    aplicarResposta(res, "Falha ao remover a foto.");
  }

  async function marcar(chave: "agua_antes" | "agua_depois" | "robo_higienizacao" | "limpeza_confirmada", valor: boolean) {
    setErro(null);
    setRegistro((r) => r && { ...r, [chave]: valor });
    const res = await enviarJson(url, "PATCH", { [chave]: valor }, "Coleta de fotos da execução");
    aplicarResposta(res, "Falha ao salvar.");
  }

  async function salvarValor(slot: SlotFoto, texto: string) {
    const valor = lerNumero(texto);
    if (texto.trim() && valor === null) { erroVaga(slot.id, "Valor inválido — use números, ex.: 7,2."); return; }
    const foraDaFaixa = erroValorColeta(slot, valor);
    if (foraDaFaixa) { erroVaga(slot.id, foraDaFaixa); return; }
    erroVaga(slot.id, null);
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
        <label className="btn-dl btn-sm" style={{ ...btn, opacity: ocupado ? 0.6 : 1 }}>
          📷 {slot.minimo ? "Foto" : temFoto ? "Trocar" : "Foto"}
          <input type="file" accept="image/*" capture="environment" disabled={ocupado} style={{ display: "none" }}
            onChange={(e) => { enviarFotos(slot, e.target.files, true); e.target.value = ""; }} />
        </label>
        <label className="btn-dl btn-sec btn-sm" style={{ ...btn, opacity: ocupado ? 0.6 : 1 }}>
          🖼 Galeria
          <input type="file" accept="image/*" multiple={!!slot.minimo} disabled={ocupado} style={{ display: "none" }}
            onChange={(e) => { enviarFotos(slot, e.target.files); e.target.value = ""; }} />
        </label>
        {ocupado && <span className="detalhe" style={{ margin: 0, alignSelf: "center" }}>Enviando…</span>}
        {(copiasIos[slot.id]?.length || 0) > 0 && (
          <button type="button" className="btn-dl btn-sec btn-sm" style={btn} onClick={() => salvarCopiasIos(slot.id)}
            title="Abre o menu de compartilhar — escolha “Salvar Imagem”">
            💾 Salvar no aparelho{copiasIos[slot.id].length > 1 ? ` (${copiasIos[slot.id].length})` : ""}
          </button>
        )}
      </div>
    );
  }

  /** Vaga de uma foto (com valor medido, quando pede). */
  function VagaSimples(slot: SlotFoto, completo: boolean) {
    const foto = fotosDoSlot(registro, slot.id)[0];
    const local = locais.filter((l) => l.slot === slot.id).pop();
    const valor = valorDoSlot(registro, slot.id);
    return (
      <div key={slot.id} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13, minWidth: 0, overflowWrap: "anywhere" }}>{slot.rotulo}</strong>
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
              {slot.valor.nome}{unidadeDoSlot(slot, cloroUnidade) ? ` (${unidadeDoSlot(slot, cloroUnidade)})` : ""}
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
        <MensagensCampo r={validacao} campo={slot.id} />
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
      <div key={slot.id} style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
        paddingTop: 8, borderTop: "1px dashed var(--borda)" }}>
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
        <MensagensCampo r={validacao} campo={slot.id} />
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
    if (somentePendentes && (!exigida || feitos === daSecao.length)) return null;
    return (
      <div key={secao.id} style={{ borderTop: "1px solid var(--borda)", paddingTop: 12, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{secao.titulo}</strong>
          {exigida && <Selo ok={feitos === daSecao.length} texto={`${feitos} de ${daSecao.length}`} />}
        </div>
        {secao.descricao && <p className="detalhe" style={{ margin: "2px 0 0" }}>{secao.descricao}</p>}
        {secao.flag && !somentePendentes && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13,
            cursor: podeEditar ? "pointer" : "default" }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={exigida} disabled={!podeEditar}
              onChange={(e) => marcar(secao.flag!, e.target.checked)} />
            <span>Necessário (água potável)</span>
          </label>
        )}
        {secao.flag && aguaPotavel && !exigida && !somentePendentes && (
          <p className="val-msg val-aviso aviso-plano" style={{ margin: "6px 0 0" }}>
            ⚠️ O procedimento desta OS é de água potável, mas {secao.id === "robo_higienizacao" ? "a higienização do robô está desmarcada — as fotos" : "esta coleta está desmarcada — as fotos e análises"} não serão cobradas nem entram no relatório.
          </p>
        )}
        {!exigida ? (
          <p className="detalhe" style={{ margin: "6px 0 0" }}>
            Não exigida nesta OS.
            {guardadas > 0 && ` ${guardadas} foto(s) já coletada(s) continuam guardadas e voltam se marcar de novo.`}
          </p>
        ) : (
          <>
            {secao.id === "limpeza" && !(somentePendentes && registro?.limpeza_confirmada) && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, fontSize: 13,
                cursor: podeEditar ? "pointer" : "default" }}>
                <input type="checkbox" style={{ width: 18, height: 18, marginTop: 1 }} checked={!!registro?.limpeza_confirmada}
                  disabled={!podeEditar} onChange={(e) => marcar("limpeza_confirmada", e.target.checked)} />
                <span>Confirmo que as fotos da limpeza foram tiradas durante o serviço.</span>
              </label>
            )}
            {secao.id === "limpeza" && <MensagensCampo r={validacao} campo="limpeza_confirmada" />}
            {secao.id === "agua_depois" && <MensagensCampo r={validacao} campo="agua_depois" />}
            {gruposDaSecao(secao)
              .map((g) => somentePendentes ? { ...g, slots: g.slots.filter((s) => !ok(s.id)) } : g)
              .filter((g) => g.slots.length > 0)
              .map((g) => {
              const feitosGrupo = g.slots.filter((s) => ok(s.id)).length;
              return (
                <div key={g.titulo || "geral"} style={{ marginTop: g.titulo ? 14 : 10 }}>
                  {g.titulo && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--texto-suave)" }}>
                        {g.titulo}
                      </span>
                      <span className="detalhe" style={{ fontSize: 12 }}>{feitosGrupo} de {g.slots.length}</span>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "14px 16px" }}>
                    {g.slots.map((slot) => slot.minimo ? VagaMultipla(slot, ok(slot.id)) : VagaSimples(slot, ok(slot.id)))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  }

  const situacao = situacaoDosItens(registro);
  // ⛔/⚠️ da coleta gravada + os ⛔ locais de cada vaga (antes de enviar)
  const locaisR = novoResultado();
  Object.entries(errosVaga).forEach(([k, m]) => addErro(locaisR, k, m));
  const validacao = mesclar(
    validarColetaFotos(registro, { unidadeCloro: cloroUnidade, limiteCloro: cloroLimiteAviso, periodo: periodoExecucao }),
    locaisR,
  );
  const { feitos, total } = progressoColeta(registro);

  return (
    <div className={embutido ? undefined : "card"} style={embutido ? undefined : { marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: embutido ? "flex-start" : "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {!embutido && <h3 style={{ margin: 0 }}>Coleta de fotos da execução</h3>}
        {registro && <Selo ok={total > 0 && feitos === total} texto={`${feitos} de ${total} itens`} />}
      </div>
      {!somentePendentes && (
        <p className="detalhe" style={{ marginTop: 6 }}>
          Fotos de campo que entram sozinhas no Relatório de Execução. Item faltando não impede de
          avançar — o sistema só avisa.
        </p>
      )}
      {podeEditar && toque && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" style={{ width: 18, height: 18, marginTop: 1 }} checked={salvarCopia}
            onChange={(e) => { setSalvarCopia(e.target.checked); gravarPreferenciaCopia(e.target.checked); }} />
          <span>
            Salvar cópia das fotos da câmera neste aparelho
            <span className="detalhe" style={{ display: "block", margin: 0, fontSize: 12 }}>
              {ios
                ? "No iPhone, toque em “💾 Salvar no aparelho” depois da foto e escolha “Salvar Imagem”."
                : "A foto original vai para a pasta Downloads (aparece na galeria)."}
            </span>
          </span>
        </label>
      )}
      {erro && <p className="erro-texto" style={{ margin: "6px 0 0" }}>{erro}</p>}
      {locais.length > 0 && (
        <p className="detalhe" style={{ margin: "6px 0 0", color: "var(--pendente)" }}>
          Sem conexão — {locais.length} foto(s) na fila deste aparelho, enviadas ao reconectar.
        </p>
      )}
      {!registro ? <p className="vazio" style={{ margin: "8px 0 0" }}>Carregando…</p>
        : somentePendentes && total > 0 && feitos === total
          ? <p className="detalhe" style={{ margin: "8px 0 0", color: "var(--sucesso)" }}>✓ Fotos completas.</p>
          : SECOES_FOTOS.map((s) => Secao(s, situacao))}
    </div>
  );
}
