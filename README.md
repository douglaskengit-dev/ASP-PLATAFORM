# ASP — Plataforma de Inspeção e Execução

Sistema interno da **ASP (Advanced Services Provider / ASP Serviços Industriais)**
para gestão de **inspeção robótica** e **execução** de serviços em tanques e
tubulações. Um Projeto (um pedido de compra) reúne várias Inspeções (tanques/
pontos), e cada inspeção percorre um fluxo de fases simétrico — **Inspeção** e
**Execução** — com coleta de dados de campo, relatórios versionados, aprovação
da gerência, agendamento com notificações e histórico auditável.

**Stack:** Next.js 14 (App Router · TypeScript · React 18) · Supabase (Postgres +
Auth + Storage, com RLS) · Vercel · Resend (e-mail, opcional) · medidor de
sedimento embutido (HTML/JS standalone).

> Produção: `asp-plataform.vercel.app` · Repo: `github.com/douglaskengit-dev/ASP-PLATAFORM`

---

## 1. Funcionalidades

**Projetos & Inspeções**
- Abertura de projeto (1 = 1 pedido de compra) com cliente, código, pedido,
  endereço da obra e responsável. Edição e **exclusão em lixeira** (soft-delete).
- Inspeções (tanques/pontos) dentro do projeto, cada uma com barra de progresso
  das fases e status (Em andamento / Aguardando aprovação / Em execução /
  Encerrado).

**Fluxo de fases (por inspeção)**
1. Abertura do Projeto (Comercial · nível projeto)
2. Agendamento de Visita/Inspeção (Comercial)
3. Coleta de Dados (Operações)
4. Relatório de Inspeção (Operações)
5. Aprovação do Relatório de Inspeção (Gerência)
6. Agendamento de Execução (Comercial)
7. Execução (Operações)
8. Relatório de Execução (Operações)
9. Aprovação do Relatório de Execução (Gerência)
10. Encerramento

Avançar registra **data de autenticação e autor**. Aprovação (fases 5/9) avança;
reprovação volta uma fase com a tag **"Ajustar"**, exigindo motivo e preservando
o histórico de versões.

**Coleta — Medidor de Sedimento**
- Ferramenta de campo embutida (cálculo local, exporta PDF). A medição é salva
  como **Relatório Técnico interno** (JSONB) — reabrível e **editável** — via
  ponte `postMessage` com o app. Anexo de PDF também suportado. Outras
  ferramentas (ultrassom, drone, MFL) marcadas como "em desenvolvimento".

**Relatórios**
- Upload **versionado** (PDF/DOCX); ciclo rascunho → em aprovação → aprovado /
  ajustar / assinado; fila de aprovação da Gerência; download por versão.

**Agendamento**
- Data + hora da visita e **data prevista de execução**; **equipe** por seleção
  de usuários; equipamentos como chips; checklist extensível (NR-33, NR-10,
  EPIs, PT…). Editar/excluir. Ao agendar, os envolvidos recebem **notificação
  in-app** e **e-mail com convite de calendário (.ics)** para a agenda do
  celular (e-mail via Resend, opcional).

**Dashboard**
- KPIs (projetos, inspeções, em andamento, aguardando aprovação, em execução,
  encerradas, progresso médio) com tooltips; gráficos (inspeções por fase,
  projetos por cliente); **calendário mensal** com datas de inspeção e execução;
  filtros por cliente, período e status.

**Clientes** (reutiliza `gp_orgaos`) — cadastro/edição, busca e filtros, e
lixeira. **Histórico** — projetos em aberto. **Arquivos** — coletas e relatórios
agrupados por projeto/inspeção, com busca e filtros.

**Notificações** — sino no header com avisos persistidos (ex.: inspeção
agendada) e as inspeções paradas numa fase sob responsabilidade do perfil do
usuário.

**Administração de usuários** — criar usuários; **Área/Acesso** (Comercial,
Operações, Gerência, Admin), **Função** (Coordenador, Engenheiro, Técnico),
editar nome, redefinir senha e ativar/inativar.

**Identidade visual** — paleta ASP (azul `#0f5cad` / amarelo `#e8c51f`), fonte
Montserrat, badge + wordmark no header, mascote nos títulos.

---

## 2. Perfis e permissões

| Área (perfil) | Atua nas fases | Observações |
|---|---|---|
| Comercial | 1, 2, 6 | abre projetos e agenda |
| Operações | 3, 4, 7, 8 | coleta e relatórios |
| Gerência | 5, 9 (+ todas) | aprova/reprova |
| Admin | tudo | + administração de usuários |

