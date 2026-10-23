/** Dashboard de Operações — carregamento dos dados (servidor).
 *
 * Usa o cliente da ROTA (sessão do usuário, RLS ligado): o Dashboard mostra
 * exatamente o que o usuário já pode ler nas telas da OS/projeto — as
 * policies gp_*_select liberam leitura para qualquer perfil ativo, igual a
 * /api/projetos. Nada aqui usa a chave secreta.
 *
 * Poucas consultas, todas em paralelo (sem N+1), só com as colunas usadas;
 * cada uma pagina de 1000 em 1000 (limite padrão do PostgREST) para não
 * cortar dados em silêncio. O que está na lixeira (excluido_em) e o
 * agendamento substituído por remarcação (substituido_em) já saem no banco.
 * As fotos da execução (jsonb maior) só vêm das OSs abertas da fase 7+. */
import type { DadosDashboard } from "./dashboard";

const PAGINA = 1000;

async function todas<T>(montar: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; de < 500 * PAGINA; de += PAGINA) {
    const { data, error } = await montar().range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data || []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return out;
}

export async function carregarDadosDashboard(supabase: any): Promise<DadosDashboard> {
  const [projetos, oss, historico, relatorios, agendamentos, rdos, coletas, entregas, procedimentos, orgaos] = await Promise.all([
    todas<any>(() => supabase.from("gp_projetos")
      .select("id, codigo_projeto, pedido_compra, endereco, cliente_id, data_abertura, criado_em, concluido_em, cliente:gp_orgaos(razao_social)")
      .is("excluido_em", null).order("id")),
    // "*": com_inspecao sem quebrar antes da migração.
    todas<any>(() => supabase.from("gp_inspecoes")
      .select("*")
      .is("excluido_em", null).order("id")),
    todas<any>(() => supabase.from("gp_fase_historico")
      .select("inspecao_id, fase_de, fase_para, acao, motivo_categoria, criado_em").order("id")),
    todas<any>(() => supabase.from("gp_relatorios")
      .select("id, inspecao_id, tipo, versao, status, enviado_em, avaliado_em, assinado_em, criado_em, laudo_pdf:dados->laudoPdf, laudo_depois:dados->laudoDepois")
      .is("excluido_em", null).order("id")),
    todas<any>(() => supabase.from("gp_agendamentos")
      .select("id, inspecao_id, tipo, data_visita, data_fim, hora, equipe, equipamentos, a_definir, lembrar_em")
      .is("substituido_em", null).order("id")),
    todas<any>(() => supabase.from("gp_rdos")
      .select("id, projeto_id, numero, data, inspecoes, arquivo_path, arquivo_em, atualizado_em")
      .is("excluido_em", null).order("id")),
    todas<any>(() => supabase.from("gp_coletas").select("inspecao_id, tipo, aprovada_em").is("excluido_em", null).order("id")),
    todas<any>(() => supabase.from("gp_entregas").select("inspecao_id, data").is("excluido_em", null).order("id")),
    todas<any>(() => supabase.from("gp_procedimentos").select("codigo, nome, agua_potavel, limpeza_robotizada").order("codigo")),
    // Clientes (recorrência). "*": sem as colunas novas, ninguém é recorrente.
    todas<any>(() => supabase.from("gp_orgaos").select("*").is("excluido_em", null).order("id")),
  ]);

  // Fotos: só das OSs abertas da fase 7 em diante, em lotes (URL curta).
  const alvo = oss.filter((o: any) => !o.encerrada_em && Number(o.fase) >= 7).map((o: any) => o.id as string);
  const fotos: any[] = [];
  for (let i = 0; i < alvo.length; i += 100) {
    const lote = alvo.slice(i, i + 100);
    fotos.push(...await todas<any>(() => supabase.from("gp_fotos_execucao")
      .select("inspecao_id, agua_antes, agua_depois, limpeza_confirmada, itens").in("inspecao_id", lote).order("inspecao_id")));
  }

  return {
    projetos: projetos.map((p: any) => ({
      id: p.id, codigo_projeto: p.codigo_projeto, pedido_compra: p.pedido_compra, endereco: p.endereco || null,
      cliente_id: p.cliente_id, cliente_nome: p.cliente?.razao_social || null, data_abertura: p.data_abertura,
      criado_em: p.criado_em, concluido_em: p.concluido_em || null,
    })),
    oss: oss.map((o: any) => ({
      id: o.id, projeto_id: o.projeto_id, identificacao: o.identificacao, fase: Number(o.fase) || 2,
      procedimento: o.procedimento ?? null, criado_em: o.criado_em, encerrada_em: o.encerrada_em || null,
      encerramento_manual: !!o.encerramento_manual, com_inspecao: o.com_inspecao !== false,
    })),
    historico,
    relatorios: relatorios.map((r: any) => ({ ...r, versao: Number(r.versao) || 0 })),
    agendamentos: agendamentos.map((a: any) => ({
      ...a, a_definir: !!a.a_definir,
      equipe: Array.isArray(a.equipe) ? a.equipe : [], equipamentos: Array.isArray(a.equipamentos) ? a.equipamentos : [],
    })),
    rdos: rdos.map((r: any) => ({ ...r, inspecoes: Array.isArray(r.inspecoes) ? r.inspecoes : [] })),
    fotos: fotos.map((x: any) => ({ ...x, itens: x.itens || {} })),
    coletas,
    entregas,
    procedimentos,
    orgaos: orgaos.map((o: any) => ({
      id: o.id, razao_social: o.razao_social, recorrente: o.recorrente === true,
      periodicidade_meses: o.periodicidade_meses ?? null, aviso_antecedencia_dias: o.aviso_antecedencia_dias ?? null,
    })),
  };
}
