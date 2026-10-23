"use client";

/** Geração do Relatório Técnico a partir do template da ASP.
 *
 * A tela é organizada por tópico: cada um tem uma caixa de seleção e, logo
 * abaixo, os campos daquele tópico e o envio de fotos correspondente. Ao
 * desmarcar, a seção sai do documento e os números seguintes são reajustados.
 * A capa é o tópico 0 e também pode ser omitida.
 *
 * Fase 4 (validação): cliente, TAG, endereço e procedimento vêm do cadastro
 * (só leitura); revisão e código são calculados (editáveis só por Admin,
 * Gerência ou função com "Editar revisão/código"); datas são campos de data (ISO, saem dd/mm/aaaa);
 * pessoas são escolhidas por usuário (id); as fotos são conferidas (formato,
 * tamanho, repetida, legenda, vaga) e salvas com o rascunho. Regras em
 * lib/validacao/relatorio.ts — a API repete as que bloqueiam.
 *
 * Fase 8 (relatório de execução): pH/cloro numéricos (pré-preenchidos da
 * coleta de fotos, comparados com a coleta e os RDOs), laudo de laboratório
 * conferido célula a célula (com os limites da Portaria 888/2021), PDF do
 * laudo obrigatório para enviar para aprovação, data da operação × período ×
 * RDOs e equipe × RDOs. Regras em lib/validacao/relatorioExecucao.ts. */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import EditorTexto from "./EditorTexto";
import {
  gerarRelatorioDocx, lerTopicosDoModelo, lerVagasDeImagem, LAUDO_COLUNAS, LAUDO_PARAMETROS,
  TOPICOS_PADRAO, TOPICO_CAPA, topicosDoProcedimento, capaVisivel, ehLimpezaRobotizada, numeroDaSecao,
  type DadosRelatorio, type ImagemRelatorio, type VagaImagem,
} from "@/lib/asp/relatorio";
import {
  pendenciasColeta, planejarFotosNoRelatorio, valorDoSlot, cloroDoProcedimento, fotosDoSlot, SECOES_FOTOS,
  type RegistroFotosExecucao,
} from "@/lib/asp/fotos-execucao";
import { enviarLaudoPdf, examinarLaudoLocal, type ArquivoOS } from "@/lib/asp/laudo-pdf";
import { camposDaMedicao } from "@/lib/asp/relatorio";
import { MATERIAIS_TANQUE } from "@/lib/asp/procedimentos";
import { prepararImagemRelatorio } from "@/lib/asp/imagem-relatorio";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { MensagensCampo, ResumoValidacao } from "./MensagensCampo";
import {
  atualizarRascunho, faixaVolume, hojeBrasil, isoParaBr, PAPEIS_PESSOA, ROTULOS_RELATORIO, temErros, TOPICO_EXTRAS,
  validarRelatorio, type FotoSalva, type PapelPessoa, type SnapshotRelatorio,
  CAMPOS_PH_CLORO, COL_LIMITE, converterPhCloroLegado, foraDoLimite, gradeLaudo, lerValorMedido, mesclar, normalizarCelulaLaudo,
  preencherLimitesPadrao, procedimentoUsaLaudo, ROTULOS_PH_CLORO, ROTULOS_RELATORIO_EXECUCAO, SLOT_PH_CLORO,
  sugestaoConclusao, textoNumeroBr, textoPhCloroDoc, validarRelatorioExecucao, FONTE_PORTARIA_888,
  type ChaveLaudo, type LaudoPdf, type Periodo, type RdoResumo, type ResultadoValidacao,
} from "@/lib/validacao";

export type { SnapshotRelatorio } from "@/lib/validacao";

export interface ColetaOpcao {
  id: string; criado_em: string; dados: any; aprovada_em?: string | null;
  /** Dia da coleta (AAAA-MM-DD): a data do relatório não pode ser antes. */
  data_coleta?: string | null;
}

export interface UsuarioRelatorio { id: string; nome: string; perfil: string; funcao: string | null }

interface Props {
  onFechar: () => void;
  inicial: Partial<DadosRelatorio>;
  nomeArquivo: string;
  /** Usuários da base — a lista de envolvidos sai daqui. */
  usuarios: UsuarioRelatorio[];
  /** Medições salvas: definem os dados automáticos (altura, diâmetro, volume). */
  coletas: ColetaOpcao[];
  /** Anexa o .docx ao card como RASCUNHO (o envio é um passo à parte).
   *  O snapshot é gravado junto para o rascunho poder ser reaberto e editado. */
  onSalvar: (blob: Blob, snapshot: SnapshotRelatorio) => Promise<void>;
  /** Snapshot de um rascunho salvo — reabre o formulário como estava, com
   *  as fotos (salvas no storage junto com o rascunho) e os dados do banco
   *  atualizados ("O que mudou desde o rascunho"). */
  estadoSalvo?: SnapshotRelatorio | null;
  /** Coleta de fotos da execução — só no Relatório de Execução. As fotos
   *  entram já posicionadas e as pendências viram aviso (nunca bloqueio). */
  coletaFotos?: RegistroFotosExecucao | null;
  /** OS — as fotos do rascunho ficam em relatorios/<OS>/rascunho-fotos/. */
  inspecaoId: string;
  /** Revisão (reprovações do mesmo tipo) e código da capa, calculados. */
  revisaoEsperada: number;
  codigoEsperado: string;
  /** Admin, Gerência ou função com "Editar revisão/código": podem corrigir revisão/código à mão. */
  podeEditarRevisao: boolean;
  /** Equipe do agendamento do mesmo tipo (ids) — já vem marcada. */
  equipeAgendada: string[];
  /** Só no Relatório de Execução (Fase 8): RDOs que cobrem a OS (null =
   *  carregando), período do agendamento de execução e os arquivos da OS que
   *  o PDF do laudo não pode repetir. */
  execucao?: { rdos: RdoResumo[] | null; periodo: Periodo | null; arquivosOS: ArquivoOS[] };
}

interface FotoTopico {
  /** Arquivo final (PNG/JPEG — WebP/GIF/HEIC já convertidos). */
  arquivo: File; legenda: string; topico: number; ancora?: string;
  /** SHA-256 do arquivo: a mesma foto não entra duas vezes. */
  hash: string;
  extensao: "png" | "jpeg";
  /** Onde está no storage: rascunho-fotos/<hash> (depois de salvar) ou a
   *  foto original da coleta da execução. */
  caminho?: string;
  /** Ocupa uma vaga do modelo — legenda e fonte vêm do próprio .docx. */
  vaga?: boolean;
  /** Crédito da imagem — sai como "Fonte: …" abaixo da legenda. */
  fonte?: string;
  /** Vaga exata do tópico (0 = primeira). Sem índice, a próxima livre. */
  vagaIndice?: number;
  /** Veio da coleta de fotos da execução: item de origem, para o painel. */
  coleta?: string;
  /** URL local da miniatura (só fotos da coleta). */
  previa?: string;
  /** SHA-256 do arquivo escolhido antes da conversão (upload manual). */
  hashOriginal?: string;
  /** SHA-256 do original guardado na coleta de fotos (foto pré-carregada). */
  hashColeta?: string;
}

/** Hashes que identificam a mesma imagem: o arquivo final, o original
 *  escolhido e o original da coleta de fotos da execução. */
type ComHashes = { hash: string; hashOriginal?: string; hashColeta?: string };
const hashesDe = (f: ComHashes) => [f.hash, f.hashOriginal, f.hashColeta].filter((h): h is string => !!h);
const mesmaImagem = (a: ComHashes, b: ComHashes) => hashesDe(a).some((h) => hashesDe(b).includes(h));

/** Em que vaga cada foto do tópico cai — a MESMA regra do gerador: primeiro
 *  as que pediram posição (`vagaIndice`), depois as demais na ordem. */
function distribuirVagas<T extends { f: FotoTopico }>(lista: T[], total: number): (T | undefined)[] {
  const pos: (T | undefined)[] = new Array(total).fill(undefined);
  lista.forEach((x) => {
    const k = x.f.vagaIndice;
    if (k !== undefined && k >= 0 && k < total && !pos[k]) pos[k] = x;
  });
  const livres = lista.filter((x) => !pos.includes(x));
  for (let k = 0; k < total; k++) if (!pos[k]) pos[k] = livres.shift();
  return pos;
}

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 };
const celLaudo: React.CSSProperties = {
  border: "1px solid var(--borda)", padding: "3px 5px", textAlign: "left",
};
const grade: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
};

const TODOS_TOPICOS = [TOPICO_CAPA, ...TOPICOS_PADRAO];
/** O que o seletor de fotos aceita: PNG/JPEG entram direto; WebP, GIF, BMP
 *  e HEIC são convertidos (HEIC só se o navegador abrir). */
const ACEITA_FOTO = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/heic,image/heif,.heic,.heif";
const campoLeitura: React.CSSProperties = { ...campo, background: "var(--bg-suave)", color: "var(--texto-suave)", cursor: "not-allowed" };

/** O procedimento de limpeza robotizada tem blocos que não existem nos demais
 *  (valores de coleta, horários da operação e figuras em vagas fixas do
 *  modelo), então esses campos só aparecem quando ele está escolhido — nos
 *  outros procedimentos apenas poluiriam o formulário.
 *
 *  `ehLimpezaRobotizada` mora na lib porque a resolução da lista de tópicos
 *  também precisa dele: os números do modelo do POP 001 não significam o
 *  mesmo que os de TOPICOS_PADRAO. */

