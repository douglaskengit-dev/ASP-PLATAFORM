import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { contextoAgendamento } from "@/lib/asp/agendamento-api";

export const runtime = "nodejs";

/** Contexto do banco para o modal de agendamento validar enquanto o usuário
 *  digita (lib/validacao/agendamento.ts): agendamentos ativos desta OS, os de
 *  outras OSs na data escolhida (conflito de equipe/equipamento), abertura
 *  do projeto, local e nomes do Catálogo. Só leitura.
 *  GET ?inspecaoId=…&data=AAAA-MM-DD */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const inspecaoId = req.nextUrl.searchParams.get("inspecaoId");
  if (!inspecaoId) return NextResponse.json({ erro: "OS obrigatória." }, { status: 400 });
  const data = req.nextUrl.searchParams.get("data") || "";

  const { ctx, info } = await contextoAgendamento({ inspecaoId, dataVisita: /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null });
  if (!info) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  // usuariosAtivos fica de fora: a tela já lista só os ativos.
  const resto: Partial<typeof ctx> = { ...ctx };
  delete resto.usuariosAtivos;
  return NextResponse.json({ ok: true, ...resto });
}
