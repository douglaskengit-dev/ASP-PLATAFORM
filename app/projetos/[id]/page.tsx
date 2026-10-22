"use client";

/** ASP — Detalhe do Projeto: informações + lista de Ordens de Serviço (OS =
 * gp_inspecoes, uma por tanque/ponto). A OS nasce na fase 2 (Agendamento).
 * Regras da criação em lib/validacao/ordemServico.ts — as mesmas que a API
 * repete: identificação única no projeto, procedimento obrigatório e tanque
 * completo; OS de mesmo nome na lixeira oferece "Restaurar". Ver COWORK-ASP.md §2. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { descreverAcaoFase, tituloFase, ULTIMA_FASE } from "@/lib/asp/fases";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";
import FormularioTanque from "@/app/components/FormularioTanque";
import FormularioProjeto from "@/app/components/FormularioProjeto";
import Rdos from "@/app/components/Rdos";
import { resumoTanque, TANQUE_FORM_VAZIO, type Tanque, type TanqueForm } from "@/lib/asp/tanque";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import {
  identificacaoRepetida, mesclar, novoResultado, ResultadoValidacao, ROTULOS_OS, temErros, validarOS,
} from "@/lib/validacao";

interface Cliente {
  id: string;
  razao_social: string;
  cidade?: string | null;
  uf?: string | null;
  cnpj?: string | null;
}
interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  endereco: string | null;
  responsavel_projeto: string | null;
  data_abertura: string;
  cliente: Cliente | null;
}
interface Inspecao {
  id: string;
  identificacao: string;
  fase: number;
  ferramenta_coleta: string;
  /** Cadastro do tanque: dimensões, capacidade e material. */
  tanque?: Tanque | null;
  agendamentos?: { data_visita: string | null; hora: string | null; tipo: string; a_definir?: boolean; substituido_em?: string | null }[];
  ultima_acao?: {
    acao: string; fase_de: number; fase_para: number;
    data_autenticacao: string | null; criado_em: string;
    autor_perfil: { nome_completo: string | null; email: string | null } | null;
  } | null;
}

/** Próxima visita entre os agendamentos ATIVOS (remarcados ficam de fora);
 * sem nenhuma data, "data a definir" se houver um pendente. */
function proximaData(ins: Inspecao): string | null {
  const ativos = (ins.agendamentos || []).filter((a) => !a.substituido_em);
  const datas = ativos.filter((a) => a.data_visita).sort((a, b) => (a.data_visita! < b.data_visita! ? -1 : 1));
  if (datas.length === 0) return ativos.some((a) => a.a_definir) ? "data a definir" : null;
  const hoje = new Date().toISOString().slice(0, 10);
  const futura = datas.find((a) => (a.data_visita || "") >= hoje) || datas[datas.length - 1];
  const d = new Date(`${futura.data_visita}T00:00:00`).toLocaleDateString("pt-BR");
  return `${d}${futura.hora ? " às " + futura.hora : ""}`;
}

