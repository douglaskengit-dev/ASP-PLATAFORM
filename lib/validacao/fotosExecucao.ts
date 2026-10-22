/** Fase 7 — a COLETA DE FOTOS da execução (gp_fotos_execucao) sem dado
 * ambíguo ou duplicado. Pura: o card (ColetaFotosExecucao) e a API
 * (/api/inspecoes/[id]/fotos) usam as mesmas regras.
 *
 *   ⛔ a mesma foto (SHA-256 do arquivo original) em duas vagas ou duas vezes
 *      no mesmo grupo · pH fora de 0–14 · cloro negativo · arquivo que não é
 *      imagem de verdade ou com mais de 10 MB (antes da compressão)
 *   ⚠️ cloro acima do limite de aviso do procedimento (Catálogo) · pH e cloro
 *      ANTES iguais aos DEPOIS (cópia?) · foto tirada (EXIF) fora do período
 *      da execução · "limpeza confirmada" com menos de 3 fotos em algum
 *      momento */
import { addAviso, addErro, novoResultado, type ResultadoValidacao } from "./resultado";
import { textoPeriodoLongo, type Periodo } from "./periodo";
import {
  CLORO_LIMITE_AVISO_PADRAO, MINIMO_FOTOS_LIMPEZA, SECOES_FOTOS, UNIDADE_CLORO_PADRAO,
  fotosDoSlot, numeroBr, slotPorId, valorDoSlot,
  type RegistroFotosExecucao, type SlotFoto, type UnidadeCloro,
} from "../asp/fotos-execucao";

export const PH_MIN = 0;
export const PH_MAX = 14;

/** Erro (⛔) de um valor medido; null = aceito. Vale para a tela e a API. */
export function erroValorColeta(slot: Pick<SlotFoto, "valor">, valor: number | null): string | null {
  if (valor == null || !slot.valor) return null;
  if (!isFinite(valor)) return "Valor inválido.";
  if (slot.valor.nome === "pH" && (valor < PH_MIN || valor > PH_MAX)) return "pH fora da escala — use um valor de 0 a 14.";
  if (slot.valor.nome === "Cloro" && valor < 0) return "O cloro não pode ser negativo.";
  return null;
}

/** "25/08 14:03" a partir de "2026-08-25T14:03:12". */
export function textoCaptura(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

export interface ContextoColetaFotos {
  unidadeCloro?: UnidadeCloro;
  limiteCloro?: number;
  /** Período do agendamento de execução ativo (um dia só quando sem fim). */
  periodo?: Periodo | null;
}

/** Mensagens por vaga ("agua_antes_cloro", "limpeza_durante"…), além de
 *  "limpeza_confirmada", "agua_depois" e "repetidas". */
export function validarColetaFotos(reg: RegistroFotosExecucao | null | undefined, ctx: ContextoColetaFotos = {}): ResultadoValidacao {
  const r = novoResultado();
  if (!reg) return r;
  const unidade = ctx.unidadeCloro || UNIDADE_CLORO_PADRAO;
  const limite = ctx.limiteCloro && ctx.limiteCloro > 0 ? ctx.limiteCloro : CLORO_LIMITE_AVISO_PADRAO;

  for (const secao of SECOES_FOTOS) {
    for (const slot of secao.slots) {
      const v = valorDoSlot(reg, slot.id);
      const e = erroValorColeta(slot, v);
      if (e) addErro(r, slot.id, e);
      else if (slot.valor?.nome === "Cloro" && v != null && v > limite) {
        addAviso(r, slot.id, `${numeroBr(v)} ${unidade} está acima do limite de aviso do procedimento (${numeroBr(limite)} ${unidade}) — confira o valor.`);
      }
      // Data da câmera fora do período da execução
      if (ctx.periodo) {
        const fora = fotosDoSlot(reg, slot.id)
          .map((f) => f.capturada_em || "")
          .filter((c) => /^\d{4}-\d{2}-\d{2}/.test(c) && (c.slice(0, 10) < ctx.periodo!.inicio || c.slice(0, 10) > ctx.periodo!.fim));
        if (fora.length) {
          addAviso(r, slot.id, `${fora.length === 1 ? "Foto tirada" : `${fora.length} fotos tiradas`} em ${fora.map(textoCaptura).join(", ")} (data da câmera), fora do período da execução (${textoPeriodoLongo(ctx.periodo)}).`);
        }
      }
    }
  }

  // A mesma foto em duas vagas (registro antigo ou envio simultâneo)
  const vistos = new Map<string, string>();
  for (const id of Object.keys(reg.itens || {})) {
    const def = slotPorId(id);
    if (!def) continue;
    for (const f of fotosDoSlot(reg, id)) {
      if (!f.hash) continue;
      const onde = `${def.secao.titulo} — ${def.slot.rotulo}`;
      if (vistos.has(f.hash)) addErro(r, id, `A mesma foto já está em “${vistos.get(f.hash)}”. Remova uma das duas.`);
      else vistos.set(f.hash, onde);
    }
  }

  // pH e cloro ANTES idênticos aos DEPOIS
  if (reg.agua_antes && reg.agua_depois) {
    const [pa, ca, pd, cd] = ["agua_antes_ph", "agua_antes_cloro", "agua_depois_ph", "agua_depois_cloro"].map((id) => valorDoSlot(reg, id));
    if (pa != null && ca != null && pa === pd && ca === cd) {
      addAviso(r, "agua_depois", `pH e cloro DEPOIS da limpeza são idênticos aos de ANTES (pH ${numeroBr(pa)}, cloro ${numeroBr(ca)} ${unidade}) — confira se não foram copiados.`);
    }
  }

  // Limpeza confirmada com fotos de menos
  if (reg.limpeza_confirmada) {
    const faltam = SECOES_FOTOS.find((s) => s.id === "limpeza")!.slots
      .map((s) => ({ s, n: fotosDoSlot(reg, s.id).length }))
      .filter((x) => x.n < (x.s.minimo || MINIMO_FOTOS_LIMPEZA));
    if (faltam.length) {
      addAviso(r, "limpeza_confirmada", `Limpeza confirmada, mas com menos de ${MINIMO_FOTOS_LIMPEZA} fotos em: ${faltam.map((x) => `${x.s.rotulo.split(" — ")[0]} (${x.n})`).join(", ")}.`);
    }
  }
  return r;
}
