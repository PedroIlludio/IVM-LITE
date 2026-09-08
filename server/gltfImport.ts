import type { Express } from "express";
import type express from "express";
import { spawn } from "child_process";
import { createWriteStream, promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { pipeline } from "stream/promises";

/**
 * Importação de uma PASTA glTF (`.gltf` + `.bin` + texturas) como um GLB único.
 *
 * O editor sempre pediu um `.glb` pronto, e a exportação do 3ds Max sai como
 * pasta. Quem exporta acabava tendo de converter por fora, num passo manual que
 * ninguém documentou — e o erro clássico era subir só o `.gltf`, que carrega
 * sem geometria e sem textura nenhuma. Aqui a pasta inteira sobe e o servidor
 * faz a conversão. O que sai é o mesmo GLB de sempre, em
 * `client/public/uploads`: nada muda para a cena, para o editor ou para o
 * projeto salvo.
 *
 * A conversão em si mora em `script/empacotar-gltf.ts` e roda em OUTRO
 * PROCESSO — ver a doc de lá. Aqui ficam a sessão de upload e o acompanhamento.
 *
 * O trabalho é dividido em quatro chamadas porque um `.bin` de 300 MB não cabe
 * confortavelmente numa requisição só, e porque a conversão leva minutos:
 *
 *   POST   /api/local/gltf-import              abre a sessão
 *   PUT    /api/local/gltf-import/:sid/arquivo grava um arquivo (corpo cru)
 *   POST   /api/local/gltf-import/:sid/empacotar  dispara a conversão
 *   GET    /api/local/gltf-import/:sid/estado  acompanha, até `pronto`
 *
 * SÓ EM DESENVOLVIMENTO, pela mesma razão do resto do modo local: não há
 * autenticação nenhuma, e isto grava arquivos e executa um processo.
 */

const TMP_DIR = path.resolve(process.cwd(), "data", "gltf-import");
const UPLOAD_DIR = path.resolve(process.cwd(), "client", "public", "uploads");
const SCRIPT = path.resolve(process.cwd(), "script", "empacotar-gltf.ts");
const TSX = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

/**
 * Teto de memória do processo de conversão.
 *
 * O padrão do Node (~4 GB) não dá conta: ler o `.bin` decodifica a geometria
 * inteira para arrays tipados, e as texturas descomprimidas entram junto. Com
 * o padrão, um modelo de 300 MB morria em "heap out of memory" no meio da
 * leitura — sem mensagem útil, porque o processo simplesmente some.
 */
const MEMORIA_MB = 8192;

interface Estado {
  fase: string;
  texto: string;
  pronto: boolean;
  erro?: string;
  url?: string;
  bytes?: number;
  faltando?: string[];
  iniciadoEm: number;
}

/**
 * Estado vive em memória, e isso basta: é uma ferramenta local, de uma pessoa
 * por vez, e um reinício do servidor durante a conversão já mataria o processo
 * filho de qualquer jeito — persistir o estado só faria o editor esperar por
 * um trabalho que não existe mais.
 */
const trabalhos = new Map<string, Estado>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Caminho relativo vindo do cliente, validado.
 *
 * Vira caminho de arquivo dentro da sessão, então um `../../server/index.ts`
 * sobrescreveria o projeto. Aceita só caminhos relativos, sem `..` e sem raiz —
 * subpastas continuam valendo, porque o `.gltf` costuma citar `textures/x.jpg`.
 *
 * ESPAÇO, `#`, hífen e acento passam DE PROPÓSITO. São exatamente os caracteres
 * que o 3ds Max põe nos nomes (`Map #2138626954 CL155.jpg`,
 * `Granite002B_2K-JPG_Color.jpg`), e o `.gltf` referencia cada textura PELO
 * NOME: barrá-los aqui faria o arquivo chegar com nome diferente do que o
 * `.gltf` pede, o conversor não o acharia e o modelo entraria cinza — que é
 * justamente o problema que esta importação existe para resolver. O que se
 * barra é a travessia de diretório e o que o Windows recusa em nome de arquivo.
 */
function caminhoRelativoSeguro(bruto: string): string | null {
  const limpo = bruto.replace(/\\/g, "/").trim();
  if (!limpo || limpo.length > 400) return null;
  if (/^[a-zA-Z]:/.test(limpo) || limpo.startsWith("/")) return null;
  const partes = limpo.split("/").filter(Boolean);
  if (!partes.length || partes.length > 12) return null;
  // Barra a travessia e o que o Windows recusa em nome de arquivo.
  if (partes.some((p) => p === "." || p === ".." || /[<>:"|?*]/.test(p))) return null;
  return partes.join("/");
}

/** Nome de arquivo de saída seguro — nunca confie no nome que veio do cliente. */
function nomeSaida(nome: string): string {
  const base = path
    .basename(nome)
    .replace(/\.(gltf|glb)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80) || "modelo";
  return `${Date.now()}-${base}.glb`;
}

async function apagarSessao(sid: string): Promise<void> {
  await fs.rm(path.join(TMP_DIR, sid), { recursive: true, force: true }).catch(() => {
    /* já sumiu, ou o antivírus segurou um handle: não é motivo para falhar */
  });
}

/**
 * Dispara a conversão e vai atualizando `trabalhos` conforme o filho reporta.
 *
 * Não devolve promessa de conclusão de propósito: a rota responde na hora e o
 * editor acompanha por `/estado`. Uma requisição HTTP aberta por dez minutos
 * esbarraria em timeout de proxy e deixaria o usuário sem saber se a conversão
 * ainda está de pé.
 */
function converter(
  sid: string,
  dir: string,
  gltf: string,
  saida: string,
  arquivoSaida: string,
  opcoes: { draco: boolean; webp: boolean; maxTextura: number },
): void {
  const estado = trabalhos.get(sid)!;
  const filho = spawn(
    process.execPath,
    [
      `--max-old-space-size=${MEMORIA_MB}`,
      TSX,
      SCRIPT,
      `--dir=${dir}`,
      `--gltf=${gltf}`,
      `--saida=${saida}`,
      `--draco=${opcoes.draco ? 1 : 0}`,
      `--webp=${opcoes.webp ? 1 : 0}`,
      `--maxTextura=${opcoes.maxTextura}`,
    ],
    { cwd: process.cwd(), windowsHide: true },
  );

  let resto = "";
  let ultimoErro = "";

  filho.stdout.on("data", (chunk: Buffer) => {
    resto += chunk.toString("utf-8");
    const linhas = resto.split("\n");
    resto = linhas.pop() ?? "";
    for (const linha of linhas) {
      if (!linha.trim()) continue;
      let msg: { tipo?: string; fase?: string; texto?: string; bytes?: number; faltando?: string[] };
      try {
        msg = JSON.parse(linha);
      } catch {
        // O conversor também escreve avisos soltos (sharp, draco): não é erro,
        // mas ajuda no terminal de quem está com o servidor aberto.
        console.info(`[gltf-import] ${linha}`);
        continue;
      }
      if (msg.tipo === "passo") {
        estado.fase = msg.fase ?? estado.fase;
        estado.texto = msg.texto ?? estado.texto;
        console.info(`[gltf-import] ${estado.texto}`);
      } else if (msg.tipo === "fim") {
        estado.bytes = msg.bytes;
        estado.faltando = msg.faltando ?? [];
        estado.texto = msg.texto ?? "";
      } else if (msg.tipo === "erro") {
        ultimoErro = msg.texto ?? "falha na conversão";
      }
    }
  });

  // O stderr do filho traz o rastro do erro real (heap, arquivo ilegível). Sem
  // guardá-lo, o editor só mostraria "código 1", que não diz nada a ninguém.
  filho.stderr.on("data", (c: Buffer) => {
    const t = c.toString("utf-8").trim();
    if (t) {
      ultimoErro = t.split("\n").slice(-4).join(" ").slice(0, 500);
      console.warn(`[gltf-import] ${t}`);
    }
  });

  filho.on("error", (e) => {
    estado.pronto = true;
    estado.erro = `não foi possível iniciar a conversão: ${e.message}`;
    void apagarSessao(sid);
  });

  filho.on("close", async (codigo) => {
    try {
      if (codigo !== 0 || estado.bytes === undefined) {
        estado.erro = ultimoErro || `a conversão terminou com código ${codigo}`;
      } else {
        estado.url = `/uploads/${arquivoSaida}`;
        estado.fase = "pronto";
      }
    } finally {
      estado.pronto = true;
      await apagarSessao(sid);
    }
  });
}

export function registerGltfImportRoutes(app: Express) {
  const somenteDev: express.RequestHandler = (_req, res, next) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({
        error: "A importação de pasta glTF é uma ferramenta de desenvolvimento.",
      });
    }
    next();
  };

  /** Rejeita a sessão malformada antes de ela virar caminho de arquivo. */
  const comSid: express.RequestHandler = (req, res, next) => {
    if (!UUID.test(String(req.params.sid ?? ""))) {
      return res.status(400).json({ error: "sessão inválida" });
    }
    next();
  };

  app.post("/api/local/gltf-import", somenteDev, async (_req, res) => {
    const sid = randomUUID();
    await fs.mkdir(path.join(TMP_DIR, sid), { recursive: true });
    res.json({ sid });
  });

  /**
   * Grava um arquivo da pasta. O corpo é o arquivo cru e o caminho relativo vai
   * na query — o mesmo padrão de `/api/local/uploads`, para não trazer multer
   * só por causa disto.
   *
   * O corpo é ESCOADO DIRETO PARA O DISCO em vez de passar por `express.raw`:
   * bufferizar um `.bin` de 300 MB na memória do servidor de desenvolvimento é
   * exatamente o que derruba ele.
   */
  app.put("/api/local/gltf-import/:sid/arquivo", somenteDev, comSid, async (req, res) => {
    const sid = String(req.params.sid);
    const base = path.join(TMP_DIR, sid);
    if (!(await fs.stat(base).catch(() => null))) {
      return res.status(404).json({ error: "sessão não encontrada" });
    }
    const rel = caminhoRelativoSeguro(String(req.query.path ?? ""));
    if (!rel) return res.status(400).json({ error: "caminho inválido" });

    const destino = path.join(base, rel);
    try {
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await pipeline(req, createWriteStream(destino));
      const { size } = await fs.stat(destino);
      res.json({ ok: true, bytes: size });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "falha ao gravar" });
    }
  });

  app.post("/api/local/gltf-import/:sid/empacotar", somenteDev, comSid, async (req, res) => {
    const sid = String(req.params.sid);
    const dir = path.join(TMP_DIR, sid);
    if (!(await fs.stat(dir).catch(() => null))) {
      return res.status(404).json({ error: "sessão não encontrada" });
    }
    if (trabalhos.get(sid)?.pronto === false) {
      return res.status(409).json({ error: "esta importação já está em andamento" });
    }

    const b = req.body ?? {};
    const gltf = caminhoRelativoSeguro(String(b.gltf ?? ""));
    if (!gltf) return res.status(400).json({ error: "arquivo .gltf não informado" });
    if (!(await fs.stat(path.join(dir, gltf)).catch(() => null))) {
      return res.status(400).json({ error: `${gltf} não chegou ao servidor` });
    }

    const arquivoSaida = nomeSaida(String(b.nome ?? gltf));
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    trabalhos.set(sid, {
      fase: "iniciando",
      texto: "Preparando a conversão...",
      pronto: false,
      iniciadoEm: Date.now(),
    });
    converter(sid, dir, gltf, path.join(UPLOAD_DIR, arquivoSaida), arquivoSaida, {
      draco: b.draco !== false,
      webp: b.webp !== false,
      // 512 é o menor tamanho que ainda lê como textura, 4096 o teto que a
      // maioria das placas aceita sem reamostrar.
      maxTextura: Math.min(4096, Math.max(512, Number(b.maxTextura) || 2048)),
    });
    res.json({ ok: true });
  });

  app.get("/api/local/gltf-import/:sid/estado", somenteDev, comSid, (req, res) => {
    const e = trabalhos.get(String(req.params.sid));
    if (!e) return res.status(404).json({ error: "importação não encontrada" });
    res.json({ ...e, segundos: Math.round((Date.now() - e.iniciadoEm) / 1000) });
  });

  /** Cancelar/desistir: some com os temporários sem esperar a conversão. */
  app.delete("/api/local/gltf-import/:sid", somenteDev, comSid, async (req, res) => {
    const sid = String(req.params.sid);
    trabalhos.delete(sid);
    await apagarSessao(sid);
    res.json({ ok: true });
  });
}
