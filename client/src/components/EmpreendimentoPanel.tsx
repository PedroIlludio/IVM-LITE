import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Empreendimento, ItemLista, PontoDeInteresse } from "@shared/schema";
import { normalizarLista } from "@/lib/ivm-store";
import MediaGallery, { type MediaTab } from "@/components/MediaGallery";
import TourVirtual from "@/components/TourVirtual";
import {
  loadUnidades, contarStatus, porPavimento, torreLabel, STATUS_META, STATUS_CLARO,
  type Unidade, type TorreDef,
} from "@/lib/unidades";
import { plantasDeTipologia } from "@/lib/tipologias";
import { corDaCategoriaPoi, iconeDaCategoria } from "@/lib/poi-icones";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MapPin,
  Building2,
  Layers,
  Ruler,
  Car,
  ArrowLeft,
  ChevronRight,
  Maximize2,
  X,
  ShoppingBag,
  ShoppingCart,
  Heart,
  GraduationCap,
  Trees,
  UtensilsCrossed,
  Wrench,
  Dumbbell,
  Pill,
  Route,
  Clock,
  ExternalLink,
  Home,
  Star,
  CheckCircle2,
  Users,
  ChevronDown,
  Images,
  Waves,
  Film,
  Orbit,
  Layers3,
  ClipboardList,
} from "lucide-react";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

