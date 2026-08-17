-- ============================================================================
-- Plataforma IVM Lite — Fase 1: multi-tenant por incorporadora
--
-- Aplicar no SQL Editor do Supabase, DEPOIS de 0001_ivm_lite.sql.
-- Idempotente: pode rodar mais de uma vez sem quebrar.
--
-- O que muda:
--   1. Nasce a tabela `incorporadoras` (primeiro segmento da URL pública).
--   2. `ivm_lites` ganha `incorporadora_id`.
--   3. O slug do empreendimento deixa de ser único no mundo e passa a ser
--      único DENTRO da incorporadora — duas incorporadoras podem ter um
--      "residencial-aurora" cada uma.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Incorporadoras
-- ---------------------------------------------------------------------------
create table if not exists incorporadoras (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,              -- "farias" → /farias/...
  nome       text not null,
  logo_url   text,
  tema       jsonb not null default '{}'::jsonb, -- cores/fontes herdadas pelos projetos
  owner      uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Barreira no banco contra slugs que colidem com rotas do sistema. O cliente
-- também valida (SLUGS_RESERVADOS em lib/ivm-store.ts), mas a regra tem de
-- existir aqui: é o banco que garante, não a interface.
alter table incorporadoras drop constraint if exists incorporadoras_slug_nao_reservado;
alter table incorporadoras add constraint incorporadoras_slug_nao_reservado
  check (slug not in (
    'admin','api','v','editor','explorar','assets','models','gallery',
    'plantas','videos','fonts','brand','public','static','login','app',
    'cesium','src','node_modules','favicon.ico','index.html'
  ));

-- Slug precisa ser minúsculo, sem espaço e sem acento — é URL.
alter table incorporadoras drop constraint if exists incorporadoras_slug_formato;
alter table incorporadoras add constraint incorporadoras_slug_formato
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

drop trigger if exists incorporadoras_updated on incorporadoras;
create trigger incorporadoras_updated before update on incorporadoras
  for each row execute function ivm_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Vínculo do empreendimento com a incorporadora
-- ---------------------------------------------------------------------------
alter table ivm_lites
  add column if not exists incorporadora_id uuid references incorporadoras(id) on delete set null;

create index if not exists ivm_lites_incorporadora_idx on ivm_lites(incorporadora_id);

-- ---------------------------------------------------------------------------
-- 3. Slug único POR incorporadora (antes era global)
-- ---------------------------------------------------------------------------
-- O nome da constraint criada por `slug text unique` em 0001 é ivm_lites_slug_key.
alter table ivm_lites drop constraint if exists ivm_lites_slug_key;

-- Projetos ainda sem dona continuam válidos: o índice parcial abaixo mantém a
-- unicidade global só entre os órfãos, para /v/{slug} não ficar ambíguo.
create unique index if not exists ivm_lites_slug_por_incorporadora
  on ivm_lites (incorporadora_id, slug)
  where incorporadora_id is not null;

create unique index if not exists ivm_lites_slug_sem_incorporadora
  on ivm_lites (slug)
  where incorporadora_id is null;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
alter table incorporadoras enable row level security;

-- Leitura pública: um visitante anônimo precisa resolver /farias/... antes de
-- saber se o projeto existe. A tabela só guarda nome, slug, logo e tema.
drop policy if exists incorporadoras_public_read on incorporadoras;
create policy incorporadoras_public_read on incorporadoras
  for select using (true);

-- Escrita: só quem está autenticado, e apenas nas suas.
drop policy if exists incorporadoras_owner_all on incorporadoras;
create policy incorporadoras_owner_all on incorporadoras
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. Semente: a incorporadora do piloto
-- ---------------------------------------------------------------------------
-- Cria "farias" e adota APENAS o piloto, para ele passar a responder em
-- /farias/quinta-das-mangueiras. Os demais projetos ficam sem dona de
-- propósito: continuam em /v/{slug} até você atribuí-los no /admin — adotar
-- tudo em massa aqui poderia colocar um projeto de teste sob a marca errada.
insert into incorporadoras (slug, nome)
values ('farias', 'Farias Incorporadora')
on conflict (slug) do nothing;

update ivm_lites
   set incorporadora_id = (select id from incorporadoras where slug = 'farias')
 where incorporadora_id is null
   and slug = 'quinta-das-mangueiras';
