"use client";

/** Conteúdo de "Administração de usuários" — reaproveitado pela página
 * /admin/usuarios e pelo modal aberto a partir do header (D18). */
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Profile {
  id: string;
  email: string;
  nome_completo: string | null;
  /** admin/comercial/operacoes/gerencia (novos) ou editor/visualizador (legado). */
  perfil: string;
  funcao: string | null;
  ativo: boolean;
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
const FUNCOES = ["Coordenador", "Engenheiro", "Técnico"];

function ehLegado(perfil: string) {
  return perfil === "editor" || perfil === "visualizador";
}

export default function AdminUsuariosConteudo() {
  const [carregando, setCarregando] = useState(true);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [usuarios, setUsuarios] = useState<Profile[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const [novoEmail, setNovoEmail] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoPerfil, setNovoPerfil] = useState("operacoes");
  const [novaFuncao, setNovaFuncao] = useState("");
  const [criando, setCriando] = useState(false);

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

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setAutorizado(false);
        return;
      }
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
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.erro || "Falha ao carregar usuários.");
      setUsuarios(dados.usuarios);
    } catch (err: any) {
      setErro(err.message || "Erro ao carregar usuários.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function criarUsuario() {
    setErro(null);
    setMensagem(null);
    if (!novoEmail.trim() || !novaSenha.trim()) {
      setErro("E-mail e senha são obrigatórios.");
      return;
    }
    setCriando(true);
    try {
      const resp = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: novoEmail.trim(),
          senha: novaSenha,
          nomeCompleto: novoNome.trim() || null,
          perfil: novoPerfil,
          funcao: novaFuncao || null,
        }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.erro || "Falha ao criar usuário.");
      setMensagem("Usuário criado com sucesso.");
      setNovoEmail("");
      setNovaSenha("");
      setNovoNome("");
      setNovoPerfil("operacoes");
      setNovaFuncao("");
      carregar();
    } catch (err: any) {
      setErro(err.message || "Erro ao criar usuário.");
    } finally {
      setCriando(false);
    }
  }

  async function salvarNome(id: string, nome: string) {
    setErro(null);
    setMensagem(null);
    try {
      const resp = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeCompleto: nome.trim() || null }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.erro || "Falha ao salvar o nome.");
      setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, nome_completo: nome.trim() || null } : u)));
      setMensagem("Nome atualizado.");
    } catch (err: any) {
      setErro(err.message || "Erro ao salvar o nome.");
    }
  }

  async function redefinirSenha(id: string, email: string) {
    const nova = window.prompt(`Nova senha para ${email} (mín. 6 caracteres):`);
    if (nova === null) return;
    if (nova.trim().length < 6) { setErro("A senha deve ter ao menos 6 caracteres."); return; }
    setErro(null);
    setMensagem(null);
    try {
      const resp = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha: nova.trim() }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.erro || "Falha ao redefinir a senha.");
      setMensagem(`Senha de ${email} redefinida. Repasse ao usuário.`);
    } catch (err: any) {
      setErro(err.message || "Erro ao redefinir a senha.");
    }
  }

  async function atualizarUsuario(id: string, campos: Partial<Profile>) {
    setErro(null);
    try {
      const resp = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(campos.perfil !== undefined ? { perfil: campos.perfil } : {}),
          ...(campos.ativo !== undefined ? { ativo: campos.ativo } : {}),
          ...(campos.funcao !== undefined ? { funcao: campos.funcao } : {}),
        }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.erro || "Falha ao atualizar usuário.");
      setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, ...campos } : u)));
    } catch (err: any) {
      setErro(err.message || "Erro ao atualizar usuário.");
    }
  }

  if (carregando) return <p>Carregando...</p>;

  if (!autorizado) {
    return <p>Esta página é exclusiva para administradores.</p>;
  }

  return (
    <div>
      <section className="card">
        <h2>Criar novo usuário</h2>
        <div className="grid">
          <div className="field">
            <label>E-mail *</label>
            <input value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} type="email" />
          </div>
          <div className="field">
            <label>Senha provisória *</label>
            <input value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} type="text" />
            <small>Mínimo 6 caracteres. Repasse ao usuário para o primeiro acesso.</small>
          </div>
          <div className="field">
            <label>Nome completo</label>
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
          </div>
          <div className="field">
            <label>Área / Acesso *</label>
            <select value={novoPerfil} onChange={(e) => setNovoPerfil(e.target.value)}>
              {PERFIS_ACESSO.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Função</label>
            <select value={novaFuncao} onChange={(e) => setNovaFuncao(e.target.value)}>
              <option value="">— Selecione —</option>
              {FUNCOES.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
            </select>
          </div>
        </div>
        <p className="detalhe" style={{ marginTop: 10 }}>
          A <strong>Área</strong> (acesso) define as permissões no fluxo: Comercial (fases 1/2/6), Operações (3/4/7/8),
          Gerência (aprovações 5/9) e Administrador (tudo). A <strong>Função</strong> é o cargo do colaborador.
        </p>
        <div className="actions">
          <button className="btn" onClick={criarUsuario} disabled={criando}>
            {criando ? "Criando..." : "Criar usuário"}
          </button>
          {erro && <span className="msg erro">{erro}</span>}
          {mensagem && <span className="msg ok">{mensagem}</span>}
        </div>
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h2>Usuários cadastrados ({usuariosFiltrados.length}{filtrosAtivos ? ` de ${usuarios.length}` : ""})</h2>
        </div>

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

        {usuariosVisiveis.map((u) => (
          <div className="item-analise" key={u.id}>
            <div className="item-analise-cabecalho">
              <span className="etapa-badge">{u.email}</span>
              <span>
                {u.nome_completo}
                {u.funcao ? ` · ${u.funcao}` : ""}
                {AREA_POR_PERFIL[u.perfil] ? ` · ${AREA_POR_PERFIL[u.perfil]}` : ""}
              </span>
            </div>
            <div className="grid" style={{ marginTop: 8 }}>
              <div className="field">
                <label>Nome completo</label>
                <input defaultValue={u.nome_completo || ""} placeholder="Nome do usuário"
                  onBlur={(e) => { if ((e.target.value.trim() || null) !== (u.nome_completo || null)) salvarNome(u.id, e.target.value); }} />
                <small>Salva ao sair do campo.</small>
              </div>
              <div className="field">
                <label>Área / Acesso</label>
                <select value={u.perfil} onChange={(e) => atualizarUsuario(u.id, { perfil: e.target.value })}>
                  {PERFIS_ACESSO.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                  {ehLegado(u.perfil) && <option value={u.perfil}>{u.perfil} (legado)</option>}
                </select>
              </div>
              <div className="field">
                <label>Função</label>
                <select value={u.funcao || ""} onChange={(e) => atualizarUsuario(u.id, { funcao: e.target.value || null })}>
                  <option value="">— Não definida —</option>
                  {FUNCOES.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={u.ativo} onChange={(e) => atualizarUsuario(u.id, { ativo: e.target.checked })} />
                Ativo
              </label>
              <button type="button" className="btn-doc" onClick={() => redefinirSenha(u.id, u.email)}>
                🔑 Redefinir senha
              </button>
            </div>
          </div>
        ))}

        {usuariosFiltrados.length > qtdVisivel && (
          <div className="actions">
            <button type="button" className="btn secondary" onClick={() => setQtdVisivel((v) => v + 5)}>
              Ver mais ({usuariosFiltrados.length - qtdVisivel} restante{usuariosFiltrados.length - qtdVisivel === 1 ? "" : "s"})
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
