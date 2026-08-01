"use client";

/** Geração do Relatório Técnico a partir do template da ASP.
 *
 * A tela é organizada por tópico: cada um tem uma caixa de seleção e, logo
 * abaixo, os campos daquele tópico e o envio de fotos correspondente. Ao
 * desmarcar, a seção sai do documento e os números seguintes são reajustados.
 * A capa é o tópico 0 e também pode ser omitida. */
import { useMemo, useState } from "react";
import Modal from "./Modal";
import {
  gerarRelatorioDocx, TOPICOS_PADRAO, TOPICO_CAPA,
  type DadosRelatorio, type ImagemRelatorio,
} from "@/lib/asp/relatorio";
import { MATERIAIS_TANQUE, PROCEDIMENTOS, EQUIPAMENTOS, textoEquipamentos } from "@/lib/asp/procedimentos";

export interface UsuarioRelatorio { id: string; nome: string; perfil: string; funcao: string | null }

interface Props {
  onFechar: () => void;
  inicial: Partial<DadosRelatorio>;
  nomeArquivo: string;
  /** Usuários da base — a lista de envolvidos sai daqui. */
  usuarios: UsuarioRelatorio[];
}

interface FotoTopico { arquivo: File; legenda: string; topico: number; ancora?: string }

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 };
const grade: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
};

const TODOS_TOPICOS = [TOPICO_CAPA, ...TOPICOS_PADRAO];

