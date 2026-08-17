import { z } from "zod";

/**
 * Id da torre. Livre (string) porque cada IVM Lite define as suas próprias
 * torres; no piloto Quinta são "ocean" | "sea" | "river".
 */
export type Torre = string;
export type UnidadeStatus = "disponivel" | "reservada" | "vendida";

/** Orientação da vista/sol da unidade, no padrão bússola em português. */
export type Orientacao = "N" | "NE" | "L" | "SE" | "S" | "SO" | "O" | "NO";

export interface Unidade {
  id: string;
  torre: Torre;
  pavimento: number;
  numero: string;
  /**
   * Nome da tipologia. Continua sendo o rótulo exibido e a chave histórica que
   * casa com `Empreendimento.plantas[].area` (que, apesar do nome, guarda o
   * NOME da tipologia — ex.: "Ocean — Tipo 1").
   */
  tipologia: string;
  /** Id da Tipologia do projeto. Preenchido pelo normalizador a partir do nome. */
  tipologiaId?: string;
  status: UnidadeStatus;

  /**
   * Preço em CENTAVOS. Inteiro de propósito: dinheiro em float acumula erro de
   * arredondamento, e o filtro de faixa compara valores o tempo todo.
   */
  preco?: number;
  /**
   * Área privativa em m², como NÚMERO. O slider de faixa não tem como operar
   * sobre o texto do campo `area` — este é o campo que os filtros usam.
   */
  areaPrivativa?: number;
  areaTotal?: number;
  quartos?: number;
  suites?: number;
  vagas?: number;
  orientacao?: Orientacao;
  observacao?: string;

  /**
   * Posição PRÓPRIA no espaço do modelo, em metros.
   *
   * Quando definida, a unidade deixa de ser uma fatia automática do volume da
   * torre e passa a ficar exatamente onde foi colocada — é o modo avulso, para
   * coberturas, garden, lojas e qualquer unidade que não obedece à grade de
   * "N por andar". Os dois modos convivem no mesmo projeto: só as unidades com
   * `posicao` saem do fatiamento.
   */
  posicao?: {
    x: number;
    y: number;
    /** Base da caixa (Z do modelo). */
    z: number;
    /** Dimensões da caixa; sem elas usa o padrão do pavimento. */
    dx?: number;
    dy?: number;
    dz?: number;
    /**
     * Giro em graus. `rot` é em torno do eixo vertical do modelo (Z) e sozinho
     * resolve a esmagadora maioria dos casos; `rotX`/`rotY` inclinam a caixa
     * nos outros dois eixos, para rampas, telhados e terrenos em declive.
     *
     * Compostos nesta ordem: Rz · Ry · Rx.
     */
    rot?: number;
    rotX?: number;
    rotY?: number;
    /**
     * Contorno da unidade no plano do pavimento, em metros RELATIVOS AO CENTRO.
     *
     * Ausente, a unidade é o retângulo `dx` × `dy` de sempre — que é o certo
     * para a maioria e continua sendo o padrão.
     *
     * Existe porque apartamento raramente é um retângulo perfeito: tem corredor
     * que avança, quina cortada pela empena, quarto que recua da fachada. Com
     * caixa, ou a unidade invadia a vizinha ou deixava vão — e nos dois casos o
     * espelho 3D deixava de bater com a planta.
     *
     * Relativo ao centro, e não absoluto, de propósito: mover ou girar a
     * unidade continua sendo mexer em `x`/`y`/`rot`, sem reescrever o contorno.
     * `dx`/`dy` seguem valendo como a caixa de referência de onde ele nasceu.
     */
    planta?: {
      x: number;
      y: number;
      /**
       * Altura DESTE canto, medida da base da unidade. Ausente = 0.
       *
       * Existe porque nem todo piso é plano: rampa de garagem, meio-nível,
       * unidade que acompanha um terreno em declive. Sem altura por canto, um
       * piso torto só cabia numa caixa inclinada inteira — e aí a unidade
       * inteira torta, incluindo as paredes que são prumo.
       */
      z?: number;
      /**
       * Altura do TETO deste canto, medida do topo da unidade. Ausente = 0.
       *
       * Piso e teto variam independentes: um pé-direito duplo na sala com o
       * quarto em mezanino é o caso que nenhuma caixa descreve, e que dois
       * números por canto descrevem inteiro.
       */
      zTopo?: number;
    }[];
  };

