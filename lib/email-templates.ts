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
        <h1 style="margin:0 0 6px;color:#0f5cad;font-size:19px">📅 ${d.tipoLabel} agendada</h1>
        <p style="margin:0 0 18px;color:#38434d;font-size:14px">${d.ident} está agendada para <strong>${d.quando}</strong>.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e9ee;border-bottom:1px solid #e4e9ee">
          ${linha("Cliente", d.cliente)}
          ${linha("Projeto", d.projeto)}
          ${linha("Local / Endereço", d.endereco)}
          ${linha("Tanque / Ponto", d.ident)}
          ${linha("Data e hora", d.quando)}
          ${linha("Equipe", (d.equipe || []).join(", "))}
          ${linha("Equipamentos", (d.equipamentos || []).join(", "))}
          ${linha("Checklist", check)}
        </table>
        <div style="text-align:center;margin:24px 0 8px">
          <a href="${d.link}" style="display:inline-block;background:#0f5cad;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px">Abrir inspeção →</a>
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
