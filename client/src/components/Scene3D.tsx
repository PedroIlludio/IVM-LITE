import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Viewer,
  Cartesian3,
  Cartographic,
  Cartesian2,
  Color,
  Math as CesiumMath,
  JulianDate,
  HeadingPitchRoll,
  HeadingPitchRange,
  Intersect,
  HeightReference,
  BoundingSphere,
  Transforms,
  Matrix3,
  Matrix4,
  Quaternion,
  ShadowMode,
  Model,
  Entity,
  ConstantProperty,
  ConstantPositionProperty,
  ColorMaterialProperty,
  ImageMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  KeyboardEventModifier,
  LabelStyle,
  VerticalOrigin,
  NearFarScalar,
  Plane,
  IntersectionTests,
  CallbackProperty,
  CallbackPositionProperty,
  PolylineArrowMaterialProperty,
  ColorBlendMode,
  ClippingPlaneCollection,
  ClippingPlane,
  ClippingPolygon,
  ClippingPolygonCollection,
  ClassificationType,
  Ellipsoid,
  Cartesian4,
  PolygonHierarchy,
  PolylineGraphics,
  PostProcessStage,
  type Cesium3DTileset,
} from "cesium";
import { createVision3DViewer, FALLBACK_GROUND_HEIGHT } from "@/lib/cesium-setup";
import { corDaCategoriaPoi } from "@/lib/poi-icones";
import { medirGlb, type CaixaGlb } from "@/lib/glb-bounds";
import {
  COR_VIA_PADRAO, alturasDaSecao, bordasEfetivas,
  distanciaM, interpolarGeo, fitaDeSegmento, tracejarEixo,
  alturasDaArea, contornoComFolga,
  type PerfilVia, type PontoComCota, type PontoGeo, type Superficie, type Via,
} from "@/lib/entorno";
import {
  METROS_POR_LADRILHO, texturaDe, COR_SUPERFICIE,
} from "@/lib/texturas-superficie";
import type { Building3D } from "@/lib/vision3d-config";
import type { CameraView } from "@/lib/placements";
import type { UnitBox } from "@/lib/unidades3d";

/**
 * Corte de pavimento: um plano horizontal no espaço do modelo, opcionalmente
 * limitado à pegada de um bloco.
 *
 * Sem `bloco`, o corte atravessa o empreendimento inteiro — o comportamento
 * antigo, e o certo para um prédio único. Com `bloco`, só aquela torre é
 * aberta e as vizinhas ficam íntegras, que é o que dá contexto ao cliente.
 */
export interface CorteDef {
  /** Altura do corte em metros do MODELO (pré-escala), como `posicao.z`. */
  z: number;
  /** Retângulo do corte; tudo acima dele some. Ausente = o modelo inteiro. */
  area?: { x: number; y: number; comprimento: number; largura: number; rot: number };
}

/** Caixa da torre em edição, desenhada como contorno para calibrar o volume. */
export interface TowerOutline {
  buildingId: string;
  /** Centro no plano do modelo e base do bloco. */
  x: number;
  y: number;
  z: number;
  comprimento: number;
  largura: number;
  altura: number;
  rot: number;
  rotX?: number;
  rotY?: number;
}

export interface Scene3DHandle {
  getCurrentCamera: () => CameraView | null;
  flyToCamera: (cam: CameraView, duration?: number) => void;
  /** Voa até um POI. `cam` (enquadramento salvo) é usado só se for plausível. */
  flyToPoi: (lat: number, lng: number, cam?: CameraView) => void;
  flyHome: () => void;
  /** Corta o modelo do empreendimento selecionado (null = limpa). */
  cutAtFloor: (corte: CorteDef | number | null) => void;
  /** Voa a câmera para a altura de um pavimento, olhando para o mar. */
  viewFromFloor: (camH: number, heading: number, duration?: number) => void;
  /** Visão externa oblíqua para ver o corte. */
  viewCutExternal: (duration?: number) => void;
  /**
   * Vista do corte: a `distancia` metros do modelo do centro da área, na
   * inclinação `pitchGraus` (-90 = de cima) e girada `giroGraus` a partir do
   * eixo maior do retângulo.
   */
  viewCorteDeCima: (
    corte: CorteDef, distancia: number,
    pitchGraus?: number, giroGraus?: number, duration?: number,
  ) => void;
  /** Enquadra o prédio selecionado (visão externa). */
  frameBuilding: () => void;
  /**
   * O empreendimento já está enquadrado na tela?
   *
   * Serve para NÃO mexer na câmera quando não precisa. Os botões da vitrine
   * voavam para o enquadramento gravado no editor toda vez, e isso jogava fora
   * o ponto de vista que o visitante acabou de construir girando a maquete.
   */
  predioEnquadrado: () => boolean;
  /** Enquadra uma unidade do espelho 3D (pelo id da caixa). */
  frameUnit: (
    unitId: string,
    /** Enquadramento configurado da unidade; sem ele, mantém o azimute atual. */
    cam?: { angulo: number; inclinacao: number; distancia: number },
    duration?: number,
  ) => boolean;
  /** Converte um ponto do mapa nas coordenadas X/Y do modelo (editor). */
  modelLocalFromLatLng: (buildingId: string, lat: number, lng: number) => { x: number; y: number } | null;
  /**
   * Imagem do que está na tela agora, como data URL JPEG. Usada para a
   * miniatura das vistas salvas e para o botão de captura da experiência.
   * `maxW` limita a largura (a altura acompanha a proporção).
   */
  captureImage: (maxW?: number, quality?: number) => string | null;
  /**
   * Mede a altura do terreno em cada ponto do traçado. Devolve `null` se a
   * amostragem falhar — quem chama deve manter a via drapejada, não inventar
   * cota.
   */
  medirCotas: (pontos: PontoGeo[]) => Promise<number[] | null>;
}

// A cor do POI vem de `lib/poi-icones`, a mesma fonte do mapa 2D e do editor.
// Havia aqui uma terceira tabela fixa, que ignorava o `estiloCategoriaPoi` do
// projeto: uma categoria criada pelo usuário ("Marina") aparecia com a cor
// escolhida no mapa, com outra cor na lista do editor e cinza na cena 3D.

interface Scene3DProps {
  apiKey: string;
  buildings: Building3D[];
  /** Instante UTC do sol (já convertido do horário local). */
  solarUtc: Date;
  /** Elevação solar em graus; dirige céu, luz e contraste do crepúsculo. */
  solarAltitude?: number;
  selectedId: string | null;
  editMode?: boolean;
  onSelect?: (id: string | null) => void;
  onReady?: () => void;
  /**
   * Há um GLB baixando agora.
   *
   * `onReady` avisa que o VIEWER existe — o que acontece em milissegundos,
   * muito antes de o modelo estar na cena. Quem só escutava `onReady` tirava a
   * tela de carregamento cedo demais e o prédio surgia do nada, segundos
   * depois, sobre uma cena já entregue como pronta. Este aviso cobre justamente
   * a janela entre uma coisa e outra.
   */
  onModelLoading?: (carregando: boolean) => void;
  onError?: (msg: string) => void;
  /** Clique no terreno em modo edição, com um empreendimento selecionado. */
  onEditPlace?: (id: string, lat: number, lng: number) => void;
  /** Arraste dos gizmos (modo edição): atualiza posição/rotação/escala ao vivo. */
  onEditTransform?: (
    id: string,
    patch: Partial<Record<
      "offsetEast" | "offsetNorth" | "heightOffset" | "heading" | "pitch" | "roll" | "scale",
      number
    >>,
  ) => void;
  /** Espelho de vendas em 3D: uma caixa por unidade, colorida por status. */
  unitBoxes?: UnitBox[];
  /**
   * Clique numa unidade do espelho 3D. Os modificadores acompanham o clique
   * para o editor poder acumular a seleção (Ctrl) sem reimplementar o
   * rastreamento de teclado — a cena já o mantém para o encaixe do gizmo.
   */
  onSelectUnit?: (unitId: string, mods: { ctrl: boolean; shift: boolean }) => void;
  /** Contorno da torre em calibração (editor). */
  towerOutline?: TowerOutline | null;
  /**
   * Retângulo do corte em edição, desenhado como uma laje fina na altura do
   * corte. Sem ele o ajuste é às cegas: o recorte só se enxerga onde há
   * geometria, e é justamente na borda vazia que se erra o enquadramento.
   */
  corteArea?: (CorteDef & { buildingId: string }) | null;
  /**
   * Planta deitada no chão do pavimento.
   *
   * Vem pronta da página em vez de o Scene3D vasculhar os níveis: quem sabe
   * QUAL nível está aberto é quem controla a navegação — no editor é o nível em
   * edição, na vitrine é o pavimento que o visitante escolheu. Duas regras
   * diferentes que não cabem aqui dentro.
   */
  plantaPavimento?: {
    buildingId: string;
    url: string;
    /** Mesmo retângulo do corte: posição, tamanho e giro no espaço do modelo. */
    area: { x: number; y: number; comprimento: number; largura: number; rot: number };
    /** Altura já somada (corte + deslocamento), em metros do modelo. */
    z: number;
    opacidade?: number;
  } | null;
  /** Há um posicionamento por clique em curso: o clique não seleciona, posiciona. */
  placementActive?: boolean;
  /**
   * Modo noturno: baixa a luz da cena e realça o modelo para ele não virar uma
   * silhueta preta. Não acende janelas — isso depende de material emissivo no
   * próprio GLB, que o Cesium respeita mas não sabe criar.
   */
  /**
   * Mostrar a fotogrametria do Google (a cidade em volta).
   *
   * Desligada, o empreendimento fica "flutuando": o GLB, o espelho de vendas e
   * a simulação solar continuam inteiros, e o que sai é o streaming de tiles —
   * de longe o item mais caro da cena, e o que trava tablet.
   */
  cidade?: boolean;
  /**
   * Navegação em ÓRBITA em torno do empreendimento.
   *
   * O controle padrão do Cesium é de globo: arrastar gira a Terra e, de perto,
   * isso se lê como arrastar o chão — some com o prédio de vista e ninguém
   * entende como voltar. Numa vitrine o objeto é UM só, então o gesto natural é
   * o de maquete: arrasta e o prédio roda, roda do mouse aproxima e afasta.
   *
   * Ligada só na vitrine. O editor precisa de câmera livre para posicionar
   * modelo, traçar via e desenhar área.
   */
  orbitar?: boolean;
  noturno?: boolean;
  /** Quanto realçar o modelo à noite (0..1). */
  realceNoturno?: number;
  /** Heading da câmera em graus, emitido durante o movimento (bússola). */
  onCameraMove?: (headingGraus: number) => void;
  /**
   * Recorte da fotogrametria sob o empreendimento.
   *
   * A pegada é MEDIDA no GLB — não vem daqui. `folga` é a sobra em volta.
   *
   * `preview` existe porque o recorte APAGA a superfície de que o editor
   * depende: `clampToHeightMostDetailed` (a altura do terreno) e `pickGround`
   * (o clique para posicionar) consultam a geometria da cena, e dentro do
   * buraco não há geometria. Por isso ele fica DESLIGADO no editor por padrão,
   * e o `preview` o liga temporariamente só para conferir o resultado.
   */
  recorteTerreno?: { folga?: number; preview?: boolean } | null;
  /** Preview temporário compartilhado pelo recorte da base e das vias. */
  previewRecorte?: boolean;
  /**
   * Vias desenhadas sobre a fotogrametria, traçadas no mapa em lat/lng.
   *
   * Sem perfil ficam drapejadas. Com perfil, cada seção tem duas alturas
   * manuais e substitui a fotogrametria recortada dentro das bordas.
   */
  vias?: Via[] | null;
  corVia?: string;
  /** Via cujas seções transversais exibem os dois pivôs verticais. */
  viaEditandoId?: string | null;
  /** Perfil manual alterado ao arrastar um pivô esquerdo/direito. */
  onViaPerfil?: (viaId: string, perfil: PerfilVia[]) => void;
  /**
   * Áreas de piso do entorno — gramado, pátio, espelho d'água.
   *
   * Mesmo contrato das vias: sem altura ficam drapejadas sobre a fotogrametria;
   * com altura viram geometria própria e recortam o terreno debaixo.
   */
  /**
   * Unidade com o contorno em edição: mostra um pivô por vértice e um "+" no
   * meio de cada aresta.
   */
  unidadePlantaId?: string | null;
  /** Contorno alterado ao arrastar um pivô (ou inserir um vértice). */
  onUnidadePlanta?: (unidadeId: string, planta: { x: number; y: number }[]) => void;
  superficies?: Superficie[] | null;
  /** Superfície cujos vértices exibem os pivôs. */
  areaEditandoId?: string | null;
  /** Contorno alterado ao arrastar um pivô da área. */
  onAreaPontos?: (areaId: string, pontos: Superficie["pontos"]) => void;
  /**
   * Ferramenta ativa do gizmo, como em qualquer editor 3D: só a alça da
   * ferramenta escolhida aparece. Com as cinco alças na tela ao mesmo tempo,
   * acertar a certa era loteria.
   */
  gizmoModo?: GizmoModo;
  /** Valor em curso durante o arraste (para exibir sobre o viewport). */
  onGizmoInfo?: (info: string | null) => void;
  /**
   * Mostra o pivô do EMPREENDIMENTO (posição/giro/escala do GLB inteiro).
   *
   * Existe separado de `editMode` porque as duas coisas não são a mesma: o
   * editor está sempre em modo edição (é dele que dependem o clique de
   * posicionar e o arraste), mas o pivô do modelo só faz sentido na aba em que
   * ele se edita. Fora dela, as alças ficavam plantadas no meio da cena e —
   * como os pontos das pontas ignoram profundidade — roubavam o clique de
   * tudo o que estivesse atrás.
   */
  gizmoEmpreendimento?: boolean;
  /** Pivô de um alvo no espaço do modelo (torre, unidade avulsa, grupo). */
  gizmoLocal?: GizmoLocal | null;
  /** Arraste do pivô local, em coordenadas do modelo. */
  onGizmoLocalTransform?: (id: string, patch: GizmoLocalPatch) => void;
}

/** Ferramentas de manipulação do modelo. */
export type GizmoModo = "mover" | "girar" | "escalar";

/**
 * Alvo do pivô no referencial do MODELO (não o ENU do mundo).
 *
 * As torres e as unidades avulsas guardam X/Y/Z em metros do modelo, então o
 * pivô delas tem de andar nos eixos do modelo: puxar a seta vermelha muda o
 * campo "X (m)" e nada mais. Um pivô em ENU faria cada arraste mexer nos três
 * campos ao mesmo tempo, que é o oposto de calibrar.
 */
export interface GizmoLocal {
  /** Identifica o alvo para o editor (`torre:<id>`, `unidade:<id>`, `grupo`). */
  id: string;
  buildingId: string;
  x: number;
  y: number;
  z: number;
  /** Giro em torno do Z do modelo (graus, anti-horário). */
  rot: number;
  /** Inclinação nos eixos X e Y do modelo (graus). Compostos Rz · Ry · Rx. */
  rotX?: number;
  rotY?: number;
  /** Caixa do alvo: define o tamanho das alças e o que a escala redimensiona. */
  dims?: { dx: number; dy: number; dz: number };
  /**
   * O alvo não tem altura própria — o plano de corte é o caso: ele tem um
   * retângulo (X e Y) mas nenhuma espessura, e o `dz` que vai em `dims` é só
   * um valor de fachada para as alças terem tamanho. Sem isto a alça azul de
   * escala apareceria e não faria absolutamente nada ao ser arrastada.
   */
  semEscalaZ?: boolean;
  /** Seleção múltipla: só a translação tem significado sobre um centroide. */
  somenteMover?: boolean;
  /**
   * Só a alça vertical. É o pivô de um corte de pavimento: ele tem uma
   * liberdade só — a altura —, e mostrar as três setas convidaria a arrastar
   * as duas que não fazem nada.
   */
  somenteZ?: boolean;
}

/** Patch emitido pelo arraste do pivô local (metros/graus do modelo). */
export type GizmoLocalPatch = Partial<
  Record<"x" | "y" | "z" | "rot" | "rotX" | "rotY" | "dx" | "dy" | "dz", number>
>;

/** Os três anéis do modo girar, nomeados pelo eixo em torno do qual giram. */
type AnelKind = "rot" | "rotX" | "rotY";

interface BuildingNode {
  model?: Model;
  box?: Entity;
  marker?: Entity;
  loadedUrl?: string;
  /**
   * URL do GLB em voo AGORA.
   *
   * `loadedUrl` só é gravado quando o download termina, então enquanto ele
   * corria o `reconcile` continuava vendo "o modelo carregado não é o pedido" e
   * disparava outro. E `reconcile` roda a cada mudança de `buildings` — que no
   * editor é a cada tecla digitada: dava para ter meia dúzia de downloads do
   * mesmo arquivo de 23 MB em paralelo.
   */
  loadingUrl?: string;
  /** Símbolo em uso no marcador — se mudar, o marcador é recriado. */
  markerImg?: string;
  groundHeight: number;
}

// Paleta da marca Quinta das Mangueiras.
const BRAND_TURQUOISE = "#12a19a";
const BRAND_NAVY = "#094676";
const MARKER_BG = Color.fromCssColorString(BRAND_NAVY).withAlpha(0.92);
const MARKER_BG_SEL = Color.fromCssColorString(BRAND_TURQUOISE).withAlpha(0.96);

/**
 * Opções de polilinha das alças — passa direto, existe só para marcar o ponto.
 *
 * ATENÇÃO: `disableDepthTestDistance` NÃO existe em PolylineGraphics — só em
 * pontos, rótulos e billboards. Ele estava sendo passado aqui e simplesmente
 * ignorado, o que significa que as setas SÃO testadas em profundidade e podem
 * ficar escondidas dentro do modelo. Por isso quem carrega o clique são os
 * PONTOS nas pontas, que aceitam a propriedade e ficam sempre por cima.
 */
function linhaDaAlca(opts: PolylineGraphics.ConstructorOptions): PolylineGraphics.ConstructorOptions {
  return opts;
}

/**
 * Fundo do modo estúdio (entorno escondido).
 *
 * Cinza claro levemente frio: é o fundo de render de apresentação de maquete —
 * claro o bastante para a silhueta escura do prédio se destacar, neutro o
 * bastante para não disputar com a fachada nem sugerir hora do dia.
 */
const FUNDO_ESTUDIO = "#d6d8da";

