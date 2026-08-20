import { getSupabase } from "./supabase";
import type { Empreendimento, Incorporadora, ItemLista, Tipologia, Unidade, UnidadeStatus } from "@shared/schema";
import type { CameraView } from "./placements";
import type { Building3D, MapaBase } from "./vision3d-config";
import type { TorreDef } from "./unidades";
import { DEFAULT_PAV_CFG, type PavimentosCfg, type NivelDef } from "./pavimentos";
import { parseArea, tipologiaDaUnidade, tipologiasDe } from "./tipologias";
import type { EntornoCfg } from "./entorno";
import * as local from "./local-store";

/**
 * MODO LOCAL: em desenvolvimento os projetos vivem em `data/projects/` e são
 * servidos pelo próprio Express — sem Supabase, sem conta, sem RLS. Em produção
 * (build) tudo volta para o Supabase, onde a RLS é a proteção real.
 *
 * As funções exportadas abaixo têm a mesma assinatura nos dois modos, então as
 * páginas não sabem — nem precisam saber — qual está ativo.
 */
/**
 * Banco em uso: Supabase (padrão) ou os arquivos de `data/projects/`.
 *
 * Era `import.meta.env.DEV`, e isso amarrava duas decisões que não são a
 * mesma: "estou rodando na minha máquina" virava "edito um banco diferente do
 * que está no ar". O efeito prático era um projeto calibrado localmente que
 * simplesmente não existia em produção, e nenhum aviso disso em lugar nenhum.
 *
 * Agora o padrão é o Supabase em qualquer ambiente — `npm run dev` e o site
 * publicado mexem nos MESMOS dados. O modo local continua alcançável para
 * trabalhar sem rede, mas por escolha explícita: `VITE_MODO_LOCAL=1` no `.env`.
 */
export const MODO_LOCAL = import.meta.env.VITE_MODO_LOCAL === "1";

/**
 * Plataforma IVM Lite: cada projeto = UM empreendimento (vitrine completa).
 * O projeto inteiro (empreendimento rico + config 3D) é guardado no jsonb
 * `data` da tabela `ivm_lites`, então qualquer campo novo é preservado sem
 * migração de schema.
 */

/**
 * Vista/câmera nomeada. É a unidade da cinemática: a ORDEM das vistas no array
 * `sectionCameras` é a ordem do tour — não há campo de índice, porque manter
 * um número sincronizado com a posição do array só cria estado divergente.
 */
export interface NamedView extends CameraView {
  id: string;
  name: string;
  /** Se definido, corta o modelo nesta altura (Z local) ao ativar a vista. */
  cutFloorZ?: number | null;
  /** Vista de abertura do projeto — é o "Main view" da experiência pública. */
  isMain?: boolean;
  /** Segundos do voo até esta vista. */
  duracao?: number;
  /** Segundos parado nela antes de seguir para a próxima. */
  espera?: number;
  /** Curva do movimento da câmera. */
  easing?: "linear" | "suave" | "cinematica";
  /**
   * Miniatura capturada no editor (data URL JPEG pequeno). Fica dentro do
   * projeto para a lista de vistas ser reconhecível de relance, sem gerar
   * arquivos órfãos no Storage.
   */
  thumbUrl?: string;
}

/** Ponto de interesse editável (com câmera própria opcional). */
export interface EditablePoi {
  id: string;
  name: string;
  categoria: string;
  lat: number;
  lng: number;
  tempo: string;
  camera?: CameraView;
  /** Traçado até o empreendimento — ver `PontoDeInteresse.rota`. */
  rota?: [number, number][];
  /**
   * Texto de apoio do ponto, exibido no cartão da vitrine.
   *
   * O nome e o tempo dizem O QUE e A QUE DISTÂNCIA. Não dizem por que aquilo
   * importa para quem está comprando — que o colégio é bilíngue, que o mercado
   * abre 24h. É esse argumento que fecha venda, e ele não cabia em lugar nenhum.
   */
  descricao?: string;
  /**
   * Fotos do ponto, em ordem. A primeira é a capa do cartão.
   *
   * URLs de asset do projeto, como logo e capa — nunca data-URL embutida: o
   * JSON do projeto viaja inteiro a cada gravação e a cada rascunho no
   * `localStorage`, que tem cota pequena.
   */
  fotos?: string[];
}

/** Identidade visual do projeto (aplicada na experiência pública). */
export interface Branding {
  /** Cor de fundo/base (ex: #04141d). */
  bg?: string;
  /** Cor primária/destaque (ex: #2dd4bf). */
  primary?: string;
  /** Logo (URL) e símbolo (usado como marcador no mapa). */
  logoUrl?: string;
  symbolUrl?: string;
  /** Famílias de fonte (nome CSS) — display/serif e sans. */
  fontDisplay?: string;
  fontSans?: string;
}

