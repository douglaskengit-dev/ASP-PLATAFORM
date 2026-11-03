/**
 * Botões de continuação depois de cada resposta, montados aqui (sem gastar a
 * IA) a partir do que a resposta citou: uma OS, um projeto ou um cliente
 * vira perguntas prontas sobre ele; listas e resumos sugerem o próximo passo.
 */
import { normalizar } from "./manual-busca";

const LINK = /\[([^\]]+)\]\(\/(inspecoes|projetos|orgaos)\/[^)\s]+\)/g;
const MAX = 3;

const POR_CONSULTA: Record<string, string[]> = {
  indicadores: ["Quais OS estão paradas há mais de 15 dias?", "Quais relatórios aguardam aprovação?", "Quantas OS há em cada fase?"],
  minhas_pendencias: ["Quais OS estão paradas há mais de 15 dias?", "O que está agendado para esta semana?"],
  agenda: ["O que está agendado para a próxima semana?", "Quais são as minhas pendências?"],
  buscar_os: ["Quantas OS há em cada fase?", "Quais OS estão paradas há mais de 15 dias?"],
  buscar_projetos: ["Quais projetos estão abertos?", "Quantas OS há em cada fase?"],
  buscar_clientes: ["Quais clientes recorrentes estão com serviço vencendo?"],
};

export function sugestoesDeContinuacao(resposta: string, consultas: string[], pergunta: string): string[] {
  const citados = Array.from(resposta.matchAll(LINK), (m) => ({ nome: m[1].replace(/^OS\s+/i, "").trim(), tipo: m[2] }));
  const unicos = Array.from(new Map(citados.map((c) => [`${c.tipo}:${c.nome}`, c])).values());
  let lista: string[] = [];
  if (unicos.length === 1) {
    const { nome, tipo } = unicos[0];
    lista = tipo === "inspecoes"
      ? [`O que falta para a OS ${nome} avançar?`, `Quais os agendamentos da OS ${nome}?`, `Quais os relatórios da OS ${nome}?`]
      : tipo === "projetos"
        ? [`Quais OS do projeto ${nome} estão abertas?`, `Qual a situação das OS do projeto ${nome}?`]
        : [`Quais os projetos do cliente ${nome}?`, `Quais os contatos do cliente ${nome}?`];
  } else {
    for (let i = consultas.length - 1; i >= 0 && !lista.length; i--) lista = POR_CONSULTA[consultas[i]] || [];
  }
  const feita = normalizar(pergunta).replace(/[^a-z0-9]+/g, " ").trim();
  return lista.filter((s) => normalizar(s).replace(/[^a-z0-9]+/g, " ").trim() !== feita).slice(0, MAX);
}
