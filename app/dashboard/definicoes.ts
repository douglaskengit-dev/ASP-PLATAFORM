/** Definição exata de cada indicador do Dashboard de Operações — aparece no
 * botão (i) de cada cartão e no glossário do fim da página. Mudou a regra em
 * lib/asp/dashboard.ts? Mude o texto aqui. */
import { JANELA_AGENDA_DIAS, LIMITE_PARADA_DIAS } from "@/lib/asp/dashboard";
import type { PainelId } from "@/lib/asp/dashboard-acesso";

export type ChaveDef =
  | "osAndamento" | "osEncerradas" | "leadTime" | "projetosConcluidos" | "reprovacao" | "aguardandoAprovacao"
  | "aguardandoAssinatura" | "encerramento" | "funil" | "duracao" | "motivos" | "filas" | "agenda" | "ocupacao"
  | "aDefinir" | "conflitos" | "rdo" | "fotos" | "medicoes" | "laudos" | "clientes" | "recorrencia"
  | "gConcluidas" | "gPrazoTotal" | "gCarteira" | "gRetrabalho" | "gPendencias" | "gOcupacao" | "gCalibracao" | "gAgua"
  | "gDiasCampo" | "gMaisAntigas"
  | "cRenovacoes" | "cInativos" | "cPrazoEntrega" | "cAndamento" | "cFunil" | "cConversao" | "cParados" | "cProjetosNovos" | "cRecompra";