export const POI_CATEGORIES = [
  "praia", "shopping", "mercado", "saude", "educacao",
  "lazer", "gastronomia", "servicos", "academia", "via",
] as const;

/**
 * Ambiente: como a cena abre e o que o visitante pode controlar.
 *
 * Um aviso honesto sobre o modo noturno: o Cesium não tem luzes de área. Janela
 * acesa é material EMISSIVO assado no GLB na exportação — o que existe aqui é a
 * hora do sol, a intensidade da luz e um realce que impede o prédio de virar
 * uma silhueta preta. Se o modelo sair da Unreal com emissivos, eles aparecem
 * sozinhos; se não, o noturno é estilizado, não iluminado.
 */
export interface AmbienteCfg {
  /** Hora de abertura, em minutos do dia (780 = 13:00). */
  horaPadrao?: number;
  /** Estação de abertura. */
  estacaoPadrao?: "verao" | "outono" | "inverno" | "primavera";
  /** Modo noturno disponível para o visitante. */
  noturnoDisponivel?: boolean;
  /** Hora usada ao ligar o modo noturno (minutos do dia). */
  horaNoturna?: number;
  /** Quanto o modelo é realçado à noite (0 = silhueta, 1 = bem claro). */
  realceNoturno?: number;
  /** Bússola no topo da tela. */
  mostrarBussola?: boolean;
  /** Botão de captura de tela. */
  permitirScreenshot?: boolean;
  /** Barra solar visível para o visitante. */
  mostrarBarraSolar?: boolean;
}

export const AMBIENTE_PADRAO: Required<AmbienteCfg> = {
  horaPadrao: 780,
  estacaoPadrao: "verao",
  noturnoDisponivel: true,
  horaNoturna: 1200, // 20:00
  realceNoturno: 0.45,
  mostrarBussola: true,
  permitirScreenshot: true,
  mostrarBarraSolar: true,
};

/**
 * Como o interessado fala com quem vende.
 *
 * Faltava o fim do funil: o cliente achava a unidade, via a planta, o preço e a
 * orientação — e a experiência acabava ali, sem nenhum caminho para a corretora.
 * Todos os campos são opcionais; o que estiver preenchido vira um botão.
 */
export interface ContatoCfg {
  /** Só dígitos, com DDI e DDD (ex: 5582999998888). */
  whatsapp?: string;
  telefone?: string;
  email?: string;
  /**
   * Texto que já vai escrito na conversa. `{unidade}` e `{empreendimento}` são
   * trocados pelos valores reais — sem isso o corretor recebe "Olá, tenho
   * interesse" e não sabe de qual apartamento, que é a informação que importa.
   */
  mensagem?: string;
}

/** Mensagem padrão quando o projeto não escreve a sua. */
export const CONTATO_MENSAGEM_PADRAO =
  "Olá! Tenho interesse na unidade {unidade} do {empreendimento}.";

/** Aplica os marcadores da mensagem de contato. */
export function montarMensagemContato(
  modelo: string | undefined,
  dados: { unidade: string; empreendimento: string },
): string {
  return (modelo?.trim() || CONTATO_MENSAGEM_PADRAO)
    .replace(/\{unidade\}/g, dados.unidade)
    .replace(/\{empreendimento\}/g, dados.empreendimento);
}

