import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ehUuid } from "@/lib/asp/coleta-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import {
  equipamentosTodos, faltaMigracao, fotoNoStorage, modeloNoStorage, MSG_MIGRACAO_CATALOGO, PERFIS_EDICAO_CATALOGO,
  procedimentosTodos, removerSeSemUso, TABELA_CATALOGO, tipoCatalogo, usoDoItem,
} from "@/lib/asp/catalogo-api";
import {
  camposPermitidos, codigoProcRepetido, msgCodigoRepetido, msgNomeEquipRepetido, msgNomeProcRepetido, msgVersaoConflito,
  nomeRepetido, normalizarDadosEquipamento, normalizarDadosProcedimento, primeiroErro, renumerarOrdem, ROTULOS_CATALOGO,
  slugUnico, temErros, textoRenomeacao, textoUso, totalUso, validarEquipamento, validarProcedimento,
  type DadosEquipamento, type DadosProcedimento, type FotoCatalogo, type ResultadoValidacao, type TipoCatalogo,
} from "@/lib/validacao";

export const runtime = "nodejs";

/** Catálogo completo (procedimentos + equipamentos, ativos e desativados)
 *  para telas e relatório. Quem escolhe item NOVO (OS, checklist,
 *  agendamento) filtra os desativados; quem resolve referência existente
 *  (código da OS, slug do checklist) precisa deles. */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = getSupabaseRouteClient();
  const [eq, pr] = await Promise.all([
    supabase.from("gp_equipamentos").select("*").order("ordem").order("nome"),
    supabase.from("gp_procedimentos").select("*").order("ordem").order("codigo"),
  ]);
  return NextResponse.json({
    ok: true,
    podeEditar: PERFIS_EDICAO_CATALOGO.includes(profile.perfil),
    equipamentos: eq.data || [],
    procedimentos: pr.data || [],
  });
}

async function exigirEditor() {
  const profile = await getProfileAtual();
  if (!profile) return { erro: NextResponse.json({ erro: "Sessão expirada." }, { status: 401 }) };
  if (!PERFIS_EDICAO_CATALOGO.includes(profile.perfil)) {
    return { erro: NextResponse.json({ erro: "Sem permissão para editar o Catálogo." }, { status: 403 }) };
  }
  return { profile };
}

const respErros = (r: ResultadoValidacao, status = 400) =>
  NextResponse.json({ erro: primeiroErro(r, ROTULOS_CATALOGO), erros: r.erros, avisos: r.avisos }, { status });

/** Código/nome já usado por outro item (pela chave) → mensagem do 409. */
function conflitoUnico(
  tipo: TipoCatalogo, dados: DadosEquipamento | DadosProcedimento, todos: any[], id?: string | null
): string | null {
  if (tipo === "procedimento") {
    const d = dados as DadosProcedimento;
    const c = codigoProcRepetido(d.codigo, todos, id);
    if (c) return msgCodigoRepetido(c);
    const n = nomeRepetido(d.nome, todos, id);
    return n ? msgNomeProcRepetido(n) : null;
  }
  const n = nomeRepetido((dados as DadosEquipamento).nome, todos, id);
  return n ? msgNomeEquipRepetido(n) : null;
}

/** O banco recusou por índice único (corrida entre dois salvamentos): relê e
 *  diz qual item já usa o código/nome. */
async function respostaUnica(tipo: TipoCatalogo, dados: DadosEquipamento | DadosProcedimento, id?: string | null) {
  const todos = tipo === "procedimento" ? await procedimentosTodos() : await equipamentosTodos();
  const msg = conflitoUnico(tipo, dados, todos, id)
    || (tipo === "procedimento" ? "Já existe um procedimento com este código ou nome." : "Já existe um equipamento com este nome ou identificador.");
  return NextResponse.json({ erro: msg }, { status: 409 });
}

/** Confere no storage as fotos que ainda não estavam gravadas e põe o hash
 *  calculado AQUI (não o do navegador). Repetida → erro. */
