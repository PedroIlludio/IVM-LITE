import {
  Viewer,
  ShadowMode,
  createGooglePhotorealistic3DTileset,
  GoogleMaps,
  RequestScheduler,
  type Cesium3DTileset,
} from "cesium";
import * as CesiumNS from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

/** Elevação aproximada de Ponta do Mangue, Maragogi/AL — nível do mar
 * (fallback se o clamp de terreno falhar). */
export const FALLBACK_GROUND_HEIGHT = 3;

// ContextLimits existe em runtime (re-exportado do @cesium/engine) mas não nos
// tipos públicos do Cesium; acessamos como um mapa de números.
const ContextLimits = (CesiumNS as unknown as { ContextLimits: Record<string, number> })
  .ContextLimits;

const SANE_LIMITS: Record<string, number> = {
  _maximumCombinedTextureImageUnits: 48,
  _maximumCubeMapSize: 16384,
  _maximumFragmentUniformVectors: 1024,
  _maximumTextureImageUnits: 16,
  _maximumRenderbufferSize: 16384,
  _maximumTextureSize: 16384,
  _maximumVaryingVectors: 30,
  _maximumVertexAttributes: 16,
  _maximumVertexTextureImageUnits: 16,
  _maximumVertexUniformVectors: 1024,
  _minimumAliasedLineWidth: 1,
  _maximumAliasedLineWidth: 8,
  _minimumAliasedPointSize: 1,
  _maximumAliasedPointSize: 64,
  _maximumViewportWidth: 16384,
  _maximumViewportHeight: 16384,
  _maximumTextureFilterAnisotropy: 16,
  _maximumDrawBuffers: 8,
  _maximumColorAttachments: 8,
  _maximumSamples: 4,
};

let dynamicIblDisabled = false;

/**
 * Contextos WebGL degradados (acesso remoto/RDP, render farm sem GPU dedicada,
 * headless) reportam os limites do ContextLimits como 0 e não fazem MRT. O
 * Cesium 1.124 então lança em cascata ("Invalid array length", "lineWidth out of
 * range", "color attachments exceeds") e PARA o render. Isto preenche os limites
 * com valores típicos de GPU real e desliga globalmente a IBL dinâmica (que
 * exige MRT). Em GPU real nada disso dispara.
 */
export function patchDegradedWebGL() {
  const degraded =
    !ContextLimits.maximumTextureSize ||
    !ContextLimits.maximumColorAttachments ||
    !ContextLimits.maximumAliasedLineWidth ||
    !ContextLimits.maximumDrawBuffers;
  if (!degraded) return;
  for (const key in SANE_LIMITS) {
    ContextLimits[key] = Math.max(ContextLimits[key] || 0, SANE_LIMITS[key]);
  }
  if (!dynamicIblDisabled) {
    const DEMM = (
      CesiumNS as unknown as {
        DynamicEnvironmentMapManager?: { isDynamicUpdateSupported: () => boolean };
      }
    ).DynamicEnvironmentMapManager;
    if (DEMM) {
      DEMM.isDynamicUpdateSupported = () => false;
      dynamicIblDisabled = true;
    }
  }
}

// --- Perfil de qualidade ----------------------------------------------------

/**
 * Mesma experiência, mesmos dados, mesmas telas — o que muda é o custo por
 * frame. A cena era afinada para uma máquina de trabalho (MSAA 4×, sombras
 * 2048, SSE 20, FXAA) e essa combinação, sobre um GLB de 23 MB e a
 * fotogrametria do Google, é a mais cara possível justamente no aparelho mais
 * fraco. O celular do corretor no plantão é o caso real, não a exceção.
 */
/**
 * Ajustes de render.
 *
 * Houve dois perfis com um seletor para o visitante, e eles saíram porque o
 * perfil leve entregava OUTRA experiência: as caixas do espelho de vendas sem
 * cor e a planta do pavimento sem desenhar. Depois se descobriu que a causa
 * disso nunca foi o perfil — era o OIT (ver `orderIndependentTranslucency`
 * abaixo), e o MSAA só mascarava o defeito por usar outro buffer.
 *
 * Com a causa resolvida, aliviar aparelho fraco volta a ser possível. A regra
 * que sobrou do episódio, e que vale para sempre: **cortar custo, nunca
 * informação**. Menos tiles, sombra menor, render em resolução mais baixa —
 * tudo isso o visitante não percebe como falta. Unidade sem cor, ele percebe.
 *
 * Por isso não há mais escolha para o usuário: há uma adaptação automática, e
 * ela só mexe em coisas que ninguém consegue nomear olhando a tela.
 */