/** Config 3D do projeto (posição/encaixe do modelo + câmeras + marca). */
export interface ProjectConfig {
  /** Canais de contato oferecidos ao visitante. */
  contato?: ContatoCfg;
  /**
   * Recorte da fotogrametria sob o empreendimento. Presente = ligado.
   *
   * A captura do Google traz o que existia no terreno na data do voo — mato,
   * obra, ou o prédio antigo. O GLB novo entra por cima e os dois disputam o
   * mesmo espaço. Recortando, o terreno abre e o empreendimento encaixa limpo.
   *
   * NÃO guarda a pegada: ela é MEDIDA no GLB a cada carga (ver `medirGlb`), do
   * arquivo que estiver configurado. Assim acompanha sozinha qualquer troca de
   * modelo ou de encaixe, e funciona num projeto recém-criado — não depende de
   * torre calibrada nem de nada desenhado à mão.
   *
   * É uma CAIXA, não a silhueta do prédio: a forma real não existe nos
   * metadados do glTF. Ver o comentário em `glb-bounds.ts`.
   */
  recorteTerreno?: {
    /** Sobra em volta da pegada (1 = exatamente a caixa do modelo). */
    folga?: number;
  };
  /** Vias desenhadas sobre a fotogrametria (traçadas no mapa, em lat/lng). */
  entorno?: EntornoCfg;
  /** Ambiente e iluminação da experiência pública. */
  ambiente?: AmbienteCfg;
  /** Vistas salvas / cortes. */
  sectionCameras?: NamedView[];
  /** Identidade visual. */
  branding?: Branding;
  /** Torres do empreendimento (ids usados pelas unidades). */
  torres?: TorreDef[];
  /** Calibração dos pavimentos (corte 3D) para este modelo. */
  pavimentosCfg?: PavimentosCfg;
  /**
   * Níveis de corte editados no editor. Quando existem, substituem a escada
   * automática derivada de `pavimentosCfg` — que passa a ser só o gerador.
   */
  niveis?: NivelDef[];
  /** Integração com CRM para disponibilidade em tempo real. */
  crm?: CrmConfig;
  /**
   * Encaixe do modelo TRAVADO.
   *
   * Posicionar o GLB sobre a fotogrametria é trabalho de precisão que se faz
   * uma vez; depois disso o pivô do empreendimento vira só um risco — ele fica
   * no meio da cena enquanto se edita unidade, câmera ou POI, e um arraste
   * distraído desmancha a calibração sem aviso. Travado, o pivô some e os
   * controles de transformação ficam inertes até alguém destravar de propósito.
   */
  travado?: boolean;
  modelUrl?: string;
  /**
   * Mini mapa (GLB) que compõe a cena quando a cidade 3D está desligada.
   *
   * Guardado à parte do `modelUrl` e com transformação própria: ver `MapaBase`
   * em `vision3d-config`. Vazio é o estado normal — sem ele o modo sem cidade
   * segue funcionando como sempre funcionou, com o prédio sobre o fundo liso.
   */
  mapaUrl?: string;
  mapaHeading?: number;
  mapaScale?: number;
  mapaHeightOffset?: number;
  mapaOffsetEast?: number;
  mapaOffsetNorth?: number;
  heading: number;
  pitch: number;
  roll: number;
  scale: number;
  heightOffset: number;
  offsetEast: number;
  offsetNorth: number;
  /** Posição base (sobrepõe empreendimento.lat/lng se definida). */
  lat?: number;
  lng?: number;
  camera?: CameraView;
  /**
   * Enquadramento ao abrir a vista de UNIDADES.
   *
   * A câmera inicial enquadra o empreendimento por fora, que é o que se quer ao
   * abrir a experiência. Escolher um apartamento é outra tarefa: precisa da
   * torre preenchendo a tela, no ângulo em que as fachadas se distinguem. Sem
   * isto o usuário caía nas unidades de onde quer que a câmera estivesse.
   */
  cameraUnidades?: CameraView;
  /**
   * Enquadramento ao abrir a seção ENTORNO.
   *
   * O oposto do de unidades: precisa recuar até os pontos de interesse caberem
   * na tela junto com o empreendimento. Colado na fachada, a lista de entorno
   * fala de lugares que não estão em lugar nenhum da imagem.
   */
  cameraEntorno?: CameraView;
  placeholder?: { width: number; depth: number; height: number };
  /** Fuso do local (ex: -3 Maragogi, -4 Campo Grande). */
  tzOffset?: number;
}

/**
 * Conexão com CRM para disponibilidade. O IVM Lite lê de um endpoint que
 * devolve o status por unidade; `mode: "manual"` = espelho editado à mão.
 */
export interface CrmConfig {
  mode: "manual" | "endpoint";
  /** URL que devolve [{ numero|id, torre?, status }] ou {unidades:[...]}. */
  url?: string;
  /** Minutos entre atualizações (0 = só ao abrir). */
  refreshMin?: number;
  /** Mapa de status do CRM → status do IVM (ex: {"VENDIDO":"vendida"}). */
  statusMap?: Record<string, UnidadeStatus>;
}

export interface ProjectData {
  empreendimento: Empreendimento;
  config: ProjectConfig;
  /** Espelho de vendas do projeto. */
  unidades?: Unidade[];
}

/** Linha da tabela ivm_lites. */
export interface IvmProject {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  data: ProjectData;
  updated_at?: string;
  /** Dona do projeto — define o primeiro segmento da URL pública. */
  incorporadora_id?: string | null;
  /** Preenchido quando a consulta traz a incorporadora junto (para montar a URL). */
  incorporadora?: Incorporadora | null;
}

// --- Slugs reservados -------------------------------------------------------

/**
 * A rota pública é `/:incorporadora/:empreendimento` — um padrão de dois
 * segmentos que capturaria `/admin/123` e `/v/algum-slug` também. A ordem das
 * rotas no Wouter resolve o roteamento, mas ainda é preciso impedir que alguém
 * crie uma incorporadora chamada "admin" e torne o painel inalcançável.
 */
