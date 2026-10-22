import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { carregarUsuarios, traduzirErroAuth, traduzirErroPerfil, CAMPOS_USUARIO } from "@/lib/asp/usuario-api";
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

  const { usuarios, erro } = await carregarUsuarios();
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  return NextResponse.json({ ok: true, usuarios, meuId: check.profile.id });
}

/** Só estes campos são aceitos ao criar. */
const CAMPOS_CRIAR = new Set(["email", "senha", "nomeCompleto", "perfil", "funcao"]);

export async function POST(req: NextRequest) {
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
  for (const k of ["email", "senha", "nomeCompleto", "perfil", "funcao"]) {
    if (body[k] !== undefined && body[k] !== null && typeof body[k] !== "string") {
      return NextResponse.json({ erro: `${ROTULOS_USUARIO[k] || k}: valor inválido.`, campo: k }, { status: 400 });
    }
  }

  const email = normalizarEmail(body.email);
  const nome = normalizarEspacos(body.nomeCompleto);
  const dados = { email, senha: body.senha || "", nomeCompleto: nome, perfil: body.perfil || "", funcao: body.funcao || null };

  const { usuarios, erro: erroLista } = await carregarUsuarios();
  if (erroLista) return NextResponse.json({ erro: erroLista }, { status: 500 });

  const r = validarUsuario(dados, { usuarios, modo: "criar" });
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
    password: dados.senha,
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

  return NextResponse.json({ ok: true, id: created.user.id, usuario: linha, avisos: r.avisos });
}