  /**
   * Enquadramento da unidade, por VALORES — não uma câmera capturada.
   *
   * A posição da unidade já é conhecida (fatiada da torre ou pivô próprio), e o
   * que falta é de onde olhar para ela. Guardar uma câmera absoluta amarraria o
   * enquadramento ao lugar em que o modelo estava quando foi capturado: mover o
   * empreendimento no mapa invalidaria as trezentas câmeras de uma vez. Estes
   * três números são relativos à unidade e sobrevivem a isso.
   *
   * Ausente = a unidade usa o enquadramento padrão do projeto.
   */
  camera?: {
    /** Ângulo em torno da unidade, 0–360° (0 = norte). */
    angulo: number;
    /** Inclinação em graus: negativo olha de cima para baixo. */
    inclinacao: number;
    /** Distância da câmera à unidade, em metros. */
    distancia: number;
  };

  /**
   * Planta DESTA unidade.
   *
   * A tipologia descreve um tipo — "Tipo 1", "Tipo 2" — e várias unidades a
   * compartilham. Só que a planta de cada apartamento é única no que interessa
   * ao comprador: a posição no andar, para que lado a sacada aponta, qual
   * parede é de vizinho. Duas unidades do mesmo tipo em pontas opostas do
   * pavimento têm plantas espelhadas.
   *
   * Sem ela, vale a da tipologia — que continua sendo o certo para o
   * empreendimento que só tem uma planta por tipo.
   */
  plantaUrl?: string;

  /**
   * @deprecated Área como texto ("48 m²"), formato antigo. O normalizador a
   * converte para `areaPrivativa`; mantida para não quebrar projetos já salvos.
   */
  area?: string;
}

/** Enquadramento padrão de unidade, quando ela não define o seu. */
export const CAMERA_UNIDADE_PADRAO = { angulo: 45, inclinacao: -12, distancia: 90 };

/**
 * Tipologia (planta) do empreendimento. Antes existia solta como
 * `Empreendimento.plantas[]`; agora é entidade própria, porque o card e o
 * pop-up da unidade precisam de atributos (quartos, vagas) e de duas imagens
 * distintas: a planta técnica e o render axonométrico.
 */
export interface Tipologia {
  id: string;
  /** Nome exibido — casa com `Unidade.tipologia`. */
  nome: string;
  areaPrivativa?: number;
  areaTotal?: number;
  quartos?: number;
  suites?: number;
  vagas?: number;
  /** Planta técnica 2D. */
  plantaUrl?: string;
  /**
   * @deprecated Render isométrico mobiliado.
   *
   * Saiu do editor: era um segundo render por tipologia que exigia arte
   * dedicada, ninguém produzia, e virava mais um campo vazio a explicar em toda
   * tipologia cadastrada. O campo permanece porque projetos publicados já
   * subiram imagens aqui — a vitrine continua exibindo as que existem, e o que
   * acabou foi a obrigação de ter uma.
   */
  axonometricaUrl?: string;
  galeria?: { url: string; legenda: string; categoria?: string }[];
  /** Tour 360º específico desta tipologia (opcional). */
  tour360Url?: string;
  descricao?: string;
}

/**
 * Incorporadora: dona de um conjunto de empreendimentos. Vira o primeiro
 * segmento da URL pública (`/farias/quinta-das-mangueiras`).
 */
export interface Incorporadora {
  id: string;
  slug: string;
  nome: string;
  logoUrl?: string;
  /** Identidade padrão herdada pelos projetos desta incorporadora. */
  tema?: {
    bg?: string;
    primary?: string;
    fontDisplay?: string;
    fontSans?: string;
  };
}

