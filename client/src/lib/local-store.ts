import type { Incorporadora } from "@shared/schema";
import type { IvmProject, ProjectData } from "./ivm-store";

/**
 * Cliente do modo LOCAL: mesmas operações do store do Supabase, porém contra
 * `/api/local/*`, que grava em `data/projects/`. Sem conta, sem RLS, sem rede.
 *
 * Existe para o editor ser utilizável durante a construção da plataforma — a
 * autenticação do Supabase é a porta certa em produção, mas atrapalha o
 * trabalho local. O servidor recusa escrita quando NODE_ENV=production.
 */

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}));
    throw new Error(corpo.error || `HTTP ${r.status}`);
  }
  return (await r.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Linha crua do arquivo local (snake_case, igual ao banco). */
interface LinhaLocal {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  incorporadora_id?: string | null;
  updated_at?: string;
  data: ProjectData;
}

function toIncorporadora(row: Record<string, unknown>): Incorporadora {
  return {
    id: String(row.id),
    slug: String(row.slug),
    nome: String(row.nome ?? ""),
    logoUrl: (row.logo_url as string) ?? undefined,
    tema: (row.tema as Incorporadora["tema"]) ?? undefined,
  };
}

/** Junta o projeto com a sua incorporadora (não há join num sistema de arquivos). */
function comIncorporadora(linha: LinhaLocal, incs: Incorporadora[]): IvmProject {
  return {
    ...linha,
    incorporadora: incs.find((i) => i.id === linha.incorporadora_id) ?? null,
  };
}

// --- Incorporadoras ---------------------------------------------------------

export async function localListIncorporadoras(): Promise<Incorporadora[]> {
  const linhas = await req<Record<string, unknown>[]>("/api/local/incorporadoras");
  return linhas.map(toIncorporadora);
}

export async function localGetIncorporadoraBySlug(slug: string): Promise<Incorporadora | null> {
  const todas = await localListIncorporadoras();
  return todas.find((i) => i.slug === slug) ?? null;
}

export async function localCreateIncorporadora(
  nome: string,
  slug: string,
  logoUrl?: string,
): Promise<Incorporadora> {
  const row = await req<Record<string, unknown>>(
    "/api/local/incorporadoras",
    json({ nome, slug, logo_url: logoUrl ?? null }),
  );
  return toIncorporadora(row);
}

export async function localUpdateIncorporadora(
  id: string,
  patch: Partial<Pick<Incorporadora, "nome" | "slug" | "logoUrl" | "tema">>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.nome !== undefined) row.nome = patch.nome;
  if (patch.slug !== undefined) row.slug = patch.slug;
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl;
  if (patch.tema !== undefined) row.tema = patch.tema;
  await req(`/api/local/incorporadoras/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
}

export async function localDeleteIncorporadora(id: string): Promise<void> {
  await req(`/api/local/incorporadoras/${id}`, { method: "DELETE" });
}

// --- Projetos ---------------------------------------------------------------

export async function localListProjects(): Promise<IvmProject[]> {
  const [linhas, incs] = await Promise.all([
    req<LinhaLocal[]>("/api/local/projects"),
    localListIncorporadoras(),
  ]);
  return linhas.map((l) => comIncorporadora(l, incs));
}

export async function localGetProjectById(id: string): Promise<IvmProject | null> {
  try {
    const [linha, incs] = await Promise.all([
      req<LinhaLocal>(`/api/local/projects/${id}`),
      localListIncorporadoras(),
    ]);
    return comIncorporadora(linha, incs);
  } catch {
    return null;
  }
}

/**
 * As duas buscas abaixo servem a URL PÚBLICA, e por isso respeitam `published`.
 *
 * Sem isto o botão Publicado/Rascunho do editor não fazia nada em modo local:
 * um rascunho abria normalmente em `/incorporadora/projeto` e não havia como
 * conferir, antes de subir, o que o cliente veria. Em produção quem faz este
 * recorte é a RLS do Supabase (`published = true` para o anônimo) — aqui é
 * código, mas a regra é a mesma, de propósito.
 *
 * `localGetProjectById` NÃO filtra: é por ele que o editor abre o projeto, e um
 * editor que se recusa a abrir rascunhos seria inútil.
 */
export async function localGetProjectBySlug(slug: string): Promise<IvmProject | null> {
  const todos = await localListProjects();
  return todos.find((p) => p.slug === slug && p.published) ?? null;
}

export async function localGetProjectByPath(
  incorporadoraSlug: string,
  projetoSlug: string,
): Promise<IvmProject | null> {
  const todos = await localListProjects();
  return (
    todos.find(
      (p) => p.slug === projetoSlug && p.incorporadora?.slug === incorporadoraSlug && p.published,
    ) ?? null
  );
}

export async function localCreateProject(
  name: string,
  slug: string,
  data: ProjectData,
  published = false,
  incorporadoraId?: string | null,
): Promise<IvmProject> {
  const linha = await req<LinhaLocal>(
    "/api/local/projects",
    json({ name, slug, data, published, incorporadora_id: incorporadoraId ?? null }),
  );
  const incs = await localListIncorporadoras();
  return comIncorporadora(linha, incs);
}

export async function localUpdateProject(
  id: string,
  patch: {
    name?: string;
    slug?: string;
    published?: boolean;
    data?: ProjectData;
    incorporadoraId?: string | null;
  },
): Promise<void> {
  const { incorporadoraId, ...rest } = patch;
  const body: Record<string, unknown> = { ...rest };
  if (incorporadoraId !== undefined) body.incorporadora_id = incorporadoraId;
  await req(`/api/local/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function localDeleteProject(id: string): Promise<void> {
  await req(`/api/local/projects/${id}`, { method: "DELETE" });
}

/** Envia o arquivo cru; o servidor grava em client/public/uploads e devolve a URL. */
export async function localUploadAsset(file: File): Promise<string> {
  const r = await req<{ url: string }>(
    `/api/local/uploads?name=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    },
  );
  return r.url;
}
