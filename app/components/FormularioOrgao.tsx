"use client";

/** D37: formulário de cadastro de órgão, extraído de OrgaosConteudo para ser
 * reaproveitado também no modal "+ Novo órgão" do Follow-up — mesmo
 * formulário completo (tipo, razão social, CNPJ, cidade, UF e contatos),
 * em vez do atalho reduzido que existia antes.
 * Validação: lib/validacao/cliente.ts (CNPJ válido e único, razão social
 * parecida, cidade com outra grafia na mesma UF, endereço em branco,
 * contatos), mensagens junto de cada campo + resumo no botão. */
import { useEffect, useMemo, useRef, useState } from "react";
import { NovoContatoInput, OrgaoComAcoes, TipoEnte, UFS_BRASIL } from "@/lib/orgaos/types";
import { mascaraCnpj, mascaraTelefone } from "@/lib/mascaras";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import {
  cidadesParecidas, ClienteRef, mesclar, normalizarCidade, normalizarCnpj, normalizarEspacos, novoResultado, ResultadoValidacao,
  ROTULOS_CLIENTE, temErros, validarCliente, validarContatos,
} from "@/lib/validacao";

/** Clientes que conflitam com o digitado (CNPJ igual / razão parecida),
 * consultados em /api/orgaos/verificar com debounce. Também usado na
 * edição do cliente (app/orgaos/[id]). */
