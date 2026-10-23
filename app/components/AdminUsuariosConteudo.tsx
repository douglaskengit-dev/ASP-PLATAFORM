"use client";

/** Conteúdo de "Administração de usuários" — reaproveitado pela página
 * /admin/usuarios e pelo modal aberto a partir do header (D18).
 *
 * Validação (lib/validacao/usuario.ts, repetida pela API): e-mail válido e
 * único, nome + sobrenome, Área/Função das listas (⛔); homônimo, iniciais
 * repetidas e "documentos mantêm o nome antigo" (⚠️). Ninguém tira o próprio
 * acesso nem o do último admin ativo. Desativar tira a pessoa das equipes
 * dos agendamentos futuros (com confirmação listando quais). Cada linha
 * grava com a versão lida (updated_at): se outro admin alterou antes, 409.
 *
 * Acesso por e-mail: criar NÃO pede senha — o usuário recebe o convite
 * "Criar minha senha" (24 h). Cada linha mostra o último convite e oferece
 * "Enviar link de redefinição" (1 h) e, para quem nunca entrou, "Reenviar
 * convite". Se o e-mail não sair, aparece o motivo e "Copiar link" (o link
 * só existe nesta tela, logo após gerar — no banco fica só o hash).
 *
 * Abas: "Usuários" (esta lista) · "Funções" e "Permissões por função"
 * (AdminFuncoesConteudo.tsx — gp_funcoes). O seletor de Função mostra só as
 * funções ATIVAS (+ a atual de cada usuário, mesmo desativada). */
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import Modal from "@/app/components/Modal";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import { AbaFuncoes, AbaPermissoes, opcoesFuncao, useFuncoesAdmin } from "@/app/components/AdminFuncoesConteudo";
import {
  addAviso, addErro, checarAlteracaoAcesso, dataHoraCurta, ehPerfilLegado, mesclar, nomeCompletoValido,
  normalizarEspacos, novoResultado, ROTULOS_USUARIO, SENHA_MINIMA, temErros, validarUsuario, VALIDADE_LINK_TEXTO,
  type FuncaoRef, type ResultadoValidacao, type TipoLinkAcesso,
} from "@/lib/validacao";

interface Profile {
  id: string;
  email: string;
  nome_completo: string | null;
  /** admin/comercial/operacoes/gerencia (novos) ou editor/visualizador (legado). */
  perfil: string;
  funcao: string | null;
  ativo: boolean;
  /** Versão para a checagem de "outro administrador alterou". */
  updated_at: string | null;
}

/** Perfil = acesso/permissão. A "Área" é derivada dele. */
const PERFIS_ACESSO = [
  { valor: "comercial", rotulo: "Comercial" },
  { valor: "operacoes", rotulo: "Operações" },
  { valor: "gerencia", rotulo: "Gerência" },
  { valor: "admin", rotulo: "Administrador (acesso total)" },
];
const AREA_POR_PERFIL: Record<string, string> = {
  comercial: "Comercial", operacoes: "Operação", gerencia: "Gerência", admin: "Administração",
};
type Aba = "usuarios" | "funcoes" | "permissoes";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "usuarios", rotulo: "Usuários" },
  { id: "funcoes", rotulo: "Funções" },
  { id: "permissoes", rotulo: "Permissões por função" },
];

/** Mensagens de uma linha da lista (resposta da API + resultado do salvar). */
interface EstadoLinha {
  r: ResultadoValidacao;
  ok?: string;
  conflito?: boolean;
}

interface AgendamentoAfetado {
  id: string;
  inspecaoId: string;
  os: string;
  projeto: string;
  tipoLabel: string;
  quando: string;
  ficaSemEquipe: boolean;
}

interface ResumoLink {
  criadoEm: string;
  status: "pendente" | "aceito" | "expirado" | "invalidado";
  envio: string;
  envioErro: string | null;
}
interface ResumoAcesso {
  ultimoLogin: string | null;
  loginConhecido: boolean;
  convite: ResumoLink | null;
  redefinicao: ResumoLink | null;
}

/** Resposta de emitir um link (criar usuário / reenviar / redefinição). */
interface EnvioLink {
  ok?: boolean;
  tipo: TipoLinkAcesso;
  enviado: boolean;
  motivo: string | null;
  /** Só quando o e-mail não saiu: para copiar (nunca gravado). */
  link?: string;
  erro?: string;
}

const STATUS_LINK: Record<ResumoLink["status"], string> = {
  pendente: "pendente", aceito: "aceito", expirado: "expirado", invalidado: "substituído/cancelado",
};

/** "Convite enviado em 23/10 14:05 · pendente". */
function textoConvite(a: ResumoAcesso | undefined): string | null {
  const c = a?.convite;
  if (!c) return null;
  const status = c.status !== "aceito" && a?.ultimoLogin ? "aceito" : STATUS_LINK[c.status];
  const verbo = c.envio === "enviado" ? "Convite enviado em" : "Convite gerado em";
  return `${verbo} ${dataHoraCurta(c.criadoEm)} · ${status}${c.envio !== "enviado" && c.envio !== "pendente" ? " · e-mail não enviado" : ""}`;
}