export const SLUGS_RESERVADOS = new Set([
  "admin", "api", "v", "editor", "explorar", "assets", "models", "gallery",
  "plantas", "videos", "fonts", "brand", "public", "static", "login", "app",
  "cesium", "src", "node_modules", "favicon.ico", "index.html",
]);

export function slugReservado(slug: string): boolean {
  return SLUGS_RESERVADOS.has(slug.trim().toLowerCase());
}

/**
 * Texto livre → slug de URL. Acentos viram a letra base (NFD + corte dos
 * diacríticos), o resto vira hífen. Vive aqui, e não em cada tela, porque o
 * /admin e o editor precisam produzir EXATAMENTE o mesmo endereço: duas
 * implementações parecidas acabariam divergindo num caso de acento.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

// --- Normalização de projetos legados ---------------------------------------

/**
 * Converte um projeto salvo no formato antigo para o novo, na leitura.
 *
 * Como o projeto inteiro vive num `jsonb`, não há migração de banco a rodar:
 * os dados antigos são atualizados em memória toda vez que o projeto é lido, e
 * gravados no formato novo no próximo save. Isso mantém funcionando qualquer
 * IVM Lite já publicado enquanto o editor evolui.
 *
 * O que ele resolve:
 * - deriva `empreendimento.tipologias` de `plantas[]` + `unidades[]`;
 * - liga cada unidade à sua tipologia (`tipologiaId`);
 * - converte `area: "48 m²"` (texto) em `areaPrivativa: 48` (número), sem o
 *   qual os filtros de faixa não têm como operar.
 *
 * O que ele deliberadamente NÃO faz é copiar área/quartos/suítes/vagas da
 * tipologia para dentro da unidade. Ele fazia, e o efeito colateral era o
 * contrário do pretendido: a cópia entrava no estado do editor e voltava
 * gravada no próximo save, então a unidade passava a carregar um retrato da
 * tipologia no instante da leitura — corrigir a área da tipologia depois não
 * mudava mais nada na vitrine. Essa herança agora acontece na leitura, em
 * `unidadesComTipologia`, e a tipologia continua sendo a fonte única.
 */
/**
 * Converte uma lista rica do formato antigo (`string[]`) para `ItemLista[]`.
 *
 * O id é derivado do texto, não sorteado: assim ele é estável entre recargas
 * enquanto o projeto não for salvo no formato novo — com id aleatório, cada
 * leitura geraria chaves diferentes e o React remontaria a lista inteira a
 * cada render.
 */
export function normalizarLista(v: (string | ItemLista)[] = []): ItemLista[] {
  return v.map((item, i) =>
    typeof item === "string"
      ? { id: `item-${i}-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`, titulo: item }
      : item,
  );
}

export function normalizeProjectData(data: ProjectData): ProjectData {
  const emp = data.empreendimento;
  if (!emp) return data;

  const unidades = data.unidades ?? [];
  const tipologias: Tipologia[] = tipologiasDe(emp, unidades);

  const unidadesNorm: Unidade[] = unidades.map((u) => {
    const t = tipologiaDaUnidade(u, tipologias);
    return {
      ...u,
      tipologiaId: u.tipologiaId ?? t?.id,
      areaPrivativa: u.areaPrivativa ?? parseArea(u.area),
    };
  });

  return {
    ...data,
    empreendimento: {
      ...emp,
      tipologias,
      // Destaques e lazer viram itens de verdade já na leitura, para o editor
      // e a vitrine nunca precisarem saber que existiu um formato de texto.
      highlights: normalizarLista(emp.highlights),
      amenities: normalizarLista(emp.amenities),
    },
    unidades: unidadesNorm,
  };
}

/** Aplica o normalizador numa linha vinda do banco (tolerante a `data` vazio). */
function normalizeRow<T extends { data?: ProjectData }>(row: T): T {
  if (!row?.data?.empreendimento) return row;
  return { ...row, data: normalizeProjectData(row.data) };
}

const CONFIG_DEFAULTS: ProjectConfig = {
  heading: 0,
  pitch: 0,
  roll: 0,
  scale: 1,
  heightOffset: 0,
  offsetEast: 0,
  offsetNorth: 0,
  placeholder: { width: 30, depth: 30, height: 96 },
  tzOffset: -3,
};

/** Id curto e estável para POIs/vistas criados no editor. */
export function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Extrai lat/lng de: "-8.93, -35.17" | link do Google Maps (@lat,lng /
 * ?q=lat,lng / !3dlat!4dlng) | "lat lng". Retorna null se não reconhecer.
 */
