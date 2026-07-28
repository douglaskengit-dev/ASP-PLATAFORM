/** ASP PWA Fase 3 — cliente de notificações push (Web Push / VAPID).
 *  Pede permissão, inscreve via PushManager e registra a assinatura no servidor.
 *  A chave pública vem de NEXT_PUBLIC_VAPID_PUBLIC_KEY (embutida no build). */

export type EstadoPush = "indisponivel" | "sem-chave" | "negado" | "ativo" | "inativo";

export function pushSuportado(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function estadoPush(): Promise<EstadoPush> {
  if (!pushSuportado()) return "indisponivel";
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return "sem-chave";
  if (Notification.permission === "denied") return "negado";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? "ativo" : "inativo";
}

export async function ativarPush(): Promise<{ ok: boolean; motivo?: string }> {
  if (!pushSuportado()) return { ok: false, motivo: "Este navegador não suporta notificações push." };
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!pub) return { ok: false, motivo: "Notificações push ainda não configuradas no servidor." };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, motivo: "Permissão de notificação negada." };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(pub) as BufferSource,
    });
  }
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) return { ok: false, motivo: "Falha ao registrar a assinatura no servidor." };
  return { ok: true };
}

export async function desativarPush(): Promise<void> {
  if (!pushSuportado()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}
