/**
 * Importa uma PASTA glTF do disco — `.gltf` + `.bin` + texturas soltas.
 *
 * O editor sempre pediu um `.glb` pronto, mas o 3ds Max exporta uma pasta. Quem
 * não sabia converter subia só o `.gltf`, que abre sem geometria e sem textura
 * nenhuma — o modelo some ou vira uma casca cinza, sem erro que explique.
 *
 * Aqui a pasta inteira sobe e o servidor devolve UM `.glb` com tudo embutido
 * (`server/gltfImport.ts`). Do ponto de vista do resto do editor não mudou
 * nada: o que volta é a mesma URL de sempre, para o mesmo campo de sempre.
 *
 * Este módulo faz a parte do navegador: achar o `.gltf`, descobrir quais
 * arquivos ele realmente usa, mandá-los e acompanhar a conversão.
 */

/**
 * Atributos que transformam um `<input type="file">` em seletor de PASTA.
 *
 * Não estão na tipagem do React porque nunca entraram no padrão — mas Chrome,
 * Edge, Firefox e Safari implementam `webkitdirectory` há anos, e é a única
 * forma de escolher uma pasta inteira sem arrastar. `directory` vai junto por
 * garantia; navegador que não conheça nenhum dos dois cai no seletor de
 * arquivos comum, onde a seleção múltipla ainda dá conta.
 */
export const ATRIBUTOS_PASTA = { webkitdirectory: "", directory: "" } as unknown as {
  webkitdirectory?: string;
  directory?: string;
};

/** Um passo do processo, para a tela dizer o que está acontecendo. */
export interface ProgressoPasta {
  texto: string;
  /** 0..1 quando dá para saber; ausente na conversão, que não tem medida. */
  fracao?: number;
}

export interface ResultadoPasta {
  /** URL do GLB gerado, servida por `client/public/uploads`. */
  url: string;
  bytes: number;
  /** Resumo do que saiu ("203 malhas, 115 materiais... — 23.8 MB"). */
  resumo: string;
  /** Arquivos que o `.gltf` cita e não vieram na pasta. */
  faltando: string[];
}

/** O que o `<input webkitdirectory>` entregou, resumido. */
export interface EscolhaPasta {
  gltf?: File;
  /** A pasta já tinha um `.glb` pronto: não há o que converter. */
  glb?: File;
  arquivos: File[];
}

/** Caminho do arquivo dentro da pasta escolhida (o input só preenche isto). */
function caminho(f: File): string {
  return ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)
    .replace(/\\/g, "/");
}

/**
 * Acha o modelo na seleção.
 *
 * Uma exportação pode trazer mais de um `.gltf` (o 3ds Max às vezes separa a
 * cena por camada). Vence o menos aninhado e, no empate, o maior — é o arquivo
 * principal, não um acessório numa subpasta.
 */
export function lerEscolhaPasta(lista: FileList | File[]): EscolhaPasta {
  const arquivos = Array.from(lista);
  const ordenar = (a: File, b: File) => {
    const p = caminho(a).split("/").length - caminho(b).split("/").length;
    return p !== 0 ? p : b.size - a.size;
  };
  const gltf = arquivos.filter((f) => /\.gltf$/i.test(f.name)).sort(ordenar)[0];
  const glb = arquivos.filter((f) => /\.glb$/i.test(f.name)).sort(ordenar)[0];
  return { gltf, glb, arquivos };
}

/**
 * Lista os arquivos que o `.gltf` realmente usa, na ordem em que devem subir.
 *
 * Só o que está citado em `buffers`/`images` vai junto. A pasta de exportação
 * costuma vir com sobras — mapas de outra versão, `.max`, prints — e mandar
 * tudo dobraria o tempo de upload de um modelo de centenas de MB sem mudar uma
 * vírgula no resultado.
 *
 * As URIs são resolvidas RELATIVAS AO `.gltf`, não à raiz da seleção: quem
 * escolhe a pasta `GLTF_Sesi` em vez de `GLTF_Sesi/Teste1` não deve receber um
 * modelo sem textura por causa disso.
 */