/** `painel` = o Dashboard em cujo glossário a definição aparece (sem ele, Operações). */
export const DEFINICOES: Record<ChaveDef, { titulo: string; texto: string; painel?: PainelId }> = {
  osAndamento: {
    titulo: "OSs em andamento",
    texto: "OSs sem data de encerramento, em qualquer fase de 2 a 10 (inclui as da fase 10 que aguardam o encerramento). Não conta OS nem projeto na lixeira. Estado atual: não depende do período. “Abertas no período” = OSs criadas dentro do período. “Sem inspeção” = OSs que começam na fase 6 (não passam pelas fases 2 a 5).",
  },
  osEncerradas: {
    titulo: "OSs encerradas",
    texto: "OSs cuja data de encerramento (o dia informado ao encerrar) está dentro do período. “Manuais” = encerradas com pendências, por justificativa.",
  },
  leadTime: {
    titulo: "Lead time da OS",
    texto: "Só OSs encerradas no período: dias corridos entre o dia de abertura da OS (criação, horário de Brasília) e a data de encerramento. Mostra a média e a mediana — no total e separado entre OSs com e sem inspeção (a sem inspeção não passa pelas fases 2 a 5, então tende a ser mais curta).",
  },
  projetosConcluidos: {
    titulo: "Projetos concluídos",
    texto: "Projetos que ficaram concluídos (todas as OSs ativas encerradas) dentro do período, pelo dia em Brasília. “Ativos” = projetos do recorte ainda não concluídos (estado atual).",
  },
  reprovacao: {
    titulo: "Taxa de reprovação",
    texto: "Reprovações ÷ avaliações (aprovar + reprovar) gravadas no histórico de fases dentro do período (dia em Brasília). Inspeção = avaliações na fase 5; Execução = na fase 9. Cada avaliação conta uma vez — a mesma OS reprovada duas vezes conta duas.",
  },
  aguardandoAprovacao: {
    titulo: "Aguardando aprovação",
    texto: "Relatórios com status “Em aprovação” de OSs não encerradas. Idade = dias corridos desde o envio para aprovação (Brasília). Estado atual.",
  },
  aguardandoAssinatura: {
    titulo: "Aguardando assinatura",
    texto: "Relatórios aprovados de OSs não encerradas que ainda não têm a versão assinada do mesmo tipo (inspeção ou execução). Idade = dias corridos desde a aprovação. Estado atual.",
  },
  encerramento: {
    titulo: "Pendências de encerramento",
    texto: "OSs na fase 10 ainda não encerradas que têm ao menos uma pendência — as mesmas regras da tela da OS: relatórios sem versão assinada, laudo do laboratório, rascunho ou aprovação esquecidos, RDO sem .docx ou desatualizado, dias da execução sem RDO e coleta de fotos incompleta. Na OS sem inspeção, o relatório de inspeção não é pendência. Estado atual.",
  },
  funil: {
    titulo: "OSs por fase",
    texto: `Quantas OSs não encerradas estão em cada fase agora. Idade = dias corridos desde a última entrada da OS na fase (histórico de fases; sem histórico, a abertura da OS). “Parada” = mais de ${LIMITE_PARADA_DIAS} dias na fase atual. OSs sem inspeção nascem na fase 6 e nunca contam nas fases 2 a 5; nas fases 6 a 10 aparece quantas delas são sem inspeção. Toque numa fase para ver as OSs.`,
  },
  duracao: {
    titulo: "Tempo por fase",
    texto: "Dias (com fração) que as OSs ficaram em cada fase, só nas passagens que TERMINARAM no período (saída da fase no histórico, dia em Brasília). A fase 10 termina no registro do encerramento. Passagens com histórico incompleto (dado antigo) ficam de fora.",
  },
  motivos: {
    titulo: "Motivos de reprovação",
    texto: "Categoria escolhida em cada reprovação do período (histórico de fases), separada por relatório de inspeção e de execução. Reprovações antigas, sem categoria, aparecem como “Sem categoria”.",
  },
  filas: {
    titulo: "Filas de relatórios",
    texto: "Em aprovação: relatórios esperando a Gerência (fase 5 ou 9). Assinatura: aprovados sem a versão assinada. Só OSs não encerradas; o mais antigo primeiro.",
  },
  agenda: {
    titulo: "Próximos agendamentos",
    texto: "Agendamentos ativos (não substituídos por remarcação), com data, cujo dia ou período toca de hoje até +6 dias (7 dias) ou +29 dias (30 dias). Execuções já em andamento aparecem. Com o filtro de pessoa, só os agendamentos com ela na equipe.",
  },
  ocupacao: {
    titulo: "Ocupação da equipe e equipamentos",
    texto: `Dias distintos, nos próximos ${JANELA_AGENDA_DIAS} dias (hoje incluso), em que a pessoa ou o equipamento está em algum agendamento ativo com data. A execução conta todos os dias do período (inclusive fim de semana e feriado). Equipamentos são comparados pelo nome sem acento e sem caixa.`,
  },
  aDefinir: {
    titulo: "Data a definir",
    texto: "Agendamentos ativos marcados “data a definir” de OSs não encerradas. Vencido = lembrete antes de hoje; Hoje = lembrete para hoje; Sem lembrete = sem data para lembrar.",
  },
  conflitos: {
    titulo: "Conflitos de agenda",
    texto: "Mesma pessoa (pelo cadastro) ou mesmo equipamento em dois agendamentos ativos de OSs em locais diferentes (outro projeto e outro endereço) com dia em comum, de hoje em diante. É a mesma regra do aviso ao agendar.",
  },
  rdo: {
    titulo: "RDOs faltando",
    texto: "OSs não encerradas com execução agendada já iniciada: dias do período da execução, do início até hoje (inclusive), sem RDO que inclua a OS. Fim de semana e feriado contam, como na tela da OS. Estado atual.",
  },
  fotos: {
    titulo: "Coleta de fotos incompleta",
    texto: "OSs não encerradas nas fases 8 a 10 (a execução já terminou) com itens obrigatórios da coleta de fotos da execução faltando — as mesmas regras da seção Fotos da OS. Estado atual.",
  },
  medicoes: {
    titulo: "Medições sem aprovação",
    texto: "OSs não encerradas nas fases 3 a 5 com ao menos uma medição registrada (coleta que não é anexo) e nenhuma aprovada para valer no relatório. Estado atual.",
  },
  laudos: {
    titulo: "Laudo fora do limite após a limpeza",
    texto: "Relatório de execução atual (o assinado ou o de maior versão) enviado para aprovação no período, cujo laudo “depois da limpeza” tem parâmetro acima do limite da linha (Portaria GM/MS nº 888/2021 por padrão) ou “Presente” em coliformes/E. coli.",
  },
  recorrencia: {
    titulo: "Próximos serviços recorrentes",
    texto: "Clientes marcados como “Serviço recorrente”. Vencimento = fim da última execução do cliente (o maior entre o último dia do agendamento de execução ativo e o dia do encerramento, entre as OSs ativas) + a periodicidade (3, 6 ou 12 meses; dia que não existe no mês vira o último dia). Em breve = a partir da antecedência do cliente (padrão 30 dias antes); Vencido = depois do vencimento; Sem histórico = nenhuma execução registrada; Próximo serviço aberto = já existe OS aberta criada depois da última execução. Em breve e Vencido geram UM lembrete (notificação) por cliente e vencimento para o Comercial e a Gerência. Só o filtro de cliente vale aqui. Estado atual.",
  },
  clientes: {
    titulo: "Clientes",
    texto: "Por cliente: projetos do recorte, OSs não encerradas agora, OSs criadas e encerradas no período e entregas registradas no período (pela data da entrega).",
  },
  // ── Dashboard de Gerência ─────────────────────────────────────────────────
  gConcluidas: {
    painel: "gerencia",
    titulo: "Serviços concluídos",
    texto: "OSs cuja data de encerramento está no período, comparadas ao período anterior de mesmo tamanho (ex.: últimos 30 dias × os 30 dias antes deles). No gráfico, cada mês dos últimos 12 ao lado do mesmo mês do ano anterior.",
  },
  gPrazoTotal: {
    painel: "gerencia",
    titulo: "Prazo total da OS",
    texto: "Dias corridos da abertura da OS até a entrega do relatório final ao cliente. Entrega final = a primeira entrega registrada no dia do fim da execução ou depois; sem execução agendada, a primeira entrega da OS. Conta as entregas feitas no período; o gráfico mostra a mediana de cada mês.",
  },
  gCarteira: {
    painel: "gerencia",
    titulo: "Carteira em aberto",
    texto: `OSs não encerradas agora. “Paradas” = mais de ${LIMITE_PARADA_DIAS} dias na fase atual. “Mais antiga” = dias desde a abertura da OS aberta há mais tempo. Estado atual.`,
  },
  gRetrabalho: {
    painel: "gerencia",
    titulo: "Retrabalho de relatórios",
    texto: "Reprovações ÷ avaliações (aprovar + reprovar) dos relatórios de inspeção e de execução registradas no período. O gráfico mostra a taxa de cada mês dos últimos 12; os motivos são as categorias escolhidas ao reprovar no período.",
  },
  gPendencias: {
    painel: "gerencia",
    titulo: "Pendências de campo",
    texto: "Agora: OSs com dias de execução sem RDO, OSs com a coleta de fotos incompleta (fases 8 a 10), OSs com medição sem aprovação (fases 3 a 5) e OSs na fase 10 com pendência para encerrar — as mesmas regras do Dashboard de Operações. “Encerradas com pendência” = OSs encerradas no período por justificativa.",
  },
  gOcupacao: {
    painel: "gerencia",
    titulo: "Ocupação",
    texto: "Média de dias alocados nos próximos 30 dias (hoje incluso) ÷ 30, por pessoa e por equipamento. Equipe e frota = quem esteve em algum agendamento ativo com data de 90 dias atrás até o fim da janela — quem não tem nada agendado na janela conta como 0%.",
  },
  gCalibracao: {
    painel: "gerencia",
    titulo: "Calibração",
    texto: "Unidades ativas de equipamentos que exigem calibração: vencidas (ou sem calibração cadastrada) e que vencem nos próximos 30 dias. Estado atual; não depende dos filtros.",
  },
  gAgua: {
    painel: "gerencia",
    titulo: "Água conforme após a limpeza",
    texto: "Dos relatórios de execução enviados no período com o laudo “depois da limpeza” preenchido, a parte sem nenhum parâmetro acima do limite (Portaria GM/MS nº 888/2021 por padrão) nem “Presente” em coliformes/E. coli.",
  },
  gDiasCampo: {
    painel: "gerencia",
    titulo: "Dias em campo por OS",
    texto: "OSs encerradas no período: dias distintos com RDO que inclui a OS. OSs sem nenhum RDO ficam de fora.",
  },
  gMaisAntigas: {
    painel: "gerencia",
    titulo: "OSs abertas há mais tempo",
    texto: "As 10 OSs não encerradas com mais dias desde a abertura, e quantas OSs abertas há em cada fase. Estado atual.",
  },
  // ── Dashboard Comercial ───────────────────────────────────────────────────
  cRenovacoes: {
    painel: "comercial",
    titulo: "Renovações a vencer",
    texto: "Clientes marcados como “Serviço recorrente”, pelo vencimento do próximo serviço (fim da última execução + a periodicidade do cadastro): vencidos e que vencem em até 30, 60 e 90 dias. Quem já tem o próximo serviço aberto não aparece. Mesma regra dos lembretes de recorrência. Estado atual.",
  },
  cInativos: {
    painel: "comercial",
    titulo: "Clientes para reativar",
    texto: "Clientes sem OS aberta cujo último serviço (o maior entre o fim da execução agendada e o encerramento) foi há mais de 12 meses. “Sem nenhum serviço” = clientes e órgãos cadastrados que nunca tiveram projeto. Estado atual.",
  },
  cPrazoEntrega: {
    painel: "comercial",
    titulo: "Prazo de entrega ao cliente",
    texto: "Dias corridos do fim da execução até a entrega do relatório final (a primeira entrega no dia do fim da execução ou depois). Conta as entregas feitas no período.",
  },
  cAndamento: {
    painel: "comercial",
    titulo: "OSs em andamento por cliente",
    texto: "OSs não encerradas agora, por cliente: em que fases estão, dias desde a abertura da mais antiga e a próxima execução agendada. Estado atual.",
  },
  cFunil: {
    painel: "comercial",
    titulo: "Funil do Follow-up",
    texto: "Processos do Follow-up em cada etapa agora. O tempo por etapa é a mediana de dias entre a entrada e a saída da etapa (datas de autenticação das trocas), nas saídas que aconteceram no período.",
  },
  cConversao: {
    painel: "comercial",
    titulo: "Conversão do Follow-up",
    texto: "Processos abertos no período: em cada etapa, a parte dos que chegaram nela que também chegou à etapa seguinte. O KPI é a parte que chegou a “Finalizado”. Processo recente ainda em andamento conta como não convertido — use um período mais longo para ler a taxa.",
  },
  cParados: {
    painel: "comercial",
    titulo: "Processos parados",
    texto: "Processos do Follow-up ainda não finalizados que estão há mais de 30 dias na etapa atual (desde a data de autenticação da última troca, ou da abertura). Estado atual.",
  },
  cProjetosNovos: {
    painel: "comercial",
    titulo: "Projetos novos",
    texto: "Projetos pela data de abertura, no período e comparados ao período anterior de mesmo tamanho. “Cliente novo” = o primeiro projeto do cliente; “recorrente” = cliente que já tinha projeto. O gráfico mostra os últimos 12 meses.",
  },
  cRecompra: {
    painel: "comercial",
    titulo: "Taxa de recompra",
    texto: "Dos clientes cujo primeiro projeto foi aberto há pelo menos 12 meses, a parte que abriu outro projeto em até 12 meses depois do primeiro. Não depende do período.",
  },
};

/** Definições do glossário de um Dashboard. */
export const definicoesDo = (painel: PainelId) => Object.values(DEFINICOES).filter((d) => (d.painel || "operacoes") === painel);
