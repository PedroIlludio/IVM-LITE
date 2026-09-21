/**
 * Vias desenhadas sobre a fotogrametria.
 *
 * O traçado é em LAT/LNG, não em coordenadas do modelo: a rua pertence ao
 * terreno, não ao empreendimento — mover o GLB no encaixe não deve arrastar a
 * avenida junto.
 *
 * A via existe em dois modos, e a diferença é ter ou não um perfil manual:
 *
 * - SEM cotas: drapejada (`ClassificationType`). O Cesium a projeta sobre a
 *   superfície que existir, sem altura nenhuma da nossa parte. Sempre funciona,
 *   mas é pintura: herda a textura irregular do que estava lá embaixo.
 * - COM perfil: geometria própria. Cada seção tem um pivô em cada borda, e a
 *   fotogrametria é recortada em toda a coluna delimitada pelas duas linhas.
 *
 * A altura inicial é medida UMA VEZ no editor e gravada. Depois disso os dois
 * lados são manuais. Amostrá-los em tempo de
 * execução foi o que afundou a tentativa anterior: a amostragem do Cesium
 * desiste em silêncio quando os tiles demoram, e a rua saía enterrada ou
 * flutuando conforme a rede do momento.
 */

import type { TipoSuperficie } from "./texturas-superficie";

export type { TipoSuperficie };

/** Ponto geográfico do traçado. */
export interface PontoGeo {
  lat: number;
  lng: number;
}

export interface Via {
  id: string;
  nome?: string;
  /** Eixo da via — o traçado pelo meio dela. */
  pontos: PontoGeo[];
  /** Largura total, em metros. */
  largura: number;
  /** Cor própria; sem ela, a padrão. */
  cor?: string;
  /**
   * Altura do terreno em cada ponto do eixo, em metros acima da elipsoide.
   *
   * MEDIDA UMA VEZ no editor e gravada aqui — não amostrada em tempo de
   * execução. A amostragem do Cesium desiste em silêncio quando os tiles
   * demoram, e uma via que depende dela sai enterrada ou flutuando conforme a
   * rede do momento. Gravada, a via nasce igual em toda máquina.
   *
   * Com cotas, a via vira geometria de verdade e o terreno é RECORTADO sob ela.
   * Sem cotas, ela é apenas drapejada sobre a fotogrametria — que funciona,
   * mas herda a textura irregular do que estava lá.
   */
  cotas?: number[];
  /** Perfil denso; cada seção tem altura manual e independente nas duas bordas. */
  perfil?: PerfilVia[];
  /**
   * Quanto o RECORTE passa da borda do asfalto, em metros por lado.
   *
   * O corte e a pista nasceram da mesma linha, e é justamente por isso que a
   * beirada racha: as duas fronteiras caem no mesmo lugar, e quem decide o que
   * sobra ali é o arredondamento do shader contra a malha irregular da
   * fotogrametria. O resultado é um serrilhado de sobras e faltas alternadas.
   *
   * Separando as duas, a briga acaba. O sinal escolhe qual das duas ganha:
   *
   * - NEGATIVA: o buraco é menor que a pista, e o asfalto passa por cima da
   *   beirada do terreno. É a que apaga o serrilhado — a fronteira da
   *   fotogrametria deixa de ser visível porque fica embaixo da via.
   * - POSITIVA: o buraco é maior, e o terreno recua para longe da pista. Serve
   *   quando a beirada está alta ou esfarrapada demais para ser escondida; o
   *   preço é enxergar a parede lateral da via no vão.
   *
   * Ausente ou zero, o comportamento é o de antes: as duas fronteiras coladas.
   */
  folgaCorte?: number;
  /**
   * Pintura no asfalto: bordas brancas contínuas e eixo amarelo tracejado.
   *
   * Padrão brasileiro — o eixo que separa sentidos é amarelo, o limite da pista
   * é branco. Ausente conta como LIGADA: uma via com cota é uma rua, e rua tem
   * pintura. Desligue em acesso interno, pátio ou estrada de terra.
   */
  faixas?: boolean;
}