const Scene3D = forwardRef<Scene3DHandle, Scene3DProps>(function Scene3D(
  {
    apiKey, buildings, solarUtc, solarAltitude = 45, selectedId, editMode, onSelect, onReady,
    onModelLoading, onError,
    onEditPlace, onEditTransform, unitBoxes, onSelectUnit, towerOutline, placementActive,
    cidade = true, orbitar = false, noturno, realceNoturno = 0.45, onCameraMove, gizmoModo = "mover", onGizmoInfo,
    gizmoEmpreendimento = true, gizmoLocal = null, onGizmoLocalTransform, corteArea = null,
    plantaPavimento = null,
    recorteTerreno = null, previewRecorte = false, vias = null, corVia,
    viaEditandoId = null, onViaPerfil,
    superficies = null, areaEditandoId = null, onAreaPontos,
    unidadePlantaId = null, onUnidadePlanta,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const skyBoxRef = useRef<Viewer["scene"]["skyBox"] | null>(null);
  const nightStageRef = useRef<PostProcessStage | null>(null);
  const nightAmountRef = useRef(0);
  const tilesetRef = useRef<Cesium3DTileset | null>(null);
  /**
   * Recorte da fotogrametria. A coleção é criada UMA vez e presa ao tileset:
   * reatribuir `clippingPolygons` obrigaria o Cesium a refazer a textura de
   * distância e recarregar tiles a cada mudança.
   */
  const recorteRef = useRef<ClippingPolygonCollection | null>(null);
  const recorteAtualRef = useRef(recorteTerreno);
  recorteAtualRef.current = recorteTerreno;
  /**
   * `previewRecorte` também por ref: `aplicarRecorteTerreno` é chamada de dentro
   * da init do viewer e do `then` que mede o GLB — dois lugares presos ao
   * PRIMEIRO render. Lendo a prop direto, essas chamadas decidiam com o valor
   * inicial (falso) e desligavam um recorte que já devia estar ligado.
   */
  const previewRecorteRef = useRef(previewRecorte);
  previewRecorteRef.current = previewRecorte;
  /**
   * `?recorteDebug=1` na URL: escreve no console por que o recorte cortou ou não
   * e pinta a textura de distância do Cesium sobre a cena (vermelho = fora do
   * polígono, verde = dentro). É a única forma de distinguir "o polígono não foi
   * criado" de "o polígono foi criado no lugar errado".
   */
  const recorteDebugRef = useRef(false);
  if (typeof window !== "undefined" && !recorteDebugRef.current) {
    recorteDebugRef.current =
      new URLSearchParams(window.location.search).get("recorteDebug") === "1";
  }
  /** Caixa medida de cada GLB, por URL. Medida uma vez por arquivo. */
  const caixaGlbRef = useRef<Map<string, CaixaGlb | null>>(new Map());
  /** Entidades das vias desenhadas. */
  const viasRef = useRef<Entity[]>([]);
  const viasAtualRef = useRef<Via[]>(vias ?? []);
  viasAtualRef.current = vias ?? [];
  const corViaRef = useRef(corVia);
  corViaRef.current = corVia;
  /** Entidades das superfícies. Separadas das vias: os ciclos não coincidem. */
  const areasRef = useRef<Entity[]>([]);
  const areasAtualRef = useRef<Superficie[]>(superficies ?? []);
  areasAtualRef.current = superficies ?? [];
  const areaEditandoRef = useRef(areaEditandoId);
  areaEditandoRef.current = areaEditandoId;
  const onAreaPontosRef = useRef(onAreaPontos);
  onAreaPontosRef.current = onAreaPontos;
  /**
   * Caixas das unidades por REF.
   *
   * `plantaPivotDown` é chamada de dentro do `pointerdown`, e esse handler foi
   * registrado UMA vez na init: lendo a prop, ele enxergaria a lista do
   * primeiro render — vazia — e nunca encontraria a unidade. Os pivôs
   * apareciam e não respondiam ao clique.
   */
  const unitBoxesRef = useRef<UnitBox[]>(unitBoxes ?? []);
  unitBoxesRef.current = unitBoxes ?? [];
  /** Pivôs do contorno da unidade em edição. */
  const plantaUnidRef = useRef<Entity[]>([]);
  const unidadePlantaIdRef = useRef(unidadePlantaId);
  unidadePlantaIdRef.current = unidadePlantaId;
  const onUnidadePlantaRef = useRef(onUnidadePlanta);
  onUnidadePlantaRef.current = onUnidadePlanta;
  /** Arraste de um vértice do contorno da unidade. */
  const plantaDragRef = useRef<null | {
    unidadeId: string;
    index: number;
    ub: UnitBox;
    /** `plano` move o canto no chão; `altura` sobe e desce só ele. */
    modo: "plano" | "altura";
    /** O pivô agarrado é o do teto (senão, o do piso). */
    noTopo: boolean;
    axisO: Cartesian3;
    axisD: Cartesian3;
    startNoPlano?: Cartesian3;
    startScalar: number;
    startZ: number;
    planta: { x: number; y: number; z?: number; zTopo?: number }[];
    lastEmit: number;
  }>(null);
  const viaEditandoRef = useRef(viaEditandoId);
  viaEditandoRef.current = viaEditandoId;
  const onViaPerfilRef = useRef(onViaPerfil);
  onViaPerfilRef.current = onViaPerfil;
  const nodesRef = useRef<Map<string, BuildingNode>>(new Map());
  const poiMarkersRef = useRef<Entity[]>([]);
  const readyRef = useRef(false);
  /**
   * Mesma prontidão do `readyRef`, mas como ESTADO.
   *
   * Os efeitos que sincronizam a cena começam com `if (!readyRef.current)
   * return`. Ref não dispara render, então um efeito que chegasse antes do
   * viewer existir desistia e NUNCA era tentado de novo — só voltaria a rodar
   * se a chave dele mudasse por outro motivo.
   *
   * É uma corrida que a vitrine não corre e o editor corre sempre: lá o Scene3D
   * só monta com o projeto na mão, aqui ele monta junto com a página e as vias,
   * superfícies e o recorte chegam enquanto o tileset do Google ainda está
   * sendo baixado. Daí "não corta de primeira no editor, na vitrine está
   * normal". Com o estado na lista de dependências, tudo é reaplicado no
   * instante em que a cena fica pronta.
   */
  const [pronto, setPronto] = useState(false);
  /**
   * Modelos baixando agora, por id de empreendimento. É um conjunto, e não um
   * booleano, porque a cena aceita vários prédios: o carregamento só termina
   * quando o último deles termina.
   */
  const carregandoRef = useRef<Set<string>>(new Set());
  const onModelLoadingRef = useRef(onModelLoading);
  onModelLoadingRef.current = onModelLoading;

  /** Entra/sai da lista de carregamento e avisa a página só quando o todo muda. */
  function marcarCarregamento(id: string, carregando: boolean) {
    const s = carregandoRef.current;
    const antes = s.size > 0;
    if (carregando) s.add(id);
    else s.delete(id);
    const agora = s.size > 0;
    if (antes !== agora) onModelLoadingRef.current?.(agora);
  }
  // Entidades do espelho 3D, por id de unidade.
  const unitEntitiesRef = useRef<Map<string, Entity>>(new Map());
  /** Tampas (piso e teto) das unidades com contorno próprio. */
  const unitFacesRef = useRef<Map<string, Entity[]>>(new Map());
  /** Assinatura da última versão aplicada; evita reconstruir caixas no clique. */
  const unitEntityKeyRef = useRef<Map<string, string>>(new Map());
  /** Contornos de seleção separados: selecionar não reconstrói a caixa-base. */
  const unitSelectionRef = useRef<Map<string, Entity>>(new Map());
  const outlineRef = useRef<Entity | null>(null);
  /** Laje do retângulo do corte em edição. */
  const corteAreaRef = useRef<Entity | null>(null);
  /** Planta deitada no chão do pavimento. */
  const plantaChaoRef = useRef<Entity | null>(null);
  /** Contorno do terreno (perímetro do empreendimento). */
  const perimetroRef = useRef<Entity[]>([]);
  const onSelectUnitRef = useRef(onSelectUnit);
  onSelectUnitRef.current = onSelectUnit;
  // O handler de clique é registrado uma vez na init, então ele congelaria o
  // callback do primeiro render — daí a ref (mesmo motivo dos outros aqui).
  const onEditPlaceRef = useRef(onEditPlace);
  onEditPlaceRef.current = onEditPlace;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const placementRef = useRef(placementActive);
  placementRef.current = placementActive;
  const onCameraMoveRef = useRef(onCameraMove);
  onCameraMoveRef.current = onCameraMove;
  const gizmoModoRef = useRef(gizmoModo);
  gizmoModoRef.current = gizmoModo;
  const onGizmoInfoRef = useRef(onGizmoInfo);
  onGizmoInfoRef.current = onGizmoInfo;
  /**
   * Modificadores do teclado. O handler de eventos do Cesium não informa se
   * Ctrl ou Shift estão pressionados, então acompanhamos pela janela.
   */
  const modRef = useRef({ ctrl: false, shift: false });
  /** Último heading emitido — evita disparar a cada frame por variação mínima. */
  const headingRef = useRef(-999);
  /** Impede um carregamento tardio do GLB de sequestrar a câmera do usuário. */
  const cameraInteragidaRef = useRef(false);
  // Aparência do modelo: lida também pelo espelho 3D, que tem prioridade.
  const cidadeRef = useRef(cidade);
  cidadeRef.current = cidade;
  const orbitarRef = useRef(orbitar);
  orbitarRef.current = orbitar;
  const noturnoRef = useRef(noturno);
  noturnoRef.current = noturno;
  const realceRef = useRef(realceNoturno);
  realceRef.current = realceNoturno;

  const buildingsRef = useRef(buildings);
  const selectedRef = useRef(selectedId);
  const editRef = useRef(editMode);
  const onEditTransformRef = useRef(onEditTransform);
  buildingsRef.current = buildings;
  selectedRef.current = selectedId;
  editRef.current = editMode;
  onEditTransformRef.current = onEditTransform;

  // --- Gizmo de manipulação (só modo edição) ----------------------------------
  const gizmoRef = useRef<Entity[]>([]);
  const gizmoEmpRef = useRef(gizmoEmpreendimento);
  gizmoEmpRef.current = gizmoEmpreendimento;
  const gizmoLocalRef = useRef(gizmoLocal);
  gizmoLocalRef.current = gizmoLocal;
  const onGizmoLocalTransformRef = useRef(onGizmoLocalTransform);
  onGizmoLocalTransformRef.current = onGizmoLocalTransform;
  /**
   * Frame ao vivo do gizmo, lido pelas CallbackProperty.
   *
   * `east/north/up` são os três eixos do pivô: o ENU do mundo quando o alvo é o
   * empreendimento, e o X/Y/Z do modelo quando é um alvo local. O resto do
   * código de arraste é o mesmo nos dois casos — muda só o que o eixo significa.
   */
  const gframeRef = useRef<{
    /** Onde as alças são desenhadas — o pivô, que pode ter sido reposicionado. */
    origin: Cartesian3;
    /** Centro real do alvo. Girar/escalar acontece em torno de `origin`, mas é
     *  este ponto que se desloca quando o pivô não está no centro. */
    origemNatural: Cartesian3;
    east: Cartesian3;
    north: Cartesian3;
    up: Cartesian3;
    /**
     * Eixos do ALVO já girado — `east/north/up` compostos com o `rot/rotX/rotY`
     * dele. São coisas diferentes e cada ferramenta precisa de uma:
     *
     * - MOVER usa os eixos do modelo, porque `posicao.x/y/z` são medidos no
     *   espaço do modelo e não acompanham o giro da peça;
     * - REDIMENSIONAR e GIRAR usam estes, porque `dx` se estende ao longo do X
     *   DA PEÇA, e o eixo do fator `Rx` em `Rz·Ry·Rx` é `Rz·Ry·(1,0,0)`.
     *
     * Sem a distinção, numa torre com `rot: 90` — o caso do piloto — a alça
     * vermelha crescia a caixa na direção para onde a verde apontava, e o anel
     * vermelho girava em torno do eixo do anel verde. Era isso que aparecia
     * como "os pivôs estão invertidos".
     */
    eastObj: Cartesian3;
    northObj: Cartesian3;
    upObj: Cartesian3;
    L: number;
    /** Alvo local (eixos do modelo) em vez do empreendimento (eixos ENU). */
    local: boolean;
    /** Escala do modelo: converte metros do mundo em metros do modelo. */
    escala: number;
  } | null>(null);
  /**
   * Pivô reposicionado, em PONTO ABSOLUTO do mundo (não deslocamento).
   *
   * Guardar o ponto, e não um offset, é o que faz o pivô ficar onde foi
   * largado: o alvo gira em torno dele e sai do lugar, mas o pivô não se mexe
   * junto — é o comportamento do Unreal. `null` = pivô no centro do alvo.
   */
  const pivotRef = useRef<Cartesian3 | null>(null);
  // Estado de arraste em curso.
  const dragRef = useRef<null | {
    id: string;
    /** `sX`/`sY`/`sZ` redimensionam UM eixo; `scale` é a escala uniforme. */
    kind: "tE" | "tN" | "tU" | AnelKind | "scale" | "sX" | "sY" | "sZ";
    local: boolean;
    /** b.scale no início do arraste (mundo → modelo). */
    escala: number;
    axisO: Cartesian3; // origem do eixo/plano fixada no início do arraste
    axisD: Cartesian3; // direção do eixo (translação)
    up: Cartesian3;
    east: Cartesian3;
    north: Cartesian3;
    startScalar: number; // t inicial no eixo (translação) ou dist/ângulo inicial
    startValue: number; // valor inicial do campo (offset/height/heading/scale)
    /** Caixa do alvo local no início do arraste (ferramenta de escala). */
    startDims?: { dx: number; dy: number; dz: number };
    /** Plano do anel em curso: normal e a base em que o ângulo é medido. */
    anel?: { n: Cartesian3; u1: Cartesian3; u2: Cartesian3 };
    /**
     * Deslocamento do pivô em relação ao centro do alvo, no mundo, fixado no
     * início do arraste. Vazio quando o pivô está no centro — o caso em que
     * girar e escalar não movem o alvo de lugar.
     */
    pivot?: Cartesian3;
    /** Posição do alvo no início do arraste, para recentrar em torno do pivô. */
    startPos?: { a: number; b: number; c: number };
  }>(null);
  /**
   * Arraste de um dos dois lados de uma seção da via.
   *
   * `modo` é decidido no pointerdown e não muda no meio do gesto: soltar o Shift
   * com o mouse apertado trocaria o eixo debaixo da mão e o pivô saltaria.
   * - `altura`: sobe e desce pela normal geodésica (o gesto de sempre).
   * - `plano`: anda no plano horizontal na cota do pivô, gravando a borda à mão.
   */
  const viaDragRef = useRef<null | {
    viaId: string;
    index: number;
    lado: "e" | "d";
    modo: "altura" | "plano";
    axisO: Cartesian3;
    axisD: Cartesian3;
    startScalar: number;
    startHeight: number;
    /** Só no modo `plano`: ponto do plano sob o cursor no início do arraste. */
    startNoPlano?: Cartesian3;
    perfil: PerfilVia[];
    lastEmit: number;
  }>(null);
  /** Arraste de um vértice de superfície. Mesmos dois modos do pivô da via. */
  const areaDragRef = useRef<null | {
    areaId: string;
    index: number;
    modo: "altura" | "plano";
    axisO: Cartesian3;
    axisD: Cartesian3;
    startScalar: number;
    startHeight: number;
    startNoPlano?: Cartesian3;
    pontos: Superficie["pontos"];
    lastEmit: number;
  }>(null);
  const gizmoDraggedRef = useRef(false);
  /**
   * Último empreendimento enquadrado. Guarda o voo automático de se repetir a
   * cada mudança da lista de prédios — ver o efeito de enquadramento.
   */
  const enquadradoRef = useRef<string | null>(null);

  // Com requestRenderMode ligado, a cena só redesenha sob demanda. Chamamos isto
  // após qualquer mutação (sol, seleção, modelo, POIs) para refletir a mudança.
  const requestRender = () => viewerRef.current?.scene.requestRender();

  /**
   * Render sob demanda x render contínuo, conforme o que está na cena.
   *
   * `requestRenderMode` existe por performance: parada, a cena não redesenha e
   * a navegação nesta máquina (WebGL degradado) deixa de engasgar. O preço
   * aparece quando entra GEOMETRIA DE ENTIDADE — as caixas do espelho e a
   * planta do pavimento. O Cesium as compila em lote ao longo de vários frames
   * e atualiza o lote a cada tique do relógio, mas só DESENHA quando alguém
   * pede um frame. Daí os dois sintomas relatados:
   *
   * - a caixa só aparecia ao abrir o DevTools, porque o redimensionamento da
   *   janela força um redesenho que ninguém tinha pedido;
   * - no zoom os blocos "deslocavam", porque o lote acompanhava a câmera um
   *   passo atrás do resto da cena.
   *
   * Enquanto houver essa geometria em cena, o modo sob demanda sai. Ele volta
   * assim que ela some, que é o estado em que a vitrine passa a maior parte do
   * tempo — a economia continua onde ela vale.
   */
  function ajustarModoDeRender() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    const temGeometriaViva = (unitBoxes?.length ?? 0) > 0 || !!plantaPavimento?.url;
    const sobDemanda = !temGeometriaViva;
    if (v.scene.requestRenderMode === sobDemanda) return;
    v.scene.requestRenderMode = sobDemanda;
    // Sai do modo sob demanda com um frame na mão: sem ele a cena ficaria
    // esperando o próximo pedido justamente no instante da troca.
    v.scene.requestRender();
  }

  /** Resolve o eixo e as duas alturas de cada seção da via. */
  function dadosVerticaisDaVia(via: Via): {
    eixo: PontoGeo[];
    alturas: Array<{ esquerda: number; direita: number }> | null;
  } {
    if (via.perfil?.length && via.perfil.length >= 2) {
      const alturas: Array<{ esquerda: number; direita: number }> = [];
      for (const secao of via.perfil) {
        const h = alturasDaSecao(secao);
        if (!h) return { eixo: via.perfil, alturas: null };
        alturas.push(h);
      }
      return { eixo: via.perfil, alturas };
    }
    if (via.cotas?.length === via.pontos.length && via.pontos.length >= 2) {
      return {
        eixo: via.pontos,
        alturas: via.cotas.map((h) => ({ esquerda: h, direita: h })),
      };
    }
    return { eixo: via.pontos, alturas: null };
  }

  /**
   * Aplica (ou limpa) o recorte da fotogrametria.
   *
   * A regra de quando recortar mora aqui, num lugar só: SEMPRE na vitrine,
   * NUNCA no editor a não ser em pré-visualização explícita. Foi a ausência
   * dessa regra que inviabilizou a primeira tentativa — o buraco removia a
   * superfície usada para amostrar a altura do terreno e para posicionar por
   * clique, e o editor ficava sem chão de referência.
   */
  function aplicarRecorteTerreno() {
    const ts = tilesetRef.current;
    const viewer = viewerRef.current;
    if (!ts || !viewer || viewer.isDestroyed()) return;
    const cfg = recorteAtualRef.current;
    // A via é um recurso independente do recorte da base do prédio. Antes,
    // desligar `recorteTerreno` desligava também TODAS as vias, embora elas
    // tivessem traçado, largura e cotas válidos.
    const podeVisualizar = !editRef.current || previewRecorteRef.current || !!cfg?.preview;
    const recortaPredio = !!cfg && podeVisualizar;
    const recortaVias = podeVisualizar;
    /** Diagnóstico do `?recorteDebug=1`: preenchido ao longo da função. */
    const diag: Record<string, unknown> = {
      editMode: !!editRef.current,
      previewRecorte: previewRecorteRef.current,
      cfgPreview: !!cfg?.preview,
      podeVisualizar, recortaPredio, recortaVias,
      vias: (viasAtualRef.current ?? []).length,
      viasComAltura: 0, quadsDeVia: 0, poligonos: 0,
    };
    const logDiag = () => {
      if (recorteDebugRef.current) console.info("[recorte]", diag);
    };

    const b = buildingsRef.current.find((x) => x.id === selectedRef.current)
      ?? buildingsRef.current[0];
    const node = b ? nodesRef.current.get(b.id) : undefined;
    const caixa = b?.modelUrl ? caixaGlbRef.current.get(b.modelUrl) : null;

    try {
      if (!ClippingPolygonCollection.isSupported(viewer.scene)) {
        // Sem WebGL 2 não existe implementação correta de um buraco curvo por
        // spline. Mantém a via drapejada e não anexa coleção incompleta, que
        // fazia o shader receber sampler `undefined` (`_target`).
        //
        // Isto SAÍA EM SILÊNCIO: o recorte simplesmente não acontecia e não
        // havia nada na tela nem no console explicando por quê.
        diag.suportado = false;
        logDiag();
        console.warn("[Scene3D] sem WebGL 2: o recorte do terreno não roda nesta máquina.");
        onError?.("Esta placa de vídeo não tem WebGL 2 — o terreno não pode ser recortado sob a via.");
        return;
      }
      diag.suportado = true;
      const polygons: ClippingPolygon[] = [];

      if (recortaPredio && b && node && caixa) {
        const folga = cfg?.folga ?? 1.1;
        const cx = (caixa.min[0] + caixa.max[0]) / 2;
        const cy = (caixa.min[1] + caixa.max[1]) / 2;
        const hx = ((caixa.max[0] - caixa.min[0]) / 2) * folga;
        const hy = ((caixa.max[1] - caixa.min[1]) / 2) * folga;
        // Os quatro cantos, em metros do modelo, levados ao mundo pela MESMA
        // função que posiciona as caixas das unidades — assim o recorte não
        // pode divergir de onde o prédio realmente está.
        const positions = ([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const).map(
          ([dx, dy]) => poseNoModelo(b, node.groundHeight, cx + dx, cy + dy, 0, 0).position,
        );
        polygons.push(new ClippingPolygon({ positions }));
      }

      /**
       * Recorta também SOB AS VIAS que têm cota.
       *
       * Só as com cota: sem ela a via é pintura sobre a fotogrametria, e
       * recortar o que ela pinta abriria um buraco no lugar da rua. Com cota,
       * há geometria própria para ocupar o vazio.
       *
       * A mesma regra do editor vale — recorte de via também apaga superfície,
       * e o editor precisa dela para medir e posicionar.
       */
      if (recortaVias) {
        // Pela REF, não pela prop: as chamadas vindas da init do viewer e da
        // medição do GLB estão presas ao primeiro render, quando `vias` ainda
        // era nula — e apagavam o recorte que o efeito tinha acabado de montar.
        for (const via of viasAtualRef.current ?? []) {
          const { eixo, alturas } = dadosVerticaisDaVia(via);
          if (!alturas || eixo.length < 2 || via.largura <= 0) continue;
          // A ÚNICA chamada que passa a folga: o buraco muda de tamanho, a malha
          // e os pivôs não. É o que separa as duas fronteiras e acaba com o
          // serrilhado — coladas, quem decide a beirada é o arredondamento.
          const { esquerda, direita } = bordasEfetivas(
            eixo, via.largura, via.folgaCorte ?? 0,
          );
          if (esquerda.length < eixo.length || direita.length < eixo.length) continue;
          diag.viasComAltura = (diag.viasComAltura as number) + 1;
          diag.quadsDeVia = (diag.quadsDeVia as number) + eixo.length - 1;
          // Cada par de pivôs consecutivo define exatamente UM subcorte convexo,
          // na mesma ordem e com os mesmos quatro cantos usados pela malha da
          // pista em `syncVias`. Um único anel longo pode ficar côncavo ou se
          // auto-intersectar numa curva fechada; nesse caso o teste de paridade
          // da textura de distância deixa ilhas sem recortar no meio da via.
          // A coleção representa a união dos quads, portanto tudo entre as duas
          // bordas é removido em toda a coluna vertical, trecho por trecho.
          for (let i = 0; i < eixo.length - 1; i++) {
            /**
             * COM A COTA, e não no nível do mar. Era esta a diferença entre o
             * recorte do prédio (que funcionava) e o da via (que não): o do
             * prédio nasce de `poseNoModelo`, que já leva a altura do terreno,
             * e o da via nascia de `fromDegreesArray` — altura zero.
             *
             * Não é detalhe. O Cesium compara o fragmento com o polígono em
             * coordenadas ESFÉRICAS (`czm_approximateSphericalCoordinates`),
             * tratando a posição no mundo como direção a partir do centro da
             * Terra. A latitude geocêntrica de um ponto depende da ALTURA: subir
             * pela normal geodésica gira essa direção. São ~2,4 mm de desvio
             * lateral por metro de cota — num terreno a 800 m, quase 2 m. Numa
             * via de 7 m isso desloca o buraco para fora da pista, e sobra
             * justamente o que a imagem mostra: fotogrametria no meio da rua.
             */
            const quad: Array<[PontoGeo, number]> = [
              [esquerda[i], alturas[i].esquerda],
              [esquerda[i + 1], alturas[i + 1].esquerda],
              [direita[i + 1], alturas[i + 1].direita],
              [direita[i], alturas[i].direita],
            ];
            polygons.push(new ClippingPolygon({
              positions: Cartesian3.fromDegreesArrayHeights(
                quad.flatMap(([p, h]) => [p.lng, p.lat, h]),
              ),
            }));
          }
        }
      }
      /**
       * Recorta também sob as ÁREAS que já têm altura.
       *
       * Mesma regra da via: sem altura a área é pintura sobre a fotogrametria e
       * abrir buraco deixaria vazio no lugar. E os polígonos vão NA COTA, nunca
       * no nível do mar — a comparação do Cesium é em coordenadas esféricas, e a
       * latitude geocêntrica depende da altura.
       */
      if (recortaVias) {
        for (const area of areasAtualRef.current) {
          const alturas = alturasDaArea(area.pontos);
          if (!alturas) continue;
          const contorno = contornoComFolga(area.pontos, area.folgaCorte ?? 0);
          if (contorno.length < 3) continue;
          diag.areasComAltura = ((diag.areasComAltura as number) ?? 0) + 1;
          polygons.push(new ClippingPolygon({
            positions: Cartesian3.fromDegreesArrayHeights(
              contorno.flatMap((p, i) => [p.lng, p.lat, alturas[i]]),
            ),
          }));
        }
      }

      // `_totalPositions`, `extentsCount` e `debugShowDistanceTexture` existem em
      // tempo de execução mas não nas tipagens do Cesium (marcados `@private`).
      type RecorteMutavel = ClippingPolygonCollection & {
        _totalPositions: number;
        extentsCount: number;
        debugShowDistanceTexture: boolean;
      };

      // Nunca desanexa/destroi a coleção durante a vida do Viewer. Comandos de
      // sombra já enfileirados ainda podem referenciar suas texturas; destruí-
      // las entre dois frames era a origem do sampler sem `_target`.
      diag.poligonos = polygons.length;
      if (!polygons.length) {
        if (recorteRef.current) (recorteRef.current as RecorteMutavel).enabled = false;
        logDiag();
        requestRender();
        return;
      }
      /**
       * Coleção órfã: se o tileset foi recriado (viewer refeito, troca de chave
       * da API), a coleção antiga continua na ref e passa a ser atualizada a
       * cada mudança sem estar presa a nada que renderize. Reanexar não é opção
       * — o Cesium recusa uma coleção que já tem dono —, então ela é descartada
       * e uma nova nasce para o tileset atual.
       */
      if (recorteRef.current && ts.clippingPolygons !== recorteRef.current) {
        recorteRef.current = null;
      }
      if (!recorteRef.current || recorteRef.current.isDestroyed()) {
        // O engine atual inicializa as texturas no pre-pass correto. Fazer
        // `update(_frameState)` manualmente misturava ciclos internos de duas
        // versões do Cesium e era parte da instabilidade do sampler.
        recorteRef.current = new ClippingPolygonCollection({ polygons });
        (recorteRef.current as RecorteMutavel).debugShowDistanceTexture =
          recorteDebugRef.current;
        ts.clippingPolygons = recorteRef.current;
      } else {
        const col = recorteRef.current as RecorteMutavel;
        col.enabled = false;
        col.removeAll();
        polygons.forEach((polygon) => col.add(polygon));
        // O Cesium usa apenas a QUANTIDADE de vértices como dirty flag. Mover
        // o corredor mantendo a mesma quantidade não atualizaria as texturas.
        col._totalPositions = -1;
        col.enabled = true;
      }
      diag.anexadoAoTileset = ts.clippingPolygons === recorteRef.current;
      diag.enabled = recorteRef.current.enabled;
      diag.extentsCount = (recorteRef.current as RecorteMutavel).extentsCount;
      logDiag();
      requestRender();
      /**
       * Com `requestRenderMode` a cena desenha UMA vez por pedido. O recorte
       * precisa de dois passos do Cesium — o `ComputeCommand` que gera a textura
       * de distância e a regeneração do shader dos tiles — e o segundo pode cair
       * no quadro seguinte. Sem este segundo pedido a cena ficava parada
       * mostrando o terreno inteiro até o usuário mexer na câmera.
       */
      requestAnimationFrame(() => requestRender());
    } catch (e) {
      // O recorte por polígono depende de recursos de WebGL que um contexto
      // degradado pode não ter — ver `patchDegradedWebGL`. Falhar aqui não
      // pode derrubar a cena.
      console.error("[Scene3D] recorte do terreno indisponível:", e);
      onError?.("O recorte do terreno não é suportado por esta placa de vídeo.");
    }
  }

  /**
   * Quanto a via desce por baixo da pista, em metros.
   *
   * O recorte do Cesium é uma COLUNA VERTICAL — `ClippingPolygon` aceita só
   * `positions`, não tem limite de altura, e não existe "cortar só o que está
   * acima". Então debaixo da pista não sobra terreno: sobra vazio, e como a cena
   * roda com `globe: false` o vazio é o fundo preto. De ângulo rasante era o que
   * aparecia sob a borda da rua.
   *
   * A pista deixa de ser uma fita plana e vira um prisma: o topo acompanha os
   * pivôs, e uma parede fecha os lados até esta profundidade. Não é enfeite, é o
   * que impede de enxergar através do buraco. 20 m cobre qualquer ângulo de
   * câmera de rua — para ver por baixo seria preciso estar enterrado.
   */
  const PROFUNDIDADE_VIA = 20;

  /**
   * Pintura da pista, em metros de verdade.
   *
   * Medidas de sinalização brasileira: faixa de 12 cm, borda recuada 30 cm do
   * limite do asfalto, eixo tracejado 3 m de traço para 5 m de vão. Ficam 4 cm
   * acima do pavimento — sem essa folga as duas superfícies disputam o mesmo
   * plano de profundidade e a pintura pisca conforme a câmera anda.
   */
  const FAIXA_LARGURA = 0.12;
  const FAIXA_RECUO = 0.3;
  const FAIXA_TRACO = 3;
  const FAIXA_VAO = 5;
  const FAIXA_ALTURA = 0.08;
  const COR_FAIXA_BRANCA = "#e8e8e4";
  const COR_FAIXA_AMARELA = "#e5b02c";
  /** Abaixo disto a via é acesso ou calçada: pintar deixaria só borrão. */
  const FAIXA_LARGURA_MINIMA = 2.5;

  /**
   * Sinalização horizontal: duas bordas brancas contínuas e o eixo amarelo
   * tracejado.
   *
   * Tudo é polígono com altura própria, nunca polilinha: a faixa tem que ter
   * largura em METROS para a rua continuar parecendo rua quando a câmera desce.
   * As bordas seguem a pista seção a seção (acompanham curva e caimento); o
   * eixo é cortado por comprimento de arco, independente das seções.
   */
  function desenharFaixas(
    v: Viewer,
    via: Via,
    eixo: PontoGeo[],
    esquerda: PontoGeo[],
    direita: PontoGeo[],
    alturas: Array<{ esquerda: number; direita: number }>,
  ) {
    const material = (cor: string) =>
      new ColorMaterialProperty(Color.fromCssColorString(cor));
    const branca = material(COR_FAIXA_BRANCA);
    const amarela = material(COR_FAIXA_AMARELA);

    const laje = (id: string, cantos: PontoGeo[], cotas: number[], mat: ColorMaterialProperty) => {
      if (cantos.length < 3) return;
      viasRef.current.push(v.entities.add({
        id,
        polygon: {
          hierarchy: new PolygonHierarchy(cantos.map((p, j) =>
            Cartesian3.fromDegrees(p.lng, p.lat, cotas[j] + FAIXA_ALTURA),
          )),
          perPositionHeight: true,
          material: mat,
          shadows: ShadowMode.RECEIVE_ONLY,
        },
      }));
    };

    /**
     * Ponto e cota a `metros` da borda, andando em direção ao outro lado.
     *
     * A conversão para fração usa a largura REAL daquela seção, não a nominal
     * da via: com as bordas movidas à mão a pista deixa de ter largura
     * constante, e uma fração fixa faria a faixa engordar e afinar sozinha.
     */
    const daBorda = (i: number, lado: "e" | "d", metros: number) => {
      const de = lado === "e" ? esquerda[i] : direita[i];
      const para = lado === "e" ? direita[i] : esquerda[i];
      const hDe = lado === "e" ? alturas[i].esquerda : alturas[i].direita;
      const hPara = lado === "e" ? alturas[i].direita : alturas[i].esquerda;
      const largura = distanciaM(de, para);
      const t = largura > 1e-6 ? Math.min(0.45, metros / largura) : 0;
      return { p: interpolarGeo(de, para, t), h: hDe + (hPara - hDe) * t };
    };

    for (const lado of ["e", "d"] as const) {
      for (let i = 0; i < eixo.length - 1; i++) {
        const a0 = daBorda(i, lado, FAIXA_RECUO);
        const a1 = daBorda(i, lado, FAIXA_RECUO + FAIXA_LARGURA);
        const b0 = daBorda(i + 1, lado, FAIXA_RECUO);
        const b1 = daBorda(i + 1, lado, FAIXA_RECUO + FAIXA_LARGURA);
        laje(
          `via-faixa:${via.id}:${lado}:${i}`,
          [a0.p, b0.p, b1.p, a1.p],
          [a0.h, b0.h, b1.h, a1.h],
          branca,
        );
      }
    }

    const centro: PontoComCota[] = eixo.map((_, i) => ({
      ...interpolarGeo(esquerda[i], direita[i], 0.5),
      altura: (alturas[i].esquerda + alturas[i].direita) / 2,
    }));
    tracejarEixo(centro, FAIXA_TRACO, FAIXA_VAO).forEach(([a, b], k) => {
      const cantos = fitaDeSegmento(a, b, FAIXA_LARGURA);
      // `fitaDeSegmento` devolve a→b de um lado e b→a do outro, então as cotas
      // seguem a mesma ordem dos cantos.
      laje(
        `via-eixo:${via.id}:${k}`,
        cantos,
        [a.altura, b.altura, b.altura, a.altura],
        amarela,
      );
    });
  }

  /**
   * Áreas de piso do entorno.
   *
   * Um polígono só por superfície, com altura por vértice. O Cesium triangula o
   * contorno; para um gramado ou um pátio — que é o que isto atende — a
   * superfície regrada resultante acompanha o caimento sem artefato.
   *
   * A textura é ladrilhada em ESCALA MÉTRICA: `repeat` é calculado a partir do
   * tamanho real da área, não fixo. Com um número fixo, um gramado de 20 m e
   * outro de 200 m mostrariam a mesma grama em tamanhos diferentes, e a segunda
   * viraria um borrão verde — exatamente a aparência que se está tentando
   * substituir.
   */
  function syncSuperficies() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    areasRef.current.forEach((e) => v.entities.remove(e));
    areasRef.current = [];

    const lista = areasAtualRef.current.filter(
      (s, i, a) => a.findIndex((x) => x.id === s.id) === i,
    );
    for (const area of lista) {
      const pts = area.pontos;
      if (pts.length < 3) continue;
      const alturas = alturasDaArea(pts);

      const material = (() => {
        if (area.cor) {
          return new ColorMaterialProperty(Color.fromCssColorString(area.cor));
        }
        // Importada tem prioridade sobre a procedural do tipo.
        const imagem: string | HTMLCanvasElement | null =
          area.texturaUrl || texturaDe(area.tipo);
        if (!imagem) {
          return new ColorMaterialProperty(
            Color.fromCssColorString(COR_SUPERFICIE[area.tipo] ?? "#4e7c42"),
          );
        }
        // Lado do menor retângulo que contém a área, em metros. Serve de escala
        // porque `repeat` do Cesium é contado sobre o retângulo de contorno.
        const lats = pts.map((p) => p.lat);
        const lngs = pts.map((p) => p.lng);
        const alto = distanciaM(
          { lat: Math.min(...lats), lng: lngs[0] },
          { lat: Math.max(...lats), lng: lngs[0] },
        );
        const largo = distanciaM(
          { lat: lats[0], lng: Math.min(...lngs) },
          { lat: lats[0], lng: Math.max(...lngs) },
        );
        const passo = Math.max(
          0.2, area.escalaTextura ?? METROS_POR_LADRILHO[area.tipo] ?? 5,
        );
        const rep = (m: number) => Math.max(1, Math.round(m / passo));
        return new ImageMaterialProperty({
          image: imagem,
          repeat: new Cartesian2(rep(largo), rep(alto)),
          // Multiplica sobre a imagem: preserva grão e variação, ao contrário de
          // trocar por cor sólida. Branco é o neutro.
          color: Color.fromCssColorString(area.tinta ?? "#ffffff"),
        });
      })();

      const contorno = alturas
        ? pts.map((p, i) => Cartesian3.fromDegrees(p.lng, p.lat, alturas[i]))
        : Cartesian3.fromDegreesArray(pts.flatMap((p) => [p.lng, p.lat]));

      areasRef.current.push(v.entities.add({
        id: `area:${area.id}`,
        polygon: alturas
          ? {
              hierarchy: new PolygonHierarchy(contorno),
              perPositionHeight: true,
              // Mesma saia da via, e pelo mesmo motivo: o recorte é uma coluna
              // vertical, então debaixo da área não sobra terreno. Sem a parede
              // se enxerga o vazio pela beirada.
              extrudedHeight: Math.min(...alturas) - PROFUNDIDADE_VIA,
              material,
              shadows: ShadowMode.RECEIVE_ONLY,
            }
          : {
              hierarchy: new PolygonHierarchy(contorno),
              classificationType: ClassificationType.CESIUM_3D_TILE,
              material,
            },
      }));

      if (editRef.current) {
        areasRef.current.push(v.entities.add({
          id: `area-borda:${area.id}`,
          polyline: {
            positions: alturas
              ? [...pts, pts[0]].map((p, i) => Cartesian3.fromDegrees(
                  p.lng, p.lat, alturas[i % alturas.length] + 0.09,
                ))
              : Cartesian3.fromDegreesArray(
                  [...pts, pts[0]].flatMap((p) => [p.lng, p.lat]),
                ),
            width: 2,
            clampToGround: !alturas,
            material: new ColorMaterialProperty(Color.WHITE.withAlpha(0.7)),
          },
        }));
      }

      const arrastando = areaDragRef.current?.areaId === area.id;
      if (areaEditandoRef.current === area.id && alturas && !arrastando) {
        pts.forEach((p, i) => {
          areasRef.current.push(v.entities.add({
            id: `area-pivot:${area.id}:${i}`,
            position: Cartesian3.fromDegrees(p.lng, p.lat, alturas[i] + 0.14),
            point: {
              pixelSize: 12,
              color: Color.fromCssColorString("#8ef05a"),
              outlineColor: Color.WHITE,
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }));
        });
      }
    }
    requestRender();
  }

  /** Via segmentada: cada subtrecho é um quad convexo entre as duas bordas. */
  function syncVias() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    viasRef.current.forEach((e) => v.entities.remove(e));
    viasRef.current = [];

    /**
     * Lista pelas REFS, nunca pelas props.
     *
     * `syncVias` é chamada de dentro do `pointerup` do pivô, e esse handler foi
     * registrado UMA vez na init: ele carrega o `syncVias` do primeiro render,
     * com a lista de vias que existia naquele instante. Lendo a prop, soltar o
     * pivô apagava a via recém-criada e ressuscitava na tela a que tinha sido
     * excluída. É a mesma armadilha que já tinha derrubado o recorte.
     */
    /**
     * Uma via por id, sempre. Duas com o mesmo id gerariam os mesmos ids de
     * entidade, e `entities.add` LANÇA em id repetido — o que derrubaria o
     * desenho de todas as outras vias junto. O editor renomeia a duplicata na
     * primeira gravação; até lá, a segunda simplesmente não é desenhada.
     */
    const lista = viasAtualRef.current.filter(
      (v, i, a) => a.findIndex((x) => x.id === v.id) === i,
    );
    for (const via of lista) {
      const { eixo, alturas } = dadosVerticaisDaVia(via);
      if (eixo.length < 2 || via.largura <= 0) continue;
      const { esquerda, direita } = bordasEfetivas(eixo, via.largura);
      const material = new ColorMaterialProperty(
        Color.fromCssColorString(via.cor ?? corViaRef.current ?? COR_VIA_PADRAO),
      );
      for (let i = 0; i < eixo.length - 1; i++) {
        const quad = [esquerda[i], esquerda[i + 1], direita[i + 1], direita[i]];
        const h = alturas
          ? [alturas[i].esquerda, alturas[i + 1].esquerda,
              alturas[i + 1].direita, alturas[i].direita]
          : null;
        viasRef.current.push(v.entities.add({
          id: `via:${via.id}:${i}`,
          polygon: h
            ? {
                hierarchy: new PolygonHierarchy(quad.map((p, j) =>
                  Cartesian3.fromDegrees(p.lng, p.lat, h[j] + 0.04),
                )),
                // O topo segue os quatro pivôs (`perPositionHeight`) e a base é
                // um plano só: é o que dá a parede lateral que tapa o buraco.
                perPositionHeight: true,
                extrudedHeight: Math.min(...h) - PROFUNDIDADE_VIA,
                material,
                shadows: ShadowMode.RECEIVE_ONLY,
              }
            : {
                hierarchy: new PolygonHierarchy(
                  Cartesian3.fromDegreesArray(quad.flatMap((p) => [p.lng, p.lat])),
                ),
                classificationType: ClassificationType.CESIUM_3D_TILE,
                material,
              },
        }));
      }

      /**
       * Pintura: só onde há cota (a via é geometria de verdade), só se a pista
       * for larga o bastante para caber sinalização, e NUNCA durante o arraste
       * de um pivô desta via.
       *
       * A última condição é de desempenho: cada emissão do arraste reconstrói as
       * entidades da via inteira, a 20 fps. A pintura quase triplica essa conta
       * (duas bordas por seção mais os traços do eixo) e só atrapalharia quem
       * está mirando um pivô. Ela volta sozinha ao soltar o botão.
       */
      const larguraMedia = alturas
        ? esquerda.reduce((s, p, i) => s + distanciaM(p, direita[i]), 0) / esquerda.length
        : 0;
      const arrastando = viaDragRef.current?.viaId === via.id;
      if (alturas && via.faixas !== false && !arrastando
        && larguraMedia >= FAIXA_LARGURA_MINIMA) {
        desenharFaixas(v, via, eixo, esquerda, direita, alturas);
      }

      /**
       * Contorno branco fino: é ANDAIME DE EDIÇÃO, não pintura.
       *
       * Uma polilinha tem espessura em pixels — de longe vira um risco grosso
       * sobre a rua, de perto some. Enquanto ela era a única linha branca da
       * cena isso passava; agora que existe faixa de verdade em metros, deixar
       * as duas juntas só engrossa a borda e entrega o truque. Fora do editor
       * ela não aparece.
       */
      if (editRef.current) {
        for (const [lado, borda] of [["e", esquerda], ["d", direita]] as const) {
          const positions = alturas
            ? borda.map((p, i) => Cartesian3.fromDegrees(
                p.lng, p.lat, (lado === "e" ? alturas[i].esquerda : alturas[i].direita) + 0.09,
              ))
            : Cartesian3.fromDegreesArray(borda.flatMap((p) => [p.lng, p.lat]));
          viasRef.current.push(v.entities.add({
            id: `via-borda:${via.id}:${lado}`,
            polyline: {
              positions,
              width: 2,
              clampToGround: !alturas,
              // Material explícito: passar `Color` diretamente faz o Entity
              // tentar inferir o tipo em runtime e falha quando o Vite carrega
              // mais de uma instância dos construtores do Cesium.
              material: new ColorMaterialProperty(Color.WHITE.withAlpha(0.8)),
            },
          }));
        }
      }

      if (viaEditandoRef.current === via.id && alturas && via.perfil?.length === eixo.length) {
        for (let i = 0; i < eixo.length; i++) {
          for (const lado of ["e", "d"] as const) {
            const p = lado === "e" ? esquerda[i] : direita[i];
            const h = lado === "e" ? alturas[i].esquerda : alturas[i].direita;
            viasRef.current.push(v.entities.add({
              id: `via-pivot:${via.id}:${i}:${lado}`,
              position: Cartesian3.fromDegrees(p.lng, p.lat, h + 0.14),
              point: {
                pixelSize: 12,
                color: lado === "e" ? Color.ORANGE : Color.CYAN,
                outlineColor: Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            }));
          }
        }
      }
    }
    requestRender();
  }

  // --- Imperative handle (usado pelo editor / páginas) ------------------------
  useImperativeHandle(ref, () => ({
    getCurrentCamera: () => {
      const v = viewerRef.current;
      if (!v) return null;
      const c = v.camera.positionCartographic;
      return {
        lng: CesiumMath.toDegrees(c.longitude),
        lat: CesiumMath.toDegrees(c.latitude),
        height: c.height,
        heading: CesiumMath.toDegrees(v.camera.heading),
        pitch: CesiumMath.toDegrees(v.camera.pitch),
        roll: CesiumMath.toDegrees(v.camera.roll),
      };
    },
    flyToCamera: (cam, duration = 1.5) => flyToCamera(cam, duration),
    flyToPoi: (lat, lng, cam) => flyToPoi(lat, lng, cam),
    flyHome: () => flyHome(),
    cutAtFloor: (modelZ) => cutAtFloor(modelZ),
    viewFromFloor: (camH, heading, duration) => viewFromFloor(camH, heading, duration),
    viewCutExternal: (duration) => viewCutExternal(duration),
    viewCorteDeCima: (corte, distancia, pitchGraus, giroGraus, duration) =>
      viewCorteDeCima(corte, distancia, pitchGraus, giroGraus, duration),
    frameBuilding: () => {
      const b = buildingsRef.current.find((x) => x.id === selectedRef.current);
      if (b) flyToBuilding(b);
    },
    predioEnquadrado: () => predioEnquadrado(),
    frameUnit: (unitId, cam, duration) => frameUnit(unitId, cam, duration),
    modelLocalFromLatLng: (buildingId, lat, lng) => modelLocalFromLatLng(buildingId, lat, lng),
    captureImage: (maxW = 240, quality = 0.6) => captureImage(maxW, quality),
    medirCotas: (pontos) => medirCotas(pontos),
  }));

  /**
   * Amostra a altura do terreno ao longo de um traçado.
   *
   * Todos os pontos numa chamada só de `clampToHeightMostDetailed`: ele força
   * alta resolução onde consulta, e disparar uma chamada por ponto floodava a
   * rede a ponto de travar a cena — foi o motivo de a amostragem do prédio ser
   * de um ponto só.
   *
   * Devolve `null` ao menor sinal de falha. Preencher buraco com palpite seria
   * pior: a via ficaria com um degrau invisível no meio.
   */
  async function medirCotas(pontos: PontoGeo[]): Promise<number[] | null> {
    const v = viewerRef.current;
    if (!v || v.isDestroyed() || pontos.length < 2) return null;
    try {
      const sondas = pontos.map((p) => Cartesian3.fromDegrees(p.lng, p.lat, 3000));
      const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 15000));
      const res = await Promise.race([v.scene.clampToHeightMostDetailed(sondas), timeout]);
      if (!res || res.length !== pontos.length) return null;
      const cotas: number[] = [];
      for (const p of res) {
        if (!p) return null;
        const c = Cartographic.fromCartesian(p);
        if (!c || !Number.isFinite(c.height)) return null;
        cotas.push(c.height);
      }
      return cotas;
    } catch (e) {
      console.error("[Scene3D] falha ao medir cotas da via:", e);
      return null;
    }
  }

  /**
   * Captura o frame atual. Com `requestRenderMode` ligado a cena fica ociosa,
   * então é preciso forçar um render antes de ler o canvas — senão a imagem
   * volta preta ou desatualizada.
   */
  function captureImage(maxW: number, quality: number): string | null {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return null;
    try {
      v.scene.render();
      const origem = v.scene.canvas;
      if (!origem.width || !origem.height) return null;
      const escala = Math.min(1, maxW / origem.width);
      const destino = document.createElement("canvas");
      destino.width = Math.max(1, Math.round(origem.width * escala));
      destino.height = Math.max(1, Math.round(origem.height * escala));
      const ctx = destino.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(origem, 0, 0, destino.width, destino.height);
      return destino.toDataURL("image/jpeg", quality);
    } catch (e) {
      console.error("[Scene3D] falha ao capturar imagem:", e);
      return null;
    }
  }

  // --- Init do viewer + tiles -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || viewerRef.current || !apiKey) return;
    let destroyed = false;
    let handler: ScreenSpaceEventHandler | null = null;
    let aoPressionar: ((e: PointerEvent) => void) | null = null;
    let aoRolar: (() => void) | null = null;
    let encerrarArraste: (() => void) | null = null;

    createVision3DViewer(containerRef.current, apiKey)
      .then(({ viewer, tileset }) => {
        if (destroyed) {
          if (!viewer.isDestroyed()) viewer.destroy();
          return;
        }
        viewerRef.current = viewer;
        tilesetRef.current = tileset;
        readyRef.current = true;
        setPronto(true);

        // Clique: seleciona empreendimento OU reposiciona (modo edição).
        handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
        const aoClicar = (ev: ScreenSpaceEventHandler.PositionedEvent) => {
          // O Cesium engole exceções lançadas aqui dentro: sem este try/catch,
          // qualquer erro no clique vira "não acontece nada" e some.
          try {
            onClick(ev.position);
          } catch (e) {
            console.error("[Scene3D] erro ao processar o clique:", e);
          }
        };
        /**
         * O clique precisa ser registrado UMA VEZ POR MODIFICADOR.
         *
         * O `ScreenSpaceEventHandler` do Cesium indexa as ações por (tipo,
         * modificador) e procura a entrada exata: sem estas três linhas, um
         * Ctrl+clique não encontra ação registrada e é simplesmente descartado
         * — que é exatamente o clique de acumular seleção.
         */
        handler.setInputAction(aoClicar, ScreenSpaceEventType.LEFT_CLICK);
        handler.setInputAction(aoClicar, ScreenSpaceEventType.LEFT_CLICK, KeyboardEventModifier.CTRL);
        handler.setInputAction(aoClicar, ScreenSpaceEventType.LEFT_CLICK, KeyboardEventModifier.SHIFT);
        /**
         * ARRASTE DOS GIZMOS — em eventos DOM, não pelo handler do Cesium.
         *
         * O `ScreenSpaceCameraController` registra os próprios listeners no
         * canvas durante a construção do Viewer, ou seja, ANTES dos nossos. Ao
         * pressionar o botão ele já inicia a rotação da câmera; desligar
         * `enableInputs` no mesmo evento não aborta um arraste em curso — e o
         * resultado era exatamente "só a câmera se mexe, nunca o modelo".
         *
         * A solução é ouvir `pointerdown` no CONTÊINER (ancestral do canvas) em
         * fase de CAPTURA: aí o evento passa por nós antes de chegar ao canvas.
         * Se acertou uma alça, `stopPropagation` impede que o Cesium chegue a
         * ver o clique, e o arraste segue por eventos de janela.
         */
        const container = containerRef.current;
        if (container) {
          const canvas = viewer.scene.canvas;
          const posDoEvento = (e: PointerEvent) => {
            const r = canvas.getBoundingClientRect();
            return new Cartesian2(e.clientX - r.left, e.clientY - r.top);
          };

          aoPressionar = (e: PointerEvent) => {
            cameraInteragidaRef.current = true;
            // Fonte mais confiável que o keydown da janela: se o Ctrl foi
            // pressionado antes da página receber o foco, o listener de teclado
            // perdeu o evento — o do ponteiro traz o estado real.
            modRef.current = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };

            /**
             * ALT + BOTÃO DO MEIO reposiciona o pivô, como no Unreal.
             *
             * Girar sempre pelo centro é a limitação que mais atrapalha ao
             * encaixar uma peça: alinhar uma quina exige girar pela quina. O
             * pivô fica no ponto clicado da superfície e o alvo passa a girar
             * e escalar em torno dele. Alt+meio no vazio devolve ao centro.
             */
            if (e.button === 1 && e.altKey && editRef.current && gframeRef.current) {
              const p = pickGround(posDoEvento(e));
              pivotRef.current = p ?? null;
              updateGframe();
              requestRender();
              onGizmoInfoRef.current?.(
                p ? "Pivô reposicionado · Alt+meio no vazio devolve ao centro" : "Pivô de volta ao centro",
              );
              setTimeout(() => onGizmoInfoRef.current?.(null), 2600);
              e.stopPropagation();
              e.preventDefault();
              return;
            }

            if (e.button !== 0 || !editRef.current) return;
            try {
              if (viaPivotDown(posDoEvento(e))) {
                e.stopPropagation();
                e.preventDefault();
                const moverVia = (ev: PointerEvent) => viaPivotMove(posDoEvento(ev));
                const soltarVia = (ev?: PointerEvent) => {
                  if (ev) viaPivotMove(posDoEvento(ev), true);
                  viaPivotUp();
                  window.removeEventListener("pointermove", moverVia);
                  window.removeEventListener("pointerup", soltarVia);
                  window.removeEventListener("pointercancel", soltarVia);
                  encerrarArraste = null;
                };
                encerrarArraste = soltarVia;
                window.addEventListener("pointermove", moverVia);
                window.addEventListener("pointerup", soltarVia);
                window.addEventListener("pointercancel", soltarVia);
                return;
              }
              if (plantaPivotDown(posDoEvento(e))) {
                e.stopPropagation();
                e.preventDefault();
                // Clicar num "+" só insere: não há arraste a acompanhar.
                if (!plantaDragRef.current) return;
                const moverPl = (ev: PointerEvent) => plantaPivotMove(posDoEvento(ev));
                const soltarPl = (ev?: PointerEvent) => {
                  if (ev) plantaPivotMove(posDoEvento(ev), true);
                  plantaPivotUp();
                  window.removeEventListener("pointermove", moverPl);
                  window.removeEventListener("pointerup", soltarPl);
                  window.removeEventListener("pointercancel", soltarPl);
                  encerrarArraste = null;
                };
                encerrarArraste = soltarPl;
                window.addEventListener("pointermove", moverPl);
                window.addEventListener("pointerup", soltarPl);
                window.addEventListener("pointercancel", soltarPl);
                return;
              }
              if (areaPivotDown(posDoEvento(e))) {
                e.stopPropagation();
                e.preventDefault();
                const moverArea = (ev: PointerEvent) => areaPivotMove(posDoEvento(ev));
                const soltarArea = (ev?: PointerEvent) => {
                  if (ev) areaPivotMove(posDoEvento(ev), true);
                  areaPivotUp();
                  window.removeEventListener("pointermove", moverArea);
                  window.removeEventListener("pointerup", soltarArea);
                  window.removeEventListener("pointercancel", soltarArea);
                  encerrarArraste = null;
                };
                encerrarArraste = soltarArea;
                window.addEventListener("pointermove", moverArea);
                window.addEventListener("pointerup", soltarArea);
                window.addEventListener("pointercancel", soltarArea);
                return;
              }
            } catch (err) {
              console.error("[Scene3D] erro ao agarrar o pivô da via:", err);
            }
            let pegou = false;
            try {
              pegou = gizmoDown(posDoEvento(e));
            } catch (err) {
              console.error("[Scene3D] erro ao agarrar o gizmo:", err);
            }
            if (!pegou) {
              // Diagnóstico na tela: quantas alças existem e o que estava sob o
              // cursor. Sem isto, "não pega" é indistinguível de "não existe".
              //
              // Só quando HÁ alças: fora disso todo clique da cena (selecionar
              // uma unidade, posicionar um POI) abriria um aviso dizendo
              // "alças: 0", que não é diagnóstico de nada.
              if (!gizmoRef.current.length) return;
              try {
                const p = viewer.scene.pick(posDoEvento(e));
                const sob = idDaEntidade(p)
                  ?? (typeof (p?.primitive as { id?: unknown } | undefined)?.id === "string"
                      ? String((p!.primitive as { id: string }).id)
                      : p ? "geometria sem id" : "nada");
                onGizmoInfoRef.current?.(
                  `alças: ${gizmoRef.current.length} · frame: ${gframeRef.current ? "ok" : "ausente"} · sob o cursor: ${sob}`,
                );
                setTimeout(() => onGizmoInfoRef.current?.(null), 3500);
              } catch {
                /* diagnóstico é melhor-esforço */
              }
              return;
            }

            e.stopPropagation();
            e.preventDefault();

            const mover = (ev: PointerEvent) => gizmoMove(posDoEvento(ev));
            const soltar = () => {
              gizmoUp();
              window.removeEventListener("pointermove", mover);
              window.removeEventListener("pointerup", soltar);
              window.removeEventListener("pointercancel", soltar);
              encerrarArraste = null;
            };
            encerrarArraste = soltar;
            window.addEventListener("pointermove", mover);
            window.addEventListener("pointerup", soltar);
            window.addEventListener("pointercancel", soltar);
          };
          container.addEventListener("pointerdown", aoPressionar, true);
          aoRolar = () => { cameraInteragidaRef.current = true; };
          container.addEventListener("wheel", aoRolar, { passive: true });
        }

        // Heading para a bússola. Com requestRenderMode a cena só desenha quando
        // algo muda — que é exatamente quando a bússola precisa se mexer. O
        // limiar evita reagir a variações imperceptíveis a cada frame.
        viewer.scene.postRender.addEventListener(() => {
          if (viewer.isDestroyed()) return;
          const h = CesiumMath.toDegrees(viewer.camera.heading);
          if (Math.abs(h - headingRef.current) > 0.3) {
            headingRef.current = h;
            onCameraMoveRef.current?.(h);
          }
        });

        applySun();
        aplicarRecorteTerreno();
        reconcile();
        syncVias();
        syncSuperficies();
        // Se já há um empreendimento selecionado no load (projeto de
        // empreendimento único abre direto nele), voa até o prédio e mostra os
        // POIs; senão, dá a visão geral.
        const selId = selectedRef.current;
        const selB = selId ? buildingsRef.current.find((x) => x.id === selId) : undefined;
        if (selB) {
          flyToBuilding(selB);
          showPoiMarkers(selB);
          setTimeout(() => void sampleGroundFor(selB.id), 2500);
        } else {
          flyHome();
        }
        onReady?.();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Falha ao carregar os 3D Tiles";
        const pareceCredencial = /(?:401|403|api.?key|billing|map tiles|forbidden|unauthorized)/i.test(msg);
        onError?.(pareceCredencial
          ? msg + " — verifique se a 'Map Tiles API' está habilitada e com billing na chave do Google."
          : msg);
      });

    return () => {
      destroyed = true;
      readyRef.current = false;
      if (aoPressionar && containerRef.current) {
        containerRef.current.removeEventListener("pointerdown", aoPressionar, true);
      }
      if (aoRolar && containerRef.current) {
        containerRef.current.removeEventListener("wheel", aoRolar);
      }
      // Se a rota mudou no meio do gesto, `pointerup` pode nunca chegar. Sem
      // esta limpeza os listeners da janela sobrevivem ao Viewer destruído.
      encerrarArraste?.();
      handler?.destroy();
      nodesRef.current.clear();
      const v = viewerRef.current;
      if (v && !v.isDestroyed()) v.destroy();
      viewerRef.current = null;
      tilesetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // --- Amostragem de altura do terreno (só do prédio selecionado, sob demanda) -
  // Evita forçar alta resolução na cidade toda (que floodava e travava). Amostra
  // 1 ponto, quando a câmera já está perto do prédio e os tiles carregaram.
  async function sampleGroundFor(id: string) {
    const v = viewerRef.current;
    if (!v || !readyRef.current) return;
    const b = buildingsRef.current.find((x) => x.id === id);
    const node = nodesRef.current.get(id);
    if (!b || !node) return;
    const probe = Cartesian3.fromDegrees(b.lng, b.lat, 3000);
    /**
     * SUSPENDE o recorte enquanto amostra, e devolve depois.
     *
     * A sonda cai de 3000 m exatamente sobre o prédio — que é onde o recorte da
     * base abre o buraco. Com o buraco aberto não há superfície para o raio
     * encontrar: a amostragem volta vazia, `groundHeight` fica no fallback de
     * 3 m e o prédio vai para 3 m de altitude, centenas de metros abaixo do
     * terreno real.
     *
     * Era isto que a regra antiga evitava desligando o recorte no editor
     * inteiro. A regra era larga demais — o conflito é só com a AMOSTRAGEM —,
     * então quem cede agora são estes poucos milissegundos, e não a
     * visualização inteira.
     */
    const col = recorteRef.current as (ClippingPolygonCollection & { enabled: boolean }) | null;
    const estavaLigado = !!col?.enabled;
    if (estavaLigado && col) {
      col.enabled = false;
      requestRender();
    }
    try {
      const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 8000));
      const res = await Promise.race([v.scene.clampToHeightMostDetailed([probe]), timeout]);
      const p = res && res[0];
      if (!p || !viewerRef.current) return;
      const carto = Cartographic.fromCartesian(p);
      if (!carto || !Number.isFinite(carto.height)) return;
      const anterior = node.groundHeight;
      node.groundHeight = carto.height;
      const cur = buildingsRef.current.find((x) => x.id === id);
      if (!cur) return;
      upsertMarker(cur, node);
      if (cur.modelUrl) updateModelTransform(cur, node);
      else upsertPlaceholder(cur, node);
      // As caixas do espelho 3D usam a mesma matriz do modelo: sem isto, elas
      // ficariam na altura de fallback enquanto o prédio vai para o terreno real.
      syncUnitBoxes();
      syncTowerOutline();
      /**
       * Reenquadra quando a cota corrigiu MUITO — e a câmera vai junto.
       *
       * O primeiro voo acontece com `groundHeight` no fallback de 3 m, porque a
       * medição só é confiável 2,5 s depois, com os tiles carregados. Ao nível
       * do mar isso não se nota. Numa cidade de planalto (Anápolis está a
       * ~1.100 m) o prédio nasce 1.100 m abaixo do chão, a câmera é enquadrada
       * nele e a vitrine abre DEBAIXO do terreno — tela preta com as emendas
       * dos tiles, que foi o que apareceu.
       *
       * Corrigir a altura do prédio sem corrigir a da câmera resolvia metade: o
       * prédio subia e a câmera continuava enterrada.
       *
       * 20 m de limiar separa "estava no fallback" de um reajuste fino, e
       * `cameraInteragida` protege quem já tomou o controle da navegação — um
       * voo inesperado no meio do gesto do visitante seria pior que o erro.
       */
      if (Math.abs(carto.height - anterior) > 20 && !cameraInteragidaRef.current) {
        flyToBuilding(cur);
      }
      requestRender();
    } catch {
      /* mantém fallback */
    } finally {
      // `finally`: os `return` antecipados do corpo (sonda vazia, viewer
      // destruído) são o caminho COMUM aqui, e por qualquer um deles o recorte
      // ficaria desligado para sempre sem nada dizendo por quê.
      if (estavaLigado && col && !col.isDestroyed()) {
        col.enabled = true;
        requestRender();
      }
    }
  }

  // --- Posicionamento ---------------------------------------------------------
  function offsetLngLat(b: Building3D): [number, number] {
    const mPerLat = 111320;
    const mPerLng = 111320 * Math.cos(CesiumMath.toRadians(b.lat));
    return [b.lng + b.offsetEast / mPerLng, b.lat + b.offsetNorth / mPerLat];
  }

  function modelMatrix(b: Building3D, gh: number): Matrix4 {
    const [lng, lat] = offsetLngLat(b);
    const origin = Cartesian3.fromDegrees(lng, lat, gh + b.heightOffset);
    const hpr = new HeadingPitchRoll(
      CesiumMath.toRadians(b.heading),
      CesiumMath.toRadians(b.pitch),
      CesiumMath.toRadians(b.roll),
    );
    return Transforms.headingPitchRollToFixedFrame(origin, hpr);
  }

  // --- Espelho de vendas em 3D ------------------------------------------------

  /**
   * Sincroniza as caixas das unidades. Cada caixa é posicionada no referencial
   * do modelo (a mesma matriz do GLB), então ela acompanha posição, heading e
   * altura do prédio automaticamente.
   */
  /**
   * Aparência do GLB. Dois estados:
   *
   * 1. **Noturno** — realce claro para o prédio não virar uma silhueta preta.
   *    Não é iluminação: janela acesa depende de material emissivo no GLB.
   * 2. **Normal** — mistura leve e fria, que levanta o vidro escuro da fachada.
   *
   * O modelo permanece sempre opaco, inclusive no editor.
   */
  function aplicarAparenciaModelo() {
    for (const node of Array.from(nodesRef.current.values())) {
      const m = node.model;
      if (!m) continue;
      // O realce claro existe para o prédio não virar silhueta contra a
      // cidade escurecida. No estúdio não há cidade escurecida — o modelo fica
      // com a cor dele.
      if (noturnoRef.current && cidadeRef.current) {
        m.color = Color.fromCssColorString("#cfe3f0");
        m.colorBlendMode = ColorBlendMode.MIX;
        m.colorBlendAmount = Math.max(0, Math.min(1, realceRef.current));
      } else {
        m.color = Color.fromCssColorString("#e6eef2");
        m.colorBlendMode = ColorBlendMode.MIX;
        m.colorBlendAmount = 0.3;
      }
    }
  }

  /**
   * Pose (posição + orientação) de uma caixa dada em coordenadas do modelo.
   * Tudo do espelho 3D passa por aqui, então herda a matriz do GLB.
   */
  function poseNoModelo(
    b: Building3D, gh: number,
    x: number, y: number, z: number,
    rot: number, rotX = 0, rotY = 0,
  ) {
    const s = b.scale;
    const m = modelMatrix(b, gh);
    // Rz · Ry · Rx, a mesma ordem documentada no schema. Com rotX/rotY em zero
    // (o caso normal) isto é exatamente a rotação em Z de antes.
    const r = Matrix3.multiply(
      Matrix3.fromRotationZ(CesiumMath.toRadians(rot)),
      Matrix3.multiply(
        Matrix3.fromRotationY(CesiumMath.toRadians(rotY)),
        Matrix3.fromRotationX(CesiumMath.toRadians(rotX)),
        new Matrix3(),
      ),
      new Matrix3(),
    );
    const local = Matrix4.fromRotationTranslation(
      r,
      new Cartesian3(x * s, y * s, z * s),
    );
    const bm = Matrix4.multiply(m, local, new Matrix4());
    return {
      position: Matrix4.getTranslation(bm, new Cartesian3()),
      orientation: Quaternion.fromRotationMatrix(Matrix4.getMatrix3(bm, new Matrix3())),
    };
  }

  /** Converte um ponto do mapa para as coordenadas X/Y do modelo. */
  function modelLocalFromLatLng(buildingId: string, lat: number, lng: number) {
    const b = buildingsRef.current.find((x) => x.id === buildingId);
    const node = nodesRef.current.get(buildingId);
    if (!b || !node) return null;
    const m = modelMatrix(b, node.groundHeight);
    const inv = Matrix4.inverse(m, new Matrix4());
    const world = Cartesian3.fromDegrees(lng, lat, node.groundHeight + b.heightOffset);
    const local = Matrix4.multiplyByPoint(inv, world, new Cartesian3());
    return { x: local.x / b.scale, y: local.y / b.scale };
  }

  /** Contorno da torre em calibração: mostra a caixa que se está ajustando. */
  function syncTowerOutline() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    if (outlineRef.current) {
      v.entities.remove(outlineRef.current);
      outlineRef.current = null;
    }
    const o = towerOutline;
    if (!o) return;
    const b = buildingsRef.current.find((x) => x.id === o.buildingId);
    const node = nodesRef.current.get(o.buildingId);
    if (!b || !node) return;
    const { position, orientation } = poseNoModelo(
      b, node.groundHeight, o.x, o.y, o.z + o.altura / 2, o.rot, o.rotX ?? 0, o.rotY ?? 0,
    );
    outlineRef.current = v.entities.add({
      id: `tower-outline:${o.buildingId}`,
      position,
      orientation: new ConstantProperty(orientation),
      box: {
        dimensions: new Cartesian3(o.comprimento * b.scale, o.largura * b.scale, o.altura * b.scale),
        fill: true,
        material: new ColorMaterialProperty(Color.fromCssColorString(BRAND_TURQUOISE).withAlpha(0.08)),
        outline: true,
        outlineColor: Color.fromCssColorString("#22d3ee"),
        shadows: ShadowMode.DISABLED,
      },
    });
    requestRender();
  }

  /**
   * Laje fina no plano do corte, do tamanho do retângulo — é o "quadrado" do
   * qual tudo acima some. Sem área definida ela não aparece: o corte atravessa
   * o modelo inteiro e não há retângulo a mostrar.
   *
   * Sem este desenho o ajuste é às cegas, porque o recorte só se enxerga onde
   * existe geometria — e é justamente na borda vazia que se erra o
   * enquadramento da área.
   */
  function syncCorteArea() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    if (corteAreaRef.current) {
      v.entities.remove(corteAreaRef.current);
      corteAreaRef.current = null;
    }
    const c = corteArea;
    if (!c?.area) return;
    const b = buildingsRef.current.find((x) => x.id === c.buildingId);
    const node = nodesRef.current.get(c.buildingId);
    if (!b || !node) return;
    const a = c.area;
    const { position, orientation } = poseNoModelo(b, node.groundHeight, a.x, a.y, c.z, a.rot);
    corteAreaRef.current = v.entities.add({
      id: `corte-area:${c.buildingId}`,
      position,
      orientation: new ConstantProperty(orientation),
      box: {
        // Uma laje, não uma caixa: o que importa é a pegada e a altura.
        dimensions: new Cartesian3(a.comprimento * b.scale, a.largura * b.scale, 0.35 * b.scale),
        fill: true,
        material: new ColorMaterialProperty(Color.fromCssColorString("#22d3ee").withAlpha(0.2)),
        outline: true,
        outlineColor: Color.fromCssColorString("#22d3ee"),
        shadows: ShadowMode.DISABLED,
      },
    });
    requestRender();
  }

  /**
   * Planta do pavimento deitada no chão, dentro da cena.
   *
   * `plane` e não `box`: a caixa fina do corte serve para marcar um volume,
   * mas ela tem SEIS faces e a textura apareceria repetida nas laterais e no
   * fundo, espelhada. O plano tem uma face só, que é o que um desenho de planta
   * é.
   *
   * Sem sombra, e é decisão: um desenho não projeta sombra no mundo real, e
   * receber a sombra do próprio prédio escureceria justamente o que se quer
   * ler. Ele é informação sobreposta, não matéria.
   */
  function syncPlantaChao() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    if (plantaChaoRef.current) {
      v.entities.remove(plantaChaoRef.current);
      plantaChaoRef.current = null;
    }
    ajustarModoDeRender();
    const p = plantaPavimento;
    if (!p?.url) return;
    const b = buildingsRef.current.find((x) => x.id === p.buildingId);
    const node = nodesRef.current.get(p.buildingId);
    if (!b || !node) return;
    const a = p.area;
    const { position, orientation } = poseNoModelo(b, node.groundHeight, a.x, a.y, p.z, a.rot);
    plantaChaoRef.current = v.entities.add({
      id: `planta-chao:${p.buildingId}`,
      position,
      orientation: new ConstantProperty(orientation),
      plane: {
        // Normal +Z no referencial já girado pela pose: o plano fica deitado,
        // acompanhando inclinação e giro do modelo.
        plane: new ConstantProperty(new Plane(Cartesian3.UNIT_Z, 0)),
        dimensions: new Cartesian2(a.comprimento * b.scale, a.largura * b.scale),
        material: new ImageMaterialProperty({
          image: p.url,
          // `transparent`: planta costuma ser PNG com fundo vazado, e sem isto
          // o Cesium desenha o fundo como preto sólido em cima do pavimento.
          transparent: true,
          color: Color.WHITE.withAlpha(p.opacidade ?? 0.85),
        }),
        shadows: ShadowMode.DISABLED,
      },
    });
    requestRender();
  }

  /**
   * Desenha o perímetro do terreno sobre a fotogrametria: linha fechada mais
   * uma área translúcida. O campo `perimetro` existia no modelo desde o começo
   * e nunca era desenhado — cadastrá-lo não produzia efeito nenhum.
   */
  function syncPerimetro() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    perimetroRef.current.forEach((e) => v.entities.remove(e));
    perimetroRef.current = [];

    for (const b of buildingsRef.current) {
      const pts = b.empreendimento.perimetro ?? [];
      if (pts.length < 2) continue;
      const gh = nodesRef.current.get(b.id)?.groundHeight ?? FALLBACK_GROUND_HEIGHT;
      // Um palmo acima do solo: no mesmo nível a linha briga com a fotogrametria
      // e aparece piscando (z-fighting).
      const posicoes = pts.map((p) => Cartesian3.fromDegrees(p.lng, p.lat, gh + 0.6));

      perimetroRef.current.push(
        v.entities.add({
          id: `perimetro:linha:${b.id}`,
          polyline: {
            positions: [...posicoes, posicoes[0]],
            width: 3,
            material: new ColorMaterialProperty(Color.fromCssColorString(BRAND_TURQUOISE).withAlpha(0.95)),
          },
        }),
      );

      if (pts.length >= 3) {
        perimetroRef.current.push(
          v.entities.add({
            id: `perimetro:area:${b.id}`,
            polygon: {
              hierarchy: new PolygonHierarchy(posicoes),
              material: new ColorMaterialProperty(Color.fromCssColorString(BRAND_TURQUOISE).withAlpha(0.12)),
              perPositionHeight: true,
              shadows: ShadowMode.DISABLED,
            },
          }),
        );
      }
    }
    requestRender();
  }

  /**
   * Prisma de uma unidade com contorno próprio.
   *
   * A caixa do Cesium tem uma orientação e três medidas — não há como descrever
   * um "L" com ela. O polígono extrudado descreve, e é o mesmo recurso que a
   * pista e as superfícies do entorno já usam.
   *
   * O contorno é dado em metros RELATIVOS AO CENTRO, então cada vértice é
   * girado pelo `rot` da unidade e somado ao centro antes de virar coordenada
   * do modelo. É o que faz girar a unidade continuar sendo mexer num número só.
   *
   * `height`/`extrudedHeight` são alturas geodésicas, não do modelo: por isso a
   * inclinação (`rotX`/`rotY`) NÃO se aplica aqui — um prisma poligonal fica
   * sempre vertical. Unidade inclinada continua sendo caixa, que é onde a
   * inclinação faz sentido (rampa, telhado).
   */
  function prismaDaUnidade(ub: UnitBox, b: Building3D, gh: number) {
    const planta = ub.planta;
    if (!planta || planta.length < 3) return null;
    const s = b.scale;
    const cos = Math.cos(CesiumMath.toRadians(ub.rot));
    const sen = Math.sin(CesiumMath.toRadians(ub.rot));
    const zBase = ub.z - ub.dz / 2;
    const zTopo = ub.z + ub.dz / 2;

    const emZ = (p: { x: number; y: number }, z: number) => {
      const rx = p.x * cos - p.y * sen;
      const ry = p.x * sen + p.y * cos;
      return poseNoModelo(b, gh, ub.x + rx * s, ub.y + ry * s, z, 0).position;
    };
    const alturaDe = (c: Cartesian3) => Cartographic.fromCartesian(c)?.height;

    const piso = planta.map((p) => emZ(p, zBase + (p.z ?? 0)));
    const teto = planta.map((p) => emZ(p, zTopo + (p.zTopo ?? 0)));
    const hPiso = piso.map(alturaDe);
    const hTeto = teto.map(alturaDe);
    if (hPiso.some((h) => h == null) || hTeto.some((h) => h == null)) return null;

    return {
      piso,
      teto,
      hPiso: hPiso as number[],
      hTeto: hTeto as number[],
      // Anel fechado para a parede: o `wall` do Cesium não fecha sozinho.
      anel: [...piso, piso[0]],
      anelMin: [...(hPiso as number[]), hPiso[0] as number],
      anelMax: [...(hTeto as number[]), hTeto[0] as number],
    };
  }

  /**
   * Um vértice do contorno, no espaço do MODELO.
   *
   * O contorno é guardado em metros relativos ao centro da unidade, ainda sem o
   * giro dela. Aqui ele é girado e somado ao centro — a mesma conta do prisma,
   * para pivô e geometria não poderem divergir.
   */
  function vertParaModelo(ub: UnitBox, p: { x: number; y: number }) {
    const cos = Math.cos(CesiumMath.toRadians(ub.rot));
    const sen = Math.sin(CesiumMath.toRadians(ub.rot));
    return { x: ub.x + p.x * cos - p.y * sen, y: ub.y + p.x * sen + p.y * cos };
  }

  /**
   * O caminho de volta: um ponto do mundo vira coordenada LOCAL do contorno.
   *
   * Inverte a matriz do modelo (que já contém posição, giro e inclinação do
   * empreendimento), desfaz a escala, tira o centro da unidade e desgira pelo
   * `rot` dela. Sem esta volta o arraste não teria como escrever no formato em
   * que o contorno é guardado.
   */
  function mundoParaVertice(ub: UnitBox, b: Building3D, gh: number, mundo: Cartesian3) {
    const inv = Matrix4.inverse(modelMatrix(b, gh), new Matrix4());
    const p = Matrix4.multiplyByPoint(inv, mundo, new Cartesian3());
    const mx = p.x / b.scale - ub.x;
    const my = p.y / b.scale - ub.y;
    const cos = Math.cos(CesiumMath.toRadians(-ub.rot));
    const sen = Math.sin(CesiumMath.toRadians(-ub.rot));
    return {
      x: Math.round((mx * cos - my * sen) * 100) / 100,
      y: Math.round((mx * sen + my * cos) * 100) / 100,
    };
  }

  function syncPlantaUnidade() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    plantaUnidRef.current.forEach((e) => v.entities.remove(e));
    plantaUnidRef.current = [];

    const id = unidadePlantaIdRef.current;
    if (!id || !editRef.current) return;
    const ub = unitBoxesRef.current.find((x) => x.id === id);
    const planta = ub?.planta;
    if (!ub || !planta || planta.length < 3) return;
    const b = buildingsRef.current.find((x) => x.id === ub.buildingId);
    const node = nodesRef.current.get(ub.buildingId);
    if (!b || !node) return;
    const gh = node.groundHeight;
    const zPiso = ub.z - ub.dz / 2;
    const arrastando = plantaDragRef.current?.unidadeId === id;

    // Na altura do PRÓPRIO vértice: num piso torto, pivôs todos na mesma cota
    // mentiriam sobre onde o canto está.
    const noMundo = (p: { x: number; y: number; z?: number }) => {
      const m = vertParaModelo(ub, p);
      return poseNoModelo(b, gh, m.x, m.y, zPiso + (p.z ?? 0), 0).position;
    };

    /**
     * Dois pivôs por canto: um no piso e um no TETO, ligados por uma linha.
     *
     * O de cima existe para poder PEGAR o canto de onde se está olhando. Numa
     * unidade vista de cima, ou com o andar de baixo na frente, o pivô do piso
     * fica atrás da laje e não dá para acertar. Os dois movem o MESMO canto no
     * plano — o de cima não desloca o teto, que segue plano.
     */
    const zTeto = ub.z + ub.dz / 2;
    const noTeto = (p: { x: number; y: number; zTopo?: number }) => {
      const m = vertParaModelo(ub, p);
      return poseNoModelo(b, gh, m.x, m.y, zTeto + (p.zTopo ?? 0), 0).position;
    };

    planta.forEach((p, i) => {
      plantaUnidRef.current.push(v.entities.add({
        id: `unid-vert:${id}:${i}`,
        position: noMundo(p),
        point: {
          pixelSize: 13,
          color: Color.fromCssColorString("#ffb020"),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }));
      plantaUnidRef.current.push(v.entities.add({
        id: `unid-vert-topo:${id}:${i}`,
        position: noTeto(p),
        point: {
          // Mesmo peso do de baixo: os dois mandam, cada um na sua superfície.
          pixelSize: 13,
          color: Color.fromCssColorString("#ffd48a"),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }));
      // Prumada: liga os dois e diz que são o mesmo canto.
      plantaUnidRef.current.push(v.entities.add({
        id: `unid-prumo:${id}:${i}`,
        polyline: {
          positions: [noMundo(p), noTeto(p)],
          width: 1,
          material: new ColorMaterialProperty(
            Color.fromCssColorString("#ffb020").withAlpha(0.35),
          ),
        },
      }));
    });

    // Os "+" saem de cena durante o arraste: eles se movem junto com os
    // vértices e virariam alvos saltitantes sob o cursor.
    if (!arrastando) {
      planta.forEach((p, i) => {
        const prox = planta[(i + 1) % planta.length];
        plantaUnidRef.current.push(v.entities.add({
          id: `unid-meio:${id}:${i}`,
          position: noMundo({
            x: (p.x + prox.x) / 2,
            y: (p.y + prox.y) / 2,
            z: ((p.z ?? 0) + (prox.z ?? 0)) / 2,
          }),
          point: {
            pixelSize: 10,
            color: Color.TRANSPARENT,
            outlineColor: Color.fromCssColorString("#ffb020"),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }));
      });
    }

    // Contorno fechado, para ler a forma sem depender do prisma translúcido.
    plantaUnidRef.current.push(v.entities.add({
      id: `unid-contorno:${id}`,
      polyline: {
        positions: [...planta, planta[0]].map(noMundo),
        width: 2,
        material: new ColorMaterialProperty(Color.fromCssColorString("#ffb020")),
      },
    }));
    plantaUnidRef.current.push(v.entities.add({
      id: `unid-contorno-topo:${id}`,
      polyline: {
        positions: [...planta, planta[0]].map(noTeto),
        width: 1,
        material: new ColorMaterialProperty(
          Color.fromCssColorString("#ffd48a").withAlpha(0.7),
        ),
      },
    }));
    requestRender();
  }

  function syncUnitBoxes() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    const boxes = unitBoxes ?? [];
    const vistos = new Set<string>();
    ajustarModoDeRender();

    for (const ub of boxes) {
      const b = buildingsRef.current.find((x) => x.id === ub.buildingId);
      const node = nodesRef.current.get(ub.buildingId);
      if (!b || !node) continue;
      vistos.add(ub.id);

      const s = b.scale;
      const { position, orientation } = poseNoModelo(
        b, node.groundHeight, ub.x, ub.y, ub.z, ub.rot, ub.rotX, ub.rotY,
      );
      const dims = new Cartesian3(ub.dx * s, ub.dy * s, ub.dz * s);
      const cor = Color.fromCssColorString(ub.color).withAlpha(ub.alpha);
      // Seleção não entra nesta chave: ela vive na entidade de contorno. Assim
      // clicar não toca na primitiva preenchida nem provoca rebuild assíncrono.
      const key = JSON.stringify([
        b.lng, b.lat, b.offsetEast, b.offsetNorth, b.heightOffset,
        b.heading, b.pitch, b.roll, b.scale, node.groundHeight,
        ub.x, ub.y, ub.z, ub.rot, ub.rotX, ub.rotY,
        ub.dx, ub.dy, ub.dz, ub.color, ub.alpha,
        ub.planta ?? null,
      ]);

      const prisma = prismaDaUnidade(ub, b, node.groundHeight);
      const existente = unitEntitiesRef.current.get(ub.id);
      /**
       * Unidade com contorno é TRÊS objetos, não um.
       *
       * Piso e teto variam canto a canto, e nenhum polígono do Cesium faz as
       * duas superfícies variarem: `perPositionHeight` manda numa, e
       * `extrudedHeight` é um escalar — a outra sai plana à força.
       *
       * `wall` aceita `minimumHeights` E `maximumHeights`, os dois por vértice:
       * são as paredes. Piso e teto viram polígonos com `perPositionHeight`,
       * que aí têm uma superfície cada e a limitação não pesa.
       *
       * A caixa segue sendo UM objeto: a esmagadora maioria das unidades é
       * caixa, e três entidades por unidade num prédio de trezentas seria pagar
       * caro por um caso raro.
       */
      const formaMudou = existente && (!!existente.wall) !== (!!prisma);
      if (existente && formaMudou) {
        v.entities.remove(existente);
        unitEntitiesRef.current.delete(ub.id);
        unitEntityKeyRef.current.delete(ub.id);
      }
      if (formaMudou || !prisma) {
        (unitFacesRef.current.get(ub.id) ?? []).forEach((e) => v.entities.remove(e));
        unitFacesRef.current.delete(ub.id);
      }

      const atual = formaMudou ? undefined : existente;
      if (atual) {
        atual.show = ub.visible !== false;
        if (unitEntityKeyRef.current.get(ub.id) !== key) {
          if (prisma) {
            const g = atual.wall!;
            g.positions = new ConstantProperty(prisma.anel);
            g.minimumHeights = new ConstantProperty(prisma.anelMin);
            g.maximumHeights = new ConstantProperty(prisma.anelMax);
            g.material = new ColorMaterialProperty(cor);
            const faces = unitFacesRef.current.get(ub.id) ?? [];
            if (faces[0]?.polygon) {
              faces[0].polygon.hierarchy = new ConstantProperty(new PolygonHierarchy(prisma.piso));
              faces[0].polygon.material = new ColorMaterialProperty(cor);
            }
            if (faces[1]?.polygon) {
              faces[1].polygon.hierarchy = new ConstantProperty(new PolygonHierarchy(prisma.teto));
              faces[1].polygon.material = new ColorMaterialProperty(cor);
            }
          } else {
            atual.position = new ConstantPositionProperty(position);
            atual.orientation = new ConstantProperty(orientation);
            const g = atual.box!;
            g.dimensions = new ConstantProperty(dims);
            g.material = new ColorMaterialProperty(cor);
            g.outline = new ConstantProperty(false);
            g.show = new ConstantProperty(true);
          }
          unitEntityKeyRef.current.set(ub.id, key);
        }
      } else if (prisma) {
        unitEntitiesRef.current.set(ub.id, v.entities.add({
          id: `unit:${ub.id}`,
          show: ub.visible !== false,
          wall: {
            positions: prisma.anel,
            minimumHeights: prisma.anelMin,
            maximumHeights: prisma.anelMax,
            material: new ColorMaterialProperty(cor),
            outline: false,
            shadows: ShadowMode.DISABLED,
          },
        }));
        // Tampas: sem elas a unidade é um tubo vazado e se enxerga o interior
        // do prédio por cima.
        const face = (sufixo: string, pts: Cartesian3[]) => v.entities.add({
          id: `unit:${ub.id}:${sufixo}`,
          show: ub.visible !== false,
          polygon: {
            hierarchy: new PolygonHierarchy(pts),
            perPositionHeight: true,
            material: new ColorMaterialProperty(cor),
            outline: false,
            shadows: ShadowMode.DISABLED,
          },
        });
        unitFacesRef.current.set(ub.id, [face("piso", prisma.piso), face("teto", prisma.teto)]);
        unitEntityKeyRef.current.set(ub.id, key);
      } else {
        unitEntitiesRef.current.set(ub.id, v.entities.add({
          id: `unit:${ub.id}`,
          show: ub.visible !== false,
          position,
          orientation: new ConstantProperty(orientation),
          box: {
            dimensions: dims,
            material: new ColorMaterialProperty(cor),
            outline: false,
            // Sombras desligadas: são centenas de caixas translúcidas e o
            // custo não paga o ganho visual.
            shadows: ShadowMode.DISABLED,
          },
        }));
        unitEntityKeyRef.current.set(ub.id, key);
      }

      // As tampas seguem a visibilidade da parede.
      (unitFacesRef.current.get(ub.id) ?? []).forEach((e) => {
        e.show = ub.visible !== false;
      });
    }

    // Remove as que saíram da lista.
    for (const [id, ent] of Array.from(unitEntitiesRef.current.entries())) {
      if (vistos.has(id)) continue;
      v.entities.remove(ent);
      unitEntitiesRef.current.delete(id);
      unitEntityKeyRef.current.delete(id);
      (unitFacesRef.current.get(id) ?? []).forEach((e) => v.entities.remove(e));
      unitFacesRef.current.delete(id);
    }

    // O destaque vive numa entidade própria, ligeiramente maior para não
    // disputar profundidade com a caixa. Assim a unidade original nunca é
    // removida/recriada ao clicar.
    const selecionados = new Set(boxes.filter((ub) => ub.outline).map((ub) => ub.id));
    for (const ub of boxes) {
      if (!ub.outline) continue;
      const b = buildingsRef.current.find((x) => x.id === ub.buildingId);
      const node = nodesRef.current.get(ub.buildingId);
      if (!b || !node) continue;
      const { position, orientation } = poseNoModelo(
        b, node.groundHeight, ub.x, ub.y, ub.z, ub.rot, ub.rotX, ub.rotY,
      );
      const dims = new Cartesian3(ub.dx * b.scale * 1.015, ub.dy * b.scale * 1.015, ub.dz * b.scale * 1.015);
      /**
       * O destaque segue a FORMA da unidade.
       *
       * Numa unidade subdividida em "L", uma caixa de destaque desenharia um
       * retângulo em volta dela — marcando área que não é da unidade e
       * invadindo a vizinha. O contorno do prisma marca exatamente o que foi
       * selecionado.
       */
      const prismaSel = prismaDaUnidade(ub, b, node.groundHeight);
      const existente = unitSelectionRef.current.get(ub.id);
      // Trocar de forma exige refazer: `box` não vira `wall` no lugar.
      if (existente && (!!existente.wall) !== (!!prismaSel)) {
        v.entities.remove(existente);
        unitSelectionRef.current.delete(ub.id);
      }
      const atualSel = unitSelectionRef.current.get(ub.id);
      if (atualSel) {
        if (prismaSel) {
          const g = atualSel.wall!;
          g.positions = new ConstantProperty(prismaSel.anel);
          g.minimumHeights = new ConstantProperty(prismaSel.anelMin);
          g.maximumHeights = new ConstantProperty(prismaSel.anelMax);
        } else {
          atualSel.position = new ConstantPositionProperty(position);
          atualSel.orientation = new ConstantProperty(orientation);
          atualSel.box!.dimensions = new ConstantProperty(dims);
        }
      } else {
        unitSelectionRef.current.set(ub.id, v.entities.add(prismaSel
          ? {
              id: `unit-selection:${ub.id}`,
              wall: {
                positions: prismaSel.anel,
                minimumHeights: prismaSel.anelMin,
                maximumHeights: prismaSel.anelMax,
                fill: false,
                outline: true,
                outlineColor: Color.WHITE,
                shadows: ShadowMode.DISABLED,
              },
            }
          : {
              id: `unit-selection:${ub.id}`,
              position,
              orientation: new ConstantProperty(orientation),
              box: {
                dimensions: dims,
                fill: false,
                outline: true,
                outlineColor: Color.WHITE,
                shadows: ShadowMode.DISABLED,
              },
            }));
      }
    }
    for (const [id, ent] of Array.from(unitSelectionRef.current.entries())) {
      if (selecionados.has(id)) continue;
      v.entities.remove(ent);
      unitSelectionRef.current.delete(id);
    }
    requestRender();
  }

  /**
   * Enquadra uma unidade.
   *
   * Sem `cam`, mantém o azimute atual da câmera — o comportamento antigo, que
   * evita um giro brusco quando o visitante só está navegando pela lista. Com
   * `cam`, usa o enquadramento configurado para aquela unidade no editor.
   */
  /**
   * Centro da unidade no mundo, seja ela caixa ou prisma.
   *
   * A entidade de uma unidade subdividida é um `polygon`, e polígono do Cesium
   * NÃO tem `position` — a posição dele está na hierarquia de vértices. Quem
   * dependia de `ent.position` desistia em silêncio: no enquadramento, a câmera
   * simplesmente não ia; no clique, a unidade perdia a disputa de proximidade
   * para a vizinha.
   *
   * A caixa da unidade já traz o centro em coordenadas do modelo, e ele é o
   * mesmo nos dois casos — é dele que sai tanto a posição da caixa quanto o
   * contorno do prisma.
   */
  /**
   * Id da unidade a partir do id da entidade clicada.
   *
   * Uma unidade com contorno tem TRÊS entidades — parede, piso e teto — e as
   * tampas trazem um sufixo. Sem tirá-lo, clicar no piso de uma unidade
   * subdividida devolvia "u123:piso", que não é unidade nenhuma: o clique
   * simplesmente não selecionava.
   */
  function unidadeDoEntityId(eid?: string): string | undefined {
    for (const pre of ["unit-selection:", "unit:"]) {
      if (!eid?.startsWith(pre)) continue;
      const resto = eid.slice(pre.length);
      return resto.replace(/:(piso|teto)$/, "");
    }
    return undefined;
  }

  function centroDaUnidade(unitId: string): Cartesian3 | undefined {
    const v = viewerRef.current;
    const ent = unitEntitiesRef.current.get(unitId);
    const pos = v ? ent?.position?.getValue(v.clock.currentTime) : undefined;
    if (pos) return pos;
    const ub = unitBoxesRef.current.find((x) => x.id === unitId);
    if (!ub) return undefined;
    const b = buildingsRef.current.find((x) => x.id === ub.buildingId);
    const node = nodesRef.current.get(ub.buildingId);
    if (!b || !node) return undefined;
    return poseNoModelo(b, node.groundHeight, ub.x, ub.y, ub.z, 0).position;
  }

  function frameUnit(
    unitId: string,
    cam?: { angulo: number; inclinacao: number; distancia: number },
    duration = 1.2,
  ) {
    const v = viewerRef.current;
    if (!v) return false;
    const pos = centroDaUnidade(unitId);
    if (!pos) return false;
    soltarOrbita();
    v.camera.flyToBoundingSphere(new BoundingSphere(pos, 26), {
      duration,
      offset: new HeadingPitchRange(
        cam ? CesiumMath.toRadians(cam.angulo) : v.camera.heading,
        CesiumMath.toRadians(cam ? cam.inclinacao : -12),
        cam ? Math.max(5, cam.distancia) : 90,
      ),
    });
    return true;
  }

  /**
   * Marcador do empreendimento no mapa.
   *
   * Quando o projeto tem símbolo de marca (`markerImageUrl`), ele vira a
   * imagem do marcador. Antes esse upload era salvo e nunca usado: a cena
   * desenhava sempre um ponto turquesa com etiqueta de texto.
   */
  function upsertMarker(b: Building3D, node: BuildingNode) {
    const v = viewerRef.current!;
    const isSel = b.id === selectedRef.current;
    const pos = Cartesian3.fromDegrees(b.lng, b.lat, node.groundHeight + 8);
    const img = b.empreendimento.markerImageUrl;

    // Trocar entre ponto e imagem exige recriar: são gráficos diferentes.
    if (node.marker && node.markerImg !== img) {
      v.entities.remove(node.marker);
      node.marker = undefined;
    }

    if (!node.marker) {
      node.markerImg = img;
      node.marker = v.entities.add({
        id: `marker:${b.id}`,
        position: pos,
        ...(img
          ? {
              billboard: {
                image: img,
                width: 46,
                height: 46,
                verticalOrigin: VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new NearFarScalar(500, 1.0, 8000, 0.55),
              },
            }
          : {
              point: {
                pixelSize: 9,
                color: Color.fromCssColorString(BRAND_TURQUOISE),
                outlineColor: Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            }),
        label: {
          text: b.empreendimento.name.toUpperCase(),
          font: "600 13px Brandon, Montserrat, sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL,
          showBackground: true,
          backgroundColor: MARKER_BG,
          backgroundPadding: new Cartesian2(8, 5),
          verticalOrigin: VerticalOrigin.BOTTOM,
          // Com símbolo, a etiqueta desce para não cobrir a imagem.
          pixelOffset: new Cartesian2(0, img ? 8 : -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new NearFarScalar(500, 1.0, 8000, 0.6),
        },
      });
    } else {
      node.marker.position = new ConstantPositionProperty(pos);
    }
    if (node.marker.label) {
      node.marker.label.backgroundColor = new ConstantProperty(isSel ? MARKER_BG_SEL : MARKER_BG);
    }
  }

  function upsertPlaceholder(b: Building3D, node: BuildingNode) {
    const v = viewerRef.current!;
    if (node.box) {
      v.entities.remove(node.box);
      node.box = undefined;
    }
    const ph = b.placeholder ?? { width: 28, depth: 28, height: 90 };
    const h = ph.height * b.scale;
    const [lng, lat] = offsetLngLat(b);
    const position = Cartesian3.fromDegrees(lng, lat, node.groundHeight + b.heightOffset + h / 2);
    const hpr = new HeadingPitchRoll(
      CesiumMath.toRadians(b.heading),
      CesiumMath.toRadians(b.pitch),
      CesiumMath.toRadians(b.roll),
    );
    const orientation = Transforms.headingPitchRollQuaternion(position, hpr);
    const isSel = b.id === selectedRef.current;
    node.box = v.entities.add({
      id: `box:${b.id}`,
      position,
      orientation: new ConstantProperty(orientation),
      box: {
        dimensions: new Cartesian3(ph.width * b.scale, ph.depth * b.scale, h),
        material: new ColorMaterialProperty(
          Color.fromCssColorString(isSel ? "#84cc16" : "#cfd8a8").withAlpha(0.85),
        ),
        outline: true,
        outlineColor: Color.fromCssColorString("#a3b535"),
        shadows: ShadowMode.ENABLED,
      },
    });
  }

  async function loadModel(b: Building3D, node: BuildingNode) {
    const v = viewerRef.current;
    if (!v || !b.modelUrl) return;
    const url = b.modelUrl;
    node.loadingUrl = url;
    marcarCarregamento(b.id, true);

    // Mede a geometria em paralelo: e uma requisicao independente (so o
    // cabecalho do arquivo) e o resultado so e necessario se o recorte estiver
    // ligado. Uma vez por URL.
    if (!caixaGlbRef.current.has(url)) {
      caixaGlbRef.current.set(url, null); // reserva, para nao medir duas vezes
      void medirGlb(url).then((caixa) => {
        caixaGlbRef.current.set(url, caixa);
        if (caixa) aplicarRecorteTerreno();
      });
    }

    try {
      const gltf = await Model.fromGltfAsync({
        url: b.modelUrl,
        modelMatrix: modelMatrix(b, node.groundHeight),
        scale: b.scale,
        shadows: ShadowMode.ENABLED,
        // As texturas entram JUNTO, não em fluxo depois. Com o padrão
        // (incremental), `readyEvent` dispara com a geometria pronta e o prédio
        // aparece cinza, texturizando-se na frente do cliente — trocar o
        // "aparecer do nada" por "aparecer errado e se corrigir" não é ganho.
        incrementallyLoadTextures: false,
      });
      if (!viewerRef.current || v.isDestroyed()) {
        node.loadingUrl = undefined;
        marcarCarregamento(b.id, false);
        return;
      }
      // Trocaram o GLB no meio do caminho: este que chegou já é o antigo.
      // Descartar é obrigatório — adicioná-lo à cena deixaria dois modelos
      // sobrepostos, e o que o editor mostra deixaria de ser o que está salvo.
      if (node.loadingUrl !== url) {
        gltf.destroy();
        return;
      }
      // Desliga o mapa de ambiente DINÂMICO do modelo (gera por vários frames =
      // render contínuo). Mantemos a IBL estática (luminanceAtZenith) para o
      // ambiente difuso, sem o loop de renderização.
      const em = (gltf as unknown as { environmentMapManager?: { enabled: boolean } }).environmentMapManager;
      if (em) em.enabled = false;
      // Realce ESTÁTICO (sem loop de render): mistura leve com um tom claro/frio
      // levanta o vidro escuro e deixa a fachada legível, mantendo variação.
      gltf.color = Color.fromCssColorString("#e6eef2");
      gltf.colorBlendMode = ColorBlendMode.MIX;
      gltf.colorBlendAmount = 0.3;
      (gltf as unknown as { id: unknown }).id = `model:${b.id}`;
      v.scene.primitives.add(gltf);
      node.model = gltf;
      node.loadedUrl = b.modelUrl;
      updateModelTransform(b, node);
      // O modelo pode ter chegado com o espelho 3D ou o noturno já ligados.
      aplicarAparenciaModelo();
      requestRender();

      /**
       * `fromGltfAsync` resolve com o glTF BAIXADO — não com ele desenhável.
       * Entre uma coisa e outra o Cesium ainda cria os recursos de WebGL, e é
       * nesse intervalo que a cena fica com um buraco no lugar do prédio.
       * `readyEvent` é o marco certo para dizer que acabou.
       */
      const concluir = () => {
        if (node.loadingUrl === url) node.loadingUrl = undefined;
        marcarCarregamento(b.id, false);
        /**
         * Reenquadra agora que existe geometria de verdade.
         *
         * O primeiro voo acontece assim que o projeto chega, e nessa hora o GLB
         * ainda está baixando: `esferaDoPredio` só tem o `placeholder` para
         * estimar, um palpite de 30×30×96 m que quase nunca é o prédio. O
         * resultado era abrir longe demais e nunca corrigir.
         *
         * Só quando o projeto NÃO tem câmera salva — se tem, ela é a decisão de
         * enquadramento de quem montou o projeto, e sobrepô-la seria arrogância.
         */
        const sel = selectedRef.current;
        const atual = buildingsRef.current.find((x) => x.id === b.id);
        if (atual && sel === b.id && !cameraInteragidaRef.current
          && !(atual.camera && cameraAindaServe(atual, atual.camera))) {
          flyToBuilding(atual);
        }
      };
      if (gltf.ready) {
        concluir();
      } else {
        const pronto = gltf.readyEvent.addEventListener(() => {
          pronto();
          concluir();
          requestRender();
        });
        // Sem isto, um GLB corrompido deixaria a tela de carregamento presa
        // para sempre — o erro é do modelo, não motivo para reter a cena.
        const falhou = gltf.errorEvent.addEventListener(() => {
          falhou();
          concluir();
        });
      }
    } catch (e) {
      console.error(`[Scene3D] falha ao carregar modelo de ${b.id}:`, e);
      node.loadingUrl = undefined;
      marcarCarregamento(b.id, false);
    }
  }

  function updateModelTransform(b: Building3D, node: BuildingNode) {
    if (!node.model) return;
    node.model.modelMatrix = modelMatrix(b, node.groundHeight);
    node.model.scale = b.scale;
    /**
     * Silhueta: só no EDITOR.
     *
     * Ela marca qual prédio está selecionado — pergunta que só existe onde há
     * vários e se escolhe um para mexer. Na vitrine o empreendimento é
     * selecionado assim que o projeto carrega, e nunca é deselecionado: o
     * resultado era um contorno turquesa permanente em volta do GLB inteiro,
     * marcando uma seleção que o visitante não fez e não pode desfazer.
     *
     * Pior que inútil: é uma linha de 2px na cor da ferramenta por cima da
     * fachada que se está vendendo.
     */
    const isSel = b.id === selectedRef.current;
    node.model.silhouetteColor = Color.fromCssColorString(BRAND_TURQUOISE);
    node.model.silhouetteSize = isSel && editRef.current ? 2 : 0;
  }

  // ==== GIZMO DE MANIPULAÇÃO (modo edição) ===================================
  const GIZMO_COLOR = {
    tE: "#ff5a5a", // Leste (X) — vermelho
    tN: "#4ade80", // Norte (Y) — verde
    tU: "#4aa8ff", // Cima (Z)  — azul
    scale: "#22d3ee", // Escala  — ciano
    // Os anéis de giro não têm cor própria: cada um usa a do eixo em torno do
    // qual gira, para o vermelho do anel e o vermelho da seta serem o mesmo X.
  };

  /** Os três eixos de uma matriz de transformação, normalizados. */
  function eixosDaMatriz(m: Matrix4) {
    // getColumn devolve Cartesian4; só os três primeiros componentes interessam.
    const coluna = (i: number) => {
      const c = Matrix4.getColumn(m, i, new Cartesian4());
      return Cartesian3.normalize(new Cartesian3(c.x, c.y, c.z), new Cartesian3());
    };
    return { east: coluna(0), north: coluna(1), up: coluna(2) };
  }

  /** Origem (mundo) + base ENU + tamanho do gizmo do prédio selecionado. */
  function computeGframe(b: Building3D, node: BuildingNode) {
    const [lng, lat] = offsetLngLat(b);
    const origin = Cartesian3.fromDegrees(lng, lat, node.groundHeight + b.heightOffset);
    const { east, north, up } = eixosDaMatriz(Transforms.eastNorthUpToFixedFrame(origin));
    // Reserva: o tamanho de verdade vem de `alcaL()`, que o mede em pixels de
    // tela. Este valor só é usado no instante em que ainda não há viewer.
    //
    // `ready` NÃO é zelo redundante: o getter `boundingSphere` do Cesium LANÇA
    // enquanto o GLB não terminou de carregar, e `?.` não protege contra um
    // getter que lança — só contra `model` ser nulo. O gizmo é montado assim que
    // o prédio é selecionado, o que costuma ser antes de o modelo estar pronto.
    const r = node.model?.ready
      ? node.model.boundingSphere.radius
      : (b.placeholder?.height ?? 90) * 0.6;
    const L = Math.max(25, Math.min(r * 0.35, 120));
    /**
     * Eixos do MODELO — com heading/pitch/roll aplicados —, não o ENU cru.
     *
     * O comentário antigo aqui dizia que no empreendimento os anéis mapeiam
     * heading/pitch/roll "sobre o ENU, que já é o referencial dos campos". Não
     * é, e era a causa dos anéis trocados.
     *
     * O Cesium compõe `headingPitchRollToFixedFrame` como Rz(-heading) ·
     * Ry(-pitch) · Rx(roll) SOBRE o ENU. Só o heading gira em torno de um eixo
     * do ENU (o vertical). `roll` gira em torno do X do modelo JÁ girado pelo
     * heading, e `pitch` em torno do Y já girado.
     *
     * Num prédio com heading 90°, o X do modelo aponta para o NORTE. O anel
     * vermelho era desenhado em torno do leste do ENU e, ao ser arrastado,
     * escrevia em `roll` — que gira em torno do norte, onde estava desenhado o
     * anel verde. Vermelho fazia o que verde mostrava.
     *
     * As colunas da matriz do modelo dão exatamente esses eixos. Com roll e
     * pitch em zero — o caso de qualquer empreendimento aprumado — a
     * correspondência fica exata.
     *
     * `east`/`north`/`up` continuam sendo o ENU cru: as SETAS de mover escrevem
     * em `offsetEast`/`offsetNorth`, que são deslocamentos em ENU. Os dois
     * referenciais coexistem porque as duas ferramentas falam de coisas
     * diferentes.
     */
    const obj = eixosDaMatriz(modelMatrix(b, node.groundHeight));
    return {
      origin: pivotRef.current ?? origin, origemNatural: origin,
      east, north, up,
      eastObj: obj.east, northObj: obj.north, upObj: obj.up,
      L, local: false, escala: b.scale,
    };
  }

  /**
   * Frame de um alvo no espaço do modelo. A origem é o ponto (x,y,z) do modelo
   * levado ao mundo pela mesma matriz das caixas do espelho, e os eixos são os
   * do modelo — de forma que cada alça corresponda a um campo do inspetor.
   */
  function computeGframeLocal(b: Building3D, node: BuildingNode, alvo: GizmoLocal) {
    const { position } = poseNoModelo(b, node.groundHeight, alvo.x, alvo.y, alvo.z, 0);
    const m = modelMatrix(b, node.groundHeight);
    const { east, north, up } = eixosDaMatriz(m);
    // Os eixos da PEÇA: a mesma composição Rz·Ry·Rx que orienta a caixa dela,
    // aplicada sobre a matriz do modelo. Ver `eastObj` na declaração do frame.
    const rotAlvo = Matrix3.multiply(
      Matrix3.fromRotationZ(CesiumMath.toRadians(alvo.rot)),
      Matrix3.multiply(
        Matrix3.fromRotationY(CesiumMath.toRadians(alvo.rotY ?? 0)),
        Matrix3.fromRotationX(CesiumMath.toRadians(alvo.rotX ?? 0)),
        new Matrix3(),
      ),
      new Matrix3(),
    );
    const mObj = Matrix4.multiply(
      m,
      Matrix4.fromRotationTranslation(rotAlvo, Cartesian3.ZERO),
      new Matrix4(),
    );
    const obj = eixosDaMatriz(mObj);
    // Reserva, como em `computeGframe`. Era AQUI que a alça inchava: numa torre
    // de 63 m de comprimento, `ref * 1.4` dava uma seta de 88 m — mais alta que
    // a torre e tapando o que se estava calibrando. Quem decide agora é `alcaL()`.
    const d = alvo.dims;
    const ref = d ? Math.max(d.dx, d.dy, d.dz) : 12;
    const L = Math.max(10, Math.min(ref * 1.4, 90)) * b.scale;
    return {
      origin: pivotRef.current ?? position, origemNatural: position,
      east, north, up,
      eastObj: obj.east, northObj: obj.north, upObj: obj.up,
      L, local: true, escala: b.scale,
    };
  }

  /**
   * Fração da ALTURA DA TELA que o braço da alça ocupa.
   *
   * 0.13 ≈ um oitavo da tela, que é a proporção que Blender, Unity e Unreal
   * usam: grande o bastante para pegar com o mouse, pequena o bastante para não
   * tapar o que se está posicionando.
   */
  const FRACAO_TELA_GIZMO = 0.13;

  /**
   * Comprimento da alça, em metros do mundo, para ela ter SEMPRE o mesmo
   * tamanho na tela.
   *
   * Antes o comprimento vinha do tamanho do ALVO: `ref * 1.4`, limitado a 90 m.
   * Numa torre de 63 m de comprimento isso dava uma seta de 88 m — três vezes
   * mais alta que a própria torre, atravessando a tela inteira e tapando
   * justamente o prédio que se está calibrando. E o defeito era dos dois lados:
   * afastando a câmera, a mesma seta virava um risco de poucos pixels.
   *
   * O tamanho do alvo é a referência errada. O que importa é quantos pixels a
   * alça ocupa para a mão, e isso depende da DISTÂNCIA DA CÂMERA — que é o que
   * todo editor 3D usa. Como as posições são `CallbackProperty`, o valor é
   * reavaliado a cada frame e a alça acompanha o zoom sozinha.
   */
  function alcaL(g: NonNullable<typeof gframeRef.current>): number {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return g.L;
    const dist = Cartesian3.distance(v.camera.positionWC, g.origin);
    if (!Number.isFinite(dist) || dist <= 0) return g.L;
    // Altura visível do mundo à distância do pivô, pela abertura real da lente.
    const frustum = v.camera.frustum as { fovy?: number };
    const fovy = Number.isFinite(frustum.fovy) ? (frustum.fovy as number) : Math.PI / 3;
    const alturaVisivel = 2 * dist * Math.tan(fovy / 2);
    // Piso mínimo só para o caso degenerado da câmera colada no pivô.
    return Math.max(0.5, alturaVisivel * FRACAO_TELA_GIZMO);
  }

  function updateGframe() {
    const alvo = gizmoLocalRef.current;
    if (alvo) {
      const b = buildingsRef.current.find((x) => x.id === alvo.buildingId);
      const node = nodesRef.current.get(alvo.buildingId);
      gframeRef.current = b && node ? computeGframeLocal(b, node, alvo) : null;
      return;
    }
    if (!gizmoEmpRef.current) { gframeRef.current = null; return; }
    const id = selectedRef.current;
    const b = id ? buildingsRef.current.find((x) => x.id === id) : undefined;
    const node = id ? nodesRef.current.get(id) : undefined;
    // Antes exigia `b.modelUrl`: um projeto ainda sem GLB não tinha gizmo
    // nenhum, justamente quando posicionar o volume mais importa.
    gframeRef.current = b && node ? computeGframe(b, node) : null;
  }

  function clearGizmo() {
    const v = viewerRef.current;
    if (v) gizmoRef.current.forEach((e) => v.entities.remove(e));
    gizmoRef.current = [];
  }

  /**
   * Plano de cada anel de giro: a normal e a base (u1, u2) em que o ângulo é
   * medido, indo de u1 para u2.
   *
   * As duas convenções são diferentes e é aqui que a diferença fica contida:
   *
   * - **Empreendimento** — a do Cesium (`HeadingPitchRoll`): heading gira em
   *   torno de -Z (horário a partir do norte, como bússola), pitch em torno de
   *   -Y (o leste do modelo sobe) e roll em torno de +X (o norte sobe).
   * - **Alvo local** — rotações anti-horárias em torno dos eixos POSITIVOS do
   *   modelo, compostas Rz · Ry · Rx, que é como `poseNoModelo` monta a caixa.
   *
   * O anel `rotX` cai na mesma medida nos dois casos; `rot` e `rotY` invertem.
   */
  function planoDoAnel(kind: AnelKind, g: NonNullable<typeof gframeRef.current>) {
    // Eixos da PEÇA: o anel tem de girar em torno do eixo do fator que ele
    // controla. Num alvo sem giro próprio estes são os mesmos de sempre; num
    // alvo girado (uma torre com `rot: 90`) são o que corrige a inversão.
    const eX = g.eastObj;
    const eY = g.northObj;
    const eZ = g.upObj;
    if (kind === "rot") {
      return g.local ? { n: eZ, u1: eX, u2: eY } : { n: eZ, u1: eY, u2: eX };
    }
    if (kind === "rotX") return { n: eX, u1: eY, u2: eZ };
    return g.local ? { n: eY, u1: eZ, u2: eX } : { n: eY, u1: eX, u2: eZ };
  }

  /** Campo que cada anel edita, conforme o alvo. */
  function campoDoAnel(kind: AnelKind, local: boolean): string {
    if (local) return kind;
    return kind === "rot" ? "heading" : kind === "rotX" ? "roll" : "pitch";
  }

  const ANEL_ROTULO: Record<AnelKind, string> = {
    rot: "Giro (Z)",
    rotX: "Inclinar (X)",
    rotY: "Inclinar (Y)",
  };

  /** Valor atual do ângulo de um anel, em graus. */
  function valorDoAnel(kind: AnelKind, local: boolean): number {
    if (local) {
      const alvo = gizmoLocalRef.current;
      if (!alvo) return 0;
      return kind === "rot" ? alvo.rot : kind === "rotX" ? (alvo.rotX ?? 0) : (alvo.rotY ?? 0);
    }
    const b = buildingsRef.current.find((x) => x.id === selectedRef.current);
    if (!b) return 0;
    return kind === "rot" ? b.heading : kind === "rotX" ? b.roll : b.pitch;
  }

  /** Ponto do anel na posição do ângulo atual — o puxador clicável dele. */
  function pontaDoAnel(kind: AnelKind): Cartesian3 | undefined {
    const g = gframeRef.current;
    if (!g) return undefined;
    const { u1, u2 } = planoDoAnel(kind, g);
    const rad = CesiumMath.toRadians(valorDoAnel(kind, g.local));
    const d = Cartesian3.add(
      Cartesian3.multiplyByScalar(u1, Math.cos(rad), new Cartesian3()),
      Cartesian3.multiplyByScalar(u2, Math.sin(rad), new Cartesian3()),
      new Cartesian3(),
    );
    return Cartesian3.add(
      g.origin,
      Cartesian3.multiplyByScalar(d, alcaL(g) * 0.9, new Cartesian3()),
      new Cartesian3(),
    );
  }

  function buildGizmo() {
    const v = viewerRef.current;
    if (!v) return;
    if (!gframeRef.current) { clearGizmo(); return; }
    if (gizmoRef.current.length) { requestRender(); return; }

    // Sobre um centroide de vários alvos, girar e escalar não têm significado
    // único — só a translação move o grupo inteiro de forma previsível.
    const alvoAtual = gizmoLocalRef.current;
    const modo = alvoAtual?.somenteMover || alvoAtual?.somenteZ ? "mover" : gizmoModoRef.current;
    const soZ = !!alvoAtual?.somenteZ;

    /** Seta de translação + ponta clicável (a linha sozinha é difícil de pegar). */
    const eixo = (kind: "tE" | "tN" | "tU", dir: "east" | "north" | "up", css: string) => {
      const ponta = () => {
        const g = gframeRef.current;
        if (!g) return undefined;
        return Cartesian3.add(
          g.origin,
          Cartesian3.multiplyByScalar(g[dir], alcaL(g), new Cartesian3()),
          new Cartesian3(),
        );
      };
      gizmoRef.current.push(
        v.entities.add({
          id: `gizmo:${kind}`,
          polyline: linhaDaAlca({
            positions: new CallbackProperty(() => {
              const g = gframeRef.current;
              const p = ponta();
              return g && p ? [g.origin, p] : [];
            }, false),
            width: 14,
            material: new PolylineArrowMaterialProperty(Color.fromCssColorString(css)),
          }),
        }),
      );
      // Alvo generoso na ponta: dobra a área de clique do eixo.
      gizmoRef.current.push(
        v.entities.add({
          id: `gizmo:${kind}:ponta`,
          position: new CallbackPositionProperty(ponta, false),
          point: {
            // Alvo real do clique: o ponto ignora a profundidade e continua
            // clicável mesmo quando a seta está dentro do prédio.
            pixelSize: 20,
            color: Color.fromCssColorString(css),
            outlineColor: Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    };

    if (modo === "mover") {
      if (!soZ) {
        eixo("tE", "east", GIZMO_COLOR.tE);
        eixo("tN", "north", GIZMO_COLOR.tN);
      }
      eixo("tU", "up", GIZMO_COLOR.tU);
    }

    if (modo === "girar") {
      /**
       * Um anel por eixo, colorido pelo eixo em torno do qual gira — a mesma
       * convenção do Blender e do Unity, e as mesmas cores das setas de mover.
       * Antes existia só o anel de heading: qualquer inclinação do modelo (um
       * terreno em declive, um GLB exportado torto) só se corrigia editando
       * pitch/roll no painel, se é que se descobria que eles existiam.
       */
      const anel = (kind: AnelKind, css: string) => {
        gizmoRef.current.push(
          v.entities.add({
            id: `gizmo:${kind}`,
            polyline: linhaDaAlca({
              positions: new CallbackProperty(() => {
                const g = gframeRef.current;
                if (!g) return [];
                const { u1, u2 } = planoDoAnel(kind, g);
                const R = alcaL(g) * 0.9;
                const pts: Cartesian3[] = [];
                for (let i = 0; i <= 72; i++) {
                  const a = (i / 72) * Math.PI * 2;
                  const off = Cartesian3.add(
                    Cartesian3.multiplyByScalar(u1, R * Math.cos(a), new Cartesian3()),
                    Cartesian3.multiplyByScalar(u2, R * Math.sin(a), new Cartesian3()),
                    new Cartesian3(),
                  );
                  pts.push(Cartesian3.add(g.origin, off, new Cartesian3()));
                }
                return pts;
              }, false),
              width: 12,
              material: new ColorMaterialProperty(Color.fromCssColorString(css).withAlpha(0.9)),
            }),
          }),
        );
        // Puxador no ângulo atual: é o alvo clicável do anel, que sendo
        // polilinha pode ficar escondido dentro do prédio. Também é a leitura
        // visual do valor — o puxador está onde o ângulo está.
        gizmoRef.current.push(
          v.entities.add({
            id: `gizmo:${kind}:puxador`,
            position: new CallbackPositionProperty(() => pontaDoAnel(kind), false),
            point: {
              pixelSize: 20,
              color: Color.fromCssColorString(css),
              outlineColor: Color.WHITE,
              outlineWidth: 3,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        );
      };

      anel("rot", GIZMO_COLOR.tU);   // em torno do vertical — azul, como o eixo Z
      anel("rotX", GIZMO_COLOR.tE);  // em torno do leste/X — vermelho
      anel("rotY", GIZMO_COLOR.tN);  // em torno do norte/Y — verde

      // Agulha da frente do modelo: mostra para onde ele está apontando.
      gizmoRef.current.push(
        v.entities.add({
          id: "gizmo:rot:agulha",
          polyline: linhaDaAlca({
            positions: new CallbackProperty(() => {
              const p = pontaDoAnel("rot");
              const g = gframeRef.current;
              return g && p ? [g.origin, p] : [];
            }, false),
            width: 6,
            material: new ColorMaterialProperty(Color.WHITE.withAlpha(0.85)),
          }),
        }),
      );
    }

    /**
     * Escala POR EIXO — só faz sentido num alvo local (torre, unidade, área do
     * corte), que guarda três medidas em metros.
     *
     * O empreendimento tem uma `scale` só, um número que multiplica o GLB
     * inteiro: ali não há eixo a separar, e a alça diagonal única continua
     * sendo a representação certa.
     *
     * Havia só a diagonal para todo mundo, e ela multiplica os três eixos
     * juntos: não existia gesto para alargar uma torre sem esticá-la na altura
     * também. Cada alça agora anda no seu eixo e mexe numa medida só, na mesma
     * cor da seta de mover do mesmo eixo.
     */
    const alvoTemDims = !!alvoAtual?.dims;

    if (modo === "escalar" && alvoTemDims) {
      // Eixos da PEÇA, não do modelo: `dx` se estende ao longo do X da caixa
      // já girada, então a alça vermelha tem de apontar para onde ela cresce.
      const eixoEscala = (
        kind: "sX" | "sY" | "sZ",
        dir: "eastObj" | "northObj" | "upObj",
        css: string,
      ) => {
        const ponta = () => {
          const g = gframeRef.current;
          if (!g) return undefined;
          return Cartesian3.add(
            g.origin,
            Cartesian3.multiplyByScalar(g[dir], alcaL(g), new Cartesian3()),
            new Cartesian3(),
          );
        };
        gizmoRef.current.push(
          v.entities.add({
            id: `gizmo:${kind}:linha`,
            polyline: linhaDaAlca({
              positions: new CallbackProperty(() => {
                const g = gframeRef.current;
                const p = ponta();
                return g && p ? [g.origin, p] : [];
              }, false),
              width: 4,
              material: new ColorMaterialProperty(Color.fromCssColorString(css).withAlpha(0.7)),
            }),
          }),
        );
        gizmoRef.current.push(
          v.entities.add({
            id: `gizmo:${kind}`,
            position: new CallbackPositionProperty(ponta, false),
            /**
             * PONTO, não caixa.
             *
             * A primeira versão usou um cubo — a forma distingue "redimensiona"
             * de "move" à primeira vista. Só que `box` é geometria de verdade e
             * é testada em profundidade: dentro do volume do prédio ela sumia e,
             * pior, deixava de ser clicável. A alça existia e não respondia.
             *
             * `point` aceita `disableDepthTestDistance` e fica sempre por cima —
             * é por isso que as setas de mover usam ponto na ponta. O que
             * diferencia a ferramenta aqui é o miolo branco.
             */
            point: {
              pixelSize: 20,
              color: Color.WHITE,
              outlineColor: Color.fromCssColorString(css),
              outlineWidth: 6,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        );
      };
      eixoEscala("sX", "eastObj", GIZMO_COLOR.tE);
      eixoEscala("sY", "northObj", GIZMO_COLOR.tN);
      if (!alvoAtual?.semEscalaZ) eixoEscala("sZ", "upObj", GIZMO_COLOR.tU);
    }

    if (modo === "escalar" && !alvoTemDims) {
      gizmoRef.current.push(
        v.entities.add({
          id: "gizmo:scale",
          position: new CallbackPositionProperty(() => {
            const g = gframeRef.current;
            if (!g) return undefined;
            const d = Cartesian3.normalize(Cartesian3.add(g.east, g.north, new Cartesian3()), new Cartesian3());
            return Cartesian3.add(g.origin, Cartesian3.multiplyByScalar(d, alcaL(g), new Cartesian3()), new Cartesian3());
          }, false),
          point: {
            pixelSize: 22,
            color: Color.fromCssColorString(GIZMO_COLOR.scale),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
      gizmoRef.current.push(
        v.entities.add({
          id: "gizmo:scale:linha",
          polyline: linhaDaAlca({
            positions: new CallbackProperty(() => {
              const g = gframeRef.current;
              if (!g) return [];
              const d = Cartesian3.normalize(Cartesian3.add(g.east, g.north, new Cartesian3()), new Cartesian3());
              return [
                g.origin,
                Cartesian3.add(g.origin, Cartesian3.multiplyByScalar(d, alcaL(g), new Cartesian3()), new Cartesian3()),
              ];
            }, false),
            width: 4,
            material: new ColorMaterialProperty(Color.fromCssColorString(GIZMO_COLOR.scale).withAlpha(0.6)),
          }),
        }),
      );
    }

    // Ponto na origem — referência comum a todos os modos. Fica âmbar quando o
    // pivô foi reposicionado, para não haver dúvida de que o giro não é pelo
    // centro; a linha tracejada liga o pivô ao centro real do alvo.
    gizmoRef.current.push(
      v.entities.add({
        id: "gizmo:origin",
        position: new CallbackPositionProperty(() => gframeRef.current?.origin, false),
        point: {
          pixelSize: new CallbackProperty(() => (pivotRef.current ? 12 : 9), false),
          color: new CallbackProperty(
            () => (pivotRef.current ? Color.fromCssColorString("#fbbf24") : Color.WHITE),
            false,
          ),
          outlineColor: Color.fromCssColorString("#04141d"),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
    gizmoRef.current.push(
      v.entities.add({
        id: "gizmo:origin:elo",
        polyline: linhaDaAlca({
          positions: new CallbackProperty(() => {
            const g = gframeRef.current;
            if (!g || !pivotRef.current) return [];
            return [g.origemNatural, g.origin];
          }, false),
          width: 2,
          material: new ColorMaterialProperty(Color.fromCssColorString("#fbbf24").withAlpha(0.55)),
        }),
      }),
    );

    requestRender();
  }

  /**
   * Trocar de ferramenta OU de alvo troca as alças em cena.
   *
   * A chave é a identidade do alvo, não o objeto: durante um arraste o
   * `gizmoLocal` é recriado a cada quadro, e reconstruir as entidades a 60 Hz
   * derrubaria o arraste (o Cesium perderia a entidade sob o cursor). As alças
   * leem o frame por CallbackProperty, então acompanhar o movimento não exige
   * reconstruí-las.
   */
  const alvoChave = gizmoLocal ? `local:${gizmoLocal.id}` : gizmoEmpreendimento ? "emp" : "nenhum";
  useEffect(() => {
    // O pivô reposicionado é auxílio de edição, não propriedade do alvo: ao
    // trocar de alvo ele volta ao centro, como no Unreal ao reselecionar.
    pivotRef.current = null;
    clearGizmo();
    refreshGizmo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gizmoModo, alvoChave, gizmoLocal?.somenteMover, gizmoLocal?.somenteZ]);

  // Alvo se moveu (arraste ou campo do inspetor): só reposiciona o frame.
  useEffect(() => {
    updateGframe();
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gizmoLocal]);

  /* =========================================================================
     RECONSTRUÍDO

     Este bloco foi reescrito depois de um acidente de edição em massa que
     apagou ~1.100 linhas do arquivo, num projeto sem versionamento. O
     comportamento segue os contratos que sobreviveram (o handle imperativo, o
     efeito de init e as funções de desenho), mas os detalhes de calibração
     fina podem diferir do original.
     ========================================================================= */

  // --- Identificação do que foi clicado ---------------------------------------

  /**
   * Id de entidade a partir de um objeto pickado, SEM `instanceof Entity`.
   *
   * Quando o Cesium entra por mais de um caminho (o pré-bundle do Vite é um),
   * existem duas classes `Entity` distintas e o `instanceof` devolve false para
   * um objeto perfeitamente válido — era por isso que clicar numa caixa do
   * espelho 3D não selecionava a unidade.
   */
  function idDaEntidade(picked: unknown): string | undefined {
    const p = picked as { id?: unknown } | undefined;
    const alvo = p?.id as { id?: unknown } | undefined;
    if (alvo && typeof alvo.id === "string") return alvo.id;
    if (typeof p?.id === "string") return p.id as string;
    return undefined;
  }

  /** Empreendimento dono do que foi clicado (marcador, volume ou modelo). */
  function resolveBuildingId(picked: unknown): string | undefined {
    const eid = idDaEntidade(picked);
    const m = eid ? /^(?:marker|box):(.+)$/.exec(eid) : null;
    if (m) return m[1];
    const prim = (picked as { primitive?: { id?: unknown } } | undefined)?.primitive;
    if (typeof prim?.id === "string") {
      const mm = /^model:(.+)$/.exec(prim.id);
      if (mm) return mm[1];
    }
    return undefined;
  }

  /**
   * Ponto do mundo sob o cursor, em cascata.
   *
   * Sem globo (a cena usa `globe: false`), não há uma superfície única a
   * consultar: o chão é a fotogrametria, que é geometria como qualquer outra.
   * Daí as quatro tentativas, da mais exata para a mais grosseira.
   */
  function pickGround(position: Cartesian2): Cartesian3 | undefined {
    const v = viewerRef.current;
    if (!v) return undefined;
    const scene = v.scene;

    // 1) Buffer de profundidade — o mais exato quando existe.
    if (scene.pickPositionSupported) {
      const p = scene.pickPosition(position);
      if (p && Number.isFinite(p.x)) return p;
    }

    const ray = v.camera.getPickRay(position);
    if (!ray) return undefined;

    // 2) Raio contra a geometria carregada (fotogrametria e modelo).
    //    `pickFromRay` existe em runtime, mas está fora dos typings públicos.
    const s = scene as unknown as {
      pickFromRay?: (r: typeof ray, exclude: unknown[]) => { position?: Cartesian3 } | undefined;
    };
    try {
      const doRaio = s.pickFromRay?.(ray, [])?.position;
      if (doRaio) return doRaio;
    } catch {
      /* tile ainda não carregado nessa direção */
    }

    // 3) Globo — só existe se o viewer tiver sido criado com globo.
    const globo = scene.globe as
      | { pick?: (r: typeof ray, sc: unknown) => Cartesian3 | undefined }
      | undefined;
    const g = globo?.pick?.(ray, scene);
    if (g) return g;

    // 4) Elipsoide: último recurso. Devolve o ponto ao nível do mar, o que
    //    basta — de todo modo só usamos a latitude e a longitude do clique.
    return v.camera.pickEllipsoid(position, Ellipsoid.WGS84) ?? undefined;
  }

  /**
   * Qual unidade está REALMENTE sob o cursor.
   *
   * `scene.pick` devolve a primeira que o renderizador entrega, e as caixas do
   * espelho são translúcidas: geometria translúcida não escreve no buffer de
   * profundidade, então a "primeira" é a que calhou de vir antes na ordem de
   * desenho, não a que está na frente no espaço. Com dezenas de caixas
   * sobrepostas — que é o caso normal de uma torre fatiada — clicar numa
   * selecionava outra, e o erro mudava conforme o ângulo da câmera.
   *
   * `drillPick` traz TODAS as candidatas sob o pixel; entre elas, a mais perto
   * da câmera é a que o usuário quis clicar.
   */
  function unidadeSobOCursor(position: Cartesian2): string | undefined {
    const v = viewerRef.current;
    if (!v) return undefined;
    let melhor: string | undefined;
    let menor = Infinity;
    try {
      // Isto roda somente no clique, não durante o movimento do mouse. Um teto
      // maior evita perder a unidade quando fachada, contorno, gizmos e várias
      // caixas translúcidas ocupam o mesmo pixel.
      for (const p of v.scene.drillPick(position, 64)) {
        const id = idDaEntidade(p);
        const unitId = id?.startsWith("unit-selection:")
          ? id.slice("unit-selection:".length)
          : unidadeDoEntityId(id);
        if (!unitId) continue;
        // Mede sempre pelo centro da caixa-base. O contorno é 1,5% maior e,
        // se ganhasse prioridade automática, a unidade já selecionada ficaria
        // "grudenta" e impediria clicar numa vizinha sobreposta.
        const pos = centroDaUnidade(unitId);
        if (!pos) continue;
        const d = Cartesian3.distance(v.camera.positionWC, pos);
        if (d < menor) { menor = d; melhor = unitId; }
      }
    } catch {
      /* drillPick pode falhar em contexto degradado: cai no pick simples */
    }
    return melhor;
  }

  function onClick(position: Cartesian2) {
    const v = viewerRef.current;
    if (!v) return;
    // Se acabou de arrastar um gizmo, ignora este clique (não seleciona/move).
    if (gizmoDraggedRef.current) { gizmoDraggedRef.current = false; return; }

    /**
     * Com um posicionamento em curso o clique SEMPRE posiciona. Isto precisa
     * ser decidido antes de tudo: marcadores de POI e caixas de unidade são
     * desenhados com `disableDepthTestDistance: Infinity`, ou seja, estão
     * sempre por cima e capturariam o clique destinado ao terreno.
     */
    const colocando = !!(editRef.current && placementRef.current && selectedRef.current);
    const picked = colocando ? undefined : v.scene.pick(position);

    if (!colocando) {
      const eid = idDaEntidade(picked);

      // Clique num gizmo (sem arraste): não faz nada aqui.
      if (eid?.startsWith("gizmo:")) return;

      // POI explicitamente por cima da cena mantém prioridade sobre as caixas.
      if (eid?.startsWith("poi:")) {
        const ge = (picked as {
          id?: { position?: { getValue: (t: unknown) => Cartesian3 | undefined } };
        }).id;
        const pos = ge?.position?.getValue(v.clock.currentTime);
        if (pos) {
          const carto = Cartographic.fromCartesian(pos);
          flyToPoi(CesiumMath.toDegrees(carto.latitude), CesiumMath.toDegrees(carto.longitude));
        }
        return;
      }

      // Clique numa unidade do espelho 3D.
      // Não depende do primeiro `scene.pick`: a fachada opaca frequentemente
      // vem antes da caixa translúcida e fazia o clique não produzir nada.
      const unidadeDireta = unidadeDoEntityId(eid);
      const unidade = unidadeSobOCursor(position) ?? unidadeDireta;
      if (unidade) {
        onSelectUnitRef.current?.(unidade, {
          ...modRef.current,
        });
        return;
      }

      const id = resolveBuildingId(picked);
      if (id) {
        onSelectRef.current?.(id);
        return;
      }
    }

    // Modo edição: clique no terreno reposiciona o que estiver sendo colocado.
    if (editRef.current && selectedRef.current && onEditPlaceRef.current) {
      const world = pickGround(position);
      if (!world) return;
      const carto = Cartographic.fromCartesian(world);
      onEditPlaceRef.current(
        selectedRef.current,
        CesiumMath.toDegrees(carto.latitude),
        CesiumMath.toDegrees(carto.longitude),
      );
    }
  }

  // --- Sol ---------------------------------------------------------------------

  /**
   * Fixa o relógio da cena no instante solar e ajusta a luz.
   *
   * O relógio NÃO anda (`shouldAnimate = false`): a hora é escolhida pelo
   * visitante na barra solar, não pela passagem do tempo real. É esse relógio
   * que a `SunLight` do Cesium usa, então as sombras saem corretas de graça.
   */
  function applySun() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    v.clock.shouldAnimate = false;
    v.clock.currentTime = JulianDate.fromDate(solarUtc);

    // `daylight` vai de 0 (sol 6° abaixo do horizonte) a 1 (12° acima): é a
    // faixa em que a cena passa de noite para dia cheio.
    const daylight = Math.max(0, Math.min(1, (solarAltitude + 6) / 18));
    /**
     * Sem cidade, sem gradação noturna.
     *
     * O passe existe para corrigir a fotogrametria do Google, que traz a luz
     * de meio-dia ASSADA na textura e continua parecendo dia por mais que se
     * apague a luz da cena. No modo estúdio essa textura não está lá: o que
     * sobra é o GLB, iluminado pelo sol de verdade. Aplicar o grade nele só o
     * escurece e o tinge de azul sem motivo — e a noite ali se faz com o
     * FUNDO, não recolorindo o produto.
     */
    nightAmountRef.current = !cidadeRef.current
      ? 0
      : (noturnoRef.current ? 1 : 1 - daylight);

    /**
     * Gradação noturna, em pós-processamento.
     *
     * Baixar a luz não basta: a fotogrametria do Google traz a ILUMINAÇÃO
     * ASSADA na textura — foi fotografada de dia e continua parecendo meio-dia
     * por mais que se apague a luz da cena. Nenhuma luz dinâmica apaga isso.
     * Este passe corrige a imagem final: dessatura para um azul frio, escurece,
     * e preserva só os realces altos, que é o que faz o céu e o chão lerem como
     * noite.
     *
     * A tinta era (0.55, 0.68, 0.95) — azul no papel, cinza na tela: com o
     * vermelho a 58% do azul, o que sobrava era ardósia neutra e a cena lia
     * como "foto sem luz", não como noite. Três coisas mudaram:
     *
     * 1. tinta bem mais fria (0.34, 0.52, 1.00), que é a direção para onde a
     *    visão escotópica já puxa o que se enxerga sob a lua;
     * 2. piso azul-marinho nas sombras — noite de verdade não tem preto
     *    neutro, tem céu refletido no que está escuro, e é esse pé levantado
     *    que separa o azulado do apagado;
     * 3. escurecimento de 0.32 para 0.40, compensando o brilho que a tinta
     *    mais saturada tira. A cena fica igualmente escura, e azul.
     */
    if (!nightStageRef.current) {
      const stage = new PostProcessStage({
        fragmentShader: `
          uniform sampler2D colorTexture;
          uniform float nightAmount;
          in vec2 v_textureCoordinates;
          void main() {
            vec4 source = texture(colorTexture, v_textureCoordinates);
            float luma = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));

            // Luar: azul frio a partir da luminância.
            vec3 luar = vec3(luma) * vec3(0.34, 0.52, 1.0);
            luar *= mix(1.0, 0.40, nightAmount);

            // Pé azul nas sombras, mais forte quanto mais escuro o pixel.
            vec3 penumbra = vec3(0.020, 0.043, 0.094);
            luar += penumbra * nightAmount * (1.0 - smoothstep(0.0, 0.55, luma));

            /**
             * Devolve a COR do que é muito colorido.
             *
             * Colapsar tudo na luminância apagava o espelho de vendas junto com
             * a cidade: as caixas de disponível/reservada/vendida viravam o
             * mesmo azul da fachada atrás delas, e o verde e o vermelho — que
             * são informação, não cenário — sumiam da cena inteira.
             *
             * A separação é o próprio croma do pixel. Fotogrametria é concreto,
             * asfalto e telha: croma baixo, e continua indo a azul. Um material
             * de status é croma alto e quase nenhuma superfície fotografada
             * chega perto — então basta reinjetar o desvio da luminância na
             * medida em que o pixel é saturado.
             */
            float mx = max(source.r, max(source.g, source.b));
            float mn = min(source.r, min(source.g, source.b));
            float croma = mx > 0.001 ? (mx - mn) / mx : 0.0;
            vec3 cor = (source.rgb - vec3(luma)) * mix(0.10, 0.62, smoothstep(0.25, 0.7, croma));
            luar += cor;

            // Só o topo da faixa de luminância sobrevive como realce: é o que
            // deixa poste, janela acesa e reflexo aparecerem sem clarear tudo.
            // Continua quente, e agora contra um fundo azul ele finalmente
            // lê como luz acesa em vez de mancha clara.
            float highlight = smoothstep(0.72, 1.0, luma) * nightAmount * 0.14;
            vec3 graded = mix(source.rgb, luar, nightAmount)
                        + vec3(highlight, highlight * 0.86, highlight * 0.72);
            out_FragColor = vec4(max(graded, vec3(0.0)), source.a);
          }
        `,
        uniforms: { nightAmount: () => nightAmountRef.current },
      });
      v.scene.postProcessStages.add(stage);
      nightStageRef.current = stage;
    }
    // Desligado de dia: um passe de tela cheia à toa custa caro no celular.
    nightStageRef.current.enabled = nightAmountRef.current > 0.015;
    v.scene.light.intensity = noturnoRef.current ? 0.2 : 0.25 + daylight * 1.75;
    aplicarAparenciaModelo();
    requestRender();
  }

  // --- Reconciliação dos empreendimentos ---------------------------------------

  function reconcile() {
    const v = viewerRef.current;
    if (!v || !readyRef.current) return;
    const seen = new Set<string>();

    for (const b of buildingsRef.current) {
      seen.add(b.id);
      let node = nodesRef.current.get(b.id);
      if (!node) {
        node = { groundHeight: FALLBACK_GROUND_HEIGHT };
        nodesRef.current.set(b.id, node);
      }

      upsertMarker(b, node);
      if (b.modelUrl) {
        if (node.box) {
          v.entities.remove(node.box);
          node.box = undefined;
        }
        // `loadingUrl` impede o segundo download do mesmo arquivo enquanto o
        // primeiro está em voo — ver o campo em `BuildingNode`.
        if (node.loadedUrl !== b.modelUrl && node.loadingUrl !== b.modelUrl) {
          if (node.model) {
            v.scene.primitives.remove(node.model);
            node.model = undefined;
          }
          void loadModel(b, node);
        } else if (node.loadedUrl === b.modelUrl) {
          updateModelTransform(b, node);
        }
      } else {
        upsertPlaceholder(b, node);
      }
    }

    // Remove nós de empreendimentos que saíram (não deve ocorrer, mas seguro).
    Array.from(nodesRef.current.entries()).forEach(([id, node]) => {
      if (seen.has(id)) return;
      if (node.model) v.scene.primitives.remove(node.model);
      if (node.box) v.entities.remove(node.box);
      if (node.marker) v.entities.remove(node.marker);
      nodesRef.current.delete(id);
    });
    requestRender();
  }

  // --- Pontos de interesse ------------------------------------------------------

  function clearPoiMarkers() {
    const v = viewerRef.current;
    if (v) poiMarkersRef.current.forEach((m) => v.entities.remove(m));
    poiMarkersRef.current = [];
  }

  function showPoiMarkers(b: Building3D) {
    const v = viewerRef.current;
    if (!v) return;
    clearPoiMarkers();
    const estiloPoi = b.empreendimento.estiloCategoriaPoi;
    (b.empreendimento.pontosDeInteresse ?? []).forEach((poi, i) => {
      const color = Color.fromCssColorString(corDaCategoriaPoi(poi.categoria, estiloPoi));
      /**
       * Id pelo ÍNDICE, não pelo nome. Dois pontos podem ter o mesmo nome — e
       * nascem todos como "Novo ponto" —, o que fazia o Cesium recusar a
       * segunda entidade com "already exists in this collection".
       */
      const eid = `poi:${b.id}:${i}`;
      if (v.entities.getById(eid)) v.entities.removeById(eid);
      poiMarkersRef.current.push(
        v.entities.add({
          id: eid,
          /**
           * Altura ZERO + `RELATIVE_TO_3D_TILE`: o Cesium gruda o marcador na
           * fotogrametria SOB ELE, 4 m acima da superfície.
           *
           * Antes todos usavam a altura do terreno amostrada sob o PRÉDIO — um
           * ponto a dois quilômetros, numa cota diferente, ficava enterrado ou
           * pendurado no ar. Como o marcador é desenhado por cima de tudo
           * (`disableDepthTestDistance`), o erro de altura não o escondia:
           * aparecia como paralaxe, o pino deslizando sobre o chão a cada
           * movimento da câmera. Era o "ficam vagando".
           */
          position: Cartesian3.fromDegrees(poi.lng, poi.lat, 4),
          point: {
            pixelSize: 10,
            color,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            heightReference: HeightReference.RELATIVE_TO_3D_TILE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: poi.name,
            font: "600 13px Montserrat, sans-serif",
            fillColor: Color.WHITE,
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Color.fromCssColorString("#0a0c12"),
            outlineWidth: 3,
            showBackground: true,
            backgroundColor: Color.fromCssColorString("#0a0c12").withAlpha(0.9),
            backgroundPadding: new Cartesian2(8, 5),
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -12),
            // Mesmo ancoramento do ponto: sem isto a etiqueta ficaria na cota
            // antiga e se descolaria do pino que ela nomeia.
            heightReference: HeightReference.RELATIVE_TO_3D_TILE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Encolhe pouco ao afastar (nunca some) e só some muito longe.
            scaleByDistance: new NearFarScalar(400, 1.0, 4000, 0.75),
            translucencyByDistance: new NearFarScalar(7000, 1.0, 12000, 0.0),
          },
        }),
      );
    });
    requestRender();
  }

  // --- Câmeras ------------------------------------------------------------------

  function flyToCamera(cam: CameraView, duration = 1.5) {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    soltarOrbita();
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(cam.lng, cam.lat, cam.height),
      orientation: {
        heading: CesiumMath.toRadians(cam.heading),
        pitch: CesiumMath.toRadians(cam.pitch),
        roll: CesiumMath.toRadians(cam.roll),
      },
      duration,
    });
  }

  /**
   * Voa até um ponto de interesse.
   *
   * `cam` é o enquadramento gravado no editor para AQUELE ponto — e ele é
   * absoluto (lng/lat/altura/azimute), não relativo ao alvo. Isso o torna
   * frágil: um ponto movido de lugar depois, um enquadramento salvo com a
   * câmera em outro canto, um projeto duplicado — em qualquer desses casos a
   * coordenada gravada não descreve mais o ponto, e clicar leva o visitante
   * para longe do que ele pediu.
   *
   * A regra é a mesma que o prédio já usava em `cameraAindaServe`: enquadramento
   * salvo tem prioridade ENQUANTO for plausível. Longe demais do alvo, ele é
   * descartado em favor do enquadramento genérico, que é calculado a partir do
   * próprio ponto e por isso nunca erra o destino.
   */
  function flyToPoi(lat: number, lng: number, cam?: CameraView) {
    const v = viewerRef.current;
    if (!v) return;

    if (cam) {
      const distancia = Cartesian3.distance(
        Cartesian3.fromDegrees(cam.lng, cam.lat),
        Cartesian3.fromDegrees(lng, lat),
      );
      // 800 m: um enquadramento de POI é de aproximação; acima disso ele não
      // está mostrando o ponto, está mostrando outra coisa.
      if (Number.isFinite(distancia) && distancia < 800) {
        flyToCamera(cam, 1.6);
        return;
      }
    }
    const id = selectedRef.current;
    const gh = (id ? nodesRef.current.get(id)?.groundHeight : undefined) ?? FALLBACK_GROUND_HEIGHT;
    // `flyToBoundingSphere` centraliza o ponto de forma confiável, o que
    // `flyTo` com destino puro não faz quando o pitch é oblíquo.
    soltarOrbita();
    v.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(lng, lat, gh + 5), 50), {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), 260),
      duration: 1.4,
    });
  }

  /** Esfera que envolve o prédio — a medida real quando o GLB já carregou. */
  function esferaDoPredio(b: Building3D): BoundingSphere | undefined {
    const node = nodesRef.current.get(b.id);
    const gh = node?.groundHeight ?? FALLBACK_GROUND_HEIGHT;
    const caixa = b.modelUrl ? caixaGlbRef.current.get(b.modelUrl) : null;
    if (caixa) {
      const cx = (caixa.min[0] + caixa.max[0]) / 2;
      const cy = (caixa.min[1] + caixa.max[1]) / 2;
      const cz = (caixa.min[2] + caixa.max[2]) / 2;
      const dx = caixa.max[0] - caixa.min[0];
      const dy = caixa.max[1] - caixa.min[1];
      const dz = caixa.max[2] - caixa.min[2];
      const raio = Math.hypot(dx, dy, dz) * Math.abs(b.scale) / 2;
      if (Number.isFinite(raio) && raio >= 1 && raio < 2000) {
        return new BoundingSphere(poseNoModelo(b, gh, cx, cy, cz, 0).position, raio);
      }
    }
    // Alguns GLBs declaram bounding spheres em referencial/escala incorretos.
    // Só a aceita quando é plausível e continua perto da âncora do projeto.
    // `ready` antes de tocar em `boundingSphere`: o getter lança enquanto o GLB
    // não carregou, e o `?.` não protege contra getter que lança.
    if (node?.model?.ready) {
      const esfera = node.model.boundingSphere;
      const ancora = poseNoModelo(b, gh, 0, 0, 0, 0).position;
      if (Number.isFinite(esfera.radius) && esfera.radius >= 1 && esfera.radius < 2000
        && Cartesian3.distance(esfera.center, ancora) < 3000) {
        return esfera;
      }
    }
    const ph = b.placeholder;
    if (!ph) return undefined;
    const centro = Cartesian3.fromDegrees(b.lng, b.lat, gh + b.heightOffset + (ph.height * b.scale) / 2);
    const raio = (Math.max(ph.width, ph.depth, ph.height) * Math.abs(b.scale)) / 2;
    return new BoundingSphere(centro, Math.min(500, Math.max(10, raio)));
  }

  /** Enquadramento de reserva quando não há câmera salva nem esfera medida. */
  function defaultCameraFor(b: Building3D): CameraView {
    const gh = nodesRef.current.get(b.id)?.groundHeight ?? FALLBACK_GROUND_HEIGHT;
    const alcance = Math.min(
      1200,
      Math.max(180, (b.placeholder?.height ?? 90) * Math.abs(b.scale) * 3),
    );
    return {
      lng: b.lng,
      lat: b.lat - 0.0016,
      height: gh + alcance,
      heading: 20,
      pitch: -32,
      roll: 0,
    };
  }

  /**
   * A câmera salva ainda aponta para este empreendimento?
   *
   * `config.camera` guarda lat/lng ABSOLUTOS. Um projeto criado a partir de
   * outro (o seed do piloto é o caminho normal) herda a câmera junto, e mudar a
   * coordenada do prédio não a move: a cena abria voando para o endereço
   * antigo, a centenas de quilômetros do modelo. O limite é generoso — 5 km é
   * muito mais do que qualquer enquadramento legítimo.
   */
  function cameraAindaServe(b: Building3D, cam: CameraView): boolean {
    const d = Cartesian3.distance(
      Cartesian3.fromDegrees(cam.lng, cam.lat),
      Cartesian3.fromDegrees(b.lng, b.lat),
    );
    return Number.isFinite(d) && d < 5000;
  }

  /**
   * Prende a câmera ao empreendimento: arrastar ORBITA, roda aproxima.
   *
   * `lookAt` amarra a câmera a um referencial centrado no alvo; enquanto ele
   * vale, os controles padrão do Cesium passam a girar em torno desse ponto em
   * vez de girar a Terra. É a diferença entre navegar um planeta e examinar uma
   * maquete — e a vitrine é uma maquete.
   *
   * Preserva o ângulo e a distância atuais, para ligar a órbita não dar um
   * salto de câmera.
   */
  function aplicarOrbita() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed() || !orbitarRef.current) return;
    const b = buildingsRef.current.find((x) => x.id === selectedRef.current)
      ?? buildingsRef.current[0];
    if (!b) return;
    // Sem esfera o GLB ainda não foi medido; o `moveEnd` tenta de novo depois.
    const esfera = esferaDoPredio(b);
    if (!esfera) return;
    /**
     * `lookAtTransform` SEM deslocamento, nunca `lookAt`.
     *
     * `lookAt(alvo, offset)` MOVE a câmera para `alvo + offset` — e era isso
     * que teleportava a cena: escolhida uma unidade ou um pavimento, o voo
     * pousava lá, o `moveEnd` disparava, e a órbita reposicionava a câmera no
     * centro do prédio um segundo depois. O usuário via a câmera fugir sozinha
     * do que ele acabou de abrir.
     *
     * `lookAtTransform(matriz)` só troca o REFERENCIAL: a câmera fica
     * exatamente onde está, e o arraste passa a girar em torno da origem desse
     * referencial. É o que se quer — orbitar sem mexer no enquadramento.
     */
    v.camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(esfera.center));


    requestRender();
  }

  /**
   * Solta o referencial da órbita.
   *
   * Obrigatório antes de qualquer voo: com o `lookAt` ativo, `flyTo` e
   * `setView` passam a interpretar as coordenadas NO REFERENCIAL DO ALVO, e o
   * destino sai completamente errado.
   */
  function soltarOrbita() {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    v.camera.lookAtTransform(Matrix4.IDENTITY);
  }

  /**
   * O prédio está visível e a uma distância de leitura?
   *
   * Duas condições, e as duas importam: dentro do tronco de visão (senão está
   * fora da tela) E a menos de seis raios da esfera dele (senão está na tela,
   * mas do tamanho de um grão). Só quando as duas valem é que o enquadramento
   * atual serve e o voo pode ser dispensado.
   */
  function predioEnquadrado(): boolean {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return false;
    const b = buildingsRef.current.find((x) => x.id === selectedRef.current)
      ?? buildingsRef.current[0];
    if (!b) return false;
    const esfera = esferaDoPredio(b);
    if (!esfera) return false;
    const cam = v.camera;
    const visivel = cam.frustum
      .computeCullingVolume(cam.positionWC, cam.directionWC, cam.upWC)
      .computeVisibility(esfera) !== Intersect.OUTSIDE;
    const perto = Cartesian3.distance(cam.positionWC, esfera.center) < esfera.radius * 6;
    return visivel && perto;
  }

  function flyToBuilding(b: Building3D) {
    if (b.camera && cameraAindaServe(b, b.camera)) return flyToCamera(b.camera, 1.6);
    const v = viewerRef.current;
    const esfera = esferaDoPredio(b);
    if (v && esfera) {
      // Enquadra o volume real: serve para uma torre de 30 m e para uma
      // fachada de 300 m sem número mágico nenhum.
      // 1,9× o raio enquadra a esfera inteira com uma folga discreta. Estava em
      // 2,8×, que sobrava tanto espaço em volta que o prédio virava um detalhe
      // no meio do bairro.
      soltarOrbita();
      v.camera.flyToBoundingSphere(esfera, {
        duration: 1.6,
        offset: new HeadingPitchRange(
          CesiumMath.toRadians(20),
          CesiumMath.toRadians(-32),
          esfera.radius * 1.9,
        ),
      });
      return;
    }
    flyToCamera(defaultCameraFor(b), 1.6);
  }

  function flyHome() {
    const v = viewerRef.current;
    if (!v) return;
    const bs = buildingsRef.current;
    if (!bs.length) return;
    const n = bs.length;
    const lat = bs.reduce((s, b) => s + b.lat, 0) / n;
    const lng = bs.reduce((s, b) => s + b.lng, 0) / n;
    // Altura moderada, não a cidade toda: um overview muito alto carrega
    // poucos tiles e a fotogrametria aparece preta.
    soltarOrbita();
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(lng, lat - 0.012, 2800),
      orientation: {
        heading: 0,
        pitch: CesiumMath.toRadians(-42),
        roll: 0,
      },
      duration: 2,
    });
  }

  // --- Matemática do arraste ----------------------------------------------------

  /** Ponto mais próximo (escalar) na reta do eixo em relação ao raio da câmera. */
  function scalarOnAxis(
    ray: { origin: Cartesian3; direction: Cartesian3 },
    o: Cartesian3,
    d: Cartesian3,
  ): number {
    const w0 = Cartesian3.subtract(ray.origin, o, new Cartesian3());
    const b = Cartesian3.dot(ray.direction, d);
    const den = 1 - b * b;
    // Raio quase paralelo ao eixo: a projeção explode. Devolver 0 congela o
    // arraste nesse quadro, que é melhor do que o alvo saltar para o infinito.
    if (Math.abs(den) < 1e-6) return 0;
    const c = Cartesian3.dot(ray.direction, w0);
    const f = Cartesian3.dot(d, w0);
    // t = (f − b·c) / (1 − b²), a forma padrão do ponto mais próximo entre duas
    // retas com direções unitárias. Escrita com os termos trocados, ela devolve
    // o NEGATIVO — e era isso que fazia todas as setas puxarem ao contrário.
    return (f - b * c) / den;
  }

  function viaPivotDown(pos: Cartesian2): boolean {
    const v = viewerRef.current;
    if (!v || !editRef.current || !onViaPerfilRef.current) return false;
    const pid = idDaEntidade(v.scene.pick(pos));
    const m = pid ? /^via-pivot:(.*):(\d+):(e|d)$/.exec(pid) : null;
    if (!m) return false;
    const via = viasAtualRef.current.find((x) => x.id === m[1]);
    const index = Number(m[2]);
    const lado = m[3] as "e" | "d";
    if (!via?.perfil || index < 0 || index >= via.perfil.length) return false;
    const alturas = via.perfil.map(alturasDaSecao);
    if (alturas.some((h) => !h)) return false;
    const h = alturas[index]!;
    const { esquerda, direita } = bordasEfetivas(via.perfil, via.largura);
    const geo = lado === "e" ? esquerda[index] : direita[index];
    if (!geo) return false;
    const startHeight = lado === "e" ? h.esquerda : h.direita;
    const axisO = Cartesian3.fromDegrees(geo.lng, geo.lat, startHeight + 0.14);
    const axisD = Ellipsoid.WGS84.geodeticSurfaceNormal(axisO, new Cartesian3());
    const ray = v.camera.getPickRay(pos);
    if (!ray) return false;
    const perfil = via.perfil.map((p, i) => {
      const hi = alturas[i]!;
      return { ...p, cota: undefined, alturaEsq: hi.esquerda, alturaDir: hi.direita };
    });
    // Shift escolhe o plano do chão; sem ele, a altura — o gesto que já existia
    // continua sendo o padrão, para não trocar a mão de quem já ajustou cotas.
    const modo: "altura" | "plano" = modRef.current.shift ? "plano" : "altura";
    viaDragRef.current = {
      viaId: via.id,
      index,
      lado,
      modo,
      axisO,
      axisD,
      startScalar: modo === "altura" ? scalarOnAxis(ray, axisO, axisD) : 0,
      startHeight,
      startNoPlano: modo === "plano"
        ? rayGroundPoint(ray, axisO, axisD)
        : undefined,
      perfil,
      lastEmit: 0,
    };
    // Sem um ponto no plano não há de onde medir o deslocamento: o raio está
    // rasante ao chão. Cair para a altura é melhor do que um arraste morto.
    if (modo === "plano" && !viaDragRef.current.startNoPlano) {
      viaDragRef.current.modo = "altura";
      viaDragRef.current.startScalar = scalarOnAxis(ray, axisO, axisD);
    }
    return true;
  }

  function viaPivotMove(pos: Cartesian2, force = false) {
    const v = viewerRef.current;
    const drag = viaDragRef.current;
    if (!v || !drag) return;
    const agora = performance.now();
    // Cada emissão reconstrói os pequenos quads da via. Limitar a 20 fps
    // mantém o arraste responsivo sem transformar um mouse de 120 Hz em uma
    // tempestade de entidades e renders do React.
    if (!force && agora - drag.lastEmit < 50) return;
    const ray = v.camera.getPickRay(pos);
    if (!ray) return;
    drag.lastEmit = agora;
    const ladoNome = drag.lado === "e" ? "esquerda" : "direita";

    if (drag.modo === "plano") {
      const ponto = rayGroundPoint(ray, drag.axisO, drag.axisD);
      if (!ponto || !drag.startNoPlano) return;
      // O deslocamento é medido do ponto agarrado, não do centro do pivô: assim
      // a bolinha não salta para debaixo do cursor no primeiro pixel de arraste.
      const delta = Cartesian3.subtract(ponto, drag.startNoPlano, new Cartesian3());
      const destino = Cartesian3.add(drag.axisO, delta, new Cartesian3());
      const carto = Cartographic.fromCartesian(destino);
      if (!carto) return;
      const borda: PontoGeo = {
        lat: CesiumMath.toDegrees(carto.latitude),
        lng: CesiumMath.toDegrees(carto.longitude),
      };
      const perfil = drag.perfil.map((p, i) => i !== drag.index ? p : {
        ...p,
        ...(drag.lado === "e" ? { bordaEsq: borda } : { bordaDir: borda }),
      });
      onViaPerfilRef.current?.(drag.viaId, perfil);
      onGizmoInfoRef.current?.(
        `Via · seção ${drag.index + 1} · ${ladoNome}: movendo no plano `
        + `(${Cartesian3.magnitude(delta).toFixed(2)} m)`,
      );
      return;
    }

    const atual = scalarOnAxis(ray, drag.axisO, drag.axisD);
    const altura = Math.round((drag.startHeight + atual - drag.startScalar) * 100) / 100;
    const perfil = drag.perfil.map((p, i) => i !== drag.index ? p : {
      ...p,
      ...(drag.lado === "e" ? { alturaEsq: altura } : { alturaDir: altura }),
    });
    onViaPerfilRef.current?.(drag.viaId, perfil);
    onGizmoInfoRef.current?.(
      `Via · seção ${drag.index + 1} · ${ladoNome}: ${altura.toFixed(2)} m `
      + `· Shift arrasta no plano`,
    );
  }

  /**
   * Pivô de superfície. Espelha o da via de propósito, em vez de generalizar as
   * duas: o pivô da via carrega lado esquerdo/direito e perfil de seção, coisas
   * que uma área não tem. Uma função só ficaria cheia de ramos por tipo.
   */
  function areaPivotDown(pos: Cartesian2): boolean {
    const v = viewerRef.current;
    if (!v || !editRef.current || !onAreaPontosRef.current) return false;
    const pid = idDaEntidade(v.scene.pick(pos));
    const m = pid ? /^area-pivot:(.*):(\d+)$/.exec(pid) : null;
    if (!m) return false;
    const area = areasAtualRef.current.find((x) => x.id === m[1]);
    const index = Number(m[2]);
    if (!area || index < 0 || index >= area.pontos.length) return false;
    const alturas = alturasDaArea(area.pontos);
    if (!alturas) return false;
    const p = area.pontos[index];
    const startHeight = alturas[index];
    const axisO = Cartesian3.fromDegrees(p.lng, p.lat, startHeight + 0.14);
    const axisD = Ellipsoid.WGS84.geodeticSurfaceNormal(axisO, new Cartesian3());
    const ray = v.camera.getPickRay(pos);
    if (!ray) return false;
    const modo: "altura" | "plano" = modRef.current.shift ? "plano" : "altura";
    const noPlano = modo === "plano" ? rayGroundPoint(ray, axisO, axisD) : undefined;
    areaDragRef.current = {
      areaId: area.id,
      index,
      modo: modo === "plano" && !noPlano ? "altura" : modo,
      axisO,
      axisD,
      startScalar: scalarOnAxis(ray, axisO, axisD),
      startHeight,
      startNoPlano: noPlano,
      pontos: area.pontos.map((q, i) => ({ ...q, altura: alturas[i] })),
      lastEmit: 0,
    };
    return true;
  }

  function areaPivotMove(pos: Cartesian2, force = false) {
    const v = viewerRef.current;
    const drag = areaDragRef.current;
    if (!v || !drag) return;
    const agora = performance.now();
    if (!force && agora - drag.lastEmit < 50) return;
    const ray = v.camera.getPickRay(pos);
    if (!ray) return;
    drag.lastEmit = agora;

    if (drag.modo === "plano") {
      const ponto = rayGroundPoint(ray, drag.axisO, drag.axisD);
      if (!ponto || !drag.startNoPlano) return;
      const delta = Cartesian3.subtract(ponto, drag.startNoPlano, new Cartesian3());
      const destino = Cartesian3.add(drag.axisO, delta, new Cartesian3());
      const carto = Cartographic.fromCartesian(destino);
      if (!carto) return;
      const pontos = drag.pontos.map((q, i) => i !== drag.index ? q : {
        ...q,
        lat: CesiumMath.toDegrees(carto.latitude),
        lng: CesiumMath.toDegrees(carto.longitude),
      });
      onAreaPontosRef.current?.(drag.areaId, pontos);
      onGizmoInfoRef.current?.(
        `Área · vértice ${drag.index + 1}: movendo no plano `
        + `(${Cartesian3.magnitude(delta).toFixed(2)} m)`,
      );
      return;
    }

    const atual = scalarOnAxis(ray, drag.axisO, drag.axisD);
    const altura = Math.round((drag.startHeight + atual - drag.startScalar) * 100) / 100;
    const pontos = drag.pontos.map((q, i) => i !== drag.index ? q : { ...q, altura });
    onAreaPontosRef.current?.(drag.areaId, pontos);
    onGizmoInfoRef.current?.(
      `Área · vértice ${drag.index + 1}: ${altura.toFixed(2)} m · Shift arrasta no plano`,
    );
  }

  function areaPivotUp() {
    areaDragRef.current = null;
    onGizmoInfoRef.current?.(null);
    // Devolve os pivôs, escondidos durante o arraste. Soltar o botão não muda
    // prop nenhuma, então nenhum efeito dispara sozinho.
    syncSuperficies();
  }

  /**
   * Agarra um vértice do contorno — ou insere um novo, se o alvo for um "+".
   *
   * O arraste é sempre no PLANO do piso da unidade. Contorno de planta não tem
   * altura: quem sobe e desce a unidade é o pivô dela, e misturar as duas coisas
   * num gesto só faria o desenho sair do chão sem querer.
   */
  function plantaPivotDown(pos: Cartesian2): boolean {
    const v = viewerRef.current;
    if (!v || !editRef.current || !onUnidadePlantaRef.current) return false;
    const pid = idDaEntidade(v.scene.pick(pos));
    const m = pid ? /^unid-(vert-topo|vert|meio):(.*):(\d+)$/.exec(pid) : null;
    if (!m) return false;
    const [, tipo, unidadeId, idxTxt] = m;
    const ub = unitBoxesRef.current.find((x) => x.id === unidadeId);
    const planta = ub?.planta;
    if (!ub || !planta) return false;
    const i = Number(idxTxt);
    const b = buildingsRef.current.find((x) => x.id === ub.buildingId);
    const node = nodesRef.current.get(ub.buildingId);
    if (!b || !node) return false;

    if (tipo === "meio") {
      // Inserir NÃO muda a forma: o vértice nasce no meio exato da aresta. É o
      // que separa "subdividir" de "deformar" — a deformação é o passo seguinte,
      // e é do usuário.
      const prox = planta[(i + 1) % planta.length];
      const meio = { x: (planta[i].x + prox.x) / 2, y: (planta[i].y + prox.y) / 2 };
      onUnidadePlantaRef.current(unidadeId, [
        ...planta.slice(0, i + 1), meio, ...planta.slice(i + 1),
      ]);
      return true;
    }

    const alvo = vertParaModelo(ub, planta[i]);
    const zPiso = ub.z - ub.dz / 2;
    /**
     * O pivô do TETO arrasta no plano do teto — não no do piso.
     *
     * Ele existe para pegar o canto de onde se está olhando, e arrastar num
     * plano que não é o dele faria o canto correr mais (ou menos) do que o
     * cursor, conforme o ângulo da câmera. A gravação é a mesma: X e Y do
     * canto, sem tocar na altura.
     */
    const noTopo = tipo === "vert-topo";
    const zVert = noTopo ? ub.z + ub.dz / 2 : zPiso + (planta[i].z ?? 0);
    const axisO = poseNoModelo(b, node.groundHeight, alvo.x, alvo.y, zVert, 0).position;
    const axisD = Ellipsoid.WGS84.geodeticSurfaceNormal(axisO, new Cartesian3());
    const ray = v.camera.getPickRay(pos);
    if (!ray) return false;
    /**
     * Shift sobe e desce SÓ ESTE CANTO — a mesma convenção do pivô das vias.
     *
     * Piso torto (rampa, meio-nível, terreno em declive) não cabe numa caixa:
     * inclinar a unidade inteira inclina as paredes junto, e elas são prumo.
     * Com altura por canto, o piso acompanha e o resto fica de pé.
     *
     * O modo é decidido no `pointerdown` e não muda no meio do gesto: soltar o
     * Shift com o botão apertado trocaria o eixo debaixo da mão.
     */
    /**
     * Shift sobe e desce — cada pivô na SUA superfície.
     *
     * Pelo de baixo move o piso daquele canto; pelo de cima, o teto. É o que
     * descreve pé-direito duplo, mezanino e rampa sem inclinar as paredes, que
     * são prumo.
     */
    const modo: "plano" | "altura" = modRef.current.shift ? "altura" : "plano";
    const noPlano = modo === "plano" ? rayGroundPoint(ray, axisO, axisD) : undefined;
    if (modo === "plano" && !noPlano) return false;
    plantaDragRef.current = {
      unidadeId, index: i, ub, modo, noTopo, axisO, axisD,
      startNoPlano: noPlano,
      startScalar: modo === "altura" ? scalarOnAxis(ray, axisO, axisD) : 0,
      startZ: (noTopo ? planta[i].zTopo : planta[i].z) ?? 0,
      planta: planta.map((p) => ({ ...p })),
      lastEmit: 0,
    };
    return true;
  }

  function plantaPivotMove(pos: Cartesian2, force = false) {
    const v = viewerRef.current;
    const drag = plantaDragRef.current;
    if (!v || !drag) return;
    const agora = performance.now();
    if (!force && agora - drag.lastEmit < 50) return;
    const ray = v.camera.getPickRay(pos);
    if (!ray) return;
    drag.lastEmit = agora;

    if (drag.modo === "altura") {
      const atual = scalarOnAxis(ray, drag.axisO, drag.axisD);
      const z = Math.round((drag.startZ + atual - drag.startScalar) * 100) / 100;
      const planta = drag.planta.map((p, i) => (
        i !== drag.index ? p : (drag.noTopo ? { ...p, zTopo: z } : { ...p, z })
      ));
      onUnidadePlantaRef.current?.(drag.unidadeId, planta);
      onGizmoInfoRef.current?.(
        `Contorno · canto ${drag.index + 1} · ${drag.noTopo ? "teto" : "piso"}: `
        + `${z.toFixed(2)} m`,
      );
      return;
    }

    const ponto = rayGroundPoint(ray, drag.axisO, drag.axisD);
    if (!ponto || !drag.startNoPlano) return;
    const b = buildingsRef.current.find((x) => x.id === drag.ub.buildingId);
    const node = nodesRef.current.get(drag.ub.buildingId);
    if (!b || !node) return;
    // Do ponto AGARRADO, não do centro do pivô: a bolinha não salta para
    // debaixo do cursor no primeiro pixel de arraste.
    const delta = Cartesian3.subtract(ponto, drag.startNoPlano, new Cartesian3());
    const destino = Cartesian3.add(drag.axisO, delta, new Cartesian3());
    const local = mundoParaVertice(drag.ub, b, node.groundHeight, destino);
    // A altura do canto não muda no arraste de plano.
    const planta = drag.planta.map((p, i) => (
      i === drag.index ? { ...local, z: p.z, zTopo: p.zTopo } : p
    ));
    onUnidadePlantaRef.current?.(drag.unidadeId, planta);
    onGizmoInfoRef.current?.(
      `Contorno · canto ${drag.index + 1}: ${local.x.toFixed(2)}, ${local.y.toFixed(2)} m`
      + "  · Shift sobe e desce",
    );
  }

  function plantaPivotUp() {
    plantaDragRef.current = null;
    onGizmoInfoRef.current?.(null);
    // Devolve os "+", escondidos durante o arraste.
    syncPlantaUnidade();
  }

  function viaPivotUp() {
    viaDragRef.current = null;
    onGizmoInfoRef.current?.(null);
    // Repinta as faixas, que ficaram de fora enquanto o pivô estava na mão.
    // Soltar o botão não muda nenhuma prop, então o efeito de `viasChave` não
    // dispara sozinho — sem esta chamada a pintura só voltaria na próxima
    // mexida na via.
    syncVias();
  }

  /** Interseção do raio com o plano que passa por `o` e tem normal `n`. */
  function rayGroundPoint(
    ray: { origin: Cartesian3; direction: Cartesian3 },
    o: Cartesian3,
    n: Cartesian3,
  ): Cartesian3 | undefined {
    const plano = Plane.fromPointNormal(o, n);
    return IntersectionTests.rayPlane(ray, plano) ?? undefined;
  }

  function refreshGizmo() {
    if (!editRef.current) { clearGizmo(); gframeRef.current = null; return; }
    updateGframe();
    if (gframeRef.current) buildGizmo();
    else clearGizmo();
  }

  /**
   * Agarra uma alça. Devolve true quando o arraste começou — e é esse retorno
   * que o `pointerdown` usa para engolir o evento antes do Cesium, senão a
   * câmera gira junto e o modelo nunca sai do lugar.
   */
  function gizmoDown(pos: Cartesian2): boolean {
    const v = viewerRef.current;
    if (!v || !editRef.current) return false;
    const g = gframeRef.current;
    const alvo = gizmoLocalRef.current;
    // O alvo local manda no id: quem recebe o patch é a torre/unidade, não o
    // empreendimento selecionado.
    const id = alvo ? alvo.id : selectedRef.current;
    if (!id || !g) return false;
    const pid = idDaEntidade(v.scene.pick(pos));
    if (typeof pid !== "string" || !pid.startsWith("gizmo:")) return false;
    // As alças têm partes ("gizmo:tE:ponta"): a ferramenta é o primeiro
    // segmento depois do prefixo.
    const kind = pid.slice(6).split(":")[0] as NonNullable<typeof dragRef.current>["kind"];
    if (!["tE", "tN", "tU", "rot", "rotX", "rotY", "scale", "sX", "sY", "sZ"].includes(kind)) {
      return false;
    }
    const b = buildingsRef.current.find(
      (x) => x.id === (alvo ? alvo.buildingId : selectedRef.current),
    );
    const ray = v.camera.getPickRay(pos);
    if (!b || !ray) return false;

    let startScalar = 0;
    let startValue = 0;
    let axisD = g.east;
    let anel: { n: Cartesian3; u1: Cartesian3; u2: Cartesian3 } | undefined;

    if (kind === "tE" || kind === "tN" || kind === "tU") {
      axisD = kind === "tE" ? g.east : kind === "tN" ? g.north : g.up;
      startScalar = scalarOnAxis(ray, g.origin, axisD);
      if (alvo) startValue = kind === "tE" ? alvo.x : kind === "tN" ? alvo.y : alvo.z;
      else startValue = kind === "tE" ? b.offsetEast : kind === "tN" ? b.offsetNorth : b.heightOffset;
    } else if (kind === "sX" || kind === "sY" || kind === "sZ") {
      // Mede como a translação — o arraste anda no eixo —, mas o valor
      // representa a MEDIDA da caixa. O eixo é o da PEÇA, o mesmo em que a
      // alça foi desenhada.
      axisD = kind === "sX" ? g.eastObj : kind === "sY" ? g.northObj : g.upObj;
      startScalar = scalarOnAxis(ray, g.origin, axisD);
      const d = alvo?.dims;
      startValue = d ? (kind === "sX" ? d.dx : kind === "sY" ? d.dy : d.dz) : 1;
    } else if (kind === "rot" || kind === "rotX" || kind === "rotY") {
      // Cada anel tem o seu plano: o do ângulo é o plano do próprio anel, não
      // o horizontal — arrastar o anel de inclinação num plano horizontal não
      // teria como medir inclinação nenhuma.
      const pl = planoDoAnel(kind, g);
      const p = rayGroundPoint(ray, g.origin, pl.n);
      if (!p) return false;
      const u = Cartesian3.subtract(p, g.origin, new Cartesian3());
      startScalar = Math.atan2(Cartesian3.dot(u, pl.u2), Cartesian3.dot(u, pl.u1));
      startValue = valorDoAnel(kind, !!alvo);
      anel = { n: pl.n.clone(), u1: pl.u1.clone(), u2: pl.u2.clone() };
    } else {
      const p = rayGroundPoint(ray, g.origin, g.up);
      if (!p) return false;
      const u = Cartesian3.subtract(p, g.origin, new Cartesian3());
      startScalar = Cartesian3.magnitude(u);
      // No alvo local a escala redimensiona a caixa; o fator parte de 1.
      startValue = alvo ? 1 : b.scale;
    }

    // Deslocamento do pivô em relação ao centro real. Vazio quando o pivô não
    // foi reposicionado — o caso em que girar não move o alvo de lugar.
    const pivot = pivotRef.current
      ? Cartesian3.subtract(g.origin, g.origemNatural, new Cartesian3())
      : undefined;
    const startPos = alvo
      ? { a: alvo.x, b: alvo.y, c: alvo.z }
      : { a: b.offsetEast, b: b.offsetNorth, c: b.heightOffset };

    dragRef.current = {
      id,
      kind,
      local: !!alvo,
      escala: b.scale || 1,
      axisO: g.origin.clone(),
      axisD,
      up: g.up.clone(),
      east: g.east.clone(),
      north: g.north.clone(),
      startScalar,
      startValue,
      startDims: alvo?.dims ? { ...alvo.dims } : undefined,
      anel,
      pivot,
      startPos,
    };
    gizmoDraggedRef.current = false;
    /**
     * NÃO se mexe em `enableInputs` aqui.
     *
     * Quem impede a câmera de reagir é o `stopPropagation` do `pointerdown` em
     * fase de captura, no contêiner — o evento nem chega ao canvas. Desligar o
     * controlador por cima disso o deixava com estado interno pela metade, e o
     * efeito aparecia depois: girar ou rolar a roda mandava a câmera para o
     * infinito.
     */
    return true;
  }

  /**
   * Move a alça agarrada e emite o valor.
   *
   * Ctrl encaixa em passos redondos (1 m, 15°, 0,5 m) — a convenção de Blender
   * e Unreal. Sem encaixe, alinhar um prédio a uma rua vira perseguição de
   * casas decimais; com ele o tempo todo, o ajuste fino fica impossível.
   */
  function gizmoMove(pos: Cartesian2) {
    const v = viewerRef.current;
    const drag = dragRef.current;
    const emit = drag?.local ? onGizmoLocalTransformRef.current : onEditTransformRef.current;
    if (!v || !drag || !emit) return;
    const ray = v.camera.getPickRay(pos);
    if (!ray) return;
    gizmoDraggedRef.current = true;

    const { ctrl, shift } = modRef.current;
    /**
     * Encaixe. COM Ctrl, prende ao passo redondo; sem Ctrl, movimento livre.
     *
     * O "livre" já foi 0,1 — todo arraste saltava de 10 em 10 cm, e o pivô
     * parecia teleportar. Pior, o Shift (que reduz a VELOCIDADE para 0,25×)
     * não ajudava, porque o degrau continuava do mesmo tamanho. Agora é 1 mm:
     * imperceptível como degrau, e ainda evita gravar lixo de ponto flutuante.
     */
    const LIVRE = 0.001;
    const passo = (valor: number, encaixe: number, livre = LIVRE) => {
      const p = ctrl ? encaixe : livre;
      return Math.round(valor / p) * p;
    };
    const local = onGizmoLocalTransformRef.current;
    const global = onEditTransformRef.current;

    /**
     * Recentragem em torno de um pivô deslocado.
     *
     * Girar (ou escalar) em torno de um ponto que não é o centro move o centro:
     * `C' = P + T·(C − P)`. Como o gizmo emite valores ABSOLUTOS, a conta parte
     * sempre da posição do início do arraste — senão o alvo escorregaria,
     * acumulando o próprio deslocamento a cada quadro.
     */
    const recentrar = (transformar: (p: Cartesian3) => Cartesian3) => {
      const p = drag.pivot;
      const s0 = drag.startPos;
      if (!p || !s0) return undefined;
      const d = Cartesian3.subtract(p, transformar(p), new Cartesian3());
      const div = drag.local ? drag.escala : 1;
      return {
        a: s0.a + Cartesian3.dot(d, drag.east) / div,
        b: s0.b + Cartesian3.dot(d, drag.north) / div,
        c: s0.c + Cartesian3.dot(d, drag.up) / div,
      };
    };

    if (drag.kind === "tE" || drag.kind === "tN" || drag.kind === "tU") {
      const s = scalarOnAxis(ray, drag.axisO, drag.axisD);
      // O arraste é medido em metros do MUNDO; os campos do alvo local estão em
      // metros do MODELO. Sem dividir pela escala, um modelo a 0,5× andaria o
      // dobro do que o inspetor mostra.
      const bruto =
        drag.startValue +
        ((s - drag.startScalar) / (drag.local ? drag.escala : 1)) * (shift ? 0.25 : 1);
      const val = passo(bruto, 1);
      if (drag.local) {
        local?.(drag.id, { [drag.kind === "tE" ? "x" : drag.kind === "tN" ? "y" : "z"]: val });
      } else if (drag.kind === "tE") global?.(drag.id, { offsetEast: val });
      else if (drag.kind === "tN") global?.(drag.id, { offsetNorth: val });
      else global?.(drag.id, { heightOffset: val });
      const eixo = drag.local
        ? drag.kind === "tE" ? "X" : drag.kind === "tN" ? "Y" : "Z"
        : drag.kind === "tE" ? "Leste" : drag.kind === "tN" ? "Norte" : "Altura";
      onGizmoInfoRef.current?.(`${eixo}  ${val.toFixed(2)} m${ctrl ? "  · encaixe 1 m" : ""}`);
    } else if (drag.kind === "sX" || drag.kind === "sY" || drag.kind === "sZ") {
      /**
       * Redimensionamento em UM eixo, aditivo: puxar a alça 5 m para fora soma
       * 5 m àquela medida. É a leitura previsível para uma caixa cujas medidas
       * são metros no inspetor. O centro fica parado — a caixa cresce para os
       * dois lados —, porque crescer só para o lado puxado exigiria mover a
       * posição junto, e aí um arraste mexeria em dois campos ao mesmo tempo.
       */
      const s = scalarOnAxis(ray, drag.axisO, drag.axisD);
      const bruto =
        drag.startValue +
        ((s - drag.startScalar) / (drag.local ? drag.escala : 1)) * (shift ? 0.25 : 1);
      const val = Math.max(0.1, passo(bruto, 0.5));
      const campo = drag.kind === "sX" ? "dx" : drag.kind === "sY" ? "dy" : "dz";
      local?.(drag.id, { [campo]: val });
      const eixo = drag.kind === "sX" ? "Largura X" : drag.kind === "sY" ? "Profund. Y" : "Altura Z";
      onGizmoInfoRef.current?.(`${eixo}  ${val.toFixed(2)} m${ctrl ? "  · encaixe 0,5 m" : ""}`);
    } else if (drag.anel) {
      const p = rayGroundPoint(ray, drag.axisO, drag.anel.n);
      if (!p) return;
      const u = Cartesian3.subtract(p, drag.axisO, new Cartesian3());
      const kind = drag.kind as AnelKind;
      const ang = Math.atan2(Cartesian3.dot(u, drag.anel.u2), Cartesian3.dot(u, drag.anel.u1));
      const delta = CesiumMath.toDegrees(ang - drag.startScalar) * (shift ? 0.25 : 1);
      // 0,01° livre: um grau tem ~1 cm de arco a 60 m do pivô, então o degrau
      // some. O encaixe do Ctrl continua em 15°.
      let deg = passo(drag.startValue + delta, 15, 0.01);
      // O giro efetivamente aplicado, ANTES de normalizar: é ele que gira o
      // alvo em torno do pivô. Depois da normalização, 359→1 viraria −358.
      const giroRad = CesiumMath.toRadians(deg - drag.startValue);
      deg = ((deg % 360) + 360) % 360;
      // Os eixos de inclinação vivem em −180..180 (é o intervalo dos controles
      // de pitch/roll no painel); só o giro em torno do vertical usa 0..360,
      // como bússola.
      if (kind !== "rot" && deg > 180) deg -= 360;

      const eixoGiro = kind === "rot" ? drag.up : kind === "rotX" ? drag.east : drag.north;
      const pos2 = recentrar((pt) => {
        const q = Quaternion.fromAxisAngle(eixoGiro, giroRad);
        const m = Matrix3.fromQuaternion(q, new Matrix3());
        return Matrix3.multiplyByVector(m, pt, new Cartesian3());
      });
      const campo = campoDoAnel(kind, drag.local);
      if (drag.local) {
        local?.(drag.id, pos2 ? { [campo]: deg, x: pos2.a, y: pos2.b, z: pos2.c } : { [campo]: deg });
      } else {
        global?.(drag.id, pos2
          ? { [campo]: deg, offsetEast: pos2.a, offsetNorth: pos2.b, heightOffset: pos2.c }
          : { [campo]: deg });
      }
      onGizmoInfoRef.current?.(
        `${ANEL_ROTULO[kind]}  ${deg.toFixed(2)}°${drag.pivot ? "  · em torno do pivô" : ""}${
          ctrl ? "  · encaixe 15°" : ""
        }`,
      );
    } else {
      const p = rayGroundPoint(ray, drag.axisO, drag.up);
      if (!p) return;
      const dist = Cartesian3.magnitude(Cartesian3.subtract(p, drag.axisO, new Cartesian3()));
      const bruto = drag.startScalar > 1e-6 ? (dist / drag.startScalar) * drag.startValue : drag.startValue;
      const escalarPivot = (f: number) =>
        recentrar((pt) => Cartesian3.multiplyByScalar(pt, f, new Cartesian3()));

      if (drag.local) {
        // No alvo local a "escala" redimensiona a caixa: o fator multiplica
        // as dimensões do início do arraste, não um campo de escala.
        const d = drag.startDims;
        if (!d) return;
        const f = Math.max(0.05, bruto);
        // Livre é milímetro; o encaixe do Ctrl continua em 0,5 m.
        const arred = (n: number) =>
          Math.max(0.5, ctrl ? Math.round(n * 2) / 2 : Math.round(n * 1000) / 1000);
        const dims = { dx: arred(d.dx * f), dy: arred(d.dy * f), dz: arred(d.dz * f) };
        const pos2 = escalarPivot(f);
        local?.(drag.id, pos2 ? { ...dims, x: pos2.a, y: pos2.b, z: pos2.c } : dims);
        onGizmoInfoRef.current?.(
          `Caixa  ${dims.dx.toFixed(2)} × ${dims.dy.toFixed(2)} × ${dims.dz.toFixed(2)} m${
            ctrl ? "  · encaixe 0,5 m" : ""
          }`,
        );
      } else {
        const sc = Math.max(0.01, ctrl ? Math.round(bruto / 0.05) * 0.05 : Math.round(bruto * 1000) / 1000);
        const pos2 = escalarPivot(sc / (drag.startValue || 1));
        global?.(drag.id, pos2
          ? { scale: sc, offsetEast: pos2.a, offsetNorth: pos2.b, heightOffset: pos2.c }
          : { scale: sc });
        onGizmoInfoRef.current?.(`Escala  ${sc.toFixed(3)}×${ctrl ? "  · encaixe 0,05" : ""}`);
      }
    }
    requestRender();
  }

  function gizmoUp() {
    const v = viewerRef.current;
    dragRef.current = null;
    onGizmoInfoRef.current?.(null);
    requestRender();
  }

  // --- Corte por pavimento -------------------------------------------------------

  /**
   * Corta o modelo do empreendimento selecionado.
   *
   * O plano vive no espaço do MODELO (é o `ClippingPlaneCollection` do próprio
   * `Model`, cuja matriz já é a do GLB), então o corte acompanha posição,
   * rotação e escala do prédio sem conta nenhuma da nossa parte.
   *
   * Aceita número (altura pura) ou `CorteDef` — com `area`, o corte fica
   * limitado à pegada de um retângulo e o resto do empreendimento continua
   * íntegro. `null` limpa.
   */
  function cutAtFloor(corte: CorteDef | number | null) {
    const id = selectedRef.current;
    const b = id ? buildingsRef.current.find((x) => x.id === id) : undefined;
    const node = id ? nodesRef.current.get(id) : undefined;
    const model = node?.model as unknown as { clippingPlanes?: unknown } | undefined;
    if (!model || !b) return;

    if (corte == null) {
      model.clippingPlanes = undefined;
      requestRender();
      return;
    }

    const def: CorteDef = typeof corte === "number" ? { z: corte } : corte;
    const planos: ClippingPlane[] = [
      // Normal para BAIXO: mantém o que está abaixo da altura do corte.
      new ClippingPlane(new Cartesian3(0, 0, -1), def.z),
    ];

    if (def.area) {
      /**
       * Com área, o corte é a INTERSEÇÃO do plano horizontal com os quatro
       * planos verticais do retângulo. `unionClippingRegions = false` (o
       * padrão) é justamente isso: só some o que está do lado de dentro de
       * TODOS eles — fora do retângulo, o prédio fica inteiro.
       */
      const { x, y, comprimento, largura, rot } = def.area;
      const rad = CesiumMath.toRadians(rot ?? 0);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      // Eixos do retângulo já girados.
      const ex = new Cartesian3(cos, sin, 0);
      const ey = new Cartesian3(-sin, cos, 0);
      const meia = [comprimento / 2, largura / 2];
      for (const [eixo, m] of [[ex, meia[0]], [ey, meia[1]]] as const) {
        // Distância do plano à origem, deslocada pelo centro do retângulo.
        const centro = Cartesian3.dot(new Cartesian3(x, y, 0), eixo);
        planos.push(new ClippingPlane(Cartesian3.negate(eixo, new Cartesian3()), centro + m));
        planos.push(new ClippingPlane(eixo, -(centro - m)));
      }
    }

    model.clippingPlanes = new ClippingPlaneCollection({
      planes: planos,
      edgeWidth: 1.5,
      edgeColor: Color.fromCssColorString(BRAND_TURQUOISE),
      unionClippingRegions: false,
    });
    requestRender();
  }

  /** Câmera na altura de um pavimento, olhando para o azimute pedido. */
  function viewFromFloor(camH: number, heading: number, duration = 1.6) {
    const v = viewerRef.current;
    const id = selectedRef.current;
    const b = id ? buildingsRef.current.find((x) => x.id === id) : undefined;
    const node = id ? nodesRef.current.get(id) : undefined;
    if (!v || !b || !node) return;
    const gh = node.groundHeight;
    soltarOrbita();
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(b.lng, b.lat, gh + b.heightOffset + camH * b.scale),
      orientation: {
        heading: CesiumMath.toRadians(heading),
        // Levemente para baixo: olhar exatamente na horizontal deixa metade da
        // tela em céu vazio.
        pitch: CesiumMath.toRadians(-6),
        roll: 0,
      },
      duration,
    });
  }

  /** Visão externa oblíqua, para ver o corte de fora. */
  function viewCutExternal(duration = 1.6) {
    const id = selectedRef.current;
    const b = id ? buildingsRef.current.find((x) => x.id === id) : undefined;
    if (!b) return;
    const v = viewerRef.current;
    const esfera = esferaDoPredio(b);
    if (!v || !esfera) return flyToBuilding(b);
    soltarOrbita();
    v.camera.flyToBoundingSphere(esfera, {
      duration,
      offset: new HeadingPitchRange(
        v.camera.heading,
        CesiumMath.toRadians(-24),
        esfera.radius * 2.4,
      ),
    });
  }

  /**
   * Vista do corte: a `distancia` metros do MODELO acima do centro da área, na
   * inclinação pedida e girada a partir do eixo maior do retângulo.
   *
   * A câmera é DERIVADA, não capturada: entre um pavimento e o outro só a
   * altura muda, e a troca vira uma subida limpa. Câmera capturada à mão
   * mudava de enquadramento a cada andar, e a diferença parecia desleixo.
   */
  function viewCorteDeCima(
    corte: CorteDef,
    distancia: number,
    pitchGraus = -90,
    giroGraus = 0,
    duration = 1.4,
  ) {
    const v = viewerRef.current;
    const id = selectedRef.current;
    const b = id ? buildingsRef.current.find((x) => x.id === id) : undefined;
    const node = id ? nodesRef.current.get(id) : undefined;
    if (!v || !b || !node) return;

    const a = corte.area;
    /**
     * Centro do que se está olhando — e `(0, 0)` NÃO é esse centro.
     *
     * Sem `area`, a mira caía na origem do modelo. Origem de GLB é onde o
     * modelador deixou o pivô, não o meio do prédio: no modelo desta obra a
     * geometria vai de -225 m a +307 m em X, então a origem fica a centenas de
     * metros do volume. A câmera enquadrava o marcador do empreendimento com o
     * prédio fora de quadro.
     *
     * A caixa medida do GLB dá o centro real. Só quando ela ainda não chegou —
     * a medição é uma requisição à parte — é que resta a origem.
     */
    const caixa = b.modelUrl ? caixaGlbRef.current.get(b.modelUrl) : null;
    const centro = caixa
      ? {
          x: (caixa.min[0] + caixa.max[0]) / 2,
          y: (caixa.min[1] + caixa.max[1]) / 2,
        }
      : { x: 0, y: 0 };
    const alvo = poseNoModelo(
      b,
      node.groundHeight,
      a?.x ?? centro.x,
      a?.y ?? centro.y,
      corte.z,
      0,
    ).position;

    // O giro parte do eixo maior do retângulo: assim a planta entra na tela
    // deitada no sentido em que ela é mais longa, e não atravessada.
    const rotArea = a?.rot ?? 0;
    const maiorEmY = a ? a.largura > a.comprimento : false;
    const heading = CesiumMath.toRadians(rotArea + (maiorEmY ? 90 : 0) + giroGraus);
    const alcance = Math.max(20, distancia * (b.scale || 1));

    soltarOrbita();

    v.camera.flyToBoundingSphere(new BoundingSphere(alvo, 1), {
      duration,
      offset: new HeadingPitchRange(
        heading,
        CesiumMath.toRadians(Math.max(-90, Math.min(-1, pitchGraus))),
        alcance,
      ),
    });
  }

  // === EFEITOS DE SINCRONIZAÇÃO ==============================================
  // Cada um traduz uma prop para a cena. Todos guardam `readyRef`: antes do
  // viewer existir não há o que sincronizar, e o efeito de init faz a primeira
  // passada por conta própria.

  /**
   * Ctrl e Shift pressionados.
   *
   * O handler de eventos do Cesium não informa modificadores, e o arraste
   * precisa deles a cada quadro. `blur` limpa o estado: trocar de janela com
   * Ctrl afundado deixaria o encaixe ligado para sempre.
   */
  useEffect(() => {
    const ler = (e: KeyboardEvent) => {
      modRef.current = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    };
    const limpar = () => { modRef.current = { ctrl: false, shift: false }; };
    window.addEventListener("keydown", ler);
    window.addEventListener("keyup", ler);
    window.addEventListener("blur", limpar);
    return () => {
      window.removeEventListener("keydown", ler);
      window.removeEventListener("keyup", ler);
      window.removeEventListener("blur", limpar);
    };
  }, []);

  // Empreendimentos: cria, atualiza ou remove o que a lista pedir.
  useEffect(() => {
    if (!readyRef.current) return;
    reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, pronto]);

  /**
   * Enquadra o prédio selecionado e agenda a amostragem do terreno.
   *
   * Depende de `buildings.length`, e não só de `selectedId`, porque a cena
   * monta ANTES do projeto chegar: o `apiKey` vem de uma requisição e o
   * projeto de outra, então no primeiro render `buildings` está vazio, o init
   * cai no `flyHome` (2.800 m de altitude) e nada reenquadrava depois. Era
   * isso a "câmera longe".
   *
   * O `enquadradoRef` impede que o voo se repita: sem ele, qualquer mudança na
   * lista — no editor, cada tecla digitada — arrancaria a câmera do lugar.
   *
   * O atraso da amostragem não é superstição: `clampToHeightMostDetailed` só
   * devolve altura onde os tiles já carregaram, e logo após o voo eles ainda
   * estão vindo. Amostrar cedo demais devolve o fallback e o prédio afunda.
   */
  useEffect(() => {
    if (!readyRef.current || !selectedId) return;
    const b = buildingsRef.current.find((x) => x.id === selectedId);
    if (!b || enquadradoRef.current === selectedId) return;
    enquadradoRef.current = selectedId;
    flyToBuilding(b);
    const t = setTimeout(() => void sampleGroundFor(b.id), 2500);
    return () => clearTimeout(t);
    // `pronto` pelo mesmo motivo dos outros efeitos: na vitrine o `selectedId`
    // é definido assim que o projeto chega, o que costuma ser ANTES de o
    // tileset do Google terminar de baixar. Sem ele, este efeito desistia e o
    // empreendimento nunca era enquadrado nem tinha a cota medida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, buildings.length, pronto]);

  /**
   * POIs do empreendimento selecionado.
   *
   * Efeito próprio, com chave no CONTEÚDO dos pontos: eles são editados no
   * editor e precisam redesenhar a cada mudança, mas recriar as entidades a
   * cada render (o que uma dependência em `buildings` causaria) piscaria a
   * cena inteira enquanto se digita o nome de um ponto.
   */
  const poiChave = JSON.stringify(
    buildings.find((b) => b.id === selectedId)?.empreendimento.pontosDeInteresse ?? [],
  );
  useEffect(() => {
    if (!readyRef.current) return;
    const b = buildingsRef.current.find((x) => x.id === selectedId);
    // Sem cidade, sem POIs: eles marcam o que existe EM VOLTA, e sem o chão a
    // que se referem viram pinos boiando no vazio.
    if (b && cidade) showPoiMarkers(b);
    else clearPoiMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiChave, selectedId, buildings.length, pronto, cidade]);

  // Sol: hora e elevação vêm da barra solar.
  useEffect(() => {
    if (!readyRef.current) return;
    applySun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solarUtc, solarAltitude, pronto]);

  /**
   * Órbita: liga com o modo, e SÓ enquanto ele valer.
   *
   * A primeira versão reatava a órbita ao fim de qualquer voo, em qualquer
   * situação. O efeito era o oposto do pretendido: a câmera pousava na vista
   * do andar, o `moveEnd` disparava, e o arraste passava a girar em torno do
   * centro do prédio em vez de olhar em volta do pavimento. As vistas de andar
   * e a principal ficaram inutilizáveis.
   *
   * Agora quem decide é a página, que sabe o que está aberto: `orbitar` só é
   * verdadeiro na cena EXTERNA — sem pavimento aberto, sem unidade escolhida,
   * sem corte. Nas demais o referencial fica solto e a navegação é a padrão do
   * Cesium, que é o que aquelas vistas sempre esperaram.
   */
  useEffect(() => {
    const v = viewerRef.current;
    if (!pronto || !v || v.isDestroyed()) return;
    if (!orbitar) {
      soltarOrbita();
      return;
    }
    aplicarOrbita();

    // Reata ao fim de cada voo — mas só enquanto o modo valer. O `orbitarRef`
    // é lido no momento do evento, não no da montagem.
    const aoParar = () => {
      if (!orbitarRef.current) return;
      const cam = viewerRef.current?.camera;
      if (!cam || !Matrix4.equals(cam.transform, Matrix4.IDENTITY)) return;
      aplicarOrbita();
    };
    v.camera.moveEnd.addEventListener(aoParar);
    return () => {
      if (!v.isDestroyed()) v.camera.moveEnd.removeEventListener(aoParar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbitar, pronto]);

  /**
   * Fotogrametria ligada/desligada.
   *
   * `show = false` para o tileset inteiro: o Cesium para de pedir, decodificar
   * e desenhar tiles, que é o grosso do custo da cena. O empreendimento (GLB),
   * o espelho de vendas e as sombras seguem intactos — o prédio fica flutuando
   * sobre o fundo, que é exatamente a leitura de maquete.
   *
   * Não é o mesmo que desmontar a cena: aqui a câmera, o modelo e todos os
   * controles continuam vivos.
   */
  useEffect(() => {
    const v = viewerRef.current;
    const ts = tilesetRef.current;
    if (!v || v.isDestroyed()) return;
    if (ts) {
      ts.show = cidade;
      /**
       * Esconder não é liberar.
       *
       * `show = false` garante que o tileset não é DESENHADO, mas os tiles já
       * baixados continuam ocupando memória de GPU — o alívio seria só de
       * pixels, e o aparelho fraco continuaria carregando o peso. `trimLoadedTiles`
       * é o caminho documentado para descarregar de fato: ele solta tudo que
       * não foi selecionado no último quadro.
       *
       * Ao religar, os tiles voltam a ser pedidos — custa alguns segundos de
       * recarga, e é um preço justo por um botão que realmente alivia.
       */
      if (!cidade) ts.trimLoadedTiles();
    }

    /**
     * Sem cidade, a cena vira ESTÚDIO.
     *
     * Só esconder a fotogrametria deixava o prédio sobre o espaço sideral — o
     * fundo padrão do Cesium é o céu estrelado, que existe para quem olha a
     * Terra de fora. Um prédio recortado contra estrelas não lê como maquete,
     * lê como erro.
     *
     * Céu, atmosfera e estrelas saem; entra um cinza claro chapado, que é o
     * fundo de render de apresentação: neutro, sem direção, sem horizonte
     * competindo com a silhueta. O prédio passa a ser a única coisa na tela
     * com forma — que é o ponto de esconder o entorno.
     */
    // `SkyBox` não expõe `show` nos tipos do Cesium; guardamos a instância e
    // trocamos por `undefined`, que é o caminho suportado para tirar o céu.
    if (v.scene.skyBox) skyBoxRef.current = v.scene.skyBox;
    v.scene.skyBox = cidade ? (skyBoxRef.current ?? v.scene.skyBox) : undefined;
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = cidade;
    if (v.scene.sun) v.scene.sun.show = cidade;
    if (v.scene.moon) v.scene.moon.show = cidade;
    // No estúdio o dia é cinza claro e a noite é preta: é o fundo que faz a
    // hora, já que não há céu nem cidade para escurecer.
    v.scene.backgroundColor = cidade || noturno
      ? Color.BLACK
      : Color.fromCssColorString(FUNDO_ESTUDIO);


    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cidade, noturno, pronto]);

  /**
   * Modo noturno. Reaproveita `applySun`, que já decide luz e realce a partir
   * de `noturnoRef`/`realceRef` — duas contas separadas divergiriam na
   * primeira mudança de uma delas.
   */
  useEffect(() => {
    if (!readyRef.current) return;
    applySun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `cidade` entra aqui porque o grade noturno depende dela: escondida a
    // fotogrametria, não há o que corrigir e o passe é desligado.
  }, [noturno, realceNoturno, cidade, pronto]);

  // Espelho de vendas em 3D.
  useEffect(() => {
    if (!readyRef.current) return;
    syncUnitBoxes();
    syncPlantaUnidade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitBoxes, unidadePlantaId, pronto]);

  // Contorno da torre em calibração (editor).
  useEffect(() => {
    if (!readyRef.current) return;
    syncTowerOutline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [towerOutline, pronto]);

  // Laje do retângulo do corte em edição (editor).
  useEffect(() => {
    if (!readyRef.current) return;
    syncCorteArea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corteArea, pronto]);

  // Planta deitada no chão do pavimento. Chave pelo conteúdo: o objeto é
  // recriado a cada render da página e a identidade nunca se repetiria.
  const plantaChave = JSON.stringify(plantaPavimento ?? null);
  useEffect(() => {
    if (!readyRef.current) return;
    syncPlantaChao();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantaChave, buildings.length, pronto]);

  // Perímetro do terreno.
  useEffect(() => {
    if (!readyRef.current) return;
    syncPerimetro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, selectedId, pronto]);

  /**
   * Recorte da fotogrametria.
   *
   * A chave inclui o ENCAIXE do modelo: a pegada vive em coordenadas do
   * modelo, então mover ou girar o empreendimento muda onde ela cai no mundo.
   * `editMode` entra porque é ele que decide se o recorte pode existir.
   */
  const recorteChave = JSON.stringify([
    recorteTerreno ?? null,
    previewRecorte,
    editMode ?? false,
    selectedId,
    /**
     * A via INTEIRA entra na chave — traçado, largura, cotas e bordas movidas à
     * mão. Antes só o corredor horizontal entrava, com a justificativa de que
     * arrastar uma altura não devia recriar as texturas de clipping. Isso deixou
     * de ser verdade em duas frentes: os polígonos agora são construídos NA COTA
     * (é o que alinha o buraco com a fotogrametria) e a borda pode ser movida no
     * plano. Fora da chave, arrastar um pivô movia a malha e deixava o buraco
     * para trás. O custo é repactar os polígonos a 20 fps durante o arraste,
     * que é o teto do próprio `viaPivotMove`.
     */
    // `faixas` fica de fora de propósito: é pintura sobre a pista, não muda o
    // corredor recortado. Ligá-la não pode recriar as texturas de clipping.
    (vias ?? []).map((v) => [
      v.id,
      v.largura,
      v.folgaCorte ?? 0,
      (v.perfil?.length ? v.perfil : v.pontos),
      v.cotas ?? null,
    ]),
    // Aparência (tipo, cor, textura, escala, tinta) fica de fora: nada disso
    // move o corredor recortado, e trocar grama por concreto não pode recriar
    // as texturas de clipping.
    (superficies ?? []).map((s) => [s.id, s.folgaCorte ?? 0, s.pontos]),
    buildings.map((b) => [b.id, b.lat, b.lng, b.heading, b.scale,
      b.offsetEast, b.offsetNorth, b.heightOffset, b.modelUrl]),
  ]);
  useEffect(() => {
    if (!readyRef.current) return;
    aplicarRecorteTerreno();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorteChave, pronto]);

  // Vias: a chave é o conteúdo, porque o array é recriado a cada render.
  const viasChave = JSON.stringify([vias ?? [], corVia ?? null, viaEditandoId ?? null]);
  useEffect(() => {
    if (!readyRef.current) return;
    syncVias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viasChave, pronto]);

  const areasChave = JSON.stringify([superficies ?? [], areaEditandoId ?? null]);
  useEffect(() => {
    if (!readyRef.current) return;
    syncSuperficies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areasChave, pronto]);

  // Entrar ou sair do modo edição cria/remove as alças.
  useEffect(() => {
    if (!readyRef.current) return;
    refreshGizmo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, selectedId, buildings, pronto]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
});

export default Scene3D;
