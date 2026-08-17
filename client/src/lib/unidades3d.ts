import type { TorreDef, TorreVolume, Unidade, UnidadeStatus } from "./unidades";
import { STATUS_META } from "./unidades";
import type { PavimentosCfg, NivelDef } from "./pavimentos";

/**
 * Espelho de vendas em 3D: transforma as unidades em caixas posicionadas no
 * espaço do modelo, coloridas por disponibilidade.
 *
 * O GLB é uma fachada (não tem uma malha por apartamento), então cada unidade é
 * uma fatia da caixa da torre: o andar define o Z, e a ordem da unidade no andar
 * define a posição ao longo de `largura`. É uma aproximação volumétrica — é o
 * que a calibração do modelo permite — mas dá ao cliente a leitura espacial de
 * onde cada unidade está e como está a disponibilidade do prédio inteiro.
 */
export interface UnitBox {
  /** Id da unidade (vira o id da entidade: `unit:<id>`). */
  id: string;
  buildingId: string;
  /** Centro da caixa no espaço do modelo (m). */
  x: number;
  y: number;
  z: number;
  /** Dimensões da caixa (m). */
  dx: number;
  dy: number;
  dz: number;
  /** Giro em torno do eixo vertical do modelo (graus). */
  rot: number;
  /** Inclinação nos outros dois eixos (graus). Compostos Rz · Ry · Rx. */
  rotX: number;
  rotY: number;
  /**
   * Contorno próprio, em metros relativos ao centro. Presente, substitui a
   * caixa: a unidade vira um prisma com esta planta e altura `dz`.
   */
  planta?: { x: number; y: number; z?: number; zTopo?: number }[];
  color: string;
  alpha: number;
  outline: boolean;
  /** Mantem a entidade disponivel para enquadramento mesmo quando esta oculta. */
  visible?: boolean;
}

/** Fração da fatia ocupada pela caixa (deixa uma junta visível entre unidades). */
const FOLGA_X = 0.9;
/** Fração da altura do nível ocupada pela caixa. */
const FOLGA_Z = 0.78;

/**
 * Volume padrão da torre `i` de `total`: divide a extensão do modelo em blocos
 * iguais ao longo do X. É só um ponto de partida — o editor ajusta cada torre
 * sobre o modelo, com preview ao vivo.
 */
export function torreVolumePadrao(
  i: number,
  total: number,
  extent: { x0: number; x1: number; y0: number; y1: number },
): TorreVolume {
  const passo = (extent.x1 - extent.x0) / Math.max(1, total);
  return {
    x: extent.x0 + passo * (i + 0.5),
    comprimento: passo * 0.94,
    y: (extent.y0 + extent.y1) / 2,
    largura: extent.y1 - extent.y0,
    rot: 0,
  };
}

export function volumeDaTorre(t: TorreDef, i: number, total: number): TorreVolume {
  return t.volume ?? torreVolumePadrao(i, total, { x0: 0, x1: 30 * total, y0: 0, y1: 14 });
}

/**
 * Base e altura efetivas do bloco (o volume manda; senão, os pavimentos).
 *
 * O padrão pula um nível: na convenção do corte, o pavimento 1 fica ACIMA do
 * térreo (ver `pavimentos()`), então o bloco de unidades começa em baseZ+nivelM.
 */
export function faixaVertical(vol: TorreVolume, cfg: PavimentosCfg): { base: number; altura: number } {
  const base = vol.z ?? cfg.baseZ + cfg.nivelM;
  const altura = vol.altura ?? cfg.nivelM * cfg.numPavimentos;
  return { base, altura };
}

interface BuildOpts {
  buildingId: string;
  unidades: Unidade[];
  torres: TorreDef[];
  pavCfg: PavimentosCfg;
  /** Unidades que passam no filtro: as demais somem (ou ficam fantasmas). */
  visiveis?: Set<string>;
  /** Unidade em foco: fica opaca e contornada. */
  selecionadaId?: string | null;
  /** Seleção múltipla do editor: todas ficam opacas e contornadas. */
  selecionadas?: ReadonlySet<string> | null;
  /** Mostra as filtradas de fora como caixas fantasma, para manter o volume. */
  mostrarFantasmas?: boolean;
  /**
   * Opacidade da caixa visível e não selecionada.
   *
   * O modelo fica sempre íntegro — a fachada é a referência que diz em que
   * altura e em que face a unidade está, tanto para quem calibra quanto para
   * quem compra. Quem cede passagem é a caixa. A selecionada volta a ser opaca
   * de qualquer forma.
   *
   * O padrão alto (0.92) é o de quando não há modelo por trás a preservar.
   */
  opacidade?: number;
}

/** Dimensões padrão de uma unidade avulsa (m), quando ela não define as suas. */
const AVULSA_PADRAO = { dx: 8, dy: 10 };