export interface PerfilVia extends PontoGeo {
  /** Alturas absolutas acima da elipsoide, em metros. */
  alturaEsq?: number;
  alturaDir?: number;
  /** Formato legado: uma altura central usada como início para os dois lados. */
  cota?: number;
  /**
   * Posição da borda quando ela foi arrastada À MÃO no plano do chão.
   *
   * Ausente, a borda é a bissetriz calculada por `bordasDaVia` a partir do eixo
   * e da largura — que é o certo para uma rua de largura constante. Mas o
   * recorte segue exatamente estas duas linhas, e a fotogrametria não pediu
   * licença para ser regular: um meio-fio que abre numa esquina, um talude, um
   * pedaço de calçada que sobra. Onde a largura uniforme erra, o usuário move o
   * pivô e a borda passa a ser o que ele disse, não o que a fórmula deduziu.
   */
  bordaEsq?: PontoGeo;
  bordaDir?: PontoGeo;
}

/**
 * Área de piso do entorno: gramado, pátio, espelho d'água.
 *
 * Mesma ideia da via — recorta a fotogrametria e põe superfície limpa no lugar
 * — mas com contorno FECHADO e livre, em vez de uma fita de largura constante.
 * É o que resolve o quarteirão do empreendimento, onde a fotogrametria costuma
 * ser um borrão de carro estacionado, sombra e telhado meio derretido.
 *
 * O contorno é desenhado no mapa 2D pelo mesmo motivo do traçado da via: lá o
 * quarteirão está legível, com meio-fio e divisa. Na fotogrametria seria
 * adivinhar limite debaixo de árvore.
 */
export interface VerticeArea extends PontoGeo {
  /** Altura absoluta acima da elipsoide. Medida uma vez, depois manual. */
  altura?: number;
}

export interface Superficie {
  id: string;
  nome?: string;
  tipo: TipoSuperficie;
  /** Contorno fechado: o último ponto liga no primeiro, sem repeti-lo. */
  pontos: VerticeArea[];
  /** Cor sólida no lugar da textura. Vazio = textura do tipo. */
  cor?: string;
  /** Igual ao da via: separa a fronteira do buraco da fronteira do piso. */
  folgaCorte?: number;
  /**
   * PNG/JPG próprio no lugar da textura procedural do tipo.
   *
   * URL de asset do projeto, não data-URL: a imagem entra no JSON do projeto se
   * for embutida, e um PNG de 512² em base64 passa de 300 KB — multiplicado por
   * cada superfície, por cada salvamento e por cada rascunho no `localStorage`,
   * que tem cota pequena. O upload já existe para capa e logo.
   */
  texturaUrl?: string;
  /**
   * Quantos METROS o ladrilho cobre no mundo. É o controle de escala.
   *
   * Em metros, e não em "número de repetições", porque repetição depende do
   * tamanho da área: 8 repetições num gramado de 20 m e num de 200 m dão
   * texturas visualmente diferentes. Em metros, a mesma grama tem o mesmo
   * tamanho em qualquer área — que é como se pensa no mundo real.
   */
  escalaTextura?: number;
  /**
   * Tonalizador multiplicado sobre a textura.
   *
   * Serve para o caso comum de uma textura boa na forma e errada no tom — grama
   * de clima temperado num terreno de cerrado. Multiplicar preserva o grão e a
   * variação; trocar por cor sólida joga os dois fora.
   */
  tinta?: string;
}

export interface EntornoCfg {
  vias?: Via[];
  corVia?: string;
  superficies?: Superficie[];
}

/** Alturas do contorno, ou `null` se alguma ainda não foi medida. */
export function alturasDaArea(pontos: VerticeArea[]): number[] | null {
  if (pontos.length < 3) return null;
  const hs = pontos.map((p) => p.altura);
  return hs.every((h) => Number.isFinite(h)) ? (hs as number[]) : null;
}