/**
 * Item de uma lista rica — destaque ou item de lazer.
 *
 * `highlights` e `amenities` nasceram como `string[]`, editados numa caixa de
 * texto de uma linha por item: não dava para apagar um item de verdade (só
 * reescrever o bloco inteiro), nem anexar foto ou explicar o que ele é. São
 * entidades da vitrine, não texto solto.
 *
 * O array aceita `string | ItemLista` na LEITURA para os projetos já salvos
 * continuarem abrindo; o normalizador converte, e o próximo save grava no
 * formato novo. Mesma estratégia da migração de plantas → tipologias.
 */
export interface ItemLista {
  id: string;
  titulo: string;
  descricao?: string;
  imagemUrl?: string;
}

/** Texto de um item, aceitando o formato antigo. */
export function tituloDoItem(v: string | ItemLista): string {
  return typeof v === "string" ? v : v.titulo;
}

export interface PontoDeInteresse {
  name: string;
  tempo: string;
  lat: number;
  lng: number;
  /**
   * Categoria do ponto. Texto livre, como `categoriasGaleria`: a lista fechada
   * anterior não tinha onde pôr "Aeroporto", "Marina" ou "Orla" sem mexer no
   * código. As categorias do projeto vivem em `Empreendimento.categoriasPoi`.
   */
  categoria: string;
  /**
   * Traçado da rota até o empreendimento, como `[lng, lat][]`.
   *
   * Guardado no projeto, e não calculado ao abrir a vitrine, porque a rota é
   * DADO, não consulta: o empreendimento e o ponto não se movem. Calcular no
   * editor uma vez e guardar significa que a vitrine não faz requisição
   * nenhuma de roteamento — sem chave exposta, sem cota, sem custo por
   * visitante, e o traçado continua existindo se o serviço sair do ar.
   */
  rota?: [number, number][];
  /** Id estável, atribuído pelo editor. */
  id?: string;
  /**
   * Enquadramento salvo para este ponto. O editor já gravava isto; agora a
   * vitrine usa — antes ela sempre voava para um enquadramento genérico e a
   * câmera escolhida à mão era ignorada.
   */
  camera?: { lng: number; lat: number; height: number; heading: number; pitch: number; roll: number };
}

export interface Empreendimento {
  id: string;
  name: string;
  slug: string;
  address: string;
  neighborhood: string;
  lat: number;
  lng: number;
  terreno: string;
  torres: string;
  pavimentos: string;
  unidades?: number;
  /**
   * Formato antigo das plantas. `area` guarda o NOME da tipologia, não a área.
   * Mantido para compatibilidade: o normalizador deriva `tipologias` daqui.
   */
  plantas: { area: string; vagas: string; descricao?: string; imagemUrl?: string }[];
  /** Tipologias do projeto (novo formato). Derivadas de `plantas` se ausentes. */
  tipologias?: Tipologia[];
  /**
   * Galeria. `categoria` agrupa as imagens (Fachada, Lazer, Áreas comuns…) e é
   * texto livre de propósito: cada empreendimento organiza a sua vitrine de um
   * jeito, e uma lista fechada obrigaria a mexer no código a cada projeto.
   */
  galeria?: { url: string; legenda: string; categoria?: string }[];
  /**
   * Categorias da galeria, NA ORDEM em que devem aparecer na vitrine. São do
   * projeto, não uma lista fixa no código: cada empreendimento organiza a sua
   * vitrine de um jeito. Ausente = derivadas das próprias imagens.
   */
  categoriasGaleria?: string[];
  videos?: { url: string; poster?: string; titulo: string }[];
  tourVirtualUrl?: string;
  peDireito: string;
  elevadores?: string;
  /** Destaques do empreendimento. `string` é o formato antigo — ver `ItemLista`. */
  highlights: (string | ItemLista)[];
  /** Áreas comuns e lazer. `string` é o formato antigo — ver `ItemLista`. */
  amenities: (string | ItemLista)[];
  pontosDeInteresse: PontoDeInteresse[];
  /**
   * Categorias de POI do projeto. Antes a lista era fixa no código, o que
   * obrigava a encaixar "Aeroporto" ou "Marina" em "servicos" — ou mexer no
   * código a cada empreendimento. Ausente = as categorias padrão.
   */
  categoriasPoi?: string[];
  /**
   * Ícone e cor de cada categoria, escolhidos no editor. A chave é o nome da
   * categoria; `icone` é um nome do conjunto do sistema (ver ICONES_POI).
   */
  estiloCategoriaPoi?: Record<string, { icone?: string; cor?: string }>;
  markerImageUrl?: string;
  thumbnailUrl?: string;
  website?: string;
  descricao?: string;
  status: string;
  tipo?: string;
  arquitetura?: string;
  paisagismo?: string;
  interiores?: string;
  perimetro?: { lat: number; lng: number }[];
}

