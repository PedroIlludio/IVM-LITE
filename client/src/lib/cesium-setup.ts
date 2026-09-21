import {
  Viewer,
  Cartesian3,
  Credit,
  CreditDisplay,
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

/**
 * Atribuição obrigatória do mini mapa 3D.
 *
 * A licença do maps3d.io libera o uso para qualquer finalidade SOB A CONDIÇÃO
 * de creditar a imagem de satélite — Sentinel-2 cloudless, da EOX IT — e, se o
 * mapa trouxer edifícios, vias ou água, os dados do OpenStreetMap. Os nossos
 * trazem: é justamente o que dá a leitura de implantação. Então a linha não é
 * cortesia, é o que sustenta o direito de exibir o mapa na vitrine.
 *
 * Vai pelo `CreditDisplay` do Cesium, e não num canto de tela nosso, para
 * dividir o mesmo lugar e o mesmo comportamento do crédito do Google — quando
 * a linha não cabe, o Cesium a recolhe para a caixa de atribuições em vez de
 * atropelar a interface. Entra com o modelo e sai com ele; é `Scene3D` quem
 * liga e desliga, porque é lá que se sabe se o mapa está em cena.
 */
export const CREDITO_MAPA_3D = new Credit(
  '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless (2016)</a>'
    + ' by <a href="https://eox.at" target="_blank">EOX IT</a>'
    + " — © OpenStreetMap contributors",
  true,
);

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
 * O aparelho é fraco?
 *
 * Extraído de `ajustesDoAparelho` para a PÁGINA poder fazer a mesma pergunta —
 * ela decide se a vitrine abre pela fotogrametria ou pelo mini mapa. Duas
 * definições de "aparelho fraco" acabariam divergindo, e um tablet tratado
 * como fraco pelo render e como forte pela abertura teria o pior dos dois.
 */
export function ehAparelhoLeve(): boolean {
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
  return (toque && telaEstreita) || poucaMemoria || poucosNucleos;
}

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
  const aparelhoLeve = ehAparelhoLeve();

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
     * Desenhar em pixel de CSS ou em pixel de tela.
     *
     * `useBrowserRecommendedResolution` é `true` por padrão no Cesium, e o nome
     * engana: não é "a resolução que o navegador recomenda", é travar o buffer
     * em 1 pixel desenhado por pixel de CSS, ignorando o `devicePixelRatio`.
     * Num monitor 4K/Retina (dpr 2) isso desenha a cena com um QUARTO dos
     * pixels da tela e deixa o navegador ampliar — daí o serrilhado nas
     * silhuetas do prédio, que o FXAA não tem como esconder porque a borda já
     * chegou grosseira. `resolutionScale` não corrige: ele multiplica ESTE
     * valor, então 1 continua sendo metade da densidade real.
     *
     * No aparelho leve a conta se inverte e o padrão do Cesium vira aliado:
     * celular tem dpr 2–3, e honrá-lo custaria de 4 a 9 vezes mais fragmentos
     * no hardware que menos aguenta. Ali o ganho de nitidez não se vê na tela
     * pequena, mas a queda de fps se sente na mão.
     */
    resolucaoDoNavegador: aparelhoLeve,

    /**
     * Escala de render, aplicada SOBRE a densidade acima. Num tablet de tela
     * densa, a cena é desenhada em mais pixels do que a tela precisa mostrar;
     * 0.8 corta ~36% dos pixels e quase não se nota, porque o upscale acontece
     * numa densidade alta.
     */
    escalaRender: aparelhoLeve ? 0.8 : 1,
  };
}

// --- Fluidez ----------------------------------------------------------------

/** Acima disso o arrasto começa a "pesar" na mão (~45 fps). */
const ORCAMENTO_QUADRO = 22;
/**
 * Abaixo disso devolve nitidez. É uma FRAÇÃO do orçamento, não um número solto:
 * subir um degrau custa caro, e sem folga o controle sobe para logo ter de
 * descer. Como fração, a margem acompanha o orçamento se ele mudar.
 *
 * Os 30% saem de uma armadilha medida: com o limite em 13 ms fixo, esta cena
 * (que custa por volta de 14 ms parada) nunca alcançava a faixa de subida.
 * Qualquer lentidão passageira deixava a imagem mole até o fim da sessão,
 * porque não havia caminho de volta.
 */