export default function GerarRelatorio({
  onFechar, inicial, nomeArquivo, usuarios, coletas, onSalvar, estadoSalvo, coletaFotos,
  inspecaoId, revisaoEsperada, codigoEsperado, podeEditarRevisao, equipeAgendada, execucao,
}: Props) {
  /** Valores automáticos de uma medição (já em metros). */
  const medicaoDe = (id: string) => camposDaMedicao(coletas.find((c) => c.id === id)?.dados) as Record<string, string>;
  // Por padrão usa a medição APROVADA; se não houver, a mais recente.
  const coletaPadrao = (coletas.find((c) => c.aprovada_em) || coletas[0])?.id || "";
  /** Rascunho reaberto: os dados que vêm do banco (cadastro, revisão,
   *  medição) são atualizados e o que mudou é listado. Uma vez, ao abrir. */
  const [inicio] = useState(() => (estadoSalvo?.d
    ? atualizarRascunho(estadoSalvo, {
        d: inicial, coletasIds: coletas.map((c) => c.id),
        coletaAprovadaId: coletas.find((c) => c.aprovada_em)?.id || null,
        coletaPadraoId: coletaPadrao || null, medicaoDe,
      })
    : null));
  const salvo = inicio?.snapshot || null;
  /** Rascunho antigo: pH/cloro eram texto livre ("0,5 mg/L") — viram número;
   *  o que não dá para ler fica vazio, com aviso. */
  const [legado] = useState(() => (salvo ? converterPhCloroLegado({ ...inicial, ...salvo.d }) : null));
  const [d, setD] = useState<Partial<DadosRelatorio>>(legado ? legado.d : inicial);
  /** PDF do laudo do laboratório (Fase 8): sobe ao escolher; vai no snapshot. */
  const [laudoPdf, setLaudoPdf] = useState<LaudoPdf | null>(salvo?.laudoPdf || null);
  const [enviandoLaudo, setEnviandoLaudo] = useState(false);
  const [msgLaudo, setMsgLaudo] = useState<string | null>(null);
  const [visiveis, setVisiveis] = useState<Record<number, boolean>>(
    salvo?.visiveis || Object.fromEntries(TODOS_TOPICOS.map((t) => [t.numero, true]))
  );
  // A equipe do agendamento já vem MARCADA na tela — nada entra no
  // documento sem estar visível aqui.
  const [equipeIds, setEquipeIds] = useState<string[]>(salvo?.equipeIds || equipeAgendada);
  const [equipIds, setEquipIds] = useState<string[]>(salvo?.equipIds || []);
  // Subtópicos do tópico 8 (8.1, 8.2 …) — título obrigatório, fotos próprias.
  const [subs8, setSubs8] = useState<{ titulo: string }[]>(salvo?.subs8 || []);
  /** Quem preparou/checou/aprovou… por id de usuário (o nome vai em `d`). */
  const [pessoas, setPessoas] = useState<Partial<Record<PapelPessoa, string>>>(() => {
    if (salvo?.pessoas) return salvo.pessoas;
    // Rascunho antigo guardava só o NOME: acha o usuário por ele.
    const out: Partial<Record<PapelPessoa, string>> = {};
    for (const k of PAPEIS_PESSOA) {
      const nome = (salvo?.d as any)?.[k];
      const u = nome ? usuarios.find((x) => x.nome === nome) : null;
      if (u) out[k] = u.id;
    }
    return out;
  });
  /** Revisão/código digitados à mão (só quem pode) — não são recalculados. */
  const [revisaoManual, setRevisaoManual] = useState(!!salvo?.revisaoManual);
  // Modal de valores medidos em campo (POP 001): alimentam as legendas das
  // figuras de coleta. Fica em modal por ser digitação pontual de 4 números.
  const [modalColetas, setModalColetas] = useState(false);
  // Texto das seções extras do procedimento, por índice. O título é do Catálogo.
  const [textosExtras, setTextosExtras] = useState<Record<number, string>>(salvo?.textosExtras || {});
  /** Tópicos do modelo do procedimento escolhido. Vazio = modelo padrão. */
  const [topicosModelo, setTopicosModelo] = useState<{ numero: number; titulo: string }[]>([]);
  /** Vagas de imagem do modelo (marcador [imagem] + legenda já escrita no
   *  arquivo), por tópico — qualquer tópico, não só os da limpeza
   *  robotizada. Um tópico sem vaga aqui usa o upload de fotos livre de
   *  sempre. */
  const [vagasModelo, setVagasModelo] = useState<VagaImagem[]>([]);
  /** Texto das seções do modelo que não têm campos próprios, por número. */
  const [textosTopico, setTextosTopico] = useState<Record<number, string>>(salvo?.textosTopico || {});
  /** Diagnóstico do modelo em uso. Sem isso, uma falha de leitura fica
   *  indistinguível de "procedimento sem modelo próprio": a tela não muda. */
  const [infoModelo, setInfoModelo] = useState<string>("carregando modelo…");
  /** Modelo cujos tópicos e vagas já foram lidos ("" = modelo padrão). */
  const [modeloLido, setModeloLido] = useState<string | null>(null);
  const [fotos, setFotos] = useState<FotoTopico[]>([]);
  const fotosRef = useRef(fotos);
  fotosRef.current = fotos;
  // miniaturas das fotos da coleta: libera a memória ao fechar o formulário
  useEffect(() => () => fotosRef.current.forEach((f) => f.previa && URL.revokeObjectURL(f.previa)), []);
  const [coletaId, setColetaId] = useState<string>(salvo ? salvo.coletaId : coletaPadrao);
  /** Valores automáticos da medição escolhida quando ela foi aplicada — o
   *  rascunho guarda, e reabrir só troca o que a MEDIÇÃO mudou depois. */
  const [medicaoBase, setMedicaoBase] = useState<Record<string, string>>(
    () => salvo?.medicaoBase || (coletaPadrao ? medicaoDe(coletaPadrao) : {})
  );
  /** Fotos do rascunho sendo baixadas de volta; as que não voltaram. */
  const [restaurando, setRestaurando] = useState(!!salvo?.fotos?.length);
  const [fotosPerdidas, setFotosPerdidas] = useState<string[]>([]);
  /** Fotos recusadas na escolha (formato, tamanho, repetida), por bloco. */
  const [msgFotos, setMsgFotos] = useState<{ chave: string; msgs: { m: string; aviso?: boolean }[] } | null>(null);
  const [processandoFotos, setProcessandoFotos] = useState(false);
  // Catálogo (procedimentos e equipamentos) vem do banco — aba Catálogo.
  const [PROCEDIMENTOS, setProcedimentos] = useState<any[]>([]);
  const [EQUIPAMENTOS, setEquipamentos] = useState<any[]>([]);
  /** Catálogo já respondeu — antes disso não se sabe o modelo do procedimento. */
  const [catalogoPronto, setCatalogoPronto] = useState(false);
  useEffect(() => {
    fetch("/api/catalogo").then((r) => r.ok ? r.json() : {}).then((d: any) => {
      setProcedimentos(d.procedimentos || []);
      setEquipamentos((d.equipamentos || []).map((e: any) => ({ ...e, id: e.slug })));
    }).catch(() => {}).finally(() => setCatalogoPronto(true));
  }, []);

  const [gerando, setGerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /** Revisão e código do projeto compõem o campo "Relatório" da capa,
   *  no formato do modelo: "37/MG/26 Rev1". Só quem pode edita (o campo
   *  fica travado para os demais e a API recusa valor mudado). */
  function mudarRevisao(valor: string) {
    if (!podeEditarRevisao) return;
    setRevisaoManual(true);
    setD((v) => {
      const base = v.codigoProjeto || "";
      return { ...v, revisao: valor, relatorioCodigo: base ? `${base} Rev${valor}` : v.relatorioCodigo };
    });
  }

  /** Volume de sedimento editado: a faixa de ±5% acompanha (derivada). */
  function mudarVolume(valor: string) {
    setD((v) => ({ ...v, volumeSedimento: valor, ...faixaVolume(valor) }));
  }

  /** Ao trocar a medição, os campos automáticos são recalculados a partir
   *  DAQUELA coleta — o resto do formulário é preservado. */
  function trocarColeta(id: string) {
    setColetaId(id);
    const auto = medicaoDe(id);
    setMedicaoBase(auto);
    setD((v) => ({ ...v, ...auto, ...faixaVolume(auto.volumeSedimento) }));
  }

  /** Restaura as fotos do rascunho (salvas no storage junto com ele). */
  useEffect(() => {
    const lista = salvo?.fotos || [];
    if (!lista.length) return;
    let vivo = true;
    Promise.all(lista.map(async (f): Promise<FotoTopico | string> => {
      const nome = f.coleta || f.nome;
      try {
        const url = f.caminho?.startsWith("fotos-execucao/")
          ? `/api/inspecoes/${inspecaoId}/fotos?caminho=${encodeURIComponent(f.caminho)}`
          : `/api/relatorios/foto?inspecaoId=${encodeURIComponent(inspecaoId)}&caminho=${encodeURIComponent(f.caminho || "")}`;
        const r = await fetch(url);
        if (!r.ok) return nome;
        const prep = await prepararImagemRelatorio(await r.blob(), f.nome);
        if ("erro" in prep) return nome;
        return {
          arquivo: prep.arquivo, hash: prep.hash, extensao: prep.extensao, caminho: f.caminho,
          legenda: f.legenda, topico: f.topico, ancora: f.ancora, vaga: f.vaga, vagaIndice: f.vagaIndice,
          fonte: f.fonte, coleta: f.coleta, previa: f.coleta ? URL.createObjectURL(prep.arquivo) : undefined,
          hashOriginal: f.hashOriginal,
          hashColeta: (f.caminho && hashColetaPorCaminho.get(f.caminho)) || f.hashColeta,
        };
      } catch {
        return nome;
      }
    })).then((res) => {
      if (!vivo) return;
      setFotos((p) => [...res.filter((x): x is FotoTopico => typeof x !== "string"), ...p]);
      setFotosPerdidas(res.filter((x): x is string => typeof x === "string"));
      setRestaurando(false);
    });
    return () => { vivo = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof DadosRelatorio) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setD((v) => ({ ...v, [k]: e.target.value }));

  const ativo = (n: number) => visiveis[n] !== false;
  const proc = useMemo(
    () => PROCEDIMENTOS.find((p) => p.codigo === d.procedimento) || null,
    [d.procedimento, PROCEDIMENTOS]
  );
  /** Unidade do cloro do procedimento (Catálogo, Fase 7): legendas e valores. */
  const unidadeCloro = cloroDoProcedimento(proc).unidade;

  // Cada procedimento pode ter o seu modelo, com outras seções. A lista de
  // escolha vem do próprio arquivo — é o que garante que você marque as
  // seções que aquele relatório realmente tem.
  const caminhoModelo = proc?.template_path || null;
  useEffect(() => {
    const url = caminhoModelo
      ? `/api/catalogo/template?caminho=${encodeURIComponent(caminhoModelo)}`
      : undefined;
    const origem = caminhoModelo ? `modelo de ${proc?.codigo || "procedimento"}` : "modelo padrão da ASP";
    setInfoModelo(`lendo ${origem}…`);
    setModeloLido(null);
    const lidos = lerTopicosDoModelo(url)
      .then((t) => {
        setTopicosModelo(t);
        setInfoModelo(t.length
          ? `${origem} · ${t.length} seções`
          : `${origem} · nenhuma seção reconhecida no arquivo`);
      })
      .catch((e) => {
        setTopicosModelo([]);
        setInfoModelo(`falha ao ler o ${origem}: ${e instanceof Error ? e.message : "erro"}`);
      });
    // Vagas de imagem do modelo — falha aqui não precisa de mensagem própria
    // na tela: sem vaga lida, o tópico só volta a usar o upload de fotos
    // livre, que é o comportamento de sempre.
    const vagas = lerVagasDeImagem(url).then(setVagasModelo).catch(() => setVagasModelo([]));
    // leitura de um modelo que já foi trocado não marca o atual como lido
    let vigente = true;
    Promise.all([lidos, vagas]).then(() => { if (vigente) setModeloLido(caminhoModelo || ""); });
    return () => { vigente = false; };
  }, [caminhoModelo, proc?.codigo]);

  /** Seções que já possuem campos próprios no formulário, reconhecidas pelo
   *  TÍTULO — o número muda de um modelo para outro. */
  const TEM_CAMPOS = [
    /identifica[çc][ãa]o do local/i, /identifica[çc][ãa]o do tanque/i,
    /^m[ée]todos?$/i, /equipamentos?\s+utilizados?/i, /equipe de trabalho/i,
    /dados\s+(do\s+)?reservat[óo]rio/i, /^batimetria$/i,
    /inspe[çc][ãa]o visual interna/i, /^conclus[ãa]o$/i, /^recomenda[çc][õo]es$/i,
    /^anexos$/i,
  ];

  /** Lista de tópicos configurada no Catálogo para este procedimento.
   *  Quando existe, ela manda — é a lista que você edita lá. Resolvida pela
   *  MESMA função que o Catálogo usa, senão as duas telas discordam.
   *
   *  Memoizada em `proc`: sem isso, `topicosDoProcedimento` recalcularia (e
   *  realocaria a lista padrão de 10 itens) a cada tecla digitada em
   *  qualquer campo do formulário, e a nova identidade do array a cada
   *  render tornaria inútil qualquer useMemo rio abaixo que dependa dela. */
  const listaProc = useMemo(() => topicosDoProcedimento(proc), [proc]);

  /** `listaProc` com o número sempre resolvido (posição ORIGINAL do item na
   *  lista, nunca a posição depois de um filtro). Usada por tudo que precisa
   *  do número de um tópico — se cada consumidor aplicasse `numero ?? i+1`
   *  com o próprio índice pós-filtro, um item sem número ganharia números
   *  diferentes em cada lugar (o checkbox controlaria um número, o texto
   *  seria gravado sob outro), e o checkbox do formulário perderia o efeito
   *  de esconder o tópico de verdade. */
  const listaNumerada = useMemo(
    () => listaProc.map((t, i) => ({ ...t, numero: t.numero ?? i + 1 })),
    [listaProc]
  );

  /** Quais tópicos o Catálogo manda marcar para este procedimento.
   *  null = procedimento sem configuração, não há o que aplicar. */
  function selecaoDoCatalogo(): Record<number, boolean> | null {
    if (listaNumerada.length === 0) return null;
    return {
      0: capaVisivel(proc),
      ...Object.fromEntries(listaNumerada.map((t) => [t.numero, t.ativo !== false])),
    };
  }

  /** Ao escolher o procedimento, a seleção de tópicos passa a ser a do
   *  Catálogo. Sem isto o Catálogo dizia "Batimetria fora" e o formulário
   *  mostrava Batimetria marcada — e o documento saía conforme o Catálogo,
   *  não conforme a tela. Relatório retomado mantém a seleção salva com ele. */
  const procAplicado = useRef<string | null>(null);
  useEffect(() => {
    const id = proc?.id || null;
    if (!id || id === procAplicado.current) return;
    const primeiraVez = procAplicado.current === null;
    procAplicado.current = id;
    if (primeiraVez && estadoSalvo?.visiveis) return;
    const selecao = selecaoDoCatalogo();
    if (selecao) setVisiveis(selecao);
  }, [proc?.id, listaProc.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Quantos tópicos o procedimento tem configurados no Catálogo (inclui a
   *  capa, que é o número 0). null = nunca foi configurado. */
  const qtdConfigurada: number | null = Array.isArray(proc?.topicos) ? proc!.topicos.length : null;

  /** A leitura do modelo pode ter perdido seções — um título que o leitor não
   *  reconhece (numeração fora do padrão, texto quebrado em vários <w:t>,
   *  título com mais de 90 caracteres) some da lista sem erro nenhum.
   *
   *  Isto é só um AVISO. O modelo entra na tela por INTEIRO, sempre — quem
   *  decide o que fica de fora do relatório é o Catálogo (topicos_lista),
   *  nunca uma adivinhação daqui. Substituir a lista real por uma lista
   *  padrão "por segurança" é o problema oposto: esconderia justamente as
   *  seções que o modelo tem e o Catálogo ainda não configurou. */
  const modeloIncompleto =
    topicosModelo.length > 0 && qtdConfigurada !== null && topicosModelo.length + 1 < qtdConfigurada;

  /** Capa + seções em uso: a lista do Catálogo manda; sem ela, todo o modelo
   *  entra — nunca uma lista padrão no lugar do modelo real.
   *
   *  Memoizada porque `qtdOcultos`, logo abaixo, depende dela: sem isso o
   *  array seria reconstruído (nova identidade) a cada render e o useMemo de
   *  `qtdOcultos` nunca bateria a comparação de dependências — recalculando
   *  em toda tecla digitada, exatamente o que o useMemo deveria evitar. */
  const TOPICOS_EM_USO = useMemo(() => (
    listaNumerada.length > 0
      ? [TOPICO_CAPA, ...listaNumerada.map((t) => ({ numero: t.numero, titulo: t.titulo }))]
      : topicosModelo.length > 0
        ? [TOPICO_CAPA, ...topicosModelo]
        : TODOS_TOPICOS
  ), [listaNumerada, topicosModelo]);

  /** Seções do modelo sem campos próprios: ganham bloco genérico. Só quando o
   *  procedimento tem modelo próprio — no modelo padrão todos já têm campos.
   *
   *  `ativo !== false` (não `t.ativo` puro) para casar com `selecaoDoCatalogo`
   *  acima: um item sem `ativo` gravado deve contar como ativo nos dois
   *  lugares, senão o tópico aparece marcado (visível) no checklist mas sem
   *  campo de texto aqui para preencher — uma seção "ligada" e muda. */
  const topicosGenericos = (listaNumerada.length > 0
    ? listaNumerada.filter((t) => t.ativo !== false).map((t) => ({ numero: t.numero, titulo: t.titulo }))
    : topicosModelo
  ).filter((t) => t.titulo && !TEM_CAMPOS.some((re) => re.test(t.titulo)));

  const qtdOcultos = useMemo(() => TOPICOS_EM_USO.filter((t) => !ativo(t.numero)).length, [visiveis, TOPICOS_EM_USO]);

  /** Preparado / Checado / Aprovado saem dos usuários de Operações. */
  const operacoes = useMemo(() => usuarios.filter((u) => u.perfil === "operacoes"), [usuarios]);
  const gerencia = useMemo(() => usuarios.filter((u) => u.perfil === "gerencia"), [usuarios]);

  /** Procedimento escolhido na capa — dele saem as sugestões de método e
   *  de equipamentos (itens 3 e 4). */
  /** Tópicos próprios do procedimento escolhido (definidos no Catálogo). */
  /** Formulário adaptado ao procedimento de limpeza robotizada. */
  const limpeza = ehLimpezaRobotizada(proc);
  /** Fase 8: relatório de execução de procedimento com laudo — o PDF do
   *  laudo é obrigatório para enviar para aprovação. */
  const exigeLaudoPdf = !!execucao && procedimentoUsaLaudo(proc);
  // Coluna "Limite" do laudo: os da Portaria 888/2021 nas células vazias,
  // uma vez (editáveis; o documento sai com o que estiver preenchido).
  const limitesAplicados = useRef(false);
  useEffect(() => {
    if (!limpeza || limitesAplicados.current) return;
    limitesAplicados.current = true;
    setD((v) => ({ ...v, laudoAntes: preencherLimitesPadrao(v.laudoAntes), laudoDepois: preencherLimitesPadrao(v.laudoDepois) }));
  }, [limpeza]);
  /** Parâmetros do laudo acima do limite (antes e depois). */
  const foraLimite = useMemo(
    () => [...foraDoLimite("laudoAntes", d.laudoAntes), ...foraDoLimite("laudoDepois", d.laudoDepois)],
    [d.laudoAntes, d.laudoDepois]
  );
  /** Acrescenta à Conclusão a frase de cada parâmetro fora do limite. */
  function sugerirConclusao() {
    setD((v) => {
      const add = sugestaoConclusao(foraLimite, v.conclusao);
      return add ? { ...v, conclusao: (v.conclusao || "") + add } : v;
    });
    if (!ativo(9)) setVisiveis((v) => ({ ...v, 9: true }));
  }
  /** Muda uma célula do laudo (a grade é sempre completa). */
  function mudarCelula(chave: ChaveLaudo, i: number, j: number, valor: string) {
    setD((v) => {
      const g = gradeLaudo(v[chave] as string[][] | undefined);
      g[i][j] = valor;
      return { ...v, [chave]: g };
    });
  }
  /** Escolheu o PDF do laudo: confere (PDF de verdade, 30 MB, não repetido
   *  na OS) e já sobe ao storage — fica no rascunho ao salvar. */
  async function escolherLaudo(f: File | undefined | null) {
    if (!f) return;
    setMsgLaudo(null);
    setEnviandoLaudo(true);
    try {
      const ex = await examinarLaudoLocal(f, execucao?.arquivosOS || []);
      if (ex.erro || !ex.hash) { setMsgLaudo(ex.erro || "Arquivo inválido."); return; }
      if (laudoPdf?.hash === ex.hash) { setMsgLaudo("É o mesmo PDF que já está anexado."); return; }
      setLaudoPdf(await enviarLaudoPdf(inspecaoId, f, ex.hash));
    } catch (e) {
      setMsgLaudo(e instanceof Error ? e.message : "Falha ao enviar o laudo.");
    } finally {
      setEnviandoLaudo(false);
    }
  }
  const extras: { titulo: string; apos?: number }[] =
    Array.isArray(proc?.topicos_extras) ? proc!.topicos_extras : [];

  /** Título sem número nem pontuação final — mesma regra que o gerador usa
   *  para casar a lista do Catálogo com as seções do modelo. */
  const chaveDoTitulo = (t: string) =>
    t.replace(/^\s*\d+\.?\s*/, "").replace(/[:.]\s*$/, "").trim().toLowerCase();

  /** Seções que a lista do Catálogo tem e o modelo NÃO — as criadas ali com
   *  "+ Tópico". Entram no documento como seção nova, na posição da lista:
   *  logo depois do último tópico do modelo que vem antes delas.
   *
   *  Sem modelo lido não há como saber o que falta nele; aí a lista inteira
   *  pareceria nova e o relatório sairia com tudo duplicado. */
  const secoesNovas = useMemo(() => {
    if (topicosModelo.length === 0 || listaNumerada.length === 0) return [];
    const numeroPorTitulo = new Map<string, number>();
    topicosModelo.forEach((t) => {
      const k = chaveDoTitulo(t.titulo);
      if (k && !numeroPorTitulo.has(k)) numeroPorTitulo.set(k, t.numero);
    });
    const novas: { numero: number; titulo: string; apos: number }[] = [];
    let ultimoDoModelo = 0;
    for (const t of listaNumerada) {
      const n = numeroPorTitulo.get(chaveDoTitulo(t.titulo_origem || t.titulo));
      if (n !== undefined) { ultimoDoModelo = n; continue; }
      if (t.titulo?.trim()) novas.push({ numero: t.numero, titulo: t.titulo, apos: ultimoDoModelo });
    }
    return novas;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaNumerada, topicosModelo]);

  /** SHA-256 do original de cada foto da coleta (por caminho) — é o que
   *  reconhece a mesma foto anexada também à mão. */
  const hashColetaPorCaminho = useMemo(() => {
    const m = new Map<string, string>();
    for (const sec of SECOES_FOTOS) for (const sl of sec.slots) {
      for (const f of fotosDoSlot(coletaFotos, sl.id)) if (f.hash) m.set(f.caminho, f.hash);
    }
    return m;
  }, [coletaFotos]);

  /** Pendências da coleta de fotos da execução — aviso, nunca bloqueio. */
  const pendColeta = useMemo(() => (coletaFotos ? pendenciasColeta(coletaFotos) : []), [coletaFotos]);
  const [infoColeta, setInfoColeta] = useState<string | null>(null);

  /** Pré-carrega as fotos da coleta de execução, uma vez, quando o modelo do
   *  procedimento já foi lido (é dele que saem os números das seções e as
   *  vagas). O destino de cada foto está documentado em DESTINOS, em
   *  lib/asp/fotos-execucao.ts. Ficam no formulário como qualquer outra foto:
   *  dá para trocar a legenda, a vaga ou remover. */
  const coletaCarregada = useRef(false);
  useEffect(() => {
    if (coletaCarregada.current || !coletaFotos?.inspecao_id || !catalogoPronto) return;
    if (modeloLido === null || modeloLido !== (caminhoModelo || "")) return;
    // Rascunho reaberto: espera as fotos salvas voltarem — as da coleta que
    // já estão nele (mesmo arquivo de origem) não entram de novo.
    if (restaurando) return;
    coletaCarregada.current = true;
    const reg = coletaFotos;

    // Seleção de tópicos que vale para este procedimento — a mesma que o
    // efeito do Catálogo aplica; lida aqui porque o setVisiveis dele pode
    // ainda não ter chegado neste render.
    const vis = estadoSalvo?.visiveis || selecaoDoCatalogo() || visiveis;
    const marcado = (n: number) => vis[n] !== false;
    const topicos = topicosModelo.length > 0 ? topicosModelo : TOPICOS_PADRAO;
    const plano = planejarFotosNoRelatorio(reg, {
      numeroDaChave: (chave) => numeroDaSecao(topicos, chave),
      ativo: marcado,
      vagas: vagasModelo,
      primeiraSecao: topicos.find((t) => marcado(t.numero))?.numero ?? 1,
      unidadeCloro,
    });

    // pH e cloro medidos → marcadores [dado coletado] das legendas do modelo
    // da limpeza robotizada. Não sobrescreve o que já foi digitado. Só o
    // número: a unidade do cloro (do procedimento) entra ao gerar.
    const medido = (id: string, exigido: boolean) => {
      const n = exigido ? valorDoSlot(reg, id) : null;
      if (n == null) return undefined;
      return textoNumeroBr(n);
    };
    setD((x) => ({
      ...x,
      phAntes: x.phAntes || medido("agua_antes_ph", reg.agua_antes) || x.phAntes,
      cloroAntes: x.cloroAntes || medido("agua_antes_cloro", reg.agua_antes) || x.cloroAntes,
      phDepois: x.phDepois || medido("agua_depois_ph", reg.agua_depois) || x.phDepois,
      cloroDepois: x.cloroDepois || medido("agua_depois_cloro", reg.agua_depois) || x.cloroDepois,
    }));

    const novos = plano.filter((p) => !fotosRef.current.some((f) => f.caminho === p.caminho));
    if (novos.length === 0) return;
    setInfoColeta(`Baixando ${novos.length} foto(s) da coleta…`);
    const base = `/api/inspecoes/${reg.inspecao_id}/fotos?caminho=`;
    Promise.all(novos.map(async (p): Promise<FotoTopico | string> => {
      try {
        const r = await fetch(base + encodeURIComponent(p.caminho));
        if (!r.ok) return `${p.rotulo}: não foi possível baixar (sem conexão?)`;
        const blob = await r.blob();
        const ext = p.caminho.toLowerCase().endsWith(".png") ? "png" : "jpg";
        const prep = await prepararImagemRelatorio(blob, `${p.slotId}.${ext}`);
        if ("erro" in prep) return `${p.rotulo}: ${prep.erro}`;
        return {
          arquivo: prep.arquivo, hash: prep.hash, extensao: prep.extensao, caminho: p.caminho,
          legenda: p.legenda, topico: p.topico, ancora: p.ancora,
          vaga: p.vaga, vagaIndice: p.vagaIndice, coleta: p.rotulo, previa: URL.createObjectURL(prep.arquivo),
          hashColeta: hashColetaPorCaminho.get(p.caminho),
        };
      } catch {
        return `${p.rotulo}: não foi possível baixar (sem conexão?)`;
      }
    })).then((lista) => {
      const problemas = lista.filter((x): x is string => typeof x === "string");
      const ok: FotoTopico[] = [];
      for (const f of lista) {
        if (typeof f === "string") continue;
        // a mesma imagem já anexada à mão (ou em outro item da coleta) não entra 2x
        const igual = [...fotosRef.current, ...ok].find((x) => mesmaImagem(x, f));
        if (igual) { problemas.push(`${f.coleta}: é a mesma imagem de “${igual.coleta || igual.arquivo.name}” — não entrou de novo`); continue; }
        ok.push(f);
      }
      setFotos((p) => [...ok, ...p]);
      setInfoColeta(problemas.length ? `Fotos da coleta que não entraram: ${problemas.join("; ")}.` : null);
    });
  }, [coletaFotos, catalogoPronto, modeloLido, caminhoModelo, restaurando]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Onde a foto sai, em texto: "9. Coletas das amostras · vaga 3". */
  function destinoDaFoto(f: FotoTopico): string {
    if (f.topico === TOPICO_EXTRAS) {
      const i = Number(/^extra-(\d+)$/.exec(f.ancora || "")?.[1]);
      return `seção “${extras[i]?.titulo || `extra ${i + 1}`}” do procedimento`;
    }
    const t = TOPICOS_EM_USO.find((x) => x.numero === f.topico);
    const nome = t ? `${t.numero}. ${t.titulo}` : `Tópico ${f.topico}`;
    const onde = f.ancora ? ` · ${f.ancora}` : f.vaga ? "" : " · fim da seção";
    return `${nome}${onde}${ativo(f.topico) ? "" : " — tópico desmarcado, não sai"}`;
  }

  /** Move uma foto para outra vaga do mesmo tópico. Se a vaga já tinha foto
   *  com posição fixa, as duas trocam de lugar. -1 = fora das vagas. */
  function moverParaVaga(i: number, destino: number) {
    setFotos((p) => {
      const alvo = p[i];
      const anterior = alvo.vagaIndice;
      return p.map((x, k) => {
        if (k === i) return destino < 0 ? { ...x, vaga: false, vagaIndice: undefined } : { ...x, vaga: true, vagaIndice: destino };
        if (destino >= 0 && x.vaga && x.topico === alvo.topico && x.vagaIndice === destino) {
          return { ...x, vagaIndice: alvo.vaga ? anterior : undefined };
        }
        return x;
      });
    });
  }

  /** Painel das fotos que vieram da coleta: miniatura, destino, legenda ou
   *  vaga, e remover. Mostra todas num lugar só — algumas caem em tópicos
   *  cujo bloco não lista fotos fora de vaga. */
  function PainelColeta() {
    if (!coletaFotos) return null;
    const minhas = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.coleta);
    return (
      <div className="rel-bloco">
        <strong style={{ fontSize: 13.5 }}>
          Fotos da coleta de execução <span className="detalhe">— {minhas.length} carregada(s) automaticamente</span>
        </strong>
        {pendColeta.length > 0 && (
          <div className="detalhe" style={{ margin: "6px 0 0", color: "var(--pendente)" }}>
            ⚠ A coleta de fotos da execução está incompleta ({pendColeta.length} pendência(s)):
            <ul style={{ margin: "4px 0 4px 18px", padding: 0 }}>
              {pendColeta.map((p) => <li key={p}>{p}</li>)}
            </ul>
            Você pode gerar assim mesmo — o que falta só não entra no relatório. Para completar,
            use o card “Coleta de fotos da execução” da OS.
          </div>
        )}
        {infoColeta && <p className="detalhe" style={{ margin: "6px 0 0" }}>{infoColeta}</p>}
        {minhas.length === 0 && !infoColeta && (
          <p className="vazio" style={{ margin: "6px 0 0" }}>Nenhuma foto coletada nesta OS.</p>
        )}
        {minhas.map(({ f, i }) => {
          const vagas = vagasModelo.filter((v) => v.topico === f.topico);
          return (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 8, paddingTop: 8,
              borderTop: "1px solid var(--borda)", flexWrap: "wrap" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {f.previa && <img src={f.previa} alt="" style={{ width: 72, height: 54, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />}
              <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{f.coleta}</span>
                <span className="detalhe" style={{ margin: 0 }}>→ {destinoDaFoto(f)}</span>
                {vagas.length > 0 && (
                  <select style={campo} value={f.vaga && f.vagaIndice !== undefined ? f.vagaIndice : -1}
                    onChange={(e) => moverParaVaga(i, Number(e.target.value))}>
                    {vagas.map((v, k) => (
                      <option key={k} value={k}>Vaga {k + 1}: {(v.legenda || v.marcador).slice(0, 90)}</option>
                    ))}
                    <option value={-1}>Fora das vagas (figura no fim da seção)</option>
                  </select>
                )}
                {!f.vaga && (
                  <input style={campo} placeholder="Legenda *" value={f.legenda}
                    onChange={(e) => setFotos((p) => p.map((x, k) => k === i ? { ...x, legenda: e.target.value } : x))} />
                )}
                <MensagensCampo r={r} campo={`fotos.${i}`} />
              </div>
              <button className="btn-dl btn-sec btn-perigo"
                onClick={() => setFotos((p) => p.filter((_, k) => k !== i))}>Remover</button>
            </div>
          );
        })}
      </div>
    );
  }

  /** Aplica a sugestão do procedimento: preenche os métodos e marca os
   *  equipamentos previstos (o usuário ajusta depois). */
  function aplicarSugestao() {
    if (!proc) return;
    setD((v) => ({ ...v, metodos: proc.metodos || "" }));
    // Só os previstos que continuam ativos no Catálogo.
    setEquipIds((proc.equipamentos || []).filter((s: string) =>
      EQUIPAMENTOS.some((e: any) => e.slug === s && e.ativo !== false)));
    // O procedimento define o FORMATO do relatório: quais tópicos entram.
    // Sem configuração, mantém o que estiver marcado hoje.
    const selecao = selecaoDoCatalogo();
    if (selecao) setVisiveis(selecao);
  }

  /** Marca/desmarca um equipamento e reescreve o texto do tópico 4. */
  function alternarEquipamento(id: string, marcado: boolean) {
    setEquipIds((p) => (marcado ? [...p, id] : p.filter((x) => x !== id)));
  }

  const listaEquipe = useMemo(
    () => usuarios.filter((u) => equipeIds.includes(u.id))
      .map((u) => (u.funcao ? `${u.nome} — ${u.funcao}` : u.nome)),
    [usuarios, equipeIds]
  );
  const nomesEquipe = listaEquipe.join(", ");        // prévia na tela
  const equipeDoc = listaEquipe.join("\n");          // documento: um por linha

  /** Anexa fotos escolhidas: confere formato (PNG/JPEG; WebP/GIF/HEIC
   *  convertidos quando possível), tamanho (10 MB) e se a MESMA imagem já
   *  está no relatório. As recusadas aparecem logo abaixo do campo (`chave`). */
  async function adicionarArquivos(
    lista: FileList | null, restam: number, chave: string,
    base: Omit<FotoTopico, "arquivo" | "hash" | "extensao">,
  ) {
    const escolhidos = Array.from(lista || []);
    const fs = escolhidos.slice(0, Math.max(0, restam));
    if (fs.length === 0) return;
    setProcessandoFotos(true);
    const msgs: { m: string; aviso?: boolean }[] = [];
    const erro = (m: string) => msgs.push({ m });
    if (escolhidos.length > fs.length) msgs.push({ m: `${escolhidos.length - fs.length} foto(s) além do limite deste bloco foram ignoradas.`, aviso: true });
    try {
      const novas: FotoTopico[] = [];
      for (const f of fs) {
        const prep = await prepararImagemRelatorio(f, f.name);
        if ("erro" in prep) { erro(prep.erro); continue; }
        const igual = [...fotosRef.current, ...novas].find((x) => mesmaImagem(x, prep));
        if (igual) { erro(`“${f.name}” é a mesma imagem de “${igual.coleta || igual.arquivo.name}” (${destinoDaFoto(igual)}) — não foi adicionada.`); continue; }
        if (prep.convertida) msgs.push({ m: `“${f.name}” convertida (${prep.convertida}).`, aviso: true });
        novas.push({ ...base, arquivo: prep.arquivo, hash: prep.hash, extensao: prep.extensao, hashOriginal: prep.hashOriginal });
      }
      if (novas.length) setFotos((p) => [...p, ...novas]);
    } finally {
      setProcessandoFotos(false);
      setMsgFotos(msgs.length ? { chave, msgs } : null);
    }
  }

  /** Mensagens da última escolha de fotos, se foram neste bloco. */
  function MsgFotos(chave: string) {
    if (msgFotos?.chave !== chave) return null;
    return (
      <div className="val-campo" aria-live="polite">
        {msgFotos.msgs.map(({ m, aviso }) => (
          <p key={m} className={`val-msg ${aviso ? "val-aviso" : "val-erro"}`}>{aviso ? "⚠️" : "⛔"} {m}</p>
        ))}
      </div>
    );
  }

  /** Baixa a primeira foto do equipamento no Catálogo para embutir na ficha.
   *  Sem foto (ou falha no download) a ficha sai só com as especificações. */
  async function fotoDoEquipamento(e: any): Promise<{ dados: ArrayBuffer; extensao: "png" | "jpeg" } | undefined> {
    const caminho = e?.fotos?.[0]?.caminho;
    if (!caminho) return undefined;
    try {
      const r = await fetch(`/api/catalogo/foto?caminho=${encodeURIComponent(caminho)}`);
      if (!r.ok) return undefined;
      const buf = await r.arrayBuffer();
      const ext = caminho.toLowerCase().endsWith(".png") ? "png" : "jpeg";
      return { dados: buf, extensao: ext as "png" | "jpeg" };
    } catch {
      return undefined;
    }
  }

  /** Monta o .docx com o que está no formulário. */
  async function montarBlob(): Promise<Blob> {
      const fichasComFoto = await Promise.all(
        EQUIPAMENTOS.filter((e) => equipIds.includes(e.slug)).map(async (e) => ({
          nome: e.nome,
          especificacoes: e.especificacoes || [],
          foto: await fotoDoEquipamento(e),
        }))
      );
      // As seções próprias entram na MESMA lista de extras do gerador, depois
      // das do campo antigo do Catálogo. É esse índice que ancora as fotos
      // (`extra-<i>`), por isso a ordem das duas partes nunca muda.
      const ancoraDaSecaoNova = new Map<number, string>();
      secoesNovas.forEach((s, k) => ancoraDaSecaoNova.set(s.numero, `extra-${extras.length + k}`));

      const imgs: ImagemRelatorio[] = [];
      for (const f of fotos) {
        if (!ativo(f.topico)) continue;               // tópico oculto: não sai (avisado antes de gerar)
        imgs.push({
          dados: await f.arquivo.arrayBuffer(),
          extensao: f.extensao,                       // conferida pelos bytes (PNG/JPEG)
          legenda: f.legenda.trim(),                  // obrigatória — sem cair no nome do arquivo
          topico: f.topico, ancora: f.ancora || ancoraDaSecaoNova.get(f.topico),
          fonte: f.fonte?.trim() || undefined,
          vaga: f.vaga,
          vagaIndice: f.vaga ? f.vagaIndice : undefined,
        });
      }
      // Laudo: células como saem no documento ("ausente" → "Ausente").
      const laudoDoc = (g?: string[][]) => (g ? gradeLaudo(g).map((l) => l.map(normalizarCelulaLaudo)) : undefined);
      // O PDF do laudo é um arquivo à parte; o tópico Anexos (se o modelo
      // tiver) só o cita.
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const anexosDoc = laudoPdf && execucao && !(d.anexos || "").includes(esc(laudoPdf.nome))
        ? `${d.anexos || ""}<p>Laudo anexo: ${esc(laudoPdf.nome)}</p>` : d.anexos;
      // Pessoas: o documento leva o NOME do usuário escolhido (por id).
      const nomeDe = (k: PapelPessoa) => (pessoas[k] ? usuarios.find((u) => u.id === pessoas[k])?.nome : "") || d[k] || "";
      return gerarRelatorioDocx({
        titulo: d.titulo || "", cliente: d.cliente || "", endereco: d.endereco || "",
        revisao: d.revisao, statusRevisao: d.statusRevisao, dataRevisao: isoParaBr(d.dataRevisao),
        preparadoPor: nomeDe("preparadoPor"), checadoPor: nomeDe("checadoPor"), aprovadoPor: nomeDe("aprovadoPor"),
        relatorioCodigo: d.relatorioCodigo, procedimento: d.procedimento,
        unidade: d.unidade, contato: d.contato,
        dataExecucao: isoParaBr(d.dataExecucao), dataRelatorio: isoParaBr(d.dataRelatorio),
        tag: d.tag, area: d.area, material: d.material,
        // Capacidade é um campo só: alimenta "Capacidade Nominal:" (tópico 2)
        // e a célula "Capacidade" do quadro do tópico 6.
        capacidadeNominal: d.capacidadeTanque, alturaTanque: d.alturaTanque, diametro: d.diametro,
        observacoesTanque: d.observacoesTanque,
        revisadoPorCapa: nomeDe("revisadoPorCapa"),
        historico: d.historico, nivelAgua: d.nivelAgua,
        comprimento: d.comprimento, largura: d.largura,
        dataOperacao: isoParaBr(d.dataOperacao), horarios: d.horarios,
        anexos: anexosDoc,
        // pH/cloro são números; o cloro sai com a unidade do procedimento.
        cloroAntes: textoPhCloroDoc("cloroAntes", d.cloroAntes, unidadeCloro),
        cloroDepois: textoPhCloroDoc("cloroDepois", d.cloroDepois, unidadeCloro),
        phAntes: textoPhCloroDoc("phAntes", d.phAntes, unidadeCloro),
        phDepois: textoPhCloroDoc("phDepois", d.phDepois, unidadeCloro),
        alturaSedimento: d.alturaSedimento,
        laudoAntes: laudoDoc(d.laudoAntes), laudoDepois: laudoDoc(d.laudoDepois),
        equipamentoTanque: d.equipamentoTanque, capacidadeTanque: d.capacidadeTanque,
        volumeMin: d.volumeMin, volumeMax: d.volumeMax,
        metodos: d.metodos, equipamentos: d.equipamentos,
        // Só quem está marcado na tela — nunca uma equipe "escondida".
        equipe: equipeDoc,
        equipamentosFicha: fichasComFoto,
        volumeSedimento: d.volumeSedimento,
        fotosInternas: d.fotosInternas, conclusao: d.conclusao, recomendacoes: d.recomendacoes,
        subtopicos8: subs8,
        textosPorNumero: textosTopico,
        topicosLista: listaProc,
        topicosExtras: [
          ...extras.map((t, i) => ({ titulo: t.titulo, texto: textosExtras[i] || "", apos: t.apos })),
          // Desmarcada no checklist, a seção vai vazia: o gerador ignora extra
          // sem título, sem texto e sem foto, e a numeração se fecha sozinha.
          ...secoesNovas.map((s) => ({
            titulo: ativo(s.numero) ? s.titulo : "",
            texto: ativo(s.numero) ? (textosTopico[s.numero] || "") : "",
            apos: s.apos,
          })),
        ],
        templateUrl: proc?.template_path
          ? `/api/catalogo/template?caminho=${encodeURIComponent(proc.template_path)}`
          : undefined,
        elaboradoPor: nomeDe("elaboradoPor"), revisadoPor: nomeDe("revisadoPor"),
        topicos: TOPICOS_EM_USO.map((t) => ({ ...t, visivel: ativo(t.numero) })),
        imagens: imgs,
      });
  }

  /** O formulário como snapshot (é o que o rascunho grava e a API confere). */
  function montarSnapshot(): SnapshotRelatorio {
    const fotosSalvas: FotoSalva[] = fotos.map((f) => ({
      caminho: f.caminho, hash: f.hash, extensao: f.extensao, nome: f.arquivo.name, legenda: f.legenda,
      topico: f.topico, ancora: f.ancora, vaga: f.vaga, vagaIndice: f.vagaIndice, fonte: f.fonte, coleta: f.coleta,
      hashOriginal: f.hashOriginal, hashColeta: f.hashColeta,
    }));
    const nomes: Partial<DadosRelatorio> = {};
    for (const k of PAPEIS_PESSOA) {
      const u = pessoas[k] ? usuarios.find((x) => x.id === pessoas[k]) : null;
      (nomes as any)[k] = u?.nome || "";
    }
    return {
      versaoSnapshot: 2, d: { ...d, ...nomes }, visiveis, equipeIds, equipIds, coletaId, subs8, textosExtras, textosTopico,
      pessoas, revisaoManual, medicaoBase, fotos: fotosSalvas,
      ...(execucao ? { laudoPdf } : {}),
    };
  }

  /** Vagas de imagem do modelo por tópico (limite de fotos em vaga). */
  const vagasPorTopico = useMemo(() => {
    const m: Record<number, number> = {};
    vagasModelo.forEach((v) => { m[v.topico] = (m[v.topico] || 0) + 1; });
    return m;
  }, [vagasModelo]);

  const coletaSel = coletas.find((c) => c.id === coletaId) || null;
  const hoje = hojeBrasil();
  // Regras (lib/validacao/relatorio.ts) — as mesmas que a API repete.
  const snapAtual = montarSnapshot();
  const rBase = validarRelatorio(snapAtual, {
    hoje,
    dataColeta: coletaSel?.data_coleta || null,
    revisaoEsperada, codigoEsperado, podeEditarRevisao,
    medicaoAuto: coletaSel ? medicaoDe(coletaSel.id) : undefined,
    vagasPorTopico,
    nomeTopico: (n) => {
      if (n === TOPICO_EXTRAS) return "seções do procedimento";
      const t = TOPICOS_EM_USO.find((x) => x.numero === n);
      return t ? `${t.numero}. ${t.titulo}` : `tópico ${n}`;
    },
  });
  // Fase 8 — pH/cloro e laudo (todo relatório que os tem); no de execução,
  // também coleta de fotos, RDOs, período, equipe e o PDF do laudo.
  const rExec = validarRelatorioExecucao(snapAtual, {
    inspecaoId, hoje, unidadeCloro, limiteCloro: cloroDoProcedimento(proc).limite, usaLaudo: exigeLaudoPdf,
    coleta: execucao ? coletaFotos || null : null,
    rdos: execucao?.rdos ?? undefined,
    periodo: execucao?.periodo ?? null,
    equipeRelatorio: execucao ? usuarios.filter((u) => equipeIds.includes(u.id)).map((u) => u.nome) : undefined,
  });
  const r = mesclar(rBase, rExec);
  const rotulosResumo = { ...ROTULOS_RELATORIO, ...ROTULOS_RELATORIO_EXECUCAO };
  const [tentou, setTentou] = useState(false);

  /** Mensagens de uma linha do laudo (células + a linha). */
  function mensagensLinha(res: ResultadoValidacao, chave: ChaveLaudo, i: number) {
    const pref = `${chave}.${i}`;
    const pega = (m: Record<string, string[]>) =>
      Object.entries(m).filter(([k]) => k === pref || k.startsWith(`${pref}.`)).flatMap(([, l]) => l);
    return { erros: pega(res.erros), avisos: pega(res.avisos) };
  }

  /** ⛔ impede gerar; fotos em tópico desmarcado pedem confirmação. */
  function validar(): boolean {
    setErro(null);
    setTentou(true);
    if (restaurando) { setErro("Aguarde as fotos do rascunho terminarem de carregar."); return false; }
    if (processandoFotos) { setErro("Aguarde as fotos terminarem de ser processadas."); return false; }
    if (enviandoLaudo) { setErro("Aguarde o PDF do laudo terminar de ser enviado."); return false; }
    if (temErros(r)) {
      setErro("Corrija os itens marcados com ⛔ (lista abaixo) para gerar o relatório.");
      return false;
    }
    const ocultas = r.avisos.fotosOcultas?.[0];
    if (ocultas && !confirm(`${ocultas}\n\nGerar assim mesmo?`)) return false;
    // Fase 8: parâmetro do laudo fora do limite que a Conclusão não cita.
    const naoCitados = r.avisos.conclusao?.[0];
    if (naoCitados && !confirm(`${naoCitados}\n\nGerar assim mesmo?`)) return false;
    return true;
  }

  /** Sobe ao storage as fotos que ainda não estão lá (rascunho-fotos/<hash>):
   *  é o que permite reabrir o rascunho com elas. Mesmo conteúdo = mesmo
   *  caminho, então reenviar não duplica. */
  async function salvarFotos(): Promise<FotoTopico[]> {
    const supabase = getSupabaseBrowserClient();
    const atualizadas: FotoTopico[] = [];
    for (const f of fotos) {
      if (f.caminho) { atualizadas.push(f); continue; }
      const ext = f.extensao === "png" ? "png" : "jpg";
      const res = await fetch("/api/relatorios/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspecaoId, foto: { hash: f.hash, ext } }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados?.erro || "Falha ao preparar o envio das fotos.");
      if (!dados.existe) {
        const up = await supabase.storage.from("gp-arquivos").uploadToSignedUrl(dados.caminho, dados.token, f.arquivo);
        if (up.error) throw new Error(`Falha ao salvar a foto “${f.arquivo.name}”: ${up.error.message}`);
      }
      atualizadas.push({ ...f, caminho: dados.caminho });
    }
    setFotos(atualizadas);
    fotosRef.current = atualizadas;
    return atualizadas;
  }

  /** Só baixa o arquivo, sem registrar na inspeção. */
  async function baixar() {
    if (!validar()) return;
    setGerando(true);
    try {
      const blob = await montarBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${nomeArquivo}.docx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o relatório.");
    } finally {
      setGerando(false);
    }
  }

  /** Gera e anexa como rascunho no card. O envio para aprovação é feito
   *  depois, pelo botão do próprio card — assim dá para revisar antes. */
  async function salvarEEnviar() {
    if (!validar()) return;
    setEnviando(true);
    try {
      const blob = await montarBlob();
      const comCaminho = await salvarFotos();
      const snap = montarSnapshot();
      snap.fotos = (snap.fotos || []).map((f, i) => ({ ...f, caminho: comCaminho[i]?.caminho }));
      await onSalvar(blob, snap);
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar o relatório.");
    } finally {
      setEnviando(false);
    }
  }

  // IMPORTANTE: estes auxiliares são CHAMADOS como função ({Topico({...})}),
  // e não usados como componente JSX (<Topico/>). Como são declarados dentro
  // de GerarRelatorio, a cada render virariam um "tipo" novo para o React, que
  // desmontaria e remontaria a árvore — e o campo perderia o foco a cada tecla,
  // impedindo a edição. Chamando como função, o JSX é inserido no mesmo nível.

  /** Fotos de um subtópico (6.1, 6.2, 6.3), com limite de quantidade.
   *  Cada envio abre uma nova linha com legenda própria. */
  function BlocoFotosAncora({ ancora, legendaPadrao, max, topico = 6 }:
      { ancora: string; legendaPadrao: string; max: number; topico?: number }) {
    const minhas = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.ancora === ancora);
    const cheio = minhas.length >= max;
    return (
      <div style={{ marginTop: 6 }}>
        {!cheio && (
          <input type="file" accept={ACEITA_FOTO} multiple={max > 1} disabled={processandoFotos}
            onChange={(e) => {
              adicionarArquivos(e.target.files, max - minhas.length, `a-${ancora}`, { legenda: legendaPadrao, topico, ancora });
              e.target.value = "";
            }} />
        )}
        {cheio && <span className="detalhe">Limite de {max} foto(s) atingido.</span>}
        {MsgFotos(`a-${ancora}`)}
        {minhas.map(({ f, i }) => LinhaFoto(f, i))}
      </div>
    );
  }

  /** Linha de edição de uma foto: nome do arquivo, legenda, fonte e remover.
   *  A FONTE é o crédito da imagem — nossa, do cliente ou de terceiro. */
  function LinhaFoto(f: FotoTopico, i: number) {
    return (
      <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 6, alignItems: "center" }}>
        <span className="detalhe" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{f.arquivo.name}</span>
        <input style={campo} placeholder="Legenda *" value={f.legenda} aria-invalid={!!r.erros[`fotos.${i}`]}
          onChange={(e) => setFotos((p) => p.map((x, k) => k === i ? { ...x, legenda: e.target.value } : x))} />
        <input style={campo} list="sug-fonte-figura" placeholder="Fonte (padrão: ASP)"
          value={f.fonte ?? ""}
          onChange={(e) => setFotos((p) => p.map((x, k) => k === i ? { ...x, fonte: e.target.value } : x))} />
        <button className="btn-dl btn-sec btn-perigo"
          onClick={() => setFotos((p) => p.filter((_, k) => k !== i))}>Remover</button>
        <div style={{ gridColumn: "1 / -1" }}><MensagensCampo r={r} campo={`fotos.${i}`} /></div>
      </div>
    );
  }

  /** Fotos que ocupam as VAGAS do modelo, na ordem. Sem campo de legenda:
   *  ela já está escrita no .docx, ao lado de cada vaga. */
  function BlocoVagas(topico: number, max: number) {
    const minhas = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.vaga && x.f.topico === topico);
    return (
      <div style={{ marginTop: 6 }}>
        {minhas.length < max && (
          <input type="file" accept={ACEITA_FOTO} multiple disabled={processandoFotos}
            onChange={(e) => {
              adicionarArquivos(e.target.files, max - minhas.length, `v-${topico}`, { legenda: "", topico, vaga: true });
              e.target.value = "";
            }} />
        )}
        <span className="detalhe" style={{ display: "block" }}>{minhas.length} de {max} vaga(s)</span>
        {MsgFotos(`v-${topico}`)}
        {distribuirVagas(minhas, Math.max(max, minhas.length)).map((x, ordem) => x && (
          <div key={x.i} style={{ marginTop: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="detalhe" style={{ margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {ordem + 1}. {x.f.coleta || x.f.arquivo.name}
              </span>
              <button className="btn-dl btn-sec btn-perigo"
                onClick={() => setFotos((p) => p.filter((_, k) => k !== x.i))}>Remover</button>
            </div>
            <MensagensCampo r={r} campo={`fotos.${x.i}`} />
          </div>
        ))}
      </div>
    );
  }

  /** Vagas de imagem de QUALQUER tópico — não só os 5 hardcoded da limpeza
   *  robotizada. Se o modelo tem marcador [imagem] sob este título, a foto
   *  entra na posição certa com a legenda que o próprio modelo já traz,
   *  igual ao card de Análise Físico Química e Laboratorial. Sem vaga
   *  lida para este número, retorna null — o chamador cai no upload de
   *  fotos livre de sempre. */
  function BlocoVagasDoTopico(numero: number) {
    const vagas = vagasModelo.filter((v) => v.topico === numero);
    if (vagas.length === 0) return null;
    const minhas = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.vaga && x.f.topico === numero);
    const max = vagas.length;
    return (
      <div style={{ marginTop: 10 }}>
        <label style={rotulo}>
          Fotos das vagas deste tópico <span className="detalhe">— a legenda de cada uma já vem do modelo</span>
        </label>
        {minhas.length < max && (
          <input type="file" accept={ACEITA_FOTO} multiple disabled={processandoFotos}
            onChange={(e) => {
              adicionarArquivos(e.target.files, max - minhas.length, `v-${numero}`, { legenda: "", topico: numero, vaga: true });
              e.target.value = "";
            }} />
        )}
        <span className="detalhe" style={{ display: "block", marginTop: 4 }}>{minhas.length} de {max} vaga(s)</span>
        {MsgFotos(`v-${numero}`)}
        {/* Vagas preenchidas na ordem em que as fotos são anexadas — mesma
            ordem em que o gerador as consome no documento. A legenda ajuda a
            saber qual foto vai em qual vaga antes de anexar. */}
        {distribuirVagas(minhas, vagas.length).map((anexo, i) => {
          const v = vagas[i];
          return (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
              <span className="detalhe" style={{ margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {i + 1}. {v.legenda || "(sem legenda no modelo)"}
                {anexo && ` — ${anexo.f.coleta || anexo.f.arquivo.name}`}
              </span>
              {anexo && (
                <button className="btn-dl btn-sec btn-perigo"
                  onClick={() => setFotos((p) => p.filter((_, k) => k !== anexo.i))}>Remover</button>
              )}
              {anexo && <MensagensCampo r={r} campo={`fotos.${anexo.i}`} />}
            </div>
          );
        })}
      </div>
    );
  }

  /** Bloco de fotos de um tópico. */
  function BlocoFotos({ topico, max, legendaPadrao }: { topico: number; max?: number; legendaPadrao?: string }) {
    const minhas = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.topico === topico && !x.f.ancora);
    const limite = max ?? 20;
    const cheio = minhas.length >= limite;
    return (
      <div style={{ marginTop: 10 }}>
        <label style={rotulo}>
          Fotos deste tópico (legenda “Figura N – …” conforme ABNT)
          {max ? <span className="detalhe"> — até {max}</span> : null}
        </label>
        {cheio ? <span className="detalhe">Limite de {limite} foto(s) atingido.</span> : (
        <input type="file" accept={ACEITA_FOTO} multiple disabled={processandoFotos}
          onChange={(e) => {
            adicionarArquivos(e.target.files, limite - minhas.length, `t-${topico}`, { legenda: legendaPadrao || "", topico });
            e.target.value = "";
          }} />)}
        {MsgFotos(`t-${topico}`)}
        {minhas.map(({ f, i }) => LinhaFoto(f, i))}
      </div>
    );
  }

  /** Escolha de pessoa por USUÁRIO (id) — o nome sai no documento. Quem já
   *  estava escolhido continua na lista mesmo se mudou de área. */
  function SelectPessoa(chave: PapelPessoa, label: string, lista: UsuarioRelatorio[]) {
    const atual = pessoas[chave];
    const opcoes = atual && !lista.some((u) => u.id === atual) ? [...lista, ...usuarios.filter((u) => u.id === atual)] : lista;
    const nomeAntigo = !atual ? (salvo?.d as any)?.[chave] : "";
    return (
      <div key={chave}>
        <label style={rotulo}>{label}</label>
        <select style={campo} value={atual || ""}
          onChange={(e) => setPessoas((p) => ({ ...p, [chave]: e.target.value || undefined }))}>
          <option value="">—</option>
          {opcoes.map((u) => <option key={u.id} value={u.id}>{u.nome}{u.funcao ? ` · ${u.funcao}` : ""}</option>)}
        </select>
        {nomeAntigo && <span className="detalhe">No rascunho: “{nomeAntigo}” — escolha o usuário de novo.</span>}
        <MensagensCampo r={r} campo={chave} />
      </div>
    );
  }

  /** Um tópico: cabeçalho com seleção + campos logo abaixo quando ativo.
   *  `semFotos` tira o upload de fotos livre — usado quando o próprio
   *  `children` já traz um BlocoVagasDoTopico, senão o tópico ganhava dois
   *  uploads de foto ao mesmo tempo. */
  function Topico({ numero, titulo, children, maxFotos, legendaFoto, semFotos }: {
    numero: number; titulo: string; children?: React.ReactNode; maxFotos?: number; legendaFoto?: string;
    semFotos?: boolean;
  }) {
    const on = ativo(numero);
    return (
      <div className="rel-bloco" style={{ opacity: on ? 1 : 0.55 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>
          <input type="checkbox" checked={on}
            onChange={(e) => setVisiveis((v) => ({ ...v, [numero]: e.target.checked }))} />
          <span>{numero === 0 ? titulo : `${numero}. ${titulo}`}</span>
        </label>
        {on && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {children}
            {!semFotos && BlocoFotos({ topico: numero, max: maxFotos, legendaPadrao: legendaFoto })}
          </div>
        )}
      </div>
    );
  }

  return (
    <Modal titulo="📄 Gerar Relatório Técnico" largo onFechar={onFechar}>
      {/* Sugestões de crédito das figuras: a nossa e a do cliente do projeto.
          O campo é livre — dá para creditar um terceiro. */}
      <datalist id="sug-fonte-figura">
        <option value="ASP Serviços Industriais" />
        {d.cliente && <option value={d.cliente} />}
        <option value="Desenho fornecido pelo cliente." />
      </datalist>
      {modalColetas && (
        <Modal titulo="Valores das coletas e do laudo" largo onFechar={() => setModalColetas(false)}>
          <p className="detalhe" style={{ marginTop: 0 }}>
            Entram nas legendas das figuras de coleta e nas tabelas do laudo do modelo.
            {coletaFotos ? " pH e cloro vêm da coleta de fotos da execução — pode corrigir, com aviso." : ""}
          </p>
          <div style={grade}>
            {CAMPOS_PH_CLORO.map((k) => {
              const cloro = k.startsWith("cloro");
              const daColeta = coletaFotos ? valorDoSlot(coletaFotos, SLOT_PH_CLORO[k]) : null;
              const atual = lerValorMedido(d[k]);
              const invalido = !!r.erros[k]?.length;
              return (
                <div key={k}>
                  <label style={rotulo} htmlFor={`campo-${k}`}>
                    {ROTULOS_PH_CLORO[k]} <span className="detalhe">({cloro ? unidadeCloro : "0 a 14"})</span>
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input id={`campo-${k}`} style={{ ...campo, ...(invalido ? { borderColor: "#b3261e" } : {}) }}
                      inputMode="decimal" aria-invalid={invalido} placeholder={cloro ? "ex.: 0,5" : "ex.: 7,2"}
                      value={d[k] || ""} onChange={set(k)}
                      onBlur={(e) => {
                        const n = lerValorMedido(e.target.value);
                        if (n !== null) setD((v) => ({ ...v, [k]: textoNumeroBr(n) }));
                      }} />
                    {cloro && <span className="detalhe" style={{ margin: 0, whiteSpace: "nowrap" }}>{unidadeCloro}</span>}
                  </div>
                  <MensagensCampo r={r} campo={k}>
                    {daColeta != null && (atual === null || Math.abs(atual - daColeta) > 1e-9) && (
                      <div className="val-sugestao">
                        <button type="button" className="btn-dl btn-sec"
                          onClick={() => setD((v) => ({ ...v, [k]: textoNumeroBr(daColeta) }))}>
                          Usar valor da coleta ({textoNumeroBr(daColeta)}{cloro ? ` ${unidadeCloro}` : ""})
                        </button>
                      </div>
                    )}
                  </MensagensCampo>
                </div>
              );
            })}
          </div>
          <p className="detalhe" style={{ margin: "12px 0 0" }}>
            Laudo: número (vírgula decimal) ou <strong>&lt;LQ</strong>, <strong>ND</strong>, <strong>Ausente</strong>,{" "}
            <strong>Presente</strong> — coliformes e E. coli (P/A) só com Ausente/Presente. A coluna Limite vem
            preenchida com a {FONTE_PORTARIA_888} e pode ser corrigida; sai no documento como estiver.
          </p>
          {(["laudoAntes", "laudoDepois"] as const).map((chave) => {
            const g = gradeLaudo(d[chave] as string[][] | undefined);
            const foraAqui = new Set(foraLimite.filter((f) => f.chave === chave).map((f) => f.linha));
            return (
              <div key={chave} style={{ marginTop: 14 }}>
                <strong style={{ fontSize: 13 }}>
                  {chave === "laudoAntes" ? "Laudo — antes da limpeza" : "Laudo — após a limpeza"}
                </strong>
                <div style={{ overflowX: "auto", marginTop: 6 }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={celLaudo}>Parâmetro</th>
                        {LAUDO_COLUNAS.map((c, j) => (
                          <th key={c} style={celLaudo}>
                            {j === COL_LIMITE ? <>Limite <span className="detalhe">(Portaria 888/2021)</span></> : c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {LAUDO_PARAMETROS.map((par, i) => {
                        const fora = foraAqui.has(i);
                        const msgs = mensagensLinha(r, chave, i);
                        // linha fora do limite: fundo + borda + texto (não só cor)
                        const fundo = fora ? { background: "rgba(179, 38, 30, 0.10)" } : {};
                        return (
                          <Fragment key={par}>
                            <tr>
                              <td style={{ ...celLaudo, ...fundo, whiteSpace: "nowrap", ...(fora ? { borderLeft: "4px solid #b3261e" } : {}) }}>
                                {par}
                                {fora && <span className="val-msg val-erro" style={{ display: "block", fontWeight: 700 }}>⚠ Fora do limite</span>}
                              </td>
                              {LAUDO_COLUNAS.map((col, j) => {
                                const errCel = !!r.erros[`${chave}.${i}.${j}`]?.length;
                                return (
                                  <td key={j} style={{ ...celLaudo, ...fundo }}>
                                    <input aria-label={`${par} — ${col}`} aria-invalid={errCel}
                                      style={{ ...campo, padding: "5px 7px", fontSize: 12.5, minWidth: 84, ...(errCel ? { borderColor: "#b3261e", borderWidth: 2 } : {}) }}
                                      value={g[i][j]}
                                      onChange={(e) => mudarCelula(chave, i, j, e.target.value)}
                                      onBlur={(e) => {
                                        const n = normalizarCelulaLaudo(e.target.value);
                                        if (n !== e.target.value) mudarCelula(chave, i, j, n);
                                      }} />
                                  </td>
                                );
                              })}
                            </tr>
                            {(msgs.erros.length > 0 || msgs.avisos.length > 0) && (
                              <tr>
                                <td colSpan={LAUDO_COLUNAS.length + 1} style={{ ...celLaudo, ...fundo, whiteSpace: "normal" }}>
                                  <div className="val-campo" aria-live="polite">
                                    {msgs.erros.map((m) => <p key={"e" + m} className="val-msg val-erro">⛔ {m}</p>)}
                                    {msgs.avisos.map((m) => <p key={"a" + m} className="val-msg val-aviso">⚠️ {m}</p>)}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <MensagensCampo r={r} campo={chave} />
              </div>
            );
          })}

          {foraLimite.length > 0 && (
            <div className="val-resumo" role="status" style={{ marginTop: 12 }}>
              <strong className="val-aviso">⚠️ {foraLimite.length} resultado(s) fora do limite</strong>
              <ul>{foraLimite.map((f) => (
                <li key={`${f.chave}-${f.linha}`}>
                  {f.nome} — {f.chave === "laudoAntes" ? "antes" : "depois"}: {f.valor}{f.unidade ? ` ${f.unidade}` : ""} (limite {f.limite}{f.unidade ? ` ${f.unidade}` : ""})
                </li>
              ))}</ul>
              <button type="button" className="btn-dl btn-sec" onClick={sugerirConclusao}>
                ✍ Sugerir texto na conclusão
              </button>
              <MensagensCampo r={r} campo="conclusao" />
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn-azul" onClick={() => setModalColetas(false)}>Pronto</button>
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="detalhe" style={{ margin: 0 }}>
          📄 {listaProc.length > 0
            ? `tópicos do procedimento ${proc?.codigo} (${listaProc.length}, configurados no Catálogo)`
            : infoModelo}
          {topicosGenericos.length > 0 && ` · ${topicosGenericos.length} seções próprias deste modelo`}
          {!caminhoModelo && proc && " — este procedimento não tem modelo próprio no Catálogo"}
          {!proc && " — escolha o procedimento na capa para usar o modelo dele"}
        </p>
        {modeloIncompleto && (
          <p className="detalhe" style={{ margin: 0, color: "var(--erro, #b42318)" }}>
            <strong>
              ⚠ Só {topicosModelo.length} seções foram reconhecidas no modelo de {proc?.codigo}, mas
              este procedimento usa {qtdConfigurada}.
            </strong>{" "}
            As seções abaixo são as que foram lidas do modelo — nenhuma foi trocada por uma lista
            padrão. Se faltar alguma, confira a numeração dos títulos no .docx: “8.Sanitização” ou
            “11 Imagens” são lidos, mas um título sem número na frente não é.
          </p>
        )}
        <p className="detalhe" style={{ margin: 0 }}>
          Preenche o modelo oficial da ASP mantendo timbre, cabeçalho e rodapé. Formatação conforme
          ABNT (NBR 14724): Arial 12, entrelinha 1,5, texto justificado, margens 3/2/3/2 cm e legendas
          de figura em Arial 10. {qtdOcultos > 0 && <strong>{qtdOcultos} tópico(s) oculto(s) — os demais são renumerados.</strong>}
        </p>

        <div className="rel-bloco">
          <label style={rotulo}>Medição utilizada <span className="detalhe">(define altura, diâmetro, capacidade e volume)</span></label>
          {coletas.length === 0 ? (
            <p className="vazio" style={{ margin: 0 }}>Nenhuma medição salva nesta OS — os campos automáticos ficam vazios.</p>
          ) : (
            <select style={campo} value={coletaId} onChange={(e) => trocarColeta(e.target.value)}>
              {coletas.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {c.aprovada_em ? "✓ " : ""}Medição {coletas.length - i} — {c.data_coleta ? isoParaBr(c.data_coleta) : new Date(c.criado_em).toLocaleString("pt-BR")}
                  {c.dados?.resultado?.volSedM3 != null ? ` · ${Number(c.dados.resultado.volSedM3).toFixed(3).replace(".", ",")} m³` : ""}
                </option>
              ))}
            </select>
          )}
          {coletas.length > 0 && !coletas.some((c) => c.aprovada_em) && (
            <p className="detalhe" style={{ margin: "6px 0 0", color: "var(--pendente)" }}>
              ⚠ Nenhuma medição foi aprovada nesta OS. Você pode gerar assim mesmo, mas convém
              aprovar a medição válida no card de Coletas antes de enviar.
            </p>
          )}
        </div>

        {((inicio?.mudancas.length || 0) + (legado?.avisos.length || 0)) > 0 && (
          <div className="val-resumo" role="status">
            <strong className="val-aviso">⚠️ O que mudou desde o rascunho (dados do cadastro/medição atualizados):</strong>
            <ul>{[...(inicio?.mudancas || []), ...(legado?.avisos || [])].map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
        {restaurando && <p className="detalhe" style={{ margin: 0 }}>Carregando as fotos do rascunho…</p>}
        {fotosPerdidas.length > 0 && (
          <p className="val-msg val-aviso" style={{ margin: 0 }}>
            ⚠️ {fotosPerdidas.length} foto(s) do rascunho não puderam ser recuperadas: {fotosPerdidas.join(", ")}. Anexe de novo se precisar.
          </p>
        )}

        {PainelColeta()}

        {Topico({ numero: 0, titulo: TOPICO_CAPA.titulo, children: <>
          <div style={grade}>
            <div><label style={rotulo}>Título do relatório *</label>
              <input style={campo} value={d.titulo || ""} onChange={set("titulo")} placeholder="ex.: Batimetria — Tanque TQ-01" />
              <MensagensCampo r={r} campo="titulo" /></div>
            <div><label style={rotulo}>Cliente <span className="detalhe">(cadastro)</span></label>
              <input style={campoLeitura} value={d.cliente || ""} readOnly placeholder="sem cliente no projeto" /></div>
            <div><label style={rotulo}>Endereço <span className="detalhe">(cadastro do projeto)</span></label>
              <input style={campoLeitura} value={d.endereco || ""} readOnly placeholder="sem endereço no projeto" /></div>
            <div><label style={rotulo}>Data do relatório *</label>
              <input style={campo} type="date" max={hoje} value={d.dataRelatorio || ""} onChange={set("dataRelatorio")} />
              <MensagensCampo r={r} campo="dataRelatorio" /></div>
          </div>
          <p className="detalhe" style={{ margin: 0 }}>
            Cliente, endereço, TAG e procedimento vêm do cadastro (só leitura aqui). Para mudar, edite o cadastro do
            projeto/OS e reabra este formulário.
          </p>

          <strong style={{ fontSize: 12.5, marginTop: 4 }}>Controle de revisão</strong>
          <div style={grade}>
            <div>
              <label style={rotulo}>Revisão <span className="detalhe">({podeEditarRevisao ? "calculada — você pode corrigir" : "automática"})</span></label>
              <input style={podeEditarRevisao ? { ...campo, fontWeight: 700 } : { ...campoLeitura, fontWeight: 700 }}
                value={d.revisao || ""} readOnly={!podeEditarRevisao} inputMode="numeric"
                onChange={(e) => mudarRevisao(e.target.value)} />
              <span className="detalhe">
                Reprovações (“Ajustar”) deste tipo de relatório nesta OS: Rev{revisaoEsperada}. Compõe o campo Relatório.
                {!podeEditarRevisao && " Só Admin, Gerência ou uma função com “Editar revisão/código” corrigem à mão."}
              </span>
              <MensagensCampo r={r} campo="revisao" />
            </div>
            <div>
              <label style={rotulo}>Status</label>
              <select style={campo} value={d.statusRevisao || ""}
                onChange={(e) => setD((v) => ({ ...v, statusRevisao: e.target.value }))}>
                <option value="">—</option>
                {["A", "B", "C", "D", "E"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <MensagensCampo r={r} campo="statusRevisao" />
            </div>
            <div><label style={rotulo}>Data da revisão</label>
              <input style={campo} type="date" value={d.dataRevisao || ""} onChange={set("dataRevisao")} />
              <MensagensCampo r={r} campo="dataRevisao" /></div>
          </div>
          <div style={grade}>
            {SelectPessoa("preparadoPor", "Preparado por", operacoes)}
            {SelectPessoa("checadoPor", "Checado por", operacoes)}
            {/* Coluna do quadro da capa que existe no modelo do POP 001. Sai
                do documento quando o modelo não tem essa coluna. */}
            {SelectPessoa("revisadoPorCapa", "Revisado por", operacoes)}
            {SelectPessoa("aprovadoPor", "Aprovado por", operacoes)}
          </div>
          <div style={grade}>
            <div><label style={rotulo}>Relatório <span className="detalhe">(automático — código do projeto + revisão)</span></label>
              <input style={podeEditarRevisao ? campo : campoLeitura} value={d.relatorioCodigo || ""} readOnly={!podeEditarRevisao}
                onChange={(e) => {
                  if (!podeEditarRevisao) return;
                  setRevisaoManual(true);
                  setD((v) => ({ ...v, relatorioCodigo: e.target.value }));
                }} />
              <MensagensCampo r={r} campo="relatorioCodigo" /></div>
            <div>
              <label style={rotulo}>Procedimento <span className="detalhe">(cadastro da OS)</span></label>
              <input style={campoLeitura} readOnly placeholder="sem procedimento no cadastro da OS"
                value={d.procedimento ? `${d.procedimento}${proc ? ` — ${proc.nome}` : ""}` : ""} />
              <span className="detalhe">
                {proc ? "Sugere método e equipamentos nos tópicos 3 e 4. Para trocar, edite o cadastro da OS."
                  : d.procedimento ? (catalogoPronto ? "Procedimento não encontrado no Catálogo — o relatório usa o modelo padrão." : "Carregando o Catálogo…")
                  : "Escolha o procedimento no cadastro da OS para usar o modelo dele."}
              </span>
            </div>
          </div>
          {operacoes.length === 0 && (
            <p className="detalhe" style={{ margin: 0 }}>
              Nenhum usuário de Operações cadastrado — as listas de preparado/checado/aprovado ficam vazias.
            </p>
          )}
        </> })}

        {Topico({ numero: 1, titulo: "Identificação do local", children: <>
          <div style={grade}>
            <div><label style={rotulo}>Cliente <span className="detalhe">(cadastro — o mesmo da capa)</span></label>
              <input style={campoLeitura} value={d.cliente || ""} readOnly /></div>
            <div><label style={rotulo}>Unidade</label>
              <input style={campo} value={d.unidade || ""} onChange={set("unidade")} /></div>
            <div><label style={rotulo}>Contato <span className="detalhe">(cadastro do cliente)</span></label>
              <input style={campo} value={d.contato || ""} onChange={set("contato")}
                placeholder="sem contato cadastrado" /></div>
          </div>
          <div style={grade}>
            <div>
              <label style={rotulo}>Execução <span className="detalhe">(automático — agendamento)</span></label>
              <input style={campo} type="date" value={d.dataExecucao || ""} onChange={set("dataExecucao")} />
              <span className="detalhe">Data do serviço, tirada do agendamento do mesmo tipo do relatório (inspeção até a fase 5; execução a partir da 6).</span>
              <MensagensCampo r={r} campo="dataExecucao" />
            </div>
            <div><label style={rotulo}>Relatório <span className="detalhe">(o mesmo da capa)</span></label>
              <input style={campoLeitura} value={d.relatorioCodigo || ""} readOnly /></div>
          </div>
        </> })}

        {Topico({ numero: 2, titulo: "Identificação do tanque", children: <>
          <div style={grade}>
            <div><label style={rotulo}>TAG <span className="detalhe">(identificação da OS)</span></label>
              <input style={campoLeitura} value={d.tag || ""} readOnly /></div>
            <div><label style={rotulo}>Área</label><input style={campo} value={d.area || ""} onChange={set("area")} /></div>
            <div>
              <label style={rotulo}>Material</label>
              <select style={campo} value={d.material || ""}
                onChange={(e) => setD((v) => ({ ...v, material: e.target.value }))}>
                <option value="">—</option>
                {MATERIAIS_TANQUE.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div><label style={rotulo}>Capacidade <span className="detalhe">(medição; sem ela, cadastro)</span></label>
              <input style={campo} value={d.capacidadeTanque || ""} onChange={set("capacidadeTanque")} placeholder="ex.: 1.500,00 m³" />
              <MensagensCampo r={r} campo="capacidadeTanque" /></div>
            <div><label style={rotulo}>Altura do tanque</label><input style={campo} value={d.alturaTanque || ""} onChange={set("alturaTanque")} placeholder="ex.: 8,00 m" />
              <MensagensCampo r={r} campo="alturaTanque" /></div>
            <div><label style={rotulo}>Diâmetro</label><input style={campo} value={d.diametro || ""} onChange={set("diametro")} placeholder="ex.: 10,00 m" />
              <MensagensCampo r={r} campo="diametro" /></div>
          </div>
          <div style={grade}>
            <div><label style={rotulo}>Histórico</label>
              <input style={campo} value={d.historico || ""} onChange={set("historico")}
                placeholder="ex.: última limpeza em 03/2025" /></div>
            <div><label style={rotulo}>Comprimento <span className="detalhe">(medição)</span></label>
              <input style={campo} value={d.comprimento || ""} onChange={set("comprimento")} placeholder="em metros" />
              <MensagensCampo r={r} campo="comprimento" /></div>
            <div><label style={rotulo}>Largura <span className="detalhe">(medição)</span></label>
              <input style={campo} value={d.largura || ""} onChange={set("largura")} placeholder="em metros" />
              <MensagensCampo r={r} campo="largura" /></div>
          </div>

          {/* Horários da operação: alimentam o texto padrão de Observações do
              POP 001, na ordem em que os marcadores aparecem no modelo. */}
          {limpeza && (
          <div className="rel-sub">
            <strong style={{ fontSize: 12.5 }}>Horários da operação <span className="detalhe">(texto padrão do procedimento)</span></strong>
            <div style={{ ...grade, marginTop: 6 }}>
              <div><label style={rotulo}>Data</label>
                <input style={campo} type="date" value={d.dataOperacao || ""} onChange={set("dataOperacao")} />
                <MensagensCampo r={r} campo="dataOperacao" /></div>
              {["Chegada ao site", "Início da limpeza", "Conclusão", "Saída do site"].map((rot, i) => (
                <div key={i}>
                  <label style={rotulo}>{rot}</label>
                  <input style={campo} type="time" value={(d.horarios || [])[i] || ""}
                    onChange={(e) => setD((v) => {
                      const h = [...(v.horarios || ["", "", "", ""])];
                      h[i] = e.target.value;
                      return { ...v, horarios: h };
                    })} />
                </div>
              ))}
            </div>
            <MensagensCampo r={r} campo="horarios" />
            <MensagensCampo r={r} campo="rdos" />
          </div>
          )}

          <div><label style={rotulo}>Observações</label>
            <EditorTexto valor={d.observacoesTanque || ""} onChange={(v) => setD((x) => ({ ...x, observacoesTanque: v }))} altura={70} /></div>
        </> })}

        {Topico({ numero: 3, titulo: "Métodos", children: <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn-dl btn-sec" disabled={!proc} onClick={aplicarSugestao}>
              ✨ Usar sugestão do procedimento
            </button>
            <span className="detalhe" style={{ margin: 0 }}>
              {!proc ? "Escolha o procedimento na capa para habilitar a sugestão."
                : `Baseada em ${proc.codigo} — ${proc.nome}.` +
                  (qtdConfigurada !== null
                    ? ` Este procedimento usa ${qtdConfigurada} de ${TOPICOS_EM_USO.length} tópicos — a seleção será ajustada.`
                    : " Mantém os tópicos como estão.")}
            </span>
          </div>
          <EditorTexto valor={d.metodos || ""} onChange={(v) => setD((x) => ({ ...x, metodos: v }))} altura={130} />
        </> })}

        {Topico({ numero: 4, titulo: "Equipamentos utilizados", children: <>
          <label style={rotulo}>
            Equipamentos {proc ? <span className="detalhe">— sugeridos por {proc.codigo}</span> : null}
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 6 }}>
            {/* Desativados no Catálogo só aparecem se já estão marcados. */}
            {EQUIPAMENTOS.filter((eq: any) => eq.ativo !== false || equipIds.includes(eq.slug)).map((eq: any) => (
              <label key={eq.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={equipIds.includes(eq.slug)} style={{ marginTop: 3 }}
                  onChange={(e) => alternarEquipamento(eq.slug, e.target.checked)} />
                <span>{eq.nome}<span className="detalhe" style={{ display: "block" }}>{(eq.especificacoes || []).length} especificação(ões)</span></span>
              </label>
            ))}
          </div>
          <label style={rotulo}>Texto que irá para o relatório</label>
          <EditorTexto valor={d.equipamentos || ""} onChange={(v) => setD((x) => ({ ...x, equipamentos: v }))} altura={100} />
        </> })}

        {/* Anexos existe só no modelo do POP 001 e numa posição diferente da do
            modelo de batimetria, por isso não entra na lista numerada: o
            gerador o localiza pelo título. Em modelo sem "Anexos", é ignorado. */}
        <div className="rel-bloco">
          <strong style={{ fontSize: 13.5 }}>
            Anexos <span className="detalhe">(usado quando o modelo tem o tópico “Anexos”)</span>
          </strong>
          <EditorTexto valor={d.anexos || ""} onChange={(v) => setD((x) => ({ ...x, anexos: v }))} altura={90} />
        </div>

        {Topico({ numero: 5, titulo: "Equipe de trabalho", children: <>
          <label style={rotulo}>Envolvidos — selecione entre os usuários cadastrados</label>
          {equipeAgendada.length > 0 && (
            <span className="detalhe">A equipe do agendamento já vem marcada — sai no relatório exatamente quem estiver marcado aqui.</span>
          )}
          {usuarios.length === 0 ? (
            <p className="vazio" style={{ margin: 0 }}>Nenhum usuário disponível.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
              {usuarios.map((u) => (
                <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={equipeIds.includes(u.id)}
                    onChange={(e) => setEquipeIds((p) => e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id))} />
                  <span>{u.nome}{u.funcao ? <span className="detalhe"> · {u.funcao}</span> : null}</span>
                </label>
              ))}
            </div>
          )}
          {nomesEquipe && <p className="detalhe" style={{ margin: "6px 0 0" }}>No relatório: {nomesEquipe}</p>}
          <MensagensCampo r={r} campo="equipe" />
        </> })}

        {Topico({ numero: 6, titulo: "Dados reservatório", children: <>
          <div style={grade}>
            <div><label style={rotulo}>Equipamento <span className="detalhe">(tipo/uso do tanque)</span></label>
              <input style={campo} value={d.equipamentoTanque || ""} onChange={set("equipamentoTanque")}
                placeholder="ex.: Tanque de combate a incêndio" /></div>
            <div><label style={rotulo}>Altura <span className="detalhe">(o mesmo do tópico 2)</span></label>
              <input style={campo} value={d.alturaTanque || ""} onChange={set("alturaTanque")} />
              <MensagensCampo r={r} campo="alturaTanque" /></div>
            <div><label style={rotulo}>Diâmetro <span className="detalhe">(o mesmo do tópico 2)</span></label>
              <input style={campo} value={d.diametro || ""} onChange={set("diametro")} />
              <MensagensCampo r={r} campo="diametro" /></div>
            <div><label style={rotulo}>Capacidade <span className="detalhe">(a mesma do tópico 2)</span></label>
              <input style={campo} value={d.capacidadeTanque || ""} onChange={set("capacidadeTanque")} />
              <MensagensCampo r={r} campo="capacidadeTanque" /></div>
          </div>

          <div style={{ borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
            <strong style={{ fontSize: 12.5 }}>6.1 Vista em planta</strong>
            {BlocoFotosAncora({ ancora: "6.1", legendaPadrao: "Vista superior", max: 1 })}
          </div>
          <div style={{ borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
            <strong style={{ fontSize: 12.5 }}>6.2 Vista lateral</strong>
            {BlocoFotosAncora({ ancora: "6.2", legendaPadrao: "Vista lateral", max: 1 })}
          </div>
          <div style={{ borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
            <strong style={{ fontSize: 12.5 }}>6.3 Fotos do tanque <span className="detalhe">(até 5)</span></strong>
            {BlocoFotosAncora({ ancora: "6.3", legendaPadrao: "Foto do tanque", max: 5 })}
          </div>
        </> })}

        {Topico({ numero: 7, titulo: "Batimetria", children: <>
          <div style={grade}>
            <div><label style={rotulo}>Volume de sedimento <span className="detalhe">(automático — medição)</span></label>
              <input style={campo} value={d.volumeSedimento || ""} onChange={(e) => mudarVolume(e.target.value)} placeholder="ex.: 12,480 m³" />
              <MensagensCampo r={r} campo="volumeSedimento" /></div>
            <div><label style={rotulo}>Mínimo (−5%) <span className="detalhe">(calculado)</span></label>
              <input style={campoLeitura} value={d.volumeMin || ""} readOnly /></div>
            <div><label style={rotulo}>Máximo (+5%) <span className="detalhe">(calculado)</span></label>
              <input style={campoLeitura} value={d.volumeMax || ""} readOnly /></div>
          </div>
          <p className="detalhe" style={{ margin: 0 }}>
            O texto do modelo já traz os dois parágrafos; o volume e a faixa de ±5% são substituídos
            automaticamente. As imagens abaixo entram no lugar do marcador de gráficos da batimetria.
          </p>
        </> })}

        {Topico({ numero: 8, titulo: "Foto da Inspeção Visual Interna", maxFotos: 5, legendaFoto: "Inspeção visual interna", children: <>
          <EditorTexto valor={d.fotosInternas || ""} onChange={(v) => setD((x) => ({ ...x, fotosInternas: v }))} altura={80} />

          <div style={{ marginTop: 12, borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 12.5 }}>Subtópicos <span className="detalhe">(8.1, 8.2 … numeração automática)</span></strong>
              <button type="button" className="btn-dl btn-sec"
                onClick={() => setSubs8((p) => [...p, { titulo: "" }])}>+ Subtópico</button>
            </div>
            {subs8.length === 0 && (
              <p className="detalhe" style={{ margin: "6px 0 0" }}>
                Nenhum subtópico. Use para separar as fotos por região do tanque (Teto, Costado, Fundo…).
              </p>
            )}
            {subs8.map((st, i) => (
              <div key={i} className="rel-sub" style={{ marginTop: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>8.{i + 1}</strong>
                  <input style={{ ...campo, flex: 1, minWidth: 160 }} placeholder="Título do subtópico * (ex.: Teto)"
                    value={st.titulo}
                    onChange={(e) => setSubs8((p) => p.map((x, k) => k === i ? { titulo: e.target.value } : x))} />
                  <button type="button" className="btn-dl btn-sec btn-perigo"
                    onClick={() => {
                      // remove o subtópico e as fotos dele; reindexa os seguintes
                      setFotos((p) => p.filter((f) => f.ancora !== `sub8-${i}`)
                        .map((f) => {
                          const m = /^sub8-(\d+)$/.exec(f.ancora || "");
                          return m && Number(m[1]) > i ? { ...f, ancora: `sub8-${Number(m[1]) - 1}` } : f;
                        }));
                      setSubs8((p) => p.filter((_, k) => k !== i));
                    }}>Remover</button>
                </div>
                <MensagensCampo r={r} campo={`subs8.${i}`} />
                {BlocoFotosAncora({ ancora: `sub8-${i}`, legendaPadrao: st.titulo || "Inspeção visual interna", max: 10, topico: 8 })}
              </div>
            ))}
          </div>
        </> })}

        {/* Seções extras do procedimento: entram aqui, antes da Conclusão,
            exatamente como sairão no documento. O título vem do Catálogo. */}
        {extras.length > 0 && (
          <div className="rel-bloco">
            <strong style={{ fontSize: 13.5 }}>
              Tópicos de {proc?.codigo} <span className="detalhe">(definidos no Catálogo)</span>
            </strong>
            {extras.map((t, i) => (
              <div key={i} style={{ marginTop: 10, borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
                <strong style={{ fontSize: 12.5 }}>{t.titulo || `Seção ${i + 1}`}</strong>
                <EditorTexto valor={textosExtras[i] || ""} altura={100}
                  onChange={(v) => setTextosExtras((p) => ({ ...p, [i]: v }))} />
                {BlocoFotosAncora({ ancora: `extra-${i}`, legendaPadrao: t.titulo || "", max: 10, topico: TOPICO_EXTRAS })}
              </div>
            ))}
          </div>
        )}

        {/* Blocos do POP 001. As legendas e as posições das figuras já estão
            no modelo — aqui só entram os valores medidos e as fotos, na ordem
            das vagas. Em modelo sem essas vagas, nada disso é usado. */}
        {limpeza && (
        <div className="rel-bloco">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13.5 }}>
              Análise Físico Química e Laboratorial <span className="detalhe">— {d.procedimento}</span>
            </strong>
            <button type="button" className="btn-dl btn-sec" onClick={() => setModalColetas(true)}>
              Valores das coletas e do laudo
            </button>
          </div>
          {!caminhoModelo ? (
            <p className="detalhe" style={{ margin: "4px 0 8px", color: "var(--erro, #b42318)" }}>
              <strong>⚠ Este procedimento não tem o modelo da limpeza robotizada anexado no Catálogo.</strong>{" "}
              Sem ele o relatório sai no modelo padrão da ASP, que não tem vaga para essas fotos nem
              marcador para cloro, pH ou o laudo — o que você preencher aqui não aparece no documento
              gerado. Anexe o .docx do procedimento em Catálogo → {d.procedimento} → Modelo próprio.
            </p>
          ) : (
            <p className="detalhe" style={{ margin: "4px 0 8px" }}>
              As fotos entram nas vagas do modelo, na ordem em que você anexar. A legenda de cada
              figura vem do próprio modelo; vaga sem foto é removida do documento.
            </p>
          )}
          <div style={grade}>
            <div><label style={rotulo}>Altura de sedimento <span className="detalhe">(medição)</span></label>
              <input style={campo} value={d.alturaSedimento || ""} onChange={set("alturaSedimento")} /></div>
            <div><label style={rotulo}>Volume de sedimento <span className="detalhe">(medição)</span></label>
              <input style={campo} value={d.volumeSedimento || ""} onChange={(e) => mudarVolume(e.target.value)} />
              <MensagensCampo r={r} campo="volumeSedimento" /></div>
          </div>
          {([
            [8, "Análise Físico Química e Laboratorial — 4 fotos", 4],
            [9, "Análise Físico Química e Laboratorial — imagens", 12],
            [10, "Análise Físico Química e Laboratorial — imagens", 12],
            [11, "Análise Físico Química e Laboratorial — imagens", 8],
            [12, "Análise Físico Química e Laboratorial — prints do laudo (antes e depois)", 2],
          ] as const).map(([num, rot, max]) => (
            <div key={num} style={{ marginTop: 10, borderTop: "1px solid var(--borda)", paddingTop: 8 }}>
              <strong style={{ fontSize: 12.5 }}>{rot}</strong>
              {BlocoVagas(num, max)}
            </div>
          ))}
          {/* Fase 8: o PDF do laudo do laboratório é arquivo próprio (não
              entra no .docx) e é exigido para enviar para aprovação. */}
          {execucao && (
            <div style={{ marginTop: 10, borderTop: "1px solid var(--borda)", paddingTop: 8 }}>
              <label style={rotulo} htmlFor="laudo-pdf">
                PDF do laudo do laboratório{exigeLaudoPdf ? " *" : ""}{" "}
                <span className="detalhe">— obrigatório para enviar para aprovação; o rascunho pode ser salvo sem ele</span>
              </label>
              {laudoPdf ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="detalhe" style={{ margin: 0, overflowWrap: "anywhere", flex: "1 1 200px" }}>
                    📎 {laudoPdf.nome}{laudoPdf.tamanho ? ` (${(laudoPdf.tamanho / 1048576).toFixed(1).replace(".", ",")} MB)` : ""}
                  </span>
                  <label className="btn-dl btn-sec" style={{ cursor: enviandoLaudo ? "wait" : "pointer" }}>
                    Trocar
                    <input type="file" accept="application/pdf,.pdf" hidden disabled={enviandoLaudo}
                      onChange={(e) => { escolherLaudo(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                  <button type="button" className="btn-dl btn-sec btn-perigo"
                    disabled={enviandoLaudo} onClick={() => { setLaudoPdf(null); setMsgLaudo(null); }}>Remover</button>
                </div>
              ) : (
                <input id="laudo-pdf" type="file" accept="application/pdf,.pdf" disabled={enviandoLaudo}
                  onChange={(e) => { escolherLaudo(e.target.files?.[0]); e.target.value = ""; }} />
              )}
              {enviandoLaudo && <span className="detalhe" style={{ display: "block" }}>Conferindo e enviando o laudo…</span>}
              {msgLaudo && <p className="val-msg val-erro" style={{ margin: "4px 0 0" }} aria-live="polite">⛔ {msgLaudo}</p>}
              <MensagensCampo r={r} campo="laudoPdf" />
            </div>
          )}
        </div>
        )}

        {Topico({ numero: 9, titulo: "Conclusão", maxFotos: 5, legendaFoto: "Conclusão", children: <>
          <EditorTexto valor={d.conclusao || ""} onChange={(v) => setD((x) => ({ ...x, conclusao: v }))} altura={110} />
          <MensagensCampo r={r} campo="conclusao">
            {foraLimite.length > 0 && (
              <div className="val-sugestao">
                <button type="button" className="btn-dl btn-sec" onClick={sugerirConclusao}>✍ Sugerir texto na conclusão</button>
                <span>{foraLimite.length} resultado(s) do laudo fora do limite</span>
              </div>
            )}
          </MensagensCampo>
        </> })}

        {Topico({ numero: 10, titulo: "Recomendações", maxFotos: 5, legendaFoto: "Recomendação", children: <>
          <EditorTexto valor={d.recomendacoes || ""} onChange={(v) => setD((x) => ({ ...x, recomendacoes: v }))} altura={110} />
        </> })}

        {/* Seções do modelo do procedimento que não têm campos próprios no
            formulário (Anexos, Sanitização, Coletas, Análise…). Recebem texto
            genérico sempre e, quando o modelo tem vaga de imagem para o
            tópico, fotos em posição fixa com a legenda do modelo — senão,
            upload de fotos livre. */}
        {topicosGenericos.map((t) => {
          const temVagas = vagasModelo.some((v) => v.topico === t.numero);
          return Topico({
            numero: t.numero, titulo: t.titulo, maxFotos: 20, legendaFoto: t.titulo,
            semFotos: temVagas,
            children: (
              <>
                <EditorTexto valor={textosTopico[t.numero] || ""} altura={110}
                  onChange={(v) => setTextosTopico((p) => ({ ...p, [t.numero]: v }))} />
                {temVagas && BlocoVagasDoTopico(t.numero)}
              </>
            ),
          });
        })}

        <div className="rel-bloco">
          <strong style={{ fontSize: 13.5 }}>Assinaturas</strong>
          <div style={{ ...grade, marginTop: 8 }}>
            {SelectPessoa("elaboradoPor", "Relatório elaborado por (Operações)", operacoes)}
            {SelectPessoa("revisadoPor", "Relatório revisado por (Gerência)", gerencia)}
          </div>
          {gerencia.length === 0 && (
            <p className="detalhe" style={{ margin: "6px 0 0" }}>Nenhum usuário de Gerência cadastrado.</p>
          )}
        </div>

        <ResumoValidacao r={r} rotulos={rotulosResumo} mostrarErros={tentou || temErros(r)} />
        {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
        {pendColeta.length > 0 && (
          <p className="detalhe" style={{ margin: 0, color: "var(--pendente)", textAlign: "right" }}>
            ⚠ Coleta de fotos da execução incompleta — {pendColeta.length} pendência(s), listadas no início do formulário.
          </p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn-azul btn-sec" onClick={onFechar} disabled={gerando || enviando}>Cancelar</button>
          <button className="btn-azul btn-sec" onClick={baixar} disabled={gerando || enviando || restaurando || processandoFotos || enviandoLaudo}>
            {gerando ? "Gerando…" : "⬇ Só baixar (.docx)"}
          </button>
          <button className="btn-azul" onClick={salvarEEnviar} disabled={gerando || enviando || restaurando || processandoFotos || enviandoLaudo}>
            {enviando ? "Salvando…" : "💾 Salvar rascunho no card"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
