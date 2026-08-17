# Migrações do Supabase

Aplicar **em ordem**, pelo SQL Editor do Supabase.

| Arquivo | O que faz | Onde está |
|---|---|---|
| `0001_ivm_lite.sql` | Tabelas base (`ivm_lites`, `ivm_pois`, `ivm_assets`) + RLS | `../../../JOOY-Empreendimentos-Map-main/supabase/migrations/` — repositório de origem, ainda não movido |
| `0002_incorporadoras.sql` | Multi-tenant: tabela `incorporadoras`, `ivm_lites.incorporadora_id`, slug único por tenant | aqui |

Se o banco já está em uso (as tabelas de `0001` existem), rode apenas o `0002`.
Ele é idempotente — pode ser executado mais de uma vez sem quebrar nada.

## Depois de aplicar o 0002

- A incorporadora `farias` é criada e o piloto passa a responder em
  `/farias/quinta-das-mangueiras`.
- Projetos sem incorporadora continuam válidos em `/v/{slug}` até serem
  atribuídos a uma no `/admin`.

## Observação sobre o formato dos dados

O `0001` previa colunas separadas (`ficha`, `placement`, `camera`,
`section_cameras`, `branding`) e uma tabela `ivm_pois`. O código **não usa** essa
divisão: o projeto inteiro vive na coluna `data` (jsonb), e os POIs ficam dentro
dela. Essas colunas continuam existindo sem uso — não é preciso removê-las, mas
saiba que a fonte da verdade é o `data`.
