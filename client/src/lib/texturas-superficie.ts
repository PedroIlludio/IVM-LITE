/**
 * Texturas das superfícies do entorno, desenhadas em canvas.
 *
 * Procedurais, e não arquivos de imagem, por três motivos que pesaram mais do
 * que o realismo de uma foto:
 *
 * - Nada para baixar. A cena já disputa banda com a fotogrametria do Google e
 *   com um GLB de dezenas de MB; um atlas de texturas entraria na frente
 *   justamente no primeiro carregamento, que é quando o corretor está com o
 *   cliente do lado.
 * - Nada para licenciar. Textura de grama de banco de imagens tem contrato, e
 *   este projeto vai para o ar em nome de terceiros.
 * - Repetição sem costura de graça. Cada mancha desenhada perto da borda é
 *   redesenhada do lado oposto, então o ladrilho fecha em si mesmo — é o que
 *   evita a grade visível que denuncia textura repetida num gramado grande.
 *
 * Não competem com uma foto de perto. Competem com o borrão cinza da
 * fotogrametria, que é o que estava lá.
 */

export type TipoSuperficie = "grama" | "terra" | "concreto" | "asfalto" | "agua";

export const TIPOS_SUPERFICIE: Array<{ id: TipoSuperficie; nome: string }> = [
  { id: "grama", nome: "Grama" },
  { id: "terra", nome: "Terra" },
  { id: "concreto", nome: "Concreto" },
  { id: "asfalto", nome: "Asfalto" },
  { id: "agua", nome: "Água" },
];

/** Quantos metros o ladrilho cobre no mundo. Define a escala aparente. */
export const METROS_POR_LADRILHO: Record<TipoSuperficie, number> = {
  grama: 4,
  terra: 5,
  concreto: 6,
  asfalto: 8,
  agua: 12,
};

/** Cor média de cada tipo — usada onde a textura não cabe (legenda, mapa 2D). */
export const COR_SUPERFICIE: Record<TipoSuperficie, string> = {
  grama: "#4e7c42",
  terra: "#7a6247",
  concreto: "#9b9b96",
  asfalto: "#3c3c3f",
  agua: "#2f6f8f",
};

const LADO = 256;

/**
 * Gerador determinístico.
 *
 * `Math.random` daria uma grama diferente a cada vez que o material fosse
 * reconstruído — e ele é reconstruído a cada mudança na superfície. O gramado
 * mudaria de desenho enquanto o usuário arrasta um pivô, o que lê como falha.
 */
