"use client";

/** Administração de usuários → abas "Funções" e "Permissões por função".
 *
 * Funções (gp_funcoes): criar, editar nome / nome no RDO, reordenar,
 * desativar/reativar (desativada some do seletor para novas atribuições, mas
 * continua com quem já tem) e excluir — só sem nenhum usuário (senão a API
 * responde 409 com a contagem). Renomear pede confirmação ("N usuários serão
 * atualizados"): o banco leva o nome novo aos usuários (FK ON UPDATE
 * CASCADE). Validação em lib/validacao/funcao.ts, repetida pela API.
 *
 * Permissões por função: matriz funções × permissões; grava tudo de uma vez
 * com a versão lida de cada função (409 se outro administrador alterou —
 * nada é gravado). As regras por perfil (Admin/Gerência/Comercial/Operações) valem
 * sempre, independentemente da função. */
import { useEffect, useMemo, useState } from "react";
import Modal from "@/app/components/Modal";
import { MensagensCampo } from "@/app/components/MensagensCampo";
import {
  addErro, chaveFuncao, mesclar, nomeRdoPadrao, normalizarEspacos, novoResultado, ordenarFuncoes, PERMISSOES_FUNCAO,
  temErros, textoUsuarios, validarFuncao, type ChavePermissaoFuncao, type FuncaoRef, type ResultadoValidacao,
} from "@/lib/validacao";

export interface FuncaoAdmin extends FuncaoRef {
  id: string;
  usuarios: number;
}

async function lerJson(resp: Response): Promise<any> {
  try { return await resp.json(); } catch { return {}; }
}

function resultadoDaApi(dados: any, campoPadrao: string): ResultadoValidacao {
  const r = novoResultado();
  if (dados?.erros) Object.entries(dados.erros as Record<string, string[]>).forEach(([c, l]) => l.forEach((m) => addErro(r, c, m)));
  if (dados?.erro && !temErros(r)) addErro(r, campoPadrao, dados.erro);
  return r;
}

/** Carrega /api/admin/funcoes (com o nº de usuários de cada função) quando
 * `habilitado` (só administradores; a 1ª vez que uma das abas abre). */
