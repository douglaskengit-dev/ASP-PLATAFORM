/**
 * Ferramentas do assistente (só leitura). Cada uma consulta o banco com o
 * cliente da sessão do usuário (getSupabaseRouteClient), então o RLS vale
 * normalmente: o assistente só enxerga o que quem pergunta já pode ver.
 * Nenhuma ferramenta grava nada.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FASES } from "@/lib/asp/fases";
import { ROTULO_STATUS_RELATORIO } from "@/lib/validacao/relatorio";

const LIMITE = 40;

export const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: "buscar_projetos",
    description: "Lista projetos (com cliente, código, pedido de compra e quantidade de OS). Filtra por texto no código, pedido, cliente, cidade ou responsável.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Trecho a procurar (opcional)." },
        situacao: { type: "string", enum: ["abertos", "concluidos", "todos"], description: "Padrão: todos." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "detalhar_projeto",
    description: "Dados de um projeto e a lista das suas OS (fase atual e status dos relatórios).",
    input_schema: {
      type: "object",
      properties: { projeto_id: { type: "string" } },
      required: ["projeto_id"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_os",
    description: "Lista Ordens de Serviço (OS/inspeções) com projeto, cliente e fase. Filtra por texto (identificação/TAG, código do projeto, cliente) e/ou número da fase (1 a 10).",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string" },
        fase: { type: "integer", minimum: 1, maximum: 10 },
        incluir_encerradas: { type: "boolean", description: "Padrão: true." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "detalhar_os",
    description: "Tudo de uma OS: cadastro do tanque, agendamentos, coletas, RDOs, relatórios (versões e status), entregas ao cliente e os principais dados do relatório de execução (pH, cloro, amostras, sedimento, conclusões).",
    input_schema: {
      type: "object",
      properties: { os_id: { type: "string" } },
      required: ["os_id"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_clientes",
    description: "Lista clientes (órgãos/empresas) com cidade, UF, CNPJ, recorrência e contatos.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "agenda",
    description: "Agendamentos de inspeção e execução num período (datas ISO AAAA-MM-DD), com OS, projeto, cliente e equipe.",
    input_schema: {
      type: "object",
      properties: { de: { type: "string" }, ate: { type: "string" } },
      required: ["de", "ate"],
      additionalProperties: false,
    },
  },
];

const tituloFase = (n: number) => (n === 1 ? "Abertura do projeto" : FASES.find((f) => f.numero === n)?.titulo || `Fase ${n}`);
/** Status do banco ("em_aprovacao") no rótulo das telas ("Em aprovação"). */
const rotuloStatus = (s: unknown) => (typeof s === "string" ? ROTULO_STATUS_RELATORIO[s] || (s === "pendente" ? "Pendente" : s) : s);
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const contem = (alvo: unknown[], texto?: string) =>
  !texto || alvo.some((v) => typeof v === "string" && semAcento(v).includes(semAcento(texto)));
const semHtml = (s: unknown) =>
  typeof s === "string" ? s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() : s;

/** Campos do rascunho/versão do relatório de execução úteis para perguntas. */
const CAMPOS_RELATORIO = [
  "dataExecucao", "equipe", "phAntes", "phDepois", "cloroAntes", "cloroDepois",
  "amostraAntes", "amostraDepois", "dataColetaAntes", "dataColetaDepois",
  "alturaSedimento", "volumeSedimento", "conclusaoAnalises", "conclusao",
];

type Entrada = Record<string, unknown>;

