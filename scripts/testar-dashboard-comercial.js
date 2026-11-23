// Testes do Dashboard Comercial (lib/asp/dashboard-comercial.ts): funil do
// Follow-up (etapas do CRM), ganho/perda, follow-ups, previsão ponderada e
// propostas. Sem banco: monta os dados à mão e confere o painel.
//
// Uso: npm run teste:dashboard   (ou node scripts/testar-dashboard-comercial.js)
//
// O TypeScript é transpilado na hora (typescript.transpileModule), com o
// atalho "@/" apontando para a raiz do projeto, como no tsconfig.

const path = require("path");
const fs = require("fs");
const Module = require("module");
const ts = require("typescript");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const RAIZ = path.resolve(__dirname, "..");
const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (pedido, ...resto) {
  if (pedido.startsWith("@/")) pedido = path.join(RAIZ, pedido.slice(2));
  return resolverOriginal.call(this, pedido, ...resto);
};
for (const ext of [".ts", ".tsx"]) {
  require.extensions[ext] = (mod, arquivo) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(arquivo, "utf8"), {
      fileName: arquivo,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    mod._compile(outputText, arquivo);
  };
}

const { montarComercial } = require(path.join(RAIZ, "lib/asp/dashboard-comercial.ts"));
const { ETAPAS_FLUXO } = require(path.join(RAIZ, "lib/processos/etapas.ts"));

const HOJE = "2026-11-23";
const NOVEMBRO = { periodo: "personalizado", de: "2026-11-01", ate: "2026-11-30", cliente: null, procedimento: null, pessoa: null };
const VAZIO = { oss: [], projetos: [], historico: [], relatorios: [], agendamentos: [], rdos: [], fotos: [], coletas: [], entregas: [], procedimentos: [], orgaos: [] };

/** Troca de etapa no historico_etapas (data informada por quem trocou). */
const passo = (etapa, dia) => ({ etapa, data_autenticacao: dia, alterado_em: `${dia}T12:00:00Z` });
const processo = (id, extra) => ({
  id, titulo: `Oportunidade ${id}`, orgao_id: "c1", orgao_nome: "Cliente 1", etapa: 0, resultado: "aberta",
  created_at: "2026-11-01T12:00:00Z", historico_etapas: [], ...extra,
});

// Cenário do funil (novembro):
//  A: aberta em 02/11; Qualificação 05/11; Proposta 10/11 (segue aberta).
//  B: aberta em 03/11; Qualificação 04/11; Negociação 15/11; ganha 20/11.
//  C: aberta em 05/11; perdida 08/11 ainda em Prospecção.
//  D: aberta em 01/09 (fora do período); Visita técnica desde 10/09 → parada.
const FUNIL = [
  processo("A", { created_at: "2026-11-02T12:00:00Z", etapa: 3, historico_etapas: [passo(1, "2026-11-05"), passo(3, "2026-11-10")] }),
  processo("B", { created_at: "2026-11-03T12:00:00Z", etapa: 4, resultado: "ganha", resultado_em: "2026-11-20", valor: 20000,
    historico_etapas: [passo(1, "2026-11-04"), passo(4, "2026-11-15")] }),
  processo("C", { created_at: "2026-11-05T12:00:00Z", etapa: 0, resultado: "perdida", resultado_em: "2026-11-08", motivo_perda: "preco", valor: 5000 }),
  processo("D", { created_at: "2026-09-01T12:00:00Z", etapa: 2, historico_etapas: [passo(2, "2026-09-10")] }),
];
const painel = (processos, filtros = NOVEMBRO) => montarComercial({ ...VAZIO, processos }, filtros, HOJE, `${HOJE}T15:00:00Z`);

test("as etapas do funil são as do CRM", () => {
  assert.deepEqual(ETAPAS_FLUXO.map((e) => e.nome), ["Prospecção", "Qualificação", "Visita técnica", "Proposta", "Negociação"]);
  assert.equal(painel(FUNIL).funil.length, 5);
});

test("funil: em aberto, alcançaram e conversão por etapa", () => {
  const f = painel(FUNIL).funil;
  // Ativos = em aberto e parados na etapa agora (D conta, mesmo aberta antes do período).
  assert.deepEqual(f.map((e) => e.ativos), [0, 0, 1, 1, 0]);
  // Alcançaram = abertas no período (A, B, C) que chegaram à etapa.
  assert.deepEqual(f.map((e) => e.alcancaram), [3, 2, 2, 2, 1]);
  // Pular etapa conta como passar por ela (A pulou Visita técnica; B pulou Visita e Proposta).
  // Última etapa: "seguinte" = ganhas.
  assert.deepEqual(f.map((e) => e.conversao), [2 / 3, 1, 1, 0.5, 1]);
});

test("funil: tempo mediano e passagens por etapa (saídas dentro do período)", () => {
  const f = painel(FUNIL).funil;
  // Prospecção: A 3 d, B 1 d, C 3 d (até a perda). Qualificação: A 5 d, B 11 d. Negociação: B 5 d (até o ganho).
  assert.deepEqual(f.map((e) => e.passagens), [3, 2, 0, 0, 1]);
  assert.deepEqual(f.map((e) => e.tempoMediano), [3, 8, null, null, 5]);
});

