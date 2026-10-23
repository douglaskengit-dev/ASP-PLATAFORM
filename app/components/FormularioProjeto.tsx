"use client";

/** Formulário do projeto (Fase 1) — abrir e editar. Regras em
 * lib/validacao/projeto.ts, as mesmas que a API repete ao salvar:
 *
 *  - Código sugerido pelo servidor (NN/INICIAIS/AA, sequência do ano) e
 *    editável; repetido (inclusive lixeira) bloqueia.
 *  - Contato: depois do cliente, pergunta "Usar dados do contato?". Sim →
 *    escolhe o contato e "Usar como está" / "Atualizar contato" / "+ Novo
 *    contato" (gravados no cadastro do cliente). Não → digita livre, com
 *    sugestão se o nome parecer um contato existente.
 *  - "Haverá inspeção?" (Sim/Não): padrão das OSs do projeto. Nasce da regra
 *    do cliente recorrente (recorrente + já tem projeto ativo → Não; senão
 *    Sim) e segue a troca de cliente até o usuário escolher.
 *  - Nada do que o usuário digitou é sobrescrito sem ele clicar. */
import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/app/components/Modal";
import FormularioOrgao from "@/app/components/FormularioOrgao";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import { mascaraTelefone } from "@/lib/mascaras";
import {
  ContextoProjeto, DadosContato, hojeBrasil, mesclar, normalizarCodigoProjeto, novoResultado,
  ResultadoValidacao, ROTULOS_PROJETO, temErros, validarContato, validarProjeto, contatosParecidos, contatosAtivos,
} from "@/lib/validacao";

interface Orgao {
  id: string;
  razao_social: string;
  cidade?: string | null;
  uf?: string | null;
  /** Endereço padrão do cliente — sugerido como endereço da obra. */
  endereco?: string | null;
}
interface Contato {
  id: string;
  nome_completo: string;
  cargo: string;
  telefone: string | null;
  email: string;
  /** false = desativado: não aparece para nova escolha. */
  ativo?: boolean;
  /** Versão do contato (concorrência ao "Atualizar contato"). */
  updated_at?: string;
}

export interface DadosFormProjeto {
  clienteId: string;
  codigoProjeto: string;
  pedidoCompra: string;
  endereco: string;
  responsavelProjeto: string;
  dataAbertura: string;
  /** "Haverá inspeção?" — padrão das OSs novas do projeto. */
  comInspecaoPadrao?: boolean;
}

/** O que /api/projetos/verificar diz da recorrência do cliente escolhido. */
interface RecorrenciaCliente {
  recorrente: boolean;
  periodicidadeMeses: number | null;
  projetosAtivos: number;
  inspecaoPadrao: boolean;
}

const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 };

/** Contexto do banco (/api/projetos/verificar), com debounce e descartando
 *  respostas fora de ordem. */
