"use client";

/** ASP — Detalhe da Inspeção: barra de progresso das fases (2..10), ações
 * conforme o perfil (avançar / aprovar / reprovar-"Ajustar"), coleta (medidor
 * de sedimento), agendamento (checklist jsonb), relatórios versionados e
 * histórico de autenticação. As fases correm por inspeção. Ver COWORK-ASP §2.
 *
 * Fase 3 (coleta): toda medição passa por uma confirmação (data da coleta,
 * responsável, regras de lib/validacao/coleta.ts + medicao.ts) antes de
 * gravar; a API repete as mesmas regras.
 *
 * Fase 4 (relatório): o tipo segue a fase (inspeção até a 5, execução da 6
 * em diante); o envio de arquivo de fora é conferido (PDF/DOCX de verdade,
 * 30 MB, arquivo repetido) e confirmado mostrando a versão que será criada e
 * a que será substituída; aprovar/reprovar age sobre o relatório mostrado.
 * Regras em lib/validacao/relatorio.ts; a API repete as que bloqueiam.
 *
 * Fases 5/9 (aprovação): aprovar/reprovar exige o relatório em aprovação;
 * reprovar exige categoria + descrição com sentido; a transição é atômica
 * (dois cliques → um vale, o outro recebe "Já avaliado por…"). Avisos ao
 * aprovar: mesma pessoa que preparou/enviou, arquivo não baixado, OS mudou
 * depois do envio, inspeção sem medição aprovada. Aprovado, o Comercial/
 * Gerência envia a versão ASSINADA (PDF), que vira o documento final.
 * Regras em lib/validacao/aprovacao.ts.
 *
 * Fase 9 (aprovação do relatório de execução): além dos avisos gerais, avisa
 * (nunca bloqueia) versão sem PDF do laudo (enviada antes da Fase 8),
 * parâmetro fora do limite não citado na Conclusão, resultado não conforme
 * após a limpeza (cloro < 0,2 ou laudo DEPOIS fora do limite), dias sem RDO,
 * RDO com .docx desatualizado/não gerado e coleta de fotos incompleta. A
 * reprovação ganha a categoria "Laudo/Laboratório" (só na execução). Regras
 * em lib/validacao/aprovacaoExecucao.ts.
 *
 * Fase 6 (agendamento da execução): a execução tem PERÍODO (início + último
 * dia); conflitos, fim de semana/feriado e remarcação olham o período todo.
 * O card da execução avisa checklist de segurança, equipamento do
 * procedimento fora da lista (um clique adiciona) e equipe sem Coordenador/
 * Engenheiro; 6 → 7 confirma segurança e água potável; 7 → 8 lista os dias
 * do período sem RDO. Regras em lib/validacao/agendamento.ts + execucao.ts.
 *
 * Fase 10 (encerramento): o card de ações mostra as pendências (cada uma com
 * link para a seção), "Encerrar OS", "Encerrar manualmente" (Admin/Gerência,
 * com justificativa) e "Reabrir OS"; a seção "Entregas ao cliente" registra
 * o que foi entregue, a quem e quando. OS encerrada = só consulta: os botões
 * de edição somem/desabilitam aqui e a API recusa (409). Regras em
 * lib/validacao/encerramento.ts. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Modal from "@/app/components/Modal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { acoesDisponiveis, definicaoFase, descreverAcaoFase, perfilAtuaNaFase, tituloFase, ULTIMA_FASE, OpcaoAcao } from "@/lib/asp/fases";
import { useSecoes } from "@/lib/asp/useSecoes";
import SecaoRecolhivel from "@/app/components/SecaoRecolhivel";
import { enviarJson, enviarArquivo, novoId } from "@/lib/pwa/sync";
import { podeAprovarColeta, podeEditarRevisao } from "@/lib/asp/permissoes";
import { camposDaMedicao } from "@/lib/asp/relatorio";
import { sha256Hex } from "@/lib/sha256";
import { lerArquivoParaMatriz, extrairBatimetria, montarEstadoMedidor, gerarModeloXlsx, paraNumero } from "@/lib/asp/batimetria";
import EntradaBatimetria from "@/app/components/EntradaBatimetria";
import GerarRelatorio from "@/app/components/GerarRelatorio";
import ChecklistEquipamentos from "@/app/components/ChecklistEquipamentos";
import ColetaFotosExecucao from "@/app/components/ColetaFotosExecucao";
import { cloroDoProcedimento, pendenciasColeta, progressoColeta, type RegistroFotosExecucao } from "@/lib/asp/fotos-execucao";
import FormularioTanque from "@/app/components/FormularioTanque";
import { dadosRelatorioDoTanque, erroDoTanque, resumoTanque, tanqueParaForm, TANQUE_FORM_VAZIO, type Tanque, type TanqueForm } from "@/lib/asp/tanque";
import AvisoCliente from "@/app/components/AvisoCliente";
import Rdos from "@/app/components/Rdos";
import { dataBr, numeroRdo, resumoRdos, type RegistroRdo } from "@/lib/asp/rdo";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import {
  agendamentosSubstituidos, chaveMedicao, ColetaRef, ContextoAgendamento, ContextoColeta, dataColetaSugerida, dataCurta,
  dataIsoValida, diferencasTanque, hojeBrasil, medicaoPreenchida, mesclar, motivoNaoAprovavel, nomeDoCatalogo,
  normalizarEquipamento, normalizarNome, novoResultado, OSRef, ResultadoValidacao, ROTULOS_AGENDAMENTO, ROTULOS_COLETA,
  sugestaoCatalogo, tanqueComMedidas, temErros, validarAgendamento, validarColeta, validarOS, validarPdf,
  arquivoRelatorioRepetido, codigoRelatorio, descreverRelatorio, emAprovacaoDoTipo, examinarArquivoRelatorio, faixaVolume,
  planejarEnvio, rascunhoDoTipo, RELATORIO_MAX_BYTES, RelatorioRef, revisaoDoTipo, ROTULO_STATUS_RELATORIO, ROTULO_TIPO,
  tipoDaFase, type FormatoRelatorio, type TipoRelatorio,
  avisosAprovacao, avisosAprovacaoExecucao, avisosAssinatura, categoriasReprovacao, formatarMotivo, mudancasDesdeEnvio, PERFIS_ASSINADO,
  PERFIS_TROCAR_ASSINADO, resumoValidacao, ROTULOS_REPROVACAO, validarReprovacao,
  aguaPotavelDesmarcada, avisosExecucao, CHECKLIST_PADRAO, diasSemRdo, execucaoAtiva, nomesEquipamentosProcedimento,
  periodoDe, periodoMudou, periodosSobrepoem, textoDiasSemRdo, textoPeriodo, equipamentosFaltando,
  MSG_LAUDO_OBRIGATORIO, procedimentoUsaLaudo, type LaudoPdf,
} from "@/lib/validacao";
import { arquivosDaOS, enviarLaudoPdf, examinarLaudoLocal } from "@/lib/asp/laudo-pdf";
import EncerramentoOS from "@/app/components/EncerramentoOS";
import EntregasCliente from "@/app/components/EntregasCliente";
import { agendamentoFuturo, ativoNoCatalogo, contatosAtivos, textoEncerrada } from "@/lib/validacao";

interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  endereco: string | null;
  data_abertura?: string | null;
  atualizado_em?: string | null;
  cliente: { id?: string; razao_social: string; updated_at?: string | null } | null;
}
interface Inspecao {
  id: string;
  identificacao: string;
  /** Código do procedimento do Catálogo — define o formato do relatório. */
  procedimento?: string | null;
  /** Cadastro do tanque: dimensões, capacidade e material. */
  tanque?: Tanque | null;
  fase: number;
  ferramenta_coleta: string;
  status_relatorio_inspecao: string;
  status_relatorio_execucao: string;
  /** Quando TAG/procedimento/tanque mudaram (aviso da aprovação). */
  cadastro_atualizado_em?: string | null;
  /** Fase 10: encerrada (data) e por quem; manual = ignorou pendências. */
  encerrada_em?: string | null;
  encerrada_por?: string | null;
  encerramento_manual?: boolean;
  encerramento_justificativa?: string | null;
  projeto: Projeto | null;
}
interface Historico {
  id: string;
  fase_de: number;
  fase_para: number;
  acao: string;
  motivo: string | null;
  motivo_categoria?: string | null;
  relatorio_id?: string | null;
  data_autenticacao: string | null;
  criado_em: string;
  autor_perfil: { nome_completo: string | null; email: string | null } | null;
}
interface Coleta {
  id: string; tipo: string; pdf_path: string | null; dados: any; criado_em: string; aprovada_em?: string | null;
  /** Fase 3: dia da coleta (AAAA-MM-DD), quem mediu, descrição do anexo. */
  data_coleta?: string | null; responsavel_id?: string | null; descricao?: string | null;
  arquivo_hash?: string | null; aprovacao_retirada_em?: string | null; atualizado_em?: string | null;
}
/** Salvar medição (Medidor) aguardando confirmar data/responsável. */
interface ConfirmacaoMedicao {
  modo: "salvar" | "pdf";
  dados: any;
  /** Coleta aberta (edição) — null = medição nova, que nasce com `idNovo`. */
  editId: string | null;
  idNovo: string;
}
interface Relatorio {
  id: string; tipo: string; versao: number; status: string; motivo_ajuste: string | null; enviado_em: string | null; dados?: any;
  /** Fase 4: SHA-256 do arquivo; substituída por outra versão enviada depois. */
  arquivo_hash?: string | null; substituido_por?: string | null; substituido_em?: string | null;
  /** Fases 5/9: quem enviou/avaliou, categoria da reprovação e a versão assinada. */
  enviado_por?: string | null; aprovado_por?: string | null; avaliado_por?: string | null; avaliado_em?: string | null;
  motivo_categoria?: string | null; atualizado_em?: string | null;
  assinado_path?: string | null; assinado_hash?: string | null; assinado_por?: string | null; assinado_em?: string | null;
}
interface MembroEquipe { id: string; nome: string }
interface Agendamento {
  id: string; tipo: string; data_visita: string | null; data_execucao: string | null; hora: string | null;
  /** Execução de vários dias: último dia (null = um dia só). */
  data_fim?: string | null;
  equipe: MembroEquipe[]; equipamentos: string[]; checklist: { item: string; ok?: boolean }[];
  criado_em: string;
  /** "Data a definir": pendente, sem data da visita. */
  a_definir?: boolean; lembrar_em?: string | null;
  /** Remarcado: saiu de cena (histórico); substituido_por = o que ficou no lugar. */
  substituido_em?: string | null; substituido_por?: string | null;
}
interface UsuarioOpcao { id: string; nome: string; perfil: string; funcao: string | null }
/** Arquivo do projeto, classificado para exibição agrupada. */
interface ArquivoProjeto {
  grupo: "inspecao" | "execucao" | "laudo" | "medicao" | "rdo";
  inspecao: string; rotulo: string; data?: string | null; href: string;
  /** Laudo: caminho do PDF (o mesmo arquivo aparece uma vez só). */
  chave?: string;
}

// Fase 1 é nível-projeto (abertura); as demais correm na inspeção.
const TODAS_FASES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
function nomeFase(n: number) {
  return n === 1 ? "Abertura do Projeto" : tituloFase(n);
}

// Ferramentas de coleta: só o medidor de sedimento está ativo (COWORK-ASP §2.5).
const FERRAMENTAS_FUTURAS = ["Ultrassom", "Drone", "MFL"];
// Itens iniciais do checklist de campo (extensível) — COWORK-ASP §3.2:
// CHECKLIST_PADRAO, em lib/validacao/agendamento.ts (a Fase 6 avisa os de
// segurança sem marcar quando a execução começa).

// Botões compactos da barra de Coletas (cabem melhor no card).
const btnColeta: React.CSSProperties = { padding: "5px 9px", fontSize: 12, lineHeight: 1.2 };

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};