async function arquivosUsados(
  gltf: File,
  todos: File[],
): Promise<{ enviar: { file: File; rel: string }[]; ausentes: string[]; nomeGltf: string }> {
  const json = JSON.parse(await gltf.text()) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };

  const dir = caminho(gltf).split("/").slice(0, -1).join("/");
  const prefixo = dir ? `${dir}/` : "";
  const nomeGltf = caminho(gltf).slice(prefixo.length);

  // Índice por caminho relativo ao `.gltf`, em minúsculas: o `.gltf` escreve
  // `Grass001_2K-JPG_Color.jpg` e o arquivo no disco pode estar em outra caixa.
  const porRel = new Map<string, { file: File; rel: string }>();
  for (const f of todos) {
    const p = caminho(f);
    if (prefixo && !p.startsWith(prefixo)) continue;
    const rel = p.slice(prefixo.length);
    if (rel) porRel.set(rel.toLowerCase(), { file: f, rel });
  }

  const enviar = new Map<string, { file: File; rel: string }>();
  const ausentes: string[] = [];
  enviar.set(nomeGltf.toLowerCase(), { file: gltf, rel: nomeGltf });

  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    const uri = item.uri;
    // `data:` já está embutido no próprio `.gltf`; não há arquivo a mandar.
    if (!uri || /^data:/i.test(uri)) continue;
    const cru = uri.replace(/\\/g, "/");
    let decodificada = cru;
    try {
      decodificada = decodeURIComponent(cru);
    } catch {
      /* percent-encoding inválido: fica só com o texto cru */
    }
    const achado = porRel.get(cru.toLowerCase()) ?? porRel.get(decodificada.toLowerCase());
    if (achado) enviar.set(achado.rel.toLowerCase(), achado);
    else ausentes.push(uri);
  }

  // O `.gltf` primeiro, e o resto do menor para o maior: o `.bin` gigante fica
  // por último, então uma pasta errada falha em segundos em vez de minutos.
  const ordenados = Array.from(enviar.values()).sort((a, b) =>
    a.file === gltf ? -1 : b.file === gltf ? 1 : a.file.size - b.file.size,
  );
  return { enviar: ordenados, ausentes, nomeGltf };
}

/**
 * Erro de quem NÃO tem a rota: o site publicado.
 *
 * A conversão mora em `server/` + `script/`, e o `.vercelignore` exclui as duas
 * pastas — o deploy sobe só as funções de `api/`. Então `/api/local/gltf-import`
 * responde a página 404 da hospedagem, em HTML. Sem este caso o editor mostrava
 * esse HTML cru ("The page could not be found NOT_FOUND gru1::..."), que não
 * diz a única coisa que importa: isto não roda aqui.
 */
const SO_LOCAL =
  "A importação de pasta só existe no servidor de desenvolvimento local "
  + "(npm run dev). No site publicado, envie um .glb pronto pelo botão de upload.";

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const tipo = r.headers.get("content-type") ?? "";
    if (r.status === 404 && !tipo.includes("json")) throw new Error(SO_LOCAL);
    const corpo = await r.text().catch(() => "");
    let msg = corpo;
    try {
      msg = (JSON.parse(corpo) as { error?: string }).error ?? corpo;
    } catch {
      // Resposta não-JSON (proxy, HTML de erro): o corpo inteiro é ruído.
      msg = `HTTP ${r.status}`;
    }
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

/**
 * A importação de pasta está disponível neste ambiente?
 *
 * `import.meta.env.DEV` é resolvido pelo Vite na build: no pacote publicado ele
 * vira `false` em tempo de compilação. É a mesma fronteira do `.vercelignore`,
 * então não há como as duas respostas divergirem.
 */