export function useClientesConflitantes(cnpj: string, razaoSocial: string, excluirId?: string): ClienteRef[] {
  const [clientes, setClientes] = useState<ClienteRef[]>([]);
  const seq = useRef(0);
  const digitos = normalizarCnpj(cnpj);
  const razao = normalizarEspacos(razaoSocial);
  useEffect(() => {
    const n = ++seq.current;
    if (!razao && digitos.length !== 14) { setClientes([]); return; }
    const t = setTimeout(() => {
      const q = new URLSearchParams({ cnpj: digitos.length === 14 ? digitos : "", razaoSocial: razao, excluirId: excluirId || "" });
      fetch(`/api/orgaos/verificar?${q}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && n === seq.current) setClientes(d.clientes || []); })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [digitos, razao, excluirId]);
  return clientes;
}

/** Grafias de cidade já usadas por clientes na UF (/api/orgaos/verificar). */
export function useCidadesDaUf(uf: string, excluirId?: string): string[] {
  const [cidades, setCidades] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    if (!uf) { setCidades([]); return; }
    const q = new URLSearchParams({ uf, excluirId: excluirId || "" });
    fetch(`/api/orgaos/verificar?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && vivo) setCidades(d.cidades || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [uf, excluirId]);
  return cidades;
}

/** Botões "Usar “São José dos Campos”" para a cidade com outra grafia. */
export function SugestoesCidade({ cidade, cidades, onUsar }: { cidade: string; cidades: string[]; onUsar: (c: string) => void }) {
  const sugestoes = cidadesParecidas(cidade, cidades);
  if (!sugestoes.length) return null;
  return (
    <>
      {sugestoes.map((c) => (
        <button key={c} type="button" className="val-acao" onClick={() => onUsar(c)}>Usar “{c}”</button>
      ))}
    </>
  );
}

function novoContatoVazio(): NovoContatoInput {
  return { nomeCompleto: "", cargo: "", telefone: "", email: "" };
}

export default function FormularioOrgao({
  onSucesso,
  onCancelar,
}: {
  onSucesso: (orgao: OrgaoComAcoes) => void;
  onCancelar?: () => void;
}) {
  // Cliente industrial não tem "tipo de ente" (conceito de órgão público). A
  // coluna gp_orgaos.tipo_ente é NOT NULL, então mantemos um valor padrão fixo
  // no backend sem expor o campo na UI de Clientes.
  const tipoEnte: TipoEnte = "Município";
  const [razaoSocial, setRazaoSocial] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [cidade, setCidade] = useState("");
  const [endereco, setEndereco] = useState("");
  const [uf, setUf] = useState("");
  const [contatos, setContatos] = useState<NovoContatoInput[]>([novoContatoVazio()]);
  const [salvando, setSalvando] = useState(false);
  const [mensagemForm, setMensagemForm] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [tentou, setTentou] = useState(false);
  const [servidor, setServidor] = useState<ResultadoValidacao>(novoResultado());

  const conflitantes = useClientesConflitantes(cnpj, razaoSocial);
  const cidadesUf = useCidadesDaUf(uf);
  const resultado = useMemo(
    () => mesclar(
      validarCliente({ razaoSocial, cnpj, cidade, uf, endereco }, { clientes: conflitantes, cidades: cidadesUf }),
      validarContatos(contatos),
      servidor
    ),
    [razaoSocial, cnpj, cidade, uf, endereco, conflitantes, cidadesUf, contatos, servidor]
  );
  /** Erro de campo vazio só aparece depois de tentar salvar. */
  const mostrar = (valor: string | undefined) => tentou || !!valor?.trim();

  function atualizarContato(idx: number, campo: keyof NovoContatoInput, valor: string) {
    setContatos((prev) => prev.map((c, i) => (i === idx ? { ...c, [campo]: valor } : c)));
    setServidor(novoResultado());
  }

  function adicionarContato() {
    setContatos((prev) => [...prev, novoContatoVazio()]);
  }

  function removerContato(idx: number) {
    setContatos((prev) => prev.filter((_, i) => i !== idx));
    setServidor(novoResultado());
  }

  async function cadastrarOrgao() {
    setMensagemForm(null);
    setTentou(true);
    if (temErros(resultado)) {
      setMensagemForm({ tipo: "erro", texto: "Corrija os campos marcados com ⛔." });
      return;
    }

    setSalvando(true);
    try {
      const resp = await fetch("/api/orgaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Lista inteira: a API ignora blocos em branco e devolve as mensagens
        // com o índice do bloco na tela.
        body: JSON.stringify({ tipoEnte, razaoSocial, cnpj, cidade, uf, endereco, contatos }),
      });
      const dados = await resp.json();
      if (!resp.ok || !dados.ok) {
        if (dados.erros) setServidor({ erros: dados.erros, avisos: dados.avisos || {} });
        throw new Error(dados.erro || "Falha ao cadastrar o cliente.");
      }

      onSucesso(dados.orgao);
    } catch (err: any) {
      setMensagemForm({ tipo: "erro", texto: err.message || "Erro inesperado ao cadastrar o cliente." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="grid">
        <div className="field">
          <label>Razão social / Nome *</label>
          <input
            value={razaoSocial}
            onChange={(e) => { setRazaoSocial(e.target.value); setServidor(novoResultado()); }}
            onBlur={() => setRazaoSocial((v) => normalizarEspacos(v))}
            placeholder="Ex.: Refinaria Industrial S/A"
          />
          <MensagensCampo r={resultado} campo="razaoSocial" mostrarErros={mostrar(razaoSocial)} />
        </div>
        <div className="field">
          <label>CNPJ *</label>
          <input
            value={cnpj}
            onChange={(e) => { setCnpj(mascaraCnpj(e.target.value)); setServidor(novoResultado()); }}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            maxLength={18}
            className={(tentou || normalizarCnpj(cnpj).length === 14) && resultado.erros.cnpj ? "val-invalido" : undefined}
          />
          {/* CNPJ incompleto não é "inválido" enquanto se digita. */}
          <MensagensCampo r={resultado} campo="cnpj" mostrarErros={tentou || normalizarCnpj(cnpj).length === 14} />
        </div>
        <div className="field">
          <label>Cidade *</label>
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} onBlur={() => setCidade((v) => normalizarCidade(v))} />
          <MensagensCampo r={resultado} campo="cidade" mostrarErros={tentou}>
            <SugestoesCidade cidade={cidade} cidades={cidadesUf} onUsar={setCidade} />
          </MensagensCampo>
        </div>
        <div className="field">
          <label>Endereço</label>
          <input value={endereco} onChange={(e) => setEndereco(e.target.value)}
            onBlur={() => setEndereco((v) => normalizarEspacos(v))}
            placeholder="Rua, número, bairro — usado como padrão nos projetos" />
          {tentou && <MensagensCampo r={resultado} campo="endereco" />}
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
          <MensagensCampo r={resultado} campo="uf" mostrarErros={tentou} />
        </div>
      </div>

      <h3 style={{ marginTop: 16, marginBottom: 4, fontSize: 15 }}>Contatos (opcional)</h3>
      <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 0 }}>
        Responsáveis do cliente. Podem ser preenchidos agora ou depois — um bloco
        começado precisa de nome, cargo e e-mail.
      </p>

      {contatos.map((c, idx) => (
        <div key={idx} className="etapa-card">
          {contatos.length > 1 && (
            <button
              type="button"
              className="etapa-remove"
              onClick={() => removerContato(idx)}
              title="Remover contato"
            >
              remover ✕
            </button>
          )}
          <div className="grid">
            <div className="field">
              <label>Nome completo do responsável</label>
              <input
                value={c.nomeCompleto}
                onChange={(e) => atualizarContato(idx, "nomeCompleto", e.target.value)}
              />
              <MensagensCampo r={resultado} campo={`contatos.${idx}.nomeCompleto`} mostrarErros={mostrar(c.nomeCompleto)} />
            </div>
            <div className="field">
              <label>Cargo</label>
              <input value={c.cargo} onChange={(e) => atualizarContato(idx, "cargo", e.target.value)} />
              <MensagensCampo r={resultado} campo={`contatos.${idx}.cargo`} mostrarErros={mostrar(c.cargo)} />
            </div>
            <div className="field">
              <label>Telefone (com DDD)</label>
              <input
                value={c.telefone || ""}
                onChange={(e) => atualizarContato(idx, "telefone", mascaraTelefone(e.target.value))}
                placeholder="(11) 91234-5678"
                inputMode="numeric"
                maxLength={15}
              />
              <MensagensCampo r={resultado} campo={`contatos.${idx}.telefone`} />
            </div>
            <div className="field">
              <label>E-mail</label>
              <input
                type="email"
                value={c.email}
                onChange={(e) => atualizarContato(idx, "email", e.target.value)}
              />
              <MensagensCampo r={resultado} campo={`contatos.${idx}.email`} mostrarErros={mostrar(c.email)} />
            </div>
          </div>
        </div>
      ))}

      <button type="button" className="btn secondary" onClick={adicionarContato}>
        + Adicionar contato
      </button>

      {tentou && <div style={{ marginTop: 16 }}><ResumoValidacao r={resultado} rotulos={ROTULOS_CLIENTE} /></div>}

      <div className="actions" style={{ marginTop: 16 }}>
        <button className="btn" onClick={cadastrarOrgao} disabled={salvando}>
          {salvando ? "Salvando..." : "Cadastrar cliente"}
        </button>
        {onCancelar && (
          <button type="button" className="btn secondary" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </button>
        )}
        {mensagemForm && <span className={`msg ${mensagemForm.tipo}`}>{mensagemForm.texto}</span>}
      </div>
    </div>
  );
}