export default function GerarRelatorio({ onFechar, inicial, nomeArquivo, usuarios }: Props) {
  const [d, setD] = useState<Partial<DadosRelatorio>>(inicial);
  const [visiveis, setVisiveis] = useState<Record<number, boolean>>(
    Object.fromEntries(TODOS_TOPICOS.map((t) => [t.numero, true]))
  );
  const [equipeIds, setEquipeIds] = useState<string[]>([]);
  const [equipIds, setEquipIds] = useState<string[]>([]);
  const [fotos, setFotos] = useState<FotoTopico[]>([]);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /** Revisão e código do projeto compõem o campo "Relatório" da capa,
   *  no formato do modelo: "37/MG/26 Rev1". */
  function mudarRevisao(valor: string) {
    setD((v) => {
      const base = v.codigoProjeto || "";
      return { ...v, revisao: valor, relatorioCodigo: base ? `${base} Rev${valor}` : v.relatorioCodigo };
    });
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
    [d.procedimento]
  );

  /** Aplica a sugestão do procedimento: preenche os métodos e marca os
   *  equipamentos previstos (o usuário ajusta depois). */
  function aplicarSugestao() {
    if (!proc) return;
    setD((v) => ({ ...v, metodos: proc.metodos }));
    setEquipIds(proc.equipamentos);
    setD((v) => ({ ...v, equipamentos: textoEquipamentos(proc.equipamentos) }));
  }

  /** Marca/desmarca um equipamento e reescreve o texto do tópico 4. */
  function alternarEquipamento(id: string, marcado: boolean) {
    const novos = marcado ? [...equipIds, id] : equipIds.filter((x) => x !== id);
    setEquipIds(novos);
    setD((v) => ({ ...v, equipamentos: textoEquipamentos(novos) }));
  }

  const nomesEquipe = useMemo(
    () => usuarios.filter((u) => equipeIds.includes(u.id))
      .map((u) => (u.funcao ? `${u.nome} (${u.funcao})` : u.nome)).join(", "),
    [usuarios, equipeIds]
  );

  function addFotos(lista: FileList | null, topico: number, restam = 20, legendaPadrao = "") {
    const fs = Array.from(lista || []).slice(0, Math.max(0, restam));
    if (fs.length === 0) return;
    setFotos((p) => [...p, ...fs.map((f) => ({ arquivo: f, legenda: legendaPadrao, topico }))]);
  }

  async function gerar() {
    setErro(null);
    if (ativo(0) && !d.titulo?.trim()) { setErro("Informe o título do relatório (capa)."); return; }
    setGerando(true);
    try {
      const imgs: ImagemRelatorio[] = [];
      for (const f of fotos) {
        if (!ativo(f.topico)) continue;               // tópico oculto: ignora a foto
        const ext = f.arquivo.type.includes("png") || f.arquivo.name.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        imgs.push({
          dados: await f.arquivo.arrayBuffer(),
          extensao: ext as "png" | "jpeg",
          legenda: f.legenda || f.arquivo.name.replace(/\.[^.]+$/, ""),
          topico: f.topico, ancora: f.ancora,
        });
      }
      const blob = await gerarRelatorioDocx({
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
        equipe: nomesEquipe || d.equipe,
        volumeSedimento: d.volumeSedimento, observacoes: d.observacoes, conclusao: d.conclusao,
        elaboradoPor: d.elaboradoPor, revisadoPor: d.revisadoPor,
        topicos: TODOS_TOPICOS.map((t) => ({ ...t, visivel: ativo(t.numero) })),
        imagens: imgs,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${nomeArquivo}.docx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o relatório.");
    } finally {
      setGerando(false);
    }
  }

  // IMPORTANTE: estes auxiliares são CHAMADOS como função ({Topico({...})}),
  // e não usados como componente JSX (<Topico/>). Como são declarados dentro
  // de GerarRelatorio, a cada render virariam um "tipo" novo para o React, que
  // desmontaria e remontaria a árvore — e o campo perderia o foco a cada tecla,
  // impedindo a edição. Chamando como função, o JSX é inserido no mesmo nível.

  /** Fotos de um subtópico (6.1, 6.2, 6.3), com limite de quantidade.
   *  Cada envio abre uma nova linha com legenda própria. */
  function BlocoFotosAncora({ ancora, legendaPadrao, max }: { ancora: string; legendaPadrao: string; max: number }) {
    const minhas = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.ancora === ancora);
    const cheio = minhas.length >= max;
    return (
      <div style={{ marginTop: 6 }}>
        {!cheio && (
          <input type="file" accept="image/png,image/jpeg" multiple={max > 1}
            onChange={(e) => {
              const fs = Array.from(e.target.files || []).slice(0, max - minhas.length);
              setFotos((p) => [...p, ...fs.map((f) => ({ arquivo: f, legenda: legendaPadrao, topico: 6, ancora }))]);
              e.target.value = "";
            }} />
        )}
        {cheio && <span className="detalhe">Limite de {max} foto(s) atingido.</span>}
        {minhas.map(({ f, i }) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 6, alignItems: "center" }}>
            <span className="detalhe" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{f.arquivo.name}</span>
            <input style={campo} placeholder="Legenda" value={f.legenda}
              onChange={(e) => setFotos((p) => p.map((x, k) => k === i ? { ...x, legenda: e.target.value } : x))} />
            <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
              onClick={() => setFotos((p) => p.filter((_, k) => k !== i))}>Remover</button>
          </div>
        ))}
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
        {minhas.map(({ f, i }) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 6, alignItems: "center" }}>
            <span className="detalhe" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{f.arquivo.name}</span>
            <input style={campo} placeholder="Legenda da figura" value={f.legenda}
              onChange={(e) => setFotos((p) => p.map((x, k) => k === i ? { ...x, legenda: e.target.value } : x))} />
            <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
              onClick={() => setFotos((p) => p.filter((_, k) => k !== i))}>Remover</button>
          </div>
        ))}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="detalhe" style={{ margin: 0 }}>
          Preenche o modelo oficial da ASP mantendo timbre, cabeçalho e rodapé. Formatação conforme
          ABNT (NBR 14724): Arial 12, entrelinha 1,5, texto justificado, margens 3/2/3/2 cm e legendas
          de figura em Arial 10. {qtdOcultos > 0 && <strong>{qtdOcultos} tópico(s) oculto(s) — os demais são renumerados.</strong>}
        </p>

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
                {PROCEDIMENTOS.map((p) => <option key={p.codigo} value={p.codigo}>{p.nome}</option>)}
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
            <div><label style={rotulo}>Contato</label>
              <input style={campo} value={d.contato || ""} onChange={set("contato")} /></div>
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
            <textarea style={{ ...campo, minHeight: 56 }} value={d.observacoesTanque || ""} onChange={set("observacoesTanque")} /></div>
        </> })}

        {Topico({ numero: 3, titulo: "Métodos", children: <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn-dl btn-sec" disabled={!proc} onClick={aplicarSugestao}>
              ✨ Usar sugestão do procedimento
            </button>
            <span className="detalhe" style={{ margin: 0 }}>
              {proc ? `Baseada em ${proc.codigo} — ${proc.nome}.` : "Escolha o procedimento na capa para habilitar a sugestão."}
            </span>
          </div>
          <textarea style={{ ...campo, minHeight: 110 }} value={d.metodos || ""} onChange={set("metodos")}
            placeholder="Descreva o método de inspeção empregado." />
        </> })}

        {Topico({ numero: 4, titulo: "Equipamentos utilizados", children: <>
          <label style={rotulo}>
            Equipamentos {proc ? <span className="detalhe">— sugeridos por {proc.codigo}</span> : null}
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 6 }}>
            {EQUIPAMENTOS.map((eq) => (
              <label key={eq.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={equipIds.includes(eq.id)} style={{ marginTop: 3 }}
                  onChange={(e) => alternarEquipamento(eq.id, e.target.checked)} />
                <span>{eq.nome}<span className="detalhe" style={{ display: "block" }}>{eq.especificacao}</span></span>
              </label>
            ))}
          </div>
          <label style={rotulo}>Texto que irá para o relatório</label>
          <textarea style={{ ...campo, minHeight: 80 }} value={d.equipamentos || ""} onChange={set("equipamentos")} />
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

        {Topico({ numero: 8, titulo: "Imagens do fundo do tanque", maxFotos: 5, legendaFoto: "Imagem do fundo do tanque" })}

        {Topico({ numero: 9, titulo: "Observações", maxFotos: 5, legendaFoto: "Observação", children: <>
          <textarea style={{ ...campo, minHeight: 60 }} value={d.observacoes || ""} onChange={set("observacoes")} />
        </> })}

        {Topico({ numero: 10, titulo: "Conclusão", children: <>
          <textarea style={{ ...campo, minHeight: 76 }} value={d.conclusao || ""} onChange={set("conclusao")} />
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
          <button className="btn-azul btn-sec" onClick={onFechar} disabled={gerando}>Cancelar</button>
          <button className="btn-azul" onClick={gerar} disabled={gerando}>
            {gerando ? "Gerando…" : "Gerar e baixar (.docx)"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