export default function ProjetoDetalhePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [podeExcluir, setPodeExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [verLixeiraInsp, setVerLixeiraInsp] = useState(false);
  const [inspLixeira, setInspLixeira] = useState<Inspecao[]>([]);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [inspecoes, setInspecoes] = useState<Inspecao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [identificacao, setIdentificacao] = useState("");
  // Procedimento do Catálogo: define o formato do relatório desta inspeção.
  const [procedimento, setProcedimento] = useState("");
  const [procedimentos, setProcedimentos] = useState<any[]>([]);
  // Tanque da inspeção: obrigatório na criação, porque é dele que sai a
  // identificação do tanque em todo relatório gerado depois.
  const [tanque, setTanque] = useState<TanqueForm>({ ...TANQUE_FORM_VAZIO });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Validação da nova OS: erro "obrigatório" só depois de mexer no campo ou
  // tentar criar; o que a API devolveu fica até o usuário mudar algo.
  const [tentou, setTentou] = useState(false);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [servidor, setServidor] = useState<ResultadoValidacao>(novoResultado());
  const [restaurando, setRestaurando] = useState(false);
  // Edição do projeto
  const [modalEdit, setModalEdit] = useState(false);

  function carregar() {
    fetch(`/api/projetos/${id}`)
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (r.status === 404) {
          setNaoEncontrado(true);
          return;
        }
        const d = await r.json();
        setProjeto(d.projeto);
        setInspecoes(d.inspecoes || []);
      })
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
    fetch("/api/catalogo").then((r) => (r.ok ? r.json() : {}))
      .then((d: any) => setProcedimentos(d.procedimentos || [])).catch(() => {});

    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase.from("gp_profiles").select("perfil, funcao").eq("id", data.user.id).single();
      setPodeExcluir(podeExcluirProjeto(p));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function excluirInspecao(iid: string) {
    if (!confirm("Enviar esta OS para a lixeira? Recuperável por 30 dias.")) return;
    const r = await fetch(`/api/inspecoes/${iid}`, { method: "DELETE" });
    if (!r.ok) { setErro((await r.json()).erro || "Falha ao excluir a OS."); return; }
    carregar();
  }
  function abrirLixeiraInsp() {
    fetch(`/api/inspecoes?projetoId=${id}&lixeira=1`).then((r) => r.json()).then((d) => setInspLixeira(d.inspecoes || [])).catch(() => {});
    setVerLixeiraInsp(true);
  }
  async function restaurarInspecao(iid: string) {
    const r = await fetch(`/api/inspecoes/${iid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurar: true }) });
    if (!r.ok) { setErro((await r.json()).erro || "Falha ao restaurar."); return; }
    abrirLixeiraInsp(); carregar();
  }
  async function excluirInspDefinitivo(iid: string) {
    if (!confirm("Excluir DEFINITIVAMENTE esta OS?")) return;
    const r = await fetch(`/api/inspecoes/${iid}?definitivo=1`, { method: "DELETE" });
    if (!r.ok) { setErro((await r.json()).erro || "Falha ao excluir."); return; }
    abrirLixeiraInsp();
  }

  async function excluirProjeto() {
    if (!confirm("Enviar este projeto para a lixeira? Ele fica recuperável por 30 dias e depois é apagado de vez.")) return;
    setExcluindo(true);
    try {
      const r = await fetch(`/api/projetos/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Falha ao excluir."); return; }
      router.push("/projetos");
    } catch {
      setErro("Falha de rede ao excluir.");
    } finally {
      setExcluindo(false);
    }
  }

  /** Abre o formulário da nova OS. A lixeira do projeto entra na checagem
   *  (mesmo nome na lixeira → oferece restaurar em vez de criar outra). */
  function abrirNovaOS() {
    setErro(null);
    setTentou(false);
    setTocados(new Set());
    setServidor(novoResultado());
    fetch(`/api/inspecoes?projetoId=${id}&lixeira=1`).then((r) => (r.ok ? r.json() : {}))
      .then((d: any) => setInspLixeira(d.inspecoes || [])).catch(() => {});
    setModalAberto(true);
  }

  function mudarCampoOS(campo: "identificacao" | "procedimento" | "tanque") {
    setTocados((t) => new Set(t).add(campo));
    setServidor(novoResultado());
  }

  const resultadoOS = useMemo(() => {
    const local = validarOS({ identificacao, procedimento, tanque }, {
      ordens: [
        ...inspecoes.map((i) => ({ id: i.id, identificacao: i.identificacao, tanque: i.tanque })),
        ...inspLixeira.map((i) => ({ id: i.id, identificacao: i.identificacao, tanque: i.tanque, excluido: true })),
      ],
      procedimentos: procedimentos.length ? procedimentos.map((p) => p.codigo).filter(Boolean) : undefined,
    });
    return mesclar(local, servidor);
  }, [identificacao, procedimento, tanque, inspecoes, inspLixeira, procedimentos, servidor]);
  const mostrarOS = (campo: string) => tentou || tocados.has(campo);
  const naLixeira = identificacaoRepetida(identificacao, { ordens: inspLixeira.map((i) => ({ ...i, excluido: true })) }, true);

  async function criarInspecao() {
    setErro(null);
    setTentou(true);
    if (temErros(resultadoOS)) return;
    setSalvando(true);
    try {
      const r = await fetch("/api/inspecoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projetoId: id, identificacao, procedimento, tanque }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.erros) setServidor({ erros: d.erros, avisos: d.avisos || {} });
        setErro(d.erro || "Não foi possível criar a OS.");
        return;
      }
      setInspecoes((prev) => [...prev, d.inspecao]);
      setIdentificacao("");
      setProcedimento("");
      setTanque({ ...TANQUE_FORM_VAZIO });
      setModalAberto(false);
    } catch {
      setErro("Falha de rede ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  /** "Restaurar" a OS de mesmo nome que está na lixeira, no lugar de criar outra. */
  async function restaurarEmVezDeCriar(iid: string) {
    setRestaurando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/inspecoes/${iid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurar: true }) });
      if (!r.ok) { setErro((await r.json().catch(() => ({}))).erro || "Falha ao restaurar."); return; }
      setIdentificacao("");
      setModalAberto(false);
      carregar();
    } finally {
      setRestaurando(false);
    }
  }

  function abrirEdicao() {
    if (!projeto) return;
    setErro(null);
    setModalEdit(true);
  }

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;
  if (naoEncontrado || !projeto)
    return (
      <div className="page-larga">
        <p className="vazio">Projeto não encontrado.</p>
        <Link href="/projetos" style={{ color: "var(--primaria)" }}>← Voltar aos projetos</Link>
      </div>
    );

  return (
    <div className="page-larga">
      <Link href="/projetos" style={{ color: "var(--primaria)", textDecoration: "none", fontSize: 13 }}>
        ← Projetos
      </Link>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>{projeto.codigo_projeto || projeto.pedido_compra || "Projeto"}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-azul btn-sec" onClick={abrirEdicao}>✎ Editar projeto</button>
            {podeExcluir && (
              <button className="btn-azul" style={{ background: "#dc2626" }} onClick={excluirProjeto} disabled={excluindo}>
                {excluindo ? "Excluindo…" : "🗑 Excluir"}
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 14 }}>
          <Campo rotulo="Cliente" valor={projeto.cliente?.razao_social} />
          <Campo
            rotulo="Local"
            valor={projeto.cliente?.cidade ? `${projeto.cliente.cidade}${projeto.cliente.uf ? "/" + projeto.cliente.uf : ""}` : undefined}
          />
          <Campo rotulo="Pedido de compra" valor={projeto.pedido_compra} />
          <Campo rotulo="Endereço da obra" valor={projeto.endereco} />
          <Campo rotulo="Responsável" valor={projeto.responsavel_projeto} />
          <Campo rotulo="Aberto em" valor={formatarData(projeto.data_abertura)} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "22px 0 12px", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--fonte-titulo)", color: "var(--texto)" }}>
          {verLixeiraInsp ? "Ordens de Serviço — Lixeira" : `Ordens de Serviço (${inspecoes.length})`}
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          {podeExcluir && (
            <button className="btn-azul btn-sec" onClick={() => (verLixeiraInsp ? setVerLixeiraInsp(false) : abrirLixeiraInsp())}>
              {verLixeiraInsp ? "← Voltar" : "🗑 Lixeira"}
            </button>
          )}
          {!verLixeiraInsp && (
            <button className="btn-azul" onClick={abrirNovaOS}>+ Nova OS</button>
          )}
        </div>
      </div>

      {verLixeiraInsp ? (
        inspLixeira.length === 0 ? (
          <p className="vazio">A lixeira de OSs está vazia.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {inspLixeira.map((i) => (
              <div key={i.id} className="item" style={{ justifyContent: "space-between" }}>
                <strong style={{ color: "var(--texto)" }}>{i.identificacao} <span className="detalhe" style={{ fontWeight: 400 }}>· fase {i.fase}</span></strong>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn-dl btn-sec" onClick={() => restaurarInspecao(i.id)}>↩ Restaurar</button>
                  <button className="btn-dl" style={{ background: "#dc2626" }} onClick={() => excluirInspDefinitivo(i.id)}>Excluir definitivamente</button>
                </span>
              </div>
            ))}
          </div>
        )
      ) : inspecoes.length === 0 ? (
        <p className="vazio">Nenhuma OS. Adicione um tanque/ponto para iniciar o fluxo.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {inspecoes.map((i) => {
            const pct = Math.round(((i.fase - 1) / (ULTIMA_FASE - 1)) * 100);
            const data = proximaData(i);
            return (
              <div key={i.id} style={{ position: "relative" }}>
                <Link href={`/inspecoes/${i.id}`} className="item item-col" style={{ textDecoration: "none", color: "inherit" }}>
                  <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingRight: podeExcluir ? 28 : 0 }}>
                    <strong style={{ color: "var(--texto)" }}>{i.identificacao}</strong>
                    <span className="detalhe" style={{ margin: 0 }}>Fase {i.fase} · {tituloFase(i.fase)}</span>
                  </div>
                  {i.tanque && <span className="detalhe" style={{ margin: "4px 0 0" }}>🛢 {resumoTanque(i.tanque)}</span>}
                  {data && <span className="detalhe" style={{ margin: "4px 0 0" }}>📅 Agendada: {data}</span>}
                  {i.ultima_acao && (
                    <span className="detalhe" style={{ margin: "2px 0 0" }}>
                      🕀 {descreverAcaoFase(i.ultima_acao.acao, i.ultima_acao.fase_de, i.ultima_acao.fase_para)} · por {i.ultima_acao.autor_perfil?.nome_completo || i.ultima_acao.autor_perfil?.email || "usuário"}
                      {" · "}{formatarDataHora(i.ultima_acao.data_autenticacao || i.ultima_acao.criado_em)}
                    </span>
                  )}
                  <div className="fu-progresso" style={{ marginTop: 10 }} title={`Fase ${i.fase} de ${ULTIMA_FASE}`}>
                    <div className="fu-barra" style={{ width: `${pct}%` }} />
                  </div>
                </Link>
                {podeExcluir && (
                  <button className="fu-icone-btn lixeira" title="Excluir OS (lixeira)"
                    onClick={() => excluirInspecao(i.id)}
                    style={{ position: "absolute", top: 12, right: 12 }}>🗑</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* RDOs do projeto (um por dia) — consulta e download. São criados e
          editados na inspeção, durante a Execução. */}
      {!verLixeiraInsp && (
        <Rdos projetoId={projeto.id} somenteLeitura
          codigoProjeto={projeto.codigo_projeto || projeto.pedido_compra}
          cliente={projeto.cliente?.razao_social} clienteId={projeto.cliente?.id} />
      )}

      {modalEdit && (
        <Modal titulo="Editar projeto" onFechar={() => setModalEdit(false)}>
          {/* Mesmas regras da abertura (lib/validacao/projeto.ts). */}
          <FormularioProjeto
            modo="editar"
            projetoId={id}
            clienteAtualNome={projeto.cliente?.razao_social}
            inicial={{
              clienteId: projeto.cliente?.id || "",
              codigoProjeto: projeto.codigo_projeto || "",
              pedidoCompra: projeto.pedido_compra || "",
              endereco: projeto.endereco || "",
              responsavelProjeto: projeto.responsavel_projeto || "",
              dataAbertura: projeto.data_abertura || "",
            }}
            onCancelar={() => setModalEdit(false)}
            onSalvo={() => { setModalEdit(false); carregar(); }}
          />
        </Modal>
      )}

      {modalAberto && (
        <Modal titulo="Nova Ordem de Serviço (OS)" onFechar={() => setModalAberto(false)}>
          <div className="form-projeto" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Identificação *</label>
              <input
                value={identificacao}
                maxLength={160}
                onChange={(e) => { setIdentificacao(e.target.value); mudarCampoOS("identificacao"); }}
                placeholder="ex.: Tanque TQ-01"
                autoFocus
                className={mostrarOS("identificacao") && resultadoOS.erros.identificacao ? "val-invalido" : undefined}
                onKeyDown={(e) => { if (e.key === "Enter") criarInspecao(); }}
              />
              <MensagensCampo r={resultadoOS} campo="identificacao" mostrarErros={mostrarOS("identificacao") || !!identificacao.trim()}>
                {naLixeira && podeExcluir && !(resultadoOS.erros.identificacao || []).length && (
                  <button type="button" className="val-acao" disabled={restaurando} onClick={() => restaurarEmVezDeCriar(naLixeira.id)}>
                    {restaurando ? "Restaurando…" : `↩ Restaurar “${naLixeira.identificacao}”`}
                  </button>
                )}
              </MensagensCampo>
              <small style={{ color: "var(--cinza)" }}>
                Única no projeto — “TQ-01”, “tq 01” e “TQ01” contam como a mesma. A OS começa na fase 2 (Agendamento).
              </small>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Procedimento *</label>
              <select value={procedimento} onChange={(e) => { setProcedimento(e.target.value); mudarCampoOS("procedimento"); }}
                className={mostrarOS("procedimento") && resultadoOS.erros.procedimento ? "val-invalido" : undefined}>
                <option value="">— selecione —</option>
                {procedimentos.map((p) => (
                  <option key={p.id} value={p.codigo || ""} disabled={!p.codigo}>
                    {p.codigo ? `${p.codigo} — ${p.nome}` : `${p.nome} (sem código — corrija no Catálogo)`}
                  </option>
                ))}
              </select>
              <MensagensCampo r={resultadoOS} campo="procedimento" mostrarErros={mostrarOS("procedimento")} />
              <small style={{ color: "var(--cinza)" }}>
                Define o formato do relatório (tópicos, seções e modelo). Pode ser trocado depois, na OS.
              </small>
            </div>
            {/* Tanque: cadastrado aqui uma vez e reaproveitado por todo
                relatório desta inspeção. */}
            <div style={{ borderTop: "1px solid var(--borda)", paddingTop: 12 }}>
              <strong style={{ fontSize: 13 }}>Tanque</strong>
              <p className="detalhe" style={{ margin: "2px 0 10px" }}>
                Dimensões, capacidade e material — saem na identificação do tanque de todo relatório desta OS.
              </p>
              <FormularioTanque valor={tanque} onChange={(t) => { setTanque(t); mudarCampoOS("tanque"); }} desabilitado={salvando} />
              <MensagensCampo r={resultadoOS} campo="tanque" mostrarErros={tentou} />
            </div>
            {/* Resumo só depois de tentar criar — antes, as mensagens ficam nos campos. */}
            {tentou && <ResumoValidacao r={resultadoOS} rotulos={ROTULOS_OS} />}
            {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              <button className="btn-azul" onClick={criarInspecao} disabled={salvando || (tentou && temErros(resultadoOS))}>{salvando ? "Criando…" : "Criar OS"}</button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div>
      <span style={{ fontSize: 12, color: "var(--cinza)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{rotulo}</span>
      <div style={{ color: "var(--texto)", fontWeight: 500 }}>{valor || "—"}</div>
    </div>
  );
}

function formatarData(iso?: string) {
  if (!iso) return undefined;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("pt-BR");
}

function formatarDataHora(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
