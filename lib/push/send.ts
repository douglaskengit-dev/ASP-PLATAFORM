/** ASP PWA Fase 3 — envio de notificações Web Push (VAPID).
 *
 * O servidor assina cada push com a chave VAPID privada. As assinaturas dos
 * navegadores ficam em gp_push_subscriptions. Assinaturas expiradas/removidas
 * (404/410) são apagadas automaticamente.
 *
 * Variáveis de ambiente necessárias (Vercel):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  — chave pública (também usada no cliente)
 *   VAPID_PRIVATE_KEY             — chave privada (somente servidor)
 *   VAPID_SUBJECT                 — "mailto:voce@dominio" (opcional; tem padrão)
 */
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/server";

let configurado = false;

/** Configura o web-push uma vez. Retorna false se faltarem as chaves. */
function garantirConfig(): boolean {
  if (configurado) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  const subject = process.env.VAPID_SUBJECT || "mailto:contato@aspeng.com.br";
  webpush.setVapidDetails(subject, pub, priv);
  configurado = true;
  return true;
}

export interface PushPayload {
  titulo: string;
  mensagem?: string;
  link?: string;
}

/** Envia um push para todos os dispositivos inscritos dos usuários dados.
 *  Não lança: registra falhas e remove assinaturas expiradas. */
export async function enviarPushParaUsuarios(
  usuarioIds: string[],
  payload: PushPayload
): Promise<{ enviados: number; removidos: number; semConfig?: boolean }> {
  const ids = Array.from(new Set(usuarioIds.filter(Boolean)));
  if (ids.length === 0) return { enviados: 0, removidos: 0 };
  if (!garantirConfig()) return { enviados: 0, removidos: 0, semConfig: true };

  const admin = getSupabaseAdmin();
  const { data: subs } = await admin
    .from("gp_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("usuario_id", ids);

  if (!subs || subs.length === 0) return { enviados: 0, removidos: 0 };

  const body = JSON.stringify({
    titulo: payload.titulo,
    mensagem: payload.mensagem || "",
    link: payload.link || "/dashboard",
  });

  let enviados = 0;
  const expirados: string[] = [];

  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body
        );
        enviados++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) expirados.push(s.id);
      }
    })
  );

  if (expirados.length > 0) {
    await admin.from("gp_push_subscriptions").delete().in("id", expirados);
  }
  return { enviados, removidos: expirados.length };
}