const FOLGA_QUADRO = ORCAMENTO_QUADRO * 0.7;
/** Piso da escala: mais embaixo a imagem borra tanto que a troca deixa de valer. */
const ESCALA_MIN = 0.6;
const PASSO_ESCALA = 0.1;
/** Quadros seguidos observados antes de mexer — um pico isolado não decide nada. */
const AMOSTRAS_FLUIDEZ = 20;
/**
 * Ganho mínimo que justifica ter baixado a resolução.
 *
 * Um passo de 0,1 corta cerca de 19% dos pixels. Numa cena limitada por pixel o
 * tempo cai quase nessa proporção; numa limitada por geometria não cai nada.
 * 8% separa os dois casos com folga para ruído de medição.
 */
const GANHO_MINIMO = 0.08;
/**
 * Janelas de silêncio depois de concluir que baixar não adianta.
 *
 * A conclusão não pode ser definitiva: o gargalo muda ao longo da sessão (o
 * modelo termina de carregar, a câmera entra no meio do prédio, o operador
 * abre um pavimento). Vinte janelas é tempo suficiente para não ficar
 * remedindo a cada instante, e curto o bastante para a cena seguinte ser
 * julgada por ela mesma.
 */
const ESPERA_APOS_FRACASSO = 20;
/**
 * Quadros descartados logo após mexer na escala.
 *
 * Trocar a escala realoca os alvos de render (cor, profundidade, FXAA), e esses
 * primeiros quadros custam o dobro: medido aqui, ~35 ms contra ~15 ms em
 * regime. Sem descartá-los o controle mede o próprio conserto, conclui "ainda
 * lento" e desce de novo — foi assim que ele despencou de 0,9 até o piso numa
 * cena que rodava a 6 ms. Seis quadros cobrem com folga a reacomodação medida.
 */
const QUADROS_ASSENTAMENTO = 6;

/**
 * Troca resolução por fluidez — mas só onde a resolução é mesmo a causa.
 *
 * O 4K nativo entra por `useBrowserRecommendedResolution = false`, que desliga a
 * trava de 1 pixel desenhado por pixel de CSS. Isso quadruplica os fragmentos
 * num monitor de dpr 2, e num aparelho desconhecido não dá para prometer que
 * cabe — nem dá para decidir pelo nome do aparelho, que é o que a detecção
 * estática faz e erra.
 *
 * O detalhe que define o desenho desta função: medido nesta cena (Maragogi,
 * 7044 comandos de desenho), quadruplicar os pixels custou 9,6 → 10,7 ms sem
 * sombra e 17,9 → 26,9 ms com sombra suave. A cena é dominada por GEOMETRIA,
 * não por pixel. Um controle que só olhasse o relógio veria "lento", baixaria a
 * escala, veria "lento" de novo, e desceria até o piso — entregando uma imagem
 * borrada em troca de nada. Foi o que aconteceu na primeira versão: ela travava
 * em 0,6 e não subia mais.
 *
 * Por isso cada descida é uma HIPÓTESE que precisa se confirmar na janela
 * seguinte. Se o tempo não melhorou, o gargalo não era pixel: a escala volta e
 * o controle se cala por um tempo. Assim o pior caso é uma janela de imagem
 * mais mole, em vez de uma sessão inteira.
 *
 * O silêncio é temporário, e isso importa: a primeira versão desligava o
 * controle de vez no primeiro fracasso, e o fracasso vinha SEMPRE — durante o
 * carregamento, quando a cena está lenta por motivos que não têm nada a ver com
 * resolução. O guarda nascia morto, pela única janela em que a conclusão não
 * valia para o resto da sessão.
 *
 * A medida é a duração do render (`preRender`→`postRender`), não o intervalo
 * entre quadros. O intervalo inclui o React e todo o resto da aba, que a
 * resolução não controla — no editor, uma re-renderização de painel seria lida
 * como cena pesada.
 */