function aleatorio(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Desenha uma marca repetindo-a nas bordas opostas.
 *
 * É o truque que fecha o ladrilho: o que sai por cima entra por baixo. Sem
 * isto, cada emenda vira uma linha reta visível e o gramado ganha uma grade.
 */
function marcaComCostura(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, raio: number,
  desenhar: (cx: number, cy: number) => void,
) {
  const dx = x < raio ? LADO : x > LADO - raio ? -LADO : 0;
  const dy = y < raio ? LADO : y > LADO - raio ? -LADO : 0;
  desenhar(x, y);
  if (dx) desenhar(x + dx, y);
  if (dy) desenhar(x, y + dy);
  if (dx && dy) desenhar(x + dx, y + dy);
}

function base(ctx: CanvasRenderingContext2D, cor: string) {
  ctx.fillStyle = cor;
  ctx.fillRect(0, 0, LADO, LADO);
}

/** Manchas largas e translúcidas: quebram a chapa lisa da cor de fundo. */
function manchas(
  ctx: CanvasRenderingContext2D, rnd: () => number,
  quantas: number, raioMin: number, raioMax: number, cores: string[],
) {
  for (let i = 0; i < quantas; i++) {
    const x = rnd() * LADO;
    const y = rnd() * LADO;
    const r = raioMin + rnd() * (raioMax - raioMin);
    ctx.fillStyle = cores[Math.floor(rnd() * cores.length)];
    marcaComCostura(ctx, x, y, r, (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function grama(ctx: CanvasRenderingContext2D) {
  const rnd = aleatorio(20260813);
  base(ctx, "#4e7c42");
  ctx.globalAlpha = 0.5;
  manchas(ctx, rnd, 26, 18, 46, ["#456f3b", "#57874a", "#3f6636"]);
  ctx.globalAlpha = 1;
  // Lâminas curtas em direções variadas. São o que dá o grão fino que a vista
  // de cima realmente enxerga — folha desenhada uma a uma some no zoom da
  // vitrine e só custa tempo.
  ctx.lineWidth = 1;
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * LADO;
    const y = rnd() * LADO;
    const ang = rnd() * Math.PI * 2;
    const c = 2 + rnd() * 4;
    const tom = rnd();
    ctx.strokeStyle = tom < 0.34 ? "#3d6b34" : tom < 0.72 ? "#5b8b4c" : "#6fa055";
    ctx.globalAlpha = 0.35 + rnd() * 0.45;
    marcaComCostura(ctx, x, y, c, (cx, cy) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * c, cy + Math.sin(ang) * c);
      ctx.stroke();
    });
  }
  ctx.globalAlpha = 1;
}

function terra(ctx: CanvasRenderingContext2D) {
  const rnd = aleatorio(75319);
  base(ctx, "#7a6247");
  ctx.globalAlpha = 0.45;
  manchas(ctx, rnd, 22, 16, 44, ["#6b5540", "#8c7358", "#5f4c39"]);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 3400; i++) {
    const x = rnd() * LADO;
    const y = rnd() * LADO;
    const r = 0.4 + rnd() * 1.3;
    const tom = rnd();
    ctx.fillStyle = tom < 0.4 ? "#5e4a37" : tom < 0.8 ? "#8f7659" : "#a08a6c";
    ctx.globalAlpha = 0.3 + rnd() * 0.5;
    marcaComCostura(ctx, x, y, r, (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
}

function concreto(ctx: CanvasRenderingContext2D) {
  const rnd = aleatorio(41207);
  base(ctx, "#9b9b96");
  ctx.globalAlpha = 0.35;
  manchas(ctx, rnd, 18, 24, 60, ["#93938e", "#a4a49f", "#8b8b87"]);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 6000; i++) {
    const x = rnd() * LADO;
    const y = rnd() * LADO;
    const r = 0.3 + rnd() * 0.9;
    ctx.fillStyle = rnd() < 0.5 ? "#8a8a86" : "#adada8";
    ctx.globalAlpha = 0.2 + rnd() * 0.35;
    marcaComCostura(ctx, x, y, r, (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
  // Junta de dilatação nas bordas do ladrilho: como a costura é exata, as
  // juntas dos ladrilhos vizinhos se encontram e formam uma grade contínua,
  // que é justamente como piso de concreto é executado.
  ctx.strokeStyle = "#7f7f7b";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, 0.75);
  ctx.lineTo(LADO, 0.75);
  ctx.moveTo(0.75, 0);
  ctx.lineTo(0.75, LADO);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function asfalto(ctx: CanvasRenderingContext2D) {
  const rnd = aleatorio(90210);
  base(ctx, "#3c3c3f");
  ctx.globalAlpha = 0.4;
  manchas(ctx, rnd, 14, 20, 52, ["#37373a", "#434347"]);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 7000; i++) {
    const x = rnd() * LADO;
    const y = rnd() * LADO;
    const r = 0.3 + rnd() * 1.1;
    const tom = rnd();
    ctx.fillStyle = tom < 0.5 ? "#333336" : tom < 0.85 ? "#4a4a4e" : "#5a5a5f";
    ctx.globalAlpha = 0.25 + rnd() * 0.4;
    marcaComCostura(ctx, x, y, r, (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
}

function agua(ctx: CanvasRenderingContext2D) {
  const rnd = aleatorio(11235);
  base(ctx, "#2f6f8f");
  ctx.globalAlpha = 0.4;
  manchas(ctx, rnd, 16, 30, 70, ["#2a6383", "#377d9c", "#255a78"]);
  ctx.globalAlpha = 1;
  // Ondulação: senoides de fases diferentes. O período divide o lado do
  // ladrilho em número inteiro de ciclos, senão a onda quebra na emenda.
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 90; i++) {
    const y0 = rnd() * LADO;
    const amp = 1.5 + rnd() * 3.5;
    const ciclos = 1 + Math.floor(rnd() * 3);
    const fase = rnd() * Math.PI * 2;
    ctx.strokeStyle = rnd() < 0.6 ? "#4d92b0" : "#71b3cd";
    ctx.globalAlpha = 0.18 + rnd() * 0.3;
    ctx.beginPath();
    for (let x = 0; x <= LADO; x += 4) {
      const y = y0 + Math.sin((x / LADO) * ciclos * Math.PI * 2 + fase) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const DESENHOS: Record<TipoSuperficie, (ctx: CanvasRenderingContext2D) => void> = {
  grama, terra, concreto, asfalto, agua,
};

/**
 * Ladrilho de cada tipo, desenhado UMA vez por sessão.
 *
 * O material é reconstruído a cada mudança na superfície — inclusive a 20 fps
 * durante o arraste de um pivô. Redesenhar milhares de marcas nesse ritmo
 * travaria a mão do usuário; o canvas fica no cache e só a referência circula.
 */
const cache = new Map<TipoSuperficie, HTMLCanvasElement>();

export function texturaDe(tipo: TipoSuperficie): HTMLCanvasElement | null {
  const pronta = cache.get(tipo);
  if (pronta) return pronta;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = LADO;
  canvas.height = LADO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  (DESENHOS[tipo] ?? grama)(ctx);
  cache.set(tipo, canvas);
  return canvas;
}
