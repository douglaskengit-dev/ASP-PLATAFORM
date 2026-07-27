/** Fila de escritas offline (IndexedDB puro, sem dependência).
 * Guarda as ações feitas sem conexão (coleta, agendamento, fase, relatório)
 * para reenviar quando a rede voltar. Ver lib/pwa/sync.ts. */

const DB = "asp-offline";
const STORE = "fila";

export interface ArquivoFila {
  nome: string;
  tipo: string;
  campos: Record<string, string>;
  base64: string;
}
export interface ItemFila {
  id?: number;
  url: string;
  method: string;
  descricao: string;
  jsonBody?: unknown;
  arquivo?: ArquivoFila;
  criadoEm: number;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function adicionar(item: ItemFila): Promise<void> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function listar(): Promise<ItemFila[]> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve((req.result as ItemFila[]).sort((a, b) => (a.id || 0) - (b.id || 0))); };
    req.onerror = () => reject(req.error);
  });
}

export async function remover(id: number): Promise<void> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function contar(): Promise<number> {
  try {
    const db = await abrir();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}