function ajustesDoAparelho() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const poucaMemoria = (nav.deviceMemory ?? 8) <= 4;
  const poucosNucleos = (nav.hardwareConcurrency ?? 8) <= 4;
  const telaEstreita = Math.min(window.innerWidth, window.innerHeight) < 900;
  const toque = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  /**
   * Tablet e celular: ponteiro grosso + tela não-grande. É a assinatura do
   * aparelho de plantão de vendas, e casa melhor com a realidade do que medir
   * memória — que muito navegador nem informa.
   */
  const aparelhoLeve = (toque && telaEstreita) || poucaMemoria || poucosNucleos;

  return {
    /**
     * MSAA sempre desligado; FXAA cobre o serrilhado por uma fração do custo.
     * Multiamostragem recalcula cada pixel de borda N vezes e é o item mais
     * caro da lista numa GPU integrada.
     */
    msaa: 0,
    fxaa: true,

    /** Sombras seguem existindo — a simulação solar é argumento de venda. */
    sombras: true,
    /** O que cai no aparelho leve é a RESOLUÇÃO do mapa de sombra, não o recurso. */
    sombraTam: aparelhoLeve ? 1024 : 2048,
    /** Sombra suave custa amostras extras por pixel; no tablet vira sombra dura. */
    sombraSuave: !aparelhoLeve,

    /**
     * Erro de tela do tileset: maior = menos tiles da fotogrametria = menos
     * geometria, textura e memória. É o controle de maior efeito num tablet, e
     * o custo visual é a cidade ao redor ficar um pouco menos detalhada — o
     * empreendimento em si é o GLB, que não passa por aqui.
     */
    sse: aparelhoLeve ? 32 : 20,

    /**
     * Escala de render. Num tablet de tela densa, a cena é desenhada em muito
     * mais pixels do que a tela precisa mostrar; 0.8 corta ~36% dos pixels e
     * quase não se nota, porque o upscale acontece numa densidade alta.
     */
    escalaRender: aparelhoLeve ? 0.8 : 1,
  };
}

interface CreatedViewer {
  viewer: Viewer;
  tileset: Cesium3DTileset;
  /** Perfil efetivamente aplicado (para a interface poder exibi-lo). */
}

// --- Fotogrametria: timeout e retry -----------------------------------------

/** Tentativas de baixar a raiz da fotogrametria antes de desistir. */
const TILESET_TENTATIVAS = 3;
/** Teto de espera POR tentativa. */
const TILESET_TIMEOUT_MS = 15000;

/**
 * Baixa a raiz da fotogrametria do Google com prazo e nova tentativa.
 *
 * `createGooglePhotorealistic3DTileset` é um `fetch` só, do `root.json` em
 * `tile.googleapis.com`, e o `fetch` do navegador NÃO tem prazo: numa conexão
 * instável — 4G de plantão de vendas, wi-fi de estande — ele fica pendente
 * indefinidamente. Sem isto a promise nunca resolvia nem rejeitava, e a vitrine
 * ficava girando para sempre; o único caminho de volta era o F5, que num tablet
 * na mão do cliente ninguém dá.
 *
 * Pendente para sempre é o pior dos estados: não vira erro, então nada na tela
 * podia dizer o que houve. Com prazo, a falha passa a existir — e o que existe
 * pode ser tentado de novo e contado ao visitante.
 */
