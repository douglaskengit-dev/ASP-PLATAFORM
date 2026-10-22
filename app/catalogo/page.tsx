"use client";

/** ASP — Catálogo: procedimentos e equipamentos usados no Relatório Técnico.
 *
 * A aba mostra apenas as listas; criar e editar acontece em modal, para a
 * tela não virar um formulário gigante. O procedimento sugere equipamentos e
 * o texto de métodos; cada equipamento tem ficha de especificações (pares
 * rótulo/valor, como saem no relatório) e fotos.
 *
 * Regras de dados em lib/validacao/catalogo.ts (a API repete todas):
 *  ⛔ código e nome únicos (sem caixa/acento/espaço/pontuação no código),
 *     tópicos com título e sem repetir, especificação com rótulo, foto
 *     repetida, modelo .docx de verdade;
 *  ⚠️ nome parecido, limite de cloro alto, equipamento que não existe mais.
 * Renomear código/nome em uso confirma com as contagens e leva a troca às
 * OSs/checklists/rascunhos. Item em uso não é excluído: é DESATIVADO (some
 * das novas escolhas; o que já existe continua funcionando). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/app/components/Modal";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import { lerTopicosDoModelo, topicosDoProcedimento, ehLimpezaRobotizada, capaVisivel } from "@/lib/asp/relatorio";
import { prepararImagemRelatorio } from "@/lib/asp/imagem-relatorio";
import {
  ativoNoCatalogo, equipamentosInexistentes, MODELO_MAX_BYTES, moverNaLista, numeracaoNoDocumento, ROTULOS_CATALOGO,
  temErros, validarEquipamento, validarProcedimento,
} from "@/lib/validacao";

import {
  CLORO_LIMITE_AVISO_PADRAO, UNIDADES_CLORO, UNIDADE_CLORO_PADRAO, cloroDoProcedimento, lerNumero, numeroBr,
  unidadeCloroValida, type UnidadeCloro,
} from "@/lib/asp/fotos-execucao";

interface Espec { rotulo: string; valor: string }
interface Foto { caminho: string; legenda?: string; hash?: string }
interface Equipamento {
  id: string; slug: string; nome: string;
  especificacoes: Espec[]; fotos: Foto[]; ordem: number;
  ativo: boolean; atualizado_em?: string;
}
interface Procedimento {
  id: string; codigo: string; nome: string; metodos: string | null;
  equipamentos: string[]; ordem: number;
  ativo: boolean; atualizado_em?: string;
  /** Tópicos do relatório para este procedimento. null = todos. */
  topicos: number[] | null;
  /** Modelo .docx próprio (storage). Vazio = modelo padrão da ASP. */
  template_path: string | null;
  /** Usa o modelo de relatório da limpeza robotizada (Sanitização, Coletas,
   *  Análise Físico Química e Laboratorial…) em vez do padrão de batimetria. */
  limpeza_robotizada: boolean;
  /** Serviço em reservatório de água potável: a coleta de fotos da execução
   *  já nasce pedindo as coletas de água antes e depois da limpeza. */
  agua_potavel: boolean;
  /** Unidade do cloro livre (card da coleta, frase do RDO, relatório). */
  cloro_unidade: UnidadeCloro;
  /** Cloro acima disso gera aviso na coleta de fotos (texto do campo). */
  cloro_limite_aviso: string;
  /** Tópicos próprios deste procedimento: título + posição (`apos`). */
  topicos_extras: { titulo: string; apos?: number }[];
  /** Tópicos do relatório deste procedimento — a lista real, editável.
   *  `titulo_origem` é o título como está no .docx: o gerador casa por ele,
   *  então renomear o rótulo na tela não quebra o vínculo com o modelo. */
  topicos_lista: { numero: number; titulo: string; titulo_origem?: string; ativo: boolean }[];
  /** Só na tela: a lista acima não veio do banco, foi remontada a partir da
   *  configuração antiga em `topicos`. Vira lista de verdade ao salvar. */
  lista_recuperada?: boolean;
}

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rot: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 };
const grade: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
};
const linha: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
  padding: "10px 0", borderBottom: "1px solid var(--borda)", flexWrap: "wrap",
};
const vermelho: React.CSSProperties = { color: "#dc2626", borderColor: "#dc2626" };

type Tipo = "equipamento" | "procedimento";