/** Resultado do envio: ✓ enviado, ou ⚠️ motivo + Reenviar + Copiar link. */
function AvisoEnvio({ envio, email, onReenviar, reenviando }: {
  envio: EnvioLink; email: string; onReenviar?: () => void; reenviando?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const nome = envio.tipo === "convite" ? "Convite" : "Link de redefinição";
  if (envio.erro) return <p className="msg erro" style={{ margin: "6px 0 0" }}>⛔ {envio.erro}</p>;
  if (envio.enviado) {
    return (
      <p className="msg ok" style={{ margin: "6px 0 0" }}>
        ✉️ {nome} enviado para {email} (válido por {VALIDADE_LINK_TEXTO[envio.tipo]}).
      </p>
    );
  }
  async function copiar() {
    if (!envio.link) return;
    try {
      await navigator.clipboard.writeText(envio.link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      window.prompt("Copie o link (Ctrl+C):", envio.link);
    }
  }
  return (
    <div className="val-resumo" role="alert" style={{ marginTop: 8 }}>
      <strong className="val-aviso">⚠️ E-mail não enviado: {envio.motivo || "falha no envio."}</strong>
      <p className="detalhe" style={{ margin: "4px 0 8px" }}>
        {envio.tipo === "convite" ? "O usuário ainda não recebeu o convite (a conta já existe)." : "A senha atual continua valendo."}{" "}
        {envio.link ? `Você pode copiar o link (válido por ${VALIDADE_LINK_TEXTO[envio.tipo]}, uso único) e enviá-lo por outro meio — ele só aparece agora.` : ""}
      </p>
      <div className="actions" style={{ marginTop: 0 }}>
        {onReenviar && (
          <button type="button" className="btn secondary" onClick={onReenviar} disabled={reenviando}>
            {reenviando ? "Enviando..." : envio.tipo === "convite" ? "Reenviar convite" : "Reenviar link"}
          </button>
        )}
        {envio.link && (
          <button type="button" className="btn-doc" onClick={copiar}>{copiado ? "✓ Link copiado" : "📋 Copiar link"}</button>
        )}
      </div>
    </div>
  );
}

async function lerJson(resp: Response): Promise<any> {
  try { return await resp.json(); } catch { return {}; }
}

/** Erros/avisos da resposta da API → resultado por campo. */
function resultadoDaApi(dados: any, campoPadrao: string): ResultadoValidacao {
  const r = novoResultado();
  if (dados?.erros) Object.entries(dados.erros as Record<string, string[]>).forEach(([c, l]) => l.forEach((m) => addErro(r, c, m)));
  if (dados?.avisos) Object.entries(dados.avisos as Record<string, string[]>).forEach(([c, l]) => l.forEach((m) => addAviso(r, c, m)));
  if (dados?.erro && !temErros(r)) addErro(r, campoPadrao, dados.erro);
  return r;
}

function textoRemocao(ag: any): string {
  if (!ag || !ag.alterados) return "";
  let t = ` Saiu da equipe de ${ag.alterados} agendamento${ag.alterados === 1 ? "" : "s"} futuro${ag.alterados === 1 ? "" : "s"}; a equipe restante foi avisada.`;
  if (ag.semEquipe) t += ` ${ag.semEquipe} ${ag.semEquipe === 1 ? "ficou" : "ficaram"} sem equipe — Comercial e Gerência foram avisados para escalar alguém.`;
  if (ag.falhas) t += ` ${ag.falhas} não ${ag.falhas === 1 ? "pôde" : "puderam"} ser alterado${ag.falhas === 1 ? "" : "s"} (mudou ao mesmo tempo) — confira na OS.`;
  return t;
}

export default function AdminUsuariosConteudo() {
  const [carregando, setCarregando] = useState(true);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [meuId, setMeuId] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<Profile[]>([]);
  const [acesso, setAcesso] = useState<Record<string, ResumoAcesso>>({});
  /** Último envio de link por usuário (nesta tela). */
  const [envios, setEnvios] = useState<Record<string, EnvioLink & { email: string }>>({});
  const [enviandoLink, setEnviandoLink] = useState<string | null>(null);
  /** Convite do usuário recém-criado. */
  const [conviteCriado, setConviteCriado] = useState<(EnvioLink & { id: string; email: string }) | null>(null);
  /** Erro/aviso geral (carregar a lista) — os de cada usuário ficam na linha. */
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  /** Funções cadastradas (gp_funcoes) — null = não deu para ler. */
  const [funcoesCad, setFuncoesCad] = useState<FuncaoRef[] | null>(null);
  const [aba, setAba] = useState<Aba>("usuarios");
  const [abriuFuncoes, setAbriuFuncoes] = useState(false);
  const [pendentesPermissoes, setPendentesPermissoes] = useState(0);
  const estadoFuncoes = useFuncoesAdmin(!!autorizado && abriuFuncoes);

  const [novoEmail, setNovoEmail] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoPerfil, setNovoPerfil] = useState("operacoes");
  const [novaFuncao, setNovaFuncao] = useState("");
  const [criando, setCriando] = useState(false);
  const [tentouCriar, setTentouCriar] = useState(false);
  const [rApiCriar, setRApiCriar] = useState<ResultadoValidacao>(novoResultado());
  const [erroCriar, setErroCriar] = useState<string | null>(null);

  /** Nome sendo digitado em cada linha (salva ao sair do campo). */
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [linhas, setLinhas] = useState<Record<string, EstadoLinha>>({});

  // Redefinir senha (modal).
  const [senhaAlvo, setSenhaAlvo] = useState<Profile | null>(null);
  const [senha1, setSenha1] = useState("");
  const [senha2, setSenha2] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [tentouSenha, setTentouSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  // Desativar (modal de confirmação com os agendamentos afetados).
  const [desativar, setDesativar] = useState<{ u: Profile; agendamentos: AgendamentoAfetado[] | null; erro: string | null } | null>(null);
  const [desativando, setDesativando] = useState(false);

  // D31: filtros da lista de usuários cadastrados + paginação "ver mais".
  const [filtroNome, setFiltroNome] = useState("");
  const [filtroEmail, setFiltroEmail] = useState("");
  const [filtroPerfil, setFiltroPerfil] = useState("");
  const [qtdVisivel, setQtdVisivel] = useState(5);

  const usuariosFiltrados = useMemo(() => {
    const nomeBusca = filtroNome.trim().toLowerCase();
    const emailBusca = filtroEmail.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (nomeBusca && !(u.nome_completo || "").toLowerCase().includes(nomeBusca)) return false;
      if (emailBusca && !u.email.toLowerCase().includes(emailBusca)) return false;
      if (filtroPerfil && u.perfil !== filtroPerfil) return false;
      return true;
    });
  }, [usuarios, filtroNome, filtroEmail, filtroPerfil]);

  useEffect(() => {
    setQtdVisivel(5);
  }, [filtroNome, filtroEmail, filtroPerfil]);

  const usuariosVisiveis = usuariosFiltrados.slice(0, qtdVisivel);
  const filtrosAtivos = !!(filtroNome || filtroEmail || filtroPerfil);

  /** `silencioso`: recarrega sem trocar a tela por "Carregando..." (depois
   *  de mexer nas funções, por exemplo). */
  async function carregar(silencioso = false) {
    if (!silencioso) setCarregando(true);
    setErro(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setAutorizado(false);
        return;
      }
      setMeuId(data.user.id);
      const { data: meuProfile } = await supabase
        .from("gp_profiles")
        .select("perfil")
        .eq("id", data.user.id)
        .single();

      if (meuProfile?.perfil !== "admin") {
        setAutorizado(false);
        return;
      }
      setAutorizado(true);

      const resp = await fetch("/api/admin/users");
      const dados = await lerJson(resp);
      if (!resp.ok) throw new Error(dados.erro || "Falha ao carregar usuários.");
      setUsuarios(dados.usuarios || []);
      setAcesso(dados.acesso || {});
      setFuncoesCad(Array.isArray(dados.funcoes) ? dados.funcoes : null);
      setNomes({});
      setLinhas({});
    } catch (err: any) {
      setErro(err.message || "Erro ao carregar usuários.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  // ── Criar ──────────────────────────────────────────────────────────────────
  const rCriar = useMemo(() => mesclar(
    validarUsuario(
      { email: novoEmail, nomeCompleto: novoNome, perfil: novoPerfil, funcao: novaFuncao || null },
      { usuarios, modo: "criar", funcoes: funcoesCad }
    ),
    rApiCriar,
  ), [novoEmail, novoNome, novoPerfil, novaFuncao, usuarios, rApiCriar, funcoesCad]);

  const invalidoCriar = (campo: string) => (tentouCriar && rCriar.erros[campo]?.length ? "val-invalido" : undefined);

  async function criarUsuario() {
    setErroCriar(null);
    setMensagem(null);
    setConviteCriado(null);
    setTentouCriar(true);
    if (temErros(rCriar)) return;
    setCriando(true);
    try {
      const resp = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: novoEmail.trim().toLowerCase(),
          nomeCompleto: normalizarEspacos(novoNome),
          perfil: novoPerfil,
          funcao: novaFuncao || null,
        }),
      });
      const dados = await lerJson(resp);
      if (!resp.ok) {
        setRApiCriar(resultadoDaApi(dados, "email"));
        if (!dados.erros) setErroCriar(dados.erro || "Falha ao criar usuário.");
        return;
      }
      const emailCriado = novoEmail.trim().toLowerCase();
      setMensagem(`Usuário ${emailCriado} criado.${dados.usuario && !dados.usuario.ativo ? " Marque \"Ativo\" na lista para liberar o acesso." : ""}`);
      if (dados.convite) setConviteCriado({ ...dados.convite, id: dados.id, email: emailCriado });
      setNovoEmail("");
      setNovoNome("");
      setNovoPerfil("operacoes");
      setNovaFuncao("");
      setTentouCriar(false);
      setRApiCriar(novoResultado());
      carregar();
    } catch (err: any) {
      setErroCriar("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setCriando(false);
    }
  }

  // ── Linhas ─────────────────────────────────────────────────────────────────
  function marcarLinha(id: string, estado: EstadoLinha | null) {
    setLinhas((prev) => {
      const n = { ...prev };
      if (estado) n[id] = estado; else delete n[id];
      return n;
    });
  }

  /** PATCH de uma linha com a versão lida. Devolve a resposta (ou null). */
  async function patchUsuario(u: Profile, campos: Record<string, unknown>, campoPadrao: string): Promise<any | null> {
    setMensagem(null);
    try {
      const resp = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...campos, versao: u.updated_at }),
      });
      const dados = await lerJson(resp);
      if (!resp.ok) {
        marcarLinha(u.id, { r: resultadoDaApi(dados, campoPadrao), conflito: !!dados.conflitoVersao });
        return null;
      }
      if (dados.usuario) setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...dados.usuario } : x)));
      return dados;
    } catch {
      const r = novoResultado();
      addErro(r, campoPadrao, "Sem conexão com o servidor. Tente de novo.");
      marcarLinha(u.id, { r });
      return null;
    }
  }

  /** Resultado da validação do nome digitado numa linha. */
  function rNomeLinha(u: Profile): ResultadoValidacao | null {
    const rascunho = nomes[u.id];
    if (rascunho === undefined || normalizarEspacos(rascunho) === normalizarEspacos(u.nome_completo)) return null;
    return validarUsuario({ nomeCompleto: rascunho }, { usuarios, modo: "editar", id: u.id, nomeAnterior: u.nome_completo });
  }

  async function salvarNome(u: Profile) {
    const rascunho = nomes[u.id];
    const r = rNomeLinha(u);
    if (!r) return;
    if (temErros(r)) {
      marcarLinha(u.id, { r });
      return;
    }
    const dados = await patchUsuario(u, { nomeCompleto: normalizarEspacos(rascunho) }, "nomeCompleto");
    if (!dados) return;
    setNomes((prev) => { const n = { ...prev }; delete n[u.id]; return n; });
    const rOk = novoResultado();
    Object.entries(dados.avisos || {}).forEach(([c, l]) => (l as string[]).forEach((m) => addAviso(rOk, c, m)));
    marcarLinha(u.id, { r: rOk, ok: "Nome atualizado." });
  }

  async function atualizarUsuario(u: Profile, campos: { perfil?: string; funcao?: string | null; ativo?: boolean }, campoPadrao: string) {
    const dados = await patchUsuario(u, campos, campoPadrao);
    if (!dados) return;
    let ok = campos.perfil !== undefined ? "Área / Acesso atualizada."
      : campos.funcao !== undefined ? "Função atualizada."
      : campos.ativo ? "Usuário ativado. (Reativar não devolve o usuário às equipes de que saiu.)" : "Usuário desativado.";
    ok += textoRemocao(dados.agendamentos);
    marcarLinha(u.id, { r: novoResultado(), ok });
  }

  async function pedirDesativar(u: Profile) {
    setDesativar({ u, agendamentos: null, erro: null });
    try {
      const resp = await fetch(`/api/admin/users/${u.id}?impacto=desativar`);
      const dados = await lerJson(resp);
      if (!resp.ok) throw new Error(dados.erro || "Não foi possível consultar os agendamentos.");
      setDesativar({ u, agendamentos: dados.agendamentos || [], erro: null });
    } catch (e: any) {
      setDesativar({ u, agendamentos: null, erro: e.message || "Não foi possível consultar os agendamentos." });
    }
  }

  async function confirmarDesativar() {
    if (!desativar) return;
    setDesativando(true);
    const atual = usuarios.find((x) => x.id === desativar.u.id) || desativar.u;
    await atualizarUsuario(atual, { ativo: false }, "ativo");
    setDesativando(false);
    setDesativar(null);
  }

  // ── Links por e-mail ───────────────────────────────────────────────────────
  async function enviarLink(u: { id: string; email: string }, tipo: TipoLinkAcesso, origem: "linha" | "criado" = "linha") {
    setEnviandoLink(`${u.id}:${tipo}`);
    let r: EnvioLink;
    try {
      const resp = await fetch(`/api/admin/users/${u.id}/acesso`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo }),
      });
      const dados = await lerJson(resp);
      r = resp.ok ? dados : { tipo, enviado: false, motivo: null, erro: dados.erro || "Falha ao gerar o link." };
    } catch {
      r = { tipo, enviado: false, motivo: null, erro: "Sem conexão com o servidor. Tente de novo." };
    }
    setEnviandoLink(null);
    if (origem === "criado") setConviteCriado({ ...r, id: u.id, email: u.email });
    else setEnvios((prev) => ({ ...prev, [u.id]: { ...r, email: u.email } }));
    // Atualiza o "Convite enviado em…" da linha (sem recarregar tudo).
    if (!r.erro) {
      try {
        const resp = await fetch("/api/admin/users");
        const dados = await lerJson(resp);
        if (resp.ok) setAcesso(dados.acesso || {});
      } catch { /* fica o que estava */ }
    }
  }

  // ── Senha ──────────────────────────────────────────────────────────────────
  function abrirSenha(u: Profile) {
    setSenhaAlvo(u);
    setSenha1("");
    setSenha2("");
    setMostrarSenha(false);
    setTentouSenha(false);
    setErroSenha(null);
  }

  const rSenha = useMemo(() => {
    const r = novoResultado();
    if (!senha1) addErro(r, "senha", "Informe a nova senha.");
    else if (senha1.length < SENHA_MINIMA) addErro(r, "senha", `A senha deve ter ao menos ${SENHA_MINIMA} caracteres.`);
    if (senha1 && senha2 !== senha1) addErro(r, "confirmar", "A confirmação não confere com a nova senha.");
    return r;
  }, [senha1, senha2]);

  async function salvarSenha() {
    if (!senhaAlvo) return;
    setTentouSenha(true);
    setErroSenha(null);
    if (temErros(rSenha)) return;
    setSalvandoSenha(true);
    try {
      const resp = await fetch(`/api/admin/users/${senhaAlvo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha: senha1 }),
      });
      const dados = await lerJson(resp);
      if (!resp.ok) {
        setErroSenha(dados.erro || "Falha ao redefinir a senha.");
        return;
      }
      marcarLinha(senhaAlvo.id, { r: novoResultado(), ok: "Senha redefinida. Repasse a nova senha ao usuário por um canal seguro." });
      setSenha1("");
      setSenha2("");
      setSenhaAlvo(null);
    } catch {
      setErroSenha("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setSalvandoSenha(false);
    }
  }

  async function excluirUsuario(u: Profile) {
    if (!window.confirm(`Excluir definitivamente o usuário ${u.email}?\n\nEssa ação não pode ser desfeita.`)) return;
    setMensagem(null);
    try {
      const resp = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      const dados = await lerJson(resp);
      if (!resp.ok) {
        marcarLinha(u.id, { r: resultadoDaApi(dados, "excluir") });
        return;
      }
      setUsuarios((prev) => prev.filter((x) => x.id !== u.id));
      setMensagem(`Usuário ${u.email} excluído.${textoRemocao(dados.agendamentos)}`);
    } catch {
      const r = novoResultado();
      addErro(r, "excluir", "Sem conexão com o servidor. Tente de novo.");
      marcarLinha(u.id, { r });
    }
  }

  const aoMudarFuncoes = useCallback(() => { carregar(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function trocarAba(nova: Aba) {
    if (nova === aba) return;
    if (aba === "permissoes" && pendentesPermissoes > 0
      && !window.confirm("Há permissões marcadas e não salvas. Sair da aba e descartar?")) return;
    if (aba === "permissoes") setPendentesPermissoes(0);
    setAba(nova);
    if (nova !== "usuarios") {
      // 1ª vez: o hook carrega; depois, recarrega (nº de usuários atualizado).
      if (abriuFuncoes) estadoFuncoes.carregar(); else setAbriuFuncoes(true);
    }
  }

  if (carregando) return <p>Carregando...</p>;

  if (!autorizado) {
    return <p>Esta página é exclusiva para administradores.</p>;
  }

  const abas = (
    <div className="abas-tela" role="tablist" aria-label="Administração de usuários">
      {ABAS.map((a) => (
        <button key={a.id} type="button" role="tab" id={`aba-${a.id}`} aria-selected={aba === a.id} aria-controls={`painel-${a.id}`}
          className="aba-tela" onClick={() => trocarAba(a.id)}>
          {a.rotulo}
          {a.id === "permissoes" && pendentesPermissoes > 0 && <span className="chip chip-aviso">{pendentesPermissoes}</span>}
        </button>
      ))}
    </div>
  );

  if (aba !== "usuarios") {
    return (
      <div>
        {abas}
        <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
          {aba === "funcoes"
            ? <AbaFuncoes estado={estadoFuncoes} onMudou={aoMudarFuncoes} />
            : <AbaPermissoes estado={estadoFuncoes} onMudou={aoMudarFuncoes} onPendentes={setPendentesPermissoes} />}
        </div>
      </div>
    );
  }

  // Resumo das linhas com erro (perto do título da lista).
  const linhasComErro = usuarios.filter((u) => linhas[u.id] && temErros(linhas[u.id].r));

  return (
    <div>
      {abas}
      <div role="tabpanel" id="painel-usuarios" aria-labelledby="aba-usuarios">
      <section className="card">
        <h2>Criar novo usuário</h2>
        <div className="grid">
          <div className="field">
            <label>E-mail *</label>
            <input value={novoEmail} onChange={(e) => { setNovoEmail(e.target.value); setRApiCriar(novoResultado()); }}
              type="email" className={invalidoCriar("email")} autoComplete="off" />
            <MensagensCampo r={rCriar} campo="email" mostrarErros={tentouCriar} />
          </div>
          <div className="field">
            <label>Nome completo *</label>
            <input value={novoNome} onChange={(e) => { setNovoNome(e.target.value); setRApiCriar(novoResultado()); }}
              placeholder="Nome e sobrenome" className={invalidoCriar("nomeCompleto")} />
            <MensagensCampo r={rCriar} campo="nomeCompleto" mostrarErros={tentouCriar} />
          </div>
          <div className="field">
            <label>Área / Acesso *</label>
            <select value={novoPerfil} onChange={(e) => { setNovoPerfil(e.target.value); setRApiCriar(novoResultado()); }} className={invalidoCriar("perfil")}>
              {PERFIS_ACESSO.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
            <MensagensCampo r={rCriar} campo="perfil" mostrarErros={tentouCriar} />
          </div>
          <div className="field">
            <label>Função</label>
            <select value={novaFuncao} onChange={(e) => { setNovaFuncao(e.target.value); setRApiCriar(novoResultado()); }} className={invalidoCriar("funcao")}>
              <option value="">— Selecione —</option>
              {opcoesFuncao(funcoesCad || []).map((o) => <option key={o.nome} value={o.nome}>{o.rotulo}</option>)}
            </select>
            <MensagensCampo r={rCriar} campo="funcao" mostrarErros={tentouCriar} />
          </div>
        </div>
        <p className="detalhe" style={{ marginTop: 10 }}>
          A <strong>Área</strong> (acesso) define as permissões no fluxo: Comercial (fases 1/2/6), Operações (3/4/7/8),
          Gerência (aprovações 5/9) e Administrador (tudo). A <strong>Função</strong> é o cargo do colaborador e pode
          dar permissões extras (aba “Permissões por função”).
        </p>
        <p className="detalhe" style={{ marginTop: 6 }}>
          ✉️ O usuário recebe por e-mail o convite <strong>“Criar minha senha”</strong> (válido por 24 horas, uso único).
          Ninguém — nem o administrador — fica sabendo a senha.
        </p>
        <ResumoValidacao r={rCriar} rotulos={ROTULOS_USUARIO} mostrarErros={tentouCriar} />
        <div className="actions">
          <button className="btn" onClick={criarUsuario} disabled={criando}>
            {criando ? "Criando..." : "Criar usuário"}
          </button>
          {erroCriar && <span className="msg erro">{erroCriar}</span>}
          {mensagem && <span className="msg ok">{mensagem}</span>}
        </div>
        {conviteCriado && (
          <AvisoEnvio envio={conviteCriado} email={conviteCriado.email}
            reenviando={enviandoLink === `${conviteCriado.id}:convite`}
            onReenviar={() => enviarLink(conviteCriado, "convite", "criado")} />
        )}
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h2>Usuários cadastrados ({usuariosFiltrados.length}{filtrosAtivos ? ` de ${usuarios.length}` : ""})</h2>
        </div>

        {erro && <p className="msg erro">{erro}</p>}
        {linhasComErro.length > 0 && (
          <div className="val-resumo" role="status">
            <strong className="val-erro">⛔ Não gravado:</strong>
            <ul>
              {linhasComErro.map((u) => (
                <li key={u.id}>{u.nome_completo || u.email}: {Object.values(linhas[u.id].r.erros).flat()[0]}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", margin: "0 0 16px" }}>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label>Nome</label>
            <input value={filtroNome} onChange={(e) => setFiltroNome(e.target.value)} placeholder="Buscar por nome" />
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label>E-mail</label>
            <input value={filtroEmail} onChange={(e) => setFiltroEmail(e.target.value)} placeholder="Buscar por e-mail" />
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label>Área / Acesso</label>
            <select value={filtroPerfil} onChange={(e) => setFiltroPerfil(e.target.value)}>
              <option value="">Todos</option>
              {PERFIS_ACESSO.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
              <option value="editor">Editor (legado)</option>
              <option value="visualizador">Visualizador (legado)</option>
            </select>
          </div>
          {filtrosAtivos && (
            <button type="button" className="btn-doc" onClick={() => { setFiltroNome(""); setFiltroEmail(""); setFiltroPerfil(""); }}>
              Limpar filtros
            </button>
          )}
        </div>

        {usuariosFiltrados.length === 0 && (
          <p className="vazio">Nenhum usuário encontrado com esses filtros.</p>
        )}

        {usuariosVisiveis.map((u) => {
          const estado = linhas[u.id];
          const rNome = rNomeLinha(u);
          // Nome gravado incompleto (cadastros antigos): só avisa, não trava o resto.
          const rLinha = mesclar(estado?.r || novoResultado(), rNome || novoResultado());
          if (!rNome && !nomeCompletoValido(u.nome_completo)) {
            addAviso(rLinha, "nomeCompleto", u.nome_completo ? "Nome incompleto — complete o nome (nome e sobrenome)." : "Sem nome — complete o nome (nome e sobrenome).");
          }
          const souEu = u.id === meuId;
          // Mesma regra da API: o que travaria rebaixar / desativar / excluir.
          const bloqueioPerfil = checarAlteracaoAcesso({ alvo: u, autorId: meuId || "", alteracao: { perfil: "comercial" }, usuarios });
          const travaAtivo = u.ativo ? checarAlteracaoAcesso({ alvo: u, autorId: meuId || "", alteracao: { ativo: false }, usuarios }) : null;
          const travaExcluir = checarAlteracaoAcesso({ alvo: u, autorId: meuId || "", alteracao: { excluir: true }, usuarios });
          const ac = acesso[u.id];
          const statusConvite = textoConvite(ac);
          const nuncaEntrou = !!ac?.loginConhecido && !ac.ultimoLogin;
          const envio = envios[u.id];
          const explicacao = souEu
            ? "Você não pode mudar o próprio acesso, se desativar nem se excluir — peça a outro administrador."
            : bloqueioPerfil?.erro || travaAtivo?.erro || null;
          return (
            <div className="item-analise" key={u.id}>
              <div className="item-analise-cabecalho">
                <span className="etapa-badge">{u.email}</span>
                <span>
                  {u.nome_completo || <em>sem nome</em>}
                  {u.funcao ? ` · ${u.funcao}` : ""}
                  {AREA_POR_PERFIL[u.perfil] ? ` · ${AREA_POR_PERFIL[u.perfil]}` : ""}
                  {souEu ? " · você" : ""}
                  {!u.ativo ? " · inativo" : ""}
                </span>
              </div>
              {(statusConvite || nuncaEntrou) && (
                <p className="detalhe" style={{ margin: "6px 0 0" }}>
                  {statusConvite ? `✉️ ${statusConvite}` : "Ainda não acessou o sistema."}
                </p>
              )}
              <div className="grid" style={{ marginTop: 8 }}>
                <div className="field">
                  <label>Nome completo</label>
                  <input
                    value={nomes[u.id] ?? (u.nome_completo || "")}
                    placeholder="Nome e sobrenome"
                    className={rNome && temErros(rNome) ? "val-invalido" : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNomes((prev) => ({ ...prev, [u.id]: v }));
                      if (estado) marcarLinha(u.id, null);
                    }}
                    onBlur={() => salvarNome(u)}
                  />
                  <small>Salva ao sair do campo.</small>
                  <MensagensCampo r={rLinha} campo="nomeCompleto" />
                </div>
                <div className="field">
                  <label>Área / Acesso</label>
                  <select value={u.perfil} disabled={!!bloqueioPerfil}
                    title={bloqueioPerfil?.erro}
                    onChange={(e) => atualizarUsuario(u, { perfil: e.target.value }, "perfil")}>
                    {PERFIS_ACESSO.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                    {ehPerfilLegado(u.perfil) && <option value={u.perfil} disabled>{u.perfil} (legado — escolha um novo)</option>}
                  </select>
                  <MensagensCampo r={rLinha} campo="perfil" />
                </div>
                <div className="field">
                  <label>Função</label>
                  <select value={u.funcao || ""} onChange={(e) => atualizarUsuario(u, { funcao: e.target.value || null }, "funcao")}>
                    <option value="">— Não definida —</option>
                    {opcoesFuncao(funcoesCad || [], u.funcao).map((o) => <option key={o.nome} value={o.nome} disabled={o.desativada}>{o.rotulo}</option>)}
                  </select>
                  <MensagensCampo r={rLinha} campo="funcao" />
                </div>
              </div>
              <div style={{ display: "flex", gap: 20, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }} title={travaAtivo?.erro}>
                  <input type="checkbox" checked={u.ativo} disabled={!!travaAtivo}
                    onChange={(e) => (e.target.checked ? atualizarUsuario(u, { ativo: true }, "ativo") : pedirDesativar(u))} />
                  Ativo
                </label>
                <button type="button" className="btn-doc" onClick={() => abrirSenha(u)}>
                  🔑 Redefinir senha
                </button>
                <button type="button" className="btn-doc" disabled={!u.ativo || enviandoLink === `${u.id}:redefinicao`}
                  title={u.ativo ? "Envia um link (válido por 1 hora) para a pessoa escolher a nova senha" : "Usuário inativo"}
                  onClick={() => enviarLink(u, "redefinicao")}>
                  {enviandoLink === `${u.id}:redefinicao` ? "Enviando..." : "✉️ Enviar link de redefinição por e-mail"}
                </button>
                {nuncaEntrou && (
                  <button type="button" className="btn-doc" disabled={!u.ativo || enviandoLink === `${u.id}:convite`}
                    title={u.ativo ? "Novo convite (válido por 24 horas); o anterior deixa de valer" : "Usuário inativo"}
                    onClick={() => enviarLink(u, "convite")}>
                    {enviandoLink === `${u.id}:convite` ? "Enviando..." : "✉️ Reenviar convite"}
                  </button>
                )}
                <button type="button" className="btn-dl btn-sec btn-perigo" disabled={!!travaExcluir} title={travaExcluir?.erro}
                  onClick={() => excluirUsuario(u)}>
                  🗑️ Excluir usuário
                </button>
              </div>
              {explicacao && <p className="detalhe" style={{ margin: "6px 0 0" }}>🔒 {explicacao}</p>}
              <MensagensCampo r={rLinha} campo="ativo" />
              <MensagensCampo r={rLinha} campo="excluir" />
              <MensagensCampo r={rLinha} campo="senha" />
              {/* Erros sem campo próprio (ex.: conexão) */}
              {Object.keys(rLinha.erros).filter((c) => !["nomeCompleto", "perfil", "funcao", "ativo", "excluir", "senha"].includes(c))
                .map((c) => <MensagensCampo key={c} r={rLinha} campo={c} />)}
              {estado?.conflito && (
                <div className="actions" style={{ marginTop: 6 }}>
                  <button type="button" className="btn secondary" onClick={() => carregar()}>Recarregar lista</button>
                </div>
              )}
              {estado?.ok && <p className="msg ok" style={{ margin: "6px 0 0" }}>{estado.ok}</p>}
              {envio && (
                <AvisoEnvio envio={envio} email={envio.email} reenviando={enviandoLink === `${u.id}:${envio.tipo}`}
                  onReenviar={() => enviarLink(u, envio.tipo)} />
              )}
            </div>
          );
        })}

        {usuariosFiltrados.length > qtdVisivel && (
          <div className="actions">
            <button type="button" className="btn secondary" onClick={() => setQtdVisivel((v) => v + 5)}>
              Ver mais ({usuariosFiltrados.length - qtdVisivel} restante{usuariosFiltrados.length - qtdVisivel === 1 ? "" : "s"})
            </button>
          </div>
        )}
      </section>

      {senhaAlvo && (
        <Modal titulo={`Redefinir senha — ${senhaAlvo.nome_completo || senhaAlvo.email}`} onFechar={() => setSenhaAlvo(null)} zIndex={200}>
          <form onSubmit={(e) => { e.preventDefault(); salvarSenha(); }}>
            <p className="detalhe" style={{ marginTop: 0 }}>Login: <strong>{senhaAlvo.email}</strong></p>
            <div className="field">
              <label>Nova senha *</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input type={mostrarSenha ? "text" : "password"} value={senha1} onChange={(e) => setSenha1(e.target.value)}
                  autoComplete="new-password" autoFocus style={{ flex: 1, minWidth: 0 }}
                  className={tentouSenha && rSenha.erros.senha?.length ? "val-invalido" : undefined} />
                <button type="button" className="btn-doc" onClick={() => setMostrarSenha((v) => !v)}
                  aria-pressed={mostrarSenha} title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}>
                  {mostrarSenha ? "🙈 Ocultar" : "👁 Mostrar"}
                </button>
              </div>
              <small>Mínimo {SENHA_MINIMA} caracteres.</small>
              <MensagensCampo r={rSenha} campo="senha" mostrarErros={tentouSenha} />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Confirmar nova senha *</label>
              <input type={mostrarSenha ? "text" : "password"} value={senha2} onChange={(e) => setSenha2(e.target.value)}
                autoComplete="new-password"
                className={tentouSenha && rSenha.erros.confirmar?.length ? "val-invalido" : undefined} />
              <MensagensCampo r={rSenha} campo="confirmar" mostrarErros={tentouSenha} />
            </div>
            <div className="actions">
              <button className="btn" type="submit" disabled={salvandoSenha}>{salvandoSenha ? "Salvando..." : "Redefinir senha"}</button>
              <button className="btn secondary" type="button" onClick={() => setSenhaAlvo(null)}>Cancelar</button>
              {erroSenha && <span className="msg erro">⛔ {erroSenha}</span>}
            </div>
          </form>
        </Modal>
      )}

      {desativar && (
        <Modal titulo={`Desativar ${desativar.u.nome_completo || desativar.u.email}?`} onFechar={() => !desativando && setDesativar(null)} zIndex={200}>
          <p style={{ marginTop: 0 }}>O usuário perde o acesso ao sistema. O histórico (projetos, OSs, relatórios) é mantido.</p>
          {desativar.erro && <p className="msg erro">⛔ {desativar.erro}</p>}
          {!desativar.erro && desativar.agendamentos === null && <p className="detalhe">Consultando agendamentos futuros…</p>}
          {desativar.agendamentos && desativar.agendamentos.length === 0 && (
            <p className="detalhe">Não está na equipe de nenhum agendamento futuro.</p>
          )}
          {desativar.agendamentos && desativar.agendamentos.length > 0 && (
            <>
              <p>
                Será <strong>removido da equipe</strong> de {desativar.agendamentos.length} agendamento{desativar.agendamentos.length === 1 ? "" : "s"} futuro{desativar.agendamentos.length === 1 ? "" : "s"};
                o restante da equipe será avisado:
              </p>
              <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                {desativar.agendamentos.map((a) => (
                  <li key={a.id}>
                    <strong>{a.os}</strong>{a.projeto ? ` (${a.projeto})` : ""} — {a.tipoLabel}, {a.quando}
                    {a.ficaSemEquipe && <span className="val-aviso"> · ⚠️ ficará sem equipe (Comercial e Gerência serão avisados)</span>}
                  </li>
                ))}
              </ul>
              <p className="detalhe">Reativar depois não devolve o usuário a essas equipes.</p>
            </>
          )}
          <div className="actions">
            <button className="btn" type="button" onClick={confirmarDesativar}
              disabled={desativando || (!desativar.erro && desativar.agendamentos === null)}>
              {desativando ? "Desativando..." : "Desativar"}
            </button>
            <button className="btn secondary" type="button" onClick={() => setDesativar(null)} disabled={desativando}>Cancelar</button>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}