test("funil: parados há mais de 30 dias na etapa", () => {
  const p = painel(FUNIL);
  assert.equal(p.kpis.parados, 1);
  assert.deepEqual(p.parados.map((x) => [x.id, x.etapa, x.dias]), [["D", "Visita técnica", 74]]);
  assert.deepEqual(p.funil.map((e) => e.parados), [0, 0, 1, 0, 0]);
});

test("KPIs do funil, conversão, ganho e motivos de perda", () => {
  const k = painel(FUNIL).kpis;
  assert.deepEqual(k.funil, { ativos: 2, ganhasPeriodo: 1, perdidasPeriodo: 1, criadosPeriodo: 3 });
  assert.deepEqual(k.conversao, { criados: 3, ganhas: 1, taxa: 1 / 3 });
  assert.equal(k.ganho.taxa, 0.5);
  assert.equal(k.ganho.valorGanho, 20000);
  assert.equal(k.ganho.valorPerdido, 5000);
  assert.equal(k.ganho.cicloMediano, 17);   // B: 03/11 → 20/11
  assert.deepEqual(painel(FUNIL).motivosPerda.map((m) => [m.motivo, m.n]), [["preco", 1]]);
});

test("fora do período o funil não conta as oportunidades abertas antes", () => {
  const p = painel(FUNIL, { ...NOVEMBRO, de: "2026-12-01", ate: "2026-12-31" });
  assert.deepEqual(p.funil.map((e) => e.alcancaram), [0, 0, 0, 0, 0]);
  assert.deepEqual(p.funil.map((e) => e.conversao), [null, null, null, null, null]);
  assert.equal(p.kpis.funil.ativos, 2);   // estado atual não depende do período
});

test("follow-ups: atrasada, para hoje e sem próxima ação", () => {
  const p = painel([
    processo("1", { proxima_acao: "Ligar", proxima_acao_em: "2026-11-20", responsavel_id: "u1", responsavel_nome: "Ana" }),
    processo("2", { proxima_acao: "Visitar", proxima_acao_em: HOJE, responsavel_id: "u1", responsavel_nome: "Ana" }),
    processo("3", {}),
    processo("4", { resultado: "ganha", resultado_em: "2026-11-10", proxima_acao_em: "2026-11-01" }),
  ]);
  assert.deepEqual(p.kpis.followups, { abertas: 3, atrasadas: 1, hoje: 1, semAcao: 1 });
  assert.deepEqual(p.followupsAtrasados.map((x) => [x.id, x.dias]), [["1", 3]]);
  assert.deepEqual(p.followupsPorResponsavel.map((r) => [r.nome, r.abertas, r.atrasadas, r.semAcao]), [["Ana", 2, 1, 0], ["Sem responsável", 1, 0, 1]]);
});

test("previsão ponderada: temperatura automática, escolhida e percentual próprio", () => {
  const p = painel([
    processo("F", { etapa: 3, valor: 10000 }),                                     // Proposta → Frio 15%
    processo("M", { etapa: 4, valor: 20000 }),                                     // Negociação → Morno 50%
    processo("Q", { etapa: 2, valor: 5000, temperatura: "quente" }),              // escolhida → Quente 85%
    processo("P", { etapa: 1, valor: 10000, probabilidade: 72 }),                 // percentual próprio 72%
    processo("X", { etapa: 0, valor: 9000 }),                                      // antes da proposta → fora
    processo("G", { etapa: 4, valor: 9999, resultado: "ganha", resultado_em: "2026-11-10" }),
  ]);
  assert.equal(p.kpis.previsao.ponderado, 1500 + 10000 + 4250 + 7200);
  assert.deepEqual([p.kpis.previsao.comTemperatura, p.kpis.previsao.semTemperatura, p.kpis.previsao.proprios], [4, 1, 1]);
  assert.deepEqual(p.previsaoOportunidades.map((o) => [o.id, o.temperatura, o.ponderado]),
    [["M", "morno", 10000], ["P", "quente", 7200], ["Q", "quente", 4250], ["F", "frio", 1500]]);
});

test("propostas: vencida, vence em 7 dias e aceita sem Fechar ganho", () => {
  const p = painel([
    processo("V", { proposta: { versao: 2, validade: "2026-11-20", situacao: "enviada" } }),
    processo("S", { proposta: { versao: 1, validade: "2026-11-27", situacao: "enviada" } }),
    processo("L", { proposta: { versao: 1, validade: "2027-01-10", situacao: "enviada" } }),
    processo("A", { proposta: { versao: 1, validade: null, situacao: "aceita" } }),
  ]);
  assert.deepEqual(p.kpis.propostas, { aguardando: 3, vencidas: 1, vencem7: 1, aceitas: 1 });
  assert.deepEqual(p.propostasAcao.map((x) => [x.id, x.tipo]), [["A", "aceita"], ["V", "vencida"], ["S", "vence"]]);
});
