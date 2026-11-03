-- ============================================================================
-- ASP — Robô ASP: respostas guardadas das dúvidas de USO (sem dados do banco).
--
--   gp_assistente_cache  pergunta normalizada → resposta. Só entram respostas
--                        que não consultaram o banco, de uma pergunta sem
--                        conversa anterior e fora de página de OS/projeto/
--                        cliente. `versao` muda quando o manual, as instruções
--                        ou os exemplos aprovados mudam (a resposta antiga
--                        deixa de valer). Validade: 30 dias. Um 👎 na resposta
--                        apaga a entrada.
--                        Sem policy: só o servidor (service role) lê e grava —
--                        nenhum usuário consegue pôr uma resposta falsa aqui.
-- Idempotente. Usa só $$.
-- ============================================================================

create table if not exists public.gp_assistente_cache (
  chave text not null,
  versao text not null,
  pergunta text not null,
  resposta text not null,
  usos integer not null default 0,
  criado_em timestamptz not null default now(),
  ultimo_uso timestamptz,
  primary key (chave, versao)
);
create index if not exists gp_assistente_cache_criado_idx on public.gp_assistente_cache (criado_em);

alter table public.gp_assistente_cache enable row level security;