export function useFuncoesAdmin(habilitado: boolean) {
  const [funcoes, setFuncoes] = useState<FuncaoAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tabelaAusente, setTabelaAusente] = useState(false);
  /** Marcas cuja coluna ainda não existe no banco (migração pendente). */
  const [marcasAusentes, setMarcasAusentes] = useState<ChavePermissaoFuncao[]>([]);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch("/api/admin/funcoes");
      const dados = await lerJson(resp);
      if (!resp.ok) throw new Error(dados.erro || "Falha ao carregar as funções.");
      setFuncoes(dados.funcoes || []);
      setTabelaAusente(!!dados.tabelaAusente);
      setMarcasAusentes(Array.isArray(dados.marcasAusentes) ? dados.marcasAusentes : []);
    } catch (e: any) {
      setErro(e.message || "Falha ao carregar as funções.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    if (habilitado) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado]);
  return { funcoes, setFuncoes, carregando, erro, tabelaAusente, marcasAusentes, carregar };
}

type EstadoFuncoes = ReturnType<typeof useFuncoesAdmin>;

function AvisoTabelaAusente() {
  return (
    <div className="val-resumo" role="status">
      <strong className="val-aviso">⚠️ A tabela de funções ainda não existe no banco.</strong>
      <p className="detalhe" style={{ margin: "4px 0 0" }}>
        Rode a migração <code>20261105100000_asp_funcoes_permissoes.sql</code> no SQL Editor do Supabase. Até lá valem as
        funções e permissões de antes (somente leitura).
      </p>
    </div>
  );
}

// ── Aba "Funções" ────────────────────────────────────────────────────────────

interface Confirmacao {
  titulo: string;
  texto: string[];
  botao: string;
  perigo?: boolean;
  acao: () => Promise<void>;
}

export function AbaFuncoes({ estado, onMudou }: { estado: EstadoFuncoes; onMudou: () => void }) {
  const { funcoes, setFuncoes, carregando, erro, tabelaAusente, carregar } = estado;
  const lista = useMemo(() => ordenarFuncoes(funcoes), [funcoes]);

  // Criar
  const [novoNome, setNovoNome] = useState("");
  const [novoRdo, setNovoRdo] = useState("");
  const [rdoEditado, setRdoEditado] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [rApiCriar, setRApiCriar] = useState<ResultadoValidacao>(novoResultado());
  const [criando, setCriando] = useState(false);
  const [msgCriar, setMsgCriar] = useState<string | null>(null);

  // Edição por linha
  const [rascunhos, setRascunhos] = useState<Record<string, { nome: string; nome_rdo: string }>>({});
  const [linhas, setLinhas] = useState<Record<string, { r: ResultadoValidacao; ok?: string; conflito?: boolean }>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<Confirmacao | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const rdoSugerido = nomeRdoPadrao(novoNome);
  const rdoCriar = rdoEditado ? novoRdo : rdoSugerido;
  const rCriar = useMemo(() => mesclar(
    validarFuncao({ nome: novoNome, nome_rdo: rdoCriar }, { funcoes, modo: "criar" }),
    rApiCriar,
  ), [novoNome, rdoCriar, funcoes, rApiCriar]);

  async function criar() {
    setTentou(true);
    setMsgCriar(null);
    if (temErros(rCriar)) return;
    setCriando(true);
    try {
      const resp = await fetch("/api/admin/funcoes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: normalizarEspacos(novoNome), nome_rdo: normalizarEspacos(rdoCriar) }),
      });
      const dados = await lerJson(resp);
      if (!resp.ok) { setRApiCriar(resultadoDaApi(dados, "nome")); return; }
      setFuncoes((prev) => [...prev, dados.funcao]);
      setMsgCriar(`Função “${dados.funcao.nome}” criada. Ajuste as permissões na aba “Permissões por função”.`);
      setNovoNome(""); setNovoRdo(""); setRdoEditado(false); setTentou(false); setRApiCriar(novoResultado());
      onMudou();
    } catch {
      setRApiCriar(resultadoDaApi({ erro: "Sem conexão com o servidor. Tente de novo." }, "nome"));
    } finally {
      setCriando(false);
    }
  }

  function marcar(id: string, e: { r: ResultadoValidacao; ok?: string; conflito?: boolean } | null) {
    setLinhas((prev) => { const n = { ...prev }; if (e) n[id] = e; else delete n[id]; return n; });
  }

  async function patch(f: FuncaoAdmin, campos: Record<string, unknown>, campoPadrao: string, ok: string): Promise<boolean> {
    setOcupado(f.id);
    try {
      const resp = await fetch(`/api/admin/funcoes/${f.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...campos, versao: f.updated_at }),
      });
      const dados = await lerJson(resp);
      if (!resp.ok) { marcar(f.id, { r: resultadoDaApi(dados, campoPadrao), conflito: !!dados.conflitoVersao }); return false; }
      setFuncoes((prev) => prev.map((x) => (x.id === f.id ? { ...x, ...dados.funcao } : x)));
      const n = dados.usuariosAtualizados || 0;
      marcar(f.id, { r: novoResultado(), ok: n ? `${ok} ${textoUsuarios(n)} ${n === 1 ? "atualizado" : "atualizados"}.` : ok });
      onMudou();
      return true;
    } catch {
      marcar(f.id, { r: resultadoDaApi({ erro: "Sem conexão com o servidor. Tente de novo." }, campoPadrao) });
      return false;
    } finally {
      setOcupado(null);
    }
  }

  function rLinha(f: FuncaoAdmin): ResultadoValidacao | null {
    const d = rascunhos[f.id];
    if (!d) return null;
    return validarFuncao({ nome: d.nome, nome_rdo: d.nome_rdo }, {
      funcoes, modo: "editar", id: f.id, nomeAnterior: f.nome, usuariosNaFuncao: f.usuarios,
    });
  }

  function descartar(id: string) {
    setRascunhos((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  async function salvar(f: FuncaoAdmin) {
    const d = rascunhos[f.id];
    const r = rLinha(f);
    if (!d || !r) return;
    if (temErros(r)) { marcar(f.id, { r }); return; }
    const nome = normalizarEspacos(d.nome);
    const gravar = async () => {
      if (await patch(f, { nome, nome_rdo: normalizarEspacos(d.nome_rdo) }, "nome", "Função atualizada.")) descartar(f.id);
    };
    if (nome !== f.nome && f.usuarios > 0) {
      setConfirmar({
        titulo: `Renomear “${f.nome}” para “${nome}”?`,
        texto: [
          `${textoUsuarios(f.usuarios)} ${f.usuarios === 1 ? "será atualizado" : "serão atualizados"} para a função “${nome}”.`,
          "RDOs e relatórios já gerados mantêm o cargo antigo.",
        ],
        botao: "Renomear",
        acao: gravar,
      });
      return;
    }
    await gravar();
  }

  function alternarAtivo(f: FuncaoAdmin) {
    if (f.ativo) {
      setConfirmar({
        titulo: `Desativar a função “${f.nome}”?`,
        texto: [
          "Ela some da lista de funções ao cadastrar ou editar usuários.",
          f.usuarios > 0
            ? `${textoUsuarios(f.usuarios)} ${f.usuarios === 1 ? "continua" : "continuam"} com esta função — e com as permissões dela — até um administrador trocar.`
            : "Nenhum usuário tem esta função hoje.",
        ],
        botao: "Desativar",
        acao: async () => { await patch(f, { ativo: false }, "ativo", "Função desativada."); },
      });
      return;
    }
    patch(f, { ativo: true }, "ativo", "Função reativada.");
  }

  function excluir(f: FuncaoAdmin) {
    setConfirmar({
      titulo: `Excluir a função “${f.nome}”?`,
      texto: ["A função é apagada de vez. Essa ação não pode ser desfeita."],
      botao: "Excluir",
      perigo: true,
      acao: async () => {
        setOcupado(f.id);
        try {
          const resp = await fetch(`/api/admin/funcoes/${f.id}`, { method: "DELETE" });
          const dados = await lerJson(resp);
          if (!resp.ok) { marcar(f.id, { r: resultadoDaApi(dados, "excluir") }); return; }
          setFuncoes((prev) => prev.filter((x) => x.id !== f.id));
          onMudou();
        } catch {
          marcar(f.id, { r: resultadoDaApi({ erro: "Sem conexão com o servidor. Tente de novo." }, "excluir") });
        } finally {
          setOcupado(null);
        }
      },
    });
  }

  async function mover(f: FuncaoAdmin, delta: -1 | 1) {
    const ids = lista.map((x) => x.id);
    const i = ids.indexOf(f.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOcupado(f.id);
    // Otimista: reordena já; se falhar, recarrega.
    setFuncoes((prev) => prev.map((x) => ({ ...x, ordem: ids.indexOf(x.id) + 1 })));
    try {
      const resp = await fetch("/api/admin/funcoes/ordem", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
      });
      const dados = await lerJson(resp);
      if (!resp.ok) { marcar(f.id, { r: resultadoDaApi(dados, "ordem"), conflito: !!dados.conflitoVersao }); await carregar(); return; }
      if (dados.funcoes) setFuncoes(dados.funcoes);
      onMudou();
    } catch {
      marcar(f.id, { r: resultadoDaApi({ erro: "Sem conexão com o servidor. Tente de novo." }, "ordem") });
      await carregar();
    } finally {
      setOcupado(null);
    }
  }

  async function executarConfirmacao() {
    if (!confirmar) return;
    setConfirmando(true);
    await confirmar.acao();
    setConfirmando(false);
    setConfirmar(null);
  }

  if (carregando && funcoes.length === 0) return <p>Carregando funções...</p>;
  const somenteLeitura = tabelaAusente;

  return (
    <div>
      {tabelaAusente && <AvisoTabelaAusente />}
      {!somenteLeitura && (
        <section className="card">
          <h2>Nova função</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="funcao-nova-nome">Nome *</label>
              <input id="funcao-nova-nome" value={novoNome} maxLength={60} placeholder="Ex.: Auxiliar"
                className={tentou && rCriar.erros.nome?.length ? "val-invalido" : undefined}
                onChange={(e) => { setNovoNome(e.target.value); setRApiCriar(novoResultado()); }} />
              <MensagensCampo r={rCriar} campo="nome" mostrarErros={tentou || !!rCriar.erros.nome?.some((m) => m.startsWith("Já existe"))} />
            </div>
            <div className="field">
              <label htmlFor="funcao-nova-rdo">Nome no RDO *</label>
              <input id="funcao-nova-rdo" value={rdoCriar} maxLength={80} placeholder="Ex.: Auxiliar de operações"
                className={tentou && rCriar.erros.nome_rdo?.length ? "val-invalido" : undefined}
                onChange={(e) => { setNovoRdo(e.target.value); setRdoEditado(true); setRApiCriar(novoResultado()); }} />
              <small>Cargo que aparece na equipe do RDO{!rdoEditado && novoNome.trim() ? " (sugerido)" : ""}.</small>
              <MensagensCampo r={rCriar} campo="nome_rdo" mostrarErros={tentou} />
            </div>
          </div>
          <p className="detalhe" style={{ marginTop: 10 }}>
            A função nasce <strong>sem permissões extras</strong> — marque o que ela pode fazer na aba “Permissões por função”.
          </p>
          <div className="actions">
            <button className="btn" onClick={criar} disabled={criando}>{criando ? "Criando..." : "Criar função"}</button>
            {msgCriar && <span className="msg ok">{msgCriar}</span>}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Funções cadastradas ({lista.length})</h2>
        {erro && <p className="msg erro">⛔ {erro}</p>}
        <p className="detalhe" style={{ marginTop: 0 }}>
          A ordem vale para a lista de funções e para a equipe no RDO. Função desativada some do cadastro de usuários,
          mas continua com quem já a tem. Só dá para excluir função sem nenhum usuário.
        </p>
        {lista.map((f, i) => {
          const d = rascunhos[f.id];
          const rL = mesclar(linhas[f.id]?.r || novoResultado(), rLinha(f) || novoResultado());
          const ocupadoAqui = ocupado === f.id;
          const ativos = lista.filter((x) => x.ativo === f.ativo);
          const posGrupo = ativos.indexOf(f);
          const mudou = !!d && (normalizarEspacos(d.nome) !== f.nome || normalizarEspacos(d.nome_rdo) !== (f.nome_rdo || ""));
          return (
            <div className="item-analise" key={f.id} style={f.ativo ? undefined : { opacity: 0.85 }}>
              <div className="item-analise-cabecalho">
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>{i + 1}. {f.nome}</strong>
                  <span className={`chip ${f.ativo ? "chip-sucesso" : "chip-neutro"}`}>{f.ativo ? "Ativa" : "Desativada"}</span>
                  <span className="chip chip-info">{textoUsuarios(f.usuarios)}</span>
                </span>
                {!somenteLeitura && (
                  <span className="funcao-ordem">
                    <button type="button" className="btn-doc btn-sm" aria-label={`Subir ${f.nome}`} title="Subir"
                      disabled={ocupadoAqui || posGrupo <= 0} onClick={() => mover(f, -1)}>↑</button>
                    <button type="button" className="btn-doc btn-sm" aria-label={`Descer ${f.nome}`} title="Descer"
                      disabled={ocupadoAqui || posGrupo === -1 || posGrupo >= ativos.length - 1} onClick={() => mover(f, 1)}>↓</button>
                  </span>
                )}
              </div>
              <div className="grid">
                <div className="field">
                  <label htmlFor={`funcao-${f.id}-nome`}>Nome</label>
                  <input id={`funcao-${f.id}-nome`} value={d ? d.nome : f.nome} maxLength={60} disabled={somenteLeitura}
                    className={d && rL.erros.nome?.length ? "val-invalido" : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRascunhos((prev) => ({ ...prev, [f.id]: { nome: v, nome_rdo: prev[f.id]?.nome_rdo ?? (f.nome_rdo || "") } }));
                      marcar(f.id, null);
                    }} />
                  <MensagensCampo r={rL} campo="nome" />
                </div>
                <div className="field">
                  <label htmlFor={`funcao-${f.id}-rdo`}>Nome no RDO</label>
                  <input id={`funcao-${f.id}-rdo`} value={d ? d.nome_rdo : (f.nome_rdo || "")} maxLength={80} disabled={somenteLeitura}
                    placeholder={nomeRdoPadrao(d?.nome || f.nome)}
                    className={d && rL.erros.nome_rdo?.length ? "val-invalido" : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRascunhos((prev) => ({ ...prev, [f.id]: { nome: prev[f.id]?.nome ?? f.nome, nome_rdo: v } }));
                      marcar(f.id, null);
                    }} />
                  <MensagensCampo r={rL} campo="nome_rdo" />
                </div>
              </div>
              {!somenteLeitura && (
                <div className="actions" style={{ marginTop: 8 }}>
                  {mudou && (
                    <>
                      <button type="button" className="btn btn-sm" disabled={ocupadoAqui} onClick={() => salvar(f)}>
                        {ocupadoAqui ? "Salvando..." : "Salvar"}
                      </button>
                      <button type="button" className="btn secondary btn-sm" disabled={ocupadoAqui} onClick={() => descartar(f.id)}>Cancelar</button>
                    </>
                  )}
                  <button type="button" className="btn-doc btn-sm" disabled={ocupadoAqui} onClick={() => alternarAtivo(f)}>
                    {f.ativo ? "Desativar" : "Reativar"}
                  </button>
                  <button type="button" className="btn-dl btn-sec btn-perigo btn-sm" disabled={ocupadoAqui || f.usuarios > 0}
                    title={f.usuarios > 0 ? `Em uso por ${textoUsuarios(f.usuarios)} — desative em vez de excluir` : "Excluir de vez"}
                    onClick={() => excluir(f)}>
                    🗑️ Excluir
                  </button>
                </div>
              )}
              {f.usuarios > 0 && !somenteLeitura && (
                <p className="detalhe" style={{ margin: "6px 0 0" }}>🔒 Em uso por {textoUsuarios(f.usuarios)} — não pode ser excluída; desative para tirá-la dos novos cadastros.</p>
              )}
              <MensagensCampo r={rL} campo="ativo" />
              <MensagensCampo r={rL} campo="excluir" />
              <MensagensCampo r={rL} campo="ordem" />
              {Object.keys(rL.erros).filter((c) => !["nome", "nome_rdo", "ativo", "excluir", "ordem"].includes(c))
                .map((c) => <MensagensCampo key={c} r={rL} campo={c} />)}
              {linhas[f.id]?.conflito && (
                <div className="actions" style={{ marginTop: 6 }}>
                  <button type="button" className="btn secondary" onClick={() => { descartar(f.id); marcar(f.id, null); carregar(); }}>Recarregar funções</button>
                </div>
              )}
              {linhas[f.id]?.ok && <p className="msg ok" style={{ margin: "6px 0 0" }}>{linhas[f.id]!.ok}</p>}
            </div>
          );
        })}
      </section>

      {confirmar && (
        <Modal titulo={confirmar.titulo} onFechar={() => !confirmando && setConfirmar(null)} zIndex={200}>
          {confirmar.texto.map((t) => <p key={t} style={{ marginTop: 0 }}>{t}</p>)}
          <div className="actions">
            <button type="button" className={confirmar.perigo ? "btn btn-perigo" : "btn"} onClick={executarConfirmacao} disabled={confirmando}>
              {confirmando ? "Aguarde..." : confirmar.botao}
            </button>
            <button type="button" className="btn secondary" onClick={() => setConfirmar(null)} disabled={confirmando}>Cancelar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Aba "Permissões por função" ──────────────────────────────────────────────

type Marcas = Record<ChavePermissaoFuncao, boolean>;

function marcasDe(f: FuncaoRef): Marcas {
  return Object.fromEntries(PERMISSOES_FUNCAO.map((p) => [p.chave, !!f[p.chave]])) as Marcas;
}

export function AbaPermissoes({ estado, onMudou, onPendentes }: {
  estado: EstadoFuncoes; onMudou: () => void; onPendentes?: (n: number) => void;
}) {
  const { funcoes, setFuncoes, carregando, erro, tabelaAusente, marcasAusentes, carregar } = estado;
  const lista = useMemo(() => ordenarFuncoes(funcoes), [funcoes]);
  const [rascunho, setRascunho] = useState<Record<string, Marcas>>({});
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [conflito, setConflito] = useState<FuncaoAdmin[] | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const alteradas = lista.filter((f) => {
    const d = rascunho[f.id];
    return d && PERMISSOES_FUNCAO.some((p) => d[p.chave] !== !!f[p.chave]);
  });

  useEffect(() => { onPendentes?.(alteradas.length); }, [alteradas.length, onPendentes]);

  function alternar(f: FuncaoAdmin, chave: ChavePermissaoFuncao) {
    setOk(null);
    setErroSalvar(null);
    setRascunho((prev) => {
      const atual = prev[f.id] || marcasDe(f);
      return { ...prev, [f.id]: { ...atual, [chave]: !atual[chave] } };
    });
  }

  async function salvar() {
    if (!alteradas.length) return;
    setSalvando(true);
    setErroSalvar(null);
    setConflito(null);
    setOk(null);
    try {
      const resp = await fetch("/api/admin/funcoes/permissoes", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: alteradas.map((f) => ({ id: f.id, versao: f.updated_at, ...rascunho[f.id] })) }),
      });
      const dados = await lerJson(resp);
      if (!resp.ok) {
        setErroSalvar(dados.erro || "Falha ao gravar as permissões.");
        if (dados.conflitoVersao) setConflito(dados.funcoes || []);
        return;
      }
      setFuncoes(dados.funcoes || []);
      setRascunho({});
      setOk(`Permissões gravadas (${alteradas.length} ${alteradas.length === 1 ? "função" : "funções"}). Valem a partir da próxima ação de cada usuário.`);
      onMudou();
    } catch {
      setErroSalvar("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  /** Conflito: pega a versão nova do banco e descarta o rascunho. */
  function recarregar() {
    if (conflito && conflito.length) setFuncoes(conflito); else carregar();
    setRascunho({});
    setConflito(null);
    setErroSalvar(null);
  }

  if (carregando && funcoes.length === 0) return <p>Carregando permissões...</p>;

  return (
    <div>
      {tabelaAusente && <AvisoTabelaAusente />}
      {!tabelaAusente && marcasAusentes.length > 0 && (
        <div className="val-resumo" role="status">
          <strong className="val-aviso">⚠️ Algumas permissões ainda não existem no banco.</strong>
          <p className="detalhe" style={{ margin: "4px 0 0" }}>
            Rode a migração <code>20261106100000_asp_permissoes_campo.sql</code> no SQL Editor do Supabase. Até lá as colunas{" "}
            {PERMISSOES_FUNCAO.filter((p) => marcasAusentes.includes(p.chave)).map((p) => `“${p.rotulo}”`).join(", ")} ficam
            travadas e só os perfis da Área / Acesso têm esses direitos.
          </p>
        </div>
      )}
      <section className="card">
        <h2>Permissões por função</h2>
        <p className="detalhe" style={{ marginTop: 0 }}>
          Marque o que cada função pode fazer <strong>além</strong> do que a Área / Acesso do usuário já permite.
        </p>
        {erro && <p className="msg erro">⛔ {erro}</p>}
        <div className="rolagem-x">
          <table className="tabela matriz-permissoes">
            <thead>
              <tr>
                <th scope="col">Função</th>
                {PERMISSOES_FUNCAO.map((p) => (
                  <th key={p.chave} scope="col" className="matriz-col">
                    {p.rotulo}
                    <span className="matriz-ajuda">{p.ajuda}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const m = rascunho[f.id] || marcasDe(f);
                const mudou = alteradas.includes(f);
                return (
                  <tr key={f.id} className={`${mudou ? "matriz-alterada" : ""} ${f.ativo ? "" : "matriz-inativa"}`.trim() || undefined}>
                    <th scope="row" className="matriz-linha">
                      {f.nome}
                      {!f.ativo && <span className="chip chip-neutro" style={{ marginLeft: 6 }}>desativada</span>}
                      <span className="matriz-ajuda">{textoUsuarios(f.usuarios)}{mudou ? " · alterada" : ""}</span>
                    </th>
                    {PERMISSOES_FUNCAO.map((p) => (
                      <td key={p.chave} className="matriz-cel">
                        <input type="checkbox" checked={m[p.chave]}
                          disabled={tabelaAusente || salvando || marcasAusentes.includes(p.chave)}
                          aria-label={`${f.nome}: ${p.rotulo}`} onChange={() => alternar(f, p.chave)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={salvar} disabled={tabelaAusente || salvando || alteradas.length === 0}>
            {salvando ? "Salvando..." : alteradas.length ? `Salvar permissões (${alteradas.length})` : "Salvar permissões"}
          </button>
          {alteradas.length > 0 && !salvando && (
            <button type="button" className="btn secondary" onClick={() => { setRascunho({}); setErroSalvar(null); }}>Descartar alterações</button>
          )}
          {ok && <span className="msg ok">{ok}</span>}
        </div>
        {erroSalvar && (
          <div className="val-resumo" role="alert" style={{ marginTop: 8 }}>
            <strong className="val-erro">⛔ {erroSalvar}</strong>
            {conflito && (
              <div className="actions" style={{ marginTop: 6 }}>
                <button type="button" className="btn secondary" onClick={recarregar}>Recarregar (descarta suas marcações)</button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Quem já tem esses direitos pela Área / Acesso</h2>
        <p className="detalhe" style={{ marginTop: 0 }}>Independentemente da função, estes perfis sempre podem:</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {PERMISSOES_FUNCAO.map((p) => (
            <li key={p.chave}>
              <strong>{p.rotulo}:</strong> {p.perfisSempre || "nenhum perfil — só pela função."}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Funções para o seletor do cadastro de usuários: as ativas (na ordem) +
 * a atual do usuário, mesmo desativada ou fora da lista. */
export function opcoesFuncao(funcoes: Pick<FuncaoRef, "nome" | "ativo" | "ordem">[], atual?: string | null): { nome: string; rotulo: string; desativada: boolean }[] {
  const ops = ordenarFuncoes(funcoes).filter((f) => f.ativo).map((f) => ({ nome: f.nome, rotulo: f.nome, desativada: false }));
  if (atual && !ops.some((o) => o.nome === atual)) {
    const cad = funcoes.find((f) => f.nome === atual) || funcoes.find((f) => chaveFuncao(f.nome) === chaveFuncao(atual));
    ops.push({ nome: atual, rotulo: `${atual} (${cad ? "desativada" : "não cadastrada"})`, desativada: true });
  }
  return ops;
}
