/** Templates de e-mail (HTML inline, compatível com clientes de e-mail).
 * Identidade ASP: azul #0f5cad, régua amarela #e8c51f. Sem imagens externas
 * (muitos clientes bloqueiam), a marca é feita por tipografia/cor. */

function linha(rotulo: string, valor?: string) {
  if (!valor) return "";
  return `<tr>
    <td style="padding:6px 0;color:#5a6b7b;font-size:13px;white-space:nowrap;vertical-align:top">${rotulo}</td>
    <td style="padding:6px 0 6px 14px;color:#1a2530;font-size:14px;font-weight:600">${valor}</td>
  </tr>`;
}

export function emailAgendamentoHtml(d: {
  tipoLabel: string;
  ident: string;
  cliente?: string;
  projeto?: string;
  endereco?: string;
  quando: string;
  equipe?: string[];
  equipamentos?: string[];
  checklist?: { item: string; ok?: boolean }[];
  link: string;
  /** Remarcação: a data anterior ("05/11/2026"), que aparece riscada. */
  remarcadoDe?: string;
}): string {
  const check = (d.checklist || []).map((c) => `${c.ok ? "✓" : "○"} ${c.item}`).join(" · ");
  return `<div style="background:#f4f6f8;padding:24px 0;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">
    <tr>
      <td style="background:#123761;padding:16px 24px;border-bottom:3px solid #e8c51f">
        <span style="color:#ffffff;font-weight:800;font-size:20px;letter-spacing:.06em">ASP</span>
        <span style="color:#9fb8d6;font-size:11px;letter-spacing:.14em;margin-left:8px">ADVANCED SERVICES PROVIDER</span>
      </td>
    </tr>
    <tr>
      <td style="padding:24px">
        <h1 style="margin:0 0 6px;color:#0f5cad;font-size:19px">📅 ${d.tipoLabel} ${d.remarcadoDe ? "remarcada" : "agendada"}</h1>
        <p style="margin:0 0 18px;color:#38434d;font-size:14px">${d.remarcadoDe
          ? `A OS ${d.ident} foi remarcada de <s>${d.remarcadoDe}</s> para <strong>${d.quando}</strong>. Desconsidere a data anterior (e remova-a da sua agenda).`
          : `A OS ${d.ident} está agendada para <strong>${d.quando}</strong>.`}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e9ee;border-bottom:1px solid #e4e9ee">
          ${linha("Cliente", d.cliente)}
          ${linha("Projeto", d.projeto)}
          ${linha("Local / Endereço", d.endereco)}
          ${linha("OS (tanque / ponto)", d.ident)}
          ${linha("Data e hora", d.quando)}
          ${linha("Equipe", (d.equipe || []).join(", "))}
          ${linha("Equipamentos", (d.equipamentos || []).join(", "))}
          ${linha("Checklist", check)}
        </table>
        <div style="text-align:center;margin:24px 0 8px">
          <a href="${d.link}" style="display:inline-block;background:#0f5cad;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px">Abrir OS →</a>
        </div>
        <p style="margin:14px 0 0;color:#5a6b7b;font-size:12px">O convite em anexo (.ics) pode ser adicionado à agenda do seu celular.</p>
      </td>
    </tr>
    <tr>
      <td style="background:#f8fafb;padding:12px 24px;color:#8a97a3;font-size:11px;text-align:center">
        ASP · uso interno · este é um e-mail automático, não responda.
      </td>
    </tr>
  </table>
</div>`;
}

// ── Acesso: convite (primeiro acesso) e redefinição de senha ────────────────

function escaparHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface DadosEmailAcesso {
  tipo: "convite" | "redefinicao";
  /** Nome de quem recebe (ou vazio). */
  nome?: string | null;
  email: string;
  link: string;
  /** "24 horas" / "1 hora". */
  validade: string;
}

export function assuntoEmailAcesso(tipo: DadosEmailAcesso["tipo"]): string {
  return tipo === "convite"
    ? "Bem-vindo à Plataforma ASP — crie sua senha"
    : "Plataforma ASP — redefinição de senha";
}

/** Convite / redefinição: botão único, prazo e nota de segurança. A senha
 *  NUNCA vai no e-mail — só o link (uso único) para a pessoa criá-la. */
