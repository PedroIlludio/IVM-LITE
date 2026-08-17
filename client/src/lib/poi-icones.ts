import {
  MapPin, ShoppingBag, ShoppingCart, Heart, GraduationCap, Trees,
  UtensilsCrossed, Wrench, Dumbbell, Pill, Route, Waves, Plane, Ship,
  Building2, Bus, Coffee, Landmark, Church, Fuel, Baby, Dog, Bike, Hotel,
  type LucideIcon,
} from "lucide-react";

/**
 * Ícones que uma categoria de POI pode usar.
 *
 * Existe porque a categoria virou texto livre: sem um catálogo, "Marina" e
 * "Aeroporto" caíam no pino genérico e o mapa perdia a leitura de relance que é
 * o ponto de ter categorias. A chave é gravada no projeto
 * (`estiloCategoriaPoi`), então tem de ser estável — renomear uma chave aqui
 * quebra os projetos salvos.
 */
export const ICONES_POI: Record<string, LucideIcon> = {
  pin: MapPin,
  praia: Waves,
  shopping: ShoppingBag,
  mercado: ShoppingCart,
  saude: Heart,
  farmacia: Pill,
  educacao: GraduationCap,
  lazer: Trees,
  gastronomia: UtensilsCrossed,
  cafe: Coffee,
  servicos: Wrench,
  academia: Dumbbell,
  via: Route,
  aeroporto: Plane,
  marina: Ship,
  predio: Building2,
  transporte: Bus,
  cultura: Landmark,
  religiao: Church,
  combustivel: Fuel,
  infantil: Baby,
  pet: Dog,
  ciclovia: Bike,
  hotel: Hotel,
};

/** Ordem em que os ícones aparecem no seletor do editor. */
export const NOMES_ICONES_POI = Object.keys(ICONES_POI);

/**
 * Paleta das categorias. As dez primeiras são as cores históricas das
 * categorias que já existiam, para nenhum projeto salvo mudar de cor sozinho.
 */
export const CORES_POI = [
  "#38bdf8", "#a3e635", "#4ade80", "#f87171", "#60a5fa",
  "#a78bfa", "#fb923c", "#9ca3af", "#22d3ee", "#facc15",
  "#f472b6", "#34d399", "#818cf8", "#fbbf24", "#2dd4bf",
];

/** Cores das categorias que já vinham no código. */
const COR_HISTORICA: Record<string, string> = {
  praia: "#38bdf8", shopping: "#a3e635", mercado: "#4ade80", saude: "#f87171",
  educacao: "#60a5fa", lazer: "#a78bfa", gastronomia: "#fb923c",
  servicos: "#9ca3af", academia: "#22d3ee", via: "#facc15",
};

/** Ícone padrão de uma categoria pelo NOME, quando o projeto não escolheu um. */
const ICONE_HISTORICO: Record<string, string> = {
  praia: "praia", shopping: "shopping", mercado: "mercado", saude: "saude",
  educacao: "educacao", lazer: "lazer", gastronomia: "gastronomia",
  servicos: "servicos", academia: "academia", via: "via", farmacia: "farmacia",
};

export type EstiloPoi = Record<string, { icone?: string; cor?: string }>;

/** Componente de ícone da categoria — o do projeto, o histórico ou o pino. */
export function iconeDaCategoria(categoria: string, estilo?: EstiloPoi): LucideIcon {
  const nome = estilo?.[categoria]?.icone ?? ICONE_HISTORICO[categoria];
  return (nome && ICONES_POI[nome]) || MapPin;
}

/**
 * Cor da categoria. Sem escolha do projeto e sem cor histórica, deriva do HASH
 * do nome: assim uma categoria criada agora tem cor estável entre sessões e
 * entre o editor e a vitrine, sem guardar mais um campo.
 */
export function corDaCategoriaPoi(categoria: string, estilo?: EstiloPoi): string {
  const escolhida = estilo?.[categoria]?.cor;
  if (escolhida) return escolhida;
  if (COR_HISTORICA[categoria]) return COR_HISTORICA[categoria];
  if (!categoria) return "#7d8187";
  let h = 0;
  for (let i = 0; i < categoria.length; i++) h = (h * 31 + categoria.charCodeAt(i)) >>> 0;
  return CORES_POI[h % CORES_POI.length];
}
