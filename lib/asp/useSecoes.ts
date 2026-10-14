"use client";

/** Estado aberto/recolhido das seções da página da inspeção.
 *
 * Três camadas, da mais fraca para a mais forte:
 * 1. padrão da fase (secoesPadrao, em lib/asp/fases.ts);
 * 2. escolha do usuário, guardada em localStorage por inspeção E por fase
 *    (`asp:secoes:{inspecaoId}:{fase}`) — quando a fase muda (inclusive na
 *    reprovação, que volta uma fase) a chave muda e o padrão volta a valer.
 *    Ação de fase na fila offline não muda `insp.fase`, então não reaplica;
 * 3. aberturas forçadas: seção com erro, fotos na fila/enviando ou âncora na
 *    URL (#relatorios). Abrem na hora em que a condição surge; se o usuário
 *    recolher depois, a escolha dele vale até a condição surgir de novo.
 *
 * O localStorage pode lançar (aba anônima, cota, bloqueio) — tudo em
 * try/catch: sem storage, a página só não lembra a escolha. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SECOES_INSPECAO, secoesPadrao, type SecaoInspecao } from "./fases";

type Escolhas = Partial<Record<SecaoInspecao, boolean>>;

function ler(chave: string | null): Escolhas {
  if (!chave) return {};
  try {
    const bruto = JSON.parse(localStorage.getItem(chave) || "{}");
    const r: Escolhas = {};
    for (const s of SECOES_INSPECAO) if (typeof bruto?.[s] === "boolean") r[s] = bruto[s];
    return r;
  } catch {
    return {};
  }
}

function gravar(chave: string | null, escolhas: Escolhas) {
  if (!chave) return;
  try {
    if (Object.keys(escolhas).length === 0) localStorage.removeItem(chave);
    else localStorage.setItem(chave, JSON.stringify(escolhas));
  } catch { /* sem storage: segue só em memória */ }
}

/** Âncora da URL, se for uma seção válida (âncora desconhecida é ignorada). */
function secaoDaUrl(): SecaoInspecao | null {
  if (typeof window === "undefined") return null;
  const h = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return (SECOES_INSPECAO as string[]).includes(h) ? (h as SecaoInspecao) : null;
}

export function useSecoes({ inspecaoId, fase, perfil, reprovadoAgora, forcadas }: {
  inspecaoId: string;
  /** null enquanto a inspeção carrega — nada é lido nem gravado. */
  fase: number | null;
  perfil: string | null;
  reprovadoAgora: boolean;
  /** Condições que obrigam a seção a abrir (erro, fila de fotos…). */
  forcadas: Partial<Record<SecaoInspecao, boolean>>;
}) {
  const chave = fase == null ? null : `asp:secoes:${inspecaoId}:${fase}`;
  const padrao = useMemo(
    () => (fase == null ? null : secoesPadrao(fase, perfil, { reprovadoAgora })),
    [fase, perfil, reprovadoAgora],
  );

  // Escolhas do usuário, recarregadas quando a chave (fase) muda. Ler durante
  // o render evita um quadro com o padrão antes da escolha salva.
  const [estado, setEstado] = useState<{ chave: string | null; escolhas: Escolhas }>({ chave: null, escolhas: {} });
  let escolhas = estado.escolhas;
  if (estado.chave !== chave) {
    escolhas = ler(chave);
    setEstado({ chave, escolhas });
  }

  // Aberturas forçadas ainda não desfeitas pelo usuário (não persistem).
  const [abertasForca, setAbertasForca] = useState<SecaoInspecao[]>([]);
  useEffect(() => { setAbertasForca([]); }, [chave]);

  // Abre na BORDA de subida da condição (sem erro → com erro).
  const anteriores = useRef<Partial<Record<SecaoInspecao, boolean>>>({});
  const assinatura = SECOES_INSPECAO.map((s) => (forcadas[s] ? 1 : 0)).join("");
  useEffect(() => {
    const novas = SECOES_INSPECAO.filter((s) => forcadas[s] && !anteriores.current[s]);
    anteriores.current = { ...forcadas };
    if (novas.length > 0) setAbertasForca((p) => Array.from(new Set([...p, ...novas])));
  }, [assinatura]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Âncora (#coletas…): abre e rola até a seção, no carregamento e ao trocar.
  const pronto = chave != null;
  useEffect(() => {
    if (!pronto) return;
    function irParaAncora() {
      const s = secaoDaUrl();
      if (!s) return;
      setAbertasForca((p) => (p.includes(s) ? p : [...p, s]));
      // Depois do render que tirou o `hidden` do corpo.
      requestAnimationFrame(() => document.getElementById(s)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    irParaAncora();
    window.addEventListener("hashchange", irParaAncora);
    return () => window.removeEventListener("hashchange", irParaAncora);
  }, [pronto]);

  const aberta = useCallback((s: SecaoInspecao): boolean => {
    if (abertasForca.includes(s)) return true;
    if (escolhas[s] !== undefined) return !!escolhas[s];
    return padrao?.[s] === "aberta";
  }, [abertasForca, escolhas, padrao]);

  /** Grava só o que difere do padrão — assim "alterado" volta a false se o
   *  usuário desfizer à mão, e o "Restaurar padrão" some. */
  const definir = useCallback((mudancas: Escolhas) => {
    const prox: Escolhas = { ...escolhas, ...mudancas };
    for (const s of SECOES_INSPECAO) {
      if (prox[s] !== undefined && prox[s] === (padrao?.[s] === "aberta")) delete prox[s];
    }
    setEstado({ chave, escolhas: prox });
    setAbertasForca((p) => p.filter((s) => !(s in mudancas)));
    gravar(chave, prox);
  }, [escolhas, padrao, chave]);

  const alternar = useCallback((s: SecaoInspecao) => definir({ [s]: !aberta(s) }), [definir, aberta]);
  // Seção oculta na fase (Fotos no bloco de inspeção) fica de fora.
  const todas = useCallback((valor: boolean) => definir(Object.fromEntries(
    SECOES_INSPECAO.filter((s) => padrao?.[s] !== "oculta").map((s) => [s, valor])) as Escolhas), [definir, padrao]);
  const expandirTudo = useCallback(() => todas(true), [todas]);
  const recolherTudo = useCallback(() => todas(false), [todas]);
  const restaurar = useCallback(() => {
    setEstado({ chave, escolhas: {} });
    setAbertasForca([]);
    gravar(chave, {});
  }, [chave]);

  return {
    aberta,
    alternar, expandirTudo, recolherTudo, restaurar,
    /** O usuário mudou algo em relação ao padrão desta fase. */
    alterado: Object.keys(escolhas).length > 0,
  };
}
