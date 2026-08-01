/** Permissões do fluxo ASP que não cabem só no perfil (área). */

export interface PerfilLike {
  perfil?: string | null;
  funcao?: string | null;
}

/** Excluir projeto: Comercial, Gerência, Admin (por área) ou quem tem a
 * Função "Coordenador" (independentemente da área). */
export function podeExcluirProjeto(profile: PerfilLike | null): boolean {
  if (!profile) return false;
  if (["admin", "comercial", "gerencia"].includes(profile.perfil || "")) return true;
  return profile.funcao === "Coordenador";
}

/** Aprovar a medição que vale para o relatório: Gerência e Admin (por área)
 * ou quem tem a Função "Coordenador". Quem mede não necessariamente valida. */
export function podeAprovarColeta(profile: PerfilLike | null): boolean {
  if (!profile) return false;
  if (["admin", "gerencia"].includes(profile.perfil || "")) return true;
  return profile.funcao === "Coordenador";
}