async function conferirFotos(fotos: FotoCatalogo[], antigas: FotoCatalogo[]): Promise<{ fotos: FotoCatalogo[]; erro?: string }> {
  const porCaminho = new Map(antigas.map((f) => [f.caminho, f]));
  const out: FotoCatalogo[] = [];
  const hashes = new Map<string, number>();
  for (let i = 0; i < fotos.length; i++) {
    const f = fotos[i];
    let hash = porCaminho.get(f.caminho)?.hash;
    if (!porCaminho.has(f.caminho)) {
      const ex = await fotoNoStorage(f.caminho);
      if (ex.erro) return { fotos, erro: `Foto ${i + 1}: ${ex.erro}` };
      hash = ex.hash || undefined;
    }
    if (hash) {
      if (hashes.has(hash)) return { fotos, erro: `Foto ${i + 1}: é a mesma imagem da foto ${hashes.get(hash)! + 1}. Remova a repetida.` };
      hashes.set(hash, i);
    }
    out.push({ caminho: f.caminho, legenda: f.legenda || "", ...(hash ? { hash } : {}) });
  }
  return { fotos: out };
}

/** Valida e prepara os dados (lista branca + normalização + storage). */
async function preparar(tipo: TipoCatalogo, bruto: unknown, atual: Record<string, any> | null) {
  const campos = camposPermitidos(tipo, bruto);
  // PATCH parcial: o que não veio fica como está.
  const base = atual ? camposPermitidos(tipo, atual) : {};
  const mesclado = { ...base, ...campos };
  if (tipo === "equipamento") {
    const todos = await equipamentosTodos();
    const r = validarEquipamento(mesclado as any, { id: atual?.id, equipamentos: todos });
    const dados = normalizarDadosEquipamento(mesclado);
    return { r, dados, todos };
  }
  const [todos, equipamentos] = await Promise.all([procedimentosTodos(), equipamentosTodos()]);
  const dados = normalizarDadosProcedimento(mesclado);
  const r = validarProcedimento(dados as any, { id: atual?.id, procedimentos: todos, equipamentos });
  // Formato do jsonb vem cru do corpo: valida também o que veio antes de normalizar.
  const rBruto = validarProcedimento(mesclado as any, {});
  for (const [c, l] of Object.entries(rBruto.erros)) l.forEach((m) => (r.erros[c] ||= []).includes(m) || r.erros[c].push(m));
  return { r, dados, todos };
}

/** Cria um item: { tipo, dados }. O slug do equipamento é gerado aqui. */
export async function POST(req: NextRequest) {
  const { erro } = await exigirEditor();
  if (erro) return erro;
  const body = await req.json().catch(() => ({}));
  const tipo = tipoCatalogo(body?.tipo);
  if (!tipo) return NextResponse.json({ erro: "Tipo inválido." }, { status: 400 });

  const { r, dados, todos } = await preparar(tipo, body.dados, null);
  const conflito = conflitoUnico(tipo, dados, todos, null);
  if (conflito) return NextResponse.json({ erro: conflito, erros: r.erros, avisos: r.avisos }, { status: 409 });
  if (temErros(r)) return respErros(r);

  const linha: Record<string, unknown> = { ...dados };
  if (tipo === "equipamento") {
    const f = await conferirFotos((dados as DadosEquipamento).fotos, []);
    if (f.erro) return NextResponse.json({ erro: f.erro }, { status: 400 });
    linha.fotos = f.fotos;
    linha.slug = slugUnico(dados.nome, todos.map((e: any) => e.slug));
  } else {
    const t = (dados as DadosProcedimento).template_path;
    if (t) {
      const problema = await modeloNoStorage(t);
      if (problema) return NextResponse.json({ erro: `Modelo: ${problema}` }, { status: 400 });
    }
  }
  linha.ordem = todos.reduce((m: number, x: any) => Math.max(m, Number(x.ordem) || 0), 0) + 1;

  const { data, error } = await getSupabaseAdmin().from(TABELA_CATALOGO[tipo]).insert(linha).select("*").single();
  if (ehViolacaoUnica(error)) return respostaUnica(tipo, dados, null);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data, avisos: r.avisos });
}

const mesmaVersao = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && (a === b || Date.parse(a) === Date.parse(b));

/** Atualiza: { tipo, id, versao, dados, confirmarRenomeacao? }
 *  Também: { acao: "desativar" | "reativar", tipo, id }
 *          { acao: "ordenar", tipo, ids: [...] } */