export function buildUnitBoxes({
  buildingId,
  unidades,
  torres,
  pavCfg,
  visiveis,
  selecionadaId,
  selecionadas,
  mostrarFantasmas = true,
  opacidade = 0.92,
}: BuildOpts): UnitBox[] {
  const out: UnitBox[] = [];

  /** Monta a caixa a partir do estado visual comum aos dois modos. */
  const caixa = (u: Unidade, base: Omit<UnitBox, "id" | "buildingId" | "color" | "alpha" | "outline">): UnitBox | null => {
    const visivel = !visiveis || visiveis.has(u.id);
    if (!visivel && !mostrarFantasmas) return null;
    const selecionada = selecionadaId === u.id || !!selecionadas?.has(u.id);
    return {
      ...base,
      id: u.id,
      buildingId,
      color: visivel ? STATUS_META[u.status].cor : "#94a3b8",
      // Selecionar não altera o material da caixa: no Cesium, trocar a
      // transparência junto com o outline reconstrói a primitiva e podia fazê-la
      // desaparecer. O destaque é desenhado separadamente pelo Scene3D.
      alpha: visivel ? opacidade : 0.05,
      outline: selecionada,
    };
  };

  // --- Unidades avulsas: posição própria, fora da grade da torre -------------
  for (const u of unidades) {
    const p = u.posicao;
    if (!p) continue;
    const c = caixa(u, {
      x: p.x,
      y: p.y,
      z: p.z + (p.dz ?? pavCfg.nivelM) / 2,
      dx: p.dx ?? AVULSA_PADRAO.dx,
      dy: p.dy ?? AVULSA_PADRAO.dy,
      dz: p.dz ?? pavCfg.nivelM * FOLGA_Z,
      // Só o contorno com pelo menos 3 pontos vale: dois pontos não fecham
      // área, e o Cesium recusaria a hierarquia do polígono.
      planta: (p.planta?.length ?? 0) >= 3 ? p.planta : undefined,
      rot: p.rot ?? 0,
      rotX: p.rotX ?? 0,
      rotY: p.rotY ?? 0,
    });
    if (c) out.push(c);
  }

  torres.forEach((torre, ti) => {
    const vol = volumeDaTorre(torre, ti, torres.length);
    // As avulsas já foram desenhadas: não podem entrar de novo no fatiamento.
    const daTorre = unidades.filter((u) => u.torre === torre.id && !u.posicao);

    // Agrupa por andar: a posição da unidade na fatia vem da ordem do número,
    // então o espelho 3D fica alinhado com o espelho 2D.
    const andares = new Map<number, Unidade[]>();
    for (const u of daTorre) {
      const arr = andares.get(u.pavimento) ?? [];
      arr.push(u);
      andares.set(u.pavimento, arr);
    }

    // O bloco é dividido verticalmente pelos pavimentos: a altura do volume
    // manda, então esticar a caixa no editor estica os andares junto.
    const { base, altura } = faixaVertical(vol, pavCfg);
    const alturaNivel = altura / Math.max(1, pavCfg.numPavimentos);

    for (const [pav, doAndar] of Array.from(andares.entries())) {
      const ordenadas = [...doAndar].sort((a, b) => a.numero.localeCompare(b.numero));
      const n = ordenadas.length;
      const fatia = vol.comprimento / n;
      const z0 = base + alturaNivel * (pav - 1);

      ordenadas.forEach((u, i) => {
        // Centro da fatia, medido do canto esquerdo da torre e girado com ela.
        const u0 = -vol.comprimento / 2 + fatia * (i + 0.5);
        const rad = ((vol.rot ?? 0) * Math.PI) / 180;
        const c = caixa(u, {
          x: vol.x + u0 * Math.cos(rad),
          y: vol.y + u0 * Math.sin(rad),
          z: z0 + alturaNivel / 2,
          dx: fatia * FOLGA_X,
          dy: vol.largura,
          dz: alturaNivel * FOLGA_Z,
          rot: vol.rot ?? 0,
          rotX: vol.rotX ?? 0,
          rotY: vol.rotY ?? 0,
        });
        if (c) out.push(c);
      });
    }
  });

  return out;
}

/**
 * Corte de um nível, pronto para a cena: a altura e, quando o nível tem área,
 * o retângulo acima do qual a geometria some.
 *
 * Editor e vitrine chamam esta mesma função — um corte que se vê no editor
 * tem de ser exatamente o corte que o cliente vê.
 */
export function corteDoNivel(
  n: NivelDef,
): { z: number; area?: NonNullable<NivelDef["area"]> } | null {
  if (n.cutZ == null) return null;
  return n.area ? { z: n.cutZ, area: { ...n.area } } : { z: n.cutZ };
}

/** Contagem por status, para a legenda do espelho 3D. */
export function contarPorStatus(unidades: Unidade[]): Record<UnidadeStatus, number> {
  const acc: Record<UnidadeStatus, number> = { disponivel: 0, reservada: 0, vendida: 0 };
  for (const u of unidades) acc[u.status]++;
  return acc;
}