function manterFluidez(viewer: Viewer, escalaAlvo: number): void {
  const scene = viewer.scene;
  const janela: number[] = [];
  let inicio = 0;
  /** Descida ainda não confirmada: de onde viemos e quanto custava lá. */
  let hipotese: { escala: number; custo: number } | null = null;
  /** Janelas restantes de silêncio após uma tentativa que não adiantou. */
  let espera = 0;
  /** Quadros a ignorar enquanto os buffers se reacomodam. */
  let assentando = 0;

  /** Toda troca de escala passa por aqui, para nenhuma medir a si mesma. */
  const ajustar = (escala: number) => {
    viewer.resolutionScale = escala;
    assentando = QUADROS_ASSENTAMENTO;
    janela.length = 0;
  };

  scene.preRender.addEventListener(() => {
    inicio = performance.now();
  });

  scene.postRender.addEventListener(() => {
    const custoDoQuadro = performance.now() - inicio;
    if (assentando > 0) {
      assentando--;
      return;
    }
    janela.push(custoDoQuadro);
    if (janela.length < AMOSTRAS_FLUIDEZ) return;

    // Mediana, não média: uma coleta de lixo no meio da janela não deve
    // derrubar a resolução de quem estava indo bem.
    janela.sort((a, b) => a - b);
    const custo = janela[AMOSTRAS_FLUIDEZ >> 1];
    janela.length = 0;

    const atual = viewer.resolutionScale;

    if (hipotese) {
      const { escala: anterior, custo: custoAnterior } = hipotese;
      hipotese = null;
      if (1 - custo / custoAnterior < GANHO_MINIMO) {
        ajustar(anterior);
        espera = ESPERA_APOS_FRACASSO;
        return;
      }
    }

    if (espera > 0) {
      espera--;
      return;
    }

    if (custo > ORCAMENTO_QUADRO && atual > ESCALA_MIN) {
      hipotese = { escala: atual, custo };
      ajustar(Math.max(ESCALA_MIN, atual - PASSO_ESCALA));
    } else if (custo < FOLGA_QUADRO && atual < escalaAlvo) {
      ajustar(Math.min(escalaAlvo, atual + PASSO_ESCALA));
    }
  });
}

// --- Alcance da sombra ------------------------------------------------------

/**
 * Quanto o alcance da sombra supera a distância câmera→empreendimento.
 *
 * Três vezes cobre o que cabe no enquadramento de uma câmera orbital — o
 * empreendimento, a quadra e a vizinhança visível — sem sobrar quilômetro
 * nenhum. E o que sobra é caro: a resolução da cascata se espalha pelo alcance
 * inteiro, então cada metro a mais é nitidez a menos em toda a cena.
 */
/**
 * Onde a faixa sombreada começa, como fração da distância até o empreendimento.
 * Precisa sobrar chão ANTES do prédio — é nele que a sombra cai e é ele que
 * aparece na base do quadro. 0,35 deixa a borda da faixa bem fora de vista.
 */
const INICIO_FAIXA_SOMBRA = 0.35;
/** Depois do prédio a faixa ainda cobre alguns raios dele, mais uma folga fixa. */
const RAIOS_DEPOIS_DO_ALVO = 3;
const FOLGA_DEPOIS_DO_ALVO = 300;

