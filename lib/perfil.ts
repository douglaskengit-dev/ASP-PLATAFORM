/** D26: cor e rótulo do avatar por tipo de perfil (gp_profiles.perfil).
 * ASP: novos perfis do fluxo de inspeção/execução (comercial/operacoes/
 * gerencia) coexistem com os antigos (editor/visualizador) durante a
 * migração — ver COWORK-ASP.md §2.2. */
export const CORES_PERFIL: Record<string, string> = {
  admin: "#c2410c",
  comercial: "var(--primaria)",
  operacoes: "#0f766e",
  gerencia: "#7c3aed",
  // legado (perfis antigos ainda aceitos pela constraint ampla)
  editor: "var(--primaria)",
  visualizador: "#5a6b7b",
};

export const NOMES_PERFIL: Record<string, string> = {
  admin: "Administrador",
  comercial: "Comercial",
  operacoes: "Operações",
  gerencia: "Gerência",
  editor: "Editor",
  visualizador: "Visualizador",
};

export function corPerfil(tipo: string | null | undefined): string {
  return (tipo && CORES_PERFIL[tipo]) || "#5a6b7b";
}

export function textoAvatarPerfil(tipo: string | null | undefined): string {
  return tipo === "comercial" || tipo === "editor" ? "var(--escuro)" : "#fff";
}
