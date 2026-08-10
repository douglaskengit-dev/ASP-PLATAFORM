"use client";

/** Geração do Relatório Técnico a partir do template da ASP.
 *
 * A tela é organizada por tópico: cada um tem uma caixa de seleção e, logo
 * abaixo, os campos daquele tópico e o envio de fotos correspondente. Ao
 * desmarcar, a seção sai do documento e os números seguintes são reajustados.
 * A capa é o tópico 0 e também pode ser omitida. */
import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import EditorTexto from "./EditorTexto";
import {
  gerarRelatorioDocx, TOPICOS_PADRAO, TOPICO_CAPA,
  type DadosRelatorio, type ImagemRelatorio,
} from "@/lib/asp/relatorio";
import { camposDaMedicao } from "@/lib/asp/relatorio";
import { MATERIAIS_TANQUE } from "@/lib/asp/procedimentos";

export interface ColetaOpcao { id: string; criado_em: string; dados: any; aprovada_em?: string | null }

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
  /** Snapshot de um rascunho salvo — reabre o formulário como estava.
   *  As fotos não são restauradas (só o arquivo final as contém). */
  estadoSalvo?: SnapshotRelatorio | null;
}

/** Tudo que o formulário precisa para ser reconstruído depois. */
export interface SnapshotRelatorio {
  d: Partial<DadosRelatorio>;
  subs8?: { titulo: string }[];
  textosExtras?: Record<number, string>;
  visiveis: Record<number, boolean>;
  equipeIds: string[];
  equipIds: string[];
  coletaId: string;
}

interface FotoTopico {
  arquivo: File; legenda: string; topico: number; ancora?: string;
  /** Crédito da imagem — sai como "Fonte: …" abaixo da legenda. */
  fonte?: string;
}

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 };
const grade: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
};

const TODOS_TOPICOS = [TOPICO_CAPA, ...TOPICOS_PADRAO];