export default function InspecaoDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [insp, setInsp] = useState<Inspecao | null>(null);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [coletas, setColetas] = useState<Coleta[]>([]);
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [perfil, setPerfil] = useState<string | null>(null);
  const [funcao, setFuncao] = useState<string | null>(null);
  const [aprovandoColeta, setAprovandoColeta] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [reprovar, setReprovar] = useState<OpcaoAcao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tentouReprovar, setTentouReprovar] = useState(false);
  /** Trava síncrona contra duplo clique (o estado só muda no próximo render). */
  const processandoRef = useRef(false);
  /** Fases 5/9: nomes (id → nome), quem sou eu, versões que já baixei. */
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [visualizados, setVisualizados] = useState<string[]>([]);
  const [fotosExecucaoEm, setFotosExecucaoEm] = useState<string | null>(null);
  /** Versão assinada: relatório escolhido + troca (Gerência/Admin). */
  const [assinando, setAssinando] = useState<{ id: string; substituir: boolean } | null>(null);
  const [enviandoAssinado, setEnviandoAssinado] = useState<string | null>(null);
  const [erroAssinado, setErroAssinado] = useState<string | null>(null);
  const assinadoInputRef = useRef<HTMLInputElement>(null);

  // Coleta
  const [modalMedidor, setModalMedidor] = useState(false);
  const [enviandoColeta, setEnviandoColeta] = useState(false);
  // Medidor: salvar/editar medição (registro editável = Relatório Técnico interno)
  const medidorRef = useRef<HTMLIFrameElement>(null);
  const [coletaEditando, setColetaEditando] = useState<string | null>(null);
  const editandoRef = useRef<string | null>(null);
  const dadosCarregarRef = useRef<any>(null);
  const [salvandoMedicao, setSalvandoMedicao] = useState(false);
  const [gerandoPdfMedicao, setGerandoPdfMedicao] = useState(false);
  /** Quando true, o próximo asp:save vira PDF anexado em vez de só salvar. */
  const querPdfRef = useRef(false);
  // Fase 3: antes de gravar, a medição passa por uma confirmação com data da
  // coleta, responsável e as regras (lib/validacao/coleta.ts + medicao.ts).
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoMedicao | null>(null);
  const [cfData, setCfData] = useState("");
  const [cfResp, setCfResp] = useState("");
  const [cfServidor, setCfServidor] = useState<ResultadoValidacao>(novoResultado());
  const [cfErro, setCfErro] = useState<string | null>(null);
  const [atualizandoTanque, setAtualizandoTanque] = useState(false);
  /** Mensagem curta na barra do medidor (ex.: "PDF anexado"). */
  const [msgMedidor, setMsgMedidor] = useState<string | null>(null);
  // Anexo (PDF avulso): descrição obrigatória, data e o arquivo.
  const [modalAnexo, setModalAnexo] = useState(false);
  const [anxDescricao, setAnxDescricao] = useState("");
  const [anxData, setAnxData] = useState("");
  const [anxArquivo, setAnxArquivo] = useState<File | null>(null);
  const [anxErroArquivo, setAnxErroArquivo] = useState<string | null>(null);
  const [anxHash, setAnxHash] = useState<string | null>(null);
  const [anxId, setAnxId] = useState("");
  const [anxTentou, setAnxTentou] = useState(false);
  const [anxServidor, setAnxServidor] = useState<ResultadoValidacao>(novoResultado());
  const [anxErro, setAnxErro] = useState<string | null>(null);
  // Importação de batimetria (CSV/XLSX no layout da planilha)
  const [modalImport, setModalImport] = useState(false);
  const [impDiametro, setImpDiametro] = useState("");
  const [impAltura, setImpAltura] = useState("");
  const [excluindoColeta, setExcluindoColeta] = useState<string | null>(null);
  const [impFormato, setImpFormato] = useState<"circulo" | "quadrado" | "retangulo" | "ngon" | "custom">("circulo");
  const [impLargura, setImpLargura] = useState("");
  const [impLados, setImpLados] = useState("6");
  const [impVertices, setImpVertices] = useState("");
  const [impUnidade, setImpUnidade] = useState<"m" | "cm">("m");
  const [impArquivo, setImpArquivo] = useState<File | null>(null);
  const [importando, setImportando] = useState(false);
  const [impErro, setImpErro] = useState<string | null>(null);
  const [modalEntrada, setModalEntrada] = useState(false);
  const [modalModelo, setModalModelo] = useState(false);
  const [modN, setModN] = useState("5");
  const [modM, setModM] = useState("11");
  const [gerandoModelo, setGerandoModelo] = useState(false);
  // Relatório
  const [enviandoRelatorio, setEnviandoRelatorio] = useState(false);
  const [modalRelatorio, setModalRelatorio] = useState(false);
  // Rascunho aberto para edição — snapshot reidrata o formulário e o id faz
  // o salvamento sobrescrever o registro (mesma versão), sem empilhar cópias.
  const [rascunhoEmEdicao, setRascunhoEmEdicao] = useState<{ id: string; dados: any | null } | null>(null);
  const [excluindoRelatorio, setExcluindoRelatorio] = useState<string | null>(null);
  /** Erro do card de Relatórios. Separado do erro geral porque este é
   *  renderizado no topo da página — longe do botão, o usuário não via. */
  const [erroRelatorio, setErroRelatorio] = useState<string | null>(null);
  /** Contato do cliente (cadastro), para preencher o tópico 1 do relatório. */
  const [contatoCliente, setContatoCliente] = useState("");
  const [procedimentos, setProcedimentos] = useState<any[]>([]);
  const [salvandoProc, setSalvandoProc] = useState(false);
  /** Erro do seletor de procedimento. Separado do `erro` geral, que é
   *  renderizado num card bem abaixo — ali a falha passava despercebida e o
   *  campo parecia simplesmente "não salvar". */
  const [erroProc, setErroProc] = useState<string | null>(null);
  // Renomear a inspeção: o título vira TAG no relatório e nome dos arquivos.
  const [editandoTitulo, setEditandoTitulo] = useState(false);
  const [tituloNovo, setTituloNovo] = useState("");
  const [salvandoTitulo, setSalvandoTitulo] = useState(false);
  // Cadastro do tanque: nasce na criação da inspeção (dentro do projeto) e é
  // corrigido aqui. Alimenta a identificação do tanque no relatório.
  const [editandoTanque, setEditandoTanque] = useState(false);
  const [tanqueForm, setTanqueForm] = useState<TanqueForm>({ ...TANQUE_FORM_VAZIO });
  const [salvandoTanque, setSalvandoTanque] = useState(false);
  const [erroTanque, setErroTanque] = useState<string | null>(null);
  /** Relatório de fora (PDF/DOCX) escolhido, aguardando a confirmação que
   *  mostra a versão que será criada. O tipo é sempre o da fase da OS. */
  const [envioExterno, setEnvioExterno] = useState<{
    arquivo: File; formato: FormatoRelatorio | null; erro: string | null; chave: string;
    /** Fase 8: PDF do laudo (relatório de execução com laudo) já no storage. */
    laudo?: LaudoPdf | null; erroLaudo?: string | null; enviandoLaudo?: boolean;
  } | null>(null);
  const [verificandoArquivo, setVerificandoArquivo] = useState(false);
  const relatorioInputRef = useRef<HTMLInputElement>(null);
  // Agendamento
  const [modalAgenda, setModalAgenda] = useState(false);
  const [agendaEditando, setAgendaEditando] = useState<string | null>(null);
  const [agData, setAgData] = useState("");
  /** Execução de vários dias: último dia (vazio = um dia só). */
  const [agDataFim, setAgDataFim] = useState("");
  const [agDataFimOriginal, setAgDataFimOriginal] = useState<string | null>(null);
  const [agDataExec, setAgDataExec] = useState("");
  const [agHora, setAgHora] = useState("");
  const [agEquipeIds, setAgEquipeIds] = useState<string[]>([]);
  const [agEquipamentos, setAgEquipamentos] = useState<string[]>([]);
  const [agEquipInput, setAgEquipInput] = useState("");
  const [agChecklist, setAgChecklist] = useState<{ item: string; ok: boolean }[]>([]);
  const [agNovoItem, setAgNovoItem] = useState("");
  /** Tipo do agendamento no modal: o da etapa (novo) ou o gravado (edição). */
  const [agTipo, setAgTipo] = useState<"inspecao" | "execucao">("inspecao");
  /** "Data a definir": agendamento pendente, sem data; "lembrar em" opcional. */
  const [agADefinir, setAgADefinir] = useState(false);
  const [agLembrar, setAgLembrar] = useState("");
  /** Equipe como estava gravada (edição) — mantém o nome de quem ficou inativo. */
  const [agEquipeGravada, setAgEquipeGravada] = useState<MembroEquipe[]>([]);
  /** Data gravada do agendamento em edição (remarcação / registro antigo). */
  const [agDataOriginal, setAgDataOriginal] = useState<string | null>(null);
  /** Recusa imediata ao adicionar equipamento/item repetido. */
  const [agMsgEquip, setAgMsgEquip] = useState<string | null>(null);
  const [agMsgItem, setAgMsgItem] = useState<string | null>(null);
  /** Contexto do banco (/api/agendamentos/verificar) para validar no modal. */
  const [agCtx, setAgCtx] = useState<Partial<ContextoAgendamento>>({});
  const [agTentou, setAgTentou] = useState(false);
  const [agServidor, setAgServidor] = useState<ResultadoValidacao>(novoResultado());
  /** Equipamentos do Catálogo — sugestões (datalist) e "seria …?". */
  const [catalogoEquip, setCatalogoEquip] = useState<string[]>([]);
  /** Catálogo completo (slug + nome): equipamentos previstos no procedimento. */
  const [catalogoEquipCompleto, setCatalogoEquipCompleto] = useState<{ slug?: string; id?: string; nome?: string }[]>([]);
  /** Card da execução: adicionando os equipamentos do procedimento. */
  const [adicionandoEquip, setAdicionandoEquip] = useState<string | null>(null);
  // Renomear: OSs do projeto para checar identificação repetida.
  const [ordensProjeto, setOrdensProjeto] = useState<OSRef[]>([]);
  const [servidorTitulo, setServidorTitulo] = useState<string | null>(null);
  const [salvandoAgenda, setSalvandoAgenda] = useState(false);
  /** Erro do modal de agendamento — mostrado dentro dele, não no card de
   *  ações, que fica escondido atrás do modal aberto. */
  const [erroAgenda, setErroAgenda] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioOpcao[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoProjeto[]>([]);
  /** Coleta de fotos da execução, como o card a mostra — alimenta o aviso ao
   *  concluir a Execução e as fotos do Relatório de Execução. */
  const [fotosExec, setFotosExec] = useState<RegistroFotosExecucao | null>(null);
  // Seções recolhíveis: o que os componentes filhos contam para o resumo e
  // para abrir a seção sozinha (erro, fotos na fila).
  const [fotosLocais, setFotosLocais] = useState({ fila: 0, enviando: 0 });
  const [erroFotos, setErroFotos] = useState<string | null>(null);
  const [erroChecklist, setErroChecklist] = useState<string | null>(null);
  const [resumoChecklist, setResumoChecklist] = useState("");
  /** RDOs que cobrem esta inspeção — resumo da seção e aviso ao concluir a
   *  Execução. null = ainda não carregou (não avisa sem saber). */
  const [rdosInsp, setRdosInsp] = useState<RegistroRdo[] | null>(null);
  const [erroRdos, setErroRdos] = useState<string | null>(null);
  /** Incrementa para o componente de RDOs abrir o formulário de um novo. */
  const [pedidoNovoRdo, setPedidoNovoRdo] = useState(0);
  /** Lista completa das 10 fases no cabeçalho (recolhida por padrão). */
  const [verFases, setVerFases] = useState(false);
  /** Modal com o seletor de procedimento (antes ficava sempre aberto no topo). */
  const [editandoProc, setEditandoProc] = useState(false);
  /** Sobe a cada recarga: o card do encerramento e as entregas reconsultam. */
  const [versaoDados, setVersaoDados] = useState(0);
  const [resumoEntregas, setResumoEntregas] = useState("");
  /** Barra "Ações desta fase" (no cabeçalho) — recebe o foco depois de aplicar uma ação. */
  const cardAcoesRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(() => {
    fetch(`/api/inspecoes/${id}`)
      .then(async (r) => {
        if (r.status === 401) { window.location.href = "/login"; return; }
        if (r.status === 404) { setNaoEncontrado(true); return; }
        const d = await r.json();
        setInsp(d.inspecao);
        setHistorico(d.historico || []);
        setColetas(d.coletas || []);
        setRelatorios(d.relatorios || []);
        setAgendamentos(d.agendamentos || []);
        setNomes(d.nomes || {});
        if (d.usuarioId) setUsuarioId(d.usuarioId);
        setVisualizados(d.visualizados || []);
        setFotosExecucaoEm(d.fotosExecucaoEm || null);
        setVersaoDados((v) => v + 1);
      })
      .finally(() => setCarregando(false));
  }, [id]);

  useEffect(() => {
    carregar();
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUsuarioId(data.user.id);
      const { data: p } = await supabase.from("gp_profiles").select("perfil, funcao, nome_completo").eq("id", data.user.id).single();
      setPerfil(p?.perfil ?? null);
      setFuncao((p as any)?.funcao ?? null);
    });
    fetch("/api/usuarios").then((r) => r.ok ? r.json() : { usuarios: [] }).then((d) => setUsuarios(d.usuarios || [])).catch(() => {});
    fetch("/api/catalogo").then((r) => r.ok ? r.json() : {}).then((d: any) => {
      setProcedimentos(d.procedimentos || []);
      // Sugestões do agendamento: só equipamentos ativos. A lista completa
      // (abaixo) resolve os slugs que o procedimento da OS já usa.
      setCatalogoEquip((d.equipamentos || []).filter((e: any) => ativoNoCatalogo(e)).map((e: any) => e.nome).filter(Boolean));
      setCatalogoEquipCompleto(d.equipamentos || []);
    }).catch(() => {});
  }, [carregar]);

  const acoes = useMemo(() => (insp ? acoesDisponiveis(perfil, insp.fase) : []), [insp, perfil]);

  // Contato do cliente: preenche o campo "Contato" do tópico 1 do relatório.
  // Usa o primeiro contato ATIVO cadastrado (o principal); o campo segue editável.
  const clienteId = insp?.projeto?.cliente?.id;
  useEffect(() => {
    if (!clienteId) { setContatoCliente(""); return; }
    fetch(`/api/orgaos/${clienteId}`).then((r) => (r.ok ? r.json() : {})).then((d: any) => {
      const c = contatosAtivos<any>(d.orgao?.contatos)[0];
      const nome = c?.nome_completo || c?.nome || "";
      setContatoCliente(nome && c?.cargo ? `${nome} (${c.cargo})` : nome);
    }).catch(() => {});
  }, [clienteId]);

  // Arquivos do projeto desta inspeção (mesma fonte da aba Arquivos).
  const projetoId = insp?.projeto?.id;
  useEffect(() => {
    if (!projetoId) return;
    fetch("/api/arquivos").then((r) => r.ok ? r.json() : { projetos: [] }).then((d: any) => {
      const proj = (d.projetos || []).find((p: any) => p.id === projetoId);
      const lista: ArquivoProjeto[] = [];
      for (const i of proj?.inspecoes || []) {
        for (const c of i.coletas || []) {
          lista.push({ grupo: "medicao", inspecao: i.identificacao,
            rotulo: `Medição (${c.tipo || "sedimento"})`, data: c.criado_em,
            href: `/api/coletas/${c.id}/download` });
        }
        for (const r of i.relatorios || []) {
          lista.push({ grupo: r.tipo === "execucao" ? "execucao" : "inspecao", inspecao: i.identificacao,
            rotulo: `Relatório v${r.versao} — ${r.status}`, data: r.enviado_em,
            href: `/api/relatorios/${r.id}/download` });
          if (r.assinado_path) {
            lista.push({ grupo: r.tipo === "execucao" ? "execucao" : "inspecao", inspecao: i.identificacao,
              rotulo: `Relatório v${r.versao} — versão assinada`, data: r.enviado_em,
              href: `/api/relatorios/${r.id}/download?arquivo=assinado` });
          }
          // Fase 8: o PDF do laudo, uma vez por arquivo (várias versões podem usar o mesmo).
          if (r.laudo?.caminho && !lista.some((a) => a.grupo === "laudo" && a.chave === r.laudo.caminho)) {
            lista.push({ grupo: "laudo", inspecao: i.identificacao, chave: r.laudo.caminho,
              rotulo: `${r.laudo.nome || "Laudo"} — relatório de execução v${r.versao}`, data: r.laudo.enviado_em || r.enviado_em,
              href: `/api/relatorios/${r.id}/download?arquivo=laudo` });
          }
        }
      }
      // RDOs são do projeto (um por dia, podem cobrir várias inspeções).
      for (const r of proj?.rdos || []) {
        lista.push({ grupo: "rdo", inspecao: `RDO nº ${numeroRdo(r.numero)}`,
          rotulo: `${dataBr(r.data)}${r.inspecoes?.length ? ` — ${r.inspecoes.join(", ")}` : ""}`,
          href: `/api/rdos/${r.id}/download` });
      }
      setArquivos(lista);
    }).catch(() => {});
  }, [projetoId, relatorios, coletas, rdosInsp]);

  // Agendamentos ATIVOS valem para tudo (resumo, relatório, conflitos); os
  // remarcados (substituídos) só aparecem no histórico da seção.
  const agAtivos = useMemo(() => agendamentos.filter((a) => !a.substituido_em), [agendamentos]);
  const agRemarcados = useMemo(() => agendamentos.filter((a) => a.substituido_em), [agendamentos]);

  // ── Fase 6: execução ─────────────────────────────────────────────────────
  const hojeExec = hojeBrasil();
  /** Procedimento da OS no Catálogo (equipamentos previstos, água potável). */
  const procOS = procedimentos.find((p) => p.codigo === insp?.procedimento) || null;
  /** Arquivos da OS que o PDF do laudo não pode repetir (SHA-256). */
  const arquivosOS = useMemo(() => arquivosDaOS(relatorios, coletas), [relatorios, coletas]);
  /** Nomes previstos no procedimento; undefined enquanto o Catálogo não chega. */
  const equipProcOS = useMemo(
    () => (procedimentos.length && catalogoEquipCompleto.length
      ? nomesEquipamentosProcedimento(procOS?.equipamentos, catalogoEquipCompleto.filter((e: any) => ativoNoCatalogo(e))) : undefined),
    [procedimentos, catalogoEquipCompleto, procOS]
  );
  /** Função de cada usuário ativo (Coordenador/Engenheiro/Técnico). */
  const funcoesUsuarios = useMemo(
    () => (usuarios.length ? Object.fromEntries(usuarios.map((u) => [u.id, u.funcao])) : undefined),
    [usuarios]
  );
  /** O agendamento de execução ativo com data e o período dele. */
  const agExec = useMemo(() => execucaoAtiva(agAtivos), [agAtivos]);
  const periodoExec = periodoDe(agExec);
  /** Unidade e limite de aviso do cloro do procedimento (Fase 7). */
  const cloroOS = cloroDoProcedimento(procOS);
  const avisosExec = avisosExecucao({ ag: agExec, hoje: hojeExec, equipamentosProcedimento: equipProcOS, funcoes: funcoesUsuarios });
  /** Água potável no procedimento × coletas de água desmarcadas nas fotos. */
  const avisoAgua = aguaPotavelDesmarcada(procOS?.agua_potavel, fotosExec);
  /** Dias já passados do período sem RDO desta OS (resumo da seção). */
  const diasSemRdoAteHoje = rdosInsp ? diasSemRdo(periodoExec, rdosInsp.map((r) => r.data), hojeExec, hojeExec) : [];

  /** O tipo do relatório é o da fase: inspeção até a 5, execução da 6 em
   *  diante (a API recusa o outro). */
  const bloco: TipoRelatorio = tipoDaFase(insp?.fase ?? 2);
  /** Fase 8: relatório de execução de procedimento com laudo — o PDF do
   *  laudo do laboratório é exigido para enviar para aprovação. */
  const exigeLaudoExecucao = bloco === "execucao" && procedimentoUsaLaudo(procOS);
  const refsRelatorio = useMemo<RelatorioRef[]>(
    () => relatorios.map((r) => ({ id: r.id, tipo: r.tipo, versao: r.versao, status: r.status, arquivoHash: r.arquivo_hash || null, assinadoHash: r.assinado_hash || null })),
    [relatorios]
  );
  /** Agendamento ativo do MESMO tipo do relatório (data e equipe). */
  const agDoBloco = useMemo(() => agAtivos.find((a) => a.tipo === bloco) || null, [agAtivos, bloco]);
  // Revisão: reprovações ("Ajustar") do MESMO tipo — a de inspeção não
  // conta no relatório de execução.
  const revisaoRelatorio = revisaoDoTipo(refsRelatorio, bloco);
  const codigoProjetoOS = insp?.projeto?.codigo_projeto || insp?.projeto?.pedido_compra || "";
  const rascunhoBloco = rascunhoDoTipo(refsRelatorio, bloco);
  /** Fases 5/9: o relatório que a Gerência está avaliando (o mostrado). */
  const relEmAvaliacao = insp && (insp.fase === 5 || insp.fase === 9)
    ? emAprovacaoDoTipo(refsRelatorio, tipoDaFase(insp.fase))[0] || null : null;
  const relAval = relEmAvaliacao ? relatorios.find((r) => r.id === relEmAvaliacao.id) || null : null;
  /** Nome de um usuário (id) — para "Aprovado por…", "Enviado por…". */
  const nomeDe = (uid?: string | null) => (uid ? nomes[uid] || usuarios.find((u) => u.id === uid)?.nome || "usuário" : "");

  /** O que mudou na OS depois do envio da versão em avaliação (melhor esforço). */
  const mudancasAval = useMemo(() => {
    if (!relAval || !insp) return [];
    const proj = insp.projeto;
    return mudancasDesdeEnvio({
      enviadoEm: relAval.enviado_em, tipo: relAval.tipo, dados: relAval.dados,
      cadastroAtual: {
        cliente: proj?.cliente?.razao_social || "", endereco: proj?.endereco || "", tag: insp.identificacao || "",
        procedimento: insp.procedimento || "", codigoProjeto: proj?.codigo_projeto || proj?.pedido_compra || "",
      },
      cadastroOSEm: insp.cadastro_atualizado_em, projetoEm: proj?.atualizado_em, clienteEm: proj?.cliente?.updated_at,
      coletas: coletas.map((c) => ({
        id: c.id, tipo: c.tipo, criado_em: c.criado_em, atualizado_em: c.atualizado_em, aprovada_em: c.aprovada_em,
        aprovacao_retirada_em: c.aprovacao_retirada_em,
        rotulo: `${c.tipo === "anexo" ? "Anexo" : "Medição"}${c.data_coleta ? ` de ${formatarData(c.data_coleta)}` : ""}`,
      })),
      fotosExecucaoEm,
    });
  }, [relAval, insp, coletas, fotosExecucaoEm]);
  /** ⚠️ ao aprovar a versão mostrada (nenhum bloqueia). Na execução (fase
   *  9) entram os avisos próprios dela: laudo, resultado após a limpeza,
   *  RDOs e fotos — com o que a página já carregou. */
  const avisosAprov = useMemo(() => {
    if (!relAval) return novoResultado();
    const gerais = avisosAprovacao({
      usuarioId, relatorio: relAval, baixou: visualizados.includes(relAval.id),
      temMedicaoAprovada: coletas.some((c) => c.aprovada_em), mudancas: mudancasAval,
    });
    if (relAval.tipo !== "execucao") return gerais;
    return mesclar(gerais, avisosAprovacaoExecucao({
      dados: relAval.dados, usaLaudo: procedimentoUsaLaudo(procOS), unidadeCloro: cloroOS.unidade,
      hoje: hojeExec, periodo: periodoExec, rdos: rdosInsp, coleta: fotosExec,
    }));
  }, [relAval, usuarioId, visualizados, coletas, mudancasAval, procOS, cloroOS.unidade, hojeExec, periodoExec, rdosInsp, fotosExec]);

  /** Reprovação: categoria + descrição; aviso se repetir a anterior do tipo. */
  const reprovacaoAnterior = useMemo(() => {
    if (!relAval) return null;
    const ant = relatorios
      .filter((r) => r.tipo === relAval.tipo && r.status === "ajustar" && r.motivo_ajuste)
      .sort((a, b) => (b.avaliado_em || "").localeCompare(a.avaliado_em || "") || b.versao - a.versao)[0];
    return ant ? { descricao: ant.motivo_ajuste, versao: ant.versao } : null;
  }, [relAval, relatorios]);
  const valReprovacao = useMemo(
    () => validarReprovacao({ categoria, descricao: motivo, anterior: reprovacaoAnterior, tipo: relAval?.tipo || null }),
    [categoria, motivo, reprovacaoAnterior, relAval?.tipo]
  );
  /** Fase 10: OS encerrada = só consulta (a API recusa as gravações com 409). */
  const encerrada = !!insp?.encerrada_em;
  const podeAssinar = PERFIS_ASSINADO.includes(perfil || "") && !encerrada;
  const podeTrocarAssinado = PERFIS_TROCAR_ASSINADO.includes(perfil || "") && !encerrada;
  /** Marca na hora (o servidor grava no download) — o aviso some sem recarregar. */
  const marcarBaixado = (relId: string) => setVisualizados((v) => (v.includes(relId) ? v : [...v, relId]));

  /** Pré-preenchimento do relatório: puxa o que o sistema já sabe — projeto,
   *  cliente, medição (aprovada, senão a mais recente) e cadastro do tanque.
   *  Cliente, TAG, endereço e procedimento ficam só leitura no formulário.
   *  Datas em ISO (o documento as escreve dd/mm/aaaa); medidas em metros. */
  const dadosIniciaisRelatorio = useMemo(() => {
    const proj = insp?.projeto;
    // Material, capacidade e medidas de projeto vêm do cadastro do tanque.
    const doTanque = dadosRelatorioDoTanque(insp?.tanque);
    const comDados = coletas.filter((c) => c.tipo !== "anexo" && medicaoPreenchida(c.dados));
    const auto = camposDaMedicao((comDados.find((c) => c.aprovada_em) || comDados[0])?.dados);
    // A data de execução vem do agendamento do MESMO tipo — sem cair no do
    // outro tipo (seria a data de outro serviço).
    const ag = agDoBloco;
    const dataServico = bloco === "execucao"
      ? (ag?.data_execucao || ag?.data_visita)
      : (ag?.data_visita || ag?.data_execucao);
    const hoje = hojeBrasil();
    const nomeProc = procedimentos.find((p) => p.codigo === insp?.procedimento)?.nome;
    const volume = auto.volumeSedimento || "";
    return {
      // O título nasce do procedimento da OS (não é sempre "Batimetria").
      titulo: insp ? `${nomeProc || "Relatório técnico"} — ${insp.identificacao}` : "",
      cliente: proj?.cliente?.razao_social || "",
      endereco: proj?.endereco || "",
      revisao: String(revisaoRelatorio),
      dataRevisao: hoje,
      // Campo "Relatório" da capa segue o padrão do modelo: "37/MG/26 Rev1".
      codigoProjeto: codigoProjetoOS,
      relatorioCodigo: codigoRelatorio(codigoProjetoOS, revisaoRelatorio),
      dataExecucao: dataServico && /^\d{4}-\d{2}-\d{2}/.test(dataServico) ? dataServico.slice(0, 10) : "",
      contato: contatoCliente,
      procedimento: insp?.procedimento || "",
      dataRelatorio: hoje,
      tag: insp?.identificacao || "",
      material: doTanque.material,
      // A medição em campo tem a última palavra sobre as medidas; sem
      // medição, vale o cadastro do tanque. Capacidade é um campo só.
      alturaTanque: auto.alturaTanque || doTanque.alturaTanque,
      diametro: auto.diametro || doTanque.diametro,
      comprimento: auto.comprimento || doTanque.comprimento,
      largura: auto.largura || doTanque.largura,
      capacidadeTanque: auto.capacidadeTanque || doTanque.capacidadeNominal,
      volumeSedimento: volume,
      // Faixa de ±5% sobre o volume medido (texto do tópico 7) — derivada.
      ...faixaVolume(volume),
    };
  }, [insp, coletas, agDoBloco, bloco, revisaoRelatorio, codigoProjetoOS, contatoCliente, procedimentos]);
  const podeColeta = ["admin", "operacoes", "gerencia"].includes(perfil || "") && !encerrada;
  const podeAgenda = ["admin", "comercial", "gerencia"].includes(perfil || "") && !encerrada;
  const podeRelatorio = ["admin", "operacoes", "gerencia"].includes(perfil || "") && !encerrada;
  const podeRenomear = ["admin", "operacoes", "gerencia", "comercial"].includes(perfil || "") && !encerrada;
  const podeAprovarMedicao = podeAprovarColeta({ perfil, funcao }) && !encerrada;

  // Reprovação que trouxe a inspeção de volta para esta fase (o histórico
  // vem do mais recente para o mais antigo): abre Relatórios e Histórico e
  // o motivo aparece no card de ações.
  const ultimaMov = historico[0];
  const reprovacao = insp && ultimaMov?.acao === "reprovar" && ultimaMov.fase_para === insp.fase ? ultimaMov : null;
  const secoes = useSecoes({
    inspecaoId: id,
    // null até a página renderizar as seções (a âncora precisa delas no DOM).
    fase: carregando || !insp ? null : insp.fase,
    perfil,
    reprovadoAgora: !!reprovacao,
    forcadas: {
      relatorios: !!erroRelatorio,
      checklist: !!erroChecklist,
      fotos: !!erroFotos || fotosLocais.fila + fotosLocais.enviando > 0,
      rdos: !!erroRdos,
    },
  });

  async function aplicar(acao: string, motivoTexto?: string, categoriaMotivo?: string) {
    if (processandoRef.current) return;   // duplo clique: o 2º nem sai
    processandoRef.current = true;
    setErro(null);
    setProcessando(true);
    try {
      // Aprovar/reprovar age sobre o relatório MOSTRADO (não "todos em aprovação").
      const relatorioId = acao === "aprovar" || acao === "reprovar" ? relEmAvaliacao?.id : undefined;
      // faseDe: a API recusa (409) se a OS já saiu desta fase — não anda 2x.
      const res = await enviarJson(`/api/inspecoes/${id}/fase`, "POST",
        { acao, motivo: motivoTexto, categoria: categoriaMotivo, relatorioId, faseDe: insp?.fase }, "Ação de fase");
      if (res.queued) { setReprovar(null); setMotivo(""); setCategoria(""); alert("Sem conexão — ação salva offline e aplicada ao reconectar."); return; }
      if (!res.ok) {
        setErro(res.data?.erro || "Não foi possível aplicar a ação.");
        if (res.status === 409) { setReprovar(null); carregar(); }
        return;
      }
      setReprovar(null);
      setMotivo("");
      setCategoria("");
      carregar();
      // A fase mudou: as seções abaixo se rearrumam para o novo padrão. O
      // foco volta ao card de ações, que mostra o que fazer agora.
      cardAcoesRef.current?.focus({ preventScroll: true });
      cardAcoesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      processandoRef.current = false;
      setProcessando(false);
    }
  }

  function clicarAcao(opcao: OpcaoAcao) {
    // ⛔ Aprovar/reprovar sem relatório em aprovação (a API recusa também).
    if ((insp?.fase === 5 || insp?.fase === 9) && (opcao.acao === "aprovar" || opcao.acao === "reprovar") && !relEmAvaliacao) {
      setErro(`Nenhum relatório de ${ROTULO_TIPO[tipoDaFase(insp.fase)]} em aprovação — não há o que ${opcao.acao === "aprovar" ? "aprovar" : "reprovar"}.`);
      return;
    }
    if (opcao.exigeMotivo) { setMotivo(""); setCategoria(""); setTentouReprovar(false); setErro(null); setReprovar(opcao); return; }
    // Pendências que só AVISAM, num confirm só — quem está em campo decide se
    // segue assim mesmo:
    //  · Inspeção → Relatório (3 → 4) sem medição aprovada (muitas OSs não
    //    têm procedimento de inspeção/medição).
    //  · Execução → Relatório de Execução (7 → 8): coleta de fotos incompleta
    //    e falta de RDO (ex.: vaga sem acesso, RDO feito no papel).
    const blocos: string[] = [];
    let titulo = "Pendências";
    if (insp?.fase === 3 && opcao.acao === "avancar" && !coletas.some((c) => c.aprovada_em)) {
      titulo = "Pendências da Inspeção";
      blocos.push(coletas.some((c) => c.tipo !== "anexo" && medicaoPreenchida(c.dados))
        ? "Nenhuma medição aprovada nesta OS — o relatório usará a medição mais recente, sem validação de Gerência/Coordenação."
        : "Nenhuma medição registrada nesta OS. Se o procedimento não tem medição, pode seguir.");
    }
    //  · Agendamento de Execução → Execução (6 → 7): checklist de segurança
    //    sem marcar com a execução começando; água potável desmarcada.
    if (insp?.fase === 6 && opcao.acao === "avancar") {
      titulo = "Pendências do Agendamento de Execução";
      if (avisosExec.seguranca.length) {
        blocos.push(`Checklist de segurança do agendamento sem marcar (a execução ${periodoExec && periodoExec.inicio < hojeExec ? "já começou" : "começa hoje"}):\n• ${avisosExec.seguranca.join("\n• ")}`);
      }
      if (avisoAgua) blocos.push(avisoAgua);
    }
    if (insp?.fase === 7 && opcao.acao === "avancar") {
      titulo = "Pendências da Execução";
      const pend = fotosExec ? pendenciasColeta(fotosExec) : [];
      if (pend.length > 0) {
        blocos.push(`Coleta de fotos da execução incompleta (${pend.length} pendência(s)):\n• ${pend.join("\n• ")}\n` +
          "As fotos que faltam não entram no Relatório de Execução.");
      }
      // Cada dia do período de execução sem RDO desta OS (fim de semana e
      // feriado vêm marcados — pode ter havido trabalho). Sem período, vale
      // o aviso antigo: nenhum RDO.
      if (rdosInsp !== null) {
        const faltam = diasSemRdo(periodoExec, rdosInsp.map((r) => r.data), hojeExec);
        if (periodoExec && faltam.length > 0) {
          blocos.push(`Dia(s) da execução (${textoPeriodo(periodoExec)}) sem RDO cobrindo esta OS:\n• ${textoDiasSemRdo(faltam).split(", ").join("\n• ")}`);
        } else if (!periodoExec && rdosInsp.length === 0) {
          blocos.push("Nenhum RDO (Registro Diário de Operação) cobre esta OS.");
        }
      }
    }
    //  · Relatório → Aprovação (4 → 5, 8 → 9) sem relatório em aprovação: a
    //    Gerência não teria o que aprovar.
    if ((insp?.fase === 4 || insp?.fase === 8) && opcao.acao === "avancar") {
      const tipo = tipoDaFase(insp.fase);
      if (emAprovacaoDoTipo(refsRelatorio, tipo).length === 0) {
        titulo = insp.fase === 4 ? "Pendências do Relatório de Inspeção" : "Pendências do Relatório de Execução";
        const rasc = rascunhoDoTipo(refsRelatorio, tipo);
        blocos.push(rasc
          ? `O relatório de ${ROTULO_TIPO[tipo]} está só em rascunho (v${rasc.versao}) — não foi enviado para aprovação. A Gerência não terá o que aprovar.`
          : `Nenhum relatório de ${ROTULO_TIPO[tipo]} foi enviado para aprovação nesta OS. A Gerência não terá o que aprovar.`);
      }
    }
    //  · Aprovação (5/9): mesma pessoa, arquivo não baixado, OS mudou depois
    //    do envio, inspeção sem medição aprovada.
    if ((insp?.fase === 5 || insp?.fase === 9) && opcao.acao === "aprovar") {
      const av = resumoValidacao(avisosAprov).avisos;
      if (av.length) { titulo = `Antes de aprovar a v${relEmAvaliacao?.versao}`; blocos.push(...av.map((a) => `• ${a}`)); }
    }
    //  · Versão assinada: seguir da fase 6 sem a de inspeção; encerrar sem a
    //    de execução.
    const semAssinatura = insp ? avisosAssinatura(insp.fase, opcao.acao, refsRelatorio) : [];
    if (semAssinatura.length) { if (!blocos.length) titulo = "Versão assinada"; blocos.push(...semAssinatura.map((a) => `• ${a}`)); }
    const verbo = opcao.acao === "aprovar" ? "Aprovar" : "Avançar";
    if (blocos.length > 0 && !confirm(`${titulo}:\n\n${blocos.join("\n\n")}\n\n${verbo} mesmo assim?`)) return;
    aplicar(opcao.acao);
  }

  /** Abre o "Anexar PDF": anexo é um PDF avulso, com descrição obrigatória. */
  function abrirAnexo() {
    setAnxDescricao(""); setAnxData(dataSugerida); setAnxArquivo(null); setAnxErroArquivo(null); setAnxHash(null);
    setAnxId(novoId()); setAnxTentou(false); setAnxServidor(novoResultado()); setAnxErro(null);
    setModalAnexo(true);
  }

  /** Confere o PDF já na escolha: é PDF de verdade, tamanho e SHA-256 (para
   *  avisar se o mesmo arquivo já está anexado). A API repete tudo. */
  async function escolherArquivoAnexo(f: File | null) {
    setAnxArquivo(f); setAnxErroArquivo(null); setAnxHash(null); setAnxServidor(novoResultado()); setAnxErro(null);
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const problema = validarPdf(bytes, f.size);
    if (problema) { setAnxErroArquivo(problema); return; }
    setAnxHash(await sha256Hex(bytes));
  }

  async function salvarAnexo() {
    setAnxTentou(true);
    setAnxErro(null);
    if (temErros(resultadoAnexo) || !anxArquivo) return;
    setEnviandoColeta(true);
    try {
      const res = await enviarArquivo("/api/coletas",
        { id: anxId, inspecaoId: id, tipo: "anexo", descricao: anxDescricao.replace(/\s+/g, " ").trim(), dataColeta: anxData },
        anxArquivo, "Anexo (PDF)", { chave: anxId });
      if (res.queued) { setModalAnexo(false); alert("Sem conexão — PDF salvo offline e enviado ao reconectar."); return; }
      if (!res.ok) {
        if (res.data?.erros) setAnxServidor({ erros: res.data.erros, avisos: res.data.avisos || {} });
        setAnxErro(res.data?.erro || "Falha ao anexar o PDF.");
        return;
      }
      setModalAnexo(false);
      carregar();
    } finally {
      setEnviandoColeta(false);
    }
  }

  /** Marca qual medição vale para o relatório (uma por inspeção). */
  async function aprovarColeta(c: Coleta) {
    const jaAprovada = !!c.aprovada_em;
    const motivo = jaAprovada ? null : motivoNaoAprovavel(c);
    if (motivo) { setErro(motivo); return; }
    const outraAprovada = coletas.find((x) => x.aprovada_em && x.id !== c.id);
    if (!jaAprovada && outraAprovada &&
        !confirm("Outra medição já está aprovada. Ao aprovar esta, a anterior deixa de valer para o relatório. Continuar?")) return;
    setAprovandoColeta(c.id);
    setErro(null);
    try {
      const res = await fetch(`/api/coletas/${c.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aprovar: !jaAprovada }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data?.erro || "Falha ao aprovar a medição."); return; }
      carregar();
    } catch {
      setErro("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setAprovandoColeta(null);
    }
  }

  /** Troca o procedimento da inspeção (formato do relatório). */
  async function salvarProcedimento(codigo: string) {
    setSalvandoProc(true);
    setErroProc(null);
    // Otimista: o campo mostra a escolha na hora; se falhar, volta ao valor
    // anterior — assim o seletor nunca exibe algo que não foi gravado.
    const anterior = insp?.procedimento ?? "";
    setInsp((p) => (p ? { ...p, procedimento: codigo } : p));
    try {
      const res = await fetch(`/api/inspecoes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procedimento: codigo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInsp((p) => (p ? { ...p, procedimento: anterior } : p));
        setErroProc(data?.erro || `Falha ao salvar o procedimento (HTTP ${res.status}).`);
        return;
      }
      carregar();
    } catch {
      setInsp((p) => (p ? { ...p, procedimento: anterior } : p));
      setErroProc("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setSalvandoProc(false);
    }
  }

  /** Salva o cadastro do tanque (dimensões, capacidade e material). */
  async function salvarTanque() {
    const problema = erroDoTanque(tanqueForm);
    if (problema) { setErroTanque(problema); return; }
    setSalvandoTanque(true);
    setErroTanque(null);
    try {
      const res = await fetch(`/api/inspecoes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tanque: tanqueForm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErroTanque(data?.erro || `Falha ao salvar o tanque (HTTP ${res.status}).`);
        return;
      }
      setEditandoTanque(false);
      carregar();
    } catch {
      setErroTanque("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setSalvandoTanque(false);
    }
  }

  /** Abre a edição do nome e busca as outras OSs do projeto: a identificação
   *  segue única no projeto (mesma regra da criação). */
  function abrirEdicaoTitulo() {
    if (!insp) return;
    setTituloNovo(insp.identificacao);
    setServidorTitulo(null);
    setEditandoTitulo(true);
    if (insp.projeto?.id) {
      fetch(`/api/inspecoes?projetoId=${insp.projeto.id}`).then((r) => (r.ok ? r.json() : {}))
        .then((d: any) => setOrdensProjeto((d.inspecoes || []).map((o: any) => ({ id: o.id, identificacao: o.identificacao }))))
        .catch(() => {});
    }
  }
  const resultadoTitulo = validarOS({ identificacao: tituloNovo }, { ordens: ordensProjeto, excluirId: id, exigirProcedimento: false });

  /** Renomeia a OS. */
  async function salvarTitulo() {
    const titulo = tituloNovo.replace(/\s+/g, " ").trim();
    if (titulo === insp?.identificacao) { setEditandoTitulo(false); return; }
    if (temErros(resultadoTitulo)) return;
    setSalvandoTitulo(true);
    setErro(null);
    try {
      const res = await fetch(`/api/inspecoes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identificacao: titulo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setServidorTitulo(data?.erro || "Falha ao renomear a OS."); return; }
      setEditandoTitulo(false);
      carregar();
    } catch {
      setErro("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setSalvandoTitulo(false);
    }
  }

  /** Exclui a medição — vai para a lixeira, recuperável por 30 dias. */
  async function excluirColeta(c: Coleta) {
    const temMedicao = c.tipo !== "anexo" && medicaoPreenchida(c.dados);
    const rotulo = temMedicao ? "esta medição (Relatório Técnico interno)" : `este anexo (${c.descricao || c.tipo})`;
    const aprovada = c.aprovada_em
      ? "\n\nEla está APROVADA para o relatório: ao excluir, a aprovação é retirada e não volta se ela for restaurada."
      : "";
    if (!confirm(`Excluir ${rotulo}?\n\nEla sai da lista, mas fica recuperável por 30 dias antes de ser apagada definitivamente.${aprovada}`)) return;
    setExcluindoColeta(c.id);
    setErro(null);
    try {
      const res = await fetch(`/api/coletas/${c.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data?.erro || "Falha ao excluir a medição."); return; }
      setColetas((prev) => prev.filter((x) => x.id !== c.id));
    } catch {
      setErro("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setExcluindoColeta(null);
    }
  }

  /** O medidor mandou o estado (asp:save): abre a confirmação com a data da
   *  coleta e o responsável. Nada é gravado sem passar pelas regras. */
  const abrirConfirmacao = useCallback((dados: any, modo: "salvar" | "pdf") => {
    const editId = editandoRef.current;
    const col = editId ? coletasRef.current.find((c) => c.id === editId) : null;
    // A data que o medidor mandou (cabeçalho do relatório) vale como sugestão.
    const dataMedidor = typeof dados?.reportDate === "string" && dataIsoValida(dados.reportDate) ? dados.reportDate : null;
    setCfData(dataMedidor || col?.data_coleta || dataSugeridaRef.current);
    let resp = col?.responsavel_id || "";
    if (!resp && typeof dados?.reportResponsavel === "string" && dados.reportResponsavel.trim()) {
      const alvo = normalizarNome(dados.reportResponsavel);
      resp = usuariosRef.current.find((u) => normalizarNome(u.nome) === alvo)?.id || "";
    }
    setCfResp(resp);
    setCfServidor(novoResultado());
    setCfErro(null);
    setConfirmacao((prev) => ({ modo, dados, editId, idNovo: prev && !prev.editId && !editId ? prev.idNovo : novoId() }));
  }, []);

  /** Grava a medição confirmada: salvar (POST nova / PATCH aberta) ou PDF —
   *  que ATUALIZA a coleta aberta (anexa/substitui o PDF dela) e só cria uma
   *  coleta se a medição ainda não foi salva. Nunca duas. */
  async function confirmarMedicao() {
    if (!confirmacao || temErros(resultadoConfirmacao)) return;
    const { modo, editId, idNovo } = confirmacao;
    const nome = usuarios.find((u) => u.id === cfResp)?.nome || "";
    const dados = { ...confirmacao.dados, reportDate: cfData, reportResponsavel: nome };
    const campos = { dataColeta: cfData, responsavelId: cfResp };
    setSalvandoMedicao(true);
    setCfErro(null);
    try {
      let res;
      if (modo === "pdf") {
        setGerandoPdfMedicao(true);
        const { gerarPdfMedicao } = await import("@/lib/asp/relatorio-medicao");
        const blob = await gerarPdfMedicao(dados, {
          inspecao: insp?.identificacao || "OS",
          projeto: insp?.projeto?.codigo_projeto || insp?.projeto?.pedido_compra || undefined,
          cliente: insp?.projeto?.cliente?.razao_social || undefined,
          dataColeta: cfData,
          responsavel: nome,
        });
        const arquivo = new File([blob], `Medicao-${(insp?.identificacao || "OS").replace(/[^\w-]+/g, "-")}.pdf`, { type: "application/pdf" });
        res = editId
          ? await enviarArquivo(`/api/coletas/${editId}`, { ...campos, dados: JSON.stringify(dados) }, arquivo, "Relatório da medição", { method: "PATCH" })
          : await enviarArquivo("/api/coletas", { id: idNovo, inspecaoId: id, tipo: "sedimento", ...campos, dados: JSON.stringify(dados) },
            arquivo, "Relatório da medição", { chave: idNovo });
      } else {
        res = await enviarJson(
          editId ? `/api/coletas/${editId}` : "/api/coletas",
          editId ? "PATCH" : "POST",
          editId ? { ...campos, dados } : { id: idNovo, inspecaoId: id, tipo: "sedimento", ...campos, dados },
          "Coleta / medição",
          editId ? undefined : idNovo
        );
      }
      if (!res.queued && !res.ok) {
        if (res.data?.erros) setCfServidor({ erros: res.data.erros, avisos: res.data.avisos || {} });
        setCfErro(res.data?.erro || (modo === "pdf" ? "Falha ao anexar o relatório da medição." : "Falha ao salvar a medição."));
        return;
      }
      setConfirmacao(null);
      if (modo === "pdf") {
        // O medidor segue aberto, agora editando a coleta (a mesma, nunca outra).
        if (!editId) { editandoRef.current = idNovo; setColetaEditando(idNovo); }
        medidorRef.current?.contentWindow?.postMessage({ type: "asp:setHeader", reportDate: cfData, reportResponsavel: nome }, window.location.origin);
        setMsgMedidor(res.queued ? "Sem conexão — o PDF será enviado ao reconectar." : "PDF do relatório anexado à medição.");
      } else {
        setModalMedidor(false);
        setColetaEditando(null); editandoRef.current = null; dadosCarregarRef.current = null;
        if (res.queued) alert("Sem conexão — medição salva offline e enviada ao reconectar.");
      }
      if (!res.queued) carregar();
    } catch (e) {
      setCfErro(e instanceof Error ? e.message : "Falha ao salvar a medição.");
    } finally {
      setSalvandoMedicao(false);
      setGerandoPdfMedicao(false);
    }
  }

  /** Atualiza o cadastro do tanque com as medidas da medição (mesma regra da
   *  edição do tanque: erroDoTanque, aqui e na API). */
  async function atualizarTanqueComMedicao() {
    if (!insp?.tanque || !confirmacao) return;
    const novo = tanqueComMedidas(insp.tanque, confirmacao.dados);
    const problema = erroDoTanque(novo);
    if (problema) { setCfErro(problema); return; }
    setAtualizandoTanque(true);
    try {
      const res = await fetch(`/api/inspecoes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tanque: novo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCfErro(data?.erro || "Falha ao atualizar o cadastro do tanque."); return; }
      setInsp((p) => (p ? { ...p, tanque: data.inspecao?.tanque || novo } : p));
    } catch {
      setCfErro("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setAtualizandoTanque(false);
    }
  }

  // Ponte com o iframe do medidor: recebe o snapshot ao salvar e envia os
  // dados salvos ao abrir (asp:ready) para editar. Só aceita mensagens do
  // próprio iframe, na mesma origem.
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin || ev.source !== medidorRef.current?.contentWindow) return;
      const msg = (ev.data || {}) as { type?: string; dados?: any };
      if (msg.type === "asp:ready") {
        if (dadosCarregarRef.current && medidorRef.current?.contentWindow) {
          medidorRef.current.contentWindow.postMessage({ type: "asp:load", dados: dadosCarregarRef.current }, window.location.origin);
        }
      } else if (msg.type === "asp:save") {
        const modo = querPdfRef.current ? "pdf" : "salvar";
        querPdfRef.current = false;
        abrirConfirmacao(msg.dados, modo);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [abrirConfirmacao]);

  /** Medição nova já sai com o tanque do cadastro (formato, medidas, altura,
   *  em metros) e a data sugerida da coleta no cabeçalho. */
  function estadoInicialMedidor(): Record<string, unknown> {
    const t = insp?.tanque;
    const base: Record<string, unknown> = { reportDate: dataSugerida };
    if (!t) return base;
    const ret = t.formato === "retangular";
    return {
      ...base, unit: "m", inputMode: "diameter",
      formato: ret ? "retangulo" : "circulo",
      dimValue: ret ? t.comprimento : t.diametro,
      largura: ret ? t.largura : null,
      height: t.altura,
    };
  }

  function abrirMedidorNovo() {
    setColetaEditando(null); editandoRef.current = null; dadosCarregarRef.current = estadoInicialMedidor();
    setErro(null); setMsgMedidor(null); setModalMedidor(true);
  }
  function abrirMedidorEdicao(c: Coleta) {
    setColetaEditando(c.id); editandoRef.current = c.id; dadosCarregarRef.current = c.dados || null;
    setErro(null); setMsgMedidor(null); setModalMedidor(true);
  }

  /** Pede o estado ao medidor para virar PDF anexado. */
  function pedirPdfMedicao() {
    querPdfRef.current = true;
    setMsgMedidor(null);
    medidorRef.current?.contentWindow?.postMessage({ type: "asp:requestSave" }, window.location.origin);
  }

  function pedirSalvarMedicao() {
    querPdfRef.current = false;
    setMsgMedidor(null);
    medidorRef.current?.contentWindow?.postMessage({ type: "asp:requestSave" }, window.location.origin);
  }

  function carregarNoMedidor(estado: Record<string, unknown>) {
    // Mantém a data sugerida da coleta no cabeçalho do medidor.
    const comData = { reportDate: dataSugerida, ...estado };
    if (modalMedidor) {
      medidorRef.current?.contentWindow?.postMessage({ type: "asp:load", dados: comData }, window.location.origin);
    } else {
      dadosCarregarRef.current = comData;
      setColetaEditando(null); editandoRef.current = null;
      setModalMedidor(true);
    }
  }
  /** Importar: formato, medidas e altura já vêm do cadastro do tanque (m). */
  function abrirImport() {
    const t = insp?.tanque;
    const txt = (v?: number | null) => (v == null ? "" : String(v).replace(".", ","));
    const ret = t?.formato === "retangular";
    setImpFormato(ret ? "retangulo" : "circulo");
    setImpDiametro(txt(ret ? t?.comprimento : t?.diametro));
    setImpLargura(txt(ret ? t?.largura : null));
    setImpAltura(txt(t?.altura));
    setImpUnidade("m"); setImpArquivo(null); setImpErro(null);
    setModalImport(true);
  }
  async function baixarModelo() {
    const N = Math.max(1, Math.min(24, parseInt(modN, 10) || 1));
    const M = Math.max(1, Math.min(60, parseInt(modM, 10) || 1));
    setGerandoModelo(true);
    try {
      const blob = await gerarModeloXlsx(N, M);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelo-batimetria-${N}vetores-${M}pontos.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setModalModelo(false);
    } finally {
      setGerandoModelo(false);
    }
  }
  async function importarBatimetria() {
    setImpErro(null);
    if (!impArquivo) { setImpErro("Selecione o arquivo (CSV ou XLSX)."); return; }
    const diam = paraNumero(impDiametro) ?? 0;
    const ehRetangular = impFormato === "quadrado" || impFormato === "retangulo";
    if (!diam || diam <= 0) {
      setImpErro(ehRetangular ? `Informe o comprimento do tanque (${impUnidade}).` : `Informe o diâmetro do tanque (${impUnidade}).`);
      return;
    }
    const larg = paraNumero(impLargura) ?? 0;
    if (impFormato === "retangulo" && (!larg || larg <= 0)) { setImpErro(`Informe a largura do tanque (${impUnidade}).`); return; }
    if (impFormato === "custom" && !(impVertices || "").trim()) { setImpErro("Informe os vértices do tanque (x,y; x,y; …)."); return; }
    setImportando(true);
    try {
      const rows = await lerArquivoParaMatriz(impArquivo);
      const dados = extrairBatimetria(rows);
      const alertas: string[] = [];
      if (dados.invalidos > 0) {
        alertas.push(`${dados.invalidos} de ${dados.totalValidacao} leituras estão INCORRETO na validação (régua × sonar).`);
      }
      if (dados.negativos > 0) {
        alertas.push(`${dados.negativos} leitura(s) com espessura negativa (sonar corrigido maior que a régua corrigida) — a medição só poderá ser salva depois de corrigi-las no medidor.`);
      }
      if (alertas.length > 0) {
        const ok = confirm(`Atenção:\n\n• ${alertas.join("\n• ")}\n\nImportar mesmo assim?`);
        if (!ok) { setImportando(false); return; }
      }
      const maxVal = Math.max(0, ...dados.valores.flat().map((v) => (typeof v === "number" ? v : 0)));
      const alturaInput = paraNumero(impAltura) ?? 0;
      const altura = alturaInput > 0 ? alturaInput
        : (dados.alturaSugerida && dados.alturaSugerida > 0 ? dados.alturaSugerida : maxVal + (impUnidade === "cm" ? 50 : 0.5));
      const estado = montarEstadoMedidor(dados, {
        diametro: diam, altura, unidade: impUnidade,
        tanque: {
          formato: impFormato,
          largura: impFormato === "retangulo" ? larg : null,
          ngonLados: impFormato === "ngon" ? (parseInt(impLados, 10) || 6) : 6,
          vertices: impFormato === "custom" ? impVertices.trim() : "",
        },
      });
      setModalImport(false);
      carregarNoMedidor(estado);
    } catch (e) {
      setImpErro(e instanceof Error ? e.message : "Falha ao importar o arquivo.");
    } finally {
      setImportando(false);
    }
  }

  /** Exclui um rascunho (registro + arquivo). Versões enviadas ficam. */
  async function excluirRascunho(relatorioId: string) {
    if (!confirm("Excluir este rascunho de relatório? O arquivo também será apagado.")) return;
    setExcluindoRelatorio(relatorioId);
    setErroRelatorio(null);
    try {
      const res = await fetch(`/api/relatorios/${relatorioId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErroRelatorio(data?.erro || "Falha ao excluir o rascunho."); return; }
      carregar();
    } catch {
      setErroRelatorio("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setExcluindoRelatorio(null);
    }
  }

  /** Submete um rascunho já anexado à aprovação da Gerência. Confirma a
   *  versão que ele terá e a versão em aprovação que será substituída. */
  async function enviarParaAprovacao(rel: Relatorio) {
    if (rel.tipo === "execucao" && exigeLaudoExecucao && !rel.dados?.laudoPdf?.caminho) {
      setErroRelatorio(`${MSG_LAUDO_OBRIGATORIO} Clique em Editar, anexe o PDF no bloco do laudo e salve o rascunho de novo.`);
      return;
    }
    const plano = planejarEnvio(refsRelatorio, rel.tipo, rel.id);
    const linhas = [`Enviar o rascunho do relatório de ${ROTULO_TIPO[rel.tipo as TipoRelatorio] || rel.tipo} para aprovação como v${plano.versao}?`];
    plano.substitui.forEach((x) => linhas.push(`⚠️ A versão v${x.versao} em aprovação será substituída (sai da fila da Gerência).`));
    if (!confirm(linhas.join("\n\n"))) return;
    setEnviandoRelatorio(true);
    setErroRelatorio(null);
    try {
      const res = await fetch(`/api/relatorios/${rel.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enviar: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErroRelatorio(data?.erro || "Falha ao enviar para aprovação."); return; }
      carregar();
    } catch {
      setErroRelatorio("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setEnviandoRelatorio(false);
    }
  }

  /** Sobe o arquivo direto ao storage (URL assinada) e registra. A versão é
   *  decidida pela API; o tipo é o da fase. Devolve o erro em vez de só
   *  mostrar — o formulário de geração e o diálogo de envio o exibem. */
  async function enviarRelatorio(arquivo: File, opcoes: {
    rascunho?: boolean; dados?: any; formato?: FormatoRelatorio | null; chave?: string; laudoPdf?: LaudoPdf | null;
  } = {}): Promise<{ ok: boolean; erro?: string }> {
    setEnviandoRelatorio(true);
    setErroRelatorio(null);
    try {
      const ext = opcoes.formato || (arquivo.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx");
      // Arquivos grandes não cabem no corpo da função serverless (~4,5 MB na
      // Vercel). Enviamos direto ao storage com URL assinada e depois só
      // registramos o caminho — a API confere o arquivo lá.
      const rUrl = await fetch("/api/relatorios/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspecaoId: id, tipo: bloco, ext }),
      });
      const dUrl = await rUrl.json().catch(() => ({}));
      if (!rUrl.ok) return { ok: false, erro: dUrl?.erro || "Falha ao preparar o envio." };

      const supabase = getSupabaseBrowserClient();
      const up = await supabase.storage.from("gp-arquivos").uploadToSignedUrl(dUrl.caminho, dUrl.token, arquivo);
      if (up.error) return { ok: false, erro: `Falha ao enviar o arquivo: ${up.error.message}` };

      const res = await enviarJson("/api/relatorios", "POST",
        { inspecaoId: id, tipo: bloco, arquivoPath: dUrl.caminho, rascunho: !!opcoes.rascunho, dados: opcoes.dados || null,
          ...(opcoes.laudoPdf ? { laudoPdf: opcoes.laudoPdf } : {}) },
        "Relatório", opcoes.chave || novoId());
      if (res.queued) { alert("Sem conexão — relatório salvo offline e registrado ao reconectar."); return { ok: true }; }
      if (!res.ok) return { ok: false, erro: res.data?.erro || "Falha ao enviar o relatório." };
      carregar();
      return { ok: true };
    } catch {
      return { ok: false, erro: "Sem conexão — tente novamente quando estiver online." };
    } finally {
      setEnviandoRelatorio(false);
    }
  }

  /** "Enviar relatório" (arquivo de fora): confere pelos bytes (PDF/DOCX de
   *  verdade, até 30 MB) e se o mesmo arquivo já está na OS, e abre a
   *  confirmação com a versão que será criada. */
  async function escolherRelatorioExterno(f: File) {
    setErroRelatorio(null);
    setVerificandoArquivo(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const ex = await examinarArquivoRelatorio(bytes, { tamanho: f.size, max: RELATORIO_MAX_BYTES });
      let erroArq = ex.erro;
      if (!erroArq) {
        const igual = arquivoRelatorioRepetido(await sha256Hex(bytes), refsRelatorio);
        if (igual) erroArq = `Este mesmo arquivo já foi enviado nesta OS (${descreverRelatorio(igual)}).`;
      }
      setEnvioExterno({ arquivo: f, formato: ex.formato, erro: erroArq, chave: novoId() });
    } finally {
      setVerificandoArquivo(false);
      if (relatorioInputRef.current) relatorioInputRef.current.value = "";
    }
  }

  /** Fase 8: PDF do laudo no envio de fora (relatório de execução com
   *  laudo): confere e sobe já; a API confere de novo ao registrar. */
  async function escolherLaudoExterno(f: File | undefined | null) {
    if (!f) return;
    setEnvioExterno((e) => (e ? { ...e, enviandoLaudo: true, erroLaudo: null } : e));
    try {
      const ex = await examinarLaudoLocal(f, arquivosOS);
      if (ex.erro || !ex.hash) { setEnvioExterno((e) => (e ? { ...e, erroLaudo: ex.erro || "Arquivo inválido." } : e)); return; }
      const laudo = await enviarLaudoPdf(id, f, ex.hash);
      setEnvioExterno((e) => (e ? { ...e, laudo, erroLaudo: null } : e));
    } catch (e) {
      const m = e instanceof Error ? e.message : "Falha ao enviar o laudo.";
      setEnvioExterno((x) => (x ? { ...x, erroLaudo: m } : x));
    } finally {
      setEnvioExterno((e) => (e ? { ...e, enviandoLaudo: false } : e));
    }
  }

  async function confirmarEnvioExterno() {
    if (!envioExterno || envioExterno.erro) return;
    if (exigeLaudoExecucao && !envioExterno.laudo) {
      setEnvioExterno((e) => (e ? { ...e, erroLaudo: MSG_LAUDO_OBRIGATORIO } : e));
      return;
    }
    const r = await enviarRelatorio(envioExterno.arquivo, { formato: envioExterno.formato, chave: envioExterno.chave, laudoPdf: envioExterno.laudo || null });
    if (r.ok) setEnvioExterno(null);
    else setEnvioExterno((e) => (e ? { ...e, erro: r.erro || "Falha ao enviar." } : e));
  }

  /** "Enviar versão assinada" (relatório aprovado): confere o PDF pelos
   *  bytes (PDF de verdade, até 30 MB, não repetido na OS), confirma, sobe
   *  direto ao storage e registra — a API confere tudo de novo. */
  function pedirAssinado(rel: Relatorio, substituir: boolean) {
    setErroAssinado(null);
    setAssinando({ id: rel.id, substituir });
    assinadoInputRef.current?.click();
  }

  async function escolherAssinado(f: File) {
    const alvo = assinando;
    if (assinadoInputRef.current) assinadoInputRef.current.value = "";
    const rel = alvo ? relatorios.find((r) => r.id === alvo.id) : null;
    if (!alvo || !rel) return;
    const rotulo = `relatório de ${ROTULO_TIPO[rel.tipo as TipoRelatorio] || rel.tipo} v${rel.versao}`;
    setEnviandoAssinado(rel.id);
    setErroAssinado(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const ex = await examinarArquivoRelatorio(bytes, { tamanho: f.size, max: RELATORIO_MAX_BYTES });
      if (ex.erro) { setErroAssinado(ex.erro); return; }
      if (ex.formato !== "pdf") { setErroAssinado("A versão assinada tem de ser PDF (este arquivo é DOCX). Exporte/imprima em PDF depois de assinar."); return; }
      const hash = await sha256Hex(bytes);
      if (rel.arquivo_hash === hash) { setErroAssinado("É o mesmo arquivo da versão enviada para aprovação, sem assinatura. Envie o documento assinado."); return; }
      const igual = arquivoRelatorioRepetido(hash, refsRelatorio);
      if (igual) {
        setErroAssinado(igual.id === rel.id ? "Esta mesma versão assinada já foi enviada." : `Este mesmo arquivo já está nesta OS (${descreverRelatorio(igual)}).`);
        return;
      }
      const msg = alvo.substituir
        ? `Trocar a versão assinada do ${rotulo} por “${f.name}”?\n\nA versão assinada atual (enviada por ${nomeDe(rel.assinado_por)} em ${formatar(rel.assinado_em)}) será APAGADA — fica só a nova. A troca entra no histórico.`
        : `Enviar “${f.name}” como a versão ASSINADA do ${rotulo}?\n\nEla passa a ser o documento final do relatório (o original continua disponível).`;
      if (!confirm(msg)) return;
      const rUrl = await fetch("/api/relatorios/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assinado: rel.id, substituir: alvo.substituir }),
      });
      const dUrl = await rUrl.json().catch(() => ({}));
      if (!rUrl.ok) { setErroAssinado(dUrl?.erro || "Falha ao preparar o envio."); return; }
      const supabase = getSupabaseBrowserClient();
      const up = await supabase.storage.from("gp-arquivos").uploadToSignedUrl(dUrl.caminho, dUrl.token, f, { contentType: "application/pdf" });
      if (up.error) { setErroAssinado(`Falha ao enviar o arquivo: ${up.error.message}`); return; }
      const res = await fetch(`/api/relatorios/${rel.id}/assinado`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": novoId() },
        body: JSON.stringify({ caminho: dUrl.caminho, substituir: alvo.substituir }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErroAssinado(data?.erro || "Falha ao registrar a versão assinada."); return; }
      carregar();
    } catch {
      setErroAssinado("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setEnviandoAssinado(null);
      setAssinando(null);
    }
  }

  /** Zera o que é comum ao abrir o modal (novo ou edição). */
  function prepararModalAgenda() {
    setAgEquipInput(""); setAgNovoItem("");
    setAgMsgEquip(null); setAgMsgItem(null);
    setAgTentou(false); setAgServidor(novoResultado()); setAgCtx({});
    setErroAgenda(null);
    setModalAgenda(true);
  }

  function abrirAgenda() {
    setAgendaEditando(null);
    setAgTipo(bloco);
    setAgData(""); setAgHora(""); setAgDataExec(""); setAgDataFim(""); setAgDataFimOriginal(null);
    setAgADefinir(false); setAgLembrar(""); setAgDataOriginal(null);
    setAgEquipeIds([]); setAgEquipeGravada([]); setAgEquipamentos([]);
    setAgChecklist(CHECKLIST_PADRAO.map((item) => ({ item, ok: false })));
    prepararModalAgenda();
  }

  function abrirAgendaEdicao(a: Agendamento) {
    setAgendaEditando(a.id);
    setAgTipo(a.tipo === "execucao" ? "execucao" : "inspecao");
    setAgData(a.data_visita || ""); setAgHora(a.hora || ""); setAgDataExec(a.data_execucao || "");
    setAgDataFim(a.data_fim || ""); setAgDataFimOriginal(a.data_fim || null);
    setAgADefinir(!!a.a_definir); setAgLembrar(a.lembrar_em || ""); setAgDataOriginal(a.data_visita);
    setAgEquipeIds((a.equipe || []).map((m) => m.id));
    setAgEquipeGravada(a.equipe || []);
    setAgEquipamentos(a.equipamentos || []);
    setAgChecklist((a.checklist || []).map((c) => ({ item: c.item, ok: !!c.ok })));
    prepararModalAgenda();
  }

  async function removerAgenda(a: Agendamento) {
    if (!confirm(a.substituido_em ? "Apagar este registro do histórico de remarcações?" : "Excluir este agendamento?")) return;
    const r = await fetch(`/api/agendamentos/${a.id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json(); setErro(d.erro || "Falha ao excluir."); return; }
    carregar();
  }

  // Contexto do banco para o modal: agendamentos ativos desta OS e os de
  // outras OSs na data escolhida. Debounce e descarte de resposta fora de ordem.
  const seqVerif = useRef(0);
  const dataVerif = agADefinir ? "" : agData;
  // Execução de vários dias: os conflitos olham o período todo.
  const fimVerif = agADefinir || agTipo !== "execucao" || !agDataFim || agDataFim <= agData ? "" : agDataFim;
  useEffect(() => {
    if (!modalAgenda) return;
    const n = ++seqVerif.current;
    const t = setTimeout(() => {
      fetch(`/api/agendamentos/verificar?${new URLSearchParams({ inspecaoId: id, data: dataVerif, ...(fimVerif ? { fim: fimVerif } : {}) })}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && n === seqVerif.current) setAgCtx(d); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [modalAgenda, id, dataVerif, fimVerif]);

  /** Equipe escolhida: usuários ativos e, na edição, quem já estava gravado
   *  (mesmo inativo — aí vira erro para tirar, em vez de sumir calado). */
  const agEquipe = useMemo(() => agEquipeIds.map((uid) => {
    const u = usuarios.find((x) => x.id === uid);
    return u ? { id: u.id, nome: u.nome } : agEquipeGravada.find((m) => m.id === uid) || { id: uid, nome: "usuário" };
  }), [agEquipeIds, usuarios, agEquipeGravada]);

  const dadosAgenda = {
    tipo: agTipo, aDefinir: agADefinir, dataVisita: agADefinir ? "" : agData, hora: agHora,
    dataFim: agADefinir || agTipo !== "execucao" ? "" : agDataFim,
    dataExecucao: agDataExec, lembrarEm: agADefinir ? agLembrar : "",
    equipe: agEquipe, equipamentos: agEquipamentos, checklist: agChecklist,
  };
  const ctxAgenda: ContextoAgendamento = {
    hoje: agCtx.hoje || hojeBrasil(),
    inspecaoId: id,
    dataAbertura: agCtx.dataAbertura ?? insp?.projeto?.data_abertura ?? null,
    local: agCtx.local,
    original: agendaEditando ? { id: agendaEditando, data_visita: agDataOriginal, data_fim: agDataFimOriginal } : null,
    // Sem resposta do servidor ainda, vale o que a página já tem.
    daOS: agCtx.daOS || agAtivos.map((a) => ({ ...a, inspecao_id: id })),
    // Resposta atrasada (de outra data/período) não conta.
    noDia: (agCtx.noDia || []).filter((a) => {
      const p = periodoDe(a);
      return !dataVerif || (!!p && periodosSobrepoem(p, { inicio: dataVerif, fim: fimVerif || dataVerif }));
    }),
    usuariosAtivos: usuarios.length ? usuarios.map((u) => u.id) : undefined,
    catalogo: agCtx.catalogo || catalogoEquip,
    relatoriosInspecao: agCtx.relatoriosInspecao
      || relatorios.filter((r) => r.tipo === "inspecao").map((r) => ({ versao: r.versao, status: r.status })),
    funcoes: agCtx.funcoes || funcoesUsuarios,
    equipamentosProcedimento: agCtx.equipamentosProcedimento || equipProcOS,
    procedimento: agCtx.procedimento ?? insp?.procedimento ?? null,
  };
  const resultadoAgenda = mesclar(validarAgendamento(dadosAgenda, ctxAgenda), agServidor);
  const substituidosAgenda = agendamentosSubstituidos(dadosAgenda, ctxAgenda);
  /** Equipamentos do procedimento fora da lista do modal (execução). */
  const faltamNoModal = agTipo === "execucao" ? equipamentosFaltando(ctxAgenda.equipamentosProcedimento, agEquipamentos) : [];
  const remarcandoAgenda = !!agendaEditando && !!agDataOriginal && !agADefinir
    && periodoMudou({ data_visita: agDataOriginal, data_fim: agDataFimOriginal }, { data_visita: agData, data_fim: dadosAgenda.dataFim || null });

  /** Qualquer mudança no modal invalida a resposta anterior da API. */
  function mexeuAgenda() {
    setAgServidor(novoResultado());
    setErroAgenda(null);
  }

  // ── Coleta (Fase 3) ──────────────────────────────────────────────────────
  /** Agendamento ativo de inspeção (o mais recente com data): sugere a data
   *  da coleta e põe a equipe no topo da lista de responsáveis. */
  const agInspecao = agAtivos.find((a) => a.tipo === "inspecao" && a.data_visita) || null;
  const dataSugerida = dataColetaSugerida(agInspecao?.data_visita, hojeBrasil());
  const equipeAgendada = new Set((agInspecao?.equipe || []).map((m) => m.id));
  const responsaveisEquipe = usuarios.filter((u) => equipeAgendada.has(u.id));
  const responsaveisOutros = usuarios.filter((u) => !equipeAgendada.has(u.id));
  // Refs para o callback do iframe (registrado uma vez) ler o estado atual.
  const coletasRef = useRef<Coleta[]>([]);
  coletasRef.current = coletas;
  const usuariosRef = useRef<UsuarioOpcao[]>([]);
  usuariosRef.current = usuarios;
  const dataSugeridaRef = useRef("");
  dataSugeridaRef.current = dataSugerida;

  const coletaRefs: ColetaRef[] = useMemo(() => coletas.map((c) => ({
    id: c.id, tipo: c.tipo, chave: c.tipo === "anexo" ? null : chaveMedicao(c.dados), arquivoHash: c.arquivo_hash || null,
    dataColeta: c.data_coleta || null, descricao: c.descricao || null, criadoEm: c.criado_em,
  })), [coletas]);
  const ctxColeta: ContextoColeta = {
    hoje: hojeBrasil(),
    dataAgendamento: agInspecao?.data_visita || null,
    usuariosAtivos: usuarios.length ? usuarios.map((u) => u.id) : undefined,
    coletas: coletaRefs,
    tanque: insp?.tanque || null,
  };
  const coletaAberta = confirmacao?.editId ? coletas.find((c) => c.id === confirmacao.editId) || null : null;
  const resultadoConfirmacao = confirmacao
    ? mesclar(validarColeta({
      id: confirmacao.editId, tipo: "sedimento", dataColeta: cfData, responsavelId: cfResp, dados: confirmacao.dados,
    }, ctxColeta), cfServidor)
    : novoResultado();
  /** Editar a medição de uma coleta aprovada retira a aprovação. */
  const retiraAprovacao = !!coletaAberta?.aprovada_em && !!confirmacao
    && chaveMedicao(confirmacao.dados) !== chaveMedicao(coletaAberta.dados);
  const difTanque = confirmacao ? diferencasTanque(confirmacao.dados, insp?.tanque) : [];
  const resultadoAnexo = mesclar(validarColeta({
    tipo: "anexo", dataColeta: anxData, descricao: anxDescricao, exigirArquivo: true, erroArquivo: anxErroArquivo,
    // Sem SHA-256 no navegador (http), a duplicidade fica para a API.
    arquivoHash: anxHash || (anxArquivo && !anxErroArquivo ? `local:${anxArquivo.name}:${anxArquivo.size}` : null),
  }, ctxColeta), anxServidor);

  async function salvarAgenda() {
    setErroAgenda(null);
    setAgTentou(true);
    if (temErros(resultadoAgenda)) return;
    setSalvandoAgenda(true);
    try {
      const payload = {
        aDefinir: agADefinir,
        dataVisita: agADefinir ? null : agData,
        dataFim: agADefinir || agTipo !== "execucao" ? null : agDataFim || null,
        lembrarEm: agADefinir ? agLembrar || null : null,
        dataExecucao: agDataExec || null,
        hora: agADefinir ? null : agHora || null,
        equipe: agEquipe, equipamentos: agEquipamentos, checklist: agChecklist,
      };
      const res = await enviarJson(
        agendaEditando ? `/api/agendamentos/${agendaEditando}` : "/api/agendamentos",
        agendaEditando ? "PATCH" : "POST",
        agendaEditando ? payload : { inspecaoId: id, tipo: agTipo, ...payload },
        "Agendamento"
      );
      if (!res.queued && !res.ok) {
        if (res.data?.erros) setAgServidor({ erros: res.data.erros, avisos: res.data.avisos || {} });
        setErroAgenda(res.data?.erro || "Falha ao salvar o agendamento.");
        return;
      }
      setModalAgenda(false);
      setAgendaEditando(null);
      if (res.queued) alert("Sem conexão — agendamento salvo offline e enviado ao reconectar (as regras são conferidas ao enviar).");
      else carregar();
    } finally {
      setSalvandoAgenda(false);
    }
  }

  /** Card da execução: um clique põe no agendamento os equipamentos do
   *  procedimento que faltam (PATCH só da lista — mesmas regras da API). */
  async function adicionarEquipamentosAoAgendamento(a: Agendamento, nomes: string[]) {
    if (!nomes.length || adicionandoEquip) return;
    setAdicionandoEquip(a.id);
    setErro(null);
    try {
      const res = await enviarJson(`/api/agendamentos/${a.id}`, "PATCH",
        { equipamentos: [...(a.equipamentos || []), ...nomes] }, "Agendamento");
      if (res.queued) { alert("Sem conexão — a lista será atualizada ao reconectar."); return; }
      if (!res.ok) { setErro(res.data?.erro || "Não foi possível adicionar os equipamentos."); return; }
      carregar();
    } finally {
      setAdicionandoEquip(null);
    }
  }

  function toggleEquipe(uid: string) {
    setAgEquipeIds((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
    mexeuAgenda();
  }
  /** Adiciona o equipamento com o nome do Catálogo (se for o mesmo item) e
   *  recusa repetido — "detector de gases" = "Detector de Gases". */
  function addEquipamento() {
    const v = agEquipInput.replace(/\s+/g, " ").trim();
    if (!v) return;
    const nome = nomeDoCatalogo(v, ctxAgenda.catalogo);
    const igual = agEquipamentos.find((e) => normalizarEquipamento(e) === normalizarEquipamento(nome));
    if (igual) { setAgMsgEquip(`“${igual}” já está na lista.`); return; }
    setAgEquipamentos((p) => [...p, nome]);
    setAgEquipInput("");
    setAgMsgEquip(null);
    mexeuAgenda();
  }
  function trocarEquipamento(de: string, para: string) {
    setAgEquipamentos((p) => p.map((e) => (e === de ? para : e)));
    mexeuAgenda();
  }
  function addItemChecklist() {
    const v = agNovoItem.replace(/\s+/g, " ").trim();
    if (!v) return;
    const igual = agChecklist.find((c) => normalizarEquipamento(c.item) === normalizarEquipamento(v));
    if (igual) { setAgMsgItem(`“${igual.item}” já está no checklist.`); return; }
    setAgChecklist((p) => [...p, { item: v, ok: false }]);
    setAgNovoItem("");
    setAgMsgItem(null);
    mexeuAgenda();
  }

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;
  if (naoEncontrado || !insp)
    return (
      <div className="page-larga">
        <p className="vazio">OS não encontrada.</p>
        <Link href="/projetos" style={{ color: "var(--primaria)" }}>← Voltar aos projetos</Link>
      </div>
    );

  const def = definicaoFase(insp.fase);
  const procAtual = procedimentos.find((p) => p.codigo === insp.procedimento);
  const rotuloProcedimento = insp.procedimento
    ? `${insp.procedimento}${procAtual?.nome ? ` — ${procAtual.nome}` : ""}`
    : "não definido (escolha um)";
  const pct = Math.round(((insp.fase - 1) / (ULTIMA_FASE - 1)) * 100);

  // Resumos de uma linha das seções recolhidas.
  const aprovadas = coletas.filter((c) => c.aprovada_em).length;
  // A partir do relatório (fase 4), falta de medição aprovada é pendência.
  const classeAprovada = aprovadas === 0 && insp.fase >= 4 ? "alerta" : undefined;
  const resumoColetas = coletas.length === 0 ? <span className={classeAprovada}>Nenhuma coleta</span> : (
    <>
      {coletas.length} coleta{coletas.length === 1 ? "" : "s"} ·{" "}
      <span className={classeAprovada}>
        {aprovadas === 0 ? "nenhuma aprovada" : `${aprovadas} aprovada${aprovadas === 1 ? "" : "s"}`}
      </span>
    </>
  );
  /** "12/11 09:00" do agendamento mais recente da etapa; execução sem
   *  agendamento próprio mostra a data prevista, se houver. */
  const quandoAgenda = (tipo: "inspecao" | "execucao") => {
    const a = agAtivos.find((x) => x.tipo === tipo);
    const p = periodoDe(a);
    if (a && p && p.fim !== p.inicio) return `${textoPeriodo(p)}${a.hora ? ` ${a.hora.slice(0, 5)}` : ""}`;
    if (a?.data_visita) return `${formatarData(a.data_visita).slice(0, 5)}${a.hora ? ` ${a.hora.slice(0, 5)}` : ""}`;
    if (a?.a_definir) return "a definir";
    const prevista = tipo === "execucao" && agAtivos.find((x) => x.data_execucao)?.data_execucao;
    return prevista ? `${formatarData(prevista).slice(0, 5)} (prevista)` : "—";
  };
  const resumoAgendamentos = `Inspeção ${quandoAgenda("inspecao")} · Execução ${quandoAgenda("execucao")}`;
  const progFotos = progressoColeta(fotosExec);
  const resumoFotos = `${fotosExec ? `${progFotos.feitos} de ${progFotos.total} itens` : "Carregando…"}`
    + (fotosLocais.fila > 0 ? ` · ${fotosLocais.fila} na fila` : "")
    + (fotosLocais.enviando > 0 ? ` · enviando ${fotosLocais.enviando}` : "");
  // Relatórios vêm da versão mais alta para a mais baixa: o primeiro de cada tipo é o atual.
  const ultimosRelatorios = (["inspecao", "execucao"] as const)
    .map((t) => relatorios.find((r) => r.tipo === t))
    .filter((r): r is Relatorio => !!r);
  const resumoRelatorios = ultimosRelatorios.length === 0 ? "Nenhum relatório enviado" : (
    <>
      {ultimosRelatorios.map((r, i) => (
        <span key={r.id}>
          {i > 0 && " · "}
          {r.tipo === "execucao" ? "Execução" : "Inspeção"} v{r.versao} —{" "}
          <span style={{ color: corStatus(r.status) }}>{rotuloStatus(r.status)}</span>
        </span>
      ))}
    </>
  );

  return (
    <div className="page-larga">
      {/* Cabeçalho ÚNICO da OS: título e metadados, avisos, fase e a barra de
          ações. Antes eram até 4 cards empilhados (aviso do cliente, OS
          encerrada, cabeçalho e "Ações desta fase"). */}
      <header className="card os-cab">
        {insp.projeto && (
          <Link href={`/projetos/${insp.projeto.id}`} className="os-cab-voltar">
            ← {insp.projeto.codigo_projeto || insp.projeto.pedido_compra || "Projeto"}
          </Link>
        )}
        <div className="os-cab-topo">
          <div style={{ minWidth: 0, flex: "1 1 260px" }}>
            {editandoTitulo ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input autoFocus value={tituloNovo} maxLength={160} disabled={salvandoTitulo}
                  aria-label="Identificação da OS"
                  className={temErros(resultadoTitulo) ? "val-invalido" : undefined}
                  onChange={(e) => { setTituloNovo(e.target.value); setServidorTitulo(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") salvarTitulo();
                    if (e.key === "Escape") setEditandoTitulo(false);
                  }}
                  style={{ flex: "1 1 220px", minWidth: 0, padding: "8px 10px", borderRadius: 8,
                    border: "1px solid var(--borda)", background: "var(--bg-card)",
                    color: "var(--texto)", fontSize: 18, fontWeight: 700 }} />
                <button className="btn-dl" disabled={salvandoTitulo || temErros(resultadoTitulo)} onClick={salvarTitulo}>
                  {salvandoTitulo ? "Salvando…" : "Salvar"}
                </button>
                <button className="btn-dl btn-sec" disabled={salvandoTitulo}
                  onClick={() => setEditandoTitulo(false)}>Cancelar</button>
                <div style={{ flexBasis: "100%" }}>
                  <MensagensCampo r={resultadoTitulo} campo="identificacao" />
                  {servidorTitulo && <p className="val-msg val-erro">⛔ {servidorTitulo}</p>}
                </div>
              </div>
            ) : (
              <h1 className="os-titulo">
                <span>{insp.identificacao}</span>
                {podeRenomear && (
                  <button className="fu-icone-btn" title="Renomear a OS" aria-label="Renomear a OS" onClick={abrirEdicaoTitulo}>✎</button>
                )}
              </h1>
            )}
            <p className="os-sub">
              {insp.projeto?.cliente?.razao_social || ""}
              {insp.projeto?.endereco ? ` · ${insp.projeto.endereco}` : ""}
            </p>
          </div>
          <span className={`fu-badge ${def?.bloco === "execucao" ? "manual" : "auto"}`} style={{ marginLeft: 0 }}>
            Fase {insp.fase} · {def?.area || "—"}
          </span>
        </div>

        {/* Procedimento e tanque: metadados em linha. Editar abre um modal
            (procedimento) ou o cadastro do tanque — nada de formulário
            sempre aberto no topo. */}
        <div className="os-meta">
          {podeRenomear ? (
            <button type="button" className="os-meta-item" aria-haspopup="dialog" disabled={salvandoProc}
              title="Trocar o procedimento da OS" onClick={() => setEditandoProc(true)}>
              <span className="os-meta-rotulo">Procedimento</span>
              <span className="os-meta-valor">{rotuloProcedimento}</span>
              <span className="os-meta-lapis" aria-hidden="true">✎</span>
            </button>
          ) : (
            <span className="os-meta-item">
              <span className="os-meta-rotulo">Procedimento</span>
              <span className="os-meta-valor">{insp.procedimento || "não definido"}</span>
            </span>
          )}
          {salvandoProc && <span className="os-meta-status">salvando…</span>}
          {podeRenomear ? (
            <button type="button" className="os-meta-item" aria-haspopup="dialog" title="Editar o cadastro do tanque"
              onClick={() => { setTanqueForm(tanqueParaForm(insp.tanque)); setErroTanque(null); setEditandoTanque(true); }}>
              <span className="os-meta-rotulo">Tanque</span>
              <span className="os-meta-valor">{insp.tanque ? resumoTanque(insp.tanque) : "não cadastrado"}</span>
              <span className="os-meta-lapis" aria-hidden="true">✎</span>
            </button>
          ) : (
            <span className="os-meta-item">
              <span className="os-meta-rotulo">Tanque</span>
              <span className="os-meta-valor">{insp.tanque ? resumoTanque(insp.tanque) : "não cadastrado"}</span>
            </span>
          )}
        </div>
        {erroProc && <p className="erro-texto" style={{ margin: "2px 0 0" }}>{erroProc}</p>}

        {encerrada && (
          <div className="faixa-alerta ok" role="status">
            <p className="faixa-alerta-texto" style={{ margin: 0 }}>
              <span className="faixa-alerta-rotulo">
                🔒 {textoEncerrada(insp.encerrada_em, nomeDe(insp.encerrada_por) || null, insp.encerramento_manual)}
              </span>
              {insp.encerramento_manual && insp.encerramento_justificativa && (
                <span style={{ display: "block" }}>Justificativa: {insp.encerramento_justificativa}</span>
              )}
              <span className="detalhe" style={{ margin: "2px 0 0" }}>
                Só consulta: coletas, fotos, RDOs, relatórios, agendamentos, checklist e cadastro não podem ser alterados. Downloads e entregas ao cliente seguem liberados.
              </span>
            </p>
          </div>
        )}

        <AvisoCliente clienteId={insp.projeto?.cliente?.id} faixa />

        {/* Fase atual em uma linha; a lista das 10 fases abre sob demanda. */}
        <div className="os-fase">
          <div className="os-fase-linha">
            <strong className="os-fase-nome">
              Fase {insp.fase} de {ULTIMA_FASE} · {nomeFase(insp.fase)}
            </strong>
            <button type="button" className="secao-link" aria-expanded={verFases} aria-controls="lista-fases"
              onClick={() => setVerFases((v) => !v)}>
              {verFases ? "ocultar fases" : "ver todas as fases"}
            </button>
          </div>
          <div className="fu-progresso" title={`Fase ${insp.fase} de ${ULTIMA_FASE}`}>
            <div className="fu-barra" style={{ width: `${pct}%` }} />
          </div>

          <div id="lista-fases" hidden={!verFases}
            style={{ display: verFases ? "flex" : undefined, flexDirection: "column", gap: 4, marginTop: 12 }}>
            {TODAS_FASES.map((n) => {
              const estado = n < insp.fase ? "feita" : n === insp.fase ? "atual" : "futura";
              return (
                <div key={n} className="fase-linha" style={{ opacity: estado === "futura" ? 0.5 : 1 }}>
                  <span
                    style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700,
                      background: estado === "feita" ? "#16a34a" : estado === "atual" ? "var(--primaria)" : "var(--track)",
                      color: estado === "futura" ? "var(--cinza)" : "#fff",
                    }}
                  >
                    {estado === "feita" ? "✓" : n}
                  </span>
                  <span className="fase-nome" style={{ fontWeight: estado === "atual" ? 700 : 500, color: "var(--texto)" }}>
                    {nomeFase(n)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Barra de ações da fase, logo abaixo da fase. Recebe o foco depois de
            uma ação de fase (antes era o card "Ações desta fase"). */}
        <div ref={cardAcoesRef} tabIndex={-1} className="os-acoes" role="region" aria-labelledby="titulo-acoes">
          <h2 id="titulo-acoes" className="os-acoes-titulo">Ações desta fase</h2>
          {reprovacao && (
            <p className="erro-texto" style={{ margin: 0 }}>
              Reprovado{reprovacao.motivo ? `: ${formatarMotivo(reprovacao.motivo_categoria, reprovacao.motivo)}` : ""}
              {reprovacao.autor_perfil ? ` (por ${reprovacao.autor_perfil.nome_completo || reprovacao.autor_perfil.email}, ${formatar(reprovacao.data_autenticacao || reprovacao.criado_em)})` : ""} — ajuste o relatório.
            </p>
          )}
          {insp.fase >= ULTIMA_FASE ? (
            <EncerramentoOS inspecaoId={id} perfil={perfil} versao={versaoDados} onMudou={carregar} />
          ) : acoes.length === 0 ? (
            <p className="vazio" style={{ margin: 0 }}>
              {insp.fase >= ULTIMA_FASE ? "OS encerrada."
                : perfil && !perfilAtuaNaFase(perfil, insp.fase) ? `Fase com ${def?.area || "outra área"} — você está em modo consulta.`
                : "Nenhuma ação disponível para o seu perfil nesta fase."}
            </p>
          ) : (
            <>
            {(insp.fase === 5 || insp.fase === 9) && (
              <p className="detalhe" style={{ margin: 0 }}>
                {relEmAvaliacao ? (
                  <>Relatório em avaliação: <strong>{ROTULO_TIPO[relEmAvaliacao.tipo as TipoRelatorio]} v{relEmAvaliacao.versao}</strong>{" "}
                    {relAval?.enviado_em ? `(enviado${relAval.enviado_por ? ` por ${nomeDe(relAval.enviado_por)}` : ""} em ${formatar(relAval.enviado_em)}) ` : ""}
                    — <a href={`/api/relatorios/${relEmAvaliacao.id}/download`} target="_blank" rel="noopener noreferrer"
                      onClick={() => marcarBaixado(relEmAvaliacao.id)}>baixar</a>.
                    Aprovar/reprovar vale só para esta versão.</>
                ) : (
                  <span className="val-msg val-erro" style={{ display: "inline" }}>
                    ⛔ Nenhum relatório de {ROTULO_TIPO[tipoDaFase(insp.fase)]} em aprovação — não há o que aprovar nem reprovar. Operações precisa enviar o relatório.
                  </span>
                )}
              </p>
            )}
            {relAval && <ResumoValidacao r={avisosAprov} recolhivel />}
            <div className="os-acoes-botoes">
              {acoes.map((o) => (
                <button key={o.acao} className={`btn-azul ${o.acao === "reprovar" ? "btn-sec" : ""}`} onClick={() => clicarAcao(o)}
                  disabled={processando || ((insp.fase === 5 || insp.fase === 9) && (o.acao === "aprovar" || o.acao === "reprovar") && !relEmAvaliacao)}>
                  {processando ? "Enviando…" : o.rotulo}
                </button>
              ))}
            </div>
            </>
          )}
          {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
        </div>
      </header>

      {/* Seções recolhíveis numa superfície só, separadas por divisória. O
          padrão vem da fase (lib/asp/fases.ts); a escolha do usuário fica
          guardada por inspeção e fase. */}
      <div className="card os-secoes">
      <div className="os-secoes-topo">
        <h2 className="os-secoes-rotulo">Seções da OS</h2>
        <div className="secoes-controles">
          <button type="button" className="secao-link" onClick={secoes.expandirTudo}>Expandir tudo</button>
          <button type="button" className="secao-link" onClick={secoes.recolherTudo}>Recolher tudo</button>
          {secoes.alterado && (
            <button type="button" className="secao-link" onClick={secoes.restaurar}>Restaurar padrão da fase</button>
          )}
        </div>
      </div>

      {/* Coleta (Operações) + Agendamento (Comercial) */}
        <SecaoRecolhivel id="coletas" titulo={`Coletas (${coletas.length})`}
          aberta={secoes.aberta("coletas")} onAlternar={() => secoes.alternar("coletas")}
          resumo={resumoColetas}
          acoesCabecalho={podeColeta && (
              <>
                <button className="btn-azul" style={btnColeta} onClick={abrirMedidorNovo}>📐 Nova medição</button>
                <button className="btn-azul btn-sec" style={btnColeta} onClick={() => setModalEntrada(true)}>✍ Digitar batimetria</button>
                <button className="btn-azul btn-sec" style={btnColeta} onClick={abrirImport}>⬆ Importar batimetria</button>
                <button className="btn-azul btn-sec" style={btnColeta} onClick={() => setModalModelo(true)}>⬇ Modelo vazio</button>
                <button className="btn-azul btn-sec" style={btnColeta} onClick={abrirAnexo} disabled={enviandoColeta}>
                  📎 Anexar PDF
                </button>
              </>
          )}>
          <p className="detalhe" style={{ marginTop: 0 }}>Medidor de sedimento: a medição vira um Relatório Técnico interno editável.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {FERRAMENTAS_FUTURAS.map((f) => (
              <span key={f} className="fu-badge manual" style={{ opacity: 0.75 }}>{f} · em desenvolvimento</span>
            ))}
          </div>
          {coletas.length === 0 ? (
            <p className="vazio" style={{ margin: 0 }}>Nenhuma coleta registrada.</p>
          ) : (
            <div className="os-lista">
            {coletas.map((c) => {
              const temMedicao = c.tipo !== "anexo" && medicaoPreenchida(c.dados);
              const naoAprovavel = c.aprovada_em ? null : motivoNaoAprovavel(c);
              const resp = temMedicao && typeof c.dados?.reportResponsavel === "string" ? c.dados.reportResponsavel : "";
              return (
                <div key={c.id} className="linha-item os-linha">
                  <span className="detalhe linha-texto" style={{ margin: 0 }}>
                    {temMedicao ? "📋 Relatório Técnico interno" : `📎 Anexo — ${c.descricao || c.tipo}`}
                    {" · "}{c.data_coleta ? formatarData(c.data_coleta) : formatar(c.criado_em)}
                    {resp ? ` · ${resp}` : ""}
                    {c.aprovada_em && (
                      <strong style={{ display: "block", color: "#16a34a" }}>
                        ✓ Em uso no relatório — aprovada em {formatar(c.aprovada_em)}
                      </strong>
                    )}
                    {!c.aprovada_em && c.aprovacao_retirada_em && (
                      <span className="alerta" style={{ display: "block" }}>
                        Aprovação retirada por edição em {formatar(c.aprovacao_retirada_em)} — aprove de novo se ela vale para o relatório.
                      </span>
                    )}
                  </span>
                  <span className="linha-acoes">
                    {podeColeta && temMedicao && (
                      <button className="btn-dl btn-sec" onClick={() => abrirMedidorEdicao(c)}>Editar</button>
                    )}
                    {c.pdf_path && (
                      <a className="btn-dl btn-sec" href={`/api/coletas/${c.id}/download`} target="_blank" rel="noopener noreferrer">PDF</a>
                    )}
                    {podeAprovarMedicao && temMedicao && (
                      <button className="btn-dl btn-sec"
                        style={c.aprovada_em
                          ? { color: "#16a34a", borderColor: "#16a34a" }
                          : undefined}
                        title={c.aprovada_em ? "Desmarcar esta medição" : naoAprovavel || "Marcar como a medição válida para o relatório"}
                        disabled={aprovandoColeta === c.id || !!naoAprovavel} onClick={() => aprovarColeta(c)}>
                        {aprovandoColeta === c.id ? "…" : c.aprovada_em ? "✓ Aprovada" : "Aprovar"}
                      </button>
                    )}
                    {podeColeta && (
                      <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                        title={c.aprovada_em ? "Excluir (lixeira de 30 dias) — a aprovação é retirada" : "Excluir (lixeira de 30 dias)"}
                        disabled={excluindoColeta === c.id} onClick={() => excluirColeta(c)}>
                        {excluindoColeta === c.id ? "Excluindo…" : "Excluir"}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            </div>
          )}
        </SecaoRecolhivel>

        <SecaoRecolhivel id="agendamentos" titulo={`Agendamentos (${agAtivos.length})`}
          aberta={secoes.aberta("agendamentos")} onAlternar={() => secoes.alternar("agendamentos")}
          resumo={resumoAgendamentos}
          acoesCabecalho={podeAgenda && <button className="btn-azul" onClick={abrirAgenda}>+ Agendar ({rotuloEtapa(bloco)})</button>}>
          {agAtivos.length === 0 ? (
            <p className="vazio" style={{ margin: "8px 0 0" }}>Nenhum agendamento.</p>
          ) : (
            <div className="os-lista">
            {agAtivos.map((a) => (
              <div key={a.id} className="os-linha">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <div className={`os-linha-titulo${a.a_definir ? " pendente" : ""}`} style={{ minWidth: 0 }}>
                    📅 {a.data_visita
                      ? (a.data_fim && a.data_fim > a.data_visita ? `${formatarData(a.data_visita)} a ${formatarData(a.data_fim)}` : formatarData(a.data_visita))
                      : a.a_definir ? "Data a definir" : "sem data"}{a.hora ? ` às ${a.hora}` : ""}
                    <span className="detalhe" style={{ margin: "0 0 0 8px", fontWeight: 400 }}>({rotuloEtapa(a.tipo)})</span>
                    {a.a_definir && (
                      <span className={`detalhe${a.lembrar_em && a.lembrar_em <= hojeBrasil() ? " alerta" : ""}`} style={{ margin: 0, display: "block", fontWeight: 400 }}>
                        {a.lembrar_em
                          ? `🔔 Lembrar em ${formatarData(a.lembrar_em)}${a.lembrar_em < hojeBrasil() ? " — atrasado" : a.lembrar_em === hojeBrasil() ? " — hoje" : ""}`
                          : "Pendente — edite para definir a data."}
                      </span>
                    )}
                  </div>
                  {podeAgenda && (
                    <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button className="fu-icone-btn" title="Editar agendamento" onClick={() => abrirAgendaEdicao(a)}>✎</button>
                      <button className="fu-icone-btn lixeira" title="Excluir agendamento" onClick={() => removerAgenda(a)}>🗑</button>
                    </span>
                  )}
                </div>
                {a.data_execucao && <div className="detalhe" style={{ margin: 0 }}>🛠 Execução prevista: {formatarData(a.data_execucao)}</div>}
                {a.equipe?.length > 0 && <div className="detalhe" style={{ margin: 0 }}>Equipe: {a.equipe.map((m) => m.nome).join(", ")}</div>}
                {/* Equipe vazia (ex.: o único membro foi desativado): só avisa —
                    o ⛔ de "escolha a equipe" vale ao salvar o agendamento. */}
                {!(a.equipe?.length > 0) && agendamentoFuturo(a, hojeBrasil()) && (
                  <div className="val-campo" aria-live="polite">
                    <p className="val-msg val-aviso aviso-plano">⚠️ Agendamento sem equipe — escale alguém{podeAgenda ? " (✎ Editar)" : ""}.</p>
                  </div>
                )}
                {a.equipamentos?.length > 0 && <div className="detalhe" style={{ margin: 0 }}>Equipamentos: {a.equipamentos.join(", ")}</div>}
                {a.checklist?.length > 0 && (
                  <div className="detalhe" style={{ margin: "2px 0 0" }}>
                    {a.checklist.map((i) => `${i.ok ? "✓" : "✗"} ${i.item}`).join(" · ")}
                  </div>
                )}
                {/* Fase 6: avisos da execução (não impedem nada). */}
                {agExec?.id === a.id && avisosExec.mensagens.length > 0 && (
                  <div className="val-campo aviso-plano" aria-live="polite" style={{ marginTop: 4 }}>
                    {avisosExec.mensagens.map((m) => <p key={m} className="val-msg val-aviso">⚠️ {m}</p>)}
                    {podeAgenda && avisosExec.faltamEquipamentos.length > 0 && (
                      <button type="button" className="val-acao" disabled={adicionandoEquip === a.id}
                        onClick={() => adicionarEquipamentosAoAgendamento(a, avisosExec.faltamEquipamentos)}>
                        {adicionandoEquip === a.id ? "Adicionando…" : `Adicionar ${avisosExec.faltamEquipamentos.join(", ")}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            </div>
          )}
          {/* Remarcações: a data antiga não some — fica aqui, recolhida. */}
          {agRemarcados.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="detalhe" style={{ margin: 0, cursor: "pointer" }}>
                Histórico de remarcações ({agRemarcados.length})
              </summary>
              {agRemarcados.map((a) => {
                const novo = agendamentos.find((x) => x.id === a.substituido_por);
                const de = a.data_visita ? textoPeriodo(periodoDe(a)) : "data a definir";
                const para = novo?.data_visita ? textoPeriodo(periodoDe(novo)) : novo?.a_definir ? "data a definir" : "—";
                return (
                  <div key={a.id} className="detalhe os-linha" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: 0, padding: "6px 0" }}>
                    <span>
                      ↪ Remarcado de <s>{de}</s> para <strong>{para}</strong> ({rotuloEtapa(a.tipo)})
                      {a.substituido_em ? ` · em ${formatar(a.substituido_em)}` : ""}
                    </span>
                    {podeAgenda && (
                      <button className="fu-icone-btn lixeira" title="Apagar do histórico" onClick={() => removerAgenda(a)}>🗑</button>
                    )}
                  </div>
                );
              })}
            </details>
          )}
        </SecaoRecolhivel>

      <SecaoRecolhivel id="checklist" titulo="Checklist de equipamentos"
        aberta={secoes.aberta("checklist")} onAlternar={() => secoes.alternar("checklist")}
        resumo={resumoChecklist}>
        <ChecklistEquipamentos
          key={encerrada ? "ro" : "rw"}
          inspecaoId={id}
          etapa={bloco}
          procedimento={insp.procedimento}
          clienteId={insp.projeto?.cliente?.id}
          embutido
          onResumo={setResumoChecklist}
          onErro={setErroChecklist}
        />
      </SecaoRecolhivel>

      {/* Fotos só existem no bloco de execução. Recolhida, segue montada:
          alimenta o aviso ao concluir a Execução e as fotos do relatório. */}
      {bloco === "execucao" && (
        <SecaoRecolhivel id="fotos" titulo="Coleta de fotos da execução"
          aberta={secoes.aberta("fotos")} onAlternar={() => secoes.alternar("fotos")}
          resumo={resumoFotos}>
          <ColetaFotosExecucao key={encerrada ? "ro" : "rw"} inspecaoId={id} onMudar={setFotosExec} embutido
            onLocais={setFotosLocais} onErro={setErroFotos} aguaPotavel={!!procOS?.agua_potavel}
            cloroUnidade={cloroOS.unidade} cloroLimiteAviso={cloroOS.limite} periodoExecucao={periodoExec} />
        </SecaoRecolhivel>
      )}

      {/* RDO — Registro Diário de Operação: um por dia no projeto, preenchido
          na Execução. Recolhido segue montado: alimenta o aviso da fase 7. */}
      {insp.fase >= 6 && insp.projeto && (
        <SecaoRecolhivel id="rdos" titulo={`RDOs — diário de operação${rdosInsp ? ` (${rdosInsp.length})` : ""}`}
          aberta={secoes.aberta("rdos")} onAlternar={() => secoes.alternar("rdos")}
          resumo={erroRdos ? <span className="alerta">Erro — abra a seção</span>
            : rdosInsp === null ? "Carregando…"
            : rdosInsp.length === 0 && insp.fase >= 7 && !periodoExec ? <span className="alerta">Nenhum RDO</span>
            : diasSemRdoAteHoje.length > 0 ? (
              <>
                {rdosInsp.length ? resumoRdos(rdosInsp) : "Nenhum RDO"} ·{" "}
                <span className="alerta" title={textoDiasSemRdo(diasSemRdoAteHoje)}>
                  Dias sem RDO: {diasSemRdoAteHoje.map((d) => dataCurta(d.dia)).join(", ")}
                </span>
              </>
            )
            : resumoRdos(rdosInsp)}
          acoesCabecalho={podeColeta && <button className="btn-azul" onClick={() => setPedidoNovoRdo((n) => n + 1)}>+ Novo RDO</button>}>
          <Rdos projetoId={insp.projeto.id} inspecaoId={id}
            codigoProjeto={insp.projeto.codigo_projeto || insp.projeto.pedido_compra}
            cliente={insp.projeto.cliente?.razao_social} clienteId={insp.projeto.cliente?.id}
            podeEditar={podeColeta} somenteLeitura={encerrada} embutido pedidoNovo={pedidoNovoRdo}
            onMudar={setRdosInsp} onErro={setErroRdos} />
        </SecaoRecolhivel>
      )}

      {/* Relatórios (Operações envia; Gerência aprova nas fases 5/9) */}
      <SecaoRecolhivel id="relatorios" titulo={`Relatórios (${relatorios.length})`}
        aberta={secoes.aberta("relatorios")} onAlternar={() => secoes.alternar("relatorios")}
        resumo={resumoRelatorios}
        acoesCabecalho={podeRelatorio && (
            <>
              <span className="detalhe" style={{ margin: 0, alignSelf: "center" }}
                title="O tipo segue a fase da OS: inspeção até a fase 5, execução da 6 em diante.">
                Relatório de {ROTULO_TIPO[bloco]}
              </span>
              <button className="btn-azul btn-sec" onClick={() => {
                // Um rascunho por tipo: "gerar" abre o rascunho que já existe.
                const rasc = rascunhoBloco ? relatorios.find((x) => x.id === rascunhoBloco.id) : null;
                setRascunhoEmEdicao(rasc ? { id: rasc.id, dados: rasc.dados || null } : null);
                setModalRelatorio(true);
              }}>{rascunhoBloco ? `📄 Editar rascunho v${rascunhoBloco.versao}` : "📄 Gerar relatório"}</button>
              <button className="btn-azul" onClick={() => relatorioInputRef.current?.click()} disabled={enviandoRelatorio || verificandoArquivo}>
                {verificandoArquivo ? "Conferindo…" : enviandoRelatorio ? "Enviando…" : "Enviar relatório"}
              </button>
              <input ref={relatorioInputRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) escolherRelatorioExterno(f); }} />
            </>
        )}>
        {erroRelatorio && (
          <p className="erro-texto" style={{ margin: "0 0 8px" }}>{erroRelatorio}</p>
        )}
        {erroAssinado && (
          <p className="erro-texto" style={{ margin: "0 0 8px" }}>⛔ Versão assinada: {erroAssinado}</p>
        )}
        <input ref={assinadoInputRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) escolherAssinado(f); else setAssinando(null); }} />
        <p className="detalhe" style={{ marginTop: 0 }}>
          Cada envio para aprovação é uma nova versão (a que estava em aprovação é substituída). Um rascunho por tipo:
          gerar de novo atualiza o mesmo. Envio de fora: PDF ou DOCX, até 30 MB. A Gerência aprova ou marca “Ajustar”.
        </p>
        {relatorios.length === 0 ? (
          <p className="vazio" style={{ margin: 0 }}>Nenhum relatório enviado.</p>
        ) : (
          <div className="os-lista">
            {relatorios.map((r) => (
              <div key={r.id} className="linha-item os-linha">
                <div className="linha-texto">
                  <div style={{ color: "var(--texto)" }}>
                    <strong style={{ textTransform: "capitalize" }}>{ROTULO_TIPO[r.tipo as TipoRelatorio] || r.tipo}</strong> v{r.versao} —{" "}
                    <span style={{ color: corStatus(r.status) }}>{rotuloStatus(r.status)}</span>
                  </div>
                  {r.status === "substituido" && (
                    <div className="detalhe" style={{ margin: 0 }}>
                      Substituído{(() => { const n = relatorios.find((x) => x.id === r.substituido_por); return n ? ` pela v${n.versao}` : ""; })()}
                      {r.substituido_em ? ` em ${formatar(r.substituido_em)}` : ""} — saiu da fila da Gerência.
                    </div>
                  )}
                  {r.motivo_ajuste && <div className="detalhe" style={{ margin: 0 }}>Ajuste: {formatarMotivo(r.motivo_categoria, r.motivo_ajuste)}</div>}
                  {r.status === "rascunho" && r.tipo === "execucao" && exigeLaudoExecucao && !r.dados?.laudoPdf?.caminho && (
                    <div className="val-msg val-aviso aviso-plano" style={{ margin: "2px 0" }}>⚠️ Sem o PDF do laudo do laboratório — obrigatório para enviar para aprovação.</div>
                  )}
                  {r.enviado_em && (
                    <div className="detalhe" style={{ margin: 0 }}>
                      Enviado{r.enviado_por ? ` por ${nomeDe(r.enviado_por)}` : ""} em {formatar(r.enviado_em)}
                    </div>
                  )}
                  {(r.status === "aprovado" || r.status === "assinado" || r.status === "ajustar") && (r.avaliado_por || r.aprovado_por) && (
                    <div className="detalhe" style={{ margin: 0 }}>
                      {r.status === "ajustar" ? "Reprovado" : "Aprovado"} por {nomeDe(r.avaliado_por || r.aprovado_por)}
                      {r.avaliado_em ? ` em ${formatar(r.avaliado_em)}` : ""}
                    </div>
                  )}
                  {r.status === "assinado" && (
                    <div className="detalhe" style={{ margin: 0 }}>
                      Versão assinada enviada{r.assinado_por ? ` por ${nomeDe(r.assinado_por)}` : ""}{r.assinado_em ? ` em ${formatar(r.assinado_em)}` : ""} — é o documento final.
                    </div>
                  )}
                </div>
                <span className="linha-acoes">
                  {podeRelatorio && r.status === "rascunho" && (
                    <>
                      <button className="btn-dl" disabled={enviandoRelatorio}
                        title={r.tipo === "execucao" && exigeLaudoExecucao && !r.dados?.laudoPdf?.caminho
                          ? "Falta o PDF do laudo do laboratório — clique em Editar e anexe" : "Submeter este rascunho à Gerência"}
                        onClick={() => enviarParaAprovacao(r)}>
                        {enviandoRelatorio ? "Enviando…" : "↗ Enviar para aprovação"}
                      </button>
                      <button className="btn-dl btn-sec"
                        title={r.dados ? "Reabrir o formulário com os dados salvos" : "Refazer o documento (gera uma nova versão)"}
                        onClick={() => { setRascunhoEmEdicao({ id: r.id, dados: r.dados || null }); setModalRelatorio(true); }}>Editar</button>
                      <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                        disabled={excluindoRelatorio === r.id} onClick={() => excluirRascunho(r.id)}>
                        {excluindoRelatorio === r.id ? "…" : "Excluir"}
                      </button>
                    </>
                  )}
                  {podeAssinar && r.status === "aprovado" && (
                    <button className="btn-dl" disabled={!!enviandoAssinado}
                      title="Enviar o PDF assinado — passa a ser o documento final deste relatório"
                      onClick={() => pedirAssinado(r, false)}>
                      {enviandoAssinado === r.id ? "Enviando…" : "✍ Enviar versão assinada"}
                    </button>
                  )}
                  {podeTrocarAssinado && r.status === "assinado" && (
                    <button className="btn-dl btn-sec" disabled={!!enviandoAssinado}
                      title="Trocar o PDF assinado (só Gerência/Admin) — o atual é apagado"
                      onClick={() => pedirAssinado(r, true)}>
                      {enviandoAssinado === r.id ? "Enviando…" : "Trocar assinada"}
                    </button>
                  )}
                  {r.status === "assinado" && r.assinado_path && (
                    <a className="btn-dl" href={`/api/relatorios/${r.id}/download?arquivo=assinado`} target="_blank" rel="noopener noreferrer"
                      onClick={() => marcarBaixado(r.id)}>Baixar assinado</a>
                  )}
                  <a className="btn-dl btn-sec" href={`/api/relatorios/${r.id}/download`} target="_blank" rel="noopener noreferrer"
                    onClick={() => marcarBaixado(r.id)}>{r.status === "assinado" ? "Baixar original" : "Baixar"}</a>
                  {r.dados?.laudoPdf?.caminho && (
                    <a className="btn-dl btn-sec" href={`/api/relatorios/${r.id}/download?arquivo=laudo`} target="_blank" rel="noopener noreferrer"
                      title={`PDF do laudo do laboratório: ${r.dados.laudoPdf.nome || ""}`}>🧪 Laudo</a>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </SecaoRecolhivel>

      {/* Fase 10: entregas ao cliente (vale também com a OS encerrada). */}
      {insp.fase >= ULTIMA_FASE && (
        <SecaoRecolhivel id="entregas" titulo="Entregas ao cliente"
          aberta={secoes.aberta("entregas")} onAlternar={() => secoes.alternar("entregas")}
          resumo={resumoEntregas}>
          <EntregasCliente inspecaoId={id} perfil={perfil} versao={versaoDados} onResumo={setResumoEntregas} />
        </SecaoRecolhivel>
      )}

      {/* Arquivos do projeto inteiro, para consulta sem sair da inspeção. */}
      <SecaoRecolhivel id="arquivos" titulo={`Arquivos do projeto (${arquivos.length})`}
        aberta={secoes.aberta("arquivos")} onAlternar={() => secoes.alternar("arquivos")}
        resumo={arquivos.length === 0 ? "Nenhum arquivo" : `${arquivos.length} arquivo${arquivos.length === 1 ? "" : "s"}`}>
        {arquivos.length === 0 ? (
          <p className="vazio" style={{ margin: 0 }}>Nenhum arquivo anexado neste projeto.</p>
        ) : (
          (["inspecao", "execucao", "laudo", "rdo", "medicao"] as const).map((grupo) => {
            const itens = arquivos.filter((a) => a.grupo === grupo);
            if (itens.length === 0) return null;
            const titulo = grupo === "inspecao" ? "Relatórios de inspeção"
              : grupo === "execucao" ? "Relatórios de execução"
              : grupo === "laudo" ? "Laudos (laboratório)"
              : grupo === "rdo" ? "RDOs — diário de operação" : "Medições";
            return (
              <div key={grupo} style={{ marginTop: 14 }}>
                <h4 style={{ margin: "0 0 2px", fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--cinza)" }}>
                  {titulo} ({itens.length})
                </h4>
                {itens.map((a) => (
                  <div key={a.href} className="os-linha" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", flexWrap: "wrap" }}>
                    <span className="detalhe" style={{ margin: 0 }}>
                      <strong style={{ color: "var(--texto)" }}>{a.inspecao}</strong> · {a.rotulo}
                      {a.data ? ` · ${formatar(a.data)}` : ""}
                    </span>
                    <a className="btn-dl btn-sec" href={a.href} target="_blank" rel="noopener noreferrer">Baixar</a>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </SecaoRecolhivel>

      <SecaoRecolhivel id="historico" titulo="Histórico de fases"
        aberta={secoes.aberta("historico")} onAlternar={() => secoes.alternar("historico")}
        resumo={ultimaMov
          ? `${descreverAcaoFase(ultimaMov.acao, ultimaMov.fase_de, ultimaMov.fase_para)} · ${formatar(ultimaMov.data_autenticacao || ultimaMov.criado_em)}`
          : "Sem movimentações ainda"}>
        {historico.length === 0 ? (
          <p className="vazio" style={{ margin: 0 }}>Sem movimentações ainda.</p>
        ) : (
          <div className="os-lista">
            {historico.map((h) => (
              <div key={h.id} className="os-linha">
                <div style={{ fontSize: 14, color: "var(--texto)", fontWeight: 600 }}>
                  {descreverAcaoFase(h.acao, h.fase_de, h.fase_para)}
                </div>
                {h.motivo && (
                  <div className="detalhe" style={{ margin: 0 }}>
                    {h.acao === "assinar" ? h.motivo : `Motivo: ${formatarMotivo(h.motivo_categoria, h.motivo)}`}
                  </div>
                )}
                <div className="detalhe" style={{ margin: 0 }}>
                  Por {h.autor_perfil?.nome_completo || h.autor_perfil?.email || "usuário"} · {formatar(h.data_autenticacao || h.criado_em)}
                </div>
              </div>
            ))}
          </div>
        )}
      </SecaoRecolhivel>
      </div>

      {/* Modal: baixar modelo vazio (N vetores × m pontos) */}
      {modalModelo && (
        <Modal titulo="⬇ Baixar modelo de batimetria" onFechar={() => setModalModelo(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="detalhe" style={{ margin: 0 }}>
              Gera uma planilha vazia com a quantidade exata de vetores e pontos, já com as fórmulas
              (ALTURA REAL, Altura sedimento e VALIDAÇÃO). Preencha as leituras e depois use “Importar”.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Vetores</label>
                <input type="number" min={1} max={24} style={inputStyle} value={modN} onChange={(e) => setModN(e.target.value)} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Pontos por vetor</label>
                <input type="number" min={1} max={60} style={inputStyle} value={modM} onChange={(e) => setModM(e.target.value)} />
              </div>
            </div>
            <p className="detalhe" style={{ margin: 0 }}>
              Dica: mantenha a distância entre pontos ≤ 2 m — a quantidade de pontos depende do diâmetro do tanque.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalModelo(false)} disabled={gerandoModelo}>Cancelar</button>
              <button className="btn-azul" onClick={baixarModelo} disabled={gerandoModelo}>{gerandoModelo ? "Gerando…" : "Baixar .xlsx"}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: digitar batimetria (mesma matemática da importação) */}
      {modalEntrada && (
        <EntradaBatimetria
          tanque={insp.tanque}
          onFechar={() => setModalEntrada(false)}
          onGerar={(estado) => { setModalEntrada(false); carregarNoMedidor(estado); }}
        />
      )}

      {/* Modal: importar batimetria (CSV/XLSX no layout da planilha) */}
      {modalImport && (
        <Modal titulo="⬆ Importar batimetria" zIndex={200} onFechar={() => setModalImport(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="detalhe" style={{ margin: 0 }}>
              Envie a planilha no layout atual (blocos v1..vN com Esquerda/Centro/Direita e a linha “Altura sedimento”).
              Cada lateral vira um vetor paralelo atravessando o tanque — todas as leituras entram no cálculo.
              {insp.tanque ? " Formato e medidas vieram do cadastro do tanque da OS." : ""}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Formato do tanque</label>
                <select style={inputStyle} value={impFormato} onChange={(e) => setImpFormato(e.target.value as any)}>
                  <option value="circulo">Cilíndrico (círculo)</option>
                  <option value="quadrado">Quadrado</option>
                  <option value="retangulo">Retângulo</option>
                  <option value="ngon">N-ágono (cilindro)</option>
                  <option value="custom">Personalizado (vértices)</option>
                </select>
              </div>
              {impFormato === "retangulo" && (
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Largura ({impUnidade}) *</label>
                  <input style={inputStyle} value={impLargura} onChange={(e) => setImpLargura(e.target.value)} placeholder="ex.: 4" inputMode="decimal" />
                </div>
              )}
              {impFormato === "ngon" && (
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Nº de lados</label>
                  <input style={inputStyle} value={impLados} onChange={(e) => setImpLados(e.target.value)} placeholder="6" inputMode="numeric" />
                </div>
              )}
              {impFormato === "custom" && (
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Vértices (x,y; …) *</label>
                  <input style={inputStyle} value={impVertices} onChange={(e) => setImpVertices(e.target.value)} placeholder="-3,-2; 3,-2; 3,2; -3,2" />
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>
                  {impFormato === "quadrado" || impFormato === "retangulo" ? `Comprimento (${impUnidade}) *` : `Diâmetro (${impUnidade}) *`}
                </label>
                <input style={inputStyle} value={impDiametro} onChange={(e) => setImpDiametro(e.target.value)} placeholder="ex.: 12" inputMode="decimal" />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Altura do tanque ({impUnidade})</label>
                <input style={inputStyle} value={impAltura} onChange={(e) => setImpAltura(e.target.value)} placeholder="auto (planilha)" inputMode="decimal" />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Unidade</label>
                <select style={inputStyle} value={impUnidade} onChange={(e) => setImpUnidade(e.target.value as "m" | "cm")}>
                  <option value="m">metros</option>
                  <option value="cm">centímetros</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Arquivo (CSV ou XLSX)</label>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setImpArquivo(e.target.files?.[0] || null)} />
            </div>
            {impErro && <p className="erro-texto" style={{ margin: 0 }}>{impErro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalImport(false)} disabled={importando}>Cancelar</button>
              <button className="btn-azul" onClick={importarBatimetria} disabled={importando}>{importando ? "Importando…" : "Importar e abrir medidor"}</button>
            </div>
          </div>
        </Modal>
      )}

      {modalRelatorio && (
        <GerarRelatorio
          onFechar={() => { setModalRelatorio(false); setRascunhoEmEdicao(null); }}
          estadoSalvo={rascunhoEmEdicao?.dados || null}
          nomeArquivo={`Relatorio-${(insp?.identificacao || "OS").replace(/[^\w-]+/g, "-")}`}
          inicial={dadosIniciaisRelatorio}
          usuarios={usuarios}
          coletas={coletas.filter((c) => c.tipo !== "anexo" && medicaoPreenchida(c.dados))}
          // Relatório de Execução: as fotos da coleta entram já posicionadas.
          coletaFotos={bloco === "execucao" ? fotosExec : undefined}
          inspecaoId={id}
          revisaoEsperada={revisaoRelatorio}
          codigoEsperado={codigoRelatorio(codigoProjetoOS, revisaoRelatorio)}
          podeEditarRevisao={podeEditarRevisao({ perfil, funcao })}
          equipeAgendada={(agDoBloco?.equipe || []).map((m) => m.id).filter(Boolean)}
          // Fase 8: RDOs, período da execução e arquivos da OS (laudo).
          execucao={bloco === "execucao" ? { rdos: rdosInsp, periodo: periodoExec, arquivosOS } : undefined}
          onSalvar={async (blob, snapshot) => {
            const arquivo = new File([blob], `Relatorio-${insp?.identificacao || "OS"}.docx`, {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });
            // Rascunho: a API atualiza o rascunho do tipo (um só) ou cria.
            const r = await enviarRelatorio(arquivo, { rascunho: true, dados: snapshot, formato: "docx" });
            if (!r.ok) throw new Error(r.erro || "Falha ao salvar o rascunho.");
          }}
        />
      )}

      {/* Confirmação do envio de relatório de fora (PDF/DOCX) */}
      {envioExterno && (() => {
        const plano = planejarEnvio(refsRelatorio, bloco);
        const tam = (envioExterno.arquivo.size / 1048576).toFixed(1).replace(".", ",");
        return (
          <Modal titulo="Enviar relatório para aprovação" onFechar={() => setEnvioExterno(null)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0, overflowWrap: "anywhere" }}>
                Arquivo: <strong>{envioExterno.arquivo.name}</strong> ({tam} MB{envioExterno.formato ? ` · ${envioExterno.formato.toUpperCase()}` : ""})
              </p>
              {!envioExterno.erro && (
                <p style={{ margin: 0 }}>
                  Será criada a <strong>versão v{plano.versao}</strong> do relatório de {ROTULO_TIPO[bloco]}, já{" "}
                  <strong>em aprovação</strong> pela Gerência.
                </p>
              )}
              {!envioExterno.erro && plano.substitui.map((x) => (
                <p key={x.id} className="val-msg val-aviso aviso-plano" style={{ margin: 0 }}>
                  ⚠️ A versão v{x.versao} em aprovação será substituída (sai da fila da Gerência).
                </p>
              ))}
              {!envioExterno.erro && rascunhoBloco && (
                <p className="detalhe" style={{ margin: 0 }}>O rascunho v{rascunhoBloco.versao} continua como rascunho.</p>
              )}
              {envioExterno.erro && <p className="val-msg val-erro" style={{ margin: 0 }}>⛔ {envioExterno.erro}</p>}
              {!envioExterno.erro && exigeLaudoExecucao && (
                <div style={{ borderTop: "1px solid var(--borda)", paddingTop: 8 }}>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }} htmlFor="laudo-externo">
                    PDF do laudo do laboratório * <span className="detalhe">(obrigatório no relatório de execução deste procedimento)</span>
                  </label>
                  {envioExterno.laudo ? (
                    <p className="detalhe" style={{ margin: 0, overflowWrap: "anywhere" }}>📎 {envioExterno.laudo.nome}</p>
                  ) : null}
                  <input id="laudo-externo" type="file" accept="application/pdf,.pdf" disabled={!!envioExterno.enviandoLaudo || enviandoRelatorio}
                    onChange={(e) => { escolherLaudoExterno(e.target.files?.[0]); e.target.value = ""; }} />
                  {envioExterno.enviandoLaudo && <span className="detalhe" style={{ display: "block" }}>Conferindo e enviando o laudo…</span>}
                  {envioExterno.erroLaudo && <p className="val-msg val-erro" style={{ margin: "4px 0 0" }} aria-live="polite">⛔ {envioExterno.erroLaudo}</p>}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button className="btn-azul btn-sec" onClick={() => setEnvioExterno(null)} disabled={enviandoRelatorio}>Cancelar</button>
                <button className="btn-azul" onClick={confirmarEnvioExterno}
                  disabled={!!envioExterno.erro || enviandoRelatorio || !!envioExterno.enviandoLaudo || (exigeLaudoExecucao && !envioExterno.laudo)}>
                  {enviandoRelatorio ? "Enviando…" : `Enviar como v${plano.versao}`}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Modal: medidor de sedimento (ferramenta de campo embutida por iframe) */}
      {modalMedidor && (
        <Modal titulo={coletaEditando ? "📐 Editar medição" : "📐 Medidor de Sedimento"}
          onFechar={() => { setModalMedidor(false); setColetaEditando(null); editandoRef.current = null; dadosCarregarRef.current = null; }}
          largo semPadding>
          <div className="medidor-shell">
            <div className="medidor-barra" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--borda)", background: "var(--bg-suave)", flexShrink: 0 }}>
              <span className="detalhe" style={{ margin: 0 }}>
                {msgMedidor ? <strong style={{ color: "#16a34a" }}>✓ {msgMedidor}</strong>
                  : coletaEditando ? "Editando o registro salvo — salvar atualiza esta medição (e o PDF dela)."
                  : "A medição é salva como Relatório Técnico interno (editável). “Salvar relatório (PDF)” salva a medição com o PDF anexado."}
              </span>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn-azul btn-sec" onClick={() => setModalEntrada(true)}>✍ Digitar</button>
                <button className="btn-azul btn-sec" onClick={abrirImport}>⬆ Importar</button>
                <button className="btn-azul btn-sec" onClick={pedirPdfMedicao} disabled={gerandoPdfMedicao || salvandoMedicao || !!confirmacao}
                  title={coletaEditando ? "Gera o PDF e anexa (ou substitui) na medição aberta" : "Salva a medição com o relatório em PDF anexado"}>
                  {gerandoPdfMedicao ? "Gerando…" : "📄 Salvar relatório (PDF)"}
                </button>
                <button className="btn-azul" onClick={pedirSalvarMedicao} disabled={salvandoMedicao || !!confirmacao}>
                  {salvandoMedicao ? "Salvando…" : "💾 Salvar medição"}
                </button>
              </span>
            </div>
            <iframe ref={medidorRef} src="/ferramentas/medidor-sedimento-asp.html" title="Medidor de Sedimento"
              style={{ flex: 1, width: "100%", border: "none", display: "block" }} />
          </div>
        </Modal>
      )}

      {/* Modal: confirmar a medição (Fase 3). Regras em lib/validacao/coleta.ts
          e medicao.ts — a API repete: ⛔ bloqueia, ⚠️ só alerta. */}
      {confirmacao && (
        <Modal titulo={confirmacao.modo === "pdf" ? "📄 Salvar relatório (PDF) da medição" : "💾 Salvar medição"} zIndex={300}
          onFechar={() => { if (!salvandoMedicao) setConfirmacao(null); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="detalhe" style={{ margin: 0 }}>
              {confirmacao.editId
                ? confirmacao.modo === "pdf" ? "Atualiza a medição aberta e anexa (ou substitui) o PDF dela." : "Atualiza a medição aberta."
                : confirmacao.modo === "pdf" ? "Salva a medição nesta OS com o relatório em PDF anexado." : "Salva a medição nesta OS."}
            </p>
            {retiraAprovacao && (
              <p className="val-msg val-aviso aviso-plano">⚠️ Esta medição está aprovada; ao salvar, a aprovação será retirada (será preciso aprovar de novo).</p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label htmlFor="cf-data" style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Data da coleta *</label>
                <input id="cf-data" type="date" style={inputStyle} value={cfData} max={hojeBrasil()}
                  className={resultadoConfirmacao.erros.dataColeta ? "val-invalido" : undefined}
                  onChange={(e) => { setCfData(e.target.value); setCfServidor(novoResultado()); }} />
                <MensagensCampo r={resultadoConfirmacao} campo="dataColeta" />
              </div>
              <div>
                <label htmlFor="cf-resp" style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Responsável pela medição *</label>
                <select id="cf-resp" style={inputStyle} value={cfResp}
                  className={resultadoConfirmacao.erros.responsavelId ? "val-invalido" : undefined}
                  onChange={(e) => { setCfResp(e.target.value); setCfServidor(novoResultado()); }}>
                  <option value="">— escolha —</option>
                  {responsaveisEquipe.length > 0 && (
                    <optgroup label="Equipe agendada">
                      {responsaveisEquipe.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                    </optgroup>
                  )}
                  <optgroup label={responsaveisEquipe.length > 0 ? "Demais usuários" : "Usuários"}>
                    {responsaveisOutros.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </optgroup>
                </select>
                <MensagensCampo r={resultadoConfirmacao} campo="responsavelId" />
              </div>
            </div>
            <MensagensCampo r={resultadoConfirmacao} campo="medicao" />
            <MensagensCampo r={resultadoConfirmacao} campo="valores" />
            <MensagensCampo r={resultadoConfirmacao} campo="tanque">
              {difTanque.length > 0 && insp.tanque && podeRenomear && (
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <button type="button" className="btn-dl btn-sec" disabled={atualizandoTanque} onClick={atualizarTanqueComMedicao}>
                    {atualizandoTanque ? "Atualizando…" : "Atualizar cadastro do tanque"}
                  </button>
                  <span className="detalhe" style={{ margin: 0, alignSelf: "center" }}>ou salve mantendo o cadastro como está.</span>
                </span>
              )}
            </MensagensCampo>
            <ResumoValidacao r={resultadoConfirmacao} rotulos={ROTULOS_COLETA} />
            {cfErro && <p className="val-msg val-erro">⛔ {cfErro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={() => setConfirmacao(null)} disabled={salvandoMedicao}>Voltar ao medidor</button>
              <button className="btn-azul" onClick={confirmarMedicao} disabled={salvandoMedicao || temErros(resultadoConfirmacao)}>
                {salvandoMedicao ? (confirmacao.modo === "pdf" ? "Gerando e enviando…" : "Salvando…")
                  : confirmacao.modo === "pdf" ? "Salvar com PDF" : "Salvar medição"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: anexar PDF avulso (tipo 'anexo', descrição obrigatória). */}
      {modalAnexo && (
        <Modal titulo="📎 Anexar PDF" onFechar={() => { if (!enviandoColeta) setModalAnexo(false); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="detalhe" style={{ margin: 0 }}>
              Documento avulso da coleta (laudo, foto em PDF, relatório de terceiro). Medição do medidor
              não entra aqui — use “Nova medição”.
            </p>
            <div>
              <label htmlFor="anx-desc" style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Descrição *</label>
              <input id="anx-desc" style={inputStyle} value={anxDescricao} maxLength={200}
                placeholder="ex.: Laudo de espessura do fundo"
                className={anxTentou && resultadoAnexo.erros.descricao ? "val-invalido" : undefined}
                onChange={(e) => { setAnxDescricao(e.target.value); setAnxServidor(novoResultado()); }} />
              <MensagensCampo r={resultadoAnexo} campo="descricao" mostrarErros={anxTentou} />
            </div>
            <div>
              <label htmlFor="anx-data" style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Data da coleta *</label>
              <input id="anx-data" type="date" style={inputStyle} value={anxData} max={hojeBrasil()}
                className={resultadoAnexo.erros.dataColeta ? "val-invalido" : undefined}
                onChange={(e) => { setAnxData(e.target.value); setAnxServidor(novoResultado()); }} />
              <MensagensCampo r={resultadoAnexo} campo="dataColeta" />
            </div>
            <div>
              <label htmlFor="anx-arq" style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Arquivo PDF * (até 20 MB)</label>
              <input id="anx-arq" type="file" accept="application/pdf,.pdf"
                onChange={(e) => escolherArquivoAnexo(e.target.files?.[0] || null)} />
              <MensagensCampo r={resultadoAnexo} campo="arquivo" mostrarErros={anxTentou || !!anxErroArquivo || !!anxHash} />
            </div>
            <ResumoValidacao r={resultadoAnexo} rotulos={ROTULOS_COLETA} mostrarErros={anxTentou} />
            {anxErro && <p className="val-msg val-erro">⛔ {anxErro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalAnexo(false)} disabled={enviandoColeta}>Cancelar</button>
              <button className="btn-azul" onClick={salvarAnexo} disabled={enviandoColeta || (anxTentou && temErros(resultadoAnexo))}>
                {enviandoColeta ? "Enviando…" : "Anexar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: agendamento com checklist extensível. Regras em
          lib/validacao/agendamento.ts (a API repete): ⛔ nos campos bloqueia
          salvar; ⚠️ só alerta. O resumo aparece junto do botão. */}
      {modalAgenda && (
        <Modal titulo={agendaEditando ? `Editar agendamento (${rotuloEtapa(agTipo)})` : `Agendar ${rotuloEtapa(agTipo)}`} onFechar={() => { setModalAgenda(false); setAgendaEditando(null); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 14, color: "var(--texto)", cursor: "pointer" }}>
              <input type="checkbox" checked={agADefinir} style={{ width: 18, height: 18 }}
                onChange={(e) => { setAgADefinir(e.target.checked); mexeuAgenda(); }} />
              <span><strong>Data a definir</strong> — agendar sem data (fica como pendência no Dashboard e avisa Comercial/Gerência).</span>
            </label>
            {agADefinir ? (
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Lembrar em</label>
                <input type="date" style={inputStyle} value={agLembrar} min={ctxAgenda.hoje}
                  onChange={(e) => { setAgLembrar(e.target.value); mexeuAgenda(); }} />
                <MensagensCampo r={resultadoAgenda} campo="lembrarEm" />
                <small style={{ color: "var(--cinza)" }}>Opcional — nesse dia o aviso fica em destaque no Dashboard.</small>
                {/* Sem campo de data: a remarcação (substitui o atual) aparece aqui. */}
                <MensagensCampo r={resultadoAgenda} campo="dataVisita" />
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>{agTipo === "execucao" ? "Início da execução *" : "Data da visita *"}</label>
                  <input type="date" min={agendaEditando && agDataOriginal && agDataOriginal < ctxAgenda.hoje ? undefined : ctxAgenda.hoje}
                    className={(agTentou || !!agData) && resultadoAgenda.erros.dataVisita ? "val-invalido" : undefined}
                    style={inputStyle} value={agData} onChange={(e) => { setAgData(e.target.value); mexeuAgenda(); }} />
                  <MensagensCampo r={resultadoAgenda} campo="dataVisita" mostrarErros={agTentou || !!agData} />
                </div>
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Hora</label>
                  <input type="time" style={inputStyle} value={agHora} onChange={(e) => { setAgHora(e.target.value); mexeuAgenda(); }} />
                  <MensagensCampo r={resultadoAgenda} campo="hora" />
                </div>
                {/* Execução de vários dias: o período todo entra em conflitos,
                    agenda, e-mail/.ics e no controle de RDO por dia. */}
                {agTipo === "execucao" && (
                  <div>
                    <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Último dia da execução</label>
                    <input type="date" min={agData || undefined}
                      className={resultadoAgenda.erros.dataFim ? "val-invalido" : undefined}
                      style={inputStyle} value={agDataFim} onChange={(e) => { setAgDataFim(e.target.value); mexeuAgenda(); }} />
                    <MensagensCampo r={resultadoAgenda} campo="dataFim" />
                    <small style={{ color: "var(--cinza)" }}>Em branco = um dia só.</small>
                  </div>
                )}
              </div>
            )}

            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Data prevista de execução</label>
              <input type="date" min={!agADefinir && agData ? agData : undefined}
                className={resultadoAgenda.erros.dataExecucao ? "val-invalido" : undefined}
                style={inputStyle} value={agDataExec} onChange={(e) => { setAgDataExec(e.target.value); mexeuAgenda(); }} />
              <MensagensCampo r={resultadoAgenda} campo="dataExecucao" />
              <small style={{ color: "var(--cinza)" }}>Opcional — quando já se sabe a data prevista da execução.</small>
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>Equipe (usuários notificados){agADefinir ? "" : " *"}</label>
              {usuarios.length === 0 ? (
                <p className="detalhe" style={{ margin: 0 }}>Nenhum usuário disponível.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {usuarios.map((u) => {
                    const sel = agEquipeIds.includes(u.id);
                    return (
                      <button type="button" key={u.id} onClick={() => toggleEquipe(u.id)} aria-pressed={sel}
                        style={{ padding: "5px 12px", minHeight: 36, borderRadius: 20, fontSize: 13, cursor: "pointer",
                          border: `1px solid ${sel ? "var(--primaria)" : "var(--borda)"}`,
                          background: sel ? "var(--primaria)" : "transparent", color: sel ? "#fff" : "var(--texto)" }}>
                        {sel ? "✓ " : ""}{u.nome}{u.funcao ? ` · ${u.funcao}` : ""}
                      </button>
                    );
                  })}
                  {/* Gravados que ficaram inativos: aparecem para poder tirar. */}
                  {agEquipe.filter((m) => !usuarios.some((u) => u.id === m.id)).map((m) => (
                    <button type="button" key={m.id} onClick={() => toggleEquipe(m.id)} title="Usuário inativo — clique para tirar"
                      style={{ padding: "5px 10px", borderRadius: 20, fontSize: 13, cursor: "pointer", border: "1px solid #b3261e", background: "transparent", color: "#b3261e" }}>
                      ✕ {m.nome} (inativo)
                    </button>
                  ))}
                </div>
              )}
              <MensagensCampo r={resultadoAgenda} campo="equipe" mostrarErros={agTentou || agEquipeIds.length > 0} />
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Equipamentos</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={inputStyle} value={agEquipInput} list="catalogo-equipamentos"
                  onChange={(e) => { setAgEquipInput(e.target.value); setAgMsgEquip(null); }}
                  placeholder="ex.: Detector de gases" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEquipamento(); } }} />
                <datalist id="catalogo-equipamentos">
                  {ctxAgenda.catalogo?.map((n) => <option key={n} value={n} />)}
                </datalist>
                <button type="button" className="btn-azul btn-sec" onClick={addEquipamento}>+ Add</button>
              </div>
              {agMsgEquip && <p className="val-msg val-erro" style={{ marginTop: 4 }}>⛔ {agMsgEquip}</p>}
              {agEquipamentos.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {agEquipamentos.map((eq, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, background: "var(--bg-suave)", border: "1px solid var(--borda)", fontSize: 13 }}>
                      {eq}
                      <button type="button" aria-label={`Remover ${eq}`} onClick={() => { setAgEquipamentos((p) => p.filter((_, idx) => idx !== i)); mexeuAgenda(); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cinza)", padding: 0, lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <MensagensCampo r={resultadoAgenda} campo="equipamentos">
                {/* Previstos no procedimento e fora da lista: um clique adiciona. */}
                {faltamNoModal.length > 0 && (
                  <button type="button" className="val-acao"
                    onClick={() => { setAgEquipamentos((p) => [...p, ...faltamNoModal]); mexeuAgenda(); }}>
                    Adicionar {faltamNoModal.join(", ")}
                  </button>
                )}
                {/* Fora do Catálogo, mas parecido com um item dele: um clique troca. */}
                {agEquipamentos.map((eq) => {
                  const s = sugestaoCatalogo(eq, ctxAgenda.catalogo);
                  return s ? (
                    <button key={eq} type="button" className="val-acao" onClick={() => trocarEquipamento(eq, s)}>
                      Usar “{s}” no lugar de “{eq}”
                    </button>
                  ) : null;
                })}
              </MensagensCampo>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>Checklist</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {agChecklist.map((c, i) => (
                  // O ✕ fica fora do <label>: clicar nele não pode marcar/desmarcar o item.
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, fontSize: 14,
                      color: "var(--texto)", cursor: "pointer", padding: "6px 0" }}>
                      <input type="checkbox" checked={c.ok} style={{ width: 18, height: 18 }}
                        onChange={(e) => setAgChecklist((prev) => prev.map((x, idx) => idx === i ? { ...x, ok: e.target.checked } : x))} />
                      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", textAlign: "left" }}>{c.item}</span>
                    </label>
                    <button type="button" className="fu-icone-btn" title={`Remover “${c.item}”`} aria-label={`Remover “${c.item}”`}
                      style={{ width: 36, height: 36, flex: "none" }}
                      onClick={() => { setAgChecklist((prev) => prev.filter((_, idx) => idx !== i)); mexeuAgenda(); }}>✕</button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input style={inputStyle} value={agNovoItem} onChange={(e) => { setAgNovoItem(e.target.value); setAgMsgItem(null); }}
                  placeholder="adicionar item ao checklist"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItemChecklist(); } }} />
                <button type="button" className="btn-azul btn-sec" onClick={addItemChecklist}>+ Item</button>
              </div>
              {agMsgItem && <p className="val-msg val-erro" style={{ marginTop: 4 }}>⛔ {agMsgItem}</p>}
              <MensagensCampo r={resultadoAgenda} campo="checklist" />
            </div>
            {/* Resumo só depois de tentar salvar — antes, as mensagens ficam nos campos. */}
            {agTentou && <ResumoValidacao r={resultadoAgenda} rotulos={ROTULOS_AGENDAMENTO} />}
            {erroAgenda && <p className="erro-texto" style={{ margin: 0 }}>{erroAgenda}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalAgenda(false)} disabled={salvandoAgenda}>Cancelar</button>
              <button className="btn-azul" onClick={salvarAgenda} disabled={salvandoAgenda || (agTentou && temErros(resultadoAgenda))}>
                {salvandoAgenda ? "Salvando…" : substituidosAgenda.length > 0 || remarcandoAgenda ? "Remarcar" : "Salvar agendamento"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: procedimento da OS (antes era um seletor sempre aberto no
          topo). Trocar salva na hora, como antes. */}
      {editandoProc && podeRenomear && (
        <Modal titulo="Procedimento da OS" onFechar={() => setEditandoProc(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="detalhe" style={{ margin: 0 }}>
              Define o formato do relatório (tópicos, seções próprias e modelo) e a lista do checklist. Trocar salva na hora.
            </p>
            <label htmlFor="os-procedimento" style={{ fontWeight: 600, fontSize: 13 }}>Procedimento *</label>
            <select id="os-procedimento" value={insp.procedimento || ""} disabled={salvandoProc}
              onChange={(e) => salvarProcedimento(e.target.value)} style={inputStyle}>
              {/* Procedimento é obrigatório: "não definido" só aparece em
                  OS antiga sem procedimento, e não pode ser escolhido. */}
              {!insp.procedimento && <option value="" disabled>— não definido (escolha um) —</option>}
              {/* Procedimento sem código não pode ser escolhido: o valor
                  vazio se confunde com "não definido" e nada seria salvo. */}
              {/* Desativado no Catálogo: só aparece se for o desta OS
                  (continua valendo, mas não pode ser escolhido de novo). */}
              {procedimentos.filter((p) => ativoNoCatalogo(p) || p.codigo === insp.procedimento).map((p) => (
                <option key={p.id} value={p.codigo || ""} disabled={!p.codigo}>
                  {p.codigo ? `${p.codigo} — ${p.nome}` : `${p.nome} (sem código — corrija no Catálogo)`}
                  {ativoNoCatalogo(p) ? "" : " (desativado no Catálogo)"}
                </option>
              ))}
              {/* Valor salvo que não existe mais no Catálogo continua visível. */}
              {insp.procedimento && !procedimentos.some((p) => p.codigo === insp.procedimento) && (
                <option value={insp.procedimento}>{insp.procedimento} (fora do Catálogo)</option>
              )}
            </select>
            {salvandoProc && <span className="detalhe" style={{ margin: 0 }} aria-live="polite">Salvando…</span>}
            {erroProc && <p className="erro-texto" style={{ margin: 0 }}>{erroProc}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn-azul" onClick={() => setEditandoProc(false)} disabled={salvandoProc}>Concluir</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: cadastro do tanque */}
      {editandoTanque && (
        <Modal titulo="Tanque da OS" onFechar={() => setEditandoTanque(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="detalhe" style={{ margin: 0 }}>
              Dimensões, capacidade e material — saem na identificação do tanque de todo relatório desta OS.
            </p>
            <FormularioTanque valor={tanqueForm} onChange={setTanqueForm} desabilitado={salvandoTanque} />
            {erroTanque && <p className="erro-texto" style={{ margin: 0 }}>{erroTanque}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setEditandoTanque(false)} disabled={salvandoTanque}>Cancelar</button>
              <button className="btn-azul" onClick={salvarTanque} disabled={salvandoTanque}>
                {salvandoTanque ? "Salvando…" : "Salvar tanque"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: motivo do ajuste (reprovação) */}
      {reprovar && (
        <Modal titulo={reprovar.rotulo} onFechar={() => setReprovar(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, color: "var(--texto-suave)" }}>
              {relEmAvaliacao ? <>Reprovando a <strong>v{relEmAvaliacao.versao}</strong>. </> : null}
              A OS volta para a fase {reprovar.destino} ({nomeFase(reprovar.destino)}) com a tag “Ajustar”. Informe o motivo:
            </p>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Categoria *</span>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={inputStyle} aria-label="Categoria do ajuste">
                <option value="">Escolha…</option>
                {categoriasReprovacao(relAval?.tipo || (insp ? tipoDaFase(insp.fase) : null)).map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
              </select>
            </label>
            <MensagensCampo r={valReprovacao} campo="categoria" mostrarErros={tentouReprovar} />
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>O que ajustar *</span>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={4}
                placeholder="Ex.: a foto 3 é de outro tanque; o volume do tópico 7 não bate com a medição."
                style={{ ...inputStyle, resize: "vertical" }} autoFocus />
            </label>
            <MensagensCampo r={valReprovacao} campo="motivo" mostrarErros={tentouReprovar} />
            <ResumoValidacao r={valReprovacao} rotulos={ROTULOS_REPROVACAO} mostrarErros={tentouReprovar} />
            {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={() => setReprovar(null)} disabled={processando}>Cancelar</button>
              <button className="btn-azul" onClick={() => {
                setTentouReprovar(true);
                if (temErros(valReprovacao)) return;
                const av = resumoValidacao(valReprovacao, ROTULOS_REPROVACAO).avisos;
                if (av.length && !confirm(`Atenção:\n\n• ${av.join("\n• ")}\n\nReprovar mesmo assim?`)) return;
                aplicar(reprovar.acao, motivo, categoria);
              }} disabled={processando}>
                {processando ? "Enviando…" : "Confirmar ajuste"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function formatar(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function formatarData(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("pt-BR");
}
function rotuloStatus(s: string) {
  return ROTULO_STATUS_RELATORIO[s] || s;
}
function corStatus(s: string) {
  return ({ em_aprovacao: "#c2410c", aprovado: "#16a34a", ajustar: "#dc2626", assinado: "#7c3aed" } as Record<string, string>)[s] || "var(--texto-suave)";
}
/** Etapa do agendamento por extenso ("inspecao" → "inspeção"). */
function rotuloEtapa(t: string) {
  return t === "execucao" ? "execução" : "inspeção";
}
