"use client";

/** "Última inspeção" — painel compacto da OS SEM inspeção: a inspeção mais
 * recente do MESMO tanque (mesma identificação nos projetos do cliente) ou,
 * sem ela, do cliente — projeto, OS, data, relatório de inspeção aprovado/
 * assinado (download), medição aprovada (link para as coletas da OS de
 * origem) e o cadastro do tanque. Só leitura. Regras em
 * lib/asp/ultima-inspecao.ts; dados de /api/inspecoes/[id]/ultima-inspecao. */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { UltimaInspecao as Dados } from "@/lib/asp/ultima-inspecao";
import { resumoTanque, type Tanque } from "@/lib/asp/tanque";

const dataBr = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export default function UltimaInspecao({ inspecaoId }: { inspecaoId: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");

  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    fetch(`/api/inspecoes/${inspecaoId}/ultima-inspecao`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivo) { setDados(d.ultima || null); setEstado("ok"); } })
      .catch(() => { if (vivo) setEstado("erro"); });
    return () => { vivo = false; };
  }, [inspecaoId]);

  return (
    <section className="os-ultima" aria-labelledby="titulo-ultima-inspecao">
      <h2 id="titulo-ultima-inspecao" className="os-ultima-titulo">
        Última inspeção
        {dados && <span className={`chip ${dados.escopo === "tanque" ? "chip-info" : "chip-neutro"}`}>
          {dados.escopo === "tanque" ? "mesmo tanque" : "do cliente"}
        </span>}
      </h2>
      {estado === "carregando" ? (
        <p className="detalhe" style={{ margin: 0 }}>Procurando a inspeção anterior…</p>
      ) : estado === "erro" ? (
        <p className="detalhe" style={{ margin: 0 }}>Não foi possível consultar as inspeções anteriores.</p>
      ) : !dados ? (
        <p className="detalhe" style={{ margin: 0 }}>Nenhuma inspeção anterior encontrada para este cliente/tanque.</p>
      ) : (
        <dl className="os-ultima-dados">
          <div>
            <dt>Projeto · OS</dt>
            <dd>
              <Link href={`/projetos/${dados.projeto.id}`}>{dados.projeto.codigo}</Link>
              {" · "}
              <Link href={`/inspecoes/${dados.os.id}`}>{dados.os.identificacao}</Link>
            </dd>
          </div>
          <div><dt>Data</dt><dd>{dataBr(dados.data)}</dd></div>
          <div>
            <dt>Relatório de inspeção</dt>
            <dd>
              {dados.relatorio ? (
                <a href={dados.relatorio.href} target="_blank" rel="noopener noreferrer">
                  v{dados.relatorio.versao} — {dados.relatorio.status === "assinado" ? "assinado" : "aprovado"} (baixar)
                </a>
              ) : "nenhum aprovado"}
            </dd>
          </div>
          <div>
            <dt>Medição aprovada</dt>
            <dd>
              {dados.medicao ? (
                <>
                  <Link href={dados.medicao.href}>{dataBr(dados.medicao.data)} — ver nas coletas</Link>
                  {dados.medicao.pdf && <> · <a href={dados.medicao.pdf} target="_blank" rel="noopener noreferrer">PDF</a></>}
                </>
              ) : "nenhuma"}
            </dd>
          </div>
          <div>
            <dt>Tanque</dt>
            <dd>{dados.tanque ? resumoTanque(dados.tanque as Tanque) : "não cadastrado"}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