export const pontoDeInteresseSchema = z.object({
  name: z.string(),
  tempo: z.string(),
  lat: z.number(),
  lng: z.number(),
  categoria: z.string(),
});

export const itemListaSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  descricao: z.string().optional(),
  imagemUrl: z.string().optional(),
});

export const empreendimentoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  address: z.string(),
  neighborhood: z.string(),
  lat: z.number(),
  lng: z.number(),
  terreno: z.string(),
  torres: z.string(),
  pavimentos: z.string(),
  unidades: z.number().optional(),
  plantas: z.array(z.object({
    area: z.string(),
    vagas: z.string(),
    descricao: z.string().optional(),
    imagemUrl: z.string().optional(),
  })),
  galeria: z.array(z.object({ url: z.string(), legenda: z.string(), categoria: z.string().optional() })).optional(),
  categoriasGaleria: z.array(z.string()).optional(),
  peDireito: z.string(),
  elevadores: z.string().optional(),
  highlights: z.array(z.union([z.string(), itemListaSchema])),
  amenities: z.array(z.union([z.string(), itemListaSchema])),
  pontosDeInteresse: z.array(pontoDeInteresseSchema),
  categoriasPoi: z.array(z.string()).optional(),
  markerImageUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  website: z.string().optional(),
  descricao: z.string().optional(),
  status: z.string(),
  tipo: z.string().optional(),
  arquitetura: z.string().optional(),
  paisagismo: z.string().optional(),
  interiores: z.string().optional(),
  perimetro: z.array(z.object({ lat: z.number(), lng: z.number() })).optional(),
  tipologias: z.array(z.lazy(() => tipologiaSchema)).optional(),
});

export const tipologiaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  areaPrivativa: z.number().optional(),
  areaTotal: z.number().optional(),
  quartos: z.number().optional(),
  suites: z.number().optional(),
  vagas: z.number().optional(),
  plantaUrl: z.string().optional(),
  axonometricaUrl: z.string().optional(),
  galeria: z.array(z.object({ url: z.string(), legenda: z.string() })).optional(),
  tour360Url: z.string().optional(),
  descricao: z.string().optional(),
});

export const unidadeSchema = z.object({
  id: z.string(),
  torre: z.string(),
  pavimento: z.number(),
  numero: z.string(),
  tipologia: z.string(),
  tipologiaId: z.string().optional(),
  status: z.enum(["disponivel", "reservada", "vendida"]),
  preco: z.number().optional(),
  areaPrivativa: z.number().optional(),
  areaTotal: z.number().optional(),
  quartos: z.number().optional(),
  suites: z.number().optional(),
  vagas: z.number().optional(),
  orientacao: z.enum(["N", "NE", "L", "SE", "S", "SO", "O", "NO"]).optional(),
  observacao: z.string().optional(),
  camera: z
    .object({ angulo: z.number(), inclinacao: z.number(), distancia: z.number() })
    .optional(),
  area: z.string().optional(),
});

export const incorporadoraSchema = z.object({
  id: z.string(),
  slug: z.string(),
  nome: z.string(),
  logoUrl: z.string().optional(),
  tema: z
    .object({
      bg: z.string().optional(),
      primary: z.string().optional(),
      fontDisplay: z.string().optional(),
      fontSans: z.string().optional(),
    })
    .optional(),
});