export const IMPORTAR_PASTA_DISPONIVEL = import.meta.env.DEV;

export interface OpcoesPasta {
  /** Compactar a geometria (Draco). Desligue só para depurar. */
  draco?: boolean;
  /** Converter as texturas para WebP. */
  webp?: boolean;
  /** Lado máximo das texturas, em pixels. */
  maxTextura?: number;
  /** Nome-base do arquivo gerado. */
  nome?: string;
}

/**
 * Sobe a pasta e converte. Resolve com a URL do GLB pronto.
 *
 * O upload é UM ARQUIVO POR REQUISIÇÃO, em série. Um `multipart` de 400 MB
 * exigiria montar o corpo inteiro na memória do navegador antes de mandar, e
 * seria tudo ou nada: o `.bin` falhando no fim jogaria fora as 70 texturas que
 * já tinham subido. Em série, cada arquivo é um passo visível e o progresso é
 * real, não estimado.
 */
export async function importarPastaGltf(
  escolha: EscolhaPasta,
  opcoes: OpcoesPasta,
  aoProgredir: (p: ProgressoPasta) => void,
): Promise<ResultadoPasta> {
  const { gltf, arquivos } = escolha;
  if (!gltf) throw new Error("nenhum arquivo .gltf na pasta escolhida");

  aoProgredir({ texto: "Lendo a pasta..." });
  const { enviar, ausentes, nomeGltf } = await arquivosUsados(gltf, arquivos);

  const { sid } = await json<{ sid: string }>(
    await fetch("/api/local/gltf-import", { method: "POST" }),
  );

  try {
    const total = enviar.reduce((s, a) => s + a.file.size, 0);
    let subiu = 0;
    for (const { file, rel } of enviar) {
      aoProgredir({
        texto: `Enviando ${rel} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`,
        fracao: total ? subiu / total : 0,
      });
      await json(
        await fetch(
          `/api/local/gltf-import/${sid}/arquivo?path=${encodeURIComponent(rel)}`,
          { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file },
        ),
      );
      subiu += file.size;
    }

    aoProgredir({ texto: "Convertendo...", fracao: 1 });
    await json(
      await fetch(`/api/local/gltf-import/${sid}/empacotar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gltf: nomeGltf,
          nome: opcoes.nome ?? gltf.name,
          draco: opcoes.draco !== false,
          webp: opcoes.webp !== false,
          maxTextura: opcoes.maxTextura ?? 2048,
        }),
      }),
    );

    // A conversão de um modelo grande passa dos minutos. Consultar de 1,5 em
    // 1,5 s dá um texto que se move sem encher o servidor de requisição.
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const e = await json<{
        fase: string;
        texto: string;
        pronto: boolean;
        erro?: string;
        url?: string;
        bytes?: number;
        faltando?: string[];
        segundos: number;
      }>(await fetch(`/api/local/gltf-import/${sid}/estado`));

      if (!e.pronto) {
        aoProgredir({ texto: `${e.texto} (${e.segundos}s)` });
        continue;
      }
      if (e.erro || !e.url) throw new Error(e.erro || "a conversão não gerou arquivo");
      return {
        url: e.url,
        bytes: e.bytes ?? 0,
        resumo: e.texto,
        // O servidor só sabe o que o `.gltf` pediu e ele não achou no disco; o
        // navegador sabe o que nem chegou a subir. Os dois casos são a mesma
        // notícia para quem exportou, então vão juntos.
        faltando: Array.from(new Set(ausentes.concat(e.faltando ?? []))),
      };
    }
  } catch (erro) {
    // Sessão abandonada deixaria centenas de MB em `data/gltf-import`.
    await fetch(`/api/local/gltf-import/${sid}`, { method: "DELETE" }).catch(() => {
      /* o servidor limpa sozinho ao fim da conversão; aqui é só capricho */
    });
    throw erro;
  }
}