/**
 * Contorno afastado (ou encolhido) por `folgaM`, em metros.
 *
 * Cada vértice anda pela BISSETRIZ das duas arestas que chegam nele, dividida
 * pelo cosseno do meio-ângulo — a mesma matemática da fita da via, e pelo mesmo
 * motivo: usando a normal de uma aresta só, um canto abriria vão por fora e se
 * sobreporia por dentro. O teto de 3 evita a agulha infinita num vértice quase
 * dobrado sobre si mesmo.
 *
 * O sinal segue a orientação do anel, então a folga é calculada contra o
 * CENTRO do contorno: positivo sempre afasta, negativo sempre encolhe,
 * independente de o usuário ter desenhado no sentido horário ou anti-horário.
 */
export function contornoComFolga(pontos: PontoGeo[], folgaM: number): PontoGeo[] {
  const n = pontos.length;
  if (n < 3 || !folgaM) return pontos.map((p) => ({ lat: p.lat, lng: p.lng }));

  const lat0 = pontos[0].lat;
  const mLng = mPorGrauLng(lat0);
  const px = pontos.map((p) => ({
    x: (p.lng - pontos[0].lng) * mLng,
    y: (p.lat - lat0) * M_POR_GRAU_LAT,
  }));
  const cx = px.reduce((s, p) => s + p.x, 0) / n;
  const cy = px.reduce((s, p) => s + p.y, 0) / n;

  const normal = (dx: number, dy: number) => {
    const m = Math.hypot(dx, dy);
    return m < 1e-9 ? { x: 0, y: 0 } : { x: -dy / m, y: dx / m };
  };

  return px.map((p, i) => {
    const ant = px[(i - 1 + n) % n];
    const prox = px[(i + 1) % n];
    const nAnt = normal(p.x - ant.x, p.y - ant.y);
    const nProx = normal(prox.x - p.x, prox.y - p.y);
    let nx = nAnt.x + nProx.x;
    let ny = nAnt.y + nProx.y;
    const m = Math.hypot(nx, ny);
    if (m < 1e-6) {
      nx = nProx.x;
      ny = nProx.y;
    } else {
      const cos = Math.max(0.34, (nAnt.x * nx + nAnt.y * ny) / m);
      nx = nx / m / cos;
      ny = ny / m / cos;
    }
    // Para fora é o sentido que se afasta do centro. Resolve a orientação do
    // anel sem precisar calcular área com sinal.
    const paraFora = (p.x - cx) * nx + (p.y - cy) * ny >= 0 ? 1 : -1;
    const x = p.x + nx * folgaM * paraFora;
    const y = p.y + ny * folgaM * paraFora;
    return {
      lat: lat0 + y / M_POR_GRAU_LAT,
      lng: pontos[0].lng + x / mLng,
    };
  });
}

export const COR_VIA_PADRAO = "#4a4a4d";
export const LARGURA_VIA_PADRAO = 7;

/** Metros por grau de latitude — praticamente constante. */
const M_POR_GRAU_LAT = 111_320;

/** Metros por grau de longitude na latitude dada (encolhe pelo cosseno). */
function mPorGrauLng(lat: number): number {
  return M_POR_GRAU_LAT * Math.max(0.01, Math.cos((lat * Math.PI) / 180));
}

/**
 * Fita da via: o eixo engrossado para os dois lados, em lat/lng.
 *
 * A conta acontece num plano métrico local (leste/norte em metros a partir do
 * primeiro ponto) e volta para graus no fim. Nas distâncias de uma rua —
 * centenas de metros — a diferença para a geodésica real é irrelevante, e a
 * planificação deixa a matemática do chanfro ser a mesma de qualquer editor 2D.
 *
 * O deslocamento de cada ponto usa a BISSETRIZ das duas direções que chegam
 * nele. Com a normal de um dos trechos apenas, uma curva abriria um vão do lado
 * de fora e sobreporia do lado de dentro — a fita "quebra" em cada vértice.
 */
export interface PontoDaFita extends PontoGeo {
  /**
   * Índice do ponto do EIXO que originou este ponto da borda. É o que permite
   * dar altura à fita: cada borda herda a cota do trecho de que veio.
   */
  i: number;
}