export function parseLocationInput(input: string): { lat: number; lng: number } | null {
  const s = input.trim();
  if (!s) return null;
  const ok = (la: number, ln: number) =>
    Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
      ? { lat: la, lng: ln }
      : null;

  // Google Maps: !3d<lat>!4d<lng>
  const m3d = s.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (m3d) return ok(parseFloat(m3d[1]), parseFloat(m3d[2]));

  // Google Maps: @lat,lng,zoom
  const mAt = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (mAt) return ok(parseFloat(mAt[1]), parseFloat(mAt[2]));

  // ?q=lat,lng  ou  ?query=lat,lng  ou  /place/lat,lng
  const mQ = s.match(/(?:q|query|ll|daddr)=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
  if (mQ) return ok(parseFloat(mQ[1]), parseFloat(mQ[2]));

  // "lat, lng" ou "lat lng"
  const mPlain = s.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (mPlain) return ok(parseFloat(mPlain[1]), parseFloat(mPlain[2]));

  return null;
}

// --- Unidades (espelho de vendas) ------------------------------------------

/** Torres e pavimentos efetivos de um projeto (com defaults). */
export function projectTorres(data: ProjectData): TorreDef[] {
  if (data.config.torres?.length) return data.config.torres;
  const out: TorreDef[] = [];
  for (const u of data.unidades ?? []) {
    if (!out.some((t) => t.id === u.torre)) out.push({ id: u.torre, label: u.torre });
  }
  return out;
}

export function projectPavCfg(data: ProjectData): PavimentosCfg {
  return { ...DEFAULT_PAV_CFG, ...(data.config.pavimentosCfg ?? {}) };
}

/** Ambiente efetivo do projeto (com os padrões preenchidos). */
export function projectAmbiente(data: ProjectData): Required<AmbienteCfg> {
  return { ...AMBIENTE_PADRAO, ...(data.config.ambiente ?? {}) };
}

/**
 * Busca disponibilidade no CRM e aplica sobre o espelho local (casando por id
 * ou torre+numero). Falha silenciosa: mantém o espelho salvo se o CRM cair.
 */
export async function aplicarCrm(unidades: Unidade[], crm?: CrmConfig): Promise<Unidade[]> {
  if (!crm || crm.mode !== "endpoint" || !crm.url) return unidades;
  try {
    const r = await fetch(crm.url);
    if (!r.ok) return unidades;
    const body = await r.json();
    const rows: any[] = Array.isArray(body) ? body : (body.unidades ?? body.data ?? []);
    const map = new Map<string, UnidadeStatus>();
    for (const row of rows) {
      const raw = String(row.status ?? "");
      const status = crm.statusMap?.[raw] ?? (raw as UnidadeStatus);
      if (!["disponivel", "reservada", "vendida"].includes(status)) continue;
      if (row.id) map.set(String(row.id), status);
      if (row.numero) map.set(`${row.torre ?? ""}-${row.numero}`, status);
    }
    return unidades.map((u) => ({ ...u, status: map.get(u.id) ?? map.get(`${u.torre}-${u.numero}`) ?? u.status }));
  } catch {
    return unidades;
  }
}

// --- Auth -------------------------------------------------------------------
// No modo local não há sessão: o editor é liberado direto.
export async function getUser() {
  if (MODO_LOCAL) return { id: "local", email: "modo-local" } as unknown as { id: string };
  const sb = await getSupabase();
  const { data } = await sb.auth.getUser();
  return data.user;
}
export async function onAuthChange(cb: (signedIn: boolean) => void) {
  if (MODO_LOCAL) {
    cb(true);
    return () => {};
  }
  const sb = await getSupabase();
  const { data } = sb.auth.onAuthStateChange((_e, session) => cb(!!session));
  return () => data.subscription.unsubscribe();
}
export async function signIn(email: string, password: string) {
  const sb = await getSupabase();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error?.message;
}
export async function signUp(email: string, password: string) {
  const sb = await getSupabase();
  const { error } = await sb.auth.signUp({ email, password });
  return error?.message;
}
export async function signOut() {
  if (MODO_LOCAL) return;
  const sb = await getSupabase();
  await sb.auth.signOut();
}

// --- Incorporadoras ---------------------------------------------------------

/** Colunas do banco → objeto do app (o banco usa snake_case). */
function toIncorporadora(row: Record<string, unknown>): Incorporadora {
  return {
    id: String(row.id),
    slug: String(row.slug),
    nome: String(row.nome ?? ""),
    logoUrl: (row.logo_url as string) ?? undefined,
    tema: (row.tema as Incorporadora["tema"]) ?? undefined,
  };
}

/**
 * Reconhece o erro de "a migração 0002 ainda não foi aplicada" — tabela
 * `incorporadoras` ausente ou relacionamento desconhecido pelo PostgREST.
 *
 * Existe para o painel continuar utilizável num banco ainda não migrado: em vez
 * de a tela quebrar, ela simplesmente não mostra incorporadoras.
 */
function semIncorporadoras(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const m = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" || // undefined_table
    error.code === "PGRST200" || // relacionamento não encontrado no schema cache
    (m.includes("incorporadora") &&
      (m.includes("does not exist") ||
        m.includes("relationship") ||
        m.includes("schema cache")))
  );
}

