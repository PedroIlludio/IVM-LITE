import type { Express } from "express";
import express from "express";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { sanearGlb } from "./sanearGlb";

/**
 * Armazenamento LOCAL de projetos — o modo de trabalho sem Supabase e sem login.
 *
 * Cada projeto é um arquivo em `data/projects/{id}.json`; as incorporadoras
 * ficam num único `_incorporadoras.json`. É o mesmo padrão já usado pelo editor
 * de posicionamento (`/api/vision3d/placements`): ferramenta local, versionável
 * junto do projeto.
 *
 * ESCRITA SÓ EM DESENVOLVIMENTO. Em produção quem guarda os projetos é o
 * Supabase, com RLS — aqui não há autenticação nenhuma, então liberar escrita
 * num servidor público seria entregar o editor a qualquer visitante.
 */

const DIR = path.resolve(process.cwd(), "data", "projects");
const INC_FILE = path.join(DIR, "_incorporadoras.json");
const UPLOAD_DIR = path.resolve(process.cwd(), "client", "public", "uploads");

interface LocalProject {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  incorporadora_id?: string | null;
  updated_at?: string;
  data: unknown;
}

interface LocalIncorporadora {
  id: string;
  slug: string;
  nome: string;
  logo_url?: string | null;
  tema?: unknown;
}

const ehProducao = () => process.env.NODE_ENV === "production";

async function lerProjetos(): Promise<LocalProject[]> {
  try {
    const arquivos = await fs.readdir(DIR);
    const out: LocalProject[] = [];
    for (const f of arquivos) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      try {
        out.push(JSON.parse(await fs.readFile(path.join(DIR, f), "utf-8")));
      } catch {
        /* arquivo corrompido: ignora em vez de derrubar a listagem inteira */
      }
    }
    return out.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  } catch {
    return [];
  }
}

async function lerProjeto(id: string): Promise<LocalProject | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), "utf-8"));
  } catch {
    return null;
  }
}

async function gravarProjeto(p: LocalProject): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  p.updated_at = new Date().toISOString();
  await fs.writeFile(path.join(DIR, `${p.id}.json`), JSON.stringify(p, null, 2), "utf-8");
}

