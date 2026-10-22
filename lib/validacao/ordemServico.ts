/** Regras da Ordem de Serviço (OS = registro gp_inspecoes, um por tanque/
 * ponto do projeto) — criação e edição. Puras: o formulário chama com o que
 * já tem na tela; a API (lib/asp/os-validacao-api.ts) com o que leu do banco.
 *
 *   ⛔ identificação obrigatória e única no projeto entre as OSs ativas,
 *      comparada sem acento/caixa/espaço/hífen/sublinhado/ponto ("TQ-01" =
 *      "tq 01" = "TQ01") · procedimento obrigatório (do Catálogo) · tanque
 *   ⚠️ mesma identificação de uma OS na lixeira do projeto (restaurar em vez
 *      de criar outra) · outra OS com o tanque idêntico (formato e medidas)
 *      e identificação parecida — possível duplicata */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { nomesParecidos, normalizarTexto, removerAcentos, semPontuacao } from "./texto";
import { erroDoTanque, normalizarTanque } from "../asp/tanque";

export interface OSRef {
  id: string;
  identificacao: string;
  tanque?: unknown;
  /** Está na lixeira. */
  excluido?: boolean;
}

export interface DadosOS {
  identificacao?: string | null;
  procedimento?: string | null;
  /** undefined = não está sendo validado (ex.: só renomeando). */
  tanque?: unknown;
}

export interface ContextoOS {
  /** OS em edição — fica fora das checagens de duplicidade. */
  excluirId?: string | null;
  /** OSs do projeto, ativas e da lixeira (`excluido`). */
  ordens?: OSRef[];
  /** Códigos do Catálogo (ativos e desativados). undefined = não checado. */
  procedimentos?: string[];
  /** Códigos desativados no Catálogo: não podem ser escolhidos numa OS nova
   *  nem numa troca — só ficam aceitos como o procedimento ATUAL da OS. */
  procedimentosInativos?: string[];
  /** Procedimento que a OS já tem (edição). */
  procedimentoAtual?: string | null;
  /** false = procedimento não é exigido (edição só do nome). */
  exigirProcedimento?: boolean;
}

export const ROTULOS_OS: Record<string, string> = {
  identificacao: "Identificação",
  procedimento: "Procedimento",
  tanque: "Tanque",
};

export const MAX_IDENTIFICACAO_OS = 160;

/** Identificação para comparação: sem acento e caixa, e sem espaço, hífen,
 * sublinhado e ponto — "TQ-01", "tq 01", "TQ_01" e "T.Q.01" são a mesma OS. */
export function normalizarIdentificacaoOS(s: string | null | undefined): string {
  return removerAcentos(s || "").toLowerCase().replace(/[\s\-_.]+/g, "");
}

/** OS com a mesma identificação normalizada (fora a própria), ativas ou da
 * lixeira conforme `lixeira`. */
export function identificacaoRepetida(
  identificacao: string | null | undefined,
  ctx: Pick<ContextoOS, "ordens" | "excluirId">,
  lixeira = false
): OSRef | null {
  const n = normalizarIdentificacaoOS(identificacao);
  if (!n) return null;
  return (ctx.ordens || []).find((o) =>
    o.id !== ctx.excluirId && !!o.excluido === lixeira && normalizarIdentificacaoOS(o.identificacao) === n
  ) || null;
}

/** Os dois cadastros de tanque completos e com o mesmo formato e medidas
 * (diâmetro ou comprimento × largura, e altura). Capacidade e material não
 * entram — são dado de placa, podem ter sido digitados diferentes. */
export function mesmoTanque(a: unknown, b: unknown): boolean {
  if (!a || !b || erroDoTanque(a) || erroDoTanque(b)) return false;
  const ta = normalizarTanque(a);
  const tb = normalizarTanque(b);
  const igual = (x?: number | null, y?: number | null) => Math.abs((x ?? 0) - (y ?? 0)) < 0.0005;
  return ta.formato === tb.formato && igual(ta.diametro, tb.diametro) && igual(ta.comprimento, tb.comprimento)
    && igual(ta.largura, tb.largura) && igual(ta.altura, tb.altura);
}

/** Números da identificação, sem zero à esquerda ("TQ-01 A2" → "1,2"). */
function numerosDe(s: string): string {
  return (s.match(/\d+/g) || []).map((n) => String(Number(n))).join(",");
}

/** Identificações parecidas: mesmo critério de nomesParecidos (palavras
 * contidas / erro de digitação), mas números diferentes nunca são parecidos
 * — "Tanque TQ-01" e "Tanque TQ-02" são tanques irmãos, não duplicata. */
export function identificacoesParecidas(a: string | null | undefined, b: string | null | undefined): boolean {
  if (numerosDe(a || "") !== numerosDe(b || "")) return false;
  return nomesParecidos(a, b, (s) => semPontuacao(normalizarTexto(s)).toLowerCase());
}

/** OSs ativas com o tanque idêntico e identificação parecida (mas não igual
 * — a igual já é erro). */
export function osParecidas(d: DadosOS, ctx: Pick<ContextoOS, "ordens" | "excluirId">): OSRef[] {
  if (d.tanque === undefined) return [];
  const n = normalizarIdentificacaoOS(d.identificacao);
  if (!n) return [];
  return (ctx.ordens || []).filter((o) =>
    o.id !== ctx.excluirId && !o.excluido && normalizarIdentificacaoOS(o.identificacao) !== n
    && mesmoTanque(d.tanque, o.tanque) && identificacoesParecidas(d.identificacao, o.identificacao)
  );
}

export function validarOS(d: DadosOS, ctx: ContextoOS = {}): ResultadoValidacao {
  const r = novoResultado();

  const ident = (d.identificacao || "").trim();
  if (!normalizarIdentificacaoOS(ident)) {
    addErro(r, "identificacao", "Informe a identificação (ex.: Tanque TQ-01).");
  } else if (ident.length > MAX_IDENTIFICACAO_OS) {
    addErro(r, "identificacao", `Identificação muito longa (máx. ${MAX_IDENTIFICACAO_OS} caracteres).`);
  } else {
    const ativa = identificacaoRepetida(ident, ctx);
    if (ativa) {
      addErro(r, "identificacao", `Já existe a OS “${ativa.identificacao}” neste projeto. A identificação não pode se repetir.`);
    } else {
      const naLixeira = identificacaoRepetida(ident, ctx, true);
      if (naLixeira) {
        addAviso(r, "identificacao", `A OS “${naLixeira.identificacao}” está na lixeira deste projeto — restaure-a em vez de criar outra.`);
      }
    }
    osParecidas(d, ctx).forEach((o) =>
      addAviso(r, "identificacao", `Possível duplicata: a OS “${o.identificacao}” tem o mesmo tanque (formato e medidas).`)
    );
  }

  if (ctx.exigirProcedimento !== false) {
    const proc = (d.procedimento || "").trim();
    if (!proc) addErro(r, "procedimento", "Escolha o procedimento (Catálogo).");
    else if (ctx.procedimentos && !ctx.procedimentos.includes(proc)) {
      addErro(r, "procedimento", `“${proc}” não está no Catálogo.`);
    } else if ((ctx.procedimentosInativos || []).includes(proc) && proc !== (ctx.procedimentoAtual || "").trim()) {
      addErro(r, "procedimento", `“${proc}” está desativado no Catálogo — escolha outro procedimento.`);
    }
  }

  if (d.tanque !== undefined) {
    const problema = erroDoTanque(d.tanque);
    if (problema) addErro(r, "tanque", problema);
  }
  return r;
}
