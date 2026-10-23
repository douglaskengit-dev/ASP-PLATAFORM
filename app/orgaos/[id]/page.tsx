"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Contato, NovoContatoInput, OrgaoComContatos, TipoEnte, UFS_BRASIL } from "@/lib/orgaos/types";
import { mascaraCnpj, mascaraTelefone } from "@/lib/mascaras";
import { ULTIMA_FASE } from "@/lib/asp/fases";
import { SugestoesCidade, useCidadesDaUf, useClientesConflitantes } from "@/app/components/FormularioOrgao";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import AvisoCliente from "@/app/components/AvisoCliente";
import {
  mesclar, normalizarCidade, normalizarCnpj, normalizarEspacos, novoResultado, ResultadoValidacao, ROTULOS_CLIENTE,
  temErros, validarCliente, validarContato,
} from "@/lib/validacao";

interface ProjetoCliente {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  cliente: { id: string } | null;
  inspecoes: { id: string; fase: number }[];
}

/** Formulário de contato: novo (sem id) ou edição de um existente. */
type FormContato = NovoContatoInput & { id?: string; versao?: string };

function novoContatoVazio(): FormContato {
  return { nomeCompleto: "", cargo: "", telefone: "", email: "" };
}

type Msg = { tipo: "ok" | "erro"; texto: string; recarregar?: boolean };

