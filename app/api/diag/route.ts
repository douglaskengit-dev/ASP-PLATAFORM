import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { enviarEmail } from "@/lib/email";
import { diagnosticoEmail, resultadoEnvio, remetenteEmail } from "@/lib/validacao";

export const runtime = "nodejs";

/** Diagnóstico de e-mail. Requer estar logado.
 *  - GET /api/diag                → provedor em uso (smtp/resend/nenhum) e
 *    variáveis (usuário mascarado; senha/chave só "presente: sim/não").
 *  - GET /api/diag?email=voce@x.com → envia um e-mail de teste (admin) pelo
 *    provedor ativo e retorna o erro já traduzido (Gmail/SMTP ou Resend). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Faça login para diagnosticar." }, { status: 401 });

  const email = diagnosticoEmail(process.env);
  const env = { ...email, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "(não definido)" };

  const emailTeste = req.nextUrl.searchParams.get("email");
  if (emailTeste) {
    if (profile.perfil !== "admin") {
      return NextResponse.json({ env, aviso: "Envio de teste é só para admin." });
    }
    const r = await enviarEmail(
      [emailTeste],
      "Teste de e-mail — ASP",
      "<p>Se você recebeu isto, o envio de e-mail do ASP está funcionando. ✅</p>",
      undefined,
      { texto: "Se você recebeu isto, o envio de e-mail do ASP está funcionando." }
    );
    const status = resultadoEnvio(r, remetenteEmail(process.env, r.provedor).from);
    return NextResponse.json({
      env,
      testeEnviadoPara: emailTeste,
      resultado: { ok: r.ok && !r.ignorado, provedor: r.provedor, status: status.status, mensagem: status.motivo, detalhe: r.detalhe || r.erro || null },
    });
  }

  return NextResponse.json({ env, dica: "Adicione ?email=SEU_EMAIL para enviar um teste (admin) pelo provedor ativo e ver o erro real." });
}