/**
 * Ajusta a faixa de profundidade que o mapa de sombra cobre para cercar o
 * empreendimento, em vez de tentar cobrir o mundo.
 *
 * O Cesium reparte a faixa em 4 cascatas com corte quase logarítmico a partir
 * do NEAR do mapa de sombra. Esse near vem de `shadowState.nearPlane`, que o
 * `View` calcula como a menor distância de entrada entre os volumes de todos os
 * receptores de sombra — e desaba para o near da câmera (0,1 m) sempre que a
 * câmera está DENTRO de algum desses volumes. Com o mini mapa de base isso é o
 * tempo todo: o GLB do entorno é um tile de 7 km e a câmera vive dentro dele.
 *
 * Medido na cena de Maragogi, os cortes caíam em 0,1 / 51 / 113 / 301 / 2000:
 * três cascatas gastas nos primeiros 300 m, quase todos vazios, e a QUARTA
 * cobrindo sozinha de 301 a 2000 m. Essa última é a que desenha tudo o que se
 * vê — cerca de 0,8 m por texel. Daí o serrilhado grosso, em blocos, que o FXAA
 * não tem como suavizar: ele trabalha na imagem final, e a borda já chegou
 * quadrada do mapa de sombra.
 *
 * O `View` tem essa mesma salvaguarda para o globo, que é o caso idêntico de um
 * volume gigante contendo a câmera — mas ela testa `Pass.GLOBE`, e o mini mapa
 * é um `Model` comum. Ele faz o papel de globo sem ser globo. Com a
 * fotogrametria do Google o defeito não aparecia porque o tileset tem
 * `shadows = DISABLED` e ficava fora da conta; ou seja, o problema nasceu junto
 * com o mapa próprio, não é regressão dele.
 *
 * Como `lambda` é fixo no Cesium (0.9, sem API), mexer só no `maximumDistance`
 * rende pouco: ele encurta o far, mas o near continua em 0,1 e o corte segue
 * empilhado no vazio. Medido, isso sozinho levava 0,8 para 0,62 m por texel.
 * Informar as DUAS pontas leva a faixa para 198–1342 m, põe o prédio na 3ª
 * cascata e mede 0,15 m por texel — cinco vezes mais fino.
 *
 * Por que embrulhar `update` em vez de usar um evento: `shadowState` é
 * recalculado pelo `View` a cada quadro, depois do `preUpdate` e logo antes de
 * `ShadowMap.update` lê-lo. Este é o único ponto entre os dois.
 */
export function acompanharAlcanceDeSombra(
  viewer: Viewer,
  referencia: () => { centro: Cartesian3; raio: number } | undefined,
): void {
  const shadowMap = viewer.shadowMap as unknown as {
    update: (frameState: { shadowState: { nearPlane: number; farPlane: number } }) => void;
  };
  const original = shadowMap.update.bind(shadowMap);
  shadowMap.update = (frameState) => {
    const alvo = referencia();
    if (alvo) {
      const d = Cartesian3.distance(viewer.camera.positionWC, alvo.centro);
      const estado = frameState.shadowState;
      estado.nearPlane = Math.max(viewer.camera.frustum.near, d * INICIO_FAIXA_SOMBRA);
      estado.farPlane = Math.max(
        estado.nearPlane + 1,
        d + RAIOS_DEPOIS_DO_ALVO * alvo.raio + FOLGA_DEPOIS_DO_ALVO,
      );
    }
    original(frameState);
  };
}