- **Excluir projeto/inspeção/cliente:** Comercial, Gerência, Admin **ou** quem
  tem a Função **Coordenador**.
- Permissões finas ficam nas API routes; o RLS garante o mínimo por perfil.
  Perfis legados (`editor`/`visualizador`) ainda são aceitos durante a migração.

---

## 3. Modelo de dados (tabelas novas do fluxo ASP)

```
gp_projetos        1 projeto = 1 pedido de compra (cliente → gp_orgaos)
  └── gp_inspecoes     N por projeto; carregam as fases 2..10
        ├── gp_coletas       medição (jsonb) + PDF do medidor
        ├── gp_relatorios    inspeção/execução, versionados
        ├── gp_agendamentos  data/hora, execução, equipe, checklist (jsonb)
        └── gp_fase_historico auditoria de fases (ação, autor, data)
gp_notificacoes    avisos in-app por usuário
gp_profiles        perfil (área) + funcao
```

Soft-delete (`excluido_em` / `excluido_por`) em `gp_projetos`, `gp_inspecoes` e
`gp_orgaos` — a exclusão vira **lixeira**, recuperável por **30 dias**, com
limpeza automática (preguiçosa) depois disso. Storage no bucket privado
`gp-arquivos` (coletas e relatórios).

> O fluxo antigo (Processos/TR/Proposta/Ofício, tabelas `gp_processos` etc.)
> permanece no repositório para reaproveitamento, mas fora da navegação.

---

## 4. Setup

Pré-requisitos: Node 18+, um projeto Supabase.

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm run dev                  # http://localhost:3000
```

**Variáveis de ambiente** (`.env.local` e Vercel):

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | chave publicável (client) |
| `SUPABASE_SECRET_KEY` | chave secreta / service_role (só servidor) |
| `NEXT_PUBLIC_APP_URL` | URL pública do app (links de e-mail) — opcional |
| `RESEND_API_KEY` | envio de e-mail (opcional; sem ela, e-mail é no-op) |
| `EMAIL_REMETENTE` | remetente, ex.: `ASP <no-reply@seudominio>` (opcional) |

**Migrations:** aplique os arquivos de `supabase/migrations/` no banco (SQL
Editor do Supabase ou `supabase db push`). Os relevantes ao fluxo ASP:

```
20260725120000_asp_novo_fluxo_v1.sql              schema + RLS + perfis
20260727100000_asp_usuario_funcao.sql             coluna funcao
20260728100000_asp_agendamento_notificacoes.sql   hora + gp_notificacoes
20260729100000_asp_agendamento_data_execucao.sql  data de execução
20260730100000_asp_projeto_soft_delete.sql        lixeira de projeto
20260731100000_asp_soft_delete_inspecao_cliente.sql lixeira de inspeção/cliente
```

**E-mail (Resend):** crie a conta, verifique um domínio em *Domains* (registros
SPF/DKIM) e defina `RESEND_API_KEY`/`EMAIL_REMETENTE`. Enquanto não configurado,
as notificações in-app funcionam normalmente e o e-mail fica desativado.

---

## 5. Estrutura

```
app/
  page.tsx                landing pública
  login/                  autenticação (Supabase)
  dashboard/              KPIs, gráficos e calendário
  projetos/               lista, detalhe, edição e lixeira
  inspecoes/[id]/         fases, coleta, agendamento, relatórios, histórico
  arquivos/               documentos por projeto/inspeção
  orgaos/                 clientes (cadastro, edição, lixeira)
  admin/usuarios/         administração de usuários
  api/                    route handlers (projetos, inspecoes, coletas,
                          relatorios, agendamentos, notificacoes, usuarios…)
  components/             BarraUsuario, Modal, TituloPagina, CalendarioAgenda,
                          NotificacoesBotao, FormularioOrgao, DashboardCharts…
lib/
  asp/fases.ts            modelo de fases e ações
  asp/permissoes.ts       regras de exclusão
  supabase/               clients (browser, route, admin/server)
  email.ts, ics.ts, email-templates.ts
public/ferramentas/       medidor de sedimento (HTML standalone)
supabase/migrations/      migrations SQL
```

---

## 6. Convenções

- Construir e validar **fase a fase**, com deploy incremental na Vercel.
- Nunca commitar segredos; chaves só via variáveis de ambiente.
- Rodar `npx tsc --noEmit` (type-check) e, quando possível, `npm run build`
  antes do push.
- Storage e operações que ignoram RLS usam o cliente admin (`SUPABASE_SECRET_KEY`),
  nunca no navegador.
