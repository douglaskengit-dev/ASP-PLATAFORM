// Gera lib/assistente/manual.ts (a base de conhecimento do Robô ASP) a partir
// do manual do usuário em Word. Rode sempre que o manual mudar: o robô passa a
// responder pelo texto novo e as respostas guardadas antigas deixam de valer
// (a versão do cache muda junto).
//
// Uso: npm run manual:robo -- "caminho\para\Manual-do-Usuario-Plataforma-ASP.docx"
//  (ou node scripts/gerar-manual-assistente.js caminho\para\manual.docx)

const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");

const DESTINO = path.join(__dirname, "..", "lib", "assistente", "manual.ts");
/** Acima disso o manual já não cabe bem no contexto da IA (o Cloudflare manda
 *  só os trechos ligados à pergunta; a Anthropic manda tudo). */
const LIMITE_AVISO = 60000;

/** HTML simples do mammoth → Markdown que a busca do robô entende
 *  (seções "## " e "### ", listas "- ", negrito). */
function paraMarkdown(html) {
  const texto = (s) => s
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<(strong|b)>(.*?)<\/\1>/g, "**$2**")
    .replace(/<(em|i)>(.*?)<\/\1>/g, "$2")
    .replace(/<a [^>]*>(.*?)<\/a>/g, "$1")
    .replace(/<img[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  const linhas = [];
  const blocos = html.match(/<(h[1-6]|p|li|tr)[^>]*>[\s\S]*?<\/\1>/g) || [];
  for (const b of blocos) {
    const tag = b.match(/^<(\w+)/)[1];
    if (tag === "tr") {
      const celulas = (b.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(texto).filter(Boolean);
      if (celulas.length) linhas.push(`- ${celulas.join(" — ")}`);
      continue;
    }
    const t = texto(b);
    if (!t) continue;
    if (/^h[1-6]$/.test(tag)) {
      // Título 1 do Word = capítulo ("## "), Título 2+ = subseção ("### ")
      const nivel = Math.min(3, Number(tag[1]) + 1);
      linhas.push("", `${"#".repeat(nivel)} ${t.replace(/\*\*/g, "")}`, "");
    } else if (tag === "li") {
      linhas.push(`- ${t}`);
    } else {
      linhas.push("", t, "");
    }
  }
  // capa e sumário (linhas "Título 12") ficam antes do primeiro capítulo
  const primeiro = linhas.findIndex((l) => l.startsWith("## "));
  const corpo = primeiro > 0 ? linhas.slice(primeiro) : linhas;
  return ["# Manual do Usuário — Plataforma ASP", "", ...corpo].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  const origem = process.argv[2];
  if (!origem) {
    console.error('Informe o arquivo do manual: npm run manual:robo -- "Manual-do-Usuario-Plataforma-ASP.docx"');
    process.exit(1);
  }
  const caminho = path.resolve(process.cwd(), origem);
  if (!fs.existsSync(caminho)) {
    console.error(`Arquivo não encontrado: ${caminho}`);
    process.exit(1);
  }
  // tabelas viram linhas; células mescladas e tabelas aninhadas ficam como estão
  const { value: html, messages } = await mammoth.convertToHtml({ path: caminho });
  const avisos = messages.filter((m) => m.type === "error");
  if (avisos.length) console.warn(`Avisos do Word (${avisos.length}):`, avisos.slice(0, 3).map((m) => m.message).join(" | "));

  const md = paraMarkdown(html);
  const secoes = (md.match(/^#{2,3} /gm) || []).length;
  if (secoes < 3) {
    console.error(`Só ${secoes} títulos encontrados: use os estilos "Título 1/2/3" do Word nos capítulos, senão o robô não acha as seções.`);
    process.exit(1);
  }
  const bs = "\\";
  const escapado = md.replace(/\\/g, bs + bs).replace(/`/g, bs + "`").replace(/\$\{/g, bs + "${");
  const saida = "/** Manual do usuário da Plataforma ASP — gerado por scripts/gerar-manual-assistente.js\n"
    + ` *  a partir de ${path.basename(caminho)}. Base de conhecimento do assistente: não edite à\n`
    + " *  mão; rode `npm run manual:robo -- <manual.docx>` quando o manual mudar. */\n"
    + "export const MANUAL_USUARIO = `" + escapado + "\n`;\n";
  fs.writeFileSync(DESTINO, saida, "utf8");
  console.log(`manual.ts gerado: ${md.length.toLocaleString("pt-BR")} caracteres, ${secoes} seções.`);
  if (md.length > LIMITE_AVISO) console.warn(`Atenção: passou de ${LIMITE_AVISO.toLocaleString("pt-BR")} caracteres — o robô pode ficar mais lento.`);
}

main().catch((e) => {
  console.error("Falha ao gerar o manual do robô:", e.message || e);
  process.exit(1);
});