interface CreatedViewer {
  viewer: Viewer;
  /**
   * `null` quando a cena foi montada SEM fotogrametria (ver o parametro
   * `fotogrametria`). Nulo aqui nao e falha: e o modo em que o entorno vem do
   * GLB do projeto. Quem consome precisa tratar a ausencia como normal.
   */
  tileset: Cesium3DTileset | null;
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
       *
       * O 404 entra na mesma lista porque o `tile.googleapis.com` responde
       * `404 NOT_FOUND` — "Requested entity was not found" — quando a chave
       * existe mas o PROJETO do Google Cloud não pode servir os tiles (billing
       * desativado, Map Tiles API não habilitada). É a resposta menos
       * intuitiva da API: parece rota errada e é credencial. Sem esta linha o
       * caso mais comum de erro de configuração era repetido 3 vezes e
       * anunciado ao visitante como "a conexão parece instável", mandando
       * investigar o wi-fi do estande por um problema que está no console do
       * Google.
       */
      const msg = e instanceof Error ? e.message : String(e);
      if (/(?:401|403|404|api.?key|billing|forbidden|unauthorized|not.?found)/i.test(msg)) {
        throw new Error(
          "A fotogrametria do Google recusou a credencial. Confira, no Google Cloud: "
          + "billing ativo no projeto, Map Tiles API habilitada e a restrição de "
          + "domínio da GOOGLE_MAPS_API_KEY incluindo este site.",
          { cause: e },
        );
      }
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
  /**
   * Pedir a fotogrametria do Google.
   *
   * `false` monta a cena inteira — camera, luz, sombras, GLB — e simplesmente
   * NAO fala com o Google. Nao confundir com `cidade={false}` no Scene3D, que
   * apenas ESCONDE (`tileset.show`) um tileset ja baixado: aqui o pedido nem
   * sai, entao nem a falha nem a cobranca do root tileset acontecem.
   *
   * E o que sustenta o botao da vitrine: quando a fotogrametria nao vem, o
   * visitante entra numa cena que nao depende dela.
   */
  fotogrametria = true,
): Promise<CreatedViewer> {
  // Must run before Viewer creates WebGL and reads ContextLimits. Running it
  // afterward leaves the first render broken on remote/software GPUs.
  patchDegradedWebGL();

  const q = ajustesDoAparelho();

  /* A aplicação acessa o Google Map Tiles diretamente pela chave abaixo; não
     usa serviço nem conteúdo do Cesium ion. Retira apenas a marca padrão do
     renderer. Os créditos Google e dos provedores dos tiles continuam sendo
     inseridos pelo tileset e permanecem visíveis. */
  CreditDisplay.cesiumCredit = new Credit("<span aria-hidden=\"true\"></span>", true);

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
    /**
     * O painel vermelho do Cesium não fala com o visitante.
     *
     * Quando um shader falha, o Cesium abre uma caixa com stack trace de
     * `Cesium.js` minificado e PARA de renderizar — numa vitrine de plantão de
     * vendas isso é a tela morrendo com um texto de depuração por cima. Pior,
     * a caixa não diz o que fazer nem oferece saída.
     *
     * Desligado aqui, o erro chega em `scene.renderError`, e o `Scene3D` decide:
     * se o culpado for um GLB de terceiros (o mini mapa), ele sai de cena e a
     * vitrine continua; se não, vira a tela de erro da própria vitrine, que tem
     * linguagem de gente e um botão de tentar de novo.
     */
    showRenderLoopErrors: false,
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
  /**
   * Alcance e bias calibrados para cenas de arquitetura.
   *
   * O valor antigo espalhava os 2048 px do mapa de sombra por 6 km. Num GLB
   * de BIM muito triangulado (o SESI tem mais de 10 milhões de vértices), a
   * profundidade de uma parede e a da própria sombra caíam no mesmo intervalo:
   * cada triângulo alternava entre iluminado e sombreado ao mover a câmera —
   * o "shadow acne" que parecia a parede piscando.
   *
   * Dois quilômetros ainda cobrem com folga o empreendimento e sua vizinhança,
   * mas entregam 3x mais precisão que 6 km. O normal offset continua ligado e
   * o bias de primitivas sobe para os mesmos valores conservadores que o
   * próprio Cesium usa no terreno. Isso afasta a comparação da superfície o
   * bastante para estabilizar faces coplanares sem desligar as sombras solares.
   */
  // Teto absoluto da faixa. Quem escolhe o intervalo útil é
  // `acompanharAlcanceDeSombra`; este valor só impede que uma câmera muito
  // afastada peça uma faixa que nenhuma cascata conseguiria resolver.
  viewer.shadowMap.maximumDistance = 2000;
  viewer.shadowMap.normalOffset = true;
  const primitiveBias = (viewer.shadowMap as unknown as {
    _primitiveBias?: { normalOffsetScale: number; depthBias: number };
  })._primitiveBias;
  if (primitiveBias) {
    primitiveBias.normalOffsetScale = 0.5;
    primitiveBias.depthBias = 0.0001;
  }
  viewer.shadowMap.enabled = q.sombras;
  viewer.shadowMap.darkness = 0.45;

  /**
   * Densidade do render — ver `resolucaoDoNavegador` e `escalaRender`.
   *
   * A ordem importa: o Cesium recalcula o tamanho do buffer a partir das duas
   * propriedades, e é o número de pixels o corte de custo mais direto que
   * existe. No desktop compramos nitidez; no aparelho leve, fps.
   */
  viewer.useBrowserRecommendedResolution = q.resolucaoDoNavegador;
  viewer.resolutionScale = q.escalaRender;
  manterFluidez(viewer, q.escalaRender);
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

  /**
   * Sem fotogrametria a cena ja esta pronta aqui: tudo o que resta nesta
   * funcao configura o tileset, e nao ha tileset. Sair antes e o que garante
   * que nenhum pedido ao Google sai neste modo.
   */
  if (!fotogrametria) return { viewer, tileset: null };

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
