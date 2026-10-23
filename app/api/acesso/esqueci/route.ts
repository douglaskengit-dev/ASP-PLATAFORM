/** "Esqueci minha senha" (público). Resposta SEMPRE neutra — não revela se
 * o e-mail existe nem se a conta está ativa. Limite: 3 pedidos por e-mail a
 * cada 15 min e 10 por IP por hora (gp_acesso_tentativas, chaves em hash).
 * Conta inativa (gp_profiles.ativo = false) ou de outro sistema que divide o
 * login (sem gp_profiles) não recebe link. Tempo de resposta mínimo
 * constante, para o tempo do envio não denunciar quem existe. */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  chaveTentativa, emitirLinkAcesso, ipDaRequisicao, limparTentativasAntigas, mesmaOrigem, registrarEContar,
} from "@/lib/asp/acesso-api";
import {
  avaliarLimiteEsqueci, destinoSeguro, emailValido, LIMITES_ESQUECI, MSG_ESQUECI_LIMITE, MSG_ESQUECI_NEUTRA, normalizarEmail,
} from "@/lib/validacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPO_MINIMO_MS = 1500;

async function aguardarMinimo(inicio: number) {
  const falta = TEMPO_MINIMO_MS - (Date.now() - inicio);
  if (falta > 0) await new Promise((r) => setTimeout(r, falta));
}

export async function POST(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const email = normalizarEmail(typeof body?.email === "string" ? body.email : "");
  if (!email || !emailValido(email) || email.length > 254) {
    return NextResponse.json({ erro: "Informe um e-mail válido (nome@dominio.com).", campo: "email" }, { status: 400 });
  }
  const proximo = typeof body?.proximo === "string" ? destinoSeguro(body.proximo) : null;
  const inicio = Date.now();

  try {
    if (Math.random() < 0.1) await limparTentativasAntigas();
    const ip = ipDaRequisicao(req);
    const qtdIp = ip ? await registrarEContar(chaveTentativa("ip", ip), LIMITES_ESQUECI.ip.janelaMs) : 0;
    const qtdEmail = await registrarEContar(chaveTentativa("email", email), LIMITES_ESQUECI.email.janelaMs);
    if (avaliarLimiteEsqueci(qtdEmail, qtdIp).bloqueado) {
      await aguardarMinimo(inicio);
      return NextResponse.json({ erro: MSG_ESQUECI_LIMITE, limite: true }, { status: 429 });
    }

    const admin = getSupabaseAdmin();
    let { data: perfil } = await admin.from("gp_profiles").select("id, email, nome_completo, ativo").eq("email", email).maybeSingle();
    if (!perfil) {
      // Cadastros antigos com caixa diferente: compara exato depois de normalizar
      // (ilike sozinho trataria "_" do e-mail como curinga).
      const { data: candidatos } = await admin.from("gp_profiles").select("id, email, nome_completo, ativo").ilike("email", email.replace(/[%_\\]/g, "\\$&"));
      perfil = ((candidatos || []) as any[]).find((p) => normalizarEmail(p.email) === email) || null;
    }
    if (perfil && (perfil as any).ativo) {
      await emitirLinkAcesso({
        usuario: perfil as any, tipo: "redefinicao", criadoPor: null, req, destino: proximo, devolverLinkSeFalhar: false,
      });
    }
  } catch (e: any) {
    // Mesmo em erro interno a resposta é a neutra (sem detalhes ao público).
    console.error("[acesso/esqueci]", e?.message || e);
  }

  await aguardarMinimo(inicio);
  return NextResponse.json({ ok: true, mensagem: MSG_ESQUECI_NEUTRA });
}