async function lerIncorporadoras(): Promise<LocalIncorporadora[]> {
  try {
    return JSON.parse(await fs.readFile(INC_FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function gravarIncorporadoras(lista: LocalIncorporadora[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(INC_FILE, JSON.stringify(lista, null, 2), "utf-8");
}

/** Nome de arquivo seguro — nunca confie no nome que veio do cliente. */
function nomeSeguro(nome: string): string {
  return path.basename(nome).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "arquivo";
}

/**
 * Id de projeto/incorporadora vindo da URL, validado.
 *
 * O id vira NOME DE ARQUIVO (`data/projects/<id>.json`), então um id como
 * `../../package` fazia `path.join` sair da pasta e ler (ou apagar) qualquer
 * `.json` do disco — o Express decodifica `%2F` antes de preencher o
 * parâmetro, então a barra chegava aqui. Os ids são gerados por `randomUUID`;
 * aceitar apenas o formato de UUID fecha a porta sem inventar regra nova.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idValido(id: unknown): string | null {
  const s = String(id ?? "");
  return UUID.test(s) ? s : null;
}

export function registerProjectsRoutes(app: Express) {
  /**
   * O modo local não tem autenticação nenhuma: em produção quem guarda os
   * projetos é o Supabase, com RLS. Vale para LEITURA também — a lista traz
   * rascunhos não publicados, que é justamente o que a RLS esconde do público.
   */
  const somenteDev: express.RequestHandler = (_req, res, next) => {
    if (ehProducao()) {
      return res.status(403).json({
        error: "O modo local é uma ferramenta de desenvolvimento. Em produção use o Supabase.",
      });
    }
    next();
  };

  /** Rejeita o id malformado antes de ele virar caminho de arquivo. */
  const comId: express.RequestHandler = (req, res, next) => {
    if (!idValido(req.params.id)) return res.status(400).json({ error: "id inválido" });
    next();
  };

  // --- Projetos -------------------------------------------------------------
  app.get("/api/local/projects", somenteDev, async (_req, res) => {
    res.json(await lerProjetos());
  });

  app.get("/api/local/projects/:id", somenteDev, comId, async (req, res) => {
    const p = await lerProjeto(String(req.params.id));
    if (!p) return res.status(404).json({ error: "não encontrado" });
    res.json(p);
  });

  app.post("/api/local/projects", somenteDev, async (req, res) => {
    const body = req.body ?? {};
    const projeto: LocalProject = {
      id: randomUUID(),
      slug: String(body.slug ?? "").trim() || `ivm-${Date.now().toString(36)}`,
      name: String(body.name ?? "Sem nome"),
      published: !!body.published,
      incorporadora_id: body.incorporadora_id ?? null,
      data: body.data ?? {},
    };
    await gravarProjeto(projeto);
    res.json(projeto);
  });

  app.patch("/api/local/projects/:id", somenteDev, comId, async (req, res) => {
    const atual = await lerProjeto(String(req.params.id));
    if (!atual) return res.status(404).json({ error: "não encontrado" });
    const b = req.body ?? {};
    const novo: LocalProject = {
      ...atual,
      name: b.name ?? atual.name,
      slug: b.slug ?? atual.slug,
      published: b.published ?? atual.published,
      incorporadora_id:
        b.incorporadora_id !== undefined ? b.incorporadora_id : atual.incorporadora_id,
      data: b.data ?? atual.data,
    };
    await gravarProjeto(novo);
    res.json(novo);
  });

  app.delete("/api/local/projects/:id", somenteDev, comId, async (req, res) => {
    try {
      await fs.unlink(path.join(DIR, `${String(req.params.id)}.json`));
    } catch {
      /* já não existia */
    }
    res.json({ ok: true });
  });

  // --- Incorporadoras -------------------------------------------------------
  app.get("/api/local/incorporadoras", somenteDev, async (_req, res) => {
    res.json(await lerIncorporadoras());
  });

  app.post("/api/local/incorporadoras", somenteDev, async (req, res) => {
    const lista = await lerIncorporadoras();
    const b = req.body ?? {};
    const slug = String(b.slug ?? "").trim();
    if (!slug) return res.status(400).json({ error: "slug obrigatório" });
    if (lista.some((i) => i.slug === slug)) {
      return res.status(409).json({ error: "já existe uma incorporadora com esse endereço" });
    }
    const nova: LocalIncorporadora = {
      id: randomUUID(),
      slug,
      nome: String(b.nome ?? slug),
      logo_url: b.logo_url ?? null,
      tema: b.tema ?? {},
    };
    lista.push(nova);
    await gravarIncorporadoras(lista);
    res.json(nova);
  });

  app.patch("/api/local/incorporadoras/:id", somenteDev, async (req, res) => {
    const lista = await lerIncorporadoras();
    const i = lista.findIndex((x) => x.id === String(req.params.id));
    if (i < 0) return res.status(404).json({ error: "não encontrada" });
    lista[i] = { ...lista[i], ...(req.body ?? {}), id: lista[i].id };
    await gravarIncorporadoras(lista);
    res.json(lista[i]);
  });

  app.delete("/api/local/incorporadoras/:id", somenteDev, async (req, res) => {
    const lista = await lerIncorporadoras();
    await gravarIncorporadoras(lista.filter((x) => x.id !== String(req.params.id)));
    res.json({ ok: true });
  });

  // --- Upload de assets -----------------------------------------------------
  // Corpo cru (sem multipart) para não precisar de multer: o cliente manda os
  // bytes do arquivo e o nome vai na query.
  app.post(
    "/api/local/uploads",
    somenteDev,
    express.raw({ type: "*/*", limit: "600mb" }),
    async (req, res) => {
      const nome = nomeSeguro(String(req.query.name ?? "arquivo"));
      const corpo = req.body as Buffer;
      if (!corpo?.length) return res.status(400).json({ error: "arquivo vazio" });
      try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        const arquivo = `${Date.now()}-${nome}`;
        /**
         * GLB passa pelo saneamento antes de ser gravado.
         *
         * Um material com anisotropia sem normal map nem tangentes quebra a
         * COMPILAÇÃO do shader do Cesium em tempo de desenho, e derruba a cena
         * inteira — não só o modelo. Como acontece depois do carregamento,
         * nenhum tratamento de erro no cliente alcança.
         *
         * Barrar o upload seria pior: o modelo é bom, só traz uma propriedade
         * de material que este renderizador não sabe usar. Então entra, sem ela.
         */
        let bytes = corpo;
        if (/\.glb$/i.test(nome)) {
          const { buffer, relatorio } = sanearGlb(corpo);
          bytes = buffer;
          if (relatorio.saneado) {
            console.info(
              `[upload] ${arquivo}: saneado — `
              + `${relatorio.anisotropiaRemovida} material(is) com anisotropia sem `
              + "normal map (quebrava a compilação do shader), "
              + `${relatorio.escalasCorrigidas} nó(s) com escala zero `
              + "(matriz singular, parava o render).",
            );
          }
        }
        await fs.writeFile(path.join(UPLOAD_DIR, arquivo), bytes);
        // client/public é servido na raiz, então a URL pública é direta.
        res.json({ url: `/uploads/${arquivo}` });
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : "falha ao gravar" });
      }
    },
  );
}
