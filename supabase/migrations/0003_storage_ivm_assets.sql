-- 0003 — Bucket `ivm-assets` e suas políticas.
--
-- Por que existe: o bucket e o RLS do Storage sempre foram configurados à mão
-- no painel, e nunca acompanharam o código. Ao subir o projeto num Supabase
-- novo, a tabela `ivm_lites` nascia certa (migrações 0001/0002) e o Storage
-- nascia mudo — todo upload morria com "new row violates row-level security
-- policy", sem nada no repositório explicando o que faltava. Aqui isso vira
-- parte do projeto, como o resto do schema.
--
-- Idempotente: pode rodar mais de uma vez.

-- --- O bucket ---------------------------------------------------------------
-- Público porque o app publica os assets por `getPublicUrl`: a vitrine é uma
-- página aberta, e servir planta e GLB por URL assinada obrigaria a renovar
-- link a cada visita, sem nada a proteger.
insert into storage.buckets (id, name, public)
values ('ivm-assets', 'ivm-assets', true)
on conflict (id) do update set public = true;

-- --- Leitura ----------------------------------------------------------------
-- Bucket público já dispensa política para a URL pública, mas a regra explícita
-- mantém a leitura funcionando pela API do cliente (`storage.from().download`)
-- e deixa a intenção escrita.
drop policy if exists ivm_assets_public_read on storage.objects;
create policy ivm_assets_public_read on storage.objects
  for select using (bucket_id = 'ivm-assets');

-- --- Escrita ----------------------------------------------------------------
-- Qualquer usuário AUTENTICADO escreve no bucket. Não amarramos ao dono do
-- projeto de propósito: o upload acontece ANTES de o projeto existir na tabela
-- (é preciso ter a URL do arquivo para gravar o `data` do projeto já apontando
-- para ela), então uma política que consultasse `ivm_lites.owner` recusaria o
-- primeiro upload de todo projeto novo — inclusive o da migração local.
--
-- O modelo de ameaça é esse: conta no Supabase é dada a quem opera a
-- plataforma. Se um dia houver cadastro aberto, esta política precisa ser
-- revista junto.
drop policy if exists ivm_assets_auth_insert on storage.objects;
create policy ivm_assets_auth_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ivm-assets');

-- UPDATE é necessário por causa do `upsert: true` do cliente: reenviar o mesmo
-- arquivo (uma migração repetida, uma planta corrigida) é atualização, não
-- inserção, e sem esta política o reenvio falha.
drop policy if exists ivm_assets_auth_update on storage.objects;
create policy ivm_assets_auth_update on storage.objects
  for update to authenticated
  using (bucket_id = 'ivm-assets')
  with check (bucket_id = 'ivm-assets');

drop policy if exists ivm_assets_auth_delete on storage.objects;
create policy ivm_assets_auth_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'ivm-assets');
