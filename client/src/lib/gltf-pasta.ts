/**
 * Importa uma PASTA glTF do disco — `.gltf` + `.bin` + texturas soltas.
 *
 * O editor sempre pediu um `.glb` pronto, mas o 3ds Max exporta uma pasta. Quem
 * não sabia converter subia só o `.gltf`, que abre sem geometria e sem textura
 * nenhuma — o modelo some ou vira uma casca cinza, sem erro que explique.
 *
 * A conversão acontece NO NAVEGADOR (`gltf-worker.ts`). Já morou no `server/`,
 * e por isso não existia no site publicado: o deploy é serverless, e função
 * serverless não recebe 417 MB de upload nem fica minutos com 1,6 GB de RAM.
 * Como o produto é web, a conversão precisava ser web — não uma tarefa que só
 * roda na máquina de quem edita.
 *
 * Este módulo faz a parte de fora: achar o `.gltf` na seleção, descobrir quais
 * arquivos ele realmente usa e conduzir o worker.
 */
import type { PedidoConversao, RespostaConversao } from "./gltf-worker";

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
  /** 0..1 enquanto os arquivos são lidos; ausente durante a conversão. */
  fracao?: number;
}

export interface ResultadoPasta {
  /** O `.glb` pronto, para seguir pelo mesmo upload de sempre. */
  arquivo: File;
  bytes: number;
  /** Resumo do que saiu ("203 malhas, 115 materiais... — 26.9 MB"). */
  resumo: string;
  /** Arquivos que o `.gltf` cita e não vieram na pasta. */
  faltando: string[];
  /** Consertos aplicados para o Cesium não quebrar (ver `glb-sanear`). */
  correcoes: string[];
  /** Quantas silhuetas foram gravadas para o recorte da fotogrametria. */
  contornos: number;
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
 * Caminhos relativos AO `.gltf`, não à raiz da seleção.
 *
 * Quem escolhe a pasta `GLTF_Sesi` em vez de `GLTF_Sesi/Teste1` não deve
 * receber um modelo sem textura por causa disso: as URIs do `.gltf` são
 * relativas a ele, então é dele que o caminho tem de partir.
 */
function relativosAoGltf(gltf: File, todos: File[]): {
  arquivos: { rel: string; file: File }[];
  nomeGltf: string;
} {
  const dir = caminho(gltf).split("/").slice(0, -1).join("/");
  const prefixo = dir ? `${dir}/` : "";
  const arquivos: { rel: string; file: File }[] = [];
  for (const f of todos) {
    const p = caminho(f);
    if (prefixo && !p.startsWith(prefixo)) continue;
    const rel = p.slice(prefixo.length);
    if (rel) arquivos.push({ rel, file: f });
  }
  return { arquivos, nomeGltf: caminho(gltf).slice(prefixo.length) };
}

export interface OpcoesPasta {
  /** Lado máximo das texturas de COR. */
  maxTextura?: number;
  /** Lado máximo das texturas de DADO (normal, roughness, occlusion). */
  maxTexturaDados?: number;
  /** Qualidade WebP das texturas de cor, 0..1. */
  qualidadeCor?: number;
  /** Passo de quantização dos mapas de dado — ver `comprimirTexturas`. */
  passoDados?: number;
  /** Nome-base do arquivo gerado. */
  nome?: string;
}

/**
 * Converte a pasta e resolve com o `.glb` pronto, em memória.
 *
 * Não sobe nada: quem envia é o editor, pelo MESMO caminho de upload do `.glb`
 * manual. É isso que faz a importação funcionar tanto no modo local quanto no
 * Supabase sem nenhum ramo especial — o que sai daqui é um arquivo comum.
 */
export function importarPastaGltf(
  escolha: EscolhaPasta,
  opcoes: OpcoesPasta,
  aoProgredir: (p: ProgressoPasta) => void,
): Promise<ResultadoPasta> {
  const { gltf, arquivos: todos } = escolha;
  if (!gltf) return Promise.reject(new Error("nenhum arquivo .gltf na pasta escolhida"));

  const { arquivos, nomeGltf } = relativosAoGltf(gltf, todos);

  return new Promise<ResultadoPasta>((resolver, rejeitar) => {
    const worker = new Worker(new URL("./gltf-worker.ts", import.meta.url), {
      type: "module",
    });
    const encerrar = () => worker.terminate();

    worker.onmessage = (ev: MessageEvent<RespostaConversao>) => {
      const m = ev.data;
      if (m.tipo === "passo") {
        aoProgredir({ texto: m.texto });
        return;
      }
      encerrar();
      if (m.tipo === "erro") {
        rejeitar(new Error(m.texto));
        return;
      }
      const base = (opcoes.nome ?? gltf.name).replace(/\.(gltf|glb)$/i, "");
      resolver({
        arquivo: new File([m.bytes as BlobPart], `${base}.glb`, {
          type: "model/gltf-binary",
        }),
        bytes: m.bytes.byteLength,
        resumo: m.resumo,
        faltando: m.faltando,
        correcoes: m.correcoes,
        contornos: m.contornos,
      });
    };

    worker.onerror = (e) => {
      encerrar();
      // `e.message` vem vazio em erro de carregamento do módulo do worker; o
      // texto genérico ao menos diz onde olhar.
      rejeitar(new Error(e.message || "o conversor não pôde ser carregado"));
    };

    aoProgredir({ texto: "Preparando a conversão..." });
    worker.postMessage({
      arquivos,
      nomeGltf,
      maxTextura: opcoes.maxTextura ?? 2048,
      maxTexturaDados: opcoes.maxTexturaDados ?? 1024,
      qualidadeCor: opcoes.qualidadeCor ?? 0.85,
      passoDados: opcoes.passoDados ?? 8,
    } satisfies PedidoConversao);
  });
}