export default function GerarRelatorio({ onFechar, inicial, nomeArquivo, usuarios, coletas, onSalvar, estadoSalvo }: Props) {
  const [d, setD] = useState<Partial<DadosRelatorio>>(
    estadoSalvo?.d ? { ...inicial, ...estadoSalvo.d } : inicial
  );
  const [visiveis, setVisiveis] = useState<Record<number, boolean>>(
    estadoSalvo?.visiveis || Object.fromEntries(TODOS_TOPICOS.map((t) => [t.numero, true]))
  );
  const [equipeIds, setEquipeIds] = useState<string[]>(estadoSalvo?.equipeIds || []);
  const [equipIds, setEquipIds] = useState<string[]>(estadoSalvo?.equipIds || []);
  // Subtópicos do tópico 8 (8.1, 8.2 …) — título livre, fotos próprias.
  const [subs8, setSubs8] = useState<{ titulo: string }[]>(estadoSalvo?.subs8 || []);
  // Texto das seções extras do procedimento, por índice. O título é do Catálogo.
  const [textosExtras, setTextosExtras] = useState<Record<number, string>>(estadoSalvo?.textosExtras || {});
  const [fotos, setFotos] = useState<FotoTopico[]>([]);
  // Por padrão usa a medição APROVADA; se não houver, a mais recente.
  const [coletaId, setColetaId] = useState<string>(
    estadoSalvo?.coletaId || (coletas.find((c) => c.aprovada_em) || coletas[0])?.id || ""
  );
  // Catálogo (procedimentos e equipamentos) vem do banco — aba Catálogo.
  const [PROCEDIMENTOS, setProcedimentos] = useState<any[]>([]);
  const [EQUIPAMENTOS, setEquipamentos] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/catalogo").then((r) => r.ok ? r.json() : {}).then((d: any) => {
      setProcedimentos(d.procedimentos || []);
      setEquipamentos((d.equipamentos || []).map((e: any) => ({ ...e, id: e.slug })));
    }).catch(() => {});
  }, []);

  const [gerando, setGerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /** Revisão e código do projeto compõem o campo "Relatório" da capa,
   *  no formato do modelo: "37/MG/26 Rev1". */
  function mudarRevisao(valor: string) {
    setD((v) => {
      const base = v.codigoProjeto || "";
      return { ...v, revisao: valor, relatorioCodigo: base ? `${base} Rev${valor}` : v.relatorioCodigo };
    });
  }

  /** Ao trocar a medição, os campos automáticos são recalculados a partir
   *  DAQUELA coleta — o resto do formulário é preservado. */
  function trocarColeta(id: string) {
    setColetaId(id);
    const c = coletas.find((x) => x.id === id);
    if (c) setD((v) => ({ ...v, ...camposDaMedicao(c.dados) }));
  }

  const set = (k: keyof DadosRelatorio) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setD((v) => ({ ...v, [k]: e.target.value }));

  const ativo = (n: number) => visiveis[n] !== false;
  const qtdOcultos = useMemo(() => TODOS_TOPICOS.filter((t) => !ativo(t.numero)).length, [visiveis]);

  /** Preparado / Checado / Aprovado saem dos usuários de Operações. */
  const operacoes = useMemo(() => usuarios.filter((u) => u.perfil === "operacoes"), [usuarios]);
  const gerencia = useMemo(() => usuarios.filter((u) => u.perfil === "gerencia"), [usuarios]);

  /** Procedimento escolhido na capa — dele saem as sugestões de método e
   *  de equipamentos (itens 3 e 4). */
  const proc = useMemo(
    () => PROCEDIMENTOS.find((p) => p.codigo === d.procedimento) || null,
    [d.procedimento, PROCEDIMENTOS]
  );
  /** Quantos tópicos o procedimento escolhido prevê (null = todos). */
  const topicosDoProc: number | null = Array.isArray(proc?.topicos) ? proc!.topicos.length : null;
  /** Tópicos próprios do procedimento escolhido (definidos no Catálogo). */
  const extras: { titulo: string; apos?: number }[] =
    Array.isArray(proc?.topicos_extras) ? proc!.topicos_extras : [];

  /** Aplica a sugestão do procedimento: preenche os métodos e marca os
   *  equipamentos previstos (o usuário ajusta depois). */
  function aplicarSugestao() {
    if (!proc) return;
    setD((v) => ({ ...v, metodos: proc.metodos || "" }));
    setEquipIds(proc.equipamentos);
    // O procedimento define o FORMATO do relatório: quais tópicos entram.
    // Sem configuração (null), mantém o que estiver marcado hoje.
    if (Array.isArray(proc.topicos)) {
      const lista: number[] = proc.topicos;
      setVisiveis(Object.fromEntries(TODOS_TOPICOS.map((t) => [t.numero, lista.includes(t.numero)])));
    }
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

  function addFotos(lista: FileList | null, topico: number, restam = 20, legendaPadrao = "") {
    const fs = Array.from(lista || []).slice(0, Math.max(0, restam));
    if (fs.length === 0) return;
    setFotos((p) => [...p, ...fs.map((f) => ({ arquivo: f, legenda: legendaPadrao, topico }))]);
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
      const imgs: ImagemRelatorio[] = [];
      for (const f of fotos) {
        if (!ativo(f.topico)) continue;               // tópico oculto: ignora a foto
        const ext = f.arquivo.type.includes("png") || f.arquivo.name.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        imgs.push({
          dados: await f.arquivo.arrayBuffer(),
          extensao: ext as "png" | "jpeg",
          legenda: f.legenda || f.arquivo.name.replace(/\.[^.]+$/, ""),
          topico: f.topico, ancora: f.ancora, fonte: f.fonte?.trim() || undefined,
        });
      }
      return gerarRelatorioDocx({
        titulo: d.titulo || "", cliente: d.cliente || "", endereco: d.endereco || "",
        revisao: d.revisao, statusRevisao: d.statusRevisao, dataRevisao: d.dataRevisao,
        preparadoPor: d.preparadoPor, checadoPor: d.checadoPor, aprovadoPor: d.aprovadoPor,
        relatorioCodigo: d.relatorioCodigo, procedimento: d.procedimento,
        unidade: d.unidade, contato: d.contato,
        dataExecucao: d.dataExecucao, dataRelatorio: d.dataRelatorio,
        tag: d.tag, area: d.area, material: d.material,
        capacidadeNominal: d.capacidadeNominal, alturaTanque: d.alturaTanque, diametro: d.diametro,
        observacoesTanque: d.observacoesTanque,
        equipamentoTanque: d.equipamentoTanque, capacidadeTanque: d.capacidadeTanque,
        volumeMin: d.volumeMin, volumeMax: d.volumeMax,
        metodos: d.metodos, equipamentos: d.equipamentos,
        equipe: equipeDoc || d.equipe,
        equipamentosFicha: fichasComFoto,
        volumeSedimento: d.volumeSedimento,
        fotosInternas: d.fotosInternas, conclusao: d.conclusao, recomendacoes: d.recomendacoes,
        subtopicos8: subs8,
        topicosExtras: extras.map((t, i) => ({ titulo: t.titulo, texto: textosExtras[i] || "", apos: t.apos })),
        templateUrl: proc?.template_path
          ? `/api/catalogo/template?caminho=${encodeURIComponent(proc.template_path)}`
          : undefined,
        elaboradoPor: d.elaboradoPor, revisadoPor: d.revisadoPor,
        topicos: TODOS_TOPICOS.map((t) => ({ ...t, visivel: ativo(t.numero) })),
        imagens: imgs,
      });
  }

  function validar(): boolean {
    setErro(null);
    if (ativo(0) && !d.titulo?.trim()) { setErro("Informe o título do relatório (capa)."); return false; }
    return true;
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
      await onSalvar(blob, { d, visiveis, equipeIds, equipIds, coletaId, subs8, textosExtras });
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
          <input type="file" accept="image/png,image/jpeg" multiple={max > 1}
            onChange={(e) => {
              const fs = Array.from(e.target.files || []).slice(0, max - minhas.length);
              setFotos((p) => [...p, ...fs.map((f) => ({ arquivo: f, legenda: legendaPadrao, topico, ancora }))]);
              e.target.value = "";
            }} />
        )}
        {cheio && <span className="detalhe">Limite de {max} foto(s) atingido.</span>}
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
        <input style={campo} placeholder="Legenda" value={f.legenda}
          onChange={(e) => setFotos((p) => p.map((x, k) => k === i ? { ...x, legenda: e.target.value } : x))} />
        <input style={campo} list="sug-fonte-figura" placeholder="Fonte (padrão: ASP)"
          value={f.fonte ?? ""}
          onChange={(e) => setFotos((p) => p.map((x, k) => k === i ? { ...x, fonte: e.target.value } : x))} />
        <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
          onClick={() => setFotos((p) => p.filter((_, k) => k !== i))}>Remover</button>
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
        <input type="file" accept="image/png,image/jpeg" multiple
          onChange={(e) => { addFotos(e.target.files, topico, limite - minhas.length, legendaPadrao); e.target.value = ""; }} />)}
        {minhas.map(({ f, i }) => LinhaFoto(f, i))}
      </div>
    );
  }

  /** Um tópico: cabeçalho com seleção + campos logo abaixo quando ativo. */
  function Topico({ numero, titulo, children, maxFotos, legendaFoto }: {
    numero: number; titulo: string; children?: React.ReactNode; maxFotos?: number; legendaFoto?: string;
  }) {
    const on = ativo(numero);
    return (
      <div style={{
        border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 12px",
        opacity: on ? 1 : 0.55, background: on ? "transparent" : "var(--bg-suave)",
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>
          <input type="checkbox" checked={on}
            onChange={(e) => setVisiveis((v) => ({ ...v, [numero]: e.target.checked }))} />
          <span>{numero === 0 ? titulo : `${numero}. ${titulo}`}</span>
        </label>
        {on && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {children}
            {BlocoFotos({ topico: numero, max: maxFotos, legendaPadrao: legendaFoto })}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="detalhe" style={{ margin: 0 }}>
          Preenche o modelo oficial da ASP mantendo timbre, cabeçalho e rodapé. Formatação conforme
          ABNT (NBR 14724): Arial 12, entrelinha 1,5, texto justificado, margens 3/2/3/2 cm e legendas
          de figura em Arial 10. {qtdOcultos > 0 && <strong>{qtdOcultos} tópico(s) oculto(s) — os demais são renumerados.</strong>}
        </p>

        <div style={{ border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 12px" }}>
          <label style={rotulo}>Medição utilizada <span className="detalhe">(define altura, diâmetro, capacidade e volume)</span></label>
          {coletas.length === 0 ? (
            <p className="vazio" style={{ margin: 0 }}>Nenhuma medição salva nesta inspeção — os campos automáticos ficam vazios.</p>
          ) : (
            <select style={campo} value={coletaId} onChange={(e) => trocarColeta(e.target.value)}>
              {coletas.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {c.aprovada_em ? "✓ " : ""}Medição {coletas.length - i} — {new Date(c.criado_em).toLocaleString("pt-BR")}
                  {c.dados?.resultado?.volSedM3 != null ? ` · ${Number(c.dados.resultado.volSedM3).toFixed(3).replace(".", ",")} m³` : ""}
                </option>
              ))}
            </select>
          )}
          {coletas.length > 0 && !coletas.some((c) => c.aprovada_em) && (
            <p className="detalhe" style={{ margin: "6px 0 0", color: "#c2410c" }}>
              ⚠ Nenhuma medição foi aprovada nesta inspeção. Você pode gerar assim mesmo, mas convém
              aprovar a medição válida no card de Coletas antes de enviar.
            </p>
          )}
        </div>

        {Topico({ numero: 0, titulo: TOPICO_CAPA.titulo, children: <>
          <div style={grade}>
            <div><label style={rotulo}>Título do relatório *</label>
              <input style={campo} value={d.titulo || ""} onChange={set("titulo")} placeholder="ex.: Batimetria — Tanque TQ-01" /></div>
            <div><label style={rotulo}>Cliente <span className="detalhe">(automático)</span></label>
              <input style={campo} value={d.cliente || ""} onChange={set("cliente")} /></div>
            <div><label style={rotulo}>Endereço</label>
              <input style={campo} value={d.endereco || ""} onChange={set("endereco")} /></div>
            <div><label style={rotulo}>Data do relatório</label>
              <input style={campo} value={d.dataRelatorio || ""} onChange={set("dataRelatorio")} placeholder="dd/mm/aaaa" /></div>
          </div>

          <strong style={{ fontSize: 12.5, marginTop: 4 }}>Controle de revisão</strong>
          <div style={grade}>
            <div>
              <label style={rotulo}>Revisão <span className="detalhe">(automática)</span></label>
              <input style={{ ...campo, fontWeight: 700 }} value={d.revisao || ""}
                onChange={(e) => mudarRevisao(e.target.value)} />
              <span className="detalhe">Incrementa a cada reprovação registrada nesta inspeção e compõe o campo Relatório.</span>
            </div>
            <div>
              <label style={rotulo}>Status</label>
              <select style={campo} value={d.statusRevisao || ""}
                onChange={(e) => setD((v) => ({ ...v, statusRevisao: e.target.value }))}>
                <option value="">—</option>
                {["A", "B", "C", "D", "E"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><label style={rotulo}>Data (dd/mm/aaaa)</label>
              <input style={campo} value={d.dataRevisao || ""} onChange={set("dataRevisao")} placeholder="dd/mm/aaaa" /></div>
          </div>
          <div style={grade}>
            {([
              ["preparadoPor", "Preparado por"],
              ["checadoPor", "Checado por"],
              ["aprovadoPor", "Aprovado por"],
            ] as const).map(([chave, label]) => (
              <div key={chave}>
                <label style={rotulo}>{label}</label>
                <select style={campo} value={(d as any)[chave] || ""}
                  onChange={(e) => setD((v) => ({ ...v, [chave]: e.target.value }))}>
                  <option value="">—</option>
                  {operacoes.map((u) => (
                    <option key={u.id} value={u.nome}>{u.nome}{u.funcao ? ` · ${u.funcao}` : ""}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div style={grade}>
            <div><label style={rotulo}>Relatório <span className="detalhe">(automático — código do projeto)</span></label>
              <input style={campo} value={d.relatorioCodigo || ""} onChange={set("relatorioCodigo")} /></div>
            <div>
              <label style={rotulo}>Procedimento</label>
              <input style={campo} list="lista-procedimentos" value={d.procedimento || ""}
                onChange={set("procedimento")} placeholder="ex.: PR-BAT-001" />
              <datalist id="lista-procedimentos">
                {PROCEDIMENTOS.map((p: any) => <option key={p.codigo} value={p.codigo}>{p.nome}</option>)}
              </datalist>
              <span className="detalhe">
                {proc ? `${proc.nome} — sugere método e equipamentos nos tópicos 3 e 4.` : "Digite o código; o cadastro em banco ainda será mapeado."}
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
            <div><label style={rotulo}>Cliente <span className="detalhe">(automático)</span></label>
              <input style={campo} value={d.cliente || ""} onChange={set("cliente")} /></div>
            <div><label style={rotulo}>Unidade</label>
              <input style={campo} value={d.unidade || ""} onChange={set("unidade")} /></div>
            <div><label style={rotulo}>Contato <span className="detalhe">(cadastro do cliente)</span></label>
              <input style={campo} value={d.contato || ""} onChange={set("contato")}
                placeholder="sem contato cadastrado" /></div>
          </div>
          <div style={grade}>
            <div>
              <label style={rotulo}>Execução <span className="detalhe">(automático — agendamento)</span></label>
              <input style={campo} value={d.dataExecucao || ""} onChange={set("dataExecucao")} placeholder="dd/mm/aaaa" />
              <span className="detalhe">Data do serviço, tirada do agendamento do mesmo tipo do relatório (inspeção até a fase 5; execução a partir da 6).</span>
            </div>
            <div><label style={rotulo}>Relatório <span className="detalhe">(automático — código do projeto)</span></label>
              <input style={campo} value={d.relatorioCodigo || ""} onChange={set("relatorioCodigo")} /></div>
          </div>
        </> })}

        {Topico({ numero: 2, titulo: "Identificação do tanque", children: <>
          <div style={grade}>
            <div><label style={rotulo}>TAG</label><input style={campo} value={d.tag || ""} onChange={set("tag")} /></div>
            <div><label style={rotulo}>Área</label><input style={campo} value={d.area || ""} onChange={set("area")} /></div>
            <div>
              <label style={rotulo}>Material</label>
              <select style={campo} value={d.material || ""}
                onChange={(e) => setD((v) => ({ ...v, material: e.target.value }))}>
                <option value="">—</option>
                {MATERIAIS_TANQUE.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div><label style={rotulo}>Capacidade nominal</label>
              <input style={campo} value={d.capacidadeNominal || ""} onChange={set("capacidadeNominal")} placeholder="ex.: 1.500 m³" /></div>
            <div><label style={rotulo}>Altura do tanque</label><input style={campo} value={d.alturaTanque || ""} onChange={set("alturaTanque")} /></div>
            <div><label style={rotulo}>Diâmetro</label><input style={campo} value={d.diametro || ""} onChange={set("diametro")} /></div>
          </div>
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
                  (topicosDoProc !== null
                    ? ` Este procedimento usa ${topicosDoProc} de ${TODOS_TOPICOS.length} tópicos — a seleção será ajustada.`
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
            {EQUIPAMENTOS.map((eq: any) => (
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

        {Topico({ numero: 5, titulo: "Equipe de trabalho", children: <>
          <label style={rotulo}>Envolvidos — selecione entre os usuários cadastrados</label>
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
        </> })}

        {Topico({ numero: 6, titulo: "Dados reservatório", children: <>
          <div style={grade}>
            <div><label style={rotulo}>Equipamento <span className="detalhe">(tipo/uso do tanque)</span></label>
              <input style={campo} value={d.equipamentoTanque || ""} onChange={set("equipamentoTanque")}
                placeholder="ex.: Tanque de combate a incêndio" /></div>
            <div><label style={rotulo}>Altura <span className="detalhe">(automático)</span></label>
              <input style={campo} value={d.alturaTanque || ""} onChange={set("alturaTanque")} /></div>
            <div><label style={rotulo}>Diâmetro <span className="detalhe">(automático)</span></label>
              <input style={campo} value={d.diametro || ""} onChange={set("diametro")} /></div>
            <div><label style={rotulo}>Capacidade <span className="detalhe">(automático — volume do tanque)</span></label>
              <input style={campo} value={d.capacidadeTanque || ""} onChange={set("capacidadeTanque")} /></div>
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
              <input style={campo} value={d.volumeSedimento || ""} onChange={set("volumeSedimento")} placeholder="ex.: 12,480 m³" /></div>
            <div><label style={rotulo}>Mínimo (−5%)</label>
              <input style={campo} value={d.volumeMin || ""} onChange={set("volumeMin")} /></div>
            <div><label style={rotulo}>Máximo (+5%)</label>
              <input style={campo} value={d.volumeMax || ""} onChange={set("volumeMax")} /></div>
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
              <div key={i} style={{ marginTop: 10, padding: 10, border: "1px solid var(--borda)", borderRadius: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>8.{i + 1}</strong>
                  <input style={{ ...campo, flex: 1, minWidth: 160 }} placeholder="Título do subtópico (ex.: Teto)"
                    value={st.titulo}
                    onChange={(e) => setSubs8((p) => p.map((x, k) => k === i ? { titulo: e.target.value } : x))} />
                  <button type="button" className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
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
                {BlocoFotosAncora({ ancora: `sub8-${i}`, legendaPadrao: st.titulo || "Inspeção visual interna", max: 10, topico: 8 })}
              </div>
            ))}
          </div>
        </> })}

        {/* Seções extras do procedimento: entram aqui, antes da Conclusão,
            exatamente como sairão no documento. O título vem do Catálogo. */}
        {extras.length > 0 && (
          <div className="card" style={{ margin: 0 }}>
            <strong style={{ fontSize: 13.5 }}>
              Tópicos de {proc?.codigo} <span className="detalhe">(definidos no Catálogo)</span>
            </strong>
            {extras.map((t, i) => (
              <div key={i} style={{ marginTop: 10, borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
                <strong style={{ fontSize: 12.5 }}>{t.titulo || `Seção ${i + 1}`}</strong>
                <EditorTexto valor={textosExtras[i] || ""} altura={100}
                  onChange={(v) => setTextosExtras((p) => ({ ...p, [i]: v }))} />
                {BlocoFotosAncora({ ancora: `extra-${i}`, legendaPadrao: t.titulo || "", max: 10, topico: 9 })}
              </div>
            ))}
          </div>
        )}

        {Topico({ numero: 9, titulo: "Conclusão", maxFotos: 5, legendaFoto: "Conclusão", children: <>
          <EditorTexto valor={d.conclusao || ""} onChange={(v) => setD((x) => ({ ...x, conclusao: v }))} altura={110} />
        </> })}

        {Topico({ numero: 10, titulo: "Recomendações", maxFotos: 5, legendaFoto: "Recomendação", children: <>
          <EditorTexto valor={d.recomendacoes || ""} onChange={(v) => setD((x) => ({ ...x, recomendacoes: v }))} altura={110} />
        </> })}

        <div style={{ border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 12px" }}>
          <strong style={{ fontSize: 13.5 }}>Assinaturas</strong>
          <div style={{ ...grade, marginTop: 8 }}>
            <div>
              <label style={rotulo}>Relatório elaborado por <span className="detalhe">(Operações)</span></label>
              <select style={campo} value={d.elaboradoPor || ""}
                onChange={(e) => setD((v) => ({ ...v, elaboradoPor: e.target.value }))}>
                <option value="">—</option>
                {operacoes.map((u) => (
                  <option key={u.id} value={u.nome}>{u.nome}{u.funcao ? ` · ${u.funcao}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={rotulo}>Relatório revisado por <span className="detalhe">(Gerência)</span></label>
              <select style={campo} value={d.revisadoPor || ""}
                onChange={(e) => setD((v) => ({ ...v, revisadoPor: e.target.value }))}>
                <option value="">—</option>
                {gerencia.map((u) => (
                  <option key={u.id} value={u.nome}>{u.nome}{u.funcao ? ` · ${u.funcao}` : ""}</option>
                ))}
              </select>
            </div>
          </div>
          {gerencia.length === 0 && (
            <p className="detalhe" style={{ margin: "6px 0 0" }}>Nenhum usuário de Gerência cadastrado.</p>
          )}
        </div>

        {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn-azul btn-sec" onClick={onFechar} disabled={gerando || enviando}>Cancelar</button>
          <button className="btn-azul btn-sec" onClick={baixar} disabled={gerando || enviando}>
            {gerando ? "Gerando…" : "⬇ Só baixar (.docx)"}
          </button>
          <button className="btn-azul" onClick={salvarEEnviar} disabled={gerando || enviando}>
            {enviando ? "Salvando…" : "💾 Salvar rascunho no card"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
