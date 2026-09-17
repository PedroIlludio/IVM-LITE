-- 0005 — Equipe de editores: todo usuário autenticado vê e edita TUDO.
--
-- Por que existe: até aqui cada conta só enxergava e alterava o que ela mesma
-- criou (`owner = auth.uid()`). O IVM Lite é uma ferramenta interna, operada
-- por uma equipe: duas pessoas precisam trabalhar no mesmo empreendimento.
--
-- Quem é editor: QUALQUER usuário autenticado. As contas passam a ser criadas
-- só no painel do Supabase (Authentication → Users → Add user); o /admin não
-- oferece mais cadastro.
--
-- ⚠️ OBRIGATÓRIO junto com esta migração: desligar o cadastro público em
--    Authentication → Sign In / Providers → "Allow new users to sign up".
--    Com ele ligado, qualquer pessoa com a chave anônima (que é pública, vai no
--    site) consegue criar uma conta pela API e, com esta política, editar todos
--    os projetos. Tirar o botão da tela NÃO fecha essa porta.
--
-- A coluna `owner` continua existindo e sendo preenchida (quem criou), só deixa
-- de restringir o acesso. A leitura pública dos projetos publicados (vitrine)
-- não muda. O Storage (0003) já liberava upload para qualquer autenticado.
--
-- Idempotente: pode ser executado mais de uma vez.

-- Projetos
drop policy if exists ivm_lites_owner_all on ivm_lites;
drop policy if exists ivm_lites_editores_all on ivm_lites;
create policy ivm_lites_editores_all on ivm_lites
  for all to authenticated using (true) with check (true);

-- Pontos de interesse (tabela legada, mantida coerente)
drop policy if exists ivm_pois_owner_all on ivm_pois;
drop policy if exists ivm_pois_editores_all on ivm_pois;
create policy ivm_pois_editores_all on ivm_pois
  for all to authenticated using (true) with check (true);

-- Registro de arquivos (tabela legada, mantida coerente)
drop policy if exists ivm_assets_owner_all on ivm_assets;
drop policy if exists ivm_assets_editores_all on ivm_assets;
create policy ivm_assets_editores_all on ivm_assets
  for all to authenticated using (true) with check (true);

-- Incorporadoras
drop policy if exists incorporadoras_owner_all on incorporadoras;
drop policy if exists incorporadoras_editores_all on incorporadoras;
create policy incorporadoras_editores_all on incorporadoras
  for all to authenticated using (true) with check (true);