export default function CatalogoPage() {
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [procedimentos, setProcedimentos] = useState<Procedimento[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /** Erro dentro do modal aberto (o da página fica escondido atrás dele). */
  const [erroModal, setErroModal] = useState<string | null>(null);
  /** 409 de versão: outra pessoa salvou — oferece recarregar. */
  const [conflitoVersao, setConflitoVersao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [msgFoto, setMsgFoto] = useState<string | null>(null);
  const [enviandoModelo, setEnviandoModelo] = useState(false);
  const [tentou, setTentou] = useState(false);
  // Item aberto no modal (cópia local — só grava ao salvar).
  const [edEquip, setEdEquip] = useState<Equipamento | null>(null);
  const [edProc, setEdProc] = useState<Procedimento | null>(null);
  /** Arquivos enviados ao storage NESTE modal (fotos/modelos). Cancelar
   *  descarta os que não foram salvos; salvar descarta os que saíram. */
  const enviadosSessao = useRef<string[]>([]);

  const carregar = useCallback(() => {
    fetch("/api/catalogo").then((r) => r.ok ? r.json() : {})
      .then((d: any) => {
        setEquipamentos((d.equipamentos || []).map((e: any) => ({
          ...e, especificacoes: e.especificacoes || [], fotos: e.fotos || [], ativo: ativoNoCatalogo(e),
        })));
        setProcedimentos((d.procedimentos || []).map((p: any) => {
          const salva = Array.isArray(p.topicos_lista) ? p.topicos_lista : [];
          // Procedimento configurado ANTES da lista editável existir guardou a
          // escolha em `topicos`, e `topicos_lista` nasceu vazia. Mostrar a tela
          // vazia nesse caso dá a impressão de que a configuração se perdeu —
          // ela está no banco. `topicosDoProcedimento` remonta para exibir, e é
          // a MESMA função que o formulário do relatório usa: as duas telas
          // enxergam a mesma lista. Salvar a torna oficial.
          const lista = topicosDoProcedimento(p);
          return {
            ...p, equipamentos: p.equipamentos || [],
            ativo: ativoNoCatalogo(p),
            topicos: Array.isArray(p.topicos) ? p.topicos : null,
            template_path: p.template_path || null,
            limpeza_robotizada: !!p.limpeza_robotizada,
            agua_potavel: !!p.agua_potavel,
            cloro_unidade: cloroDoProcedimento(p).unidade,
            cloro_limite_aviso: numeroBr(cloroDoProcedimento(p).limite),
            topicos_extras: Array.isArray(p.topicos_extras) ? p.topicos_extras : [],
            topicos_lista: lista,
            lista_recuperada: salva.length === 0 && lista.length > 0,
          };
        }));
        setPodeEditar(!!d.podeEditar);
      })
      .finally(() => setCarregando(false));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const procAtivos = useMemo(() => procedimentos.filter((p) => p.ativo), [procedimentos]);
  const procInativos = useMemo(() => procedimentos.filter((p) => !p.ativo), [procedimentos]);
  const equipAtivos = useMemo(() => equipamentos.filter((e) => e.ativo), [equipamentos]);
  const equipInativos = useMemo(() => equipamentos.filter((e) => !e.ativo), [equipamentos]);

  // ── Validação (mesmas regras da API) ──
  const limiteNum = edProc ? lerNumero(String(edProc.cloro_limite_aviso ?? "")) : null;
  const rProc = useMemo(() => edProc
    ? validarProcedimento(
        { ...edProc, cloro_limite_aviso: limiteNum ?? NaN },
        { id: edProc.id || null, procedimentos, equipamentos },
      )
    : null, [edProc, limiteNum, procedimentos, equipamentos]);
  const rEquip = useMemo(() => edEquip
    ? validarEquipamento(edEquip, { id: edEquip.id || null, equipamentos })
    : null, [edEquip, equipamentos]);
  const numeros = useMemo(
    () => numeracaoNoDocumento(edProc?.topicos_lista || [], edProc?.topicos_extras || []),
    [edProc?.topicos_lista, edProc?.topicos_extras],
  );
  const inexistentes = edProc ? equipamentosInexistentes(edProc.equipamentos, equipamentos) : [];

  async function api(metodo: string, corpo?: any, query = ""): Promise<{ ok: boolean; status: number; d: any }> {
    const res = await fetch(`/api/catalogo${query}`, {
      method: metodo,
      ...(corpo ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : {}),
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, d };
  }

  async function usoDe(tipo: Tipo, id: string): Promise<any | null> {
    const res = await fetch(`/api/catalogo/uso?tipo=${tipo}&id=${id}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErro(d?.erro || "Não foi possível conferir onde o item é usado."); setErroModal(d?.erro || null); return null; }
    return d;
  }

  /** Descarta do storage arquivos enviados neste modal que não ficaram em
   *  nada salvo (a API recusa apagar o que algum item usa). */
  function descartarEnviados(manter: string[] = []) {
    const lixo = enviadosSessao.current.filter((c) => !manter.includes(c));
    enviadosSessao.current = [];
    lixo.forEach((c) => {
      const rota = c.startsWith("catalogo/modelos/") ? "template" : "foto";
      fetch(`/api/catalogo/${rota}?caminho=${encodeURIComponent(c)}`, { method: "DELETE" }).catch(() => {});
    });
  }

  function abrir(tipo: Tipo, item: any) {
    enviadosSessao.current = [];
    setErroModal(null); setConflitoVersao(false); setTentou(false); setMsgFoto(null); setErro(null);
    if (tipo === "equipamento") setEdEquip(item); else setEdProc(item);
  }
  function fechar() {
    descartarEnviados();
    setEdEquip(null); setEdProc(null); setErroModal(null); setConflitoVersao(false);
  }
  function recarregarDescartando() {
    fechar();
    carregar();
  }

  async function salvar(tipo: Tipo, item: any) {
    setTentou(true);
    setErroModal(null); setConflitoVersao(false);
    const r = tipo === "procedimento" ? rProc : rEquip;
    if (r && temErros(r)) return;
    const dados = tipo === "equipamento"
      ? { nome: item.nome, especificacoes: item.especificacoes, fotos: item.fotos }
      : { codigo: item.codigo, nome: item.nome, metodos: item.metodos,
          equipamentos: item.equipamentos, topicos: item.topicos,
          template_path: item.template_path || null, limpeza_robotizada: !!item.limpeza_robotizada,
          agua_potavel: !!item.agua_potavel,
          cloro_unidade: unidadeCloroValida(item.cloro_unidade) ? item.cloro_unidade : UNIDADE_CLORO_PADRAO,
          cloro_limite_aviso: lerNumero(String(item.cloro_limite_aviso)) ?? CLORO_LIMITE_AVISO_PADRAO,
          topicos_extras: item.topicos_extras || [], topicos_lista: item.topicos_lista || [] };

    let confirmarRenomeacao = false;
    if (item.id) {
      // Renomear código/nome em uso: mostra o que vai mudar antes de salvar.
      const original = (tipo === "procedimento" ? procedimentos : equipamentos).find((x: any) => x.id === item.id) as any;
      const chave = tipo === "procedimento" ? "codigo" : "nome";
      const novo = String(item[chave] || "").replace(/\s+/g, " ").trim();
      if (original && original[chave] !== novo) {
        const u = await usoDe(tipo, item.id);
        if (!u) return;
        if (u.renomeacao) {
          const o = tipo === "procedimento" ? "o código" : "o nome";
          if (!confirm(`Renomear ${o} “${original[chave]}” para “${novo}”?\n\n${u.renomeacao}`)) return;
          confirmarRenomeacao = true;
        }
      }
    }

    setSalvando(true);
    try {
      let resp = item.id
        ? await api("PATCH", { tipo, id: item.id, versao: item.atualizado_em, dados, confirmarRenomeacao })
        : await api("POST", { tipo, dados });
      // Alguém passou a usar o item entre a conferência e o salvar.
      if (!resp.ok && resp.d?.precisaConfirmar) {
        if (!confirm(`Renomear?\n\n${resp.d.texto}`)) return;
        resp = await api("PATCH", { tipo, id: item.id, versao: item.atualizado_em, dados, confirmarRenomeacao: true });
      }
      if (!resp.ok) {
        setErroModal(resp.d?.erro || "Falha ao salvar.");
        setConflitoVersao(!!resp.d?.conflitoVersao);
        return;
      }
      // Gravado: os arquivos enviados que não ficaram no item vão embora.
      const ficam: string[] = tipo === "equipamento"
        ? (resp.d.item?.fotos || []).map((f: any) => f.caminho)
        : [resp.d.item?.template_path].filter(Boolean);
      descartarEnviados(ficam);
      setEdEquip(null); setEdProc(null);
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  /** Excluir de vez só o que nada usa; em uso, oferece Desativar. */
  async function excluir(tipo: Tipo, item: Procedimento | Equipamento) {
    setErro(null);
    const nome = tipo === "procedimento" ? `${(item as Procedimento).codigo} — ${item.nome}` : item.nome;
    const u = await usoDe(tipo, item.id);
    if (!u) return;
    if (u.decisao === "desativar") {
      if (!item.ativo) {
        alert(`“${nome}” está em uso (${u.texto}) e não pode ser excluído — fica desativado.`);
        return;
      }
      if (confirm(`“${nome}” está em uso (${u.texto}) e não pode ser excluído.\n\nDesativar? Ele some das novas escolhas (OS, checklist, agendamento), mas o que já existe continua funcionando. Dá para reativar depois.`)) {
        await desativar(tipo, item, false);
      }
      return;
    }
    const arquivos = tipo === "equipamento" ? " As fotos dele também são apagadas." : (item as Procedimento).template_path ? " O modelo .docx dele também é apagado." : "";
    if (!confirm(`Excluir “${nome}” definitivamente? Ele não é usado em nenhuma OS, checklist ou relatório.${arquivos}`)) return;
    const r = await api("DELETE", undefined, `?tipo=${tipo}&id=${item.id}`);
    if (!r.ok) setErro(r.d?.erro || "Falha ao excluir.");
    carregar();
  }

  async function desativar(tipo: Tipo, item: { id: string }, reativar: boolean) {
    const r = await api("PATCH", { tipo, id: item.id, acao: reativar ? "reativar" : "desativar" });
    if (!r.ok) setErro(r.d?.erro || "Falha na operação.");
    carregar();
  }

  /** Sobe/desce na lista; o servidor renumera 1..N. */
  async function mover(tipo: Tipo, i: number, delta: -1 | 1) {
    let ids: string[];
    if (tipo === "procedimento") {
      const nova = moverNaLista(procAtivos, i, delta);
      if (nova === procAtivos) return;
      setProcedimentos([...nova, ...procInativos]);
      ids = [...nova, ...procInativos].map((x) => x.id);
    } else {
      const nova = moverNaLista(equipAtivos, i, delta);
      if (nova === equipAtivos) return;
      setEquipamentos([...nova, ...equipInativos]);
      ids = [...nova, ...equipInativos].map((x) => x.id);
    }
    const r = await api("PATCH", { tipo, acao: "ordenar", ids });
    if (!r.ok) setErro(r.d?.erro || "Falha ao reordenar.");
    carregar();
  }

  async function enviarFoto(arquivo: File) {
    if (!edEquip) return;
    setEnviandoFoto(true);
    setMsgFoto(null);
    try {
      // Converte WebP/GIF/HEIC para PNG/JPEG e calcula o SHA-256.
      const prep = await prepararImagemRelatorio(arquivo, arquivo.name);
      if ("erro" in prep) { setMsgFoto(prep.erro); return; }
      const repetida = (edEquip.fotos || []).findIndex((f) => f.hash && f.hash === prep.hash);
      if (repetida >= 0) { setMsgFoto(`“${arquivo.name}” é a mesma imagem da foto ${repetida + 1} — não foi adicionada.`); return; }
      const fd = new FormData();
      fd.append("arquivo", prep.arquivo);
      const res = await fetch("/api/catalogo/foto", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsgFoto(d?.erro || "Falha ao enviar a foto."); return; }
      enviadosSessao.current.push(d.caminho);
      setEdEquip((e) => e && ({ ...e, fotos: [...(e.fotos || []), { caminho: d.caminho, legenda: "", hash: d.hash }] }));
      if (prep.convertida) setMsgFoto(`“${arquivo.name}” convertida (${prep.convertida}).`);
    } finally {
      setEnviandoFoto(false);
    }
  }

  /** Envia o modelo .docx deste procedimento (vira o modelo ao salvar). */
  async function enviarModelo(arquivo: File) {
    if (!edProc) return;
    setErroModal(null);
    if (!/\.docx$/i.test(arquivo.name)) { setErroModal("O modelo precisa ser um arquivo .docx (Word)."); return; }
    if (arquivo.size > MODELO_MAX_BYTES) { setErroModal("O modelo passa de 20 MB — reduza as imagens do .docx e envie de novo."); return; }
    setEnviandoModelo(true);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      const res = await fetch("/api/catalogo/template", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErroModal(d?.erro || "Falha ao enviar o modelo."); return; }
      enviadosSessao.current.push(d.caminho);
      setEdProc((p) => p && ({ ...p, template_path: d.caminho }));
    } finally {
      setEnviandoModelo(false);
    }
  }

  /** Traz as seções do modelo para dentro do procedimento. A partir daí a
   *  lista é do sistema: editar aqui não exige mexer no Word. */
  async function importarDoModelo() {
    if (!edProc) return;
    const url = edProc.template_path
      ? `/api/catalogo/template?caminho=${encodeURIComponent(edProc.template_path)}`
      : undefined;
    try {
      const t = await lerTopicosDoModelo(url);
      if (t.length === 0) { setErroModal("Nenhuma seção reconhecida no modelo."); return; }
      setEdProc({
        ...edProc,
        topicos_lista: t.map((x) => ({
          numero: x.numero, titulo: x.titulo, titulo_origem: x.titulo, ativo: true,
        })),
        lista_recuperada: false,
      });
    } catch (e) {
      setErroModal(`Falha ao ler o modelo: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  /** Aplica uma alteração na lista de tópicos do procedimento aberto. */
  function mexerLista(fn: (l: Procedimento["topicos_lista"]) => Procedimento["topicos_lista"]) {
    if (!edProc) return;
    setEdProc({ ...edProc, topicos_lista: fn(edProc.topicos_lista || []) });
  }

  /** Procedimentos que já têm lista e servem de ponto de partida para este.
   *  A lista é de cada procedimento; reaproveitar é opcional, e daqui em
   *  diante a cópia vive por conta própria — mexer num não mexe no outro.
   *
   *  Só oferece fontes do MESMO modelo de relatório (limpeza robotizada ou
   *  padrão). Números de tópico só fazem sentido dentro do modelo em que
   *  foram configurados — copiar entre modelos diferentes traria a lista
   *  certa para o modelo errado. Também evita contornar a proteção de
   *  topicosDoProcedimento contra remontar a lista da limpeza com títulos do
   *  modelo de batimetria: ela só age enquanto topicos_lista está vazia, e
   *  uma cópia grava uma lista não vazia direto. */
  const fontesParaCopiar = procedimentos.filter(
    (p) =>
      p.id !== edProc?.id &&
      (p.topicos_lista || []).length > 0 &&
      ehLimpezaRobotizada(p) === ehLimpezaRobotizada(edProc)
  );

  /** Traz a lista de outro procedimento para o que está aberto. */
  function copiarDeProcedimento(id: string) {
    if (!edProc || !id) return;
    const fonte = procedimentos.find((p) => p.id === id);
    if (!fonte) return;
    if (
      (edProc.topicos_lista || []).length > 0 &&
      !confirm(`Substituir os ${edProc.topicos_lista.length} tópicos atuais pelos ${fonte.topicos_lista.length} de ${fonte.codigo}?`)
    ) return;
    // A capa (tópico 0) não mora em topicos_lista — capaVisivel lê o array
    // antigo `topicos` (ver lib/asp/relatorio.ts). Copiar só topicos_lista
    // deixaria a capa presa à configuração antiga DESTE procedimento, fora
    // de sintonia com a lista que acabou de vir de outro. Só mexe em
    // `topicos` quando a visibilidade da capa realmente muda — não força um
    // array onde antes era null (que já significa "capa visível").
    const capaFonte = capaVisivel(fonte);
    const topicos = capaVisivel(edProc) === capaFonte
      ? edProc.topicos
      : capaFonte
        ? [0, ...(edProc.topicos || []).filter((n) => n !== 0)]
        : (edProc.topicos || []).filter((n) => n !== 0);
    // Cópia profunda: sem isso os dois procedimentos passariam a apontar para
    // os MESMOS objetos, e editar o título de um mudaria o do outro na tela.
    setEdProc({
      ...edProc,
      topicos,
      topicos_lista: fonte.topicos_lista.map((t) => ({ ...t })),
      lista_recuperada: false,
    });
  }

  const novoEquip = (): Equipamento => ({
    id: "", slug: "", nome: "", especificacoes: [], fotos: [], ordem: 0, ativo: true,
  });
  const novoProc = (): Procedimento => ({
    id: "", codigo: "", nome: "", metodos: "", equipamentos: [], ordem: 0, ativo: true,
    topicos: null, template_path: null, limpeza_robotizada: false, agua_potavel: false,
    cloro_unidade: UNIDADE_CLORO_PADRAO, cloro_limite_aviso: numeroBr(CLORO_LIMITE_AVISO_PADRAO),
    topicos_extras: [], topicos_lista: [],
  });

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;

  const setas = (tipo: Tipo, i: number, total: number) => podeEditar && (
    <span style={{ display: "flex", gap: 4 }}>
      <button type="button" className="fu-icone-btn" title="Subir" aria-label="Subir" disabled={i === 0}
        onClick={() => mover(tipo, i, -1)}>↑</button>
      <button type="button" className="fu-icone-btn" title="Descer" aria-label="Descer" disabled={i === total - 1}
        onClick={() => mover(tipo, i, 1)}>↓</button>
    </span>
  );

  const erroNoModal = erroModal && (
    <div className="erro-texto" role="alert" style={{ margin: 0 }}>
      {erroModal}
      {conflitoVersao && (
        <button type="button" className="val-acao" style={{ marginLeft: 8 }} onClick={recarregarDescartando}>
          Recarregar (descarta suas alterações)
        </button>
      )}
    </div>
  );

  return (
    <div className="page-larga">
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Catálogo</h1>
        <p className="detalhe" style={{ margin: "4px 0 0" }}>
          Procedimentos e equipamentos usados no Relatório Técnico. O procedimento sugere os
          equipamentos e o texto de métodos; as especificações saem no relatório em duas colunas.
        </p>
      </header>
      {erro && <p className="erro-texto">{erro}</p>}
      {!podeEditar && <p className="detalhe">Somente consulta — edição restrita a Operações, Gerência e Admin.</p>}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Procedimentos ({procAtivos.length})</h3>
          {podeEditar && <button className="btn-azul" onClick={() => abrir("procedimento", novoProc())}>+ Procedimento</button>}
        </div>
        {procAtivos.length === 0 ? (
          <p className="vazio" style={{ margin: "10px 0 0" }}>Nenhum procedimento ativo.</p>
        ) : procAtivos.map((p, i) => (
          <div key={p.id} style={linha}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              {setas("procedimento", i, procAtivos.length)}
              <div style={{ minWidth: 0 }}>
                <strong style={{ color: "var(--texto)" }}>{p.codigo}</strong> — {p.nome}
                <span className="detalhe" style={{ display: "block" }}>
                  {(p.equipamentos || []).length} equipamento(s) previsto(s)
                  {p.metodos ? " · texto de métodos definido" : " · sem texto de métodos"}
                </span>
              </div>
            </div>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn-dl btn-sec" onClick={() => abrir("procedimento", { ...p })}>
                {podeEditar ? "Editar" : "Ver"}
              </button>
              {podeEditar && (
                <button className="btn-dl btn-sec" style={vermelho} onClick={() => excluir("procedimento", p)}>Excluir</button>
              )}
            </span>
          </div>
        ))}
        {procInativos.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="detalhe" style={{ cursor: "pointer" }}>Desativados ({procInativos.length})</summary>
            <p className="detalhe" style={{ margin: "4px 0" }}>
              Não aparecem nas novas escolhas; as OSs que já os usam continuam funcionando.
            </p>
            {procInativos.map((p) => (
              <div key={p.id} style={{ ...linha, opacity: 0.75 }}>
                <div><strong style={{ color: "var(--texto)" }}>{p.codigo}</strong> — {p.nome}</div>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn-dl btn-sec" onClick={() => abrir("procedimento", { ...p })}>Ver</button>
                  {podeEditar && <button className="btn-dl btn-sec" onClick={() => desativar("procedimento", p, true)}>Reativar</button>}
                  {podeEditar && <button className="btn-dl btn-sec" style={vermelho} onClick={() => excluir("procedimento", p)}>Excluir</button>}
                </span>
              </div>
            ))}
          </details>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Equipamentos ({equipAtivos.length})</h3>
          {podeEditar && <button className="btn-azul" onClick={() => abrir("equipamento", novoEquip())}>+ Equipamento</button>}
        </div>
        {equipAtivos.length === 0 ? (
          <p className="vazio" style={{ margin: "10px 0 0" }}>Nenhum equipamento ativo.</p>
        ) : equipAtivos.map((e, i) => (
          <div key={e.id} style={linha}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              {setas("equipamento", i, equipAtivos.length)}
              {(e.fotos || [])[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/catalogo/foto?caminho=${encodeURIComponent(e.fotos[0].caminho)}`} alt=""
                  style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--borda)", flexShrink: 0 }} />
              ) : (
                <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 6, border: "1px dashed var(--borda)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🛠</span>
              )}
              <div style={{ minWidth: 0 }}>
                <strong style={{ color: "var(--texto)" }}>{e.nome || "(sem nome)"}</strong>
                <span className="detalhe" style={{ display: "block" }}>
                  {(e.especificacoes || []).length} especificação(ões) · {(e.fotos || []).length} foto(s)
                </span>
              </div>
            </div>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn-dl btn-sec" onClick={() => abrir("equipamento", { ...e })}>
                {podeEditar ? "Editar" : "Ver"}
              </button>
              {podeEditar && (
                <button className="btn-dl btn-sec" style={vermelho} onClick={() => excluir("equipamento", e)}>Excluir</button>
              )}
            </span>
          </div>
        ))}
        {equipInativos.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="detalhe" style={{ cursor: "pointer" }}>Desativados ({equipInativos.length})</summary>
            <p className="detalhe" style={{ margin: "4px 0" }}>
              Não aparecem nas novas escolhas; procedimentos, checklists e relatórios que já os usam continuam funcionando.
            </p>
            {equipInativos.map((e) => (
              <div key={e.id} style={{ ...linha, opacity: 0.75 }}>
                <div><strong style={{ color: "var(--texto)" }}>{e.nome}</strong></div>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn-dl btn-sec" onClick={() => abrir("equipamento", { ...e })}>Ver</button>
                  {podeEditar && <button className="btn-dl btn-sec" onClick={() => desativar("equipamento", e, true)}>Reativar</button>}
                  {podeEditar && <button className="btn-dl btn-sec" style={vermelho} onClick={() => excluir("equipamento", e)}>Excluir</button>}
                </span>
              </div>
            ))}
          </details>
        )}
      </div>

      {edProc && rProc && (() => {
        const editavel = podeEditar && edProc.ativo;
        const mostrar = (c: string) => tentou || (c === "codigo" ? !!edProc.codigo : c === "nome" ? !!edProc.nome : true);
        return (
        <Modal titulo={edProc.id ? (editavel ? "Editar procedimento" : "Procedimento") : "Novo procedimento"} onFechar={fechar}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {!edProc.ativo && <p className="detalhe" style={{ margin: 0 }}>Desativado — reative na lista para editar.</p>}
            <div style={grade}>
              <div><label style={rot} htmlFor="proc-codigo">Código *</label>
                <input id="proc-codigo" style={campo} value={edProc.codigo} disabled={!editavel}
                  className={mostrar("codigo") && rProc.erros.codigo ? "val-invalido" : undefined}
                  onChange={(ev) => setEdProc({ ...edProc, codigo: ev.target.value })} placeholder="ex.: PO 011" />
                <MensagensCampo r={rProc} campo="codigo" mostrarErros={mostrar("codigo")} /></div>
              <div><label style={rot} htmlFor="proc-nome">Nome *</label>
                <input id="proc-nome" style={campo} value={edProc.nome} disabled={!editavel}
                  className={mostrar("nome") && rProc.erros.nome ? "val-invalido" : undefined}
                  onChange={(ev) => setEdProc({ ...edProc, nome: ev.target.value })} />
                <MensagensCampo r={rProc} campo="nome" mostrarErros={mostrar("nome")} /></div>
            </div>
            <div><label style={rot}>Texto sugerido para “Métodos”</label>
              <textarea style={{ ...campo, minHeight: 110 }} value={edProc.metodos || ""} disabled={!editavel}
                onChange={(ev) => setEdProc({ ...edProc, metodos: ev.target.value })} /></div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: editavel ? "pointer" : "default" }}>
              <input type="checkbox" style={{ marginTop: 3 }} checked={edProc.limpeza_robotizada} disabled={!editavel}
                onChange={(ev) => setEdProc({ ...edProc, limpeza_robotizada: ev.target.checked })} />
              <span>
                <strong style={{ fontSize: 13 }}>Limpeza robotizada</strong>
                <p className="detalhe" style={{ margin: "2px 0 0" }}>
                  Marque para este procedimento usar o modelo de relatório da limpeza robotizada
                  (Sanitização, Coletas, valores de cloro/pH, laudo e Análise Físico Química e
                  Laboratorial) em vez do modelo padrão de batimetria.
                </p>
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: editavel ? "pointer" : "default" }}>
              <input type="checkbox" style={{ marginTop: 3 }} checked={edProc.agua_potavel} disabled={!editavel}
                onChange={(ev) => setEdProc({ ...edProc, agua_potavel: ev.target.checked })} />
              <span>
                <strong style={{ fontSize: 13 }}>Procedimento de água potável</strong>
                <p className="detalhe" style={{ margin: "2px 0 0" }}>
                  A coleta de fotos da execução já começa com as coletas de água antes e depois da
                  limpeza marcadas como necessárias (pH, cloro e procedimento de coleta). Na
                  OS, dá para desmarcar caso a caso.
                </p>
              </span>
            </label>
            <div style={grade}>
              <div>
                <label style={rot} htmlFor="proc-cloro-unidade">Unidade do cloro livre</label>
                <select id="proc-cloro-unidade" style={campo} value={edProc.cloro_unidade} disabled={!editavel}
                  onChange={(ev) => setEdProc({ ...edProc, cloro_unidade: ev.target.value as UnidadeCloro })}>
                  {UNIDADES_CLORO.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={rot} htmlFor="proc-cloro-limite">Avisar cloro acima de ({edProc.cloro_unidade})</label>
                <input id="proc-cloro-limite" style={campo} inputMode="decimal" value={edProc.cloro_limite_aviso} disabled={!editavel}
                  className={rProc.erros.cloro_limite_aviso ? "val-invalido" : undefined}
                  onChange={(ev) => setEdProc({ ...edProc, cloro_limite_aviso: ev.target.value })} />
                <MensagensCampo r={rProc} campo="cloro_limite_aviso" />
              </div>
            </div>
            <p className="detalhe" style={{ margin: "-4px 0 0" }}>
              A unidade sai no card da coleta de fotos, na frase do cloro do RDO (CVS 6) e no
              relatório. Valor medido acima do limite só gera aviso — não bloqueia.
            </p>
            <div>
              <label style={rot}>Modelo do relatório (.docx)</label>
              <p className="detalhe" style={{ margin: "2px 0 6px" }}>
                Deixe em branco para usar o modelo padrão da ASP. Envie um arquivo próprio (Word .docx,
                até 20 MB) quando este procedimento gerar um tipo de relatório diferente. O modelo
                anterior só é apagado depois de salvar.
              </p>
              {edProc.template_path ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="detalhe" style={{ margin: 0, wordBreak: "break-all" }}>
                    Modelo próprio: {edProc.template_path.split("/").pop()}
                  </span>
                  {editavel && (
                    <button type="button" className="btn-dl btn-sec" style={vermelho}
                      onClick={() => setEdProc({ ...edProc, template_path: null })}>Voltar ao padrão</button>
                  )}
                </div>
              ) : editavel && (
                <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={enviandoModelo}
                  aria-label="Enviar modelo .docx"
                  onChange={(ev) => { const f = ev.target.files?.[0]; if (f) enviarModelo(f); ev.target.value = ""; }} />
              )}
              {enviandoModelo && <span className="detalhe">Enviando e conferindo o modelo…</span>}
              <MensagensCampo r={rProc} campo="template_path" />
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={{ ...rot, marginBottom: 0 }}>Tópicos do relatório</label>
                {editavel && (
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {fontesParaCopiar.length > 0 && (
                      <select style={{ ...campo, width: "auto", maxWidth: "100%", padding: "7px 9px" }} value=""
                        title="Copia a lista de tópicos de outro procedimento para este"
                        onChange={(ev) => { copiarDeProcedimento(ev.target.value); ev.target.value = ""; }}>
                        <option value="">⧉ Copiar de outro procedimento…</option>
                        {fontesParaCopiar.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.codigo} — {p.topicos_lista.length} tópicos
                          </option>
                        ))}
                      </select>
                    )}
                    <button type="button" className="btn-dl btn-sec" onClick={importarDoModelo}>
                      ⬇ Importar do modelo
                    </button>
                    <button type="button" className="btn-dl btn-sec"
                      onClick={() => mexerLista((l) => [...l, {
                        numero: (l.length ? Math.max(...l.map((x) => x.numero)) : 0) + 1,
                        titulo: "", ativo: true,
                      }])}>+ Tópico</button>
                  </span>
                )}
              </div>
              <p className="detalhe" style={{ margin: "2px 0 6px" }}>
                {edProc.topicos_lista?.length
                  ? `${edProc.topicos_lista.length} tópicos deste procedimento. A ordem aqui é a ordem no relatório; o número à esquerda é o que sai no documento (desmarcado não sai e os seguintes sobem).`
                  : "Ainda não configurado — usa o modelo (ou o padrão da ASP). Importe do modelo para editar aqui."}
              </p>
              {edProc.lista_recuperada && (
                <p className="detalhe" style={{ margin: "-2px 0 6px" }}>
                  ↩ Lista remontada a partir da configuração que este procedimento já tinha
                  ({edProc.topicos?.filter((n) => n > 0).length} tópicos ativos). Ela ainda não está
                  gravada nesse formato — <strong>salve para confirmar</strong>, ou ajuste antes.
                </p>
              )}

              {(edProc.topicos_lista || []).length === 0 ? null : (
                <div style={{ border: "1px solid var(--borda)", borderRadius: 8, overflow: "hidden" }}>
                  {edProc.topicos_lista.map((t, i) => {
                    const n = numeros.lista[i];
                    const cTit = `topicos_lista.${i}.titulo`;
                    return (
                    <div key={i} style={{
                      padding: "7px 10px",
                      borderTop: i === 0 ? "none" : "1px solid var(--borda)",
                      background: t.ativo ? "transparent" : "var(--bg-suave)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: t.ativo ? 1 : 0.6 }}>
                        <input type="checkbox" checked={t.ativo} disabled={!editavel}
                          title={t.ativo ? "Entra no relatório" : "Não entra no relatório"}
                          aria-label={t.ativo ? "Entra no relatório" : "Não entra no relatório"}
                          style={{ width: 16, height: 16, flexShrink: 0 }}
                          onChange={(ev) => mexerLista((l) =>
                            l.map((x, k) => k === i ? { ...x, ativo: ev.target.checked } : x))} />
                        <span style={{ width: 26, flexShrink: 0, fontWeight: 600, color: "var(--texto-suave)" }}
                          title={n ? `Sai como tópico ${n} no documento` : "Não sai no documento"}>
                          {n ? `${n}.` : "—"}
                        </span>
                        <input style={{ ...campo, flex: 1, minWidth: 0 }} value={t.titulo} disabled={!editavel}
                          placeholder="Título do tópico" aria-label={`Título do tópico ${i + 1}`}
                          className={(tentou || t.titulo) && rProc.erros[cTit] ? "val-invalido" : undefined}
                          title={t.titulo_origem ? `No modelo: “${t.titulo_origem}”` : "Tópico criado aqui — não existe no modelo"}
                          onChange={(ev) => mexerLista((l) =>
                            l.map((x, k) => k === i ? { ...x, titulo: ev.target.value } : x))} />
                        {editavel && (
                          <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <button type="button" className="fu-icone-btn" title="Subir" disabled={i === 0}
                              onClick={() => mexerLista((l) => moverNaLista(l, i, -1))}>↑</button>
                            <button type="button" className="fu-icone-btn" title="Descer"
                              disabled={i === edProc.topicos_lista.length - 1}
                              onClick={() => mexerLista((l) => moverNaLista(l, i, 1))}>↓</button>
                            <button type="button" className="fu-icone-btn lixeira" title="Remover"
                              onClick={() => {
                                if (!confirm(`Remover o tópico “${t.titulo || "sem título"}”${n ? ` (${n} no documento)` : ""}? Ele deixa de sair no relatório deste procedimento.\n\nPara só esconder, desmarque a caixinha.`)) return;
                                mexerLista((l) => l.filter((_, k) => k !== i));
                              }}>🗑</button>
                          </span>
                        )}
                      </div>
                      <MensagensCampo r={rProc} campo={cTit} mostrarErros={tentou || !!t.titulo} />
                    </div>
                    );
                  })}
                </div>
              )}
              {edProc.topicos_lista?.some((t) => !t.titulo_origem) && (
                <p className="detalhe" style={{ margin: "6px 0 0" }}>
                  Tópicos sem vínculo com o modelo entram como seção nova, com título e texto que você definir.
                </p>
              )}
              <MensagensCampo r={rProc} campo="topicos_lista" />

              {(edProc.topicos_extras || []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <label style={rot}>Seções extras (configuração antiga)</label>
                  {edProc.topicos_extras.map((t, i) => {
                    const n = numeros.extras[i];
                    const cTit = `topicos_extras.${i}.titulo`;
                    return (
                      <div key={i} style={{ marginBottom: 6 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ width: 26, flexShrink: 0, fontWeight: 600, color: "var(--texto-suave)" }}>{n ? `${n}.` : "—"}</span>
                          <input style={{ ...campo, flex: 1, minWidth: 0 }} value={t.titulo} disabled={!editavel}
                            aria-label={`Título da seção extra ${i + 1}`}
                            className={rProc.erros[cTit] ? "val-invalido" : undefined}
                            onChange={(ev) => setEdProc({ ...edProc, topicos_extras: edProc.topicos_extras.map((x, k) => k === i ? { ...x, titulo: ev.target.value } : x) })} />
                          {editavel && (
                            <button type="button" className="fu-icone-btn lixeira" title="Remover"
                              onClick={() => {
                                if (!confirm(`Remover a seção extra “${t.titulo || "sem título"}”?`)) return;
                                setEdProc({ ...edProc, topicos_extras: edProc.topicos_extras.filter((_, k) => k !== i) });
                              }}>🗑</button>
                          )}
                        </div>
                        <MensagensCampo r={rProc} campo={cTit} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label style={rot}>Equipamentos previstos</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
                {/* Desativados só aparecem se já estão na lista (dá para tirar). */}
                {equipamentos.filter((e) => e.ativo || edProc.equipamentos.includes(e.slug)).map((e) => (
                  <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" disabled={!editavel} checked={edProc.equipamentos.includes(e.slug)}
                      onChange={(ev) => setEdProc({
                        ...edProc,
                        equipamentos: ev.target.checked
                          ? [...edProc.equipamentos, e.slug]
                          : edProc.equipamentos.filter((s) => s !== e.slug),
                      })} />
                    <span>{e.nome}{e.ativo ? "" : " (desativado)"}</span>
                  </label>
                ))}
              </div>
              <MensagensCampo r={rProc} campo="equipamentos">
                {editavel && inexistentes.length > 0 && (
                  <button type="button" className="val-acao"
                    onClick={() => setEdProc({ ...edProc, equipamentos: edProc.equipamentos.filter((s) => !inexistentes.includes(s)) })}>
                    Remover {inexistentes.length === 1 ? "o inexistente" : `os ${inexistentes.length} inexistentes`}
                  </button>
                )}
              </MensagensCampo>
            </div>
            {editavel && <ResumoValidacao r={rProc} rotulos={ROTULOS_CATALOGO} mostrarErros={tentou} />}
            {erroNoModal}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={fechar}>{editavel ? "Cancelar" : "Fechar"}</button>
              {editavel && (
                <button className="btn-azul" disabled={salvando || enviandoModelo}
                  onClick={() => salvar("procedimento", edProc)}>{salvando ? "Salvando…" : "Salvar"}</button>
              )}
            </div>
          </div>
        </Modal>
        );
      })()}

      {edEquip && rEquip && (() => {
        const editavel = podeEditar && edEquip.ativo;
        const mostrarNome = tentou || !!edEquip.nome;
        return (
        <Modal titulo={edEquip.id ? (editavel ? "Editar equipamento" : "Equipamento") : "Novo equipamento"} largo onFechar={fechar}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {!edEquip.ativo && <p className="detalhe" style={{ margin: 0 }}>Desativado — reative na lista para editar.</p>}
            <div>
              <label style={rot} htmlFor="equip-nome">Nome *</label>
              <input id="equip-nome" style={campo} value={edEquip.nome} disabled={!editavel}
                className={mostrarNome && rEquip.erros.nome ? "val-invalido" : undefined}
                onChange={(ev) => setEdEquip({ ...edEquip, nome: ev.target.value })}
                placeholder="ex.: Submarino para a Batimetria" />
              <MensagensCampo r={rEquip} campo="nome" mostrarErros={mostrarNome} />
            </div>

            <div>
              <label style={rot}>Especificações (rótulo e valor)</label>
              <p className="detalhe" style={{ margin: "0 0 6px" }}>Linhas totalmente vazias são descartadas ao salvar.</p>
              {(edEquip.especificacoes || []).map((sp, i) => {
                const c = `especificacoes.${i}.rotulo`;
                return (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                    <input style={campo} placeholder="Rótulo (ex.: Profundidade máxima)" value={sp.rotulo} disabled={!editavel}
                      aria-label={`Rótulo da especificação ${i + 1}`}
                      className={rEquip.erros[c] ? "val-invalido" : undefined}
                      onChange={(ev) => setEdEquip({ ...edEquip, especificacoes: edEquip.especificacoes.map((x, k) => k === i ? { ...x, rotulo: ev.target.value } : x) })} />
                    <input style={campo} placeholder="Valor (ex.: 152 m)" value={sp.valor} disabled={!editavel}
                      aria-label={`Valor da especificação ${i + 1}`}
                      onChange={(ev) => setEdEquip({ ...edEquip, especificacoes: edEquip.especificacoes.map((x, k) => k === i ? { ...x, valor: ev.target.value } : x) })} />
                    {editavel && (
                      <button className="btn-dl btn-sec" style={{ ...vermelho, maxWidth: 110 }}
                        onClick={() => setEdEquip({ ...edEquip, especificacoes: edEquip.especificacoes.filter((_, k) => k !== i) })}>Remover</button>
                    )}
                  </div>
                  <MensagensCampo r={rEquip} campo={c} />
                </div>
                );
              })}
              {editavel && (
                <button className="btn-dl btn-sec"
                  onClick={() => setEdEquip({ ...edEquip, especificacoes: [...(edEquip.especificacoes || []), { rotulo: "", valor: "" }] })}>
                  + Linha de especificação
                </button>
              )}
            </div>

            <div>
              <label style={rot}>Fotos do equipamento</label>
              {editavel && (
                <>
                  <p className="detalhe" style={{ margin: "0 0 6px" }}>
                    JPEG ou PNG até 10 MB (WebP, GIF e HEIC são convertidos). Remover tira a foto do
                    formulário; ela só é apagada quando você salvar.
                  </p>
                  <input type="file" accept="image/*" disabled={enviandoFoto} aria-label="Enviar foto"
                    onChange={(ev) => { const f = ev.target.files?.[0]; if (f) enviarFoto(f); ev.target.value = ""; }} />
                </>
              )}
              {enviandoFoto && <span className="detalhe"> conferindo e enviando…</span>}
              {msgFoto && <p className="val-msg val-erro" style={{ margin: "4px 0 0" }}>{msgFoto}</p>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 8 }}>
                {(edEquip.fotos || []).map((f, i) => (
                  <div key={f.caminho} style={{ border: "1px solid var(--borda)", borderRadius: 8, padding: 6 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/catalogo/foto?caminho=${encodeURIComponent(f.caminho)}`} alt={f.legenda || ""}
                      style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 6 }} />
                    <input style={{ ...campo, marginTop: 6, fontSize: 12, padding: "6px 8px" }} placeholder="Legenda"
                      value={f.legenda || ""} disabled={!editavel} aria-label={`Legenda da foto ${i + 1}`}
                      onChange={(ev) => setEdEquip({ ...edEquip, fotos: edEquip.fotos.map((x, k) => k === i ? { ...x, legenda: ev.target.value } : x) })} />
                    {editavel && (
                      <button className="btn-dl btn-sec" style={{ ...vermelho, width: "100%", marginTop: 6 }}
                        onClick={() => setEdEquip({ ...edEquip, fotos: edEquip.fotos.filter((_, k) => k !== i) })}>Remover</button>
                    )}
                    <MensagensCampo r={rEquip} campo={`fotos.${i}`} />
                  </div>
                ))}
              </div>
            </div>

            {editavel && <ResumoValidacao r={rEquip} rotulos={ROTULOS_CATALOGO} mostrarErros={tentou} />}
            {erroNoModal}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={fechar}>{editavel ? "Cancelar" : "Fechar"}</button>
              {editavel && (
                <button className="btn-azul" disabled={salvando || enviandoFoto}
                  onClick={() => salvar("equipamento", edEquip)}>{salvando ? "Salvando…" : "Salvar"}</button>
              )}
            </div>
          </div>
        </Modal>
        );
      })()}
    </div>
  );
}