export function fitaDaVia(pontos: PontoGeo[], larguraM: number): PontoDaFita[] {
  const n = pontos.length;
  if (n < 2 || larguraM <= 0) return [];

  const lat0 = pontos[0].lat;
  const mLng = mPorGrauLng(lat0);
  // Graus → metros locais.
  const px = pontos.map((p) => ({
    x: (p.lng - pontos[0].lng) * mLng,
    y: (p.lat - lat0) * M_POR_GRAU_LAT,
  }));

  const meia = larguraM / 2;
  const normal = (dx: number, dy: number) => {
    const m = Math.hypot(dx, dy);
    return m < 1e-9 ? { x: 0, y: 0 } : { x: -dy / m, y: dx / m };
  };

  const esquerda: { x: number; y: number; i: number }[] = [];
  const direita: { x: number; y: number; i: number }[] = [];

  for (let i = 0; i < n; i++) {
    const nAnt = i > 0 ? normal(px[i].x - px[i - 1].x, px[i].y - px[i - 1].y) : null;
    const nProx = i < n - 1 ? normal(px[i + 1].x - px[i].x, px[i + 1].y - px[i].y) : null;
    let nx: number;
    let ny: number;
    if (nAnt && nProx) {
      const sx = nAnt.x + nProx.x;
      const sy = nAnt.y + nProx.y;
      const m = Math.hypot(sx, sy);
      // Curva de 180° (ida e volta pelo mesmo caminho) anula a soma: não há
      // bissetriz definida e a normal de um dos trechos é a melhor resposta.
      if (m < 1e-6) {
        nx = nProx.x;
        ny = nProx.y;
      } else {
        // A bissetriz encurta na curva; dividir pelo cosseno do meio-ângulo
        // devolve a largura constante. O teto de 3 evita a agulha infinita de
        // um vértice quase dobrado sobre si.
        const cos = Math.max(0.34, (nAnt.x * sx + nAnt.y * sy) / m);
        nx = sx / m / cos;
        ny = sy / m / cos;
      }
    } else {
      const u = (nAnt ?? nProx)!;
      nx = u.x;
      ny = u.y;
    }
    esquerda.push({ x: px[i].x + nx * meia, y: px[i].y + ny * meia, i });
    direita.push({ x: px[i].x - nx * meia, y: px[i].y - ny * meia, i });
  }

  // Um lado na ida, o outro na volta: o anel fechado do polígono.
  return [...esquerda, ...direita.reverse()].map((p) => ({
    lat: lat0 + p.y / M_POR_GRAU_LAT,
    lng: pontos[0].lng + p.x / mLng,
    i: p.i,
  }));
}

/** Ponto do traçado com a cota já resolvida. */
export interface PontoComCota extends PontoGeo {
  altura: number;
}

/** Distância entre dois pontos, no plano métrico local. */
export function distanciaM(a: PontoGeo, b: PontoGeo): number {
  const dLat = (b.lat - a.lat) * M_POR_GRAU_LAT;
  const dLng = (b.lng - a.lng) * mPorGrauLng((a.lat + b.lat) / 2);
  return Math.hypot(dLat, dLng);
}

