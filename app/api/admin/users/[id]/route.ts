import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getProfileAtual } from "@/lib/supabase/route";
import {
  agendamentosFuturosAfetados, CAMPOS_USUARIO, carregarUsuarios, mesmaVersao, msgVersaoUsuario,
  removerDasEquipesFuturas, traduzirErroAuth, traduzirErroPerfil, type UsuarioLinha,
} from "@/lib/asp/usuario-api";
import { invalidarLinks, invalidarLinksPorEmail, mesmaOrigem } from "@/lib/asp/acesso-api";
import {
  checarAlteracaoAcesso, contarAdminsAtivos, normalizarEspacos, perdeAdmin, primeiroErro, ROTULOS_USUARIO,
  SENHA_MINIMA, temErros, validarUsuario, type DadosUsuario,
} from "@/lib/validacao";

export const runtime = "nodejs";

async function exigirAdmin() {
  const profile = await getProfileAtual();
  if (!profile) return { erro: "Não autenticado.", status: 401 as const };
  if (profile.perfil !== "admin")
    return { erro: "Apenas administradores podem gerenciar usuários.", status: 403 as const };
  return { profile };
}

function erroCampo(erro: string, campo: string | null, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ erro, ...(campo ? { campo, erros: { [campo]: [erro] } } : {}), ...extra }, { status });
}

