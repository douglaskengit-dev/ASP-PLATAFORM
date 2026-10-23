/** Permissões do fluxo ASP que não cabem só no perfil (área).
 *
 * Duas fontes, somadas:
 *   - o PERFIL (área): regras fixas abaixo (Admin/Gerência/Comercial/Operações);
 *   - a FUNÇÃO do usuário: as marcas da linha de gp_funcoes, que o
 *     administrador edita em "Permissões por função".
 * A função só acrescenta direitos. No servidor, getProfileAtual() já traz
 * `permissoesFuncao`; na tela, carregarPermissoesFuncao() (lib/asp/funcoes).
 * Sem `permissoesFuncao` a função NÃO dá direito nenhum (falha fechada) —
 * a API sempre confere de novo. */
import type { ChavePermissaoFuncao, PermissoesFuncao } from "@/lib/validacao/funcao";

export interface PerfilLike {
  perfil?: string | null;
  funcao?: string | null;
  /** Marcas da função do usuário (gp_funcoes). */
  permissoesFuncao?: Partial<PermissoesFuncao> | null;
}

/** A função do usuário tem a marca? */
export function funcaoPermite(profile: PerfilLike | null | undefined, chave: ChavePermissaoFuncao): boolean {
  return !!profile?.funcao && !!profile.permissoesFuncao?.[chave];
}

/** Perfis que já têm cada direito, independentemente da função. */
export const PERFIS_COM_DIREITO: Record<Exclude<ChavePermissaoFuncao, "lideranca_equipe">, readonly string[]> = {
  pode_excluir_projetos: ["admin", "comercial", "gerencia"],
  pode_aprovar_medicao: ["admin", "gerencia"],
  pode_editar_revisao: ["admin", "gerencia"],
  // Registro em campo: os mesmos perfis de PERFIS_COLETA (lib/asp/coleta-api),
  // PERFIS da coleta de fotos e PERFIS_RDO (lib/asp/rdo-api) — que continuam
  // valendo sozinhos para EXCLUIR/RESTAURAR coleta e RDO.
  pode_registrar_medicao: ["admin", "operacoes", "gerencia"],
  pode_registrar_fotos: ["admin", "operacoes", "gerencia"],
  pode_preparar_rdo: ["admin", "operacoes", "gerencia"],
};

function porPerfil(profile: PerfilLike, chave: keyof typeof PERFIS_COM_DIREITO): boolean {
  return PERFIS_COM_DIREITO[chave].includes(profile.perfil || "");
}

/** Excluir/restaurar projeto, OS e cliente (lixeira): Comercial, Gerência,
 * Admin (por área) ou a função com "Excluir projetos/OS". */
export function podeExcluirProjeto(profile: PerfilLike | null): boolean {
  if (!profile) return false;
  return porPerfil(profile, "pode_excluir_projetos") || funcaoPermite(profile, "pode_excluir_projetos");
}

/** Aprovar a medição que vale para o relatório: Gerência e Admin (por área)
 * ou a função com "Aprovar medição". Quem mede não necessariamente valida. */
export function podeAprovarColeta(profile: PerfilLike | null): boolean {
  if (!profile) return false;
  return porPerfil(profile, "pode_aprovar_medicao") || funcaoPermite(profile, "pode_aprovar_medicao");
}

/** Corrigir à mão a Revisão e o Código do relatório (capa), que o sistema
 * calcula sozinho: Admin e Gerência (por área) ou a função com "Editar
 * revisão/código". Os demais veem os campos travados — a API recusa valor
 * mudado. */
export function podeEditarRevisao(profile: PerfilLike | null): boolean {
  if (!profile) return false;
  return porPerfil(profile, "pode_editar_revisao") || funcaoPermite(profile, "pode_editar_revisao");
}

// ── Registro em campo (Técnico/Auxiliar acrescentam dados na execução) ──────
// Valem para CRIAR e EDITAR. Não dão: aprovar a medição, ações de fase,
// excluir/restaurar coleta ou RDO (lixeira), relatórios, agendamentos,
// checklist, tanque/procedimento — essas seguem as regras de antes.

/** Registrar medições / batimetria: criar e editar coletas (medidor,
 * digitar, importar, anexar PDF; data e responsável ao salvar). Admin,
 * Gerência e Operações (por área) ou a função com "Registrar medições". */
export function podeRegistrarMedicao(profile: PerfilLike | null): boolean {
  if (!profile) return false;
  return porPerfil(profile, "pode_registrar_medicao") || funcaoPermite(profile, "pode_registrar_medicao");
}

/** Registrar a coleta de fotos da execução: enviar/trocar/remover foto de
 * uma vaga, valores de pH/cloro e as caixinhas (água antes/depois, limpeza
 * confirmada). Admin, Gerência e Operações ou a função com "Registrar
 * coleta de fotos". */
export function podeRegistrarFotos(profile: PerfilLike | null): boolean {
  if (!profile) return false;
  return porPerfil(profile, "pode_registrar_fotos") || funcaoPermite(profile, "pode_registrar_fotos");
}

/** Preparar RDO: criar/editar o RDO e gerar/enviar o .docx. Admin, Gerência
 * e Operações ou a função com "Preparar RDO". */
export function podePrepararRdo(profile: PerfilLike | null): boolean {
  if (!profile) return false;
  return porPerfil(profile, "pode_preparar_rdo") || funcaoPermite(profile, "pode_preparar_rdo");
}
