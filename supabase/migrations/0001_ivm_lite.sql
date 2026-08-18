-- ============================================================================
-- Plataforma IVM Lite — schema inicial
-- Modelo: 1 IVM Lite = 1 empreendimento (vitrine 3D enxuta).
-- Aplicar via Supabase (SQL editor / migration) no projeto escolhido.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Cada linha é um IVM Lite publicável (a experiência 3D de um empreendimento).
create table if not exists ivm_lites (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,                 -- URL pública: /v/{slug}
  name            text not null,
  owner           uuid references auth.users(id) default auth.uid(),
  published       boolean not null default false,

  -- Dados do empreendimento
  address         text default '',
  neighborhood    text default '',
  status          text default 'Lançamento',
  lat             double precision,
  lng             double precision,
  ficha           jsonb not null default '{}'::jsonb,   -- terreno, torres, pavimentos, unidades,
                                                         -- peDireito, elevadores, plantas[], highlights[],
                                                         -- amenities[], descricao, website, tipo, etc.

  -- Configuração 3D
  model_asset_url text,                                  -- GLB no storage (ou /models/*)
  placement       jsonb not null default '{}'::jsonb,    -- heading,pitch,roll,scale,heightOffset,offsetEast,offsetNorth
  camera          jsonb,                                 -- CameraView inicial {lng,lat,height,heading,pitch,roll}
  section_cameras jsonb not null default '[]'::jsonb,    -- NamedCamera[]
  branding        jsonb not null default '{}'::jsonb,    -- logo, cores, etc.

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Pontos de interesse de um IVM Lite.
create table if not exists ivm_pois (
  id           uuid primary key default gen_random_uuid(),
  ivm_lite_id  uuid not null references ivm_lites(id) on delete cascade,
  name         text not null,
  categoria    text not null,               -- shopping|mercado|saude|educacao|lazer|gastronomia|servicos|academia|farmacia|via
  lat          double precision not null,
  lng          double precision not null,
  tempo        text default '',
  camera       jsonb,                        -- CameraView opcional (foco no POI)
  sort         int not null default 0
);

-- Assets (GLB / imagens) enviados pelo editor, guardados no Storage.
create table if not exists ivm_assets (
  id           uuid primary key default gen_random_uuid(),
  ivm_lite_id  uuid references ivm_lites(id) on delete cascade,
  kind         text not null,               -- 'glb' | 'image'
  path         text not null,               -- caminho no bucket ivm-assets
  url          text not null,
  size         bigint,
  created_at   timestamptz not null default now()
);

create index if not exists ivm_pois_lite_idx   on ivm_pois(ivm_lite_id);
create index if not exists ivm_assets_lite_idx on ivm_assets(ivm_lite_id);

-- updated_at automático
create or replace function ivm_set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists ivm_lites_updated on ivm_lites;
create trigger ivm_lites_updated before update on ivm_lites
  for each row execute function ivm_set_updated_at();

-- ============================================================================
-- Row Level Security: público lê publicados; dono gerencia os seus.
-- ============================================================================
alter table ivm_lites  enable row level security;
alter table ivm_pois   enable row level security;
alter table ivm_assets enable row level security;

-- Leitura pública apenas de IVM Lites publicados
create policy ivm_lites_public_read on ivm_lites
  for select using (published = true);

create policy ivm_pois_public_read on ivm_pois
  for select using (exists (
    select 1 from ivm_lites l where l.id = ivm_lite_id and l.published
  ));

create policy ivm_assets_public_read on ivm_assets
  for select using (exists (
    select 1 from ivm_lites l where l.id = ivm_lite_id and l.published
  ));

-- Dono (autenticado) faz tudo com os seus
create policy ivm_lites_owner_all on ivm_lites
  for all using (owner = auth.uid()) with check (owner = auth.uid());

create policy ivm_pois_owner_all on ivm_pois
  for all using (exists (
    select 1 from ivm_lites l where l.id = ivm_lite_id and l.owner = auth.uid()
  ));

create policy ivm_assets_owner_all on ivm_assets
  for all using (exists (
    select 1 from ivm_lites l where l.id = ivm_lite_id and l.owner = auth.uid()
  ));