/** true se a migração 0002 já foi aplicada (usado para avisar no /admin). */
export async function temIncorporadoras(): Promise<boolean> {
  if (MODO_LOCAL) return true; // no modo local não há migração a aplicar
  const sb = await getSupabase();
  const { error } = await sb.from("incorporadoras").select("id").limit(1);
  return !semIncorporadoras(error);
}

export async function listIncorporadoras(): Promise<Incorporadora[]> {
  if (MODO_LOCAL) return local.localListIncorporadoras();
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("incorporadoras")
    .select("id, slug, nome, logo_url, tema")
    .order("nome");
  if (semIncorporadoras(error)) return [];
  if (error) throw new Error(error.message);
  return (data ?? []).map(toIncorporadora);
}

export async function getIncorporadoraBySlug(slug: string): Promise<Incorporadora | null> {
  if (MODO_LOCAL) return local.localGetIncorporadoraBySlug(slug);
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("incorporadoras")
    .select("id, slug, nome, logo_url, tema")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return toIncorporadora(data as Record<string, unknown>);
}

export async function createIncorporadora(
  nome: string,
  slug: string,
  logoUrl?: string,
): Promise<Incorporadora> {
  if (slugReservado(slug)) throw new Error(`"${slug}" é um endereço reservado do sistema.`);
  if (MODO_LOCAL) return local.localCreateIncorporadora(nome, slug, logoUrl);
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("incorporadoras")
    .insert({ nome, slug, logo_url: logoUrl ?? null })
    .select("id, slug, nome, logo_url, tema")
    .single();
  if (error) throw new Error(error.message);
  return toIncorporadora(data as Record<string, unknown>);
}