async function carregarTilesetDoGoogle(): Promise<Cesium3DTileset> {
  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= TILESET_TENTATIVAS; tentativa++) {
    let expirar: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }),
        new Promise<never>((_, rejeitar) => {
          expirar = setTimeout(
            () => rejeitar(new Error(
              `A fotogrametria do Google não respondeu em ${TILESET_TIMEOUT_MS / 1000}s.`,
            )),
            TILESET_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (e) {
      ultimoErro = e;
      /**
       * Credencial recusada não melhora insistindo — só atrasa em 45s a única
       * mensagem que resolve o problema (chave, billing, restrição de domínio).
       * Repetir serve para rede; para 403 é teimosia.
       */
      const msg = e instanceof Error ? e.message : String(e);
      if (/(?:401|403|api.?key|billing|forbidden|unauthorized)/i.test(msg)) throw e;
      // Espera crescente: se a rede caiu, voltar no mesmo instante encontra a
      // mesma rede caída.
      if (tentativa < TILESET_TENTATIVAS) {
        await new Promise((r) => setTimeout(r, tentativa * 2000));
      }
    } finally {
      clearTimeout(expirar);
    }
  }

  throw new Error(
    `A fotogrametria do Google não respondeu depois de ${TILESET_TENTATIVAS} tentativas — `
    + "a conexão parece instável.",
    { cause: ultimoErro },
  );
}

/**
 * Cria o Viewer do Cesium com a fotogrametria fotorrealista do Google, já com
 * todas as correções descobertas: WebGL degradado blindado, throttle de
 * requests desligado (senão os tiles do Google nunca são emitidos), IBL do
 * tileset desligada e sombras solares ativas.
 */
export async function createVision3DViewer(
  container: HTMLElement,
  apiKey: string,
): Promise<CreatedViewer> {
  // Must run before Viewer creates WebGL and reads ContextLimits. Running it
  // afterward leaves the first render broken on remote/software GPUs.
  patchDegradedWebGL();

  const q = ajustesDoAparelho();

  const viewer = new Viewer(container, {
    // preserveDrawingBuffer: sem isto o navegador descarta o buffer logo após
    // compor o frame, e `canvas.toDataURL()` devolve uma imagem em branco — ou
    // seja, não haveria como capturar a miniatura das vistas no editor nem o
    // botão de screenshot. Custa um pouco de memória; é o preço da captura.
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
    // Sem globo/imagery padrão: os 3D Tiles do Google fornecem a superfície e
    // evitamos exigir token do Cesium Ion.
    globe: false,
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    selectionIndicator: false,
    infoBox: false,
    shadows: q.sombras,
    // PERFORMANCE: só renderiza quando algo muda (câmera, tiles novos, sol,
    // seleção). Sem isto o Cesium redesenha 60x/s a mesma cena — o que travava
    // a navegação nesta máquina (WebGL degradado/remoto). As mutações chamam
    // scene.requestRender() explicitamente em Scene3D.
    /**
     * Translucidez por mistura clássica, não por OIT.
     *
     * O Cesium liga sozinho a *order-independent translucency*, que resolve a
     * ordem dos objetos transparentes com buffers auxiliares e extensões de
     * WebGL. Nesta base de máquinas (WebGL degradado) esse caminho falha
     * calado: as caixas do espelho de vendas desenham sem cor e a planta do
     * pavimento não aparece — as duas são geometria translúcida.
     *
     * O sintoma vinha amarrado ao MSAA por acidente: com multiamostragem ligada
     * o Cesium usa outro buffer e o defeito sumia, o que fazia parecer culpa do
     * perfil de qualidade. Não era — era o OIT. Desligado, a translucidez volta
     * a funcionar SEM exigir MSAA 4×, que é o que travava a cena.
     *
     * O preço é a ordenação: dois translúcidos sobrepostos podem desenhar fora
     * de ordem em ângulos rasantes. Numa cena de caixas separadas por andar
     * isso quase não aparece — e um artefato de ordem é muito melhor do que não
     * mostrar a informação.
     */
    orderIndependentTranslucency: false,
    requestRenderMode: true,
    // O relógio fica fixo no instante solar, então nenhuma passagem de tempo de
    // simulação deve provocar render. O nome correto é maximumRenderTimeChange:
    // antes estava escrito "maximumRenderTime", que não existe — a opção era
    // descartada em silêncio.
    maximumRenderTimeChange: Infinity,
  });

  const scene = viewer.scene;

  // Sombras: 2048 (era 4096) já reduz muito o custo por frame mantendo
  // qualidade para a simulação solar. As sombras
  // suaves são o extra que sai primeiro — são um segundo passe de filtragem.
  viewer.shadowMap.softShadows = q.sombraSuave;
  viewer.shadowMap.size = q.sombraTam;
  viewer.shadowMap.maximumDistance = 6000;
  viewer.shadowMap.enabled = q.sombras;
  viewer.shadowMap.darkness = 0.45;

  /**
   * Render em resolução reduzida no aparelho leve.
   *
   * É o corte de custo mais direto que existe: metade do trabalho por frame
   * vem do número de pixels. Num tablet de tela densa a diferença mal aparece,
   * porque o upscale acontece numa densidade alta — e nada de INFORMAÇÃO se
   * perde, só nitidez.
   */
  viewer.resolutionScale = q.escalaRender;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;

  // Luz solar um pouco mais forte para o modelo GLB (vidro escuro) ler melhor.
  // scene.light é a SunLight padrão (segue o sol do relógio → sombras corretas).
  scene.light.intensity = 2.0;

  // Anti-aliasing: MSAA suaviza as arestas de geometria (silhueta do prédio,
  // linhas) e FXAA suaviza o resto. Com requestRenderMode a cena fica ociosa
  // (0 frames), então o custo do AA só aparece durante a interação — vale a
  // qualidade num desktop.
  scene.msaaSamples = q.msaa;
  scene.postProcessStages.fxaa.enabled = q.fxaa;

  scene.fog.enabled = false;
  // Não recolorir/relightar globalmente a cada frame.
  scene.highDynamicRange = false;

  /**
   * Limites da navegação.
   *
   * Sem globo (`globe: false`), o Cesium não tem uma superfície contra a qual
   * medir o zoom: ele cai na altura acima da elipsoide, e cada passo é uma
   * fração dessa altura. Subindo, o passo cresce junto — e a roda do mouse
   * acelera até mandar a câmera para o infinito, de onde não se volta. O teto
   * de 20 km é folgado (a vitrine inteira cabe em menos de 1 km) e o piso de
   * 5 m evita atravessar a fachada.
   */
  const nav = scene.screenSpaceCameraController;
  nav.minimumZoomDistance = 5;
  nav.maximumZoomDistance = 20000;
  // Em frames pesados um único evento acumulava deslocamento demais e o zoom
  // parecia "arremessar" a câmera. Menos inércia e um teto menor por quadro
  // deixam mouse e touchpad previsíveis sem remover liberdade de navegação.
  nav.inertiaZoom = 0.15;
  nav.inertiaTranslate = 0.25;
  nav.inertiaSpin = 0.25;
  nav.maximumMovementRatio = 0.05;
  nav.zoomFactor = 2;
  /**
   * NÃO existe piso de câmera nesta cena, e é uma decisão consciente.
   *
   * `enableCollisionDetection` (que fica no padrão, ligado) mede contra o
   * GLOBO, e aqui `globe: false` — a superfície é a fotogrametria, que para o
   * controlador é geometria como outra qualquer. Então ele não barra nada, e a
   * câmera atravessa o chão.
   *
   * Um piso próprio foi tentado e removido. O motivo não foi a dificuldade: é
   * que ele dependia da amostragem de altura do terreno, que desiste em
   * silêncio quando os tiles do Google demoram — e o resultado era um editor
   * que barrava a câmera num projeto e não barrava em outro, conforme a rede do
   * momento. Comportamento que varia com a sorte é pior do que ausência de
   * comportamento. Além disso, as duas implementações (por quadro e por
   * `moveEnd`) travaram a aplicação inteira, cada uma do seu jeito.
   *
   * Refazer exige uma referência de altura CONFIÁVEL — gravada no projeto na
   * calibração, não amostrada em tempo de execução.
   */

  GoogleMaps.defaultApiKey = apiKey;

  // CRÍTICO: com o throttle padrão os tiles do Google ficam com prioridade
  // baixa (globe:false) e NUNCA são emitidos na rede (fotogrametria invisível).
  // Desligar força a emissão. O "flood" que travava era, na verdade, a
  // amostragem de terreno com clampToHeightMostDetailed em vários pontos ao
  // mesmo tempo (força alta resolução na cidade toda) — isso agora é feito
  // apenas 1 prédio por vez, ao selecionar.
  RequestScheduler.throttleRequests = false;

  let tileset: Cesium3DTileset;
  try {
    tileset = await carregarTilesetDoGoogle();
  } catch (e) {
    /**
     * Sem isto cada tentativa frustrada deixa um Viewer e um contexto WebGL
     * órfãos. Antes não importava — falhar era o fim da linha. Agora que existe
     * "Tentar de novo", eles se acumulariam até o navegador derrubar o contexto
     * mais antigo (o limite costuma ser 8 a 16) e a cena parar de desenhar por
     * um motivo que nada na tela explicaria.
     */
    if (!viewer.isDestroyed()) viewer.destroy();
    throw e;
  }
  // A fotogrametria já traz iluminação/sombras na textura. Fazê-la participar
  // novamente do shadow map duplica milhares de comandos e, com clipping
  // polygons, ativa um bug do Cesium em que o sampler ainda não tem `_target`.
  // O GLB do empreendimento continua projetando e recebendo sombras normalmente.
  tileset.shadows = ShadowMode.DISABLED;
  // SSE maior = menos tiles pedidos, menos memória, menos rede. É a alavanca de
  // maior efeito no celular, onde o gargalo costuma ser baixar a fotogrametria,
  // não desenhá-la.
  tileset.maximumScreenSpaceError = q.sse;
  if (tileset.environmentMapManager) tileset.environmentMapManager.enabled = false;
  viewer.scene.primitives.add(tileset);

  return { viewer, tileset };
}