function useVerificacao(codigo: string, clienteId: string, excluirId?: string) {
  const [ctx, setCtx] = useState<Partial<ContextoProjeto> & { recorrencia?: RecorrenciaCliente }>({});
  const seq = useRef(0);
  const cod = normalizarCodigoProjeto(codigo);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ codigo: cod, clienteId, excluirId: excluirId || "" });
      fetch(`/api/projetos/verificar?${q}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && n === seq.current) setCtx(d); })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [cod, clienteId, excluirId]);
  return ctx;
}

export default function FormularioProjeto({ modo, projetoId, inicial, clienteAtualNome, onSalvo, onCancelar }: {
  modo: "novo" | "editar";
  projetoId?: string;
  inicial?: Partial<DadosFormProjeto>;
  /** Nome do cliente atual (edição) — aparece mesmo se ele foi para a lixeira. */
  clienteAtualNome?: string | null;
  onSalvo: (projeto: any) => void;
  onCancelar: () => void;
}) {
  const [form, setForm] = useState<DadosFormProjeto>({
    clienteId: "", codigoProjeto: "", pedidoCompra: "", endereco: "", responsavelProjeto: "",
    dataAbertura: hojeBrasil(), ...inicial,
  });
  const [orgaos, setOrgaos] = useState<Orgao[]>([]);
  const [cadastrarOrgao, setCadastrarOrgao] = useState(false);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [carregandoContatos, setCarregandoContatos] = useState(false);
  /** "Usar dados do contato do cliente?" — null = ainda não respondeu. */
  const [usarContato, setUsarContato] = useState<boolean | null>(modo === "editar" ? false : null);
  const [contatoSel, setContatoSel] = useState("");
  const [contatoUsado, setContatoUsado] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ modo: "novo" | "editar"; dados: DadosContato; servidor?: ResultadoValidacao } | null>(null);
  const [salvandoContato, setSalvandoContato] = useState(false);
  /** Valores postos pelo sistema (não digitados) — só esses podem ser limpos sozinhos. */
  const auto = useRef<{ codigo?: string; responsavel?: string; endereco?: string }>({});
  const [sugestao, setSugestao] = useState<{ codigo: string; iniciais: string } | null>(null);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [tentou, setTentou] = useState(false);
  const [servidor, setServidor] = useState<ResultadoValidacao>(novoResultado());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** "Haverá inspeção?": null = segue o padrão do cliente (ainda não escolheu). */
  const [comInspecao, setComInspecao] = useState<boolean | null>(
    modo === "editar" && typeof inicial?.comInspecaoPadrao === "boolean" ? inicial.comInspecaoPadrao : null,
  );

  const ctxBanco = useVerificacao(form.codigoProjeto, form.clienteId, projetoId);
  const hoje = hojeBrasil();
  const recorrencia = form.clienteId && ctxBanco.recorrencia ? ctxBanco.recorrencia : null;
  /** Valor em vigor: o escolhido, senão a regra do cliente (Sim sem cliente). */
  const inspecaoEfetiva = comInspecao ?? (recorrencia ? recorrencia.inspecaoPadrao : true);

  useEffect(() => {
    fetch("/api/orgaos").then((r) => r.json()).then((d) => setOrgaos(d.orgaos || [])).catch(() => {});
    if (inicial?.clienteId) carregarContatos(inicial.clienteId, modo === "editar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sugestão de código (só na abertura): recalcula quando muda a data. Só
  // entra no campo se ele está vazio ou ainda com a sugestão anterior.
  useEffect(() => {
    if (modo !== "novo") return;
    fetch(`/api/projetos/proximo-codigo?data=${form.dataAbertura}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.codigo) return;
        setSugestao({ codigo: d.codigo, iniciais: d.iniciais });
        setForm((f) => {
          if (f.codigoProjeto.trim() && f.codigoProjeto !== auto.current.codigo) return f;
          auto.current.codigo = d.codigo;
          return { ...f, codigoProjeto: d.codigo };
        });
      })
      .catch(() => {});
  }, [modo, form.dataAbertura]);

  function atualizar(campo: keyof DadosFormProjeto, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setTocados((t) => new Set(t).add(campo));
    setServidor(novoResultado());
  }

  function carregarContatos(clienteId: string, edicao = false) {
    setContatos([]);
    if (!clienteId) return;
    setCarregandoContatos(true);
    fetch(`/api/orgaos/${clienteId}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: any) => {
        const todos: Contato[] = d.orgao?.contatos || [];
        // Desativados não entram em escolha nova (a edição ainda resolve o atual).
        const lista = contatosAtivos(todos);
        setContatos(todos);
        if (d.orgao?.endereco) {
          setOrgaos((p) => p.map((o) => (o.id === clienteId ? { ...o, endereco: d.orgao.endereco } : o)));
        }
        if (lista.length === 1) setContatoSel(lista[0].id);
        // Sem contatos não há o que perguntar: segue digitando (com aviso).
        if (!lista.length && !edicao) setUsarContato(false);
        // Na edição, se o responsável já é um contato, ele fica marcado.
        if (edicao) {
          const atual = todos.find((c) => c.nome_completo.trim() === (inicial?.responsavelProjeto || "").trim());
          if (atual) { setUsarContato(true); setContatoSel(atual.id); setContatoUsado(atual.id); }
        }
      })
      .catch(() => {})
      .finally(() => setCarregandoContatos(false));
  }

  /** Troca de cliente: zera a escolha de contato e limpa só o que o sistema
   *  tinha preenchido a partir do cliente anterior. */
  function escolherCliente(clienteId: string) {
    setForm((f) => ({
      ...f,
      clienteId,
      responsavelProjeto: f.responsavelProjeto === auto.current.responsavel ? "" : f.responsavelProjeto,
      endereco: f.endereco === auto.current.endereco ? "" : f.endereco,
    }));
    auto.current.responsavel = undefined;
    auto.current.endereco = undefined;
    setTocados((t) => new Set(t).add("clienteId"));
    setServidor(novoResultado());
    setUsarContato(null);
    setContatoSel("");
    setContatoUsado(null);
    setEditor(null);
    carregarContatos(clienteId);
  }

  const cliente = orgaos.find((o) => o.id === form.clienteId);
  const contatoEscolhido = contatos.find((c) => c.id === contatoSel) || null;
  /** Contatos oferecidos para escolha: ativos + o que o projeto já usa. */
  const contatosEscolha = useMemo(
    () => contatos.filter((c) => c.ativo !== false || c.id === contatoUsado),
    [contatos, contatoUsado]
  );

  /** "Usar como está": responsável = nome do contato; endereço da obra =
   *  endereço do cliente, só se ainda estiver vazio. */
  function usarComoEsta(c: Contato) {
    setUsarContato(true);
    setContatoSel(c.id);
    setContatoUsado(c.id);
    auto.current.responsavel = c.nome_completo;
    setForm((f) => {
      const end = !f.endereco.trim() && cliente?.endereco ? cliente.endereco : f.endereco;
      if (end !== f.endereco) auto.current.endereco = end;
      return { ...f, responsavelProjeto: c.nome_completo, endereco: end };
    });
    setServidor(novoResultado());
  }

  function responderUsarContato(sim: boolean) {
    setUsarContato(sim);
    setEditor(null);
    if (!sim) {
      setContatoUsado(null);
    } else if (form.responsavelProjeto.trim() && !contatos.some((c) => c.nome_completo === form.responsavelProjeto)) {
      // O que foi digitado continua no campo até o usuário escolher um contato.
      setContatoUsado(null);
    }
  }

  async function salvarContato(confirmarRenomeacao = false) {
    if (!editor || !form.clienteId) return;
    setSalvandoContato(true);
    try {
      const url = editor.modo === "novo"
        ? `/api/orgaos/${form.clienteId}/contatos`
        : `/api/orgaos/${form.clienteId}/contatos/${editor.dados.id}`;
      const versao = contatos.find((c) => c.id === editor.dados.id)?.updated_at;
      const r = await fetch(url, {
        method: editor.modo === "novo" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editor.modo === "novo" ? editor.dados : { ...editor.dados, versao, confirmarRenomeacao }),
      });
      const d = await r.json();
      if (r.status === 409 && d.precisaConfirmar) {
        // O contato é responsável de outros projetos deste cliente: confirma
        // e o nome novo vai para eles também (RDOs/relatórios não mudam).
        setSalvandoContato(false);
        if (confirm(`⚠️ ${d.texto}

Salvar e atualizar o responsável desses projetos?`)) await salvarContato(true);
        return;
      }
      if (!r.ok) {
        setEditor((e) => e && { ...e, servidor: { erros: d.erros || { nomeCompleto: [d.erro || "Falha ao salvar o contato."] }, avisos: d.avisos || {} } });
        return;
      }
      const c = d.contato as Contato;
      setContatos((l) => (editor.modo === "novo" ? [...l, c] : l.map((x) => (x.id === c.id ? c : x))));
      setEditor(null);
      usarComoEsta(c);
    } catch {
      setEditor((e) => e && { ...e, servidor: { erros: { nomeCompleto: ["Falha de rede ao salvar o contato."] }, avisos: {} } });
    } finally {
      setSalvandoContato(false);
    }
  }

  const resultado = useMemo(() => {
    const local = validarProjeto(
      { ...form, usarContato: usarContato === true, contatoId: contatoUsado },
      {
        hoje,
        excluirId: projetoId,
        iniciaisCriador: ctxBanco.iniciaisCriador,
        clienteValido: !form.clienteId ? undefined
          : ctxBanco.clienteValido ?? (orgaos.length ? orgaos.some((o) => o.id === form.clienteId) || form.clienteId === inicial?.clienteId : undefined),
        projetosCodigo: ctxBanco.projetosCodigo,
        projetosCliente: ctxBanco.projetosCliente,
        contatos,
      }
    );
    return mesclar(local, servidor);
  }, [form, usarContato, contatoUsado, hoje, projetoId, ctxBanco, orgaos, contatos, servidor, inicial?.clienteId]);

  const resultadoContato = useMemo(() => {
    if (!editor) return novoResultado();
    return mesclar(validarContato(editor.dados, contatos.map((c) => ({ id: c.id, nome_completo: c.nome_completo, email: c.email, ativo: c.ativo !== false }))), editor.servidor || novoResultado());
  }, [editor, contatos]);

  /** Erro só aparece depois de mexer no campo, se ele já tem valor, ou na tentativa de salvar. */
  const mostrar = (campo: Exclude<keyof DadosFormProjeto, "comInspecaoPadrao">) => tentou || tocados.has(campo) || !!form[campo]?.trim();
  const parecidos = usarContato === false ? contatosParecidos(form.responsavelProjeto, contatosEscolha) : [];

  async function salvar() {
    setTentou(true);
    setErro(null);
    if (temErros(resultado)) return;
    setSalvando(true);
    try {
      const r = await fetch(modo === "novo" ? "/api/projetos" : `/api/projetos/${projetoId}`, {
        method: modo === "novo" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, usarContato: usarContato === true, contatoId: contatoUsado, comInspecaoPadrao: inspecaoEfetiva }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.erros) setServidor({ erros: d.erros, avisos: d.avisos || {} });
        setErro(d.erro || "Não foi possível salvar o projeto.");
        return;
      }
      onSalvo(d.projeto);
    } catch {
      setErro("Falha de rede ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const campoContato = (campo: keyof DadosContato, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label style={rotulo}>{label}</label>
      <input
        {...extra}
        value={(editor?.dados[campo] as string) || ""}
        onChange={(e) => {
          const v = campo === "telefone" ? mascaraTelefone(e.target.value) : e.target.value;
          setEditor((ed) => ed && { ...ed, dados: { ...ed.dados, [campo]: v }, servidor: undefined });
        }}
      />
      <MensagensCampo r={resultadoContato} campo={campo} mostrarErros={!!(editor?.dados[campo] as string)?.trim() || !!editor?.servidor} />
    </div>
  );

  const clienteNaLista = !form.clienteId || orgaos.some((o) => o.id === form.clienteId);

  return (
    <div className="form-projeto" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={rotulo}>Cliente *</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={form.clienteId} onChange={(e) => escolherCliente(e.target.value)}
            className={mostrar("clienteId") && resultado.erros.clienteId ? "val-invalido" : undefined}>
            <option value="">— Selecione o cliente —</option>
            {!clienteNaLista && <option value={form.clienteId}>{clienteAtualNome || "Cliente atual"} (fora da lista)</option>}
            {orgaos.map((o) => (
              <option key={o.id} value={o.id}>
                {o.razao_social}
                {o.cidade ? ` (${o.cidade}${o.uf ? "/" + o.uf : ""})` : ""}
              </option>
            ))}
          </select>
          <button type="button" className="btn-azul btn-sec" style={{ whiteSpace: "nowrap" }} onClick={() => setCadastrarOrgao(true)}>
            + Cadastrar
          </button>
        </div>
        <MensagensCampo r={resultado} campo="clienteId" mostrarErros={mostrar("clienteId")} />
      </div>

      {/* Contato do cliente → responsável */}
      {form.clienteId && (
        carregandoContatos ? (
          <p className="detalhe" style={{ margin: 0 }}>Carregando contatos do cliente…</p>
        ) : contatosEscolha.length === 0 ? (
          <div className="val-contato">
            <p className="val-msg val-aviso">⚠️ Este cliente não tem contatos cadastrados. Cadastre um para o responsável ficar padronizado.</p>
            {!editor && (
              <div className="val-acoes">
                <button type="button" className="btn-azul btn-sec" onClick={() => setEditor({ modo: "novo", dados: { nomeCompleto: "", cargo: "", telefone: "", email: "" } })}>
                  + Novo contato
                </button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label style={rotulo}>Usar dados do contato do cliente?</label>
            <div className="val-escolha" role="group" aria-label="Usar dados do contato do cliente?">
              <button type="button" aria-pressed={usarContato === true} onClick={() => responderUsarContato(true)}>Sim</button>
              <button type="button" aria-pressed={usarContato === false} onClick={() => responderUsarContato(false)}>Não</button>
            </div>
            {usarContato === true && !editor && (
              <div className="val-contato" style={{ marginTop: 8 }}>
                {contatosEscolha.length > 1 && (
                  <div role="radiogroup" aria-label="Contato do cliente">
                    {contatosEscolha.map((c) => (
                      <label key={c.id} className="val-contato-opcao">
                        <input type="radio" name="contato-projeto" checked={contatoSel === c.id} onChange={() => setContatoSel(c.id)} />
                        <span>{c.nome_completo}{c.cargo ? ` — ${c.cargo}` : ""}{c.ativo === false ? " (desativado)" : ""}{contatoUsado === c.id ? " ✓" : ""}</span>
                      </label>
                    ))}
                  </div>
                )}
                {contatoEscolhido && (
                  <>
                    <dl>
                      <dt>Nome</dt><dd>{contatoEscolhido.nome_completo}</dd>
                      <dt>Cargo</dt><dd>{contatoEscolhido.cargo || "—"}</dd>
                      <dt>E-mail</dt><dd>{contatoEscolhido.email || "—"}</dd>
                      <dt>Telefone</dt><dd>{contatoEscolhido.telefone || "—"}</dd>
                    </dl>
                    {contatoUsado === contatoEscolhido.id && <p className="val-msg" style={{ color: "#1f7a3d" }}>✓ Em uso como responsável do projeto.</p>}
                  </>
                )}
                <div className="val-acoes">
                  {contatoEscolhido && (
                    <>
                      <button type="button" className="btn-azul" onClick={() => usarComoEsta(contatoEscolhido)}>Usar como está</button>
                      <button type="button" className="btn-azul btn-sec" onClick={() => setEditor({
                        modo: "editar",
                        dados: { id: contatoEscolhido.id, nomeCompleto: contatoEscolhido.nome_completo, cargo: contatoEscolhido.cargo, telefone: contatoEscolhido.telefone || "", email: contatoEscolhido.email },
                      })}>Atualizar contato</button>
                    </>
                  )}
                  <button type="button" className="btn-azul btn-sec" onClick={() => setEditor({ modo: "novo", dados: { nomeCompleto: "", cargo: "", telefone: "", email: "" } })}>
                    + Novo contato
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {editor && (
        <div className="val-contato">
          <strong style={{ fontSize: 13.5 }}>{editor.modo === "novo" ? "Novo contato do cliente" : "Atualizar contato do cliente"}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {campoContato("nomeCompleto", "Nome completo *")}
            {campoContato("cargo", "Cargo *")}
            {campoContato("email", "E-mail *", { type: "email", inputMode: "email" })}
            {campoContato("telefone", "Telefone (com DDD)", { inputMode: "numeric", maxLength: 15, placeholder: "(11) 91234-5678" })}
          </div>
          <p className="detalhe" style={{ margin: 0 }}>Fica gravado no cadastro do cliente e passa a ser o responsável do projeto.</p>
          <div className="val-acoes">
            <button type="button" className="btn-azul" disabled={salvandoContato || temErros(validarContato(editor.dados, contatos.map((c) => ({ id: c.id, nome_completo: c.nome_completo, email: c.email, ativo: c.ativo !== false }))))} onClick={() => salvarContato()}>
              {salvandoContato ? "Salvando…" : "Salvar contato e usar"}
            </button>
            <button type="button" className="btn-azul btn-sec" onClick={() => setEditor(null)} disabled={salvandoContato}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div>
          <label style={rotulo}>Responsável</label>
          <input list={usarContato === false ? "sug-responsavel" : undefined} value={form.responsavelProjeto}
            readOnly={usarContato === true}
            onChange={(e) => atualizar("responsavelProjeto", e.target.value)}
            className={mostrar("responsavelProjeto") && resultado.erros.responsavelProjeto ? "val-invalido" : undefined}
            placeholder={usarContato === true ? "escolha o contato acima" : "responsável pelo projeto"} />
          <datalist id="sug-responsavel">
            {contatosEscolha.map((c) => <option key={c.id} value={c.nome_completo} />)}
          </datalist>
          <MensagensCampo r={resultado} campo="responsavelProjeto" mostrarErros={tentou}>
            {parecidos.map((c) => (
              <button key={c.id} type="button" className="val-acao" onClick={() => usarComoEsta(c)}>
                Usar o contato “{c.nome_completo}”
              </button>
            ))}
          </MensagensCampo>
        </div>
        <div>
          <label style={rotulo}>Data de abertura *</label>
          <input type="date" value={form.dataAbertura} max={hoje} onChange={(e) => atualizar("dataAbertura", e.target.value)}
            className={mostrar("dataAbertura") && resultado.erros.dataAbertura ? "val-invalido" : undefined} />
          <MensagensCampo r={resultado} campo="dataAbertura" mostrarErros={mostrar("dataAbertura")} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div>
          <label style={rotulo}>Código do projeto *</label>
          <input value={form.codigoProjeto} onChange={(e) => atualizar("codigoProjeto", e.target.value)}
            onBlur={() => form.codigoProjeto && setForm((f) => ({ ...f, codigoProjeto: normalizarCodigoProjeto(f.codigoProjeto) }))}
            className={mostrar("codigoProjeto") && resultado.erros.codigoProjeto ? "val-invalido" : undefined}
            placeholder="NN/INICIAIS/AA — ex.: 07/MG/26" autoCapitalize="characters" />
          {sugestao && normalizarCodigoProjeto(form.codigoProjeto) !== sugestao.codigo && (
            <div className="val-sugestao">
              Próximo do ano: <strong>{sugestao.codigo}</strong>
              <button type="button" className="val-acao" onClick={() => { auto.current.codigo = sugestao.codigo; atualizar("codigoProjeto", sugestao.codigo); }}>Usar</button>
            </div>
          )}
          <MensagensCampo r={resultado} campo="codigoProjeto" mostrarErros={mostrar("codigoProjeto")} />
        </div>
        <div>
          <label style={rotulo}>Pedido de compra *</label>
          <input value={form.pedidoCompra} onChange={(e) => atualizar("pedidoCompra", e.target.value)} placeholder="nº do pedido"
            className={mostrar("pedidoCompra") && resultado.erros.pedidoCompra ? "val-invalido" : undefined} />
          <MensagensCampo r={resultado} campo="pedidoCompra" mostrarErros={mostrar("pedidoCompra")} />
        </div>
      </div>

      {/* "Haverá inspeção?" — padrão das OSs; cada OS pode ser diferente. */}
      <div>
        <label style={rotulo} id="rot-inspecao">Haverá inspeção? *</label>
        <div className="val-escolha" role="group" aria-labelledby="rot-inspecao">
          <button type="button" aria-pressed={inspecaoEfetiva} onClick={() => setComInspecao(true)}>Sim</button>
          <button type="button" aria-pressed={!inspecaoEfetiva} onClick={() => setComInspecao(false)}>Não</button>
        </div>
        <p className="detalhe" style={{ margin: "4px 0 0" }}>
          {inspecaoEfetiva
            ? "As OSs começam na fase 2 (Agendamento da inspeção)."
            : "As OSs começam na fase 6 (Agendamento de Execução) — as fases de inspeção (2 a 5) não existem para elas."}
          {" "}Cada OS pode ser diferente{modo === "editar" ? "; mudar aqui vale só para as OSs novas" : ""}.
        </p>
        {recorrencia?.recorrente && comInspecao === null && modo === "novo" && (
          <p className="val-msg aviso-plano" style={{ margin: "4px 0 0" }}>
            {recorrencia.inspecaoPadrao
              ? "Cliente com serviço recorrente, ainda sem projeto ativo — padrão: com inspeção."
              : `Cliente com serviço recorrente${recorrencia.periodicidadeMeses ? ` (a cada ${recorrencia.periodicidadeMeses} meses)` : ""} e com projeto anterior — padrão: sem inspeção. Troque se esta vez precisar inspecionar.`}
          </p>
        )}
      </div>

      <div>
        <label style={rotulo}>Endereço da obra</label>
        <input list="sug-endereco" value={form.endereco}
          onChange={(e) => atualizar("endereco", e.target.value)}
          placeholder="pode diferir do endereço do cliente" />
        <datalist id="sug-endereco">
          {cliente?.endereco && <option value={cliente.endereco} />}
        </datalist>
        {/* "Em branco" só depois de mexer, para não poluir o formulário vazio. */}
        <MensagensCampo r={mostrar("endereco") ? resultado : { erros: {}, avisos: {} }} campo="endereco" />
      </div>

      {/* Resumo só depois de tentar salvar — antes, as mensagens ficam nos campos. */}
      {tentou && <ResumoValidacao r={resultado} rotulos={ROTULOS_PROJETO} />}
      {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4, flexWrap: "wrap" }}>
        <button className="btn-azul btn-sec" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </button>
        <button className="btn-azul" onClick={salvar} disabled={salvando || (tentou && temErros(resultado))}>
          {salvando ? "Salvando…" : modo === "novo" ? "Abrir projeto" : "Salvar alterações"}
        </button>
      </div>

      {cadastrarOrgao && (
        <Modal titulo="Cadastrar cliente" zIndex={200} onFechar={() => setCadastrarOrgao(false)}>
          <FormularioOrgao
            onCancelar={() => setCadastrarOrgao(false)}
            onSucesso={(orgao) => {
              setOrgaos((prev) => [{ id: orgao.id, razao_social: orgao.razao_social, cidade: orgao.cidade, uf: orgao.uf, endereco: (orgao as any).endereco }, ...prev]);
              setCadastrarOrgao(false);
              escolherCliente(orgao.id);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
