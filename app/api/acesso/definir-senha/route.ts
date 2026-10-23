/** Define a senha a partir do link do e-mail (público) e já deixa a pessoa
 * logada (cookie de sessão do Supabase).
 *
 * 1. confere o link (nosso prazo de 24 h / 1 h, uso único, conta ativa);
 * 2. "reserva" o link (usado_em) de forma atômica — dois cliques ao mesmo
 *    tempo não usam o mesmo link;
 * 3. pede ao Supabase um link de recuperação (generateLink, não envia
 *    e-mail) e o consome NA HORA com verifyOtp no cliente de rota — o prazo
 *    de OTP do Supabase fica irrelevante; com a sessão, grava a senha
 *    (auth.updateUser). Se o Supabase recusar o OTP, cai no plano B: grava a
 *    senha pela chave de serviço e entra com ela (signInWithPassword);
 * 4. se algo falhar, devolve a reserva (o link continua valendo);
 * 5. invalida os outros links pendentes do usuário. */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSupabaseRouteClient } from "@/lib/supabase/route";
import { buscarLinkPorToken, invalidarLinks, ipDaRequisicao, mesmaOrigem, perfilAtivo, TABELA_LINKS } from "@/lib/asp/acesso-api";
import { destinoSeguro, estadoLink, MSG_ESTADO_LINK, validarNovaSenha } from "@/lib/validacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function erroSenhaSupabase(err: { code?: string; message?: string } | null | undefined): string {
  const code = err?.code || "";
  const msg = (err?.message || "").toLowerCase();
  if (code === "same_password" || /different from the old/.test(msg)) return "A nova senha deve ser diferente da anterior.";
  if (code === "weak_password" || /password/.test(msg)) return "Senha recusada pelo servidor de login — escolha outra (mínimo 6 caracteres).";
  if (code === "over_request_rate_limit" || /rate limit/.test(msg)) return "Muitas tentativas seguidas — aguarde um minuto e tente de novo.";
  return "O servidor de login não aceitou a operação. Tente de novo em instantes — o link continua valendo.";
}

export async function POST(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  const senha = body?.senha;
  const v = validarNovaSenha(senha, body?.confirmacao);
  if (v) return NextResponse.json({ erro: v.erro, campo: v.campo }, { status: 400 });

  const admin = getSupabaseAdmin();
  const link = await buscarLinkPorToken(token);
  const perfil = await perfilAtivo(link?.usuario_id || null);
  const estado = estadoLink(link, new Date(), perfil.ativo);
  if (estado !== "valido" || !link?.usuario_id) {
    return NextResponse.json(
      { ok: false, estado, erro: MSG_ESTADO_LINK[estado === "valido" ? "invalido" : estado], ...(link && estado !== "invalido" ? { email: link.email } : {}) },
      { status: estado === "invalido" ? 404 : 410 }
    );
  }
  const usuarioId = link.usuario_id;

  // Reserva atômica: só um pedido consegue marcar usado_em.
  const agoraIso = new Date().toISOString();
  const { data: reservado, error: erroReserva } = await admin.from(TABELA_LINKS)
    .update({ usado_em: agoraIso, uso_ip: ipDaRequisicao(req) || null })
    .eq("id", link.id).is("usado_em", null).is("invalidado_em", null).gt("expira_em", agoraIso)
    .select("id");
  if (erroReserva || !reservado || reservado.length === 0) {
    if (erroReserva) console.error("[acesso/definir-senha] reservar:", erroReserva.code, erroReserva.message);
    return NextResponse.json({ ok: false, estado: "usado", erro: MSG_ESTADO_LINK.usado, email: link.email }, { status: 410 });
  }
  const devolverReserva = async () => {
    const { error } = await admin.from(TABELA_LINKS).update({ usado_em: null, uso_ip: null }).eq("id", link.id).eq("usado_em", agoraIso);
    if (error) console.error("[acesso/definir-senha] devolver reserva:", error.code, error.message);
  };

  try {
    const { data: authUser, error: erroUser } = await admin.auth.admin.getUserById(usuarioId);
    const emailAuth = authUser?.user?.email;
    if (erroUser || !emailAuth) {
      if (erroUser) console.error("[acesso/definir-senha] getUserById:", erroUser.code, erroUser.message);
      await devolverReserva();
      return NextResponse.json({ ok: false, estado: "invalido", erro: "Conta de login não encontrada. Fale com um administrador." }, { status: 404 });
    }

    const supabase = getSupabaseRouteClient();
    let sessao = false;

    // Plano A: link de recuperação gerado e consumido agora (sessão no cookie).
    const { data: gerado, error: erroGerar } = await admin.auth.admin.generateLink({ type: "recovery", email: emailAuth });
    const hashed = gerado?.properties?.hashed_token;
    if (!erroGerar && hashed) {
      const { data: ver, error: erroVer } = await supabase.auth.verifyOtp({ token_hash: hashed, type: "recovery" });
      if (!erroVer && ver?.session && ver.user?.id === usuarioId) {
        sessao = true;
        const { error: erroUpd } = await supabase.auth.updateUser({ password: senha });
        if (erroUpd) {
          console.error("[acesso/definir-senha] updateUser:", erroUpd.code, erroUpd.message);
          await supabase.auth.signOut().catch(() => undefined);
          await devolverReserva();
          return NextResponse.json({ ok: false, erro: erroSenhaSupabase(erroUpd), campo: "senha" }, { status: 400 });
        }
      } else if (erroVer) {
        console.error("[acesso/definir-senha] verifyOtp:", erroVer.code, erroVer.message);
      } else if (ver?.session) {
        // Sessão de outra conta (não deveria acontecer): descarta.
        await supabase.auth.signOut().catch(() => undefined);
      }
    } else if (erroGerar) {
      console.error("[acesso/definir-senha] generateLink:", erroGerar.code, erroGerar.message);
    }

    // Plano B: grava pela chave de serviço e entra com a senha nova.
    if (!sessao) {
      const { error: erroAdm } = await admin.auth.admin.updateUserById(usuarioId, { password: senha });
      if (erroAdm) {
        console.error("[acesso/definir-senha] updateUserById:", erroAdm.code, erroAdm.message);
        await devolverReserva();
        return NextResponse.json({ ok: false, erro: erroSenhaSupabase(erroAdm), campo: "senha" }, { status: 400 });
      }
      const { error: erroLogin } = await supabase.auth.signInWithPassword({ email: emailAuth, password: senha });
      if (erroLogin) {
        // A senha já foi gravada: o link cumpriu o papel; falta só entrar.
        console.error("[acesso/definir-senha] signIn:", erroLogin.code, erroLogin.message);
        await invalidarLinks(usuarioId, "senha_definida", undefined, link.id);
        return NextResponse.json({ ok: true, entrou: false, destino: "/login" });
      }
    }

    await invalidarLinks(usuarioId, "senha_definida", undefined, link.id);
    return NextResponse.json({ ok: true, entrou: true, destino: destinoSeguro(link.destino) });
  } catch (e: any) {
    console.error("[acesso/definir-senha]", e?.message || e);
    await devolverReserva();
    return NextResponse.json({ ok: false, erro: "Não foi possível definir a senha agora. Tente de novo — o link continua valendo." }, { status: 500 });
  }
}
