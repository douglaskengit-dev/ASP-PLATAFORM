import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { carregarUsuarios, traduzirErroAuth, traduzirErroPerfil, CAMPOS_USUARIO } from "@/lib/asp/usuario-api";
import { emitirLinkAcesso, mesmaOrigem, resumosDeAcesso, senhaAleatoria } from "@/lib/asp/acesso-api";
import { carregarFuncoes } from "@/lib/asp/funcoes";
import {
  normalizarEmail, normalizarEspacos, primeiroErro, ROTULOS_USUARIO, temErros, usuarioComEmail, validarUsuario,
} from "@/lib/validacao";

export const runtime = "nodejs";

async function exigirAdmin() {
  const profile = await getProfileAtual();
  if (!profile) return { erro: "Não autenticado.", status: 401 as const };
  if (profile.perfil !== "admin") return { erro: "Apenas administradores podem gerenciar usuários.", status: 403 as const };
  return { profile };
}

export async function GET() {
  const check = await exigirAdmin();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });

  const [{ usuarios, erro }, cad] = await Promise.all([carregarUsuarios(), carregarFuncoes(getSupabaseAdmin())]);
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  // Convite/redefinição (último link de cada tipo) e se já entrou alguma vez.
  const acesso = await resumosDeAcesso(usuarios.map((u) => u.id)).catch(() => ({}));
  // Funções cadastradas: o seletor mostra só as ativas (+ a atual de cada um).
  return NextResponse.json({ ok: true, usuarios, acesso, meuId: check.profile.id, funcoes: cad.erro ? null : cad.funcoes });
}

/** Só estes campos são aceitos ao criar. Sem senha: a conta nasce com uma
 *  senha aleatória que ninguém vê, e o usuário cria a dele pelo convite. */
const CAMPOS_CRIAR = new Set(["email", "nomeCompleto", "perfil", "funcao"]);

export async function POST(req: NextRequest) {
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
  const extras = Object.keys(body).filter((k) => !CAMPOS_CRIAR.has(k));
  if (extras.length) return NextResponse.json({ erro: `Campo não permitido: ${extras.join(", ")}.` }, { status: 400 });
  for (const k of ["email", "nomeCompleto", "perfil", "funcao"]) {
    if (body[k] !== undefined && body[k] !== null && typeof body[k] !== "string") {
      return NextResponse.json({ erro: `${ROTULOS_USUARIO[k] || k}: valor inválido.`, campo: k }, { status: 400 });
    }
  }

  const email = normalizarEmail(body.email);
  const nome = normalizarEspacos(body.nomeCompleto);
  const dados = { email, nomeCompleto: nome, perfil: body.perfil || "", funcao: body.funcao || null };

  const [{ usuarios, erro: erroLista }, cad] = await Promise.all([carregarUsuarios(), carregarFuncoes(getSupabaseAdmin())]);
  if (erroLista) return NextResponse.json({ erro: erroLista }, { status: 500 });
  if (cad.erro) return NextResponse.json({ erro: cad.erro }, { status: 500 });

  // Função: só cadastrada e ativa (lib/validacao/funcao.ts).
  const r = validarUsuario(dados, { usuarios, modo: "criar", funcoes: cad.funcoes });
  if (temErros(r)) {
    const duplicado = !!usuarioComEmail(email, usuarios);
    return NextResponse.json(
      { erro: primeiroErro(r, ROTULOS_USUARIO), erros: r.erros, avisos: r.avisos },
      { status: duplicado ? 409 : 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: senhaAleatoria(),
    email_confirm: true,
  });

  if (createError || !created?.user) {
    if (createError) console.error("[admin/users] createUser:", createError.code, createError.message);
    const t = traduzirErroAuth(createError);
    return NextResponse.json(
      { erro: t.erro, ...(t.campo ? { erros: { [t.campo]: [t.erro] } } : {}) },
      { status: t.status }
    );
  }

  // O trigger on_auth_user_created_gp já cria a linha em gp_profiles; aqui só
  // completamos com e-mail normalizado, nome, perfil e função (upsert: se o
  // trigger não tiver criado a linha, ela nasce aqui).
  const { data: linha, error: updateError } = await admin
    .from("gp_profiles")
    .upsert({
      id: created.user.id,
      email,
      nome_completo: nome,
      perfil: dados.perfil,
      funcao: dados.funcao,
      // Criado por um admin daqui = acesso liberado (o convite precisa de
      // conta ativa). Contas do outro sistema continuam nascendo inativas.
      ativo: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" })
    .select(CAMPOS_USUARIO)
    .maybeSingle();

  if (updateError || !linha) {
    // Sem o perfil completo o login ficaria "órfão": desfaz a criação.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    const t = updateError
      ? traduzirErroPerfil(updateError)
      : { erro: "Não foi possível completar o cadastro do usuário. Tente de novo.", campo: null, status: 500 };
    return NextResponse.json(
      { erro: t.erro, ...(t.campo ? { erros: { [t.campo]: [t.erro] } } : {}) },
      { status: t.status }
    );
  }

  // Convite "Bem-vindo à Plataforma ASP — crie sua senha" (24 h). Se o
  // e-mail não sair, o usuário continua criado e a tela oferece "Reenviar
  // convite" e "Copiar link".
  const convite = await emitirLinkAcesso({
    usuario: { id: created.user.id, email, nome_completo: nome }, tipo: "convite", criadoPor: check.profile.id, req, devolverLinkSeFalhar: true,
  }).catch((e: any) => {
    console.error("[admin/users] convite:", e?.message || e);
    return { ok: false, tipo: "convite" as const, enviado: false, motivo: null, erro: "Não foi possível gerar o convite." };
  });

  return NextResponse.json({ ok: true, id: created.user.id, usuario: linha, avisos: r.avisos, convite });
}
