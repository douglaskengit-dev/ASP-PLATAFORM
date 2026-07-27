/** Camada de sincronização offline. As telas chamam `enviarJson` /
 * `enviarArquivo` no lugar do fetch para escritas: se estiver online, envia
 * normal; se a rede falhar (offline), enfileira em IndexedDB e sincroniza
 * depois (evento `online` ou botão manual). Só entra na fila em falha de REDE
 * — erros do servidor (400/403/500) voltam normalmente para a tela. */
import { adicionar, listar, remover, contar, ItemFila } from "./fila";

export interface ResultadoEnvio {
  ok: boolean;
  queued: boolean;
  status?: number;
  data?: any;
}

export function estaOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function avisar() {
  if (typeof window !== "undefined") {
    contar().then((n) => window.dispatchEvent(new CustomEvent("asp:fila", { detail: { pendentes: n } })));
  }
}

async function fileParaBase64(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ParaBlob(b64: string, tipo: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: tipo || "application/octet-stream" });
}

/** Envia um JSON (POST/PATCH/DELETE). Enfileira se estiver offline. */
export async function enviarJson(url: string, method: string, body: unknown, descricao: string): Promise<ResultadoEnvio> {
  if (estaOnline()) {
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, queued: false, status: r.status, data };
    } catch {
      // falha de rede → cai para a fila
    }
  }
  await adicionar({ url, method, jsonBody: body, descricao, criadoEm: Date.now() });
  avisar();
  return { ok: true, queued: true };
}

/** Envia um arquivo (multipart POST) + campos. Enfileira se estiver offline. */
export async function enviarArquivo(url: string, campos: Record<string, string>, arquivo: File, descricao: string): Promise<ResultadoEnvio> {
  if (estaOnline()) {
    try {
      const fd = new FormData();
      Object.entries(campos).forEach(([k, v]) => fd.append(k, v));
      fd.append("arquivo", arquivo);
      const r = await fetch(url, { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, queued: false, status: r.status, data };
    } catch {
      // offline → fila
    }
  }
  const base64 = await fileParaBase64(arquivo);
  await adicionar({ url, method: "POST", descricao, criadoEm: Date.now(), arquivo: { nome: arquivo.name, tipo: arquivo.type, campos, base64 } });
  avisar();
  return { ok: true, queued: true };
}

let sincronizando = false;

/** Reenvia a fila em ordem. Remove itens que deram certo ou que falharam por
 * erro definitivo do cliente (4xx). Para em erro de servidor/rede para tentar
 * de novo mais tarde. */
export async function sincronizar(): Promise<number> {
  if (sincronizando || !estaOnline()) return contar();
  sincronizando = true;
  try {
    const itens = await listar();
    for (const it of itens) {
      try {
        let resp: Response;
        if (it.arquivo) {
          const fd = new FormData();
          Object.entries(it.arquivo.campos).forEach(([k, v]) => fd.append(k, v));
          const blob = base64ParaBlob(it.arquivo.base64, it.arquivo.tipo);
          fd.append("arquivo", new File([blob], it.arquivo.nome, { type: it.arquivo.tipo }));
          resp = await fetch(it.url, { method: "POST", body: fd });
        } else {
          resp = await fetch(it.url, { method: it.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(it.jsonBody) });
        }
        if (resp.ok || (resp.status >= 400 && resp.status < 500)) {
          if (it.id != null) await remover(it.id); // sucesso, ou erro definitivo (não adianta insistir)
        } else {
          break; // 5xx: servidor instável, tenta depois
        }
      } catch {
        break; // rede caiu no meio da sincronização
      }
    }
  } finally {
    sincronizando = false;
    avisar();
  }
  return contar();
}

export async function pendentes(): Promise<number> {
  return contar();
}

/** Liga os gatilhos automáticos (chamar uma vez no cliente). */
export function iniciarSync() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => { sincronizar(); });
  // tenta assim que o app abre
  sincronizar();
}