export async function updateIncorporadora(
  id: string,
  patch: Partial<Pick<Incorporadora, "nome" | "slug" | "logoUrl" | "tema">>,
): Promise<void> {
  if (patch.slug && slugReservado(patch.slug)) {
    throw new Error(`"${patch.slug}" é um endereço reservado do sistema.`);
  }
  if (MODO_LOCAL) return local.localUpdateIncorporadora(id, patch);
  const sb = await getSupabase();
  const row: Record<string, unknown> = {};
  if (patch.nome !== undefined) row.nome = patch.nome;
  if (patch.slug !== undefined) row.slug = patch.slug;
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl;
  if (patch.tema !== undefined) row.tema = patch.tema;
  const { error } = await sb.from("incorporadoras").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteIncorporadora(id: string): Promise<void> {
  if (MODO_LOCAL) return local.localDeleteIncorporadora(id);
  const sb = await getSupabase();
  const { error } = await sb.from("incorporadoras").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** URL pública do projeto: `/incorporadora/empreendimento` (ou `/v/slug` sem dona). */
export function projectPath(p: {
  slug: string;
  incorporadora?: Incorporadora | null;
}): string {
  return p.incorporadora?.slug ? `/${p.incorporadora.slug}/${p.slug}` : `/v/${p.slug}`;
}

// --- CRUD -------------------------------------------------------------------

/** Campos do projeto sem o join — funciona mesmo antes da migração 0002. */
const PROJECT_SELECT_BASE = "id, slug, name, published, data, updated_at";

/** Campos lidos em toda consulta de projeto, incluindo a incorporadora. */
const PROJECT_SELECT =
  PROJECT_SELECT_BASE +
  ", incorporadora_id, incorporadoras ( id, slug, nome, logo_url, tema )";

/**
 * Achata o join do PostgREST (`incorporadoras`) no campo `incorporadora`.
 * Recebe `unknown` porque o tipo gerado pelo supabase-js para uma linha com
 * join embutido não é um objeto simples — ele carrega o caso de erro junto.
 */
function toProject(row: unknown): IvmProject {
  const r = row as Record<string, unknown>;
  const join = r.incorporadoras as Record<string, unknown> | null | undefined;
  const { incorporadoras: _drop, ...rest } = r;
  return normalizeRow({
    ...(rest as unknown as IvmProject),
    incorporadora: join ? toIncorporadora(join) : null,
  });
}

/**
 * Projetos do PAINEL — só os do usuário logado.
 *
 * Antes a consulta não filtrava nada, e o RLS sozinho não resolve: a política
 * `ivm_lites_public_read` libera a leitura de tudo que está publicado, para
 * qualquer um. O efeito no /admin era todo mundo enxergando a carteira inteira
 * de projetos alheios e podendo abrir o editor de qualquer um — o salvamento
 * até era recusado depois (`ivm_lites_owner_all`), mas só depois do trabalho
 * feito, com uma mensagem que não explica nada.
 *
 * Ler o que é público é papel da VITRINE (`getProjectBySlug` e afins). O
 * painel é a área de trabalho de uma pessoa, então a consulta se limita ao
 * dono. Sem sessão não há painel nenhum: devolve vazio em vez de listar o que
 * está publicado.
 */
export async function listProjects(): Promise<IvmProject[]> {
  if (MODO_LOCAL) return (await local.localListProjects()).map(normalizeRow);
  const sb = await getSupabase();
  const { data: sessao } = await sb.auth.getUser();
  const dono = sessao.user?.id;
  if (!dono) return [];
  const run = (sel: string) =>
    sb.from("ivm_lites").select(sel).eq("owner", dono)
      .order("updated_at", { ascending: false });
  let res = await run(PROJECT_SELECT);
  // Banco ainda não migrado: refaz sem o join para o painel seguir funcionando.
  if (semIncorporadoras(res.error)) res = await run(PROJECT_SELECT_BASE);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map((r) => toProject(r));
}

export async function getProjectBySlug(slug: string): Promise<IvmProject | null> {
  if (MODO_LOCAL) {
    const p = await local.localGetProjectBySlug(slug);
    return p ? normalizeRow(p) : null;
  }
  const sb = await getSupabase();
  const run = (sel: string) =>
    sb.from("ivm_lites").select(sel).eq("slug", slug).maybeSingle();
  let res = await run(PROJECT_SELECT);
  if (semIncorporadoras(res.error)) res = await run(PROJECT_SELECT_BASE);
  return res.data ? toProject(res.data) : null;
}

/**
 * Projeto pela URL pública `/incorporadora/empreendimento`. Resolve a
 * incorporadora primeiro para que o mesmo slug de empreendimento possa existir
 * em incorporadoras diferentes.
 */
export async function getProjectByPath(
  incorporadoraSlug: string,
  projetoSlug: string,
): Promise<IvmProject | null> {
  if (MODO_LOCAL) {
    const p = await local.localGetProjectByPath(incorporadoraSlug, projetoSlug);
    return p ? normalizeRow(p) : null;
  }
  const inc = await getIncorporadoraBySlug(incorporadoraSlug);
  if (!inc) return null;
  const sb = await getSupabase();
  const { data } = await sb
    .from("ivm_lites")
    .select(PROJECT_SELECT)
    .eq("incorporadora_id", inc.id)
    .eq("slug", projetoSlug)
    .maybeSingle();
  return data ? toProject(data) : null;
}

export async function getProjectById(id: string): Promise<IvmProject | null> {
  if (MODO_LOCAL) {
    const p = await local.localGetProjectById(id);
    return p ? normalizeRow(p) : null;
  }
  const sb = await getSupabase();
  const run = (sel: string) => sb.from("ivm_lites").select(sel).eq("id", id).maybeSingle();
  let res = await run(PROJECT_SELECT);
  if (semIncorporadoras(res.error)) res = await run(PROJECT_SELECT_BASE);
  return res.data ? toProject(res.data) : null;
}

export async function createProject(
  name: string,
  slug: string,
  data: ProjectData,
  published = false,
  incorporadoraId?: string | null,
): Promise<IvmProject> {
  if (MODO_LOCAL) return local.localCreateProject(name, slug, data, published, incorporadoraId);
  const sb = await getSupabase();
  const base = {
    name,
    slug,
    data,
    published,
    lat: data.config.lat ?? data.empreendimento.lat,
    lng: data.config.lng ?? data.empreendimento.lng,
  };
  const run = (payload: Record<string, unknown>, sel: string) =>
    sb.from("ivm_lites").insert(payload).select(sel).single();

  let res = await run(
    { ...base, incorporadora_id: incorporadoraId ?? null },
    `${PROJECT_SELECT_BASE}, incorporadora_id`,
  );
  // Banco ainda não migrado: cria sem a coluna de incorporadora.
  if (semIncorporadoras(res.error)) res = await run(base, PROJECT_SELECT_BASE);
  const { data: row, error } = res;
  if (error) throw new Error(error.message);
  // Guarda-chuva: se o jsonb voltar vazio (cache de schema do PostgREST
  // desatualizado), grava o data num update explícito.
  const saved = row as unknown as IvmProject;
  if (!saved.data || !saved.data.empreendimento) {
    await sb.from("ivm_lites").update({ data }).eq("id", saved.id);
    saved.data = data;
  }
  return saved;
}

export async function updateProject(
  id: string,
  patch: {
    name?: string;
    slug?: string;
    published?: boolean;
    data?: ProjectData;
    incorporadoraId?: string | null;
  },
): Promise<void> {
  if (MODO_LOCAL) return local.localUpdateProject(id, patch);
  const sb = await getSupabase();
  const { incorporadoraId, ...rest } = patch;
  const row: Record<string, unknown> = { ...rest };
  if (incorporadoraId !== undefined) row.incorporadora_id = incorporadoraId;

  let { error } = await sb.from("ivm_lites").update(row).eq("id", id);
  // Banco ainda não migrado: salva o resto e ignora só a incorporadora.
  if (semIncorporadoras(error) && incorporadoraId !== undefined) {
    const { incorporadora_id: _drop, ...semInc } = row;
    ({ error } = await sb.from("ivm_lites").update(semInc).eq("id", id));
    if (!error) {
      throw new Error(
        "Projeto salvo, mas a incorporadora não foi aplicada: rode a migração 0002 no Supabase.",
      );
    }
  }
  if (error) throw new Error(error.message);
}

/**
 * Duplica um projeto: copia o conteúdo inteiro e nasce como rascunho, na mesma
 * incorporadora. É o que faz a plataforma escalar — o segundo empreendimento
 * de uma incorporadora reaproveita marca, ambiente e calibração de pavimentos
 * em vez de começar do zero.
 */
export async function duplicateProject(id: string, novoNome?: string): Promise<IvmProject | null> {
  const origem = await getProjectById(id);
  if (!origem) return null;
  const nome = novoNome?.trim() || `${origem.name} (cópia)`;
  const base = origem.slug.replace(/-copia(-\d+)?$/, "");
  const slug = `${base}-copia-${Math.random().toString(36).slice(2, 6)}`;
  // Cópia profunda: sem isto os dois projetos compartilhariam os mesmos
  // objetos aninhados e editar um mexeria no outro.
  const data = JSON.parse(JSON.stringify(origem.data)) as ProjectData;
  data.empreendimento = { ...data.empreendimento, id: slug, slug, name: nome };
  return createProject(nome, slug, data, false, origem.incorporadora_id ?? null);
}

export async function deleteProject(id: string): Promise<void> {
  if (MODO_LOCAL) return local.localDeleteProject(id);
  const sb = await getSupabase();
  const { error } = await sb.from("ivm_lites").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- Storage (assets: .glb, imagens) ---------------------------------------
export async function uploadAsset(projectId: string, file: File): Promise<string> {
  if (MODO_LOCAL) return local.localUploadAsset(file);
  const sb = await getSupabase();
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${projectId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await sb.storage.from("ivm-assets").upload(path, file, { upsert: true });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("ivm-assets").getPublicUrl(path);
  await sb.from("ivm_assets").insert({
    ivm_lite_id: projectId,
    kind: ext.toLowerCase() === "glb" ? "glb" : "image",
    path,
    url: data.publicUrl,
    size: file.size,
  });
  return data.publicUrl;
}

// --- Adaptador para a cena 3D ----------------------------------------------
export function projectToBuilding3D(data: ProjectData): Building3D {
  const emp = data.empreendimento;
  const c = { ...CONFIG_DEFAULTS, ...data.config };
  return {
    id: emp.id,
    modelUrl: c.modelUrl,
    heading: c.heading,
    pitch: c.pitch,
    roll: c.roll,
    scale: c.scale,
    heightOffset: c.heightOffset,
    offsetEast: c.offsetEast,
    offsetNorth: c.offsetNorth,
    placeholder: c.placeholder,
    empreendimento: emp,
    lat: c.lat ?? emp.lat,
    lng: c.lng ?? emp.lng,
    camera: c.camera,
  };
}

/**
 * Mini mapa do projeto, ou `null` se não houver.
 *
 * A âncora é a MESMA do empreendimento (`c.lat ?? emp.lat`), e não uma
 * coordenada própria: o mini mapa existe para receber este prédio. Se a
 * implantação for movida, o terreno vai junto — separá-los daria duas verdades
 * sobre onde o empreendimento fica.
 */
export function projectMapaBase(data: ProjectData): MapaBase | null {
  const c = { ...CONFIG_DEFAULTS, ...data.config };
  if (!c.mapaUrl) return null;
  const emp = data.empreendimento;
  return {
    url: c.mapaUrl,
    heading: c.mapaHeading ?? 0,
    scale: c.mapaScale ?? 1,
    heightOffset: c.mapaHeightOffset ?? 0,
    offsetEast: c.mapaOffsetEast ?? 0,
    offsetNorth: c.mapaOffsetNorth ?? 0,
    lat: c.lat ?? emp.lat,
    lng: c.lng ?? emp.lng,
  };
}

