import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { enviarEmail } from "@/lib/email";

export const runtime = "nodejs";

/** Diagnóstico de e-mail. Requer estar logado.
 *  - GET /api/diag                → mostra se as variáveis estão presentes.
 *  - GET /api/diag?email=voce@x.com → envia um e-mail de teste (admin) e
 *    retorna a resposta real do provedor (útil para ver erros do Resend). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Faça login para diagnosticar." }, { status: 401 });

  const env = {
    RESEND_API_KEY_presente: !!process.env.RESEND_API_KEY,
    EMAIL_REMETENTE: process.env.EMAIL_REMETENTE || "(não definido — usará onboarding@resend.dev)",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "(não definido)",
  };

  const emailTeste = req.nextUrl.searchParams.get("email");
  if (emailTeste) {
    if (profile.perfil !== "admin") {
      return NextResponse.json({ env, aviso: "Envio de teste é só para admin." });
    }
    const resultado = await enviarEmail(
      [emailTeste],
      "Teste de e-mail — ASP",
      "<p>Se você recebeu isto, o envio de e-mail do ASP está funcionando. ✅</p>"
    );
    return NextResponse.json({ env, testeEnviadoPara: emailTeste, resultado });
  }

  return NextResponse.json({ env, dica: "Adicione ?email=SEU_EMAIL para enviar um teste (admin) e ver o erro real do provedor." });
}