interface EmpreendimentoPanelProps {
  empreendimentos: Empreendimento[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
  onFlyToPoi?: (lat: number, lng: number, poi?: PontoDeInteresse) => void;
  onOpenPavimentos?: () => void;
  /** Abre a experiência 3D de unidades com TODAS visíveis. */
  onVerUnidades?: () => void;
  /** Abre a experiência de unidades já focada na unidade escolhida. */
  onSelectUnit?: (id: string) => void;
  /** Unidades do projeto; se omitido, busca o espelho do piloto (/api/unidades). */
  unidades?: Unidade[];
  /** Torres do projeto; se omitido, são deduzidas das unidades. */
  torres?: TorreDef[];
  /** Logo do projeto; se omitido, usa o do piloto. */
  logoUrl?: string;
  /**
   * Plantas já unificadas (tipologias + níveis). Omitido, o painel deriva do
   * próprio empreendimento — o que mantém o `/explorar` do piloto funcionando,
   * já que lá não há config de níveis para consultar.
   */
  plantas?: { area: string; url: string }[];
  /** Controle do entorno; sem ele o painel não oferece o modo mapa. */
  entorno?: ControleEntorno;
}

/** Controle do entorno, que mora na pagina porque o mapa ocupa o viewport. */
export interface ControleEntorno {
  modo: "3d" | "mapa";
  onModo: (m: "3d" | "mapa") => void;
  poiSelId: string | null;
  onPoiSel: (id: string | null) => void;
  /**
   * A seção Entorno acabou de ser aberta.
   *
   * A página é quem tem a cena, então o enquadramento não pode ser aplicado
   * daqui. Só o painel sabe QUANDO a seção abre — `vista` é estado interno
   * dele.
   */
  onEntrarEntorno?: () => void;
}

function EmpreendimentoListItem({
  emp,
  isSelected,
  onClick,
}: {
  emp: Empreendimento;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={`btn-empreendimento-${emp.id}`}
      onClick={onClick}
      className={`w-full text-left rounded-md transition-all duration-200 group overflow-hidden ${
        isSelected
          ? "bg-[var(--v-accent)]/15 border border-[var(--v-accent)]"
          : "border border-transparent hover:bg-[var(--v-surface-2)]"
      }`}
    >
      <div className="flex gap-3 p-2.5">
        {emp.thumbnailUrl && (
          <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0">
            <img
              src={emp.thumbnailUrl}
              alt={emp.name}
              className="w-full h-full object-cover"
              data-testid={`img-thumb-${emp.id}`}
            />
          </div>
        )}
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-1">
            <h3
              className={`font-semibold text-sm tracking-wide ${
                isSelected ? "text-[var(--v-accent)]" : "text-[var(--v-ink)]"
              }`}
            >
              {emp.name.toUpperCase()}
            </h3>
            <ChevronRight
              className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
                isSelected
                  ? "text-[var(--v-accent)]"
                  : "text-[var(--v-ink-3)] group-hover:text-[var(--v-ink-3)]"
              }`}
            />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <MapPin className="w-3 h-3 text-[var(--v-ink-3)] flex-shrink-0" />
            <span className="text-[11px] text-[var(--v-ink-2)] truncate">
              {emp.neighborhood}
            </span>
          </div>
          {emp.tipo && (
            <span className="text-[10px] text-[var(--v-ink-3)] mt-0.5">{emp.tipo}</span>
          )}
        </div>
      </div>
    </button>
  );
}

const CATEGORIA_COLORS: Record<string, string> = {
  shopping: "text-[var(--v-accent)]",
  mercado: "text-green-400",
  saude: "text-red-400",
  educacao: "text-blue-400",
  lazer: "text-violet-400",
  gastronomia: "text-orange-400",
  servicos: "text-gray-400",
  academia: "text-cyan-400",
  farmacia: "text-red-400",
  via: "text-yellow-400",
  praia: "text-[var(--v-accent)]",
};

function getCategoriaIcon(categoria: string) {
  const cls = "w-3.5 h-3.5";
  switch (categoria) {
    case "shopping": return <ShoppingBag className={cls} />;
    case "mercado": return <ShoppingCart className={cls} />;
    case "saude": return <Heart className={cls} />;
    case "educacao": return <GraduationCap className={cls} />;
    case "lazer": return <Trees className={cls} />;
    case "gastronomia": return <UtensilsCrossed className={cls} />;
    case "servicos": return <Wrench className={cls} />;
    case "academia": return <Dumbbell className={cls} />;
    case "farmacia": return <Pill className={cls} />;
    case "via": return <Route className={cls} />;
    case "praia": return <Waves className={cls} />;
    default: return <MapPin className={cls} />;
  }
}

/**
 * Marca do projeto no painel.
 *
 * Antes o logo do Quinta estava importado direto aqui, e duas das três
 * ocorrências nem consultavam o logo do projeto — um empreendimento de outra
 * incorporadora exibia a marca errada. Sem logo cadastrado, mostra o nome: numa
 * plataforma white-label é melhor não ter marca nenhuma do que ter a de outro.
 */
function MarcaDoProjeto({ logoUrl, nome, className = "h-9" }: {
  logoUrl?: string; nome?: string; className?: string;
}) {
  if (logoUrl) {
    return <img src={logoUrl} alt={nome ?? ""} className={`${className} w-auto opacity-95`} />;
  }
  return (
    <span className="truncate font-serif text-base tracking-wide text-[var(--v-ink)]">
      {nome ?? ""}
    </span>
  );
}

/** Categorias da gaveta — o conteúdo que saiu da rolagem única do painel. */
type Categoria = "unidades" | "lazer" | "entorno" | "ficha";

/**
 * Vista do painel: o trilho de ícones (`menu`) ou uma categoria aberta.
 *
 * Não existe mais um "resumo" que abre por padrão. Capa, endereço, sobre,
 * pavimentos e destaques eram uma parede de texto sobre a cena assim que o
 * painel aparecia — e a cena 3D é o que o visitante veio ver. Esse conteúdo é
 * a FICHA TÉCNICA do empreendimento e virou a categoria de mesmo nome: em
 * repouso o painel é só a barra de ícones, e cada bloco aparece quando alguém
 * pede por ele.
 */
export type VistaPainel = "menu" | Categoria;

const ROTULO_CATEGORIA: Record<Categoria, string> = {
  unidades: "Unidades e pavimentos",
  lazer: "Áreas comuns e lazer",
  entorno: "Entorno",
  ficha: "Ficha técnica",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="v-eyebrow mb-2">{children}</h4>
  );
}

function EmpreendimentoDetail({
  emp,
  onBack,
  onFlyToPoi,
  onOpenPavimentos,
  onVerUnidades,
  onSelectUnit,
  hideBack,
  unidades: unidadesProp,
  torres,
  logoUrl,
  plantas: plantasProp,
  entorno,
  vista,
  onVista,
  onFechar,
  trilho,
}: {
  emp: Empreendimento;
  onBack: () => void;
  onFlyToPoi?: (lat: number, lng: number, poi?: PontoDeInteresse) => void;
  onOpenPavimentos?: () => void;
  /** Abre a experiência 3D de unidades com TODAS visíveis. */
  onVerUnidades?: () => void;
  onSelectUnit?: (id: string) => void;
  hideBack?: boolean;
  unidades?: Unidade[];
  torres?: TorreDef[];
  logoUrl?: string;
  plantas?: { area: string; url: string }[];
  entorno?: ControleEntorno;
  /** Vive no painel, que precisa dela para encolher no trilho. */
  vista: VistaPainel;
  onVista: (v: VistaPainel) => void;
  /** Fecha o painel inteiro (devolve a cena ao visitante). */
  onFechar: () => void;
  /** O painel está encolhido na faixa de ícones (só no desktop). */
  trilho: boolean;
}) {
  const detailRef = useRef<HTMLDivElement>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const galeria = emp.galeria ?? [];
  const videos = emp.videos ?? [];
  // Uma lista só, vinda de quem sabe (a página) ou derivada aqui.
  /**
   * A galeria mostra as plantas de TIPOLOGIA, não as dos níveis.
   *
   * A prop trazia a lista unificada (`plantasDoProjeto`), que inclui os
   * pavimentos — e a galeria enchia de "PAV 20", "PAV 21" ao lado das
   * tipologias, repetindo o que a régua de pavimentos já mostra em outro lugar.
   * Aqui a fonte é sempre o empreendimento, com regra própria.
   */
  const plantasImgs = plantasDeTipologia(emp).map((p) => ({ url: p.url, legenda: p.area }));
  // O normalizador já entrega ItemLista[], mas o /explorar do piloto monta o
  // empreendimento direto do código, sem passar por ele.
  const destaques = normalizarLista(emp.highlights);
  const lazer = normalizarLista(emp.amenities);

  const setVista = onVista;

  /**
   * Entorno: 3D ou mapa. O estado VIVE NA PAGINA, nao aqui — o mapa ocupa o
   * viewport (o lugar do 3D), e quem manda no viewport e o `ivm-view`. O painel
   * so oferece o botao e diz qual ponto esta em foco.
   */
  const modoEntorno = entorno?.modo ?? "3d";
  const setModoEntorno = (m: "3d" | "mapa") => entorno?.onModo(m);
  const poiSelId = entorno?.poiSelId ?? null;
  const setPoiSelId = (id: string | null) => entorno?.onPoiSel(id);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaTab, setMediaTab] = useState<MediaTab>("imagens");
  const [tourOpen, setTourOpen] = useState(false);
  const [fetchedUnidades, setFetchedUnidades] = useState<Unidade[]>([]);
  const unidades = unidadesProp ?? fetchedUnidades;
  const openMedia = (t: MediaTab) => { setMediaTab(t); setMediaOpen(true); };

  useEffect(() => {
    if (!unidadesProp) loadUnidades().then(setFetchedUnidades);
  }, [unidadesProp]);
  const contUnid = contarStatus(unidades);
  const totalUnid = unidades.length;
  const gruposTorres = (torres?.length ? torres : Array.from(new Set(unidades.map((u) => u.torre)))
    .map((id) => ({ id, label: torreLabel(id, torres) })));
  const [torreUnidades, setTorreUnidades] = useState("");
  const [pavimentoAberto, setPavimentoAberto] = useState<number | null>(null);
  /**
   * Categoria em foco na lista do entorno. Vazio = todas.
   *
   * Um empreendimento bem mapeado passa de trinta pontos, e a lista corrida
   * misturava escola, mercado e via de acesso — quem procura "o que tem de
   * escola perto" rolava tudo lendo ícone por ícone. As categorias já existiam
   * no dado e só apareciam como a cor do ícone.
   */
  const [catPoi, setCatPoi] = useState("");
  const torreAtiva = gruposTorres.find((t) => t.id === torreUnidades) ?? gruposTorres[0];
  const pavimentosDaTorre = torreAtiva ? porPavimento(unidades, torreAtiva.id) : [];

  useEffect(() => {
    if (!gruposTorres.some((t) => t.id === torreUnidades)) {
      setTorreUnidades(gruposTorres[0]?.id ?? "");
      setPavimentoAberto(null);
    }
  }, [gruposTorres, torreUnidades]);

  // O mapa é uma subvisualização exclusiva de Entorno. Ao sair dessa seção,
  // devolve o palco ao 3D e limpa o destino que estava selecionado.
  useEffect(() => {
    if (vista === "entorno" || modoEntorno !== "mapa") return;
    setModoEntorno("3d");
    setPoiSelId(null);
  }, [vista, modoEntorno]);

  // Enquadramento do entorno: dispara na ENTRADA da seção, não a cada render
  // dela. Sem a checagem, qualquer mudança no painel puxaria a câmera de volta
  // e o visitante não conseguiria olhar em volta.
  const entrouEntornoRef = useRef(false);
  useEffect(() => {
    if (vista !== "entorno") {
      entrouEntornoRef.current = false;
      return;
    }
    if (entrouEntornoRef.current) return;
    entrouEntornoRef.current = true;
    entorno?.onEntrarEntorno?.();
  }, [vista, entorno]);

  useEffect(() => {
    if (detailRef.current) {
      detailRef.current.scrollTop = 0;
    }
  }, [emp.id]);

  /**
   * Ficha tecnica: os numeros duros do empreendimento.
   *
   * Voltou a ser uma CATEGORIA da gaveta. Ela tinha migrado para o resumo
   * quando a gaveta era uma lista de linhas largas — cada destino custava uma
   * tela inteira, e gastar uma com cinco cartões não pagava. Com o trilho de
   * ícones o custo de um destino a mais é um ícone, e o resumo volta a ser só
   * o que convence a continuar olhando: capa, nome, sobre e destaques.
   */
  const temFicha =
    emp.terreno !== "-" || emp.torres !== "-" || emp.peDireito !== "-" ||
    !!emp.unidades || !!emp.elevadores;

  const FICHA_TECNICA = (
    <>
          {temFicha && (
            <div>
              <SectionTitle>Ficha Técnica</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5">
                {emp.terreno !== "-" && (
                  <InfoCard
                    icon={<Maximize2 className="w-3.5 h-3.5" />}
                    label="Terreno"
                    value={emp.terreno}
                  />
                )}
                {emp.torres !== "-" && (
                  <InfoCard
                    icon={<Building2 className="w-3.5 h-3.5" />}
                    label="Torres"
                    value={emp.torres}
                  />
                )}
                {emp.peDireito !== "-" && (
                  <InfoCard
                    icon={<Layers className="w-3.5 h-3.5" />}
                    label="Pé Direito"
                    value={emp.peDireito}
                  />
                )}
                {emp.unidades && (
                  <InfoCard
                    icon={<Home className="w-3.5 h-3.5" />}
                    label="Unidades"
                    value={`${emp.unidades} unid.`}
                  />
                )}
                {emp.elevadores && (
                  <InfoCard
                    icon={<Building2 className="w-3.5 h-3.5" />}
                    label="Elevadores"
                    value={emp.elevadores}
                  />
                )}
              </div>
            </div>
          )}

    </>
  );

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-300">
      {/*
        Cabeçalho — só DENTRO de uma categoria.

        No trilho ele não existe: uma faixa de 84px não comporta marca nenhuma,
        e a barra sobra de conteúdo é justamente o ponto. Sem ele, os ícones
        sobem para o topo em vez de começarem abaixo de um cabeçalho vazio.

        A identidade fica completa nesta faixa: logo e nome lado a lado. O nome
        não se repete abaixo da capa, então continua aparecendo uma única vez.
      */}
      {/*
        Fora do trilho, o painel ocupa a tela inteira (é o caso do celular) e
        precisa de saída: sem este ✕ o visitante fica preso no menu, com o 3D
        atrás e nenhum gesto que o alcance. No trilho a saída é não usá-lo — a
        faixa de 84px não esconde a cena.
      */}
      {vista === "menu" && !trilho && (
        <div className="flex shrink-0 items-center justify-end border-b border-[var(--v-line)] px-3 py-3">
          <button
            onClick={onFechar}
            data-testid="btn-menu-gaveta"
            title="Fechar o painel"
            className="shrink-0 rounded-[8px] p-1.5 text-[var(--v-ink-2)] transition-colors hover:bg-[var(--v-surface-3)] hover:text-[var(--v-ink)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {vista !== "menu" && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--v-line)] px-3 py-3">
          {logoUrl && (
            <img src={logoUrl} alt="" className="h-8 w-auto shrink-0 opacity-95" />
          )}
          <h2 className="v-title min-w-0 flex-1 truncate text-[19px]" title={emp.name}>
            {emp.name}
          </h2>
          {!hideBack && (
            <button
              data-testid="btn-back"
              onClick={onBack}
              className="ml-auto flex shrink-0 items-center gap-1.5 text-[13px] text-[var(--v-ink-2)] transition-colors hover:text-[var(--v-ink)]"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar
            </button>
          )}
        </div>
      )}

      {/*
        Barra de volta — só DENTRO de uma categoria. No trilho ela seria uma
        segunda barra sem destino: lá o único caminho é para dentro.
      */}
      {vista !== "menu" && (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--v-line)] px-2 py-2">
          {/*
            Alinhamento com o CONTEÚDO, não com a borda.

            O cabeçalho tinha `px-3` e a área rolável `px-4`, e o botão ainda
            somava o próprio recuo: o título nascia uns oito pixels à direita de
            tudo o que vinha abaixo dele, e a barra parecia torta. Agora o
            recuo do container é menor e o alvo de clique do botão cresce para
            dentro dele — a seta fica opticamente na mesma coluna do texto de
            baixo, e o alvo continua com 32px, que é o mínimo para o dedo.

            `py-2` no lugar de só `pb-2.5`: sem espaço em cima, o título ficava
            colado no que estivesse acima.
          */}
          <button
            onClick={() => setVista("menu")}
            data-testid="btn-voltar-categoria"
            title="Voltar às categorias"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[var(--v-ink-2)] transition-colors hover:bg-[var(--v-surface-3)] hover:text-[var(--v-ink)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="v-eyebrow min-w-0 flex-1 truncate leading-none">
            {ROTULO_CATEGORIA[vista]}
          </span>
        </div>
      )}

      <ScrollArea className="flex-1 bg-[var(--v-bg)]" ref={detailRef}>
        <div className="px-4 py-4 space-y-3">
          {/* ===== FICHA TÉCNICA =====
              Capa, endereço, sobre, números duros, pavimentos e destaques: a
              apresentação do empreendimento, que era o que o painel abria
              sozinho e agora é uma categoria como as outras. */}
          {vista === "ficha" && (
            <>
          {emp.thumbnailUrl && (
            <div className="relative w-full h-40 rounded-[var(--v-r)] overflow-hidden">
              <img
                src={emp.thumbnailUrl}
                alt={emp.name}
                className="w-full h-full object-cover"
                data-testid={`img-detail-thumb-${emp.id}`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#04141d]/80 via-transparent to-transparent" />
              <span className="absolute left-3 bottom-2 text-[10px] uppercase tracking-[0.25em] text-[var(--v-accent)]">
                {emp.status}
              </span>
            </div>
          )}

          {/* Localização. O nome saiu daqui: ele agora vive no cabeçalho, ao
              lado dos traços da gaveta, uma vez só. */}
          <div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 shrink-0 text-[var(--v-accent)]" />
              <span className="v-body-sm font-medium">{emp.address}</span>
            </div>
            {/* Só o campo do projeto. O " — Alagoas" que ficava aqui era do
                empreendimento-piloto e viajava para todo projeto novo: um
                empreendimento em Anápolis aparecia como "Anápolis - GO —
                Alagoas". O schema não tem estado separado, e `neighborhood` já
                é preenchido com cidade e UF. */}
            {emp.neighborhood && (
              <span className="v-meta ml-[22px] block">{emp.neighborhood}</span>
            )}

            {emp.website && (
              <a
                href={emp.website}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`link-website-${emp.id}`}
                className="v-btn-ghost mt-3 !h-9 !text-[13px]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Visitar site
              </a>
            )}
          </div>

          {emp.descricao && (
            <div>
              <SectionTitle>Sobre</SectionTitle>
              <p className="v-body">{emp.descricao}</p>
            </div>
          )}

          {/* Os números duros (terreno, torres, pé-direito, unidades) logo
              depois do pitch: é o que se procura em seguida. */}
          {FICHA_TECNICA}

          {/* Autores e pavimentos vinham numa categoria propria da gaveta.
              Sao duas linhas de texto: um destino inteiro para isso custava
              mais navegacao do que o conteudo vale. */}
          {/* Créditos do projeto. Quem assina a arquitetura e o paisagismo é
              argumento de venda em lançamento de alto padrão — o dado já existia
              no modelo, mas não tinha onde aparecer. */}
          {(emp.arquitetura || emp.paisagismo || emp.interiores) && (
            <div>
              <SectionTitle>Autores do Projeto</SectionTitle>
              <div className="space-y-1.5">
                {emp.arquitetura && <TeamRow label="Arquitetura" value={emp.arquitetura} />}
                {emp.paisagismo && <TeamRow label="Paisagismo" value={emp.paisagismo} />}
                {emp.interiores && <TeamRow label="Interiores" value={emp.interiores} />}
              </div>
            </div>
          )}

          {emp.pavimentos !== "-" && emp.pavimentos !== "" && (
            <div>
              <SectionTitle>Pavimentos</SectionTitle>
              <p className="v-body-sm">{emp.pavimentos}</p>
            </div>
          )}
            </>
          )}

          {/* Destaques fecham a ficha: são o argumento de venda em quatro
              linhas, e leem melhor depois dos números que os sustentam. */}
          {vista === "ficha" && (
            <>
          {destaques.length > 0 && (
            <div>
              <SectionTitle>Destaques</SectionTitle>
              <div className="space-y-1">
                {destaques.map((h) => (
                  <ItemDaLista
                    key={h.id}
                    item={h}
                    icon={<Star className="w-3 h-3 text-[var(--v-accent)]/50 flex-shrink-0" />}
                    onZoom={setLightboxImage}
                  />
                ))}
              </div>
            </div>
          )}

            </>
          )}

          {/* ===== GAVETA DE CATEGORIAS =====
              Cada item ou ABRE algo direto (`abrir`) ou entra numa sub-vista
              (`id`). "Galeria" abria uma tela intermediária com um mosaico que
              só servia para ser clicado de novo — dois passos para chegar onde
              o próprio visualizador já tem as abas de imagens, vídeos e
              plantas. Agora vai direto.

              O desenho é um TRILHO de ícones na cor da marca (ver `.v-gaveta`
              em vitrine.css): fechado ocupa uma coluna estreita e colorida, e
              o hover abre os nomes. Antes eram cinco linhas de largura cheia
              com texto, seta e contador — um formulário de navegação sobre a
              cena 3D, que é o que o visitante veio ver. */}
          {vista === "menu" && (
            <div className="v-in v-gaveta">
              {([
                {
                  /* Primeira da fila: é a apresentação do empreendimento, e
                     quem abre o painel ainda não sabe o que está vendo. */
                  id: "ficha", rotulo: "Ficha técnica",
                  icone: <ClipboardList className="w-5 h-5" />,
                  tem: temFicha, n: undefined,
                },
                {
                  id: "unidades", rotulo: "Unidades e pavimentos",
                  icone: <Building2 className="w-5 h-5" />,
                  tem: totalUnid > 0 || !!onOpenPavimentos, n: totalUnid || undefined,
                  /**
                   * Vai direto para a experiência 3D, como o botão "Buscar
                   * unidades" da barra.
                   *
                   * Antes ele abria uma LISTA dentro do painel: o mesmo rótulo
                   * levava a duas coisas diferentes conforme por onde se
                   * clicava, e por aqui as unidades não apareciam na cena. A
                   * experiência 3D é a versão completa da mesma coisa — tem
                   * torre, andar, status, faixa de preço e o volume na cena.
                   */
                  abrir: onVerUnidades,
                },
                {
                  id: "galeria", rotulo: "Galeria e mídia",
                  icone: <Images className="w-5 h-5" />,
                  tem: galeria.length > 0 || videos.length > 0 || plantasImgs.length > 0,
                  n: galeria.length + videos.length + plantasImgs.length || undefined,
                  abrir: () => openMedia("imagens"),
                },
                {
                  id: "tour", rotulo: "Tour virtual 360°",
                  icone: <Orbit className="w-5 h-5" />,
                  tem: !!emp.tourVirtualUrl, n: undefined,
                  abrir: () => setTourOpen(true),
                },
                {
                  id: "lazer", rotulo: "Áreas comuns e lazer",
                  icone: <Trees className="w-5 h-5" />,
                  tem: lazer.length > 0, n: lazer.length || undefined,
                },
                {
                  id: "entorno", rotulo: "Entorno",
                  icone: <MapPin className="w-5 h-5" />,
                  tem: (emp.pontosDeInteresse ?? []).length > 0,
                  n: (emp.pontosDeInteresse ?? []).length || undefined,
                },
              ] as { id: string; rotulo: string; icone: React.ReactNode; tem: boolean; n?: number; abrir?: () => void }[])
                .filter((c) => c.tem)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => (c.abrir ? c.abrir() : setVista(c.id as Categoria))}
                    data-testid={`cat-${c.id}`}
                    /* O `title` não é enfeite: fechado, o botão é só um ícone,
                       e é ele que responde ao ponteiro parado e ao leitor de
                       tela enquanto o rótulo está encolhido. */
                    title={c.rotulo}
                    aria-label={c.rotulo}
                    className="v-gaveta-item"
                  >
                    {c.icone}
                    <span className="v-gaveta-rotulo">{c.rotulo}</span>
                    {c.n != null && <span className="v-gaveta-n">{c.n}</span>}
                  </button>
                ))}
            </div>
          )}

          {/* ===== CATEGORIAS ABERTAS ===== */}
          {vista === "unidades" && (<div className="v-in space-y-4">
            <div>
              <SectionTitle>Escolha o bloco</SectionTitle>
              <p className="v-meta">Pavimentos e unidades organizados por torre</p>
            </div>

            {gruposTorres.length > 0 && (
              <div className="grid grid-cols-2 gap-2" data-testid="torres-unidades">
                {gruposTorres.map((t) => (
                  <button key={t.id} onClick={() => { setTorreUnidades(t.id); setPavimentoAberto(null); }}
                    data-on={torreAtiva?.id === t.id ? "1" : undefined}
                    className={`min-h-10 rounded-full border px-4 py-2 text-[13px] font-semibold transition-all active:scale-95 ${
                      torreAtiva?.id === t.id
                        ? "border-[var(--v-accent)] bg-[var(--v-accent)] text-[var(--v-accent-ink)] shadow-[var(--v-sh-1)]"
                        : "border-[var(--v-line-2)] bg-[var(--v-surface)] text-[var(--v-ink-2)] hover:border-[var(--v-ink-3)] hover:text-[var(--v-ink)]"
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {torreAtiva && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <SectionTitle>Pavimentos · {torreAtiva.label}</SectionTitle>
                  <span className="v-meta">{pavimentosDaTorre.reduce((n, p) => n + p.unidades.length, 0)} unidades</span>
                </div>

                {pavimentosDaTorre.map(({ pavimento, unidades: doPavimento }) => {
                  const aberto = pavimentoAberto === pavimento;
                  const cont = contarStatus(doPavimento);
                  return (
                    <div key={pavimento} className="v-card overflow-hidden" data-testid={`grupo-pav-${pavimento}`}>
                      <button
                        onClick={() => setPavimentoAberto(aberto ? null : pavimento)}
                        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--v-accent-soft)] text-[var(--v-accent)]">
                          <Layers3 className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-semibold text-[var(--v-ink)]">
                            {pavimento === 0 ? "Térreo" : `${pavimento}º pavimento`}
                          </span>
                          <span className="v-meta block">
                            {doPavimento.length} unid. · {cont.disponivel} disponíveis
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          {(["disponivel", "reservada", "vendida"] as const).map((status) => cont[status] > 0 && (
                            <span key={status} className="h-2 w-2 rounded-full" title={`${STATUS_META[status].label}: ${cont[status]}`}
                              style={{ background: STATUS_CLARO[status] }} />
                          ))}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-[var(--v-ink-3)] transition-transform ${aberto ? "rotate-180" : ""}`} />
                      </button>

                      {aberto && (
                        <div className="border-t border-[var(--v-line)] bg-[var(--v-surface-2)] px-3.5 py-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="v-eyebrow">Unidades</span>
                            {onOpenPavimentos && (
                              <button onClick={onOpenPavimentos} className="text-[11px] font-semibold text-[var(--v-accent)] hover:underline">
                                Ver pavimento em 3D
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {doPavimento.map((u) => (
                              <button key={u.id} onClick={() => onSelectUnit?.(u.id)}
                                className="rounded-[8px] border border-[var(--v-line)] bg-white px-2 py-2 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--v-line-2)] hover:shadow-sm"
                                title={`${u.numero} · ${STATUS_META[u.status].label}`}>
                                <span className="block truncate text-[12px] font-semibold text-[var(--v-ink)]">{u.numero}</span>
                                <span className="mt-1 flex items-center gap-1 text-[9px] text-[var(--v-ink-2)]">
                                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_CLARO[u.status] }} />
                                  {STATUS_META[u.status].label.slice(0, 5)}.
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>)}

          {vista === "lazer" && (<div className="v-in space-y-3">
          {lazer.length > 0 && (() => {
            // Um item que já é destaque não se repete na lista de lazer.
            const jaEmDestaque = new Set(destaques.map((h) => h.titulo.toLowerCase()));
            const filtered = lazer.filter((a) => !jaEmDestaque.has(a.titulo.toLowerCase()));
            return filtered.length > 0 ? (
              <div>
                <SectionTitle>Áreas Comuns e Lazer</SectionTitle>
                <div className="space-y-1">
                  {filtered.map((a) => (
                    <ItemDaLista
                      key={a.id}
                      item={a}
                      icon={<CheckCircle2 className="w-3 h-3 text-[var(--v-accent)]/40 flex-shrink-0" />}
                      onZoom={setLightboxImage}
                    />
                  ))}
                </div>
              </div>
            ) : null;
          })()}

          </div>)}

          {vista === "entorno" && (<div className="v-in space-y-3">
          {/*
            Duas leituras do mesmo entorno: no 3D o ponto é um lugar na cena
            (a câmera voa até ele); no mapa é uma distância percorrível — a
            rota real, traçada da portaria até o ponto escolhido.
          */}
          <div className="v-seg">
            {([["3d", "3D"], ["mapa", "Mapa"]] as const).map(([m, l]) => (
              <button key={m} onClick={() => setModoEntorno(m)}
                data-on={modoEntorno === m ? "1" : undefined}
                data-testid={`entorno-${m}`}>
                {l}
              </button>
            ))}
          </div>

          {modoEntorno === "mapa" && (
            <p className="v-meta">
              O mapa esta no lugar do 3D. Escolha um ponto abaixo para ver o caminho.
            </p>
          )}

          {emp.pontosDeInteresse && emp.pontosDeInteresse.length > 0 && (() => {
            const pontos = emp.pontosDeInteresse ?? [];
            /**
             * Só as categorias que TÊM ponto, na ordem definida no editor.
             *
             * A ordem vem de `categoriasPoi` para a vitrine respeitar a
             * hierarquia que o corretor montou; o que sobra (categoria escrita
             * num ponto e nunca cadastrada) entra no fim, em vez de sumir.
             */
            const usadas = new Set(pontos.map((p) => p.categoria).filter(Boolean));
            const cats = [
              ...(emp.categoriasPoi ?? []).filter((c) => usadas.has(c)),
              ...Array.from(usadas).filter((c) => !(emp.categoriasPoi ?? []).includes(c)),
            ];
            const visiveis = catPoi ? pontos.filter((p) => p.categoria === catPoi) : pontos;
            return (
            <div>
              <SectionTitle>Pontos de Interesse</SectionTitle>
              {cats.length > 1 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {[["", "Todos"] as const, ...cats.map((c) => [c, c] as const)].map(([v, l]) => {
                    const n = v ? pontos.filter((p) => p.categoria === v).length : pontos.length;
                    const cor = v ? corDaCategoriaPoi(v, emp.estiloCategoriaPoi) : undefined;
                    return (
                      <button key={v || "todos"} onClick={() => setCatPoi(v)}
                        data-testid={`poi-cat-${v || "todos"}`}
                        className={`flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] transition-colors ${
                          catPoi === v
                            ? "border-[var(--v-accent)] bg-[var(--v-accent)]/15 text-[var(--v-ink)]"
                            : "border-[var(--v-line)] text-[var(--v-ink-2)] hover:border-[var(--v-line-2)]"
                        }`}>
                        {cor && (
                          <span className="h-1.5 w-1.5 rounded-full"
                            style={{ background: cor }} />
                        )}
                        {l}
                        <span className="text-[var(--v-ink-3)]">{n}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="space-y-1">
                {visiveis.map((poi, i) => {
                  const id = poi.id ?? `poi-${i}`;
                  return (
                  <div
                    key={i}
                    data-testid={`poi-item-${i}`}
                    data-sel={modoEntorno === "mapa" && poiSelId === id ? "1" : undefined}
                    className="v-card flex items-center justify-between gap-2 p-2.5 cursor-pointer"
                    onClick={() => {
                      // No mapa o clique escolhe o destino da rota; no 3D ele
                      // voa a câmera, como sempre fez.
                      if (modoEntorno === "mapa") {
                        setPoiSelId(poiSelId === id ? null : id);
                        return;
                      }
                      // No 3D o ponto TAMBÉM passa a ficar selecionado: é o que
                      // abre o cartão de detalhe no lado direito. Voar até o
                      // lugar sem dizer o que ele é resolvia metade da pergunta
                      // do visitante.
                      setPoiSelId(id);
                      onFlyToPoi?.(poi.lat, poi.lng, poi);
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Ícone e cor vêm do que foi configurado no editor —
                          os mesmos do pino no mapa, para a lista e o mapa
                          lerem como a mesma coisa. */}
                      <span
                        className="flex-shrink-0"
                        style={{ color: corDaCategoriaPoi(poi.categoria, emp.estiloCategoriaPoi) }}
                      >
                        {(() => {
                          const Ic = iconeDaCategoria(poi.categoria, emp.estiloCategoriaPoi);
                          return <Ic className="w-3.5 h-3.5" />;
                        })()}
                      </span>
                      <span className="v-body-sm truncate">{poi.name}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Clock className="w-3 h-3 text-[var(--v-ink-3)]" />
                      <span className="v-meta whitespace-nowrap">{poi.tempo}</span>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          <div className="h-4" />
          </div>)}
        </div>
      </ScrollArea>

      {lightboxImage && createPortal(
        <div
          data-testid="lightbox-overlay"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <button
            data-testid="btn-close-lightbox"
            className="absolute top-4 right-4 p-2 rounded-full bg-[var(--v-surface-3)] text-[var(--v-ink-2)] hover:text-[var(--v-ink)] hover:bg-[var(--v-line-2)] transition-colors"
            onClick={() => setLightboxImage(null)}
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxImage}
            alt="Planta"
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}

      <MediaGallery
        imagens={galeria}
        ordemCategorias={emp.categoriasGaleria}
        videos={videos}
        plantas={plantasImgs}
        open={mediaOpen}
        initialTab={mediaTab}
        onClose={() => setMediaOpen(false)}
      />
      <TourVirtual
        url={emp.tourVirtualUrl ?? ""}
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        nomeEmpreendimento={emp.name}
      />
    </div>
  );
}

function ActionChip({ icon, label, testid, onClick }: {
  icon: React.ReactNode; label: string; testid: string; onClick: () => void;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className="v-card flex flex-col items-center justify-center gap-1.5 py-3.5 text-[var(--v-ink)]"
    >
      <span className="text-[var(--v-accent)]">{icon}</span>
      <span className="text-[11px] tracking-wide">{label}</span>
    </button>
  );
}

function InfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="v-card p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[var(--v-accent)]/70">{icon}</span>
        <span className="v-eyebrow !text-[10px]">{label}</span>
      </div>
      <p className="text-[15px] font-semibold leading-tight text-[var(--v-ink)]">{value}</p>
    </div>
  );
}

/**
 * Item de destaque ou de lazer. Sem foto nem descrição ele é a linha de sempre;
 * com elas, ganha miniatura clicável e o texto de apoio — que é o que a lista
 * rica passou a permitir.
 */
function ItemDaLista({ item, icon, onZoom }: {
  item: ItemLista;
  icon: React.ReactNode;
  onZoom: (url: string) => void;
}) {
  // Item sem nada além do nome continua sendo uma LINHA. Um cartão de 80px de
  // altura para exibir uma palavra é moldura sem quadro.
  if (!item.imagemUrl && !item.descricao) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        {icon}
        <span className="v-body-sm">{item.titulo}</span>
      </div>
    );
  }

  const temFoto = !!item.imagemUrl;
  return (
    /**
     * Cartão de área comum: foto grande à esquerda, texto respirando à direita.
     *
     * A miniatura era de 48px — do tamanho de um ícone. Numa lista cuja função
     * é VENDER estilo de vida (piscina, rooftop, cinema), a foto é o argumento
     * e o texto é a legenda; a proporção estava invertida. Em 88×72 dá para
     * reconhecer o ambiente sem abrir, que é o que faz percorrer a lista valer
     * a pena.
     *
     * O card inteiro é clicável quando há foto, não só a miniatura: um alvo de
     * 48px dentro de um cartão de 460px de largura é uma armadilha de mira.
     */
    <div
      className={`v-card group flex items-stretch gap-3 overflow-hidden p-0 transition-all ${
        temFoto ? "cursor-zoom-in hover:-translate-y-px" : ""
      }`}
      onClick={temFoto ? () => onZoom(item.imagemUrl as string) : undefined}
      title={temFoto ? "Ampliar" : undefined}
    >
      {temFoto ? (
        <div className="relative w-[88px] shrink-0 overflow-hidden bg-[var(--v-surface-3)]">
          <img
            src={item.imagemUrl}
            alt={item.titulo}
            loading="lazy"
            className="h-full min-h-[72px] w-full object-cover transition-transform duration-300 group-hover:scale-[1.06]"
          />
        </div>
      ) : (
        <span className="flex w-[88px] shrink-0 items-center justify-center bg-[var(--v-surface-2)]">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1 py-2.5 pr-3">
        <p className="text-[13px] font-semibold leading-snug text-[var(--v-ink)]">
          {item.titulo}
        </p>
        {item.descricao && (
          // Duas linhas: a descrição é apoio, não o conteúdo. Sem o limite, um
          // texto longo empurrava os itens seguintes para fora da tela e a
          // lista deixava de ser comparável item a item.
          <p className="v-meta mt-1 line-clamp-2 leading-relaxed">{item.descricao}</p>
        )}
      </div>
    </div>
  );
}

function TeamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="v-card flex items-center justify-between gap-2 p-2.5 flex-wrap">
      <div className="flex items-center gap-2">
        <Users className="w-3 h-3 text-[var(--v-accent)]/40" />
        <span className="v-meta">{label}</span>
      </div>
      <span className="text-[14px] font-semibold text-[var(--v-ink)]">{value}</span>
    </div>
  );
}

export default function EmpreendimentoPanel({
  empreendimentos,
  selectedId,
  onSelect,
  isOpen,
  onToggle,
  onFlyToPoi,
  onOpenPavimentos,
  onVerUnidades,
  onSelectUnit,
  unidades: unidadesProp,
  torres,
  logoUrl,
  plantas,
  entorno,
}: EmpreendimentoPanelProps) {
  const selectedEmp = empreendimentos.find((e) => e.id === selectedId);
  // Projeto de empreendimento único: sem lista, sem botão "Voltar".
  const single = empreendimentos.length === 1;
  const isMobile = useIsMobile();
  const [mobileExpanded, setMobileExpanded] = useState(false);

  /**
   * A vista mora AQUI, e não no detalhe, porque é ela que decide a largura do
   * painel: em `menu` ele encolhe para o trilho de ícones e devolve a cena ao
   * visitante; numa categoria, abre inteiro para o conteúdo.
   */
  const [vista, setVista] = useState<VistaPainel>("menu");

  useEffect(() => {
    if (selectedId) {
      setMobileExpanded(true);
      // Trocar de empreendimento recomeça pelo trilho: a categoria aberta era
      // do anterior e o conteúdo dela não descreve mais o que está na tela.
      setVista("menu");
    }
  }, [selectedId]);

  if (isMobile) {
    return (
      <div
        data-testid="panel-empreendimentos"
        className={`absolute inset-y-0 left-0 z-30 flex w-full flex-col glassmorphism transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ height: "100dvh", maxHeight: "100dvh" }}
      >
        {!selectedEmp ? (
          <>
            <div className="px-4 pb-2 border-b border-[var(--v-line)]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <MarcaDoProjeto logoUrl={logoUrl} nome={empreendimentos[0]?.name} className="h-8" />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    data-testid="btn-close-panel"
                    onClick={onToggle}
                    className="p-1.5 rounded-md text-[var(--v-ink-3)] hover:text-[var(--v-ink-2)] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {empreendimentos.map((emp) => (
                  <EmpreendimentoListItem
                    key={emp.id}
                    emp={emp}
                    isSelected={emp.id === selectedId}
                    onClick={() => onSelect(emp.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </>
        ) : (
          <EmpreendimentoDetail
            emp={selectedEmp}
            onBack={() => { onSelect(null); setMobileExpanded(false); }}
            onFlyToPoi={onFlyToPoi}
            onOpenPavimentos={onOpenPavimentos}
            onVerUnidades={onVerUnidades}
            onSelectUnit={onSelectUnit}
            hideBack={single}
            unidades={unidadesProp}
            torres={torres}
            logoUrl={logoUrl}
            plantas={plantas}
            entorno={entorno}
            vista={vista}
            onVista={setVista}
            onFechar={onToggle}
            trilho={false}
          />
        )}
      </div>
    );
  }

  /**
   * Largura: o trilho de ícones em repouso, o painel cheio numa categoria.
   *
   * `.v-painel-trilho` (vitrine.css) também é quem abre a faixa no hover, para
   * os rótulos caberem — a animação de largura é do painel, não dos ícones.
   */
  const noTrilho = !!selectedEmp && vista === "menu";

  return (
    <div
      data-testid="panel-empreendimentos"
      className={`absolute top-0 left-0 bottom-0 z-30 flex flex-col glassmorphism transition-[transform,width] duration-300 ease-out ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      } ${noTrilho ? "v-painel-trilho" : "w-[460px] max-w-[94vw]"}`}
      style={{ maxHeight: "100vh" }}
    >
      {!selectedEmp ? (
        <>
          <div className="p-5 border-b border-[var(--v-line)]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <MarcaDoProjeto logoUrl={logoUrl} nome={empreendimentos[0]?.name} className="h-9" />
              </div>
              <button
                data-testid="btn-close-panel"
                onClick={onToggle}
                className="p-1.5 rounded-md text-[var(--v-ink-3)] hover:text-[var(--v-ink-2)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Mesmo caso do outro: "Ponta do Mangue · Maragogi, Alagoas"
                estava fixo no cabeçalho da lista e aparecia em qualquer
                projeto. Sai do primeiro empreendimento, e some quando não há
                o que dizer — melhor nada do que o lugar errado. */}
            {empreendimentos[0]?.neighborhood && (
              <div className="flex items-center gap-1.5 mt-3">
                <MapPin className="w-3 h-3 text-[var(--v-accent)]/60" />
                <span className="text-[11px] text-[var(--v-ink-2)]">
                  {empreendimentos[0].neighborhood}
                </span>
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              {empreendimentos.map((emp) => (
                <EmpreendimentoListItem
                  key={emp.id}
                  emp={emp}
                  isSelected={emp.id === selectedId}
                  onClick={() => onSelect(emp.id)}
                />
              ))}
            </div>
          </ScrollArea>

          <div className="p-3 border-t border-[var(--v-line)] space-y-2" data-testid="footer-panel">
            <p className="text-[8px] text-[var(--v-ink)]/15 text-center leading-relaxed">
              Pode conter produtos em fase de registro. É proibida a comercialização de unidades sem a prévia aprovação do registro de incorporação. Imagens ilustrativas, com sugestão de layout, móveis, decoração e acabamento conforme memorial descritivo e contrato de venda.
            </p>
            <div className="flex items-center justify-center gap-1">
              <span className="text-[8px] text-[var(--v-ink)]/15">Desenvolvido por</span>
              <span className="text-[8px] text-[var(--v-accent)]/40 font-semibold">Vizen LABS</span>
              <span className="text-[8px] text-[var(--v-ink)]/10 mx-0.5">|</span>
              <span className="text-[8px] text-[var(--v-ink)]/15">Illúdio Soluções Visuais</span>
            </div>
          </div>
        </>
      ) : (
        <EmpreendimentoDetail
          emp={selectedEmp}
          onBack={() => onSelect(null)}
          onFlyToPoi={onFlyToPoi}
          onOpenPavimentos={onOpenPavimentos}
          onVerUnidades={onVerUnidades}
          onSelectUnit={onSelectUnit}
          hideBack={single}
          unidades={unidadesProp}
          torres={torres}
          logoUrl={logoUrl}
          plantas={plantas}
          entorno={entorno}
          vista={vista}
          onVista={setVista}
          onFechar={onToggle}
          trilho={noTrilho}
        />
      )}
    </div>
  );
}
