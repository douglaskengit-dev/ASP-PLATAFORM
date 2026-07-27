/** Pré-carregamento (prefetch) para garantir leitura offline. Ao abrir o app
 * com rede, busca em segundo plano os projetos em aberto e suas inspeções —
 * cada GET popula o cache do service worker (Fase 1), então depois eles abrem
 * mesmo sem sinal. É throttled para não rodar toda hora. */

const CHAVE_ULTIMO = "asp:prefetch";
const INTERVALO_MS = 5 * 60 * 1000; // no máximo a cada 5 min

async function pausa(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function prefetchDados(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  try {
    const ultimo = Number(sessionStorage.getItem(CHAVE_ULTIMO) || 0);
    if (Date.now() - ultimo < INTERVALO_MS) return;
    sessionStorage.setItem(CHAVE_ULTIMO, String(Date.now()));
  } catch {
    // sessionStorage indisponível — segue mesmo assim
  }

  try {
    const r = await fetch("/api/projetos");
    if (!r.ok) return; // não logado ou offline
    const d = await r.json();
    const projetos: any[] = d.projetos || [];

    // Dados auxiliares para o calendário/agenda.
    fetch("/api/agendamentos").catch(() => {});

    for (const p of projetos) {
      const insp: any[] = p.inspecoes || [];
      const encerrado = insp.length > 0 && insp.every((i) => i.fase >= 10);
      if (encerrado) continue; // não gasta banda com projeto concluído

      try {
        const rp = await fetch(`/api/projetos/${p.id}`);
        if (!rp.ok) continue;
        const dp = await rp.json();
        for (const i of dp.inspecoes || []) {
          fetch(`/api/inspecoes/${i.id}`).catch(() => {});
          await pausa(60); // suaviza a rajada de requisições
        }
      } catch {
        // ignora falhas pontuais
      }
    }
  } catch {
    // offline ou erro — sem problema, tenta na próxima abertura
  }
}