export async function PATCH(req: NextRequest) {
  const { erro, profile } = await exigirEditor();
  if (erro) return erro;
  const body = await req.json().catch(() => ({}));
  const tipo = tipoCatalogo(body?.tipo);
  if (!tipo) return NextResponse.json({ erro: "Tipo inválido." }, { status: 400 });
  const tabela = TABELA_CATALOGO[tipo];
  const admin = getSupabaseAdmin();

  if (body.acao === "ordenar") {
    const { data: linhas, error } = await admin.from(tabela).select("id, ordem");
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    const nova = renumerarOrdem(body.ids, (linhas || []) as any[]);
    const antes = new Map((linhas || []).map((l: any) => [l.id, l.ordem]));
    // Ordem não é "conteúdo": não mexe em atualizado_em (não gera conflito
    // com quem está com o item aberto).
    for (const n of nova.filter((n) => antes.get(n.id) !== n.ordem)) {
      const { error: e } = await admin.from(tabela).update({ ordem: n.ordem }).eq("id", n.id);
      if (e) return NextResponse.json({ erro: e.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ordem: nova });
  }

  if (!ehUuid(body?.id)) return NextResponse.json({ erro: "Id inválido." }, { status: 400 });
  const { data: atual, error: eAtual } = await admin.from(tabela).select("*").eq("id", body.id).maybeSingle();
  if (eAtual) return NextResponse.json({ erro: eAtual.message }, { status: 500 });
  if (!atual) return NextResponse.json({ erro: "Item não encontrado — pode ter sido excluído. Recarregue." }, { status: 404 });

  if (body.acao === "desativar" || body.acao === "reativar") {
    const ativo = body.acao === "reativar";
    const { data, error } = await admin.from(tabela).update({
      ativo,
      desativado_em: ativo ? null : new Date().toISOString(),
      desativado_por: ativo ? null : profile!.id,
      atualizado_em: new Date().toISOString(),
    }).eq("id", body.id).select("*").single();
    if (faltaMigracao(error)) return NextResponse.json({ erro: MSG_MIGRACAO_CATALOGO }, { status: 500 });
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, item: data });
  }

  // ── Salvar ──
  if (!body.versao) {
    return NextResponse.json({ erro: "Versão do item ausente — recarregue a página e tente de novo." }, { status: 400 });
  }
  if (!mesmaVersao(body.versao, atual.atualizado_em)) {
    return NextResponse.json({ erro: msgVersaoConflito(atual.atualizado_em), conflitoVersao: true }, { status: 409 });
  }
  if (tipo === "equipamento" && body.dados && typeof body.dados.slug === "string" && body.dados.slug !== atual.slug) {
    return NextResponse.json({ erro: "O identificador do equipamento não muda depois de criado." }, { status: 400 });
  }

  const { r, dados, todos } = await preparar(tipo, body.dados, atual);
  const conflito = conflitoUnico(tipo, dados, todos, atual.id);
  if (conflito) return NextResponse.json({ erro: conflito, erros: r.erros, avisos: r.avisos }, { status: 409 });
  if (temErros(r)) return respErros(r);

  const linha: Record<string, unknown> = { ...dados };
  const fotosAntigas: FotoCatalogo[] = Array.isArray(atual.fotos) ? atual.fotos : [];
  if (tipo === "equipamento") {
    const f = await conferirFotos((dados as DadosEquipamento).fotos, fotosAntigas);
    if (f.erro) return NextResponse.json({ erro: f.erro }, { status: 400 });
    linha.fotos = f.fotos;
  } else {
    const t = (dados as DadosProcedimento).template_path;
    if (t && t !== atual.template_path) {
      const problema = await modeloNoStorage(t);
      if (problema) return NextResponse.json({ erro: `Modelo: ${problema}` }, { status: 400 });
    }
  }

  // Renomear código (procedimento) / nome (equipamento) em uso: a troca vai
  // às referências na mesma transação (função no banco), depois de o
  // usuário confirmar vendo as contagens.
  const campoChave = tipo === "procedimento" ? "codigo" : "nome";
  const antigo: string = atual[campoChave];
  const novo: string = (dados as any)[campoChave];
  let versao: string = atual.atualizado_em;
  let renomeacao: Record<string, unknown> | null = null;
  if (antigo !== novo) {
    const { uso, erro: eUso } = await usoDoItem(tipo, atual.id);
    if (eUso) return NextResponse.json({ erro: eUso }, { status: 500 });
    const texto = textoRenomeacao(tipo, uso);
    if (texto && body.confirmarRenomeacao !== true) {
      return NextResponse.json({ erro: `Confirme a renomeação: ${texto}`, precisaConfirmar: true, uso, texto }, { status: 409 });
    }
    const fn = tipo === "procedimento" ? "gp_renomear_procedimento" : "gp_renomear_equipamento";
    const { data: rpc, error: eRpc } = await admin.rpc(fn, { p_id: atual.id, p_antigo: antigo, p_novo: novo, p_versao: atual.atualizado_em });
    if (eRpc) {
      if (/gp_catalogo_versao/.test(eRpc.message || "")) {
        const { data: agora } = await admin.from(tabela).select("atualizado_em").eq("id", atual.id).maybeSingle();
        return NextResponse.json({ erro: msgVersaoConflito((agora as any)?.atualizado_em), conflitoVersao: true }, { status: 409 });
      }
      if (ehViolacaoUnica(eRpc)) return respostaUnica(tipo, dados, atual.id);
      if (faltaMigracao(eRpc)) return NextResponse.json({ erro: MSG_MIGRACAO_CATALOGO }, { status: 500 });
      return NextResponse.json({ erro: eRpc.message }, { status: 500 });
    }
    renomeacao = rpc as Record<string, unknown>;
    versao = String((rpc as any)?.versao || versao);
  }

  // Grava o resto só se ninguém salvou no meio (atualizado_em = versão lida).
  linha.atualizado_em = new Date().toISOString();
  const { data: salvos, error } = await admin.from(tabela).update(linha)
    .eq("id", atual.id).eq("atualizado_em", versao).select("*");
  const falhou = !!error || !salvos || salvos.length === 0;
  if (falhou && renomeacao) {
    // Compensação: desfaz a renomeação (código/nome volta, referências também).
    const fn = tipo === "procedimento" ? "gp_renomear_procedimento" : "gp_renomear_equipamento";
    await admin.rpc(fn, { p_id: atual.id, p_antigo: novo, p_novo: antigo, p_versao: versao });
  }
  if (ehViolacaoUnica(error)) return respostaUnica(tipo, dados, atual.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (falhou) {
    const { data: agora } = await admin.from(tabela).select("atualizado_em").eq("id", atual.id).maybeSingle();
    return NextResponse.json({ erro: msgVersaoConflito((agora as any)?.atualizado_em), conflitoVersao: true }, { status: 409 });
  }

  // Só agora (gravado) os arquivos que saíram são apagados — e só se nenhum
  // outro item os usa.
  const sairam: string[] = [];
  if (tipo === "equipamento") {
    const ficam = new Set((linha.fotos as FotoCatalogo[]).map((f) => f.caminho));
    fotosAntigas.forEach((f) => f?.caminho && !ficam.has(f.caminho) && sairam.push(f.caminho));
  } else if (atual.template_path && atual.template_path !== (dados as DadosProcedimento).template_path) {
    sairam.push(atual.template_path);
  }
  const removidos = await removerSeSemUso(sairam);
  return NextResponse.json({ ok: true, item: salvos![0], avisos: r.avisos, renomeacao, removidos });
}