/** Ponto a fração `t` do caminho de `a` até `b`. */
export function interpolarGeo(a: PontoGeo, b: PontoGeo, t: number): PontoGeo {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Quadrilátero de largura constante ao longo do segmento `a`→`b`.
 *
 * É o que faz uma faixa de pintura ter LARGURA EM METROS. Uma polilinha do
 * Cesium tem espessura em pixels: fica grossa de longe e some de perto, o que
 * denuncia na hora que aquilo é um traçado de editor e não tinta no asfalto.
 */
export function fitaDeSegmento(a: PontoGeo, b: PontoGeo, larguraM: number): PontoGeo[] {
  const mLng = mPorGrauLng((a.lat + b.lat) / 2);
  const dx = (b.lng - a.lng) * mLng;
  const dy = (b.lat - a.lat) * M_POR_GRAU_LAT;
  const m = Math.hypot(dx, dy);
  if (m < 1e-9) return [];
  const nx = (-dy / m) * (larguraM / 2);
  const ny = (dx / m) * (larguraM / 2);
  const desl = (p: PontoGeo, sx: number, sy: number): PontoGeo => ({
    lat: p.lat + sy / M_POR_GRAU_LAT,
    lng: p.lng + sx / mLng,
  });
  return [desl(a, nx, ny), desl(b, nx, ny), desl(b, -nx, -ny), desl(a, -nx, -ny)];
}

/**
 * Corta a polilinha em traços de comprimento fixo separados por vãos.
 *
 * A cadência é medida em COMPRIMENTO DE ARCO, não por seção do perfil: as
 * seções vêm de `densificarVia`, que arredonda o passo para caber inteiro em
 * cada trecho, então amarrar o tracejado a elas daria traços de tamanhos
 * diferentes a cada curva — que é exatamente o que não existe numa rua.
 */
export function tracejarEixo(
  eixo: PontoComCota[], tracoM: number, vaoM: number,
): Array<[PontoComCota, PontoComCota]> {
  if (eixo.length < 2 || tracoM <= 0 || vaoM <= 0) return [];
  const acum = [0];
  for (let i = 1; i < eixo.length; i++) {
    acum.push(acum[i - 1] + distanciaM(eixo[i - 1], eixo[i]));
  }
  const total = acum[acum.length - 1];
  if (!(total > tracoM)) return [];

  const em = (s: number): PontoComCota => {
    let i = 1;
    while (i < acum.length - 1 && acum[i] < s) i++;
    const vao = acum[i] - acum[i - 1];
    const t = vao > 1e-6 ? (s - acum[i - 1]) / vao : 0;
    return {
      ...interpolarGeo(eixo[i - 1], eixo[i], t),
      altura: eixo[i - 1].altura + (eixo[i].altura - eixo[i - 1].altura) * t,
    };
  };

  const out: Array<[PontoComCota, PontoComCota]> = [];
  const passo = tracoM + vaoM;
  for (let s = 0; s < total; s += passo) {
    const fim = Math.min(s + tracoM, total);
    // Um toco no fim da rua fica pior do que nenhum traço: a pintura real
    // termina no último traço inteiro.
    if (fim - s < tracoM * 0.6) break;
    out.push([em(s), em(fim)]);
  }
  return out;
}

/** Comprimento do traçado, em metros. */
export function comprimentoDaVia(pontos: PontoGeo[]): number {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    const dLat = (pontos[i].lat - pontos[i - 1].lat) * M_POR_GRAU_LAT;
    const dLng = (pontos[i].lng - pontos[i - 1].lng) * mPorGrauLng(pontos[i].lat);
    total += Math.hypot(dLat, dLng);
  }
  return total;
}

/** As duas bordas na mesma ordem do eixo, uma seção transversal por ponto. */
export function bordasDaVia(pontos: PontoGeo[], larguraM: number): {
  esquerda: PontoDaFita[];
  direita: PontoDaFita[];
} {
  const anel = fitaDaVia(pontos, larguraM);
  const n = pontos.length;
  return {
    esquerda: anel.slice(0, n),
    // `fitaDaVia` põe a direita em ordem inversa para fechar o anel.
    direita: anel.slice(n).reverse(),
  };
}

/**
 * As bordas que valem: a bissetriz de `bordasDaVia`, com os pontos que o
 * usuário arrastou à mão no lugar dos calculados.
 *
 * É a ÚNICA fonte de borda que a cena deve usar — malha, linhas, pivôs e
 * recorte. Enquanto cada um chamava `bordasDaVia` por conta própria, mover um
 * pivô mudava o desenho e não mudava o buraco, ou o contrário.
 */