export async function executarFerramenta(sb: SupabaseClient, nome: string, e: Entrada): Promise<unknown> {
  switch (nome) {
    case "buscar_projetos": {
      const { data, error } = await sb.from("gp_projetos")
        .select("id, codigo_projeto, pedido_compra, endereco, responsavel_projeto, data_abertura, concluido_em, cliente:gp_orgaos(razao_social, cidade, uf), inspecoes:gp_inspecoes(id, excluido_em)")
        .is("excluido_em", null).order("data_abertura", { ascending: false }).limit(300);
      if (error) throw error;
      const sit = e.situacao || "todos";
      return (data || [])
        .filter((p: any) => sit === "todos" || (sit === "concluidos" ? !!p.concluido_em : !p.concluido_em))
        .filter((p: any) => contem([p.codigo_projeto, p.pedido_compra, p.responsavel_projeto, p.endereco, p.cliente?.razao_social, p.cliente?.cidade], e.texto as string))
        .slice(0, LIMITE)
        .map((p: any) => ({
          id: p.id, codigo: p.codigo_projeto, pedido_compra: p.pedido_compra, cliente: p.cliente?.razao_social,
          cidade: p.cliente ? `${p.cliente.cidade}/${p.cliente.uf}` : null, responsavel: p.responsavel_projeto,
          aberto_em: p.data_abertura, concluido_em: p.concluido_em,
          qtd_os: (p.inspecoes || []).filter((i: any) => !i.excluido_em).length,
          link: `/projetos/${p.id}`,
        }));
    }
    case "detalhar_projeto": {
      const { data: p, error } = await sb.from("gp_projetos")
        .select("*, cliente:gp_orgaos(razao_social, cidade, uf, cnpj), inspecoes:gp_inspecoes(id, identificacao, fase, com_inspecao, procedimento, status_relatorio_inspecao, status_relatorio_execucao, encerrada_em, excluido_em)")
        .eq("id", String(e.projeto_id)).is("excluido_em", null).maybeSingle();
      if (error) throw error;
      if (!p) return { erro: "Projeto não encontrado (ou sem acesso)." };
      return {
        id: p.id, codigo: p.codigo_projeto, pedido_compra: p.pedido_compra, endereco: p.endereco,
        responsavel: p.responsavel_projeto, aberto_em: p.data_abertura, concluido_em: p.concluido_em,
        cliente: p.cliente, link: `/projetos/${p.id}`,
        os: (p.inspecoes || []).filter((i: any) => !i.excluido_em).map((i: any) => ({
          id: i.id, identificacao: i.identificacao, procedimento: i.procedimento, com_inspecao: i.com_inspecao,
          fase: i.fase, fase_titulo: tituloFase(i.fase), encerrada_em: i.encerrada_em,
          relatorio_inspecao: rotuloStatus(i.status_relatorio_inspecao), relatorio_execucao: rotuloStatus(i.status_relatorio_execucao),
          link: `/inspecoes/${i.id}`,
        })),
      };
    }
    case "buscar_os": {
      const { data, error } = await sb.from("gp_inspecoes")
        .select("id, identificacao, fase, procedimento, com_inspecao, encerrada_em, atualizado_em, projeto:gp_projetos(id, codigo_projeto, excluido_em, cliente:gp_orgaos(razao_social))")
        .is("excluido_em", null).order("atualizado_em", { ascending: false }).limit(500);
      if (error) throw error;
      return (data || [])
        .filter((i: any) => !i.projeto?.excluido_em)
        .filter((i: any) => e.incluir_encerradas !== false || !i.encerrada_em)
        .filter((i: any) => e.fase == null || i.fase === Number(e.fase))
        .filter((i: any) => contem([i.identificacao, i.procedimento, i.projeto?.codigo_projeto, i.projeto?.cliente?.razao_social], e.texto as string))
        .slice(0, LIMITE)
        .map((i: any) => ({
          id: i.id, identificacao: i.identificacao, procedimento: i.procedimento,
          fase: i.fase, fase_titulo: tituloFase(i.fase), encerrada_em: i.encerrada_em, atualizado_em: i.atualizado_em,
          projeto: i.projeto?.codigo_projeto, cliente: i.projeto?.cliente?.razao_social, link: `/inspecoes/${i.id}`,
        }));
    }
    case "detalhar_os": {
      const id = String(e.os_id);
      const { data: os, error } = await sb.from("gp_inspecoes")
        .select("*, projeto:gp_projetos(id, codigo_projeto, pedido_compra, endereco, cliente:gp_orgaos(razao_social, cidade, uf))")
        .eq("id", id).is("excluido_em", null).maybeSingle();
      if (error) throw error;
      if (!os) return { erro: "OS não encontrada (ou sem acesso)." };
      const [ag, co, re, rd, en] = await Promise.all([
        sb.from("gp_agendamentos").select("tipo, data_visita, data_fim, data_execucao, hora, a_definir, equipe, substituido_em").eq("inspecao_id", id).is("substituido_em", null),
        sb.from("gp_coletas").select("tipo, data_coleta, aprovada_em, criado_em").eq("inspecao_id", id).is("excluido_em", null),
        sb.from("gp_relatorios").select("tipo, versao, status, motivo_ajuste, enviado_em, assinado_em, dados, criado_em").eq("inspecao_id", id).is("excluido_em", null).order("versao", { ascending: false }),
        sb.from("gp_rdos").select("numero, data, dados").contains("inspecoes", [id]).is("excluido_em", null).order("numero"),
        sb.from("gp_entregas").select("data, contato_nome, meio, observacao").eq("inspecao_id", id).is("excluido_em", null),
      ]);
      const relatorios = re.data || [];
      const exec = relatorios.find((r: any) => r.tipo === "execucao" && r.dados);
      const dadosExec = exec ? Object.fromEntries(CAMPOS_RELATORIO.filter((k) => exec.dados[k] != null && exec.dados[k] !== "").map((k) => [k, semHtml(exec.dados[k])])) : null;
      return {
        id: os.id, identificacao: os.identificacao, procedimento: os.procedimento, com_inspecao: os.com_inspecao,
        fase: os.fase, fase_titulo: tituloFase(os.fase), encerrada_em: os.encerrada_em,
        encerramento_justificativa: os.encerramento_justificativa, tanque: os.tanque,
        relatorio_inspecao: rotuloStatus(os.status_relatorio_inspecao), relatorio_execucao: rotuloStatus(os.status_relatorio_execucao),
        projeto: os.projeto, link: `/inspecoes/${os.id}`,
        agendamentos: ag.data || [],
        coletas: co.data || [],
        relatorios: relatorios.map((r: any) => ({ tipo: r.tipo, versao: r.versao, status: rotuloStatus(r.status), motivo_ajuste: r.motivo_ajuste, enviado_em: r.enviado_em, assinado_em: r.assinado_em })),
        dados_relatorio_execucao: dadosExec,
        rdos: (rd.data || []).map((r: any) => ({ numero: r.numero, data: r.data, observacoes: semHtml(r.dados?.observacoes) })),
        entregas: en.data || [],
      };
    }
    case "buscar_clientes": {
      const { data, error } = await sb.from("gp_orgaos")
        .select("id, razao_social, tipo_ente, cnpj, cidade, uf, endereco, recorrente, periodicidade_meses, avisos, contatos:gp_orgaos_contatos(nome_completo, cargo, email, telefone, ativo)")
        .is("excluido_em", null).order("razao_social").limit(300);
      if (error) throw error;
      return (data || []).filter((c: any) => contem([c.razao_social, c.cidade, c.cnpj], e.texto as string)).slice(0, LIMITE);
    }
    case "agenda": {
      const { data, error } = await sb.from("gp_agendamentos")
        .select("tipo, data_visita, data_fim, data_execucao, hora, a_definir, equipe, inspecao:gp_inspecoes(id, identificacao, excluido_em, projeto:gp_projetos(codigo_projeto, cliente:gp_orgaos(razao_social)))")
        .is("substituido_em", null).gte("data_visita", String(e.de)).lte("data_visita", String(e.ate)).order("data_visita").limit(200);
      if (error) throw error;
      return (data || []).filter((a: any) => a.inspecao && !a.inspecao.excluido_em).map((a: any) => ({
        tipo: a.tipo, data: a.data_visita, data_fim: a.data_fim, hora: a.hora, a_definir: a.a_definir, equipe: a.equipe,
        os: a.inspecao.identificacao, projeto: a.inspecao.projeto?.codigo_projeto, cliente: a.inspecao.projeto?.cliente?.razao_social,
        link: `/inspecoes/${a.inspecao.id}`,
      }));
    }
    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}