export function emailAcessoHtml(d: DadosEmailAcesso): string {
  const convite = d.tipo === "convite";
  const nome = escaparHtml((d.nome || "").trim().split(/\s+/)[0] || "");
  const link = escaparHtml(d.link);
  const titulo = convite ? "Bem-vindo à Plataforma ASP" : "Redefinição de senha";
  const texto = convite
    ? `${nome ? `Olá, ${nome}! ` : "Olá! "}Um administrador criou seu acesso à Plataforma ASP com o e-mail <strong>${escaparHtml(d.email)}</strong>. Para entrar, crie sua senha:`
    : `${nome ? `Olá, ${nome}. ` : "Olá. "}Recebemos um pedido para redefinir a senha da conta <strong>${escaparHtml(d.email)}</strong> na Plataforma ASP. Para escolher uma nova senha:`;
  const botao = convite ? "Criar minha senha" : "Redefinir minha senha";
  return `<div style="background:#f4f6f8;padding:24px 0;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">
    <tr>
      <td style="background:#123761;padding:16px 24px;border-bottom:3px solid #e8c51f">
        <span style="color:#ffffff;font-weight:800;font-size:20px;letter-spacing:.06em">ASP</span>
        <span style="color:#9fb8d6;font-size:11px;letter-spacing:.14em;margin-left:8px">ADVANCED SERVICES PROVIDER</span>
      </td>
    </tr>
    <tr>
      <td style="padding:24px">
        <h1 style="margin:0 0 10px;color:#0f5cad;font-size:19px">${convite ? "👋" : "🔑"} ${titulo}</h1>
        <p style="margin:0 0 18px;color:#38434d;font-size:14px;line-height:1.5">${texto}</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${link}" style="display:inline-block;background:#0f5cad;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:8px">${botao} →</a>
        </div>
        <p style="margin:0 0 6px;color:#38434d;font-size:13px;line-height:1.5"><strong>Este link é válido por ${escaparHtml(d.validade)}</strong> e só pode ser usado uma vez.${convite ? " Se ele expirar, use “Esqueci minha senha” na tela de login ou peça um novo convite ao administrador." : " Se ele expirar, peça outro em “Esqueci minha senha”."}</p>
        <p style="margin:14px 0 4px;color:#5a6b7b;font-size:12px">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
        <p style="margin:0 0 16px;font-size:12px;word-break:break-all"><a href="${link}" style="color:#0f5cad">${link}</a></p>
        <p style="margin:0;padding:10px 12px;background:#f8fafb;border-left:3px solid #e8c51f;color:#5a6b7b;font-size:12px;line-height:1.5">🔒 Se você não pediu, ignore este e-mail — ${convite ? "sem a senha, ninguém entra na sua conta" : "sua senha atual continua valendo"}. A ASP nunca pede sua senha por e-mail.</p>
      </td>
    </tr>
    <tr>
      <td style="background:#f8fafb;padding:12px 24px;color:#8a97a3;font-size:11px;text-align:center">
        ASP · uso interno · este é um e-mail automático, não responda.
      </td>
    </tr>
  </table>
</div>`;
}

/** Versão em texto puro do mesmo e-mail. */
export function emailAcessoTexto(d: DadosEmailAcesso): string {
  const convite = d.tipo === "convite";
  const nome = (d.nome || "").trim().split(/\s+/)[0] || "";
  return [
    convite ? "Bem-vindo à Plataforma ASP" : "Plataforma ASP — redefinição de senha",
    "",
    convite
      ? `${nome ? `Olá, ${nome}! ` : "Olá! "}Um administrador criou seu acesso à Plataforma ASP com o e-mail ${d.email}. Para entrar, crie sua senha neste link:`
      : `${nome ? `Olá, ${nome}. ` : "Olá. "}Recebemos um pedido para redefinir a senha da conta ${d.email} na Plataforma ASP. Para escolher uma nova senha, abra este link:`,
    "",
    d.link,
    "",
    `Este link é válido por ${d.validade} e só pode ser usado uma vez.`,
    "",
    `Se você não pediu, ignore este e-mail — ${convite ? "sem a senha, ninguém entra na sua conta" : "sua senha atual continua valendo"}. A ASP nunca pede sua senha por e-mail.`,
    "",
    "ASP · uso interno · e-mail automático, não responda.",
  ].join("\n");
}