export function bordasEfetivas(
  eixo: PontoGeo[], larguraM: number, folgaM = 0,
): { esquerda: PontoDaFita[]; direita: PontoDaFita[] } {
  const { esquerda, direita } = bordasDaVia(eixo, larguraM);
  const manual = (i: number, lado: "bordaEsq" | "bordaDir"): PontoDaFita | null => {
    const m = (eixo[i] as PerfilVia | undefined)?.[lado];
    return m ? { lat: m.lat, lng: m.lng, i } : null;
  };
  const esq = esquerda.map((p, i) => manual(i, "bordaEsq") ?? p);
  const dir = direita.map((p, i) => manual(i, "bordaDir") ?? p);
  if (!folgaM) return { esquerda: esq, direita: dir };

  /**
   * A folga anda na direção de UMA BORDA PARA A OUTRA, medida na própria seção.
   *
   * A primeira versão afastava cada borda a partir do EIXO, e isso quebrava
   * exatamente quando o recurso mais serve. Mover os dois pivôs de uma seção
   * para o mesmo lado desloca a pista, mas não o eixo — que continua no lugar
   * antigo. A borda de trás passava a ficar perto do eixo, ou do outro lado
   * dele, e "afastar do eixo" deixava de significar qualquer coisa: a distância
   * ia a zero, o piso de segurança entrava e o corte colapsava de volta para
   * cima do eixo original. Era o "voltou para a posição inicial".
   *
   * Entre as duas bordas efetivas não existe esse caso degenerado: a direção é
   * a da seção real, depois de todo arraste, e a largura para converter metros
   * em fração é a que a pista de fato tem ali.
   */
  const comFolga = (i: number) => {
    const a = esq[i];
    const b = dir[i];
    const largura = distanciaM(a, b);
    if (largura < 1e-6) return { e: a, d: b };
    // Encolher no máximo 45% por lado: além disso as duas bordas se cruzariam e
    // o polígono viraria do avesso.
    const u = Math.max(-0.45, folgaM / largura);
    return {
      e: { ...interpolarGeo(a, b, -u), i: a.i },
      d: { ...interpolarGeo(b, a, -u), i: b.i },
    };
  };
  const ajustadas = esq.map((_, i) => comFolga(i));
  return {
    esquerda: ajustadas.map((x) => x.e),
    direita: ajustadas.map((x) => x.d),
  };
}

/** Alturas efetivas de uma seção, incluindo migração transparente do legado. */
export function alturasDaSecao(p: PerfilVia): { esquerda: number; direita: number } | null {
  const esquerda = p.alturaEsq ?? p.cota;
  const direita = p.alturaDir ?? p.cota;
  return Number.isFinite(esquerda) && Number.isFinite(direita)
    ? { esquerda: esquerda as number, direita: direita as number }
    : null;
}

/**
 * Insere amostras igualmente espaçadas sem alterar os pontos de controle.
 * Uma reta de 500 m com cota só nas pontas viraria uma rampa artificial;
 * amostrar a cada 12 m acompanha lombas, vales e inclinação real da rua.
 */
export function densificarVia(pontos: PontoGeo[], passoM = 12): PontoGeo[] {
  if (pontos.length < 2) return [...pontos];
  const out: PontoGeo[] = [{ ...pontos[0] }];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1];
    const b = pontos[i];
    const dLat = (b.lat - a.lat) * M_POR_GRAU_LAT;
    const dLng = (b.lng - a.lng) * mPorGrauLng((a.lat + b.lat) / 2);
    const distancia = Math.hypot(dLat, dLng);
    const partes = Math.max(1, Math.ceil(distancia / Math.max(2, passoM)));
    for (let j = 1; j <= partes; j++) {
      const t = j / partes;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }
  return out;
}

/**
 * Migra as cotas centrais antigas para o perfil manual denso. A interpolação
 * só fornece a posição inicial dos pivôs; depois cada lado é independente.
 */
export function densificarViaComCotas(
  pontos: PontoGeo[], cotas: number[], passoM = 12,
): PerfilVia[] {
  if (pontos.length < 2 || cotas.length !== pontos.length) return [];
  const out: PerfilVia[] = [{
    ...pontos[0], alturaEsq: cotas[0], alturaDir: cotas[0],
  }];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1];
    const b = pontos[i];
    const dLat = (b.lat - a.lat) * M_POR_GRAU_LAT;
    const dLng = (b.lng - a.lng) * mPorGrauLng((a.lat + b.lat) / 2);
    const partes = Math.max(1, Math.ceil(Math.hypot(dLat, dLng) / Math.max(2, passoM)));
    for (let j = 1; j <= partes; j++) {
      const t = j / partes;
      const altura = cotas[i - 1] + (cotas[i] - cotas[i - 1]) * t;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        alturaEsq: altura,
        alturaDir: altura,
      });
    }
  }
  return out;
}
