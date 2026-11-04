/**
 * Gera as miniaturas das fotos da coleta de execução enviadas ANTES de o
 * aparelho passar a criá-las (PR #97). A tela da OS mostra a miniatura em vez
 * da foto inteira — cada foto inteira passa pela function da Vercel.
 *
 * Mesmo formato que o aparelho grava: JPEG ~360 px (lado maior), qualidade
 * 70, ao lado da foto como "<foto>.mini.jpg" (caminhoMiniatura em
 * lib/asp/fotos-execucao.ts), e o caminho anotado em `mini` no registro.
 *
 * Uso (na pasta do projeto, com .env.local):
 *   npm run miniaturas:coleta              → só mostra o que faria
 *   npm run miniaturas:coleta -- --aplicar → gera e grava
 *   ... -- --os <id-da-inspeção>           → só aquela OS
 *
 * Pode rodar de novo: foto que já tem miniatura é pulada. O registro é
 * gravado com a mesma trava da rota (atualizado_em): se alguém mexer na
 * coleta no meio, relê e tenta de novo.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");

const BUCKET = "gp-arquivos";
const TABELA = "gp_fotos_execucao";
const LADO_MAX = 360;
const QUALIDADE = 70;

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const soOs = args.includes("--os") ? args[args.indexOf("--os") + 1] : null;

function lerEnv() {
  const arq = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(arq)) return;
  for (const linha of fs.readFileSync(arq, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const caminhoMiniatura = (caminho) => caminho.replace(/\.[a-z0-9]+$/i, "") + ".mini.jpg";

/** Fotos sem miniatura de um registro: { slot, caminho }. */
function semMiniatura(itens) {
  const lista = [];
  for (const [slot, v] of Object.entries(itens || {})) {
    const fotos = Array.isArray(v) ? v : v && v.caminho ? [v] : [];
    for (const f of fotos) if (f && f.caminho && !f.mini) lista.push({ slot, caminho: f.caminho });
  }
  return lista;
}

/** Anota `mini` nas fotos que ganharam miniatura (por caminho). */
function comMiniaturas(itens, feitas) {
  const novo = {};
  for (const [slot, v] of Object.entries(itens || {})) {
    if (Array.isArray(v)) novo[slot] = v.map((f) => (f && feitas.has(f.caminho) && !f.mini ? { ...f, mini: feitas.get(f.caminho) } : f));
    else if (v && v.caminho && feitas.has(v.caminho) && !v.mini) novo[slot] = { ...v, mini: feitas.get(v.caminho) };
    else novo[slot] = v;
  }
  return novo;
}

async function main() {
  lerEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !chave) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY no .env.local.");
  const supa = createClient(url, chave, { auth: { persistSession: false } });

  let consulta = supa.from(TABELA).select("id, inspecao_id, itens, atualizado_em");
  if (soOs) consulta = consulta.eq("inspecao_id", soOs);
  const { data: registros, error } = await consulta;
  if (error) throw new Error(error.message);

  console.log(aplicar ? "Gerando e gravando miniaturas…" : "SIMULAÇÃO (nada é gravado; use --aplicar para gravar)");
  let total = 0, feitasTotal = 0, bytesFotos = 0, bytesMinis = 0;
  const falhas = [];

  for (const reg of registros || []) {
    const pendentes = semMiniatura(reg.itens);
    if (pendentes.length === 0) continue;
    total += pendentes.length;
    const feitas = new Map();
    for (const p of pendentes) {
      const { data: blob, error: e1 } = await supa.storage.from(BUCKET).download(p.caminho);
      if (e1 || !blob) { falhas.push(`${p.caminho}: não baixou (${e1?.message || "vazio"})`); continue; }
      const original = Buffer.from(await blob.arrayBuffer());
      let mini;
      try {
        mini = await sharp(original).rotate()   // aplica a orientação EXIF, como o navegador
          .resize(LADO_MAX, LADO_MAX, { fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: QUALIDADE, mozjpeg: true })
          .toBuffer();
      } catch (e) {
        falhas.push(`${p.caminho}: não deu para reduzir (${e.message})`);
        continue;
      }
      bytesFotos += original.length;
      bytesMinis += mini.length;
      const destino = caminhoMiniatura(p.caminho);
      if (aplicar) {
        const { error: e2 } = await supa.storage.from(BUCKET).upload(destino, mini, { contentType: "image/jpeg", upsert: true });
        if (e2) { falhas.push(`${destino}: não gravou (${e2.message})`); continue; }
      }
      feitas.set(p.caminho, destino);
    }
    if (feitas.size === 0) continue;

    if (aplicar) {
      // mesma trava da rota: grava só se ninguém mexeu desde a leitura
      let atual = reg, ok = false;
      for (let tentativa = 0; tentativa < 5 && !ok; tentativa++) {
        const { data, error: e3 } = await supa.from(TABELA)
          .update({ itens: comMiniaturas(atual.itens, feitas), atualizado_em: new Date().toISOString() })
          .eq("id", atual.id).eq("atualizado_em", atual.atualizado_em)
          .select("id").maybeSingle();
        if (e3) { falhas.push(`OS ${reg.inspecao_id}: registro não gravou (${e3.message})`); break; }
        if (data) { ok = true; break; }
        const { data: relido } = await supa.from(TABELA).select("id, inspecao_id, itens, atualizado_em").eq("id", reg.id).maybeSingle();
        if (!relido) break;
        atual = relido;
      }
      if (!ok) { falhas.push(`OS ${reg.inspecao_id}: registro alterado por outra pessoa — rode de novo`); continue; }
    }
    feitasTotal += feitas.size;
    console.log(`OS ${reg.inspecao_id}: ${feitas.size} de ${pendentes.length} foto(s)`);
  }

  const mb = (b) => (b / 1024 / 1024).toFixed(1);
  console.log("");
  console.log(`Fotos sem miniatura: ${total}. ${aplicar ? "Miniaturas gravadas" : "Miniaturas que seriam gravadas"}: ${feitasTotal}.`);
  console.log(`Tamanho: fotos inteiras ${mb(bytesFotos)} MB → miniaturas ${mb(bytesMinis)} MB (a cada vez que todas aparecem na tela).`);
  if (falhas.length) { console.log(`\n${falhas.length} falha(s):`); falhas.forEach((f) => console.log(" - " + f)); }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