/** Exclui de vez: ?tipo=equipamento&id=... — só item que nada usa. Em uso,
 *  a resposta é 409 com o uso; a tela oferece Desativar. */
export async function DELETE(req: NextRequest) {
  const { erro } = await exigirEditor();
  if (erro) return erro;
  const tipo = tipoCatalogo(req.nextUrl.searchParams.get("tipo"));
  const id = req.nextUrl.searchParams.get("id");
  if (!tipo || !ehUuid(id)) return NextResponse.json({ erro: "Tipo ou id inválido." }, { status: 400 });
  const admin = getSupabaseAdmin();
  const { data: atual } = await admin.from(TABELA_CATALOGO[tipo]).select("*").eq("id", id).maybeSingle();
  if (!atual) return NextResponse.json({ ok: true });

  const { uso, erro: eUso } = await usoDoItem(tipo, id);
  if (eUso) return NextResponse.json({ erro: eUso }, { status: 500 });
  if (totalUso(uso) > 0) {
    return NextResponse.json({
      erro: `“${tipo === "procedimento" ? atual.codigo : atual.nome}” está em uso (${textoUso(tipo, uso)}) e não pode ser excluído. Use “Desativar”: some das novas escolhas e o que já existe continua funcionando.`,
      uso, emUso: true,
    }, { status: 409 });
  }
  const { error } = await admin.from(TABELA_CATALOGO[tipo]).delete().eq("id", id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const arquivos = tipo === "equipamento"
    ? (Array.isArray(atual.fotos) ? atual.fotos : []).map((f: any) => f?.caminho)
    : [atual.template_path];
  const removidos = await removerSeSemUso(arquivos);
  return NextResponse.json({ ok: true, removidos });
}
