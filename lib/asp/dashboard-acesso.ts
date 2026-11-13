/** Quem vê cada Dashboard. Admin vê os três; Gerência vê o seu e o de
 * Operações; Operações vê o de Operações; Comercial vê só o seu. As rotas de
 * API conferem pelo perfil; as páginas usam a mesma tabela para as abas. */

export type PainelId = "operacoes" | "gerencia" | "comercial";

export const PAINEIS: { id: PainelId; rotulo: string; href: string }[] = [
  { id: "operacoes", rotulo: "Operações", href: "/dashboard" },
  { id: "gerencia", rotulo: "Gerência", href: "/dashboard/gerencia" },
  { id: "comercial", rotulo: "Comercial", href: "/dashboard/comercial" },
];

const ACESSO: Record<PainelId, string[]> = {
  operacoes: ["admin", "gerencia", "operacoes"],
  gerencia: ["admin", "gerencia"],
  comercial: ["admin", "comercial"],
};

export function podeVerPainel(perfil: string | null | undefined, painel: PainelId): boolean {
  return !!perfil && ACESSO[painel].includes(perfil);
}

/** Dashboards do perfil, na ordem das abas. */
export function paineisDoPerfil(perfil: string | null | undefined): PainelId[] {
  return PAINEIS.filter((p) => podeVerPainel(perfil, p.id)).map((p) => p.id);
}

/** Endereço do primeiro Dashboard que o perfil pode ver (aba "Dashboard"). */
export function hrefDashboard(perfil: string | null | undefined): string {
  const id = paineisDoPerfil(perfil)[0];
  return PAINEIS.find((p) => p.id === id)?.href || "/dashboard";
}

/** Resposta 403 padrão: diz para onde o usuário pode ir. */
export function semAcesso(perfil: string | null | undefined) {
  return {
    erro: "Seu perfil não tem acesso a este Dashboard.",
    destino: paineisDoPerfil(perfil).length ? hrefDashboard(perfil) : null,
  };
}