export default function OrgaoDetalhePage() {
  const params = useParams<{ id: string }>();

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [orgao, setOrgao] = useState<OrgaoComContatos | null>(null);
  const [projetos, setProjetos] = useState<ProjetoCliente[]>([]);
  const [podeExcluirContato, setPodeExcluirContato] = useState(false);

  const [editando, setEditando] = useState(false);
  const [tipoEnte, setTipoEnte] = useState<TipoEnte>("Município");
  const [razaoSocial, setRazaoSocial] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [cidade, setCidade] = useState("");
  const [endereco, setEndereco] = useState("");
  const [uf, setUf] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [mensagemEdicao, setMensagemEdicao] = useState<Msg | null>(null);

  const [contatoForm, setContatoForm] = useState<FormContato | null>(null);
  const [salvandoContato, setSalvandoContato] = useState(false);
  const [mensagemContato, setMensagemContato] = useState<Msg | null>(null);
  /** Mensagem por contato da lista (desativar/excluir/em uso). */
  const [mensagemLinha, setMensagemLinha] = useState<{ id: string; texto: string; emUso?: boolean } | null>(null);

  // Validação (lib/validacao/cliente.ts) — as mesmas regras da API.
  const [tentouEdicao, setTentouEdicao] = useState(false);
  const [servidorEdicao, setServidorEdicao] = useState<ResultadoValidacao>(novoResultado());
  const [tentouContato, setTentouContato] = useState(false);
  const [servidorContato, setServidorContato] = useState<ResultadoValidacao>(novoResultado());
  const conflitantes = useClientesConflitantes(editando ? cnpj : "", editando ? razaoSocial : "", params.id);
  const cidadesUf = useCidadesDaUf(editando ? uf : "", params.id);
  const resultadoEdicao = useMemo(
    () => mesclar(
      validarCliente(
        { razaoSocial, cnpj, cidade, uf, endereco },
        { clientes: conflitantes, excluirId: params.id, cidades: cidadesUf, razaoSocialAtual: orgao?.razao_social }
      ),
      servidorEdicao
    ),
    [razaoSocial, cnpj, cidade, uf, endereco, conflitantes, cidadesUf, params.id, orgao?.razao_social, servidorEdicao]
  );
  // Desativados contam para repetidos (a mensagem sugere reativar).
  const existentesContato = useMemo(
    () => (orgao?.contatos || []).map((c) => ({ id: c.id, nome_completo: c.nome_completo, email: c.email, ativo: c.ativo !== false })),
    [orgao]
  );
  const resultadoContato = useMemo(
    () => contatoForm ? mesclar(validarContato(contatoForm, existentesContato), servidorContato) : novoResultado(),
    [contatoForm, existentesContato, servidorContato]
  );

  function preencherEdicao(o: OrgaoComContatos) {
    setTipoEnte(o.tipo_ente);
    setRazaoSocial(o.razao_social);
    setCnpj(mascaraCnpj(o.cnpj || ""));
    setCidade(o.cidade);
    setEndereco((o as any).endereco || "");
    setUf(o.uf);
  }

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch(`/api/orgaos/${params.id}`);
      const dados = await resp.json();
      if (!resp.ok || !dados.ok) throw new Error(dados.erro || "Falha ao carregar o cliente.");
      setOrgao(dados.orgao);
      preencherEdicao(dados.orgao);
      setPodeExcluirContato(["admin", "comercial", "gerencia"].includes(dados.perfil));

      // Projetos deste cliente (novo fluxo)
      const rp = await fetch("/api/projetos");
      if (rp.ok) {
        const dp = await rp.json();
        setProjetos((dp.projetos || []).filter((p: ProjetoCliente) => p.cliente?.id === params.id));
      }
    } catch (err: any) {
      setErro(err.message || "Erro ao carregar o cliente.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function recarregarTudo() {
    setMensagemEdicao(null);
    setMensagemContato(null);
    setEditando(false);
    setContatoForm(null);
    await carregar();
  }

  async function salvarEdicao() {
    setMensagemEdicao(null);
    setTentouEdicao(true);
    if (temErros(resultadoEdicao)) {
      setMensagemEdicao({ tipo: "erro", texto: "Corrija os campos marcados com ⛔." });
      return;
    }

    setSalvandoEdicao(true);
    try {
      const resp = await fetch(`/api/orgaos/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipoEnte, razaoSocial, cnpj, cidade, uf, endereco, versao: orgao?.updated_at }),
      });
      const dados = await resp.json();
      if (!resp.ok || !dados.ok) {
        if (dados.conflitoVersao) {
          setMensagemEdicao({ tipo: "erro", texto: `⛔ ${dados.erro}`, recarregar: true });
          return;
        }
        if (dados.erros) setServidorEdicao({ erros: dados.erros, avisos: dados.avisos || {} });
        throw new Error(dados.erro || "Falha ao salvar.");
      }
      setOrgao((prev) => (prev ? { ...prev, ...dados.orgao } : prev));
      preencherEdicao({ ...(orgao as OrgaoComContatos), ...dados.orgao });
      setEditando(false);
      setTentouEdicao(false);
    } catch (err: any) {
      setMensagemEdicao({ tipo: "erro", texto: err.message || "Erro inesperado ao salvar." });
    } finally {
      setSalvandoEdicao(false);
    }
  }

  function abrirEdicaoContato(c: Contato) {
    setMensagemContato(null);
    setMensagemLinha(null);
    setTentouContato(false);
    setServidorContato(novoResultado());
    setContatoForm({ id: c.id, versao: c.updated_at, nomeCompleto: c.nome_completo, cargo: c.cargo, telefone: c.telefone || "", email: c.email });
  }

  async function salvarContato(confirmarRenomeacao = false) {
    if (!contatoForm) return;
    setMensagemContato(null);
    setTentouContato(true);
    if (temErros(resultadoContato)) return;
    setSalvandoContato(true);
    try {
      const editar = !!contatoForm.id;
      const { id, versao, ...campos } = contatoForm;
      const resp = await fetch(editar ? `/api/orgaos/${params.id}/contatos/${id}` : `/api/orgaos/${params.id}/contatos`, {
        method: editar ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editar ? { ...campos, versao, confirmarRenomeacao } : campos),
      });
      const dados = await resp.json();
      if (resp.status === 409 && dados.precisaConfirmar) {
        // Contato responsável de projetos: confirma vendo quantos mudam.
        setSalvandoContato(false);
        if (confirm(`⚠️ ${dados.texto}\n\nSalvar e atualizar o responsável desses projetos?`)) await salvarContato(true);
        return;
      }
      if (!resp.ok || !dados.ok) {
        if (dados.conflitoVersao) {
          setMensagemContato({ tipo: "erro", texto: `⛔ ${dados.erro}`, recarregar: true });
          return;
        }
        if (dados.erros) setServidorContato({ erros: dados.erros, avisos: dados.avisos || {} });
        throw new Error(dados.erro || "Falha ao salvar o contato.");
      }

      const salvo = dados.contato as Contato;
      setOrgao((prev) => (prev ? {
        ...prev,
        contatos: editar ? prev.contatos.map((c) => (c.id === salvo.id ? salvo : c)) : [...prev.contatos, salvo],
      } : prev));
      setContatoForm(null);
      setTentouContato(false);
      const n = dados.renomeacao?.projetos || 0;
      if (n > 0) {
        setMensagemLinha({ id: salvo.id, texto: `✓ Contato salvo — responsável atualizado em ${n} projeto${n === 1 ? "" : "s"}.` });
      }
    } catch (err: any) {
      setMensagemContato({ tipo: "erro", texto: err.message || "Erro inesperado ao salvar o contato." });
    } finally {
      setSalvandoContato(false);
    }
  }

  async function alternarAtivo(c: Contato) {
    const desativar = c.ativo !== false;
    if (desativar && !confirm(`Desativar “${c.nome_completo}”? Ele some das novas escolhas (projetos, entregas, RDOs) e continua aparecendo onde já foi usado. Dá para reativar depois.`)) return;
    setMensagemLinha(null);
    const resp = await fetch(`/api/orgaos/${params.id}/contatos/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: desativar ? "desativar" : "reativar" }),
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok || !dados.ok) {
      setMensagemLinha({ id: c.id, texto: `⛔ ${dados.erro || "Falha ao alterar o contato."}` });
      return;
    }
    setOrgao((prev) => (prev ? { ...prev, contatos: prev.contatos.map((x) => (x.id === c.id ? dados.contato : x)) } : prev));
  }

  async function excluirContato(c: Contato) {
    if (!confirm(`Excluir “${c.nome_completo}” de vez? Só é possível se ele não for usado em nenhum projeto ou entrega.`)) return;
    setMensagemLinha(null);
    const resp = await fetch(`/api/orgaos/${params.id}/contatos/${c.id}`, { method: "DELETE" });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok || !dados.ok) {
      setMensagemLinha({ id: c.id, texto: `⛔ ${dados.erro || "Falha ao excluir o contato."}`, emUso: !!dados.emUso });
      return;
    }
    setOrgao((prev) => (prev ? { ...prev, contatos: prev.contatos.filter((x) => x.id !== c.id) } : prev));
  }

  if (carregando) {
    return (
      <main>
        <div className="page">
          <p>Carregando...</p>
        </div>
      </main>
    );
  }

  if (!orgao) {
    return (
      <main>
        <div className="page">
          <p className="msg erro">{erro || "Cliente não encontrado."}</p>
          <Link href="/orgaos">← voltar aos clientes</Link>
        </div>
      </main>
    );
  }

  const ativos = orgao.contatos.filter((c) => c.ativo !== false).length;
  const desativados = orgao.contatos.length - ativos;

  const botaoRecarregar = (
    <button type="button" className="btn secondary" style={{ marginLeft: 8 }} onClick={recarregarTudo}>Recarregar</button>
  );

  return (
    <main>
      <header className="topo">
        <h1>
          {orgao.razao_social} — {orgao.cidade}/{orgao.uf}
        </h1>
        <p>Cliente</p>
      </header>

      <div className="page">
        <p style={{ marginBottom: 20 }}>
          <Link href="/orgaos">← voltar aos clientes</Link>
        </p>

        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2>Dados do cliente</h2>
            <button className="btn secondary" onClick={() => {
              if (editando) { preencherEdicao(orgao); setTentouEdicao(false); setServidorEdicao(novoResultado()); setMensagemEdicao(null); }
              setEditando((v) => !v);
            }}>
              {editando ? "Cancelar" : "Editar cadastro"}
            </button>
          </div>

          {!editando ? (
            <p style={{ overflowWrap: "anywhere" }}>
              <strong>Razão social:</strong> {orgao.razao_social}
              <br />
              <strong>CNPJ:</strong> {mascaraCnpj(orgao.cnpj)}
              <br />
              <strong>Cidade/UF:</strong> {orgao.cidade}/{orgao.uf}
              <br />
              <strong>Endereço:</strong> {(orgao as any).endereco || "— não informado"}
              <br />
              <strong>Cadastrado em:</strong> {new Date(orgao.created_at).toLocaleString("pt-BR")}
            </p>
          ) : (
            <div style={{ borderTop: "1px solid #d8dee3", marginTop: 12, paddingTop: 12 }}>
              <div className="grid">
                <div className="field">
                  <label>Razão social / Nome *</label>
                  <input value={razaoSocial} onChange={(e) => { setRazaoSocial(e.target.value); setServidorEdicao(novoResultado()); }}
                    onBlur={() => setRazaoSocial((v) => normalizarEspacos(v))} />
                  <MensagensCampo r={resultadoEdicao} campo="razaoSocial" mostrarErros={tentouEdicao || !!razaoSocial.trim()} />
                </div>
                <div className="field">
                  <label>CNPJ *</label>
                  <input
                    value={cnpj}
                    onChange={(e) => { setCnpj(mascaraCnpj(e.target.value)); setServidorEdicao(novoResultado()); }}
                    placeholder="00.000.000/0000-00"
                    inputMode="numeric"
                    maxLength={18}
                  />
                  <MensagensCampo r={resultadoEdicao} campo="cnpj" mostrarErros={tentouEdicao || normalizarCnpj(cnpj).length === 14} />
                </div>
                <div className="field">
                  <label>Cidade *</label>
                  <input value={cidade} onChange={(e) => { setCidade(e.target.value); setServidorEdicao(novoResultado()); }}
                    onBlur={() => setCidade((v) => normalizarCidade(v))} />
                  <MensagensCampo r={resultadoEdicao} campo="cidade" mostrarErros={tentouEdicao}>
                    <SugestoesCidade cidade={cidade} cidades={cidadesUf} onUsar={setCidade} />
                  </MensagensCampo>
                </div>
                <div className="field">
                  <label>Endereço</label>
                  <input value={endereco} onChange={(e) => setEndereco(e.target.value)}
                    onBlur={() => setEndereco((v) => normalizarEspacos(v))}
                    placeholder="Rua, número, bairro — sugerido nos projetos deste cliente" />
                  <MensagensCampo r={resultadoEdicao} campo="endereco" />
                </div>
                <div className="field">
                  <label>UF *</label>
                  <select value={uf} onChange={(e) => setUf(e.target.value)}>
                    <option value="">Selecione...</option>
                    {UFS_BRASIL.map((u) => (
                      <option key={u.sigla} value={u.sigla}>
                        {u.sigla} — {u.nome}
                      </option>
                    ))}
                  </select>
                  <MensagensCampo r={resultadoEdicao} campo="uf" mostrarErros={tentouEdicao} />
                </div>
              </div>
              <ResumoValidacao r={resultadoEdicao} rotulos={ROTULOS_CLIENTE} mostrarErros={tentouEdicao} />
              <div className="actions">
                <button className="btn" onClick={salvarEdicao} disabled={salvandoEdicao}>
                  {salvandoEdicao ? "Salvando..." : "Salvar alterações"}
                </button>
                {mensagemEdicao && (
                  <span className={`msg ${mensagemEdicao.tipo}`}>
                    {mensagemEdicao.texto}
                    {mensagemEdicao.recarregar && botaoRecarregar}
                  </span>
                )}
              </div>
            </div>
          )}

          <AvisoCliente clienteId={orgao.id} compacto />
        </section>

        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2>Contatos ({ativos}{desativados ? ` + ${desativados} desativado${desativados === 1 ? "" : "s"}` : ""})</h2>
            {!contatoForm && (
              <button className="btn secondary" onClick={() => { setContatoForm(novoContatoVazio()); setTentouContato(false); setServidorContato(novoResultado()); setMensagemContato(null); }}>
                + Adicionar contato
              </button>
            )}
          </div>

          {orgao.contatos.length === 0 && !contatoForm && (
            <p style={{ color: "#667085", fontSize: 13 }}>Nenhum contato cadastrado ainda.</p>
          )}

          {orgao.contatos.map((c) => {
            const inativo = c.ativo === false;
            return (
              <div key={c.id} className="item-analise item-ok" style={inativo ? { opacity: 0.75 } : undefined}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                    <strong>{c.nome_completo}</strong> — {c.cargo}
                    {inativo && <span className="etapa-badge" style={{ marginLeft: 8, fontSize: 11 }}>desativado</span>}
                    <br />
                    <span style={{ fontSize: 13 }}>
                      {c.email}
                      {c.telefone ? ` · ${c.telefone}` : ""}
                    </span>
                  </div>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {!inativo && (
                      <button type="button" className="btn-dl btn-sec" onClick={() => abrirEdicaoContato(c)} disabled={!!contatoForm}>Editar</button>
                    )}
                    <button type="button" className="btn-dl btn-sec" onClick={() => alternarAtivo(c)}>
                      {inativo ? "Reativar" : "Desativar"}
                    </button>
                    {podeExcluirContato && (
                      <button type="button" className="btn-dl btn-sec" onClick={() => excluirContato(c)}>Excluir</button>
                    )}
                  </span>
                </div>
                {mensagemLinha?.id === c.id && (
                  <div className="val-campo" style={{ marginTop: 6 }}>
                    <p className={`val-msg ${mensagemLinha.texto.startsWith("✓") ? "" : "val-erro"}`}>{mensagemLinha.texto}</p>
                    {mensagemLinha.emUso && !inativo && (
                      <button type="button" className="val-acao" onClick={() => alternarAtivo(c)}>Desativar “{c.nome_completo}”</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {contatoForm && (
            <div className="etapa-card">
              <strong style={{ fontSize: 14 }}>{contatoForm.id ? "Editar contato" : "Novo contato"}</strong>
              <div className="grid">
                <div className="field">
                  <label>Nome completo do responsável *</label>
                  <input
                    value={contatoForm.nomeCompleto}
                    onChange={(e) => { setContatoForm((f) => (f ? { ...f, nomeCompleto: e.target.value } : f)); setServidorContato(novoResultado()); }}
                  />
                  <MensagensCampo r={resultadoContato} campo="nomeCompleto" mostrarErros={tentouContato || !!contatoForm.nomeCompleto.trim()} />
                </div>
                <div className="field">
                  <label>Cargo *</label>
                  <input
                    value={contatoForm.cargo}
                    onChange={(e) => setContatoForm((f) => (f ? { ...f, cargo: e.target.value } : f))}
                  />
                  <MensagensCampo r={resultadoContato} campo="cargo" mostrarErros={tentouContato} />
                </div>
                <div className="field">
                  <label>Telefone (com DDD)</label>
                  <input
                    value={contatoForm.telefone || ""}
                    onChange={(e) =>
                      setContatoForm((f) => (f ? { ...f, telefone: mascaraTelefone(e.target.value) } : f))
                    }
                    placeholder="(11) 91234-5678"
                    inputMode="numeric"
                    maxLength={15}
                  />
                  <MensagensCampo r={resultadoContato} campo="telefone" />
                </div>
                <div className="field">
                  <label>E-mail *</label>
                  <input
                    type="email"
                    value={contatoForm.email}
                    onChange={(e) => { setContatoForm((f) => (f ? { ...f, email: e.target.value } : f)); setServidorContato(novoResultado()); }}
                  />
                  <MensagensCampo r={resultadoContato} campo="email" mostrarErros={tentouContato || !!contatoForm.email.trim()} />
                </div>
              </div>
              {contatoForm.id && (
                <p className="detalhe" style={{ margin: "0 0 8px" }}>
                  Mudar o nome atualiza o responsável dos projetos deste cliente (você confirma antes). RDOs, relatórios e entregas já registrados mantêm o nome antigo.
                </p>
              )}
              <div className="actions">
                <button className="btn" onClick={() => salvarContato()} disabled={salvandoContato}>
                  {salvandoContato ? "Salvando..." : "Salvar contato"}
                </button>
                <button className="btn secondary" onClick={() => { setContatoForm(null); setTentouContato(false); setMensagemContato(null); }}>
                  Cancelar
                </button>
                {mensagemContato && (
                  <span className={`msg ${mensagemContato.tipo}`}>
                    {mensagemContato.texto}
                    {mensagemContato.recarregar && botaoRecarregar}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2>Projetos deste cliente ({projetos.length})</h2>
            <Link href="/projetos" className="btn secondary" style={{ display: "inline-block", textDecoration: "none" }}>
              + Novo projeto
            </Link>
          </div>

          {projetos.length === 0 ? (
            <p style={{ color: "var(--cinza)", fontSize: 13 }}>Nenhum projeto aberto para este cliente ainda.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {projetos.map((p) => {
                const fases = p.inspecoes.map((i) => i.fase);
                const media = fases.length ? fases.reduce((a, b) => a + b, 0) / fases.length : 1;
                const pct = Math.round(((media - 1) / (ULTIMA_FASE - 1)) * 100);
                return (
                  <Link key={p.id} href={`/projetos/${p.id}`} className="item item-col" style={{ textDecoration: "none", color: "inherit" }}>
                    <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <strong style={{ fontSize: 13 }}>{p.codigo_projeto || p.pedido_compra || "Projeto"}</strong>
                      <span className="detalhe" style={{ margin: 0 }}>{p.inspecoes.length} OS{p.inspecoes.length === 1 ? "" : "s"} · {pct}%</span>
                    </div>
                    <div className="fu-progresso" style={{ marginTop: 8 }}>
                      <div className="fu-barra" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
