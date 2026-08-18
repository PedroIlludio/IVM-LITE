-- 0004 — A coluna `data` de `ivm_lites`.
--
-- Por que existe: o app inteiro guarda o projeto (empreendimento, config 3D,
-- torres, pavimentos, unidades, POIs) num único jsonb chamado `data`. É o que o
-- código lê em toda consulta — `PROJECT_SELECT` começa com
-- "id, slug, name, published, data, updated_at".
--
-- Só que NENHUMA migração criava essa coluna. O `0001` previa o desenho antigo,
-- com colunas separadas (`ficha`, `placement`, `camera`, `section_cameras`,
-- `branding`) que o código abandonou; a `data` foi adicionada à mão no Supabase
-- original e nunca voltou para o repositório. Num banco novo, as tabelas nascem
-- "certas" pelas migrações e mesmo assim toda listagem falha, porque o SELECT
-- pede uma coluna que não existe — sintoma: o /admin não mostra empreendimento
-- nenhum.
--
-- Idempotente: se a coluna já existe (bancos antigos), não faz nada.

alter table ivm_lites
  add column if not exists data jsonb not null default '{}'::jsonb;

-- As colunas do desenho antigo continuam existindo, sem uso. Não são removidas
-- aqui de propósito: um banco em produção pode ter dados nelas, e descartá-los
-- é decisão de quem opera, não efeito colateral de uma migração de correção.
comment on column ivm_lites.data is
  'Projeto completo (empreendimento + config 3D + unidades). Fonte da verdade; '
  'as colunas ficha/placement/camera/section_cameras/branding são legado sem uso.';