/** Impacto de desativar: ?impacto=desativar → agendamentos futuros em que o
 *  usuário está na equipe (a tela lista antes de confirmar). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const check = await exigirAdmin();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });
  if (req.nextUrl.searchParams.get("impacto") !== "desativar") {
    return NextResponse.json({ erro: "Consulta inválida." }, { status: 400 });
  }
  const { agendamentos, erro } = await agendamentosFuturosAfetados(params.id);
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  return NextResponse.json({ ok: true, agendamentos });
}

/** Só estes campos são aceitos ao editar. `versao` = updated_at lido. */
const CAMPOS_EDITAR = new Set(["nomeCompleto", "perfil", "ativo", "funcao", "senha", "versao"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const check = await exigirAdmin();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const extras = Object.keys(body).filter((k) => !CAMPOS_EDITAR.has(k));
  if (extras.length) return NextResponse.json({ erro: `Campo não permitido: ${extras.join(", ")}.` }, { status: 400 });

  const { nomeCompleto, perfil, ativo, funcao, senha, versao } = body;
  if (nomeCompleto !== undefined && nomeCompleto !== null && typeof nomeCompleto !== "string") return erroCampo("Nome completo: valor inválido.", "nomeCompleto", 400);
  if (perfil !== undefined && typeof perfil !== "string") return erroCampo("Área / Acesso: valor inválido.", "perfil", 400);
  if (ativo !== undefined && typeof ativo !== "boolean") return erroCampo("Ativo: valor inválido.", "ativo", 400);
  if (funcao !== undefined && funcao !== null && typeof funcao !== "string") return erroCampo("Função: valor inválido.", "funcao", 400);
  if (senha !== undefined && typeof senha !== "string") return erroCampo("Senha: valor inválido.", "senha", 400);

  const admin = getSupabaseAdmin();
  const { usuarios, erro: erroLista } = await carregarUsuarios();
  if (erroLista) return NextResponse.json({ erro: erroLista }, { status: 500 });
  const alvo = usuarios.find((u) => u.id === params.id);
  if (!alvo) return NextResponse.json({ erro: "Usuário não encontrado (excluído por outro administrador?). Recarregue a página." }, { status: 404 });

  // Campos do perfil que de fato mudam (enviar o valor atual não é mudança).
  const dados: DadosUsuario = {};
  if (nomeCompleto !== undefined) dados.nomeCompleto = normalizarEspacos(nomeCompleto);
  if (perfil !== undefined && perfil !== alvo.perfil) dados.perfil = perfil;
  if (funcao !== undefined && (funcao || null) !== (alvo.funcao || null)) dados.funcao = funcao || null;
  const mudaAtivo = ativo !== undefined && ativo !== alvo.ativo;
  const mudaNome = dados.nomeCompleto !== undefined && dados.nomeCompleto !== (alvo.nome_completo || "");
  const mudaPerfil = dados.perfil !== undefined || dados.funcao !== undefined || mudaAtivo || mudaNome;

  if (mudaPerfil || dados.nomeCompleto !== undefined) {
    if (typeof versao !== "string" || !versao) {
      return NextResponse.json({ erro: "Versão do usuário ausente — recarregue a página e tente de novo." }, { status: 400 });
    }
    if (!mesmaVersao(versao, alvo.updated_at)) {
      return NextResponse.json({ erro: msgVersaoUsuario(alvo.updated_at), conflitoVersao: true, usuario: alvo }, { status: 409 });
    }
  }

  // Senha: só o mínimo de 6 (a resposta nunca repete a senha).
  if (senha !== undefined && senha.length < SENHA_MINIMA) {
    return erroCampo(`A nova senha deve ter ao menos ${SENHA_MINIMA} caracteres.`, "senha", 400);
  }

  const r = validarUsuario(dados, { usuarios, modo: "editar", id: alvo.id, nomeAnterior: alvo.nome_completo });
  if (temErros(r)) {
    return NextResponse.json({ erro: primeiroErro(r, ROTULOS_USUARIO), erros: r.erros, avisos: r.avisos }, { status: 400 });
  }

  const alteracao = { ...(dados.perfil !== undefined ? { perfil: dados.perfil } : {}), ...(mudaAtivo ? { ativo } : {}) };
  const bloqueio = checarAlteracaoAcesso({ alvo, autorId: check.profile.id, alteracao, usuarios });
  if (bloqueio) return erroCampo(bloqueio.erro, bloqueio.campo, bloqueio.campo === "perfil" || bloqueio.campo === "ativo" ? 409 : 400);

  let linha: UsuarioLinha = alvo;
  let agendamentos: Awaited<ReturnType<typeof removerDasEquipesFuturas>> | null = null;

  if (mudaPerfil) {
    const campos: Record<string, unknown> = {
      ...(mudaNome ? { nome_completo: dados.nomeCompleto } : {}),
      ...(dados.perfil !== undefined ? { perfil: dados.perfil } : {}),
      ...(dados.funcao !== undefined ? { funcao: dados.funcao } : {}),
      ...(mudaAtivo ? { ativo } : {}),
      updated_at: new Date().toISOString(),
    };
    let q = admin.from("gp_profiles").update(campos).eq("id", alvo.id);
    q = alvo.updated_at ? q.eq("updated_at", alvo.updated_at) : q.is("updated_at", null);
    const { data, error } = await q.select(CAMPOS_USUARIO);
    if (error) {
      const t = traduzirErroPerfil(error);
      return erroCampo(t.erro, t.campo, t.status);
    }
    if (!data || data.length === 0) {
      const { data: agora } = await admin.from("gp_profiles").select(CAMPOS_USUARIO).eq("id", alvo.id).maybeSingle();
      if (!agora) return NextResponse.json({ erro: "Usuário não encontrado (excluído por outro administrador?). Recarregue a página." }, { status: 404 });
      return NextResponse.json({ erro: msgVersaoUsuario((agora as any).updated_at), conflitoVersao: true, usuario: agora }, { status: 409 });
    }
    linha = data[0] as unknown as UsuarioLinha;

    // Corrida: dois admins rebaixando/desativando ao mesmo tempo os dois
    // últimos admins. O trigger do banco (migração 20261101100000) já barra;
    // sem ele, confere de novo e desfaz.
    if (perdeAdmin(alvo, alteracao)) {
      const { data: admins } = await admin.from("gp_profiles").select("perfil, ativo").eq("perfil", "admin").eq("ativo", true);
      if (contarAdminsAtivos((admins || []) as any[]) === 0) {
        await admin.from("gp_profiles")
          .update({ perfil: alvo.perfil, ativo: alvo.ativo, updated_at: new Date().toISOString() })
          .eq("id", alvo.id);
        return erroCampo("Não é possível: não sobraria nenhum administrador ativo — promova outro usuário a Administrador antes.", "perfil", 409);
      }
    }

    // Desativado: sai das equipes dos agendamentos futuros (reativar não devolve).
    if (mudaAtivo && ativo === false) {
      // Links de convite/redefinição pendentes deixam de valer (o banco
      // também faz isso por trigger — migração 20261104100000).
      await invalidarLinks(alvo.id, "usuario_desativado");
      agendamentos = await removerDasEquipesFuturas({ usuario: alvo, autorId: check.profile.id });
    }
  }

  if (senha !== undefined) {
    const { error: erroSenha } = await admin.auth.admin.updateUserById(alvo.id, { password: senha });
    if (erroSenha) {
      console.error("[admin/users] senha:", erroSenha.code, erroSenha.message);
      const t = traduzirErroAuth(erroSenha);
      return erroCampo(t.erro, t.campo === "senha" ? "senha" : null, t.status);
    }
  }

  return NextResponse.json({
    ok: true,
    usuario: linha,
    avisos: r.avisos,
    ...(agendamentos ? { agendamentos } : {}),
  });
}

/**
 * Exclui o usuário definitivamente (perfil + conta de login).
 * Se ele já tiver registros vinculados (projetos, OSs, coletas etc.),
 * o banco bloqueia a exclusão para não perder o histórico — nesse caso a
 * orientação é desativá-lo.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const check = await exigirAdmin();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });

  const { usuarios, erro: erroLista } = await carregarUsuarios();
  if (erroLista) return NextResponse.json({ erro: erroLista }, { status: 500 });
  const alvo = usuarios.find((u) => u.id === params.id);
  if (!alvo) return NextResponse.json({ erro: "Usuário não encontrado (já excluído?). Recarregue a página." }, { status: 404 });

  const bloqueio = checarAlteracaoAcesso({ alvo, autorId: check.profile.id, alteracao: { excluir: true }, usuarios });
  if (bloqueio) return erroCampo(bloqueio.erro, "excluir", alvo.id === check.profile.id ? 400 : 409);

  const admin = getSupabaseAdmin();

  // Remove primeiro o perfil: se houver registros vinculados, a FK falha aqui
  // (código 23503) sem ter apagado nada — a conta de login continua intacta.
  const { error: erroPerfil } = await admin.from("gp_profiles").delete().eq("id", params.id);
  if (erroPerfil) {
    if (erroPerfil.code === "23503") {
      return erroCampo(
        "Este usuário possui registros vinculados (projetos, OSs, coletas etc.) e não pode ser excluído. Desmarque \"Ativo\" para bloquear o acesso mantendo o histórico.",
        "excluir", 409
      );
    }
    const t = traduzirErroPerfil(erroPerfil);
    return erroCampo(t.erro, "excluir", t.status);
  }

  // Links pendentes deixam de valer (o perfil sumiu; a linha fica para auditoria).
  await invalidarLinksPorEmail(alvo.email, "usuario_excluido");

  const { error: erroAuth } = await admin.auth.admin.deleteUser(params.id);
  if (erroAuth && erroAuth.status !== 404) {
    console.error("[admin/users] deleteUser:", erroAuth.code, erroAuth.message);
    return erroCampo("O perfil foi excluído (o acesso já está bloqueado), mas a conta de login não pôde ser removida do servidor de login.", "excluir", 500);
  }

  // Quem foi excluído também sai das equipes futuras (sem avisar o próprio).
  const agendamentos = await removerDasEquipesFuturas({ usuario: alvo, autorId: check.profile.id }).catch(() => null);

  return NextResponse.json({ ok: true, ...(agendamentos ? { agendamentos } : {}) });
}
