/** Definição exata de cada indicador do Dashboard de Operações — aparece no
 * botão (i) de cada cartão e no glossário do fim da página. Mudou a regra em
 * lib/asp/dashboard.ts? Mude o texto aqui. */
import { JANELA_AGENDA_DIAS, LIMITE_PARADA_DIAS } from "@/lib/asp/dashboard";

export type ChaveDef =
  | "osAndamento" | "osEncerradas" | "leadTime" | "projetosConcluidos" | "reprovacao" | "aguardandoAprovacao"
  | "aguardandoAssinatura" | "encerramento" | "funil" | "duracao" | "motivos" | "filas" | "agenda" | "ocupacao"
  | "aDefinir" | "conflitos" | "rdo" | "fotos" | "medicoes" | "laudos" | "clientes" | "recorrencia";

export const DEFINICOES: Record<ChaveDef, { titulo: string; texto: string }> = {
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
};
