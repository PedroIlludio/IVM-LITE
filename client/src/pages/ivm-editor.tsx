import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  Loader2, Save, Camera, AlertTriangle, ArrowLeft, Upload, Globe, Box,
  Building2, Video, MapPin, Images, Palette, Plus, Trash2, Move, Crosshair,
  Grid3x3, RefreshCw, Play, Square, Star, ChevronUp, ChevronDown, ChevronRight, Scissors,
  Home, Sun, Eye, RotateCw, Maximize, Undo2, Redo2, Copy, Search, History, X,
  Lock, LockOpen, Moon, SunMedium, Map as MapIcon,
} from "lucide-react";
import Scene3D, {
  type Scene3DHandle, type TowerOutline, type GizmoModo, type GizmoLocal, type GizmoLocalPatch,
} from "@/components/Scene3D";
import SolarBar from "@/components/SolarBar";
import MapaEntorno from "@/components/MapaEntorno";
import {
  getProjectById, updateProject, uploadAsset, projectToBuilding3D, genId,
  parseLocationInput, POI_CATEGORIES, projectPavCfg, projectAmbiente, projectMapaBase,
  projectPath, slugReservado, slugify, MODO_LOCAL, CONTATO_MENSAGEM_PADRAO,
  type IvmProject, type ProjectConfig, type EditablePoi, type NamedView, type Branding,
  type CrmConfig, type AmbienteCfg, type ProjectData, type ContatoCfg,
} from "@/lib/ivm-store";
import { torreLabel, type TorreDef, type TorreVolume } from "@/lib/unidades";
import { buildUnitBoxes, volumeDaTorre, faixaVertical, corteDoNivel } from "@/lib/unidades3d";
import {
  pavimentos, niveisDe, alturaDaPlanta, nivelDoPavimento, DEFAULT_PAV_CFG,
  type PavimentosCfg, type NivelDef,
} from "@/lib/pavimentos";
import { plantasDeTipologia, plantasOrfas } from "@/lib/tipologias";
import {
  COR_VIA_PADRAO, LARGURA_VIA_PADRAO, comprimentoDaVia, densificarVia,
  densificarViaComCotas,
  type EntornoCfg, type Superficie, type Via,
} from "@/lib/entorno";
import {
  TIPOS_SUPERFICIE, COR_SUPERFICIE, METROS_POR_LADRILHO,
} from "@/lib/texturas-superficie";
import { ICONES_POI, NOMES_ICONES_POI, CORES_POI, corDaCategoriaPoi, iconeDaCategoria } from "@/lib/poi-icones";
import {
  tocarTour, duracaoTotal, formatDuracao, DURACAO_PADRAO, ESPERA_PADRAO,
  type TourHandle,
} from "@/lib/tour";
import { type ItemLista, type Tipologia, type Unidade } from "@shared/schema";
import { getSunReadout, localToUtc, seasonDate, type Season } from "@/lib/solar";
/**
 * As duas abas mais pesadas e as primitivas do inspetor vivem em `pages/editor/`.
 *
 * Este arquivo passava de cinco mil linhas e concentrava três coisas de níveis
 * diferentes: a moldura da página (documento, viewport, rail, salvar), o
 * conteúdo de onze abas e um kit de controles genéricos. Achar qualquer uma
 * delas exigia rolar por cima das outras duas. A moldura fica aqui; `Unidades`
 * e `Níveis`, que sozinhas somavam 1.700 linhas, são componentes próprios.
 */
import { UnidadesTab } from "./editor/UnidadesTab";
import { NiveisTab } from "./editor/NiveisTab";
import {
  CAMPO, Area, ColorIn, ImgUp, Linha, ListaRica, Num, NumIn, Section, Slider, Text,
} from "./editor/campos";

/**
 * A aba "Plantas" saiu: ela e "Tipologias" gravavam a mesma coisa em lugares
 * diferentes e nada dizia qual valia. Agora cada planta tem um dono — a de
 * unidade é da tipologia, a de pavimento é do nível. Ver `plantasDoProjeto`.
 */
type Tab = "dados" | "local" | "modelo" | "cameras" | "pois" | "tipologias" | "unidades" | "niveis" | "galeria" | "ambiente" | "marca";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "dados", label: "Dados", icon: <Building2 className="h-3.5 w-3.5" /> },
  { id: "local", label: "Local", icon: <MapPin className="h-3.5 w-3.5" /> },
  { id: "modelo", label: "Modelo", icon: <Box className="h-3.5 w-3.5" /> },
  { id: "cameras", label: "Câmeras", icon: <Video className="h-3.5 w-3.5" /> },
  { id: "pois", label: "POIs", icon: <Crosshair className="h-3.5 w-3.5" /> },
  { id: "tipologias", label: "Tipologias", icon: <Home className="h-3.5 w-3.5" /> },
  { id: "unidades", label: "Unidades", icon: <Grid3x3 className="h-3.5 w-3.5" /> },
  { id: "niveis", label: "Níveis e cortes", icon: <Scissors className="h-3.5 w-3.5" /> },

  { id: "galeria", label: "Galeria", icon: <Images className="h-3.5 w-3.5" /> },
  { id: "ambiente", label: "Ambiente", icon: <Sun className="h-3.5 w-3.5" /> },
  { id: "marca", label: "Marca", icon: <Palette className="h-3.5 w-3.5" /> },
];

/**
 * Abas que têm pivô próprio na cena. W/E/R trocam a ferramenta DELAS e não
 * podem arrastar o usuário para a aba Modelo — que é o pivô do GLB inteiro,
 * outra coisa.
 */
const TABS_COM_PIVO = new Set<Tab>(["unidades", "niveis"]);

/**
 * Etiqueta de estado de uma via ou superfície.
 *
 * O painel do entorno tem três estados que mudam completamente o que o item faz
 * na cena — sem traçado, drapejado sobre a fotogrametria, ou recortando o
 * terreno — e nenhum deles aparecia na lista. Descobrir em qual estava exigia
 * abrir o item e interpretar quais botões estavam presentes.
 */
function SeloEntorno({ tom, children }: {
  tom: "pronto" | "pendente" | "neutro" | "ativo";
  children: React.ReactNode;
}) {
  const cores = {
    pronto: "border-teal-400/40 bg-teal-400/10 text-teal-300",
    pendente: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    neutro: "border-white/10 bg-white/[0.04] text-white/40",
    ativo: "border-amber-400/70 bg-amber-400/25 text-amber-100 animate-pulse",
  };
  return (
    <span className={`shrink-0 rounded-[2px] border px-1 py-px text-[8px] font-semibold uppercase tracking-wide ${cores[tom]}`}>
      {children}
    </span>
  );
}

/**
 * Linha de um item do entorno: amostra de cor, nome, selos e seta.
 *
 * A linha inteira é o botão de abrir. O campo de nome saiu daqui para dentro do
 * corpo aberto de propósito: um `input` dentro de um `button` engole o clique de
 * seleção, e o usuário fica clicando no item sem ele abrir.
 */
function LinhaEntorno({ cor, nome, vazio, aberto, ativo, selos, onClick }: {
  cor: string;
  nome?: string;
  vazio: string;
  aberto: boolean;
  ativo: boolean;
  selos: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded-[3px] px-1.5 py-1.5 text-left transition-colors ${
        aberto ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}>
      <span className="h-3 w-3 shrink-0 rounded-[2px] border border-white/25"
        style={{ background: cor }} />
      <span className={`min-w-0 flex-1 truncate text-[11px] ${
        ativo ? "font-semibold text-amber-200" : nome ? "text-white/80" : "text-white/35"
      }`}>
        {nome || vazio}
      </span>
      {selos}
      {aberto
        ? <ChevronDown className="h-3 w-3 shrink-0 text-white/40" />
        : <ChevronRight className="h-3 w-3 shrink-0 text-white/25" />}
    </button>
  );
}

export default function IvmEditorPage() {
  const [, params] = useRoute("/admin/:id");
  const id = params?.id ?? "";

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [project, setProject] = useState<IvmProject | null>(null);
  /** Falha que impede o editor de existir (projeto inexistente, rede na carga). */
  const [error, setError] = useState<string | null>(null);
  /**
   * Falha da CENA 3D — separada de `error` de propósito.
   *
   * As duas moravam no mesmo state, e como `error` troca o editor inteiro por
   * uma tela de "voltar", uma queda transitória dos tiles do Google (rede, cota
   * da API) levava junto uma sessão inteira de calibração não salva, sem
   * caminho de volta. O 3D pode falhar sem que o editor deixe de ser editável:
   * os campos, o espelho e o salvar continuam valendo.
   */
  const [cenaErro, setCenaErro] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /**
   * GLB baixando. No editor isto NÃO bloqueia a tela: o inspetor é utilizável
   * sem o modelo, e um overlay opaco durante os segundos de um arquivo de 23 MB
   * só impediria trabalho que já podia acontecer. Vira um indicador discreto.
   */
  const [modeloCarregando, setModeloCarregando] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Há alterações que ainda não foram gravadas. */
  const [sujo, setSujo] = useState(false);

  /**
   * Rascunho local.
   *
   * O editor só grava no servidor quando mandam (Ctrl+S ou o botão), então uma
   * aba fechada por engano, um F5 distraído ou uma queda de energia levavam
   * junto tudo o que ainda não tinha sido salvo — e calibrar um modelo é
   * trabalho de horas. O rascunho é uma cópia em `localStorage`, escrita um
   * segundo depois da última alteração, que sobrevive a isso.
   *
   * É deliberadamente uma OFERTA e não uma restauração automática: o rascunho
   * pode ser mais velho do que o que outra pessoa salvou no servidor, e
   * sobrescrever em silêncio seria pior do que perder o rascunho.
   */
  const rascunhoKey = `ivm-rascunho:${id}`;
  const [rascunho, setRascunho] = useState<{ data: ProjectData; quando: number } | null>(null);

  function descartarRascunho() {
    try { localStorage.removeItem(rascunhoKey); } catch { /* nada a fazer */ }
    setRascunho(null);
  }

  function restaurarRascunho() {
    if (!rascunho) return;
    // Troca de estado inteira: tem de virar um passo do histórico mesmo que o
    // usuário tenha mexido em algo há menos do que a janela de agrupamento.
    ultimoRegistro.current = 0;
    registrarHistorico();
    setProject((p) => (p ? { ...p, data: rascunho.data } : p));
    setSujo(true);
    setRascunho(null);
    setSaveMsg("Rascunho restaurado — confira e salve.");
  }

  /**
   * Histórico de desfazer/refazer.
   *
   * Guarda instantâneos de `data` — como toda mutação já cria objetos novos por
   * imutabilidade, o custo é só o das referências, não de cópias profundas.
   *
   * Alterações em rajada (digitar num campo, arrastar um gizmo) são agrupadas
   * por tempo: sem isso, cada tecla viraria um passo e desfazer levaria trinta
   * cliques para voltar uma frase.
   */
  const [passado, setPassado] = useState<ProjectData[]>([]);
  const [futuro, setFuturo] = useState<ProjectData[]>([]);
  const ultimoRegistro = useRef(0);
  const LIMITE_HISTORICO = 60;
  const AGRUPAR_MS = 700;

  /**
   * Projeto atual acessível de fora do render, para o histórico ler o estado
   * anterior sem precisar de um `setProject` só para espiar.
   */
  const projetoRef = useRef<IvmProject | null>(null);
  projetoRef.current = project;

  function registrarHistorico() {
    const agora = Date.now();
    if (agora - ultimoRegistro.current < AGRUPAR_MS) return;
    const atual = projetoRef.current;
    if (!atual) return;
    ultimoRegistro.current = agora;
    // O instantâneo vinha de dentro de um updater de `setProject`, que chamava
    // `setPassado` lá dentro. React trata updaters como funções PURAS e os
    // invoca duas vezes em StrictMode — o que duplicava passos do histórico em
    // desenvolvimento e deixava o comportamento à mercê do agendador. O ref dá
    // o mesmo valor sem o aninhamento.
    setPassado((h) => [...h.slice(-(LIMITE_HISTORICO - 1)), atual.data]);
    setFuturo([]);
  }

  // Desfazer/refazer também liam o estado por dentro de um updater; pelo mesmo
  // motivo de `registrarHistorico`, agora leem do ref e cada `set*` é uma
  // chamada independente.
  function desfazer() {
    const atual = projetoRef.current;
    if (!passado.length || !atual) return;
    const anterior = passado[passado.length - 1];
    setPassado((h) => h.slice(0, -1));
    setFuturo((f) => [...f, atual.data]);
    setProject((p) => (p ? { ...p, data: anterior } : p));
    setSujo(true);
    setSaveMsg(null);
    ultimoRegistro.current = 0;
  }

  function refazer() {
    const atual = projetoRef.current;
    if (!futuro.length || !atual) return;
    const proximo = futuro[futuro.length - 1];
    setFuturo((f) => f.slice(0, -1));
    setPassado((h) => [...h, atual.data]);
    setProject((p) => (p ? { ...p, data: proximo } : p));
    setSujo(true);
    setSaveMsg(null);
    ultimoRegistro.current = 0;
  }
  /** Ferramenta de manipulação do modelo (mover / girar / escalar). */
  const [gizmoModo, setGizmoModo] = useState<GizmoModo>("mover");
  /** Valor em curso durante o arraste de uma alça, exibido sobre o viewport. */
  const [gizmoInfo, setGizmoInfo] = useState<string | null>(null);
  /** Categoria em foco na aba Galeria (filtra a lista e classifica os envios). */
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [novaCategoria, setNovaCategoria] = useState("");
  const [novaCategoriaPoi, setNovaCategoriaPoi] = useState("");
  /**
   * Unidade com o contorno em edição na cena.
   *
   * Estado da PÁGINA, não da aba: quem desenha os pivôs é o Scene3D, e ele
   * precisa saber de quem é o contorno na mão.
   */
  const [plantaUnidId, setPlantaUnidId] = useState<string | null>(null);
  /**
   * Isola o pavimento da unidade em foco na cena.
   *
   * Ligado por padrão: é o estado em que se calibra. Existe desligado porque
   * comparar com o andar de cima — alinhamento de fachada, prumada de sacada —
   * exige ver os dois.
   */
  const [isolarPavimento, setIsolarPavimento] = useState(true);
  /** Qual altura o pivô da aba Níveis está manipulando: o corte ou a planta. */
  const [pivoNivel, setPivoNivel] = useState<"corte" | "planta">("corte");
  /** POI com o seletor da galeria aberto. Um por vez. */
  const [galeriaParaPoi, setGaleriaParaPoi] = useState<string | null>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);
  const [videoAlvo, setVideoAlvo] = useState<number | null>(null);

  /**
   * Largura do inspetor, arrastável e lembrada entre sessões. Com 300px fixos
   * as grades de dois campos ficavam espremidas — e a largura ideal muda de
   * aba para aba e de tela para tela.
   */
  const [larguraPainel, setLarguraPainel] = useState(() => {
    const salvo = Number(localStorage.getItem("ivm-editor-painel"));
    return Number.isFinite(salvo) && salvo >= 280 ? Math.min(salvo, 640) : 360;
  });
  useEffect(() => {
    localStorage.setItem("ivm-editor-painel", String(larguraPainel));
  }, [larguraPainel]);
  const [tab, setTab] = useState<Tab>("dados");

  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  /** Filtro por nome/categoria da lista de POIs — um entorno bem mapeado passa de trinta. */
  const [buscaPoi, setBuscaPoi] = useState("");
  /** Filtro por legenda/categoria da galeria. */
  const [buscaImagem, setBuscaImagem] = useState("");
  /**
   * Imagens marcadas para as ações em lote da galeria, por ÍNDICE.
   *
   * Índice e não URL porque a mesma imagem pode ter sido enviada duas vezes, e
   * marcar uma marcaria a outra. Em troca, toda operação que desloca a lista
   * (apagar, reordenar, enviar) limpa a seleção — um índice sobrevivente
   * passaria a apontar para outra imagem.
   */
  const [imgSel, setImgSel] = useState<number[]>([]);
  const [placingPoiId, setPlacingPoiId] = useState<string | null>(null);
  const [placingBuilding, setPlacingBuilding] = useState(false);
  const [placingTorreId, setPlacingTorreId] = useState<string | null>(null);
  /**
   * Unidades selecionadas no espelho — a mesma seleção para a grade e a cena
   * 3D. Vive aqui, e não na aba, porque o clique numa caixa do
   * modelo chega pelo `Scene3D`: com a seleção guardada dentro da aba, o id
   * clicado era descartado e a cena era uma tela decorativa.
   *
   * É uma lista, não um Set: a ORDEM define a âncora do Shift (o último item).
   */
  const [unidSel, setUnidSel] = useState<string[]>([]);
  /** Nível em edição na aba Níveis — é dele que o pivô do corte é dono. */
  const [nivelSelId, setNivelSelId] = useState<string | null>(null);
  /**
   * Sair do nível (ou da aba) devolve o pivô ao corte.
   *
   * Posicionar a planta é um momento com começo e fim. Sem isto, trocar de
   * pavimento com o modo ligado deixava o pivô preso na planta do nível
   * anterior, e a seta de altura do corte — a usada o tempo todo — simplesmente
   * não aparecia.
   */
  useEffect(() => {
    setPivoNivel("corte");
  }, [tab, nivelSelId]);
  /** Um input de arquivo serve todos os níveis; o alvo diz para qual é. */
  const nivelPlantaRef = useRef<HTMLInputElement>(null);
  const [nivelPlantaAlvo, setNivelPlantaAlvo] = useState<string | null>(null);
  const [locInput, setLocInput] = useState("");
  /**
   * Pré-visualização do recorte, temporária e não gravada. Sair da aba Local a
   * desliga: com o buraco aberto o clique de posicionar não encontra
   * superfície, e um modo assim ativo numa aba onde não há como desligá-lo
   * seria armadilha.
   */
  /**
   * Recorte visível no editor — LEMBRADO entre sessões, por projeto.
   *
   * Nascia sempre desligado, com a justificativa de que o recorte apaga a
   * superfície de que o editor depende. A justificativa era larga demais: quem
   * precisa do terreno inteiro é a MEDIÇÃO DE COTA, e esse passo já se protege
   * sozinho — o botão de medir detecta o preview ligado e manda desligar antes.
   * Posicionar por clique também precisa, mas só onde há buraco, e o buraco fica
   * onde o prédio já está. Terminada a calibração, a regra só custava um clique
   * a cada refresh para voltar a enxergar o que já estava pronto.
   *
   * Fica no `localStorage`, não no projeto: é preferência de quem está olhando,
   * não dado do empreendimento. No projeto sujaria o arquivo e viajaria para
   * outra máquina junto com a vitrine, que não usa isto para nada.
   */
  const chavePreviewRecorte = `ivm-preview-recorte:${id}`;
  const [previewRecorte, setPreviewRecorte] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`ivm-preview-recorte:${id}`) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(chavePreviewRecorte, previewRecorte ? "1" : "0");
    } catch {
      /* modo privado: vale só para esta sessão */
    }
  }, [chavePreviewRecorte, previewRecorte]);
  /** Via com o traçado aberto para edição no mapa. */
  const [tracandoVia, setTracandoVia] = useState<string | null>(null);
  /** Superfície com o contorno em desenho no mapa 2D. */
  const [tracandoArea, setTracandoArea] = useState<string | null>(null);
  /** Superfície com os pivôs de altura visíveis no 3D. */
  const [areaAlturaId, setAreaAlturaId] = useState<string | null>(null);
  /**
   * O item do entorno ABERTO no painel — um só, via ou superfície.
   *
   * Existe porque a lista mostrava os controles de TODOS os itens ao mesmo
   * tempo. Com duas ruas e duas áreas viravam quatro blocos idênticos
   * empilhados, sem nada dizendo a qual deles pertencia o campo que se estava
   * mexendo. Aberto um por vez, a pergunta "qual eu estou editando" não chega a
   * existir.
   */
  const [abertoEntorno, setAbertoEntorno] = useState<
    { tipo: "via" | "area"; id: string } | null
  >(null);

  /**
   * Abre um item e ENCERRA todos os modos do item anterior.
   *
   * Traçar no mapa e ajustar no 3D eram estados independentes, cada um com seu
   * botão: dava para ficar traçando uma via, ajustando outra e com os pivôs de
   * uma área na tela ao mesmo tempo, sem nenhum deles indicar de quem era.
   * Passando por aqui, existe no máximo um modo ativo e ele é sempre o do item
   * aberto.
   */
  function abrirEntorno(tipo: "via" | "area", id: string) {
    const mesmo = abertoEntorno?.tipo === tipo && abertoEntorno.id === id;
    setTracandoVia(null);
    setTracandoArea(null);
    setViaAlturaId(null);
    setAreaAlturaId(null);
    setAbertoEntorno(mesmo ? null : { tipo, id });
  }
  const [viaAlturaId, setViaAlturaId] = useState<string | null>(null);
  useEffect(() => {
    if (tab !== "local") {
      setPreviewRecorte(false);
      setTracandoVia(null);
      setViaAlturaId(null);
    }
  }, [tab]);
  const [newViewName, setNewViewName] = useState("");
  /** Índice da vista em foco durante a pré-visualização do tour. */
  const [tourIdx, setTourIdx] = useState<number | null>(null);
  /** Estado do botão de tour. Precisa ser state, não ref: ref não re-renderiza. */
  const [tourAtivo, setTourAtivo] = useState(false);
  const tourRef = useRef<TourHandle | null>(null);
  const [season, setSeason] = useState<Season>("verao");
  const [timeMinutes, setTimeMinutes] = useState(780);

  const sceneRef = useRef<Scene3DHandle>(null);
  const glbRef = useRef<HTMLInputElement>(null);
  const mapaGlbRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const symbolRef = useRef<HTMLInputElement>(null);
  const capaRef = useRef<HTMLInputElement>(null);
  /**
   * Um único input de arquivo serve todas as tipologias: guardamos qual
   * tipologia e qual imagem estão sendo enviadas em vez de criar N refs.
   */
  const tipoImgRef = useRef<HTMLInputElement>(null);
  const [tipoAbertaId, setTipoAbertaId] = useState<string | null>(null);
  const [tipoAlvo, setTipoAlvo] = useState<{
    id: string;
    campo: "plantaUrl";
  } | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/config")
      .then((r) => {
        if (!r.ok) throw new Error(`Configuração indisponível (${r.status})`);
        return r.json();
      })
      .then((d) => { if (!cancelado) setApiKey((d.googleMapsApiKey as string) || ""); })
      .catch(() => { if (!cancelado) setApiKey(""); });
    getProjectById(id)
      .then((p) => {
        if (cancelado) return;
        if (!p) return setError("Projeto não encontrado.");
        // Garante id em cada POI (os do seed vêm sem id).
        const pois = ((p.data.empreendimento.pontosDeInteresse ?? []) as unknown as EditablePoi[]).map(
          (x, i) => ({ ...x, id: x.id ?? `poi-${i}` }),
        );
        p.data.empreendimento.pontosDeInteresse = pois as never;
        setProject(p);
        // Havia trabalho não salvo na última sessão? Oferece de volta.
        try {
          const raw = localStorage.getItem(`ivm-rascunho:${id}`);
          if (raw) {
            const r = JSON.parse(raw) as { quando: number; data: ProjectData };
            if (r?.data?.empreendimento) setRascunho(r);
          }
        } catch {
          /* rascunho corrompido: ignorar é melhor do que travar a abertura */
        }
      })
      .catch((e) => { if (!cancelado) setError(e.message); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Grava o rascunho um segundo depois da última alteração. A cota do
  // localStorage é pequena e o rascunho é um extra: se estourar, o editor
  // segue funcionando sem ele.
  useEffect(() => {
    if (!project || !sujo) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(rascunhoKey, JSON.stringify({ quando: Date.now(), data: project.data }));
      } catch {
        /* cota estourada */
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [project, sujo, rascunhoKey]);

  const building = useMemo(() => (project ? projectToBuilding3D(project.data) : null), [project]);
  const buildings = useMemo(() => (building ? [building] : []), [building]);
  const mapaBase = useMemo(() => (project ? projectMapaBase(project.data) : null), [project]);
  const tz = project?.data.config.tzOffset ?? -3;

  const utcDate = useMemo(() => {
    const [y, m, d] = seasonDate(season, new Date().getFullYear());
    return localToUtc(y, m, d, Math.floor(timeMinutes / 60), timeMinutes % 60, tz);
  }, [season, timeMinutes, tz]);
  const sun = useMemo(
    () => getSunReadout(utcDate, building?.lat ?? -8.9398, building?.lng ?? -35.1696),
    [utcDate, building],
  );

  // --- mutações -------------------------------------------------------------
  function setConfig(patch: Partial<ProjectConfig>) {
    registrarHistorico();
    setProject((p) => (p ? { ...p, data: { ...p.data, config: { ...p.data.config, ...patch } } } : p));
    setSaveMsg(null);
    setSujo(true);
  }
  function setEmp(patch: Record<string, unknown>) {
    registrarHistorico();
    setProject((p) => (p ? { ...p, data: { ...p.data, empreendimento: { ...p.data.empreendimento, ...patch } } } : p));
    setSaveMsg(null);
    setSujo(true);
  }
  function setBranding(patch: Partial<Branding>) {
    setConfig({ branding: { ...(project?.data.config.branding ?? {}), ...patch } });
  }
  const pois = ((project?.data.empreendimento.pontosDeInteresse ?? []) as unknown as EditablePoi[]);
  /**
   * Aceita lista OU função, como `setVias`.
   *
   * A forma de função existe porque o envio de fotos é um laço `await`: cada
   * upload volta num instante diferente, e todos partiriam da MESMA lista do
   * render. A segunda foto gravaria por cima da primeira e só a última
   * sobreviveria. Lendo de dentro do atualizador, cada uma parte do que já
   * está gravado.
   */
  function setPois(next: EditablePoi[] | ((atual: EditablePoi[]) => EditablePoi[])) {
    if (typeof next !== "function") return setEmp({ pontosDeInteresse: next });
    registrarHistorico();
    setProject((p) => {
      if (!p) return p;
      const atual = (p.data.empreendimento.pontosDeInteresse ?? []) as unknown as EditablePoi[];
      return {
        ...p,
        data: {
          ...p.data,
          empreendimento: {
            ...p.data.empreendimento,
            pontosDeInteresse: next(atual) as never,
          },
        },
      };
    });
    setSaveMsg(null);
    setSujo(true);
  }
  /**
   * Categorias de POI em vigor. As do projeto, se houver; senão as padrão —
   * assim um projeto antigo abre com a lista que já usava e passa a poder
   * editá-la, em vez de ver a lista esvaziar.
   */
  const categoriasPoi: string[] =
    project?.data.empreendimento.categoriasPoi?.length
      ? project.data.empreendimento.categoriasPoi
      : Array.from(POI_CATEGORIES);

  function setCategoriasPoi(next: string[]) {
    setEmp({ categoriasPoi: next });
  }

  /** Categoria cujo seletor de ícone/cor está aberto. */
  const [catEstiloAberta, setCatEstiloAberta] = useState<string | null>(null);

  /** Grava (ou limpa, com `null`) o ícone/cor de uma categoria. */
  function setEstiloCategoria(cat: string, patch: { icone?: string; cor?: string } | null) {
    const atual = project?.data.empreendimento.estiloCategoriaPoi ?? {};
    const proximo = { ...atual };
    if (patch === null) delete proximo[cat];
    else proximo[cat] = { ...(atual[cat] ?? {}), ...patch };
    setEmp({ estiloCategoriaPoi: Object.keys(proximo).length ? proximo : undefined });
  }

  /** Renomear tem de arrastar os pontos junto, senão eles ficam órfãos. */
  function renomearCategoriaPoi(antiga: string, nova: string) {
    const n = nova.trim();
    if (!n || n === antiga) return;
    if (categoriasPoi.some((c) => c !== antiga && c.toLowerCase() === n.toLowerCase())) {
      setSaveMsg(`Erro: já existe a categoria "${n}".`);
      return;
    }
    setEmp({
      categoriasPoi: categoriasPoi.map((c) => (c === antiga ? n : c)),
      pontosDeInteresse: pois.map((p) => (p.categoria === antiga ? { ...p, categoria: n } : p)) as never,
    });
  }

  function removerCategoriaPoi(cat: string) {
    const usados = pois.filter((p) => p.categoria === cat).length;
    if (usados > 0 && !confirm(`${usados} ponto(s) usam "${cat}".\n\nRemover a categoria? Os pontos continuam no mapa, sem categoria.`)) {
      return;
    }
    setEmp({
      categoriasPoi: categoriasPoi.filter((c) => c !== cat),
      pontosDeInteresse: pois.map((p) => (p.categoria === cat ? { ...p, categoria: "" } : p)) as never,
    });
  }

  const views = project?.data.config.sectionCameras ?? [];
  function setViews(next: NamedView[]) {
    setConfig({ sectionCameras: next });
  }

  // --- Câmeras / cinemática ---------------------------------------------------

  function patchView(id: string, patch: Partial<NamedView>) {
    setViews(views.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  /** Reordena a vista — a posição no array É a ordem do tour. */
  function moverVista(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= views.length) return;
    const n = [...views];
    [n[i], n[j]] = [n[j], n[i]];
    setViews(n);
  }

  /** Só uma vista pode ser a principal. */
  function definirPrincipal(id: string) {
    setViews(views.map((v) => ({ ...v, isMain: v.id === id })));
  }

  /** Grava a câmera atual como uma vista nova, já com miniatura. */
  function capturarVista() {
    const cam = sceneRef.current?.getCurrentCamera();
    if (!cam) return;
    const nova: NamedView = {
      ...cam,
      id: genId("view"),
      name: newViewName.trim() || `Vista ${views.length + 1}`,
      duracao: DURACAO_PADRAO,
      espera: ESPERA_PADRAO,
      thumbUrl: sceneRef.current?.captureImage(240) ?? undefined,
      // A primeira vista salva vira a principal por padrão.
      isMain: views.length === 0,
    };
    setViews([...views, nova]);
    setNewViewName("");
  }

  /** Atualiza posição e miniatura de uma vista com o enquadramento atual. */
  function recapturarVista(id: string) {
    const cam = sceneRef.current?.getCurrentCamera();
    if (!cam) return;
    patchView(id, { ...cam, thumbUrl: sceneRef.current?.captureImage(240) ?? undefined });
    setSaveMsg("Vista recapturada (salve para aplicar)");
  }

  function irParaVista(v: NamedView) {
    sceneRef.current?.flyToCamera(v, v.duracao ?? DURACAO_PADRAO);
    sceneRef.current?.cutAtFloor(v.cutFloorZ ?? null);
  }

  function pararTour() {
    tourRef.current?.parar();
    tourRef.current = null;
    setTourAtivo(false);
    setTourIdx(null);
  }

  function alternarTour() {
    if (tourRef.current) return pararTour();
    const cena = sceneRef.current;
    if (!cena || views.length === 0) return;
    setTourAtivo(true);
    tourRef.current = tocarTour(
      { flyToCamera: (c, d) => cena.flyToCamera(c, d), cutAtFloor: (z) => cena.cutAtFloor(z) },
      views,
      {
        aoEntrar: (_v, i) => setTourIdx(i),
        aoTerminar: () => {
          tourRef.current = null;
          setTourAtivo(false);
          setTourIdx(null);
        },
      },
    );
  }

  // O tour mexe na câmera por temporizador: sem isto ele continuaria rodando
  // depois de sair da página.
  useEffect(() => () => tourRef.current?.parar(), []);

  /**
   * Rede de proteção do trabalho não salvo. O navegador só permite o aviso
   * padrão (a mensagem é dele, não nossa), mas é o suficiente para o fechamento
   * acidental deixar de custar uma tarde de calibração.
   */
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  /**
   * A trava lida pelos atalhos de teclado. Eles são registrados uma vez só, e
   * a closure fixaria o valor da primeira renderização — um ref acompanha.
   */
  const travadoRef = useRef(false);
  travadoRef.current = !!project?.data.config.travado;

  /**
   * W / E / R trocam a ferramenta — a convenção de Unreal, Unity e Blender.
   * Ignora quando o foco está num campo de texto, senão digitar "escala" no
   * nome do projeto viraria uma sequência de trocas de ferramenta.
   */
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      // Esc larga a seleção — sem isto o pivô da unidade fica preso na cena e
      // não há gesto para "não estou editando nada agora".
      if (e.key === "Escape") { setUnidSel([]); return; }
      if (k === "w") setGizmoModo("mover");
      else if (k === "e") setGizmoModo("girar");
      else if (k === "r") setGizmoModo("escalar");
      else return;
      // A ferramenta serve vários pivôs. Nas abas que têm pivô próprio, trocar
      // de aba aqui tiraria da tela justamente o que se está ajustando — foi o
      // que acontecia ao apertar R para redimensionar o retângulo do corte.
      // Com o encaixe travado não há nada a ajustar na aba Modelo: pular para
      // lá só arrancaria o usuário da aba em que ele estava trabalhando.
      setTab((t) => (TABS_COM_PIVO.has(t) || travadoRef.current ? t : "modelo"));
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, []);

  // Ctrl+Z desfaz, Ctrl+Shift+Z (ou Ctrl+Y) refaz.
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); desfazer(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); refazer(); }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passado, futuro, project]);

  // Ctrl+S / Cmd+S salva, como em qualquer editor.
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) void handleSave();
      }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, project]);
  const unidades = project?.data.unidades ?? [];
  function setUnidades(next: Unidade[]) {
    registrarHistorico();
    setProject((p) => (p ? { ...p, data: { ...p.data, unidades: next } } : p));
    setSaveMsg(null);
    setSujo(true);
  }

  // --- Tipologias -------------------------------------------------------------
  // Chegam prontas: o normalizador do ivm-store deriva de `plantas[]` + unidades
  // ao carregar o projeto, então mesmo um projeto antigo já abre com a lista.
  const tipologias: Tipologia[] = project?.data.empreendimento.tipologias ?? [];
  function setTipologias(next: Tipologia[]) {
    setEmp({ tipologias: next });
  }
  function patchTipologia(id: string, patch: Partial<Tipologia>) {
    setTipologias(tipologias.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  /**
   * Renomear leva as UNIDADES junto.
   *
   * `Unidade.tipologia` guarda o NOME, não o id — é a chave histórica, de antes
   * de Tipologias ser entidade própria, e continua sendo o rótulo exibido.
   * Trocar só o nome da tipologia rompia esse vínculo: as unidades passavam a
   * citar um nome que não existe mais, a contagem "12un" ia a zero, e o nome
   * antigo REAPARECIA na lista de órfãs — que é a rename parecer não ter
   * funcionado.
   *
   * As unidades ficam fora de `empreendimento`, então são duas escritas — e a
   * das unidades usa a forma de FUNÇÃO do React, para partir do que já está
   * gravado em vez da lista deste render.
   */
  function renomearTipologia(id: string, nome: string) {
    const antiga = tipologias.find((t) => t.id === id);
    if (!antiga) return;
    setEmp({ tipologias: tipologias.map((t) => (t.id === id ? { ...t, nome } : t)) });
    // As unidades vivem fora de `empreendimento`, então precisam do seu próprio
    // caminho. Só as que apontam para esta tipologia — por id (o vínculo novo)
    // ou pelo nome antigo (o legado, para quem ainda não passou pelo
    // normalizador).
    setProject((p) => {
      if (!p) return p;
      return {
        ...p,
        data: {
          ...p.data,
          unidades: (p.data.unidades ?? []).map((u) => (
            u.tipologiaId === id || u.tipologia === antiga.nome
              ? { ...u, tipologia: nome, tipologiaId: id }
              : u
          )),
        },
      };
    });
  }
  function pedirImagemTipologia(id: string, campo: "plantaUrl") {
    setTipoAlvo({ id, campo });
    tipoImgRef.current?.click();
  }
  /** Quantas unidades usam esta tipologia (por id ou, no legado, pelo nome). */
  function unidadesDaTipologia(t: Tipologia): number {
    return unidades.filter((u) => u.tipologiaId === t.id || u.tipologia === t.nome).length;
  }
  /** Nomes citados pelas unidades que não têm tipologia cadastrada. */
  const tipologiasOrfas = Array.from(
    new Set(unidades.map((u) => u.tipologia).filter(Boolean)),
  ).filter((nome) => !tipologias.some((t) => t.nome === nome));
  const torres: TorreDef[] = project?.data.config.torres ?? [];
  const pavCfg: PavimentosCfg | null = project ? projectPavCfg(project.data) : null;
  const crm: CrmConfig = project?.data.config.crm ?? { mode: "manual" };
  const entorno: EntornoCfg = project?.data.config.entorno ?? {};
  const vias: Via[] = entorno.vias ?? [];
  /**
   * Sempre pela FUNÇÃO, nunca pela lista do render.
   *
   * `setConfig` atualiza o projeto por função, mas o `patch` que recebe era
   * montado a partir do `entorno` deste render — uma foto do estado. Duas
   * escritas de via na mesma leva (o arraste do pivô emite a 20 fps, e cada
   * emissão é um `patchVia`) faziam a segunda gravar por cima da primeira uma
   * lista velha. Era assim que uma via excluída voltava sozinha: a exclusão
   * entrava, e a escrita seguinte a trazia de volta junto com a lista anterior.
   *
   * Recebendo a lista de dentro do próprio atualizador, cada escrita parte do
   * que já está gravado — e um `patchVia` preso a um render antigo continua
   * correto.
   */
  function setVias(next: Via[] | ((atual: Via[]) => Via[])) {
    registrarHistorico();
    /**
     * Duas vias com o MESMO id andam juntas, e não há como não andarem: tudo
     * aqui casa por id. `patchVia` faz `map` e altera as duas; no 3D as duas
     * disputam os mesmos ids de entidade do Cesium. É o "mexe numa e mexe na
     * outra".
     *
     * Ids repetidos não deviam existir — `genId` sorteia —, mas o bug do estado
     * velho que acabei de corrigir gravava listas montadas em cima de fotos
     * antigas, e uma delas pode ter deixado a duplicata gravada no projeto.
     * Corrigir a escrita não desfaz o que já está salvo.
     *
     * Renomear em vez de descartar: a segunda via tem traçado e cotas que
     * custaram a fazer. Ela passa a existir por conta própria na primeira
     * gravação, sem o usuário precisar refazer nada.
     */
    function comIdsUnicos(lista: Via[]): Via[] {
      const vistos = new Set<string>();
      return lista.map((v) => {
        if (!vistos.has(v.id)) {
          vistos.add(v.id);
          return v;
        }
        const novo = genId("via");
        console.warn(`[editor] via com id repetido (${v.id}); renomeada para ${novo}`);
        vistos.add(novo);
        return { ...v, id: novo };
      });
    }
    setProject((p) => {
      if (!p) return p;
      const cfgEntorno: EntornoCfg = p.data.config.entorno ?? {};
      const atual = cfgEntorno.vias ?? [];
      const lista = comIdsUnicos(typeof next === "function" ? next(atual) : next);
      return {
        ...p,
        data: {
          ...p.data,
          config: {
            ...p.data.config,
            entorno: { ...cfgEntorno, vias: lista.length ? lista : undefined },
          },
        },
      };
    });
    setSaveMsg(null);
    setSujo(true);
  }
  function patchVia(id: string, patch: Partial<Via>) {
    setVias((atual) => atual.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }
  const superficies: Superficie[] = entorno.superficies ?? [];
  /** Mesmo cuidado do `setVias`: a lista vem de dentro do atualizador. */
  function setSuperficies(next: Superficie[] | ((atual: Superficie[]) => Superficie[])) {
    registrarHistorico();
    setProject((p) => {
      if (!p) return p;
      const cfgEntorno: EntornoCfg = p.data.config.entorno ?? {};
      const atual = cfgEntorno.superficies ?? [];
      const lista = typeof next === "function" ? next(atual) : next;
      return {
        ...p,
        data: {
          ...p.data,
          config: {
            ...p.data.config,
            entorno: {
              ...cfgEntorno,
              superficies: lista.length ? lista : undefined,
            },
          },
        },
      };
    });
    setSaveMsg(null);
    setSujo(true);
  }
  function patchArea(id: string, patch: Partial<Superficie>) {
    setSuperficies((atual) => atual.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function patchTracadoVia(id: string, pontos: Via["pontos"]) {
    // Qualquer mudança horizontal invalida as alturas medidas anteriormente.
    setVias((atual) => atual.map((v) => (v.id === id
      ? { ...v, pontos, cotas: undefined, perfil: undefined }
      : v)));
    if (viaAlturaId === id) setViaAlturaId(null);
  }
  const contato: ContatoCfg = project?.data.config.contato ?? {};
  function setContato(patch: Partial<ContatoCfg>) {
    setConfig({ contato: { ...contato, ...patch } });
  }
  const ambiente = project ? projectAmbiente(project.data) : null;
  function setAmbiente(patch: Partial<AmbienteCfg>) {
    setConfig({ ambiente: { ...(project?.data.config.ambiente ?? {}), ...patch } });
  }

  /**
   * Pré-visualização do modo noturno DENTRO do editor.
   *
   * A cena do editor não recebia `noturno` nem `realceNoturno`, então o slider
   * "Realce do prédio à noite" gravava um número e não mudava um pixel: o
   * modelo ficava sempre no ramo diurno de `aplicarAparenciaModelo`, com mistura
   * fixa em 0.3. Calibrava-se às cegas e só se via o resultado publicando.
   */
  const [previewNoturno, setPreviewNoturno] = useState(false);

  /**
   * Preview do modo SEM cidade 3D (estúdio).
   *
   * Mesma lógica do preview noturno: o mini mapa só é desenhado com a
   * fotogrametria desligada, e o editor sempre a manteve ligada. Sem este
   * interruptor, calibrar o mini mapa seria salvar às cegas e conferir na
   * vitrine publicada — exatamente o que o preview noturno existe para evitar.
   *
   * Bônus de calibração: sem a fotogrametria por cima, dá para ver se o
   * terreno do mini mapa encontra a base do prédio ou se atravessa por dentro.
   */
  const [previewEstudio, setPreviewEstudio] = useState(false);

  /** Liga/desliga o preview e leva o relógio junto — como faz a vitrine. */
  function alternarPreviewNoturno() {
    if (!ambiente) return;
    const indo = !previewNoturno;
    setPreviewNoturno(indo);
    setTimeMinutes(indo ? ambiente.horaNoturna : ambiente.horaPadrao);
  }

  /**
   * Sair da aba desliga o preview: o botão que o apaga mora só aqui, e uma cena
   * noturna presa enquanto se posiciona o GLB seria um estado sem saída.
   */
  useEffect(() => {
    if (tab !== "ambiente") setPreviewNoturno(false);
  }, [tab]);

  /** Mesmo motivo: o interruptor do estúdio mora na aba "modelo". */
  useEffect(() => {
    if (tab !== "modelo") setPreviewEstudio(false);
  }, [tab]);


  /**
   * Há um posicionamento por clique em curso. Declarado aqui, antes dos memos
   * da cena, porque eles precisam sair da frente do clique — o `Scene3D` já
   * trata o clique de posicionar como prioritário, mas as alças e as caixas
   * ignoram profundidade e o interceptariam antes.
   */
  const placing = !!placingPoiId || placingBuilding || !!placingTorreId;

  // Preview do espelho 3D enquanto se calibra as torres na aba Unidades.
  const [torreSelId, setTorreSelId] = useState<string>("");

  /**
   * A aba Unidades nasce com a primeira torre de fato selecionada.
   *
   * Vazio, `torreSelId` deixava o contorno da torre e o pivô fora da cena — e o
   * inspetor dizia "Escolha uma torre" enquanto a pastilha da primeira já
   * aparecia acesa (ela cai no `|| torres[0]` do rótulo). O usuário via uma
   * torre selecionada sem nenhum controle dela em lugar nenhum.
   */
  useEffect(() => {
    const torres = project?.data.config.torres ?? [];
    if (!torres.length) return;
    if (!torreSelId || !torres.some((t) => t.id === torreSelId)) {
      setTorreSelId(torres[0].id);
    }
  }, [project?.data.config.torres, torreSelId]);
  /** Unidade em foco: a primeira da seleção. É ela que define o andar isolado. */
  const unidFoco = unidades.find((u) => u.id === unidSel[0]);

  const unitBoxes = useMemo(() => {
    if (tab !== "unidades" || !building || !pavCfg || unidades.length === 0) return [];
    // Ao posicionar a torre, o espelho sai da frente: senão o clique acerta uma
    // caixa em vez do terreno. Fica só o contorno da torre para guiar.
    if (placingTorreId) return [];
    return buildUnitBoxes({
      buildingId: building.id,
      unidades,
      torres,
      pavCfg,
      /**
       * Com uma unidade em foco, só o PAVIMENTO dela fica na cena.
       *
       * O corte já abre o andar certo, mas as unidades dos outros continuavam
       * desenhadas — inclusive as de cima, que o corte removeu do modelo e que
       * ficavam boiando sobre a laje aberta. Calibrar tamanho e encaixe virava
       * disputar o clique e a vista com caixas que não são do andar.
       *
       * O filtro é por andar E por bloco: num projeto de várias torres, o "4º
       * pavimento" existe em cada uma, e mostrar os três não resolveria nada.
       *
       * `mostrarFantasmas: false` porque aqui a intenção é sumir de verdade —
       * fantasma a 0,05 de opacidade continua interceptando o clique.
       */
      visiveis: isolarPavimento && unidFoco
        ? new Set(
            unidades
              .filter((u) => u.pavimento === unidFoco.pavimento && u.torre === unidFoco.torre)
              .map((u) => u.id),
          )
        : undefined,
      mostrarFantasmas: false,
      selecionadas: new Set(unidSel),
      // No editor o modelo fica SÓLIDO (ver `aplicarAparenciaModelo`) e são as
      // caixas que ficam translúcidas: a fachada é a referência do
      // posicionamento, e ela precisa ser legível por trás delas.
      opacidade: 0.45,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, building, pavCfg, unidades, torres, placingTorreId, unidSel, isolarPavimento]);

  // ===== Níveis e cortes ======================================================
  /** Níveis editados do projeto (vazio = ainda usando a escada automática). */
  const niveis: NivelDef[] = project?.data.config.niveis ?? [];
  function setNiveis(next: NivelDef[]) {
    setConfig({ niveis: next.length ? next : undefined });
  }
  const nivelSel = nivelSelId ? (niveis.find((n) => n.id === nivelSelId) ?? null) : null;

  /** Aplica um nível na cena: o corte e a câmera derivada dele. */
  function verNivel(n: NivelDef, comCamera = true) {
    const cena = sceneRef.current;
    if (!cena || !pavCfg) return;
    const corte = corteDoNivel(n);
    cena.cutAtFloor(corte);
    if (!comCamera) return;
    if (!corte) { cena.frameBuilding(); return; }
    cena.viewCorteDeCima(
      corte,
      n.camDist ?? pavCfg.camDist,
      n.camPitch ?? pavCfg.camPitch,
      n.camGiro ?? pavCfg.camGiro,
      1.4,
    );
  }

  /**
   * O corte segue o nível em edição, ao vivo.
   *
   * É o que torna a altura ajustável de verdade: arrastar a alça move o plano
   * e o prédio se abre junto, em vez de digitar um número e conferir depois.
   * Ao sair da aba (ou largar o nível) o corte é desfeito — senão o modelo
   * ficaria cortado nas outras abas.
   */
  /**
   * Pavimento da unidade em foco, na aba Unidades.
   *
   * Calibrar uma unidade é conferir se ela tem o tamanho e o lugar certos DENTRO
   * do andar dela — e o andar está enterrado sob todos os de cima. Sem corte, o
   * trabalho era posicionar às cegas e conferir depois na aba Níveis.
   *
   * Sai da unidade selecionada, não de um seletor próprio: escolher a unidade já
   * diz de que andar se está falando, e trocar o pavimento dela no inspetor
   * reabre o corte no lugar novo sem nenhum gesto a mais.
   */
  const corteDaUnidade = useMemo(() => {
    if (tab !== "unidades" || !pavCfg) return null;
    const u = unidades.find((x) => x.id === unidSel[0]);
    if (!u || u.pavimento == null) return null;
    const n = nivelDoPavimento(niveis, pavCfg, u.pavimento, u.torre);
    return n ? corteDoNivel(n) : null;
  }, [tab, pavCfg, unidades, unidSel, niveis]);

  useEffect(() => {
    const cena = sceneRef.current;
    if (!cena || !ready) return;
    if (tab === "niveis" && nivelSel) {
      cena.cutAtFloor(corteDoNivel(nivelSel));
      return;
    }
    // Na aba Unidades quem manda é a unidade selecionada. Sem seleção, o modelo
    // volta inteiro — senão ficaria cortado depois de largar a unidade.
    if (tab === "unidades") {
      cena.cutAtFloor(corteDaUnidade);
      return;
    }
    cena.cutAtFloor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ready, nivelSel?.id, nivelSel?.cutZ, nivelSel?.area, corteDaUnidade]);

  /** Laje do retângulo do corte, desenhada só enquanto se edita o nível. */
  const corteArea = useMemo(
    () =>
      tab === "niveis" && building && nivelSel?.cutZ != null && nivelSel.area
        ? { buildingId: building.id, z: nivelSel.cutZ, area: nivelSel.area }
        : null,
    [tab, building, nivelSel],
  );

  /**
   * Planta do nível deitada no chão, no editor.
   *
   * Depende das MESMAS condições do corte — nível aberto, com cota e com
   * retângulo — porque é o retângulo do corte que dá lugar, tamanho e giro à
   * planta. Sem ele não há onde deitá-la, e inventar um retângulo próprio faria
   * planta e corte divergirem no primeiro ajuste.
   */
  const plantaPavimento = useMemo(
    () =>
      tab === "niveis" && building && nivelSel?.plantaNoChao && nivelSel.plantaUrl
        && nivelSel.cutZ != null && (nivelSel.plantaArea ?? nivelSel.area)
        ? {
            buildingId: building.id,
            url: nivelSel.plantaUrl,
            area: (nivelSel.plantaArea ?? nivelSel.area)!,
            z: alturaDaPlanta(nivelSel)!,
            opacidade: nivelSel.plantaOpacidade,
          }
        : null,
    [tab, building, nivelSel],
  );

  /**
   * Posição efetiva de uma unidade no modelo: a dela, se já tiver pivô próprio,
   * ou a que o fatiamento da torre lhe dá.
   *
   * É o que permite pegar QUALQUER unidade na cena e arrastá-la. Antes só as
   * unidades com posição personalizada tinham pivô — e como num projeto típico elas são um punhado entre
   * centenas, clicar numa unidade normal não mostrava pivô nenhum. A posição
   * própria passa a nascer no primeiro arraste, no lugar exato onde a unidade
   * já estava.
   */
  function posicaoEfetiva(u: Unidade): NonNullable<Unidade["posicao"]> | null {
    if (u.posicao) return u.posicao;
    const c = unitBoxes.find((x) => x.id === u.id);
    if (!c) return null;
    // A caixa vem com o centro; `posicao.z` é a base.
    return { x: c.x, y: c.y, z: c.z - c.dz / 2, dx: c.dx, dy: c.dy, dz: c.dz, rot: c.rot };
  }

  /**
   * Pivô do alvo local: unidade selecionada, grupo ou volume da torre.
   *
   * A prioridade é a da atenção do usuário: o que ele acabou de selecionar
   * ganha o pivô; sem seleção, ele fica no volume da torre em calibração.
   * Some durante um posicionamento por clique, senão as alças (que ignoram
   * profundidade) interceptam o clique destinado ao terreno.
   */
  const gizmoLocal: GizmoLocal | null = useMemo(() => {
    if (!building || !pavCfg || placing) return null;

    /**
     * Aba Níveis: o pivô é o próprio corte.
     *
     * Com área, ele manipula o retângulo inteiro — mover leva o quadrado pelo
     * modelo E a seta vertical sobe/desce o corte (a altura do retângulo É a
     * altura do corte), girar orienta o retângulo e escalar o redimensiona.
     * Sem área, o corte atravessa tudo e só resta a altura: uma liberdade só,
     * daí `somenteZ`.
     */
    if (tab === "niveis") {
      if (!nivelSel || nivelSel.cutZ == null) return null;
      const a = nivelSel.area;
      /**
       * Pivô da PLANTA, quando escolhido.
       *
       * Corte e planta têm alturas independentes — o corte abre o teto, a
       * planta deita no chão — e um pivô só não dá conta de duas alturas. O
       * seletor no painel escolhe qual das duas está na mão.
       *
       * `somenteZ`: a planta herda lugar, tamanho e giro do retângulo do corte.
       * Só a altura é dela, então só a seta vertical faz sentido.
       */
      const pa = nivelSel.plantaArea ?? a;
      if (pivoNivel === "planta" && nivelSel.plantaNoChao && nivelSel.plantaUrl && pa) {
        return {
          id: `planta:${nivelSel.id}`,
          buildingId: building.id,
          x: pa.x,
          y: pa.y,
          z: alturaDaPlanta(nivelSel)!,
          rot: pa.rot ?? 0,
          // Pivô COMPLETO, não só a altura: a planta tem retângulo próprio, e
          // encaixá-la no pavimento é mover, girar e redimensionar — a altura é
          // só uma das quatro coisas. `dz: 1` dá tamanho às alças; a planta não
          // tem espessura e `onGizmoLocal` não lê `dz` para ela.
          dims: { dx: pa.comprimento, dy: pa.largura, dz: 1 },
          semEscalaZ: true,
        };
      }
      return {
        id: `nivel:${nivelSel.id}`,
        buildingId: building.id,
        x: a?.x ?? 0,
        y: a?.y ?? 0,
        z: nivelSel.cutZ,
        rot: a?.rot ?? 0,
        dims: a ? { dx: a.comprimento, dy: a.largura, dz: 1 } : undefined,
        somenteZ: !a,
        // O corte é um plano: tem retângulo, não tem espessura. O `dz: 1` acima
        // só dá tamanho às alças — `onGizmoLocal` nem lê `dz` para o nível.
        semEscalaZ: true,
      };
    }

    if (tab !== "unidades") return null;

    const sel = unidSel.map((id) => unidades.find((u) => u.id === id)).filter((u): u is Unidade => !!u);
    if (sel.length === 1) {
      const p = posicaoEfetiva(sel[0]);
      if (!p) return null;
      return {
        id: `unidade:${sel[0].id}`,
        buildingId: building.id,
        // A origem fica na BASE da caixa, como o campo "Base Z (m)" do
        // inspetor: arrastar a seta azul e digitar no campo dizem o mesmo.
        x: p.x, y: p.y, z: p.z,
        rot: p.rot ?? 0,
        rotX: p.rotX ?? 0,
        rotY: p.rotY ?? 0,
        dims: { dx: p.dx ?? 8, dy: p.dy ?? 10, dz: p.dz ?? pavCfg.nivelM },
      };
    }
    if (sel.length > 1) {
      const pos = sel.map(posicaoEfetiva).filter((p): p is NonNullable<typeof p> => !!p);
      if (!pos.length) return null;
      const n = pos.length;
      const c = pos.reduce(
        (a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n, z: a.z + p.z / n }),
        { x: 0, y: 0, z: 0 },
      );
      return {
        id: "grupo",
        buildingId: building.id,
        x: c.x, y: c.y, z: c.z,
        rot: 0, rotX: 0, rotY: 0,
        somenteMover: true,
      };
    }

    // Sem unidade em foco, o pivô calibra a torre — é a outra coisa que se
    // posiciona nesta aba, e antes só existia como campo numérico escondido.
    const i = torres.findIndex((t) => t.id === torreSelId);
    if (i < 0) return null;
    const v = volumeDaTorre(torres[i], i, torres.length);
    const { base, altura } = faixaVertical(v, pavCfg);
    return {
      id: `torre:${torres[i].id}`,
      buildingId: building.id,
      x: v.x, y: v.y, z: base,
      rot: v.rot ?? 0, rotX: v.rotX ?? 0, rotY: v.rotY ?? 0,
      dims: { dx: v.comprimento, dy: v.largura, dz: altura },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, building, pavCfg, unidades, unidSel, torres, torreSelId, placing, nivelSel]);

  /**
   * Regra de seleção, comum ao clique na cena e ao clique na grade: Ctrl (ou
   * Shift, na cena, onde intervalo não tem sentido espacial) acumula; o clique
   * simples troca a seleção e, repetido no mesmo item, a larga.
   */
  function selecionarUnidade(uid: string, mods: { ctrl: boolean; shift: boolean }) {
    setUnidSel((atual) => {
      if (mods.ctrl || mods.shift) {
        return atual.includes(uid) ? atual.filter((x) => x !== uid) : [...atual, uid];
      }
      return atual.length === 1 && atual[0] === uid ? [] : [uid];
    });
  }

  /**
   * Arraste do pivô local. O `Scene3D` só sabe de metros e graus do modelo —
   * traduzir isso para o campo certo de cada alvo é responsabilidade daqui.
   */
  /**
   * Contorno da unidade, vindo do arraste na cena.
   *
   * Pela FUNÇÃO do React, e não pela lista do render: o arraste emite a 20 fps
   * e `setUnidades(unidades.map(...))` partiria sempre da mesma foto — a mesma
   * armadilha que já derrubou as vias e os POIs. A unidade nasce com a posição
   * efetiva quando ainda era fatia da torre, senão gravar um contorno a deixaria
   * sem lugar próprio.
   */
  function setPlantaUnidade(uid: string, planta: { x: number; y: number }[]) {
    registrarHistorico();
    setProject((p) => {
      if (!p) return p;
      return {
        ...p,
        data: {
          ...p.data,
          unidades: (p.data.unidades ?? []).map((u) => {
            if (u.id !== uid) return u;
            const base = posicaoEfetiva(u);
            return base ? { ...u, posicao: { ...base, planta } } : u;
          }),
        },
      };
    });
    setSaveMsg(null);
    setSujo(true);
  }

  function onGizmoLocal(alvoId: string, patch: GizmoLocalPatch) {
    if (alvoId.startsWith("planta:")) {
      const nid = alvoId.slice("planta:".length);
      setNiveis(niveis.map((n) => {
        if (n.id !== nid) return n;
        const base = n.plantaArea ?? n.area
          ?? { x: 0, y: 0, comprimento: 40, largura: 30, rot: 0 };
        return {
          ...n,
          // O pivô devolve altura absoluta; guardamos a DISTÂNCIA até o corte.
          // É o que faz a planta acompanhar o corte de graça, sem código.
          plantaZOffset: patch.z != null && n.cutZ != null
            ? patch.z - n.cutZ
            : n.plantaZOffset,
          plantaArea: {
            x: patch.x ?? base.x,
            y: patch.y ?? base.y,
            rot: patch.rot ?? base.rot,
            comprimento: patch.dx ?? base.comprimento,
            largura: patch.dy ?? base.largura,
          },
        };
      }));
      return;
    }
    if (alvoId.startsWith("nivel:")) {
      const nid = alvoId.slice("nivel:".length);
      setNiveis(niveis.map((n) => {
        if (n.id !== nid) return n;
        // A altura do retângulo é a altura do corte — são a mesma coisa.
        const cutZ = patch.z != null ? patch.z : n.cutZ;
        // A planta acompanha o corte SOZINHA: a altura dela é guardada como
        // distância até ele. Havia código aqui para arrastá-la junto; virou
        // desnecessário quando a altura deixou de ser absoluta.
        if (!n.area) return { ...n, cutZ };
        return {
          ...n,
          cutZ,
          area: {
            ...n.area,
            x: patch.x ?? n.area.x,
            y: patch.y ?? n.area.y,
            rot: patch.rot ?? n.area.rot,
            comprimento: patch.dx ?? n.area.comprimento,
            largura: patch.dy ?? n.area.largura,
          },
        };
      }));
      return;
    }
    if (alvoId.startsWith("unidade:")) {
      const uid = alvoId.slice("unidade:".length);
      setUnidades(
        unidades.map((u) => {
          if (u.id !== uid) return u;
          // Unidade ainda da grade: o pivô nasce aqui, no lugar em que o
          // fatiamento já a desenhava, e a partir de agora ela guarda posição própria.
          const base = posicaoEfetiva(u);
          return base ? { ...u, posicao: { ...base, ...patch } } : u;
        }),
      );
      return;
    }
    if (alvoId === "grupo") {
      // O pivô do grupo é o centroide, e o que chega é a posição ABSOLUTA dele.
      // O deslocamento aplicado a cada unidade é a diferença para o centroide
      // atual — que, sendo derivado do estado, acompanha o arraste sozinho.
      const sel = unidSel
        .map((id) => unidades.find((u) => u.id === id))
        .filter((u): u is Unidade => !!u)
        .map((u) => ({ u, p: posicaoEfetiva(u) }))
        .filter((e): e is { u: Unidade; p: NonNullable<Unidade["posicao"]> } => !!e.p);
      if (!sel.length) return;
      const n = sel.length;
      const c = sel.reduce(
        (a, { p }) => ({ x: a.x + p.x / n, y: a.y + p.y / n, z: a.z + p.z / n }),
        { x: 0, y: 0, z: 0 },
      );
      const d = {
        x: patch.x != null ? patch.x - c.x : 0,
        y: patch.y != null ? patch.y - c.y : 0,
        z: patch.z != null ? patch.z - c.z : 0,
      };
      const base = new Map(sel.map(({ u, p }) => [u.id, p]));
      setUnidades(
        unidades.map((u) => {
          const p = base.get(u.id);
          return p
            ? { ...u, posicao: { ...p, x: p.x + d.x, y: p.y + d.y, z: p.z + d.z } }
            : u;
        }),
      );
      return;
    }
    if (alvoId.startsWith("torre:")) {
      const tid = alvoId.slice("torre:".length);
      const i = torres.findIndex((t) => t.id === tid);
      if (i < 0 || !pavCfg) return;
      const v = volumeDaTorre(torres[i], i, torres.length);
      const { altura } = faixaVertical(v, pavCfg);
      const novo: TorreVolume = { ...v, altura };
      if (patch.x != null) novo.x = patch.x;
      if (patch.y != null) novo.y = patch.y;
      if (patch.z != null) novo.z = patch.z;
      if (patch.rot != null) novo.rot = patch.rot;
      if (patch.rotX != null) novo.rotX = patch.rotX;
      if (patch.rotY != null) novo.rotY = patch.rotY;
      // A escala do pivô redimensiona a caixa da torre nos três eixos.
      if (patch.dx != null) novo.comprimento = patch.dx;
      if (patch.dy != null) novo.largura = patch.dy;
      if (patch.dz != null) novo.altura = patch.dz;
      const n = [...torres];
      n[i] = { ...n[i], volume: novo };
      setConfig({ torres: n });
    }
  }

  // Contorno da torre em calibração: a caixa que se está ajustando aparece na
  // cena, para o ajuste ser visual e não às cegas.
  const towerOutline: TowerOutline | null = useMemo(() => {
    if (tab !== "unidades" || !building || !pavCfg || !torreSelId) return null;
    const i = torres.findIndex((t) => t.id === torreSelId);
    if (i < 0) return null;
    const v = volumeDaTorre(torres[i], i, torres.length);
    const { base, altura } = faixaVertical(v, pavCfg);
    return {
      buildingId: building.id,
      x: v.x, y: v.y, z: base, altura,
      comprimento: v.comprimento, largura: v.largura,
      rot: v.rot ?? 0, rotX: v.rotX ?? 0, rotY: v.rotY ?? 0,
    };
  }, [tab, building, pavCfg, torres, torreSelId]);

  const galeria = (project?.data.empreendimento.galeria ?? []) as {
    url: string; legenda: string; categoria?: string;
  }[];
  const videos = (project?.data.empreendimento.videos ?? []) as {
    url: string; poster?: string; titulo: string;
  }[];
  function setVideos(next: typeof videos) {
    setEmp({ videos: next });
  }

  // Destaques e lazer já chegam normalizados como ItemLista pelo ivm-store.
  const destaques = (project?.data.empreendimento.highlights ?? []) as ItemLista[];
  const lazer = (project?.data.empreendimento.amenities ?? []) as ItemLista[];

  /**
   * Um input de arquivo serve todos os itens das duas listas: guardamos o que
   * fazer com a URL em vez de criar um ref por item.
   */
  const itemFotoRef = useRef<HTMLInputElement>(null);
  const aplicarFotoRef = useRef<((url: string) => void) | null>(null);
  function pedirFotoItem(_id: string, aplicar: (url: string) => void) {
    aplicarFotoRef.current = aplicar;
    itemFotoRef.current?.click();
  }

  /**
   * Categorias da galeria. Vêm do projeto e definem a ORDEM dos filtros na
   * vitrine. Enquanto o projeto não tiver a lista salva, ela é derivada das
   * próprias imagens — assim uma galeria antiga não perde a organização.
   */
  const categoriasGaleria: string[] =
    project?.data.empreendimento.categoriasGaleria?.length
      ? project.data.empreendimento.categoriasGaleria
      : Array.from(new Set(galeria.map((g) => g.categoria?.trim()).filter((c): c is string => !!c)));

  function setCategorias(next: string[]) {
    setEmp({ categoriasGaleria: next });
  }

  /** Renomear precisa arrastar as imagens junto, senão elas ficam órfãs. */
  function renomearCategoria(antiga: string, nova: string) {
    const n = nova.trim();
    if (!n || n === antiga) return;
    if (categoriasGaleria.some((c) => c !== antiga && c.toLowerCase() === n.toLowerCase())) {
      setSaveMsg(`Erro: já existe a categoria "${n}".`);
      return;
    }
    setEmp({
      categoriasGaleria: categoriasGaleria.map((c) => (c === antiga ? n : c)),
      galeria: galeria.map((g) => (g.categoria === antiga ? { ...g, categoria: n } : g)),
    });
  }

  /** Remover não apaga imagem nenhuma: apenas as desclassifica. */
  function removerCategoria(cat: string) {
    const usadas = galeria.filter((g) => g.categoria === cat).length;
    if (usadas > 0 && !confirm(`${usadas} imagem(ns) usam "${cat}".\n\nRemover a categoria? As imagens continuam na galeria, sem categoria.`)) {
      return;
    }
    setEmp({
      categoriasGaleria: categoriasGaleria.filter((c) => c !== cat),
      galeria: galeria.map((g) => (g.categoria === cat ? { ...g, categoria: undefined } : g)),
    });
    if (filtroCategoria === cat) setFiltroCategoria("");
  }

  function moverCategoria(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= categoriasGaleria.length) return;
    const n = [...categoriasGaleria];
    [n[i], n[j]] = [n[j], n[i]];
    setCategorias(n);
  }

  // --- Galeria: filtros e ações em lote ---------------------------------------

  /**
   * Índices das imagens que passam pelos filtros ativos (categoria + texto).
   *
   * Calculado uma vez e reusado pela lista e pelo "marcar todas": se cada um
   * repetisse o predicado, marcar todas poderia pegar imagens que a lista não
   * está mostrando.
   */
  const galeriaVisivel = useMemo(() => {
    const q = buscaImagem.trim().toLowerCase();
    const out = new Set<number>();
    galeria.forEach((g, i) => {
      const porCat =
        !filtroCategoria ||
        (filtroCategoria === "__sem__" ? !g.categoria : g.categoria === filtroCategoria);
      const porTexto = !q || `${g.legenda} ${g.categoria ?? ""}`.toLowerCase().includes(q);
      if (porCat && porTexto) out.add(i);
    });
    return out;
  }, [galeria, filtroCategoria, buscaImagem]);

  // --- Galeria: ações em lote -------------------------------------------------

  /** Classifica (ou desclassifica) de uma vez todas as imagens marcadas. */
  function categoriaEmLote(cat: string | undefined) {
    const alvo = new Set(imgSel);
    setEmp({ galeria: galeria.map((g, i) => (alvo.has(i) ? { ...g, categoria: cat } : g)) });
    setImgSel([]);
  }

  function apagarSelecionadas() {
    if (!imgSel.length) return;
    if (!confirm(`Remover ${imgSel.length} imagem(ns) da galeria?`)) return;
    const alvo = new Set(imgSel);
    setEmp({ galeria: galeria.filter((_, i) => !alvo.has(i)) });
    setImgSel([]);
  }

  /**
   * Vizinha VISÍVEL na direção pedida, ou -1 se não houver.
   *
   * Com um filtro ativo, a vizinha no array quase nunca é a vizinha na tela:
   * trocar com ela reordenava duas imagens ocultas e a lista não mudava —
   * clicar na seta parecia não fazer nada.
   */
  function vizinhaVisivel(i: number, delta: number): number {
    for (let j = i + delta; j >= 0 && j < galeria.length; j += delta) {
      if (galeriaVisivel.has(j)) return j;
    }
    return -1;
  }

  /** Troca a imagem de lugar com a vizinha — a ordem da lista é a da vitrine. */
  function moverImagem(i: number, delta: number) {
    const j = vizinhaVisivel(i, delta);
    if (j < 0) return;
    const n = [...galeria];
    [n[i], n[j]] = [n[j], n[i]];
    setEmp({ galeria: n });
    setImgSel([]);
  }

  function criarCategoria(nome: string): boolean {
    const n = nome.trim();
    if (!n) return false;
    if (categoriasGaleria.some((c) => c.toLowerCase() === n.toLowerCase())) {
      setSaveMsg(`Erro: já existe a categoria "${n}".`);
      return false;
    }
    setCategorias([...categoriasGaleria, n]);
    return true;
  }
  const plantas = (project?.data.empreendimento.plantas ?? []) as {
    area: string; vagas: string; descricao?: string; imagemUrl?: string;
  }[];

  /**
   * Plantas legadas que nem uma tipologia nem um nível reclamaram. É o que
   * sobrou da aba Plantas, e o único motivo para o campo continuar existindo.
   */
  const plantasSemDono = project
    ? plantasOrfas(project.data.empreendimento, niveisDe(pavCfg ?? {}, niveis))
    : [];

  /**
   * Plantas cadastradas no projeto: as de TIPOLOGIA, mais as legadas.
   *
   * Servem a dois seletores — o do nível e o da unidade —, e nos dois o envio
   * acontece em Tipologias, num lugar só. Deliberadamente SEM os níveis:
   * `plantasDoProjeto` os inclui, e no seletor de um pavimento isso seria
   * circular (ele passaria a oferecer as plantas dos pavimentos, inclusive a
   * dele mesmo). Mesma regra da galeria da vitrine, e por isso o helper é
   * compartilhado.
   */
  const plantasCadastradas = useMemo(
    () => (project ? plantasDeTipologia(project.data.empreendimento) : []),
    [project?.data.empreendimento],
  );

  /**
   * Peso de referência do GLB, em MB.
   *
   * O piloto validado tem 23 MB (Draco + WebP) e roda. O bruto de onde ele saiu
   * tem 424 MB. Entre um e outro não havia aviso nenhum: o editor aceitava o
   * arquivo, o upload demorava, e o problema só aparecia como vitrine travada
   * no celular do cliente — longe de quem podia consertar.
   */
  const GLB_ALERTA_MB = 40;
  const GLB_LIMITE_MB = 120;

  function mb(bytes: number) {
    return bytes / (1024 * 1024);
  }

  /**
   * Confere o peso antes de subir. Avisa a partir de 40 MB e PEDE CONFIRMAÇÃO
   * acima de 120 MB — nunca bloqueia: quem opera é a equipe interna, e um
   * projeto de exceção não deve esbarrar numa trava que não pode destravar.
   */
  function conferirPesoGlb(file: File): boolean {
    const tam = mb(file.size);
    if (tam <= GLB_ALERTA_MB) return true;
    const texto =
      `O modelo tem ${tam.toFixed(0)} MB.\n\n` +
      `A referência que roda bem é ~23 MB (Draco + WebP). Acima de ${GLB_ALERTA_MB} MB ` +
      `a vitrine demora a abrir, e no celular pode não abrir.\n\n` +
      `Otimize a exportação antes de subir?`;
    if (tam > GLB_LIMITE_MB) {
      return confirm(`${texto}\n\nSubir mesmo assim?`);
    }
    setSaveMsg(`Atenção: modelo de ${tam.toFixed(0)} MB — considere otimizar (referência: ~23 MB).`);
    return true;
  }

  async function upload(file: File): Promise<string | null> {
    if (!project) return null;
    setSaveMsg("Enviando arquivo...");
    try {
      const url = await uploadAsset(project.id, file);
      setSaveMsg("Enviado ✓ (salve para aplicar)");
      return url;
    } catch (e) {
      setSaveMsg(`Erro no upload: ${e instanceof Error ? e.message : ""}`);
      return null;
    }
  }

  /**
   * Muda o local do empreendimento LEVANDO AS CÂMERAS JUNTO.
   *
   * `config.camera` e as vistas de `sectionCameras` guardam lat/lng absolutos.
   * Mudar só a coordenada do prédio deixava todas elas apontando para o lugar
   * antigo: a cena abria a centenas de quilômetros do modelo, e cada vista
   * salva virava lixo silencioso. Deslocando pelo mesmo delta, o enquadramento
   * relativo se preserva — a vista que mostrava a fachada continua mostrando a
   * fachada, no endereço novo.
   *
   * Vistas que já estavam longe do prédio (mais de 5 km) não são movidas: são
   * as que já estavam quebradas, e arrastá-las só espalharia o erro.
   */
  function definirLocal(lat: number, lng: number) {
    const atualLat = c.lat ?? emp.lat;
    const atualLng = c.lng ?? emp.lng;
    const M_POR_GRAU = 111_320;
    const cosDe = (g: number) => Math.max(0.01, Math.cos((g * Math.PI) / 180));
    const perto = (v: { lat: number; lng: number }) =>
      Math.abs(v.lat - atualLat) < 0.05 && Math.abs(v.lng - atualLng) < 0.05;

    /**
     * Preserva o afastamento EM METROS, não em graus.
     *
     * Somar o mesmo delta de longitude muda a distância real: um grau de
     * longitude encolhe com o cosseno da latitude. Levando o piloto de Maragogi
     * (−8,9°) para São Paulo (−23,5°), uma câmera a 358 m do prédio chegava a
     * 339 m — 5% mais perto, e o enquadramento apertava sem ninguém pedir.
     * Convertendo para metros e de volta, a vista chega idêntica.
     */
    const mover = <T extends { lat: number; lng: number }>(v: T): T => {
      if (!perto(v)) return v;
      const norte = (v.lat - atualLat) * M_POR_GRAU;
      const leste = (v.lng - atualLng) * M_POR_GRAU * cosDe(atualLat);
      return {
        ...v,
        lat: lat + norte / M_POR_GRAU,
        lng: lng + leste / (M_POR_GRAU * cosDe(lat)),
      };
    };

    setConfig({
      lat,
      lng,
      camera: c.camera ? mover(c.camera) : undefined,
      sectionCameras: c.sectionCameras?.length ? c.sectionCameras.map(mover) : undefined,
    });
  }

  function applyLocation() {
    const parsed = parseLocationInput(locInput);
    if (!parsed) {
      setSaveMsg("Erro: não reconheci. Use “-8.93, -35.17” ou um link do Google Maps.");
      return;
    }
    definirLocal(parsed.lat, parsed.lng);
    setLocInput("");
    setSaveMsg(`Local aplicado: ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`);
    sceneRef.current?.frameBuilding();
  }

  function onEditPlace(_id: string, lat: number, lng: number) {
    if (placingTorreId) {
      // Converte o ponto clicado para as coordenadas do modelo: é assim que o
      // volume da torre é posicionado sem precisar adivinhar X/Y.
      const local = sceneRef.current?.modelLocalFromLatLng(_id, lat, lng);
      if (local) {
        const i = torres.findIndex((t) => t.id === placingTorreId);
        if (i >= 0) {
          const v = volumeDaTorre(torres[i], i, torres.length);
          const n = [...torres];
          n[i] = { ...n[i], volume: { ...v, x: local.x, y: local.y } };
          setConfig({ torres: n });
        }
      }
      setPlacingTorreId(null);
      return;
    }
    if (placingPoiId) {
      setPois(pois.map((p) => (p.id === placingPoiId ? { ...p, lat, lng } : p)));
      setPlacingPoiId(null);
    } else if (placingBuilding) {
      definirLocal(lat, lng);
      setPlacingBuilding(false);
    }
  }

  async function handleSave() {
    if (!project) return;
    // Identidade exata do instantâneo enviado. Qualquer edição cria um novo
    // objeto de projeto; assim detectamos mudanças ocorridas enquanto a rede
    // ainda estava salvando a versão anterior.
    const snapshot = project;
    // O slug é a URL pública: um endereço reservado tornaria o projeto
    // inalcançável, e um vazio geraria uma rota quebrada.
    const slug = project.slug.trim();
    if (!slug) {
      setSaveMsg("Erro: o endereço (slug) não pode ficar vazio.");
      return;
    }
    if (slugReservado(slug)) {
      setSaveMsg(`Erro: "${slug}" é um endereço reservado do sistema.`);
      return;
    }
    setSaving(true);
    try {
      await updateProject(project.id, {
        name: project.name,
        slug,
        published: project.published,
        data: project.data,
      });
      if (projetoRef.current === snapshot) {
        setSaveMsg("Salvo ✓");
        setSujo(false);
        // O que está no servidor agora é o que está na tela: o rascunho perdeu
        // a função e, mantido, ofereceria um estado velho.
        descartarRascunho();
      } else {
        // Uma versão válida foi salva, mas a tela já avançou. Não podemos
        // declarar o documento limpo nem apagar a única cópia da edição nova.
        setSaveMsg("Versão anterior salva — há alterações novas.");
      }
    } catch (e) {
      setSaveMsg(`Erro: ${e instanceof Error ? e.message : ""}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 4000);
    }
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#0a0a0a] text-white">
        <p className="text-white/60">{error}</p>
        <Link href="/admin" className="text-teal-400 hover:underline">← Voltar</Link>
      </div>
    );
  }
  if (!project || !building) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  const c = project.data.config;
  const emp = project.data.empreendimento;
  const b = c.branding ?? {};

  /**
   * Encaixe do modelo travado. Vive no projeto (e não em estado de tela) porque
   * a proteção tem de valer para quem abrir o editor depois — inclusive outra
   * pessoa, que não sabe que aquele heading levou uma tarde para acertar.
   */
  const travado = !!c.travado;

  /**
   * Checagens antes de publicar. Não bloqueiam nada — o editor não deve decidir
   * pelo usuário —, mas nenhum projeto vai ao ar sem que os buracos estejam
   * visíveis. Cada item aponta a aba onde se resolve.
   */
  const pendencias: { texto: string; aba: Tab }[] = (() => {
    if (!project) return [];
    const c2 = project.data.config;
    const e2 = project.data.empreendimento;
    const u2 = project.data.unidades ?? [];
    const out: { texto: string; aba: Tab }[] = [];
    if (!c2.modelUrl) out.push({ texto: "Sem modelo 3D (.glb)", aba: "modelo" });
    if (c2.lat == null && !e2.lat) out.push({ texto: "Sem localização definida", aba: "local" });
    if (!(c2.sectionCameras ?? []).some((v) => v.isMain)) {
      out.push({ texto: "Nenhuma vista marcada como principal", aba: "cameras" });
    }
    if (!e2.descricao?.trim()) out.push({ texto: "Sem descrição do empreendimento", aba: "dados" });
    // Uma vitrine sem contato encanta e não converte: o interessado acha a
    // unidade e não tem para onde ir.
    const ct = c2.contato ?? {};
    if (!ct.whatsapp?.trim() && !ct.telefone?.trim() && !ct.email?.trim()) {
      out.push({ texto: "Nenhum canal de contato", aba: "dados" });
    }
    if (!e2.thumbnailUrl) out.push({ texto: "Sem imagem de capa", aba: "dados" });
    if (slugReservado(project.slug)) {
      out.push({ texto: `Endereço "${project.slug}" é reservado`, aba: "dados" });
    }
    const g2 = e2.galeria ?? [];
    if (g2.length === 0) out.push({ texto: "Galeria vazia", aba: "galeria" });
    // Só cobra classificação se o projeto chegou a definir categorias: sem
    // elas a galeria é uma lista só, e "sem categoria" é o estado correto.
    if ((e2.categoriasGaleria ?? []).length > 0) {
      const semCat = g2.filter((g) => !g.categoria).length;
      if (semCat) out.push({ texto: `${semCat} imagem(ns) sem categoria`, aba: "galeria" });
    }
    const semPoster = (e2.videos ?? []).filter((v) => !v.poster).length;
    if (semPoster) out.push({ texto: `${semPoster} vídeo(s) sem pôster`, aba: "galeria" });
    if ((e2.pontosDeInteresse ?? []).length === 0) {
      out.push({ texto: "Nenhum ponto de interesse no entorno", aba: "pois" });
    }
    if (u2.length > 0) {
      const semPreco = u2.filter((u) => u.preco == null).length;
      if (semPreco) out.push({ texto: `${semPreco} unidade(s) sem preço`, aba: "unidades" });
      const semTip = u2.filter((u) => !u.tipologiaId).length;
      if (semTip) out.push({ texto: `${semTip} unidade(s) sem tipologia`, aba: "tipologias" });
    }
    // A pendência de axonométrica saiu junto com o campo: cobrar uma imagem
    // que não se pode mais enviar é um aviso sem saída.
    if ((e2.tipologias ?? []).some((t) => !t.plantaUrl)) {
      out.push({ texto: "Tipologia sem planta", aba: "tipologias" });
    }
    return out;
  })();

  const abaAtual = TABS.find((t) => t.id === tab);

  return (
    <div className="ed flex h-screen w-full flex-col overflow-hidden bg-[#0a0a0a] text-white">
      {/* ================= BARRA DE DOCUMENTO ================= */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--ed-line)] bg-[var(--ed-chrome)] px-2">
        <Link href="/admin" title="Voltar aos projetos"
          className="flex h-7 w-7 items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/5 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="h-4 w-px bg-white/10" />

        <input
          value={project.name}
          onChange={(e) => {
            const x = e.target.value;
            setProject((pp) => (pp ? { ...pp, name: x } : pp));
            setEmp({ name: x });
          }}
          className="min-w-0 max-w-[16rem] flex-1 rounded-[3px] bg-transparent px-1.5 py-1 text-sm font-medium text-white/90 outline-none transition-colors hover:bg-white/5 focus:bg-white/10"
        />
        <span className="hidden font-mono text-[10px] text-white/25 sm:inline">{projectPath(project)}</span>

        <div className="h-4 w-px bg-white/10" />
        <button onClick={desfazer} disabled={!passado.length} title="Desfazer (Ctrl+Z)"
          className="flex h-7 w-7 items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-20 disabled:hover:bg-transparent">
          <Undo2 className="h-4 w-4" />
        </button>
        <button onClick={refazer} disabled={!futuro.length} title="Refazer (Ctrl+Shift+Z)"
          className="flex h-7 w-7 items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-20 disabled:hover:bg-transparent">
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="h-4 w-px bg-white/10" />
        {/* Cadeado do encaixe. Fica no cabeçalho, e não só na aba Modelo,
            porque o acidente que ele evita acontece nas OUTRAS abas. */}
        <button
          onClick={() => setConfig({ travado: !travado })}
          title={travado
            ? "Encaixe travado — clique para destravar e voltar a posicionar"
            : "Travar o encaixe do modelo (esconde o pivô do empreendimento)"}
          className={`flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[11px] transition-colors ${
            travado
              ? "bg-amber-400/15 text-amber-300 hover:bg-amber-400/25"
              : "text-white/40 hover:bg-white/5 hover:text-white/80"
          }`}>
          {travado ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          <span className="hidden md:inline">{travado ? "Travado" : "Livre"}</span>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {pendencias.length > 0 && (
            <div className="group relative">
              <button className="flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-[11px] text-amber-300/90 hover:bg-amber-400/10">
                <AlertTriangle className="h-3.5 w-3.5" />
                {pendencias.length}
              </button>
              <div className="pointer-events-none absolute right-0 top-full z-50 mt-1 w-64 rounded-[4px] border border-white/10 bg-[#1a1c20] p-2 opacity-0 shadow-xl transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Antes de publicar
                </p>
                {pendencias.map((p2, i) => (
                  <button key={i} onClick={() => setTab(p2.aba)}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[11px] text-white/70 hover:bg-white/5 hover:text-white">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                    {p2.texto}
                  </button>
                ))}
              </div>
            </div>
          )}
          {saveMsg ? (
            <span className={`text-[11px] ${saveMsg.startsWith("Erro") ? "text-red-300" : "text-teal-300"}`}>
              {saveMsg}
            </span>
          ) : sujo ? (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-300" title="Há alterações não salvas">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              não salvo
            </span>
          ) : null}

          <button
            onClick={() => { setProject((pp) => (pp ? { ...pp, published: !pp.published } : pp)); setSujo(true); }}
            title={project.published ? "Publicado — clique para voltar a rascunho" : "Rascunho — clique para publicar"}
            className={`ed-pill flex items-center gap-1.5 px-2.5 py-1 text-[11px] ${
              project.published ? "text-white" : "!border-transparent text-[var(--ed-dim)]"
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            {project.published ? "Publicado" : "Rascunho"}
          </button>

          <a href={projectPath(project)} target="_blank" rel="noreferrer" title="Abrir a experiência pública"
            className="flex h-7 w-7 items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/5 hover:text-white">
            <Eye className="h-4 w-4" />
          </a>

          {/* A única pílula branca preenchida da tela — a spec reserva o fill
              para uma ação por superfície, e aqui ela é salvar. Sem alterações
              pendentes ela recua para o contorno. */}
          <button onClick={handleSave} disabled={saving} title="Salvar (Ctrl+S)"
            className={`flex items-center gap-1.5 px-3 py-1 text-[11px] transition-colors ${
              sujo ? "ed-pill-primary" : "ed-pill"
            }`}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar
          </button>
        </div>
      </header>

      {/* Trabalho não salvo encontrado da última sessão. */}
      {rascunho && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-100">
          <History className="h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1">
            Havia alterações não salvas de{" "}
            <b>{new Date(rascunho.quando).toLocaleString("pt-BR")}</b>. Restaurar?
          </span>
          <button onClick={restaurarRascunho}
            className="shrink-0 rounded-[3px] bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-[#0a0a0a] hover:bg-amber-300">
            Restaurar
          </button>
          <button onClick={descartarRascunho} title="Descartar o rascunho"
            className="shrink-0 rounded-[3px] p-1 text-amber-200/60 hover:bg-amber-400/15 hover:text-amber-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ================= RAIL DE SEÇÕES =================
            Ícones numa coluna, no lugar das pílulas que quebravam em três
            linhas — o padrão de VS Code, Figma e Unreal. */}
        <nav className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-r border-[var(--ed-line)] bg-[var(--ed-chrome)] py-2">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`group relative flex h-9 w-9 items-center justify-center rounded-[4px] transition-colors ${
                tab === t.id ? "bg-teal-500/12 text-teal-300" : "text-white/35 hover:bg-white/5 hover:text-white/80"
              }`}>
              {tab === t.id && <span className="absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-r bg-teal-400" />}
              {t.icon}
              <span className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-[4px] border border-white/10 bg-[#1a1c20] px-2 py-1 text-[11px] text-white/90 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                {t.label}
              </span>
            </button>
          ))}
        </nav>

        {/* ================= VIEWPORT =================
            Espaço próprio, não sobreposto pelos painéis: o Cesium se
            redimensiona sozinho ao container. */}
        <main className="relative min-w-0 flex-1 bg-[#0a0a0a]">
          {apiKey && (
            <Scene3D
          ref={sceneRef}
          apiKey={apiKey}
          buildings={buildings}
          solarUtc={utcDate}
          /* Sem isto o `daylight` da cena ficava travado no padrão (45°): a
             barra solar movia o sol e as sombras, mas a força da luz e a
             gradação noturna nunca reagiam — a luz do editor não era a luz
             que o visitante veria. */
          solarAltitude={sun.altitude}
          /* Preview do noturno: é o que dá resposta ao slider de realce. */
          noturno={previewNoturno}
          realceNoturno={ambiente?.realceNoturno}
          /* Preview do estúdio: é o único lugar onde o mini mapa aparece. */
          cidade={!previewEstudio}
          mapaBase={mapaBase}
          selectedId={emp.id}
          editMode
          onReady={() => { setReady(true); setCenaErro(null); }}
          onModelLoading={setModeloCarregando}
          onError={setCenaErro}
          onEditPlace={onEditPlace}
          /* Rede de segurança: sem pivô não há arraste, mas se algum caminho
             ainda emitir uma transformação, travado ela é descartada. */
          onEditTransform={(_id, patch) => { if (!travado) setConfig(patch); }}
          unitBoxes={unitBoxes}
          towerOutline={towerOutline}
          placementActive={placing}
          gizmoModo={gizmoModo}
          onGizmoInfo={setGizmoInfo}
          /* O pivô do empreendimento só existe onde ele se edita: fora dessas
             duas abas as alças ficavam no meio da cena roubando o clique. E
             some de vez quando o encaixe está travado — é o ponto do cadeado. */
          gizmoEmpreendimento={(tab === "modelo" || tab === "local") && !placing && !travado}
          gizmoLocal={gizmoLocal}
          onGizmoLocalTransform={onGizmoLocal}
          corteArea={corteArea}
          plantaPavimento={plantaPavimento}
          recorteTerreno={
            c.recorteTerreno ? { ...c.recorteTerreno, preview: previewRecorte } : null
          }
          previewRecorte={previewRecorte}
          vias={vias}
          corVia={entorno.corVia}
          viaEditandoId={viaAlturaId}
          onViaPerfil={(viaId, perfil) => {
            // Arraste contínuo: mantém o histórico agrupado pelo mecanismo do editor.
            patchVia(viaId, { perfil, cotas: undefined });
          }}
          unidadePlantaId={plantaUnidId}
          onUnidadePlanta={setPlantaUnidade}
          superficies={superficies}
          areaEditandoId={areaAlturaId}
          onAreaPontos={(areaId, pontos) => patchArea(areaId, { pontos })}
          onSelectUnit={(uid, mods) => {
            const u = unidades.find((x) => x.id === uid);
            if (!u) return;
            setTorreSelId(u.torre);
            selecionarUnidade(uid, mods);
          }}
            />
          )}

          {/* Aviso de posicionamento por clique, sobre o viewport. */}
          {placing && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[4px] bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-[#0a0a0a] shadow-lg">
              {placingPoiId ? (
                <><Crosshair className="h-3.5 w-3.5" /> CLIQUE NO MAPA PARA O PONTO</>
              ) : placingTorreId ? (
                <><Crosshair className="h-3.5 w-3.5" /> CLIQUE NO MAPA PARA A TORRE {torreLabel(placingTorreId, torres).toUpperCase()}</>
              ) : (
                <><Move className="h-3.5 w-3.5" /> CLIQUE NO MAPA PARA O EMPREENDIMENTO</>
              )}
            </div>
          )}

          {/* Leitura ao vivo do arraste — sem isto o valor só aparece no
              inspetor, longe de onde a mão está. */}
          {gizmoInfo && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-[4px] border border-white/10 bg-[#0a0a0a]/95 px-3 py-1.5 font-mono text-[12px] text-teal-300 shadow-xl">
              {gizmoInfo}
            </div>
          )}

          <SolarBar timeMinutes={timeMinutes} onTimeChange={setTimeMinutes} season={season}
            onSeasonChange={setSeason} sun={sun} />

          {/* Falha do 3D: um aviso SOBRE o viewport, dispensável. O inspetor
              continua utilizável e o trabalho não salvo continua ao alcance do
              Ctrl+S — que é o ponto de não usar a tela de erro da página. */}
          {cenaErro && (
            <div className="absolute inset-x-0 top-3 z-40 mx-auto flex w-[min(92%,520px)] items-start gap-2 rounded-[4px] border border-red-400/30 bg-[#1a1214]/95 px-3 py-2 shadow-xl">
              <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-red-300" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-red-200">Erro ao carregar o 3D</p>
                <p className="mt-0.5 break-words text-[10px] leading-relaxed text-white/50">{cenaErro}</p>
                <p className="mt-1 text-[10px] text-white/35">
                  O restante do editor segue funcionando — salve o que já fez (Ctrl+S)
                  antes de recarregar.
                </p>
              </div>
              <button onClick={() => setCenaErro(null)} title="Dispensar"
                className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-white/10 hover:text-white/80">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Modelo baixando: pastilha no canto, sem tapar a cena — o
              enquadramento e os POIs continuam ajustáveis enquanto ele vem. */}
          {ready && modeloCarregando && !cenaErro && (
            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-[4px] border border-white/10 bg-[#0a0a0a]/90 px-2.5 py-1.5 text-[11px] text-white/70 shadow-xl">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-300" />
              Carregando o modelo 3D...
            </div>
          )}

          {/* Sem o `!cenaErro`, o spinner ficava girando para sempre por cima da
              cena que nunca vai ficar pronta, escondendo o próprio aviso. */}
          {!ready && !cenaErro && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0a0a0a]/90">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
          )}
        </main>

        {/* Divisor arrastável entre o viewport e o inspetor. */}
        <div
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            e.currentTarget.dataset.arrastando = "1";
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.dataset.arrastando !== "1") return;
            // A largura é medida a partir da borda direita da janela.
            const nova = window.innerWidth - e.clientX;
            setLarguraPainel(Math.max(280, Math.min(640, nova)));
          }}
          onPointerUp={(e) => {
            delete e.currentTarget.dataset.arrastando;
            (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
          }}
          onDoubleClick={() => setLarguraPainel(360)}
          title="Arraste para redimensionar · duplo clique para restaurar"
          className="w-1 shrink-0 cursor-col-resize bg-[var(--ed-line)] transition-colors hover:bg-teal-400/60"
        />

        {/* ================= INSPETOR ================= */}
        <aside
          style={{ width: larguraPainel }}
          className="flex shrink-0 flex-col border-l border-[var(--ed-line)] bg-[var(--ed-bg)]">
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-[var(--ed-line)] px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
            {abaAtual?.icon}
            {abaAtual?.label}
          </div>
          <div className="ed-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
          {tab === "dados" && (
            <>
              <Section title="Identificação">
                <Text label="Nome" v={project.name} onChange={(x) => { setProject((p) => (p ? { ...p, name: x } : p)); setEmp({ name: x }); }} />
                <div className="grid grid-cols-2 gap-2">
                  <Text label="Tipo" v={emp.tipo ?? ""} onChange={(x) => setEmp({ tipo: x })} />
                  <Text label="Status" v={emp.status} onChange={(x) => setEmp({ status: x })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Text label="Bairro/Cidade" v={emp.neighborhood} onChange={(x) => setEmp({ neighborhood: x })} />
                  <Text label="Site" v={emp.website ?? ""} onChange={(x) => setEmp({ website: x })} />
                </div>
                <Text label="Endereço" v={emp.address} onChange={(x) => setEmp({ address: x })} />
              </Section>

              {/*
                O slug É a URL pública. Editá-lo aqui (e não só no /admin) evita
                a viagem de ida e volta que era necessária só para corrigir um
                endereço — mas quebra links já divulgados, daí o aviso.
              */}
              <Section title="Endereço público" aberta={false}>
                <Linha label="Slug">
                  <input
                    value={project.slug}
                    onChange={(e) => { setProject((p) => (p ? { ...p, slug: e.target.value } : p)); setSujo(true); setSaveMsg(null); }}
                    onBlur={(e) => {
                      const s = slugify(e.target.value);
                      if (s && s !== project.slug) setProject((p) => (p ? { ...p, slug: s } : p));
                    }}
                    className={`${CAMPO} font-mono`}
                  />
                </Linha>
                <p className="font-mono text-[10px] text-teal-300/70">{projectPath(project)}</p>
                {slugReservado(project.slug) && (
                  <p className="text-[10px] text-red-300">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    Endereço reservado do sistema — o projeto ficaria inalcançável.
                  </p>
                )}
                <p className="text-[10px] leading-relaxed text-white/35">
                  Trocar o slug muda o link público: quem já recebeu o endereço antigo
                  passa a cair numa página inexistente.
                  {project.incorporadora
                    ? ` A incorporadora (${project.incorporadora.nome}) se troca no painel /admin.`
                    : " Sem incorporadora o projeto vive em /v/… — atribua uma no painel /admin."}
                </p>
              </Section>

              <Section title="Apresentação">
                <Area label="Descrição" v={emp.descricao ?? ""} rows={4} onChange={(x) => setEmp({ descricao: x })} />
                {/* Capa: já aparecia no painel da vitrine, mas só dava para
                    definir editando o JSON do projeto à mão. */}
                <ImgUp label="Capa" url={emp.thumbnailUrl} inputRef={capaRef}
                  onPick={async (f) => { const u = await upload(f); if (u) setEmp({ thumbnailUrl: u }); }}
                  onClear={() => setEmp({ thumbnailUrl: undefined })} />
                <Text label="Tour virtual (URL)" v={emp.tourVirtualUrl ?? ""} onChange={(x) => setEmp({ tourVirtualUrl: x })} />
              </Section>

              <Section title="Ficha técnica" aberta={false}>
                <div className="grid grid-cols-2 gap-2">
                  <Text label="Torres" v={emp.torres} onChange={(x) => setEmp({ torres: x })} />
                  <Text label="Pavimentos" v={emp.pavimentos} onChange={(x) => setEmp({ pavimentos: x })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Text label="Unidades" v={String(emp.unidades ?? "")} onChange={(x) => setEmp({ unidades: Number(x) || undefined })} />
                  <Text label="Elevadores" v={emp.elevadores ?? ""} onChange={(x) => setEmp({ elevadores: x })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Text label="Terreno" v={emp.terreno} onChange={(x) => setEmp({ terreno: x })} />
                  <Text label="Pé-direito" v={emp.peDireito} onChange={(x) => setEmp({ peDireito: x })} />
                </div>
                <button
                  onClick={() => setEmp({ unidades: unidades.length })}
                  disabled={unidades.length === 0 || emp.unidades === unidades.length}
                  title="Copia a contagem do espelho de vendas para a ficha técnica"
                  className="w-full rounded-[3px] border border-white/[0.08] py-1 text-[10px] text-white/50 hover:border-white/20 hover:text-white/85 disabled:opacity-30 disabled:hover:border-white/[0.08]">
                  Usar a contagem do espelho ({unidades.length} unidades)
                </button>
              </Section>

              {/* Input único compartilhado pelos itens das duas listas. */}
              <input ref={itemFotoRef} type="file" accept="image/*" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  const aplicar = aplicarFotoRef.current;
                  aplicarFotoRef.current = null;
                  if (!f || !aplicar) return;
                  const url = await upload(f);
                  if (url) aplicar(url);
                }} />

              <Section title="Destaques">
                <ListaRica
                  itens={destaques}
                  onItens={(n) => setEmp({ highlights: n })}
                  onEnviarFoto={pedirFotoItem}
                  vazio="Nenhum destaque. Adicione o que diferencia o empreendimento."
                  exemplo="Ex: Frente-mar"
                />
              </Section>

              <Section title="Lazer e áreas comuns">
                <ListaRica
                  itens={lazer}
                  onItens={(n) => setEmp({ amenities: n })}
                  onEnviarFoto={pedirFotoItem}
                  vazio="Nenhum item de lazer ainda."
                  exemplo="Ex: Piscina com borda infinita"
                />
              </Section>

              {/* Contato: é o que fecha o funil da vitrine. Sem nenhum campo
                  preenchido, a seção simplesmente não aparece no pop-up da
                  unidade — melhor ausente do que um botão que não leva a nada. */}
              <Section title="Contato" aberta={false}>
                <p className="text-[10px] leading-relaxed text-white/35">
                  Vira o botão “Falar sobre esta unidade” no pop-up. Preencha só
                  os canais que a corretora atende.
                </p>
                <Text label="WhatsApp" v={contato.whatsapp ?? ""}
                  onChange={(x) => setContato({ whatsapp: x })} />
                <p className="text-[10px] leading-relaxed text-white/25">
                  Com DDI e DDD, só números — ex: <b>5582999998888</b>.
                  {contato.whatsapp && contato.whatsapp.replace(/\D/g, "").length < 12 && (
                    <span className="ml-1 text-amber-300">
                      Parece curto para um número com DDI.
                    </span>
                  )}
                </p>
                <Text label="Telefone" v={contato.telefone ?? ""}
                  onChange={(x) => setContato({ telefone: x })} />
                <Text label="E-mail" v={contato.email ?? ""}
                  onChange={(x) => setContato({ email: x })} />
                <Area label="Mensagem" rows={3}
                  v={contato.mensagem ?? ""}
                  onChange={(x) => setContato({ mensagem: x })} />
                <p className="text-[10px] leading-relaxed text-white/25">
                  Já vai escrita na conversa. <b>{"{unidade}"}</b> e{" "}
                  <b>{"{empreendimento}"}</b> são trocados pelos valores reais.
                  Vazio usa: “{CONTATO_MENSAGEM_PADRAO}”.
                </p>
              </Section>

              {/* Créditos do projeto: estavam no modelo de dados e no piloto,
                  mas não havia onde preenchê-los nem onde eles apareciam. */}
              <Section title="Autores do projeto" aberta={false}>
                <Text label="Arquitetura" v={emp.arquitetura ?? ""} onChange={(x) => setEmp({ arquitetura: x })} />
                <Text label="Paisagismo" v={emp.paisagismo ?? ""} onChange={(x) => setEmp({ paisagismo: x })} />
                <Text label="Interiores" v={emp.interiores ?? ""} onChange={(x) => setEmp({ interiores: x })} />
              </Section>
            </>
          )}

          {tab === "local" && (
            <Section title="Posição no mundo">
              {/* A coordenada base move o empreendimento tanto quanto os offsets:
                  deixá-la editável com o encaixe travado tornaria o cadeado uma
                  promessa pela metade. */}
              {travado ? (
                <button
                  onClick={() => setConfig({ travado: false })}
                  className="flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-amber-400/40 bg-amber-400/15 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-400/25">
                  <Lock className="h-3.5 w-3.5" /> Encaixe travado — destravar para mover
                </button>
              ) : (
                <>
                  <p className="rounded bg-white/5 px-2 py-1.5 text-[10px] text-white/50">
                    Cole coordenadas (“-8.93, -35.17”) ou um <b>link do Google Maps</b>, ou clique no mapa.
                  </p>
                  <div className="flex gap-1.5">
                    <input value={locInput} onChange={(e) => setLocInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applyLocation()}
                      placeholder="coords ou link do Maps"
                      className="min-w-0 flex-1 rounded-md bg-white/10 px-2 py-1 text-xs outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
                    <button onClick={applyLocation} className="rounded-md bg-teal-500 px-2.5 py-1 text-xs font-semibold text-[#0a0a0a] hover:bg-teal-400">
                      Aplicar
                    </button>
                  </div>
                  <button onClick={() => setPlacingBuilding(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-400/20 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-400/30">
                    <Move className="h-3.5 w-3.5" /> Posicionar clicando no mapa
                  </button>
                </>
              )}
              <div className="grid grid-cols-2 gap-2">
                <NumIn label="Latitude" v={c.lat ?? emp.lat} step={0.00001} disabled={travado} onChange={(x) => definirLocal(x, c.lng ?? emp.lng)} />
                <NumIn label="Longitude" v={c.lng ?? emp.lng} step={0.00001} disabled={travado} onChange={(x) => definirLocal(c.lat ?? emp.lat, x)} />
              </div>
              <NumIn label="Fuso horário (UTC)" v={c.tzOffset ?? -3} step={1} onChange={(x) => setConfig({ tzOffset: x })} />
            </Section>
          )}

          {tab === "local" && (
            <Section title="Recorte do terreno">
              <p className="text-[10px] leading-relaxed text-white/35">
                Abre um buraco na fotogrametria sob o empreendimento, para o
                modelo encaixar sem disputar espaço com o que o Google capturou
                ali na data do voo.
              </p>

              <label className="flex items-center gap-1.5 text-[11px] text-white/60">
                <input type="checkbox" checked={!!c.recorteTerreno}
                  onChange={(e) => setConfig({ recorteTerreno: e.target.checked ? { folga: 1.1 } : undefined })}
                  className="accent-teal-400" />
                Recortar na vitrine publicada
              </label>

              {c.recorteTerreno && (
                <>
                  {/* Em PORCENTAGEM, não em multiplicador: "110%" se lê de
                      imediato, "1,1×" pede uma conta. E a faixa desce abaixo de
                      100% porque a caixa do GLB costuma ser MAIOR que a
                      construção — marquise, beiral e platibanda inflam os
                      extremos, e o recorte acaba comendo calçada. */}
                  <Slider label="Tamanho do recorte"
                    v={Math.round((c.recorteTerreno.folga ?? 1.1) * 100)}
                    min={50} max={200} step={1} suffix="%"
                    onChange={(v) => setConfig({ recorteTerreno: { folga: v / 100 } })} />
                  <p className="text-[10px] leading-relaxed text-white/25">
                    <b>100%</b> é a caixa do modelo exata. Abaixo disso o buraco
                    encolhe para dentro dela; acima, sobra terreno recortado em
                    volta.
                  </p>

                  {/* A pré-visualização é temporária e não é gravada: ela existe
                      para conferir, não para trabalhar com o buraco aberto. */}
                  <button
                    onClick={() => setPreviewRecorte((v) => !v)}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-[3px] border py-1.5 text-[11px] font-semibold transition-colors ${
                      previewRecorte
                        ? "border-amber-400/50 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25"
                        : "border-white/[0.08] text-white/55 hover:border-white/25 hover:text-white/85"
                    }`}>
                    <Eye className="h-3.5 w-3.5" />
                    {previewRecorte ? "Ocultar o recorte" : "Pré-visualizar o recorte"}
                  </button>

                  {previewRecorte ? (
                    <p className="rounded-[3px] bg-amber-400/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200/80">
                      Com o buraco aberto, <b>posicionar por clique não funciona</b>
                      {" "}e a altura do terreno não pode ser medida — não há
                      superfície ali. Desligue para voltar a calibrar.
                    </p>
                  ) : (
                    <p className="text-[10px] leading-relaxed text-white/25">
                      O recorte fica desligado enquanto você edita, de propósito:
                      ele apaga a superfície que o clique e a medição de altura
                      usam como referência. Na vitrine publicada vale sempre.
                    </p>
                  )}

                  <p className="text-[10px] leading-relaxed text-white/25">
                    A pegada é <b>medida no GLB</b> a cada carga, então acompanha
                    troca de modelo e de encaixe sozinha. É a <b>caixa</b> do
                    modelo, não a silhueta: a forma real do prédio não existe nos
                    metadados do arquivo.
                    {!c.modelUrl && (
                      <span className="text-amber-300"> Sem modelo 3D não há o que medir — o recorte não acontece.</span>
                    )}
                  </p>
                </>
              )}
            </Section>
          )}

          {/* ===== Vias =====
              Traçadas no MAPA, drapejadas na fotogrametria. Sem cota calculada:
              o Cesium projeta sobre a superfície que existir. */}
          {tab === "local" && (
            <Section title={`Vias (${vias.length})`} aberta={false}>
              <p className="text-[10px] leading-relaxed text-white/35">
                Desenhe o eixo da rua no mapa; ela é projetada sobre a
                fotogrametria, acompanhando o relevo.
              </p>

              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    const id = genId("via");
                    setVias((atual) => [...atual, { id, pontos: [], largura: LARGURA_VIA_PADRAO }]);
                    setAbertoEntorno({ tipo: "via", id });
                    setTracandoArea(null);
                    setViaAlturaId(null);
                    setAreaAlturaId(null);
                    setTracandoVia(id);
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-[3px] bg-teal-500 px-3 py-1.5 text-[11px] font-semibold text-[#0a0a0a] hover:bg-teal-400">
                  <Plus className="h-3.5 w-3.5" />
                  Nova via
                </button>
                {vias.some((v) => !!v.perfil?.length || v.cotas?.length === v.pontos.length) && (
                  <button
                    onClick={() => setPreviewRecorte((v) => !v)}
                    title={previewRecorte ? "Ocultar o recorte" : "Ver o recorte no 3D"}
                    className={`flex shrink-0 items-center gap-1.5 rounded-[3px] border px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                      previewRecorte
                        ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
                        : "border-white/[0.08] text-white/55 hover:border-white/25"
                    }`}>
                    <Eye className="h-3.5 w-3.5" />
                    {previewRecorte ? "Recorte visível" : "Ver recorte"}
                  </button>
                )}
              </div>

              {!vias.length && (
                <p className="rounded-[3px] border border-dashed border-white/10 px-2 py-3 text-center text-[10px] text-white/30">
                  Nenhuma via ainda.
                </p>
              )}

              {vias.map((via) => {
                const aberto = abertoEntorno?.tipo === "via" && abertoEntorno.id === via.id;
                const temCorte = !!via.perfil?.length || via.cotas?.length === via.pontos.length;
                const tracando = tracandoVia === via.id;
                const ajustando = viaAlturaId === via.id;
                return (
                <div key={via.id}
                  className={`overflow-hidden rounded-[3px] border bg-black/20 transition-colors ${
                    tracando || ajustando
                      ? "border-amber-400/60 ring-1 ring-amber-400/25"
                      : aberto ? "border-white/20" : "border-white/[0.08]"
                  }`}>
                  <LinhaEntorno
                    cor={via.cor ?? entorno.corVia ?? COR_VIA_PADRAO}
                    nome={via.nome}
                    vazio="Via sem nome"
                    aberto={aberto}
                    ativo={tracando || ajustando}
                    onClick={() => abrirEntorno("via", via.id)}
                    selos={
                      <>
                        {tracando && <SeloEntorno tom="ativo">traçando</SeloEntorno>}
                        {ajustando && <SeloEntorno tom="ativo">ajustando</SeloEntorno>}
                        {!tracando && !ajustando && (
                          via.pontos.length < 2
                            ? <SeloEntorno tom="pendente">sem traçado</SeloEntorno>
                            : temCorte
                              ? <SeloEntorno tom="pronto">recortando</SeloEntorno>
                              : <SeloEntorno tom="neutro">drapejada</SeloEntorno>
                        )}
                      </>
                    }
                  />

                  {aberto && (
                  <div className="border-t border-white/[0.06] p-1.5">
                  <div className="flex items-center gap-1.5">
                    <input value={via.nome ?? ""} placeholder="Nome da via"
                      onChange={(e) => patchVia(via.id, { nome: e.target.value })}
                      className={CAMPO} />
                    <button onClick={() => {
                        setAreaAlturaId(null);
                        setTracandoArea(null);
                        setViaAlturaId(null);
                        setTracandoVia(tracando ? null : via.id);
                      }}
                      title="Editar o traçado desta via"
                      className={`shrink-0 rounded-[3px] p-1 ${
                        tracandoVia === via.id ? "bg-amber-400 text-[#0a0a0a]" : "text-white/40 hover:bg-white/10 hover:text-white"
                      }`}>
                      <Crosshair className="h-3 w-3" />
                    </button>
                    <button onClick={() => {
                      setVias((atual) => atual.filter((x) => x.id !== via.id));
                      if (tracandoVia === via.id) setTracandoVia(null);
                      if (viaAlturaId === via.id) setViaAlturaId(null);
                    }}
                      className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* O mapa aparece DENTRO do item que está sendo traçado. Antes
                      ficava solto no topo da seção, sempre visível, e nada
                      dizia de qual via eram aqueles pontos. */}
                  {tracando && (apiKey ? (
                    <div className="mt-1.5">
                      <p className="mb-1 rounded-[3px] bg-amber-400/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200/80">
                        Clique no mapa marcando o eixo da rua. Arraste um ponto
                        para ajustar, <b>botão direito</b> nele remove.
                      </p>
                      <MapaEntorno
                        centro={{ lat: c.lat ?? emp.lat, lng: c.lng ?? emp.lng }}
                        nomeCentro={project.name}
                        pois={[]}
                        cor="#ffffff"
                        tracado={via.pontos}
                        editandoTracado
                        onTracado={(pts) => patchTracadoVia(via.id, pts)}
                        className="h-56 overflow-hidden rounded-[4px]"
                      />
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-amber-300">
                      Chave do Google Maps não configurada.
                    </p>
                  ))}

                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <NumIn label="Largura (m)" v={via.largura} step={0.5} casas={2}
                      onChange={(v) => patchVia(via.id, { largura: Math.max(0.5, v) })} />
                    <ColorIn label="Cor" v={via.cor ?? COR_VIA_PADRAO}
                      onChange={(x) => patchVia(via.id, { cor: x })} />
                  </div>
                  {/* Folga do corte: separa a fronteira do buraco da fronteira
                      do asfalto. Coladas, a beirada serrilha. */}
                  <div className="mt-1.5">
                    <NumIn label="Folga do corte (m)" v={via.folgaCorte ?? 0}
                      step={0.1} casas={2}
                      onChange={(v) => patchVia(via.id, {
                        folgaCorte: Math.max(-5, Math.min(5, v)),
                      })} />
                    <p className="mt-1 text-[9px] text-white/25">
                      Negativo encolhe o buraco e o asfalto cobre a beirada do
                      terreno — é o que tira o serrilhado. Comece em −0,30.
                      Positivo afasta o terreno e mostra a parede da via.
                    </p>
                  </div>
                  <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-white/60">
                    <input type="checkbox" checked={via.faixas !== false}
                      onChange={(e) => patchVia(via.id, { faixas: e.target.checked })} />
                    Pintura na pista (bordas brancas + eixo amarelo)
                  </label>
                  <p className="mt-1 text-[9px] text-white/25">
                    {via.pontos.length} ponto(s) · {comprimentoDaVia(via.pontos).toFixed(0)} m
                    {via.pontos.length < 2 && " — faltam pontos"}
                  </p>

                  {/* ===== Cotas =====
                      É o que separa "pintar por cima" de "recortar e assentar".
                      A medição roda uma vez e o resultado fica no projeto. */}
                  {via.pontos.length >= 2 && (
                    <div className="mt-1.5 space-y-1">
                      <button
                        onClick={async () => {
                          if (previewRecorte) {
                            setPreviewRecorte(false);
                            setSaveMsg("Recorte ocultado. Aguarde o terreno reaparecer e clique novamente para criar os pivôs.");
                            return;
                          }
                          setSaveMsg(`Medindo o terreno de ${via.nome || "via"}...`);
                          const amostras = densificarVia(via.pontos);
                          const cotas = await sceneRef.current?.medirCotas(amostras);
                          if (!cotas) {
                            setSaveMsg("Erro: não consegui medir o terreno. Aproxime a câmera da via, espere os tiles carregarem e tente de novo.");
                            return;
                          }
                          patchVia(via.id, {
                            cotas: undefined,
                            perfil: amostras.map((p, i) => ({
                              ...p,
                              alturaEsq: cotas[i],
                              alturaDir: cotas[i],
                            })),
                          });
                          setViaAlturaId(via.id);
                          setPreviewRecorte(true);
                          const min = Math.min(...cotas);
                          const max = Math.max(...cotas);
                          setSaveMsg(`Cotas medidas: ${min.toFixed(1)} a ${max.toFixed(1)} m (salve para aplicar)`);
                        }}
                        className="w-full rounded-[3px] bg-teal-500 py-1 text-[10px] font-semibold text-[#0a0a0a] hover:bg-teal-400">
                        {(via.perfil?.length || via.cotas?.length === via.pontos.length)
                          ? "Recriar subcortes no terreno"
                          : "Criar subcortes e pivôs"}
                      </button>
                      {(via.perfil?.length || via.cotas?.length === via.pontos.length) ? (
                        <div className="space-y-1">
                          <button
                            onClick={() => {
                              const ativar = viaAlturaId !== via.id;
                              if (ativar && !via.perfil?.length) {
                                const perfil = densificarViaComCotas(via.pontos, via.cotas ?? []);
                                if (!perfil.length) {
                                  setSaveMsg("Não foi possível preparar os pivôs desta via. Recrie os subcortes no terreno.");
                                  return;
                                }
                                patchVia(via.id, { perfil, cotas: undefined });
                                setSaveMsg(`${perfil.length * 2} pivôs preparados. Ajuste as alturas e salve o projeto.`);
                              }
                              // Um modo por vez: entrar aqui encerra traçado e
                              // qualquer ajuste de área.
                              setTracandoVia(null);
                              setTracandoArea(null);
                              setAreaAlturaId(null);
                              setViaAlturaId(ativar ? via.id : null);
                              if (ativar) setPreviewRecorte(true);
                            }}
                            className={`w-full rounded-[3px] border py-1 text-[10px] font-semibold ${
                              viaAlturaId === via.id
                                ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                                : "border-white/10 text-white/60 hover:border-white/25"
                            }`}>
                            {viaAlturaId === via.id ? "Concluir ajuste de alturas" : "Ajustar alturas no 3D"}
                          </button>
                          <div className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 text-[9px] text-teal-300">
                              {via.perfil?.length ?? via.pontos.length} seções · 2 pivôs por seção
                            </span>
                            <button onClick={() => {
                              patchVia(via.id, { cotas: undefined, perfil: undefined });
                              if (viaAlturaId === via.id) setViaAlturaId(null);
                            }}
                              title="Voltar a apenas pintar sobre a fotogrametria"
                              className="shrink-0 rounded-[3px] border border-[var(--ed-line)] px-1.5 py-0.5 text-[9px] text-white/45 hover:border-white/25 hover:text-white/85">
                              só pintar
                            </button>
                          </div>
                          <p className="text-[9px] leading-relaxed text-white/30">
                            Arraste o pivô <b className="text-orange-300">laranja</b> (esquerda)
                            ou <b className="text-cyan-300">azul</b> (direita) para cima e para baixo.
                            Depois da criação, nenhuma altura é recalculada automaticamente.
                          </p>
                        </div>
                      ) : (
                        <p className="text-[9px] leading-relaxed text-white/25">
                          Hoje ela é pintada sobre a fotogrametria. Medindo o
                          terreno, vira asfalto próprio e o chão é recortado
                          embaixo. Aproxime a câmera da via antes de medir — a
                          amostragem precisa dos tiles carregados.
                        </p>
                      )}
                    </div>
                  )}
                  </div>
                  )}
                </div>
                );
              })}
            </Section>
          )}

          {/* ===== Superfícies do entorno =====
              Seção PRÓPRIA, irmã de "Vias" e não subseção dela. São dois
              recursos do mesmo porte, e enfiar um dentro de uma seção com o
              nome do outro — ainda por cima recolhida — é o mesmo que não
              entregar: não se acha o que não tem nome na lista.

              Mesma máquina das vias (contorno no mapa, cota medida uma vez,
              pivô manual, recorte da fotogrametria), com contorno fechado
              livre em vez de fita de largura constante. */}
          {tab === "local" && (
            <Section title={`Superfícies (${superficies.length})`} aberta={false}>
              <div>
                <p className="mb-2 text-[9px] leading-relaxed text-white/30">
                  Gramado, pátio, espelho d'água. Substituem o borrão da
                  fotogrametria em volta do prédio por piso limpo e texturado.
                </p>

                <button
                  onClick={() => {
                    const id = genId("area");
                    setSuperficies((atual) => [...atual, { id, tipo: "grama", pontos: [] }]);
                    setAbertoEntorno({ tipo: "area", id });
                    setTracandoVia(null);
                    setViaAlturaId(null);
                    setAreaAlturaId(null);
                    setTracandoArea(id);
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-teal-500 px-3 py-1.5 text-[11px] font-semibold text-[#0a0a0a] hover:bg-teal-400">
                  <Plus className="h-3.5 w-3.5" />
                  Nova superfície
                </button>

                {!superficies.length && (
                  <p className="mt-1.5 rounded-[3px] border border-dashed border-white/10 px-2 py-3 text-center text-[10px] text-white/30">
                    Nenhuma superfície ainda.
                  </p>
                )}

                {superficies.map((area) => {
                  const aberto = abertoEntorno?.tipo === "area" && abertoEntorno.id === area.id;
                  const temCota = area.pontos.length >= 3
                    && area.pontos.every((p) => Number.isFinite(p.altura));
                  const tracando = tracandoArea === area.id;
                  const ajustando = areaAlturaId === area.id;
                  return (
                  <div key={area.id}
                    className={`mt-1.5 overflow-hidden rounded-[4px] border transition-colors ${
                      tracando || ajustando
                        ? "border-amber-400/60 ring-1 ring-amber-400/25"
                        : aberto ? "border-white/20" : "border-white/[0.08]"
                    }`}>
                    <LinhaEntorno
                      cor={area.cor ?? area.tinta ?? COR_SUPERFICIE[area.tipo] ?? "#4e7c42"}
                      nome={area.nome}
                      vazio={`Superfície de ${TIPOS_SUPERFICIE.find((t) => t.id === area.tipo)?.nome.toLowerCase() ?? "piso"}`}
                      aberto={aberto}
                      ativo={tracando || ajustando}
                      onClick={() => abrirEntorno("area", area.id)}
                      selos={
                        <>
                          {tracando && <SeloEntorno tom="ativo">contornando</SeloEntorno>}
                          {ajustando && <SeloEntorno tom="ativo">ajustando</SeloEntorno>}
                          {!tracando && !ajustando && (
                            area.pontos.length < 3
                              ? <SeloEntorno tom="pendente">sem contorno</SeloEntorno>
                              : temCota
                                ? <SeloEntorno tom="pronto">recortando</SeloEntorno>
                                : <SeloEntorno tom="neutro">drapejada</SeloEntorno>
                          )}
                        </>
                      }
                    />

                    {aberto && (
                    <div className="border-t border-white/[0.06] p-1.5">
                    <div className="flex items-center gap-1.5">
                      <input value={area.nome ?? ""} placeholder="Sem nome"
                        onChange={(e) => patchArea(area.id, { nome: e.target.value })}
                        className={`${CAMPO} min-w-0 flex-1`} />
                      <button onClick={() => {
                          setTracandoVia(null);
                          setViaAlturaId(null);
                          setAreaAlturaId(null);
                          setTracandoArea(tracando ? null : area.id);
                        }}
                        title="Desenhar o contorno no mapa"
                        className={`shrink-0 rounded-[3px] p-1 ${
                          tracando ? "bg-amber-400 text-[#0a0a0a]" : "text-white/40 hover:bg-white/10 hover:text-white"
                        }`}>
                        <Crosshair className="h-3 w-3" />
                      </button>
                      <button onClick={() => {
                        setSuperficies((atual) => atual.filter((x) => x.id !== area.id));
                        if (tracandoArea === area.id) setTracandoArea(null);
                        if (areaAlturaId === area.id) setAreaAlturaId(null);
                      }}
                        className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Mapa dentro do item, como nas vias. */}
                    {tracando && (
                      <div className="mt-1.5">
                        <p className="mb-1 rounded-[3px] bg-amber-400/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200/80">
                          Clique no mapa marcando os cantos. O contorno fecha
                          sozinho do último ponto ao primeiro — não repita o
                          inicial. <b>Botão direito</b> num ponto remove.
                        </p>
                        <MapaEntorno
                          centro={{ lat: c.lat ?? emp.lat, lng: c.lng ?? emp.lng }}
                          pois={[]}
                          cor="#ffffff"
                          fechado
                          tracado={area.pontos}
                          editandoTracado
                          onTracado={(pts) => patchArea(area.id, {
                            // Mexer no contorno invalida as cotas: o ponto novo
                            // não tem altura, e altura velha em posição nova
                            // mente.
                            pontos: pts.map((p) => ({ lat: p.lat, lng: p.lng })),
                          })}
                          className="h-56 w-full overflow-hidden rounded-[4px]"
                        />
                      </div>
                    )}

                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {TIPOS_SUPERFICIE.map((t) => (
                        <button key={t.id}
                          onClick={() => patchArea(area.id, { tipo: t.id, cor: undefined })}
                          className={`flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[9px] ${
                            area.tipo === t.id && !area.cor
                              ? "border-teal-400/60 bg-teal-400/15 text-teal-200"
                              : "border-white/10 text-white/50 hover:border-white/25"
                          }`}>
                          <span className="h-2.5 w-2.5 rounded-[2px]"
                            style={{ background: COR_SUPERFICIE[t.id] }} />
                          {t.nome}
                        </button>
                      ))}
                    </div>

                    {/* Textura própria. O tipo acima já dá uma procedural
                        pronta; isto é para quando o projeto tem a textura certa
                        e o genérico não serve. */}
                    <div className="mt-1.5 space-y-1 rounded-[3px] border border-white/[0.06] p-1.5">
                      <div className="flex items-center gap-1.5">
                        <label className="relative flex h-[26px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-[3px] border border-white/10 text-[9px] text-white/55 hover:border-teal-400/50">
                          {area.texturaUrl ? "Trocar imagem" : "Importar PNG/JPG"}
                          <input type="file" accept="image/*"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (!f) return;
                              const u = await upload(f);
                              if (u) patchArea(area.id, { texturaUrl: u, cor: undefined });
                            }}
                            className="absolute inset-0 cursor-pointer opacity-0" />
                        </label>
                        {area.texturaUrl && (
                          <>
                            <span className="h-[26px] w-[26px] shrink-0 rounded-[3px] border border-white/15 bg-cover"
                              style={{ backgroundImage: `url(${area.texturaUrl})` }} />
                            <button onClick={() => patchArea(area.id, { texturaUrl: undefined })}
                              title="Voltar à textura do tipo"
                              className="shrink-0 rounded-[3px] border border-[var(--ed-line)] px-1.5 py-0.5 text-[9px] text-white/45 hover:border-white/25 hover:text-white/85">
                              limpar
                            </button>
                          </>
                        )}
                      </div>
                      <NumIn label="Ladrilho (m)"
                        v={area.escalaTextura ?? METROS_POR_LADRILHO[area.tipo] ?? 5}
                        step={0.5} casas={2}
                        onChange={(x) => patchArea(area.id, {
                          escalaTextura: Math.max(0.2, Math.min(200, x)),
                        })} />
                      <ColorIn label="Tonalizar" v={area.tinta ?? "#ffffff"}
                        onChange={(x) => patchArea(area.id, { tinta: x })} />
                      <p className="text-[9px] leading-relaxed text-white/30">
                        Ladrilho é quanto a imagem cobre no mundo, em metros —
                        assim a mesma textura tem o mesmo tamanho numa área de
                        20 m e numa de 200 m. O tonalizador multiplica sobre a
                        imagem: branco não altera nada, e o grão é preservado.
                      </p>
                    </div>

                    <p className="mt-1 text-[9px] text-white/25">
                      {area.pontos.length} vértice(s)
                      {area.pontos.length < 3 && " — mínimo 3"}
                    </p>

                    {area.pontos.length >= 3 && (
                      <div className="mt-1.5 space-y-1">
                        <button
                          onClick={async () => {
                            if (previewRecorte) {
                              setPreviewRecorte(false);
                              setSaveMsg("Recorte ocultado. Espere o terreno reaparecer e clique de novo para medir.");
                              return;
                            }
                            setSaveMsg(`Medindo o terreno de ${area.nome || "superfície"}...`);
                            const cotas = await sceneRef.current?.medirCotas(area.pontos);
                            if (!cotas) {
                              setSaveMsg("Erro: não consegui medir o terreno. Aproxime a câmera da área, espere os tiles e tente de novo.");
                              return;
                            }
                            patchArea(area.id, {
                              pontos: area.pontos.map((p, i) => ({ ...p, altura: cotas[i] })),
                            });
                            setAreaAlturaId(area.id);
                            setPreviewRecorte(true);
                            setSaveMsg(`Cotas medidas: ${Math.min(...cotas).toFixed(1)} a ${Math.max(...cotas).toFixed(1)} m (salve para aplicar)`);
                          }}
                          className="w-full rounded-[3px] bg-teal-500 py-1 text-[10px] font-semibold text-[#0a0a0a] hover:bg-teal-400">
                          {area.pontos.every((p) => Number.isFinite(p.altura))
                            ? "Remedir o terreno"
                            : "Medir terreno e criar pivôs"}
                        </button>

                        {area.pontos.every((p) => Number.isFinite(p.altura)) && (
                          <>
                            <button
                              onClick={() => {
                                const ativar = areaAlturaId !== area.id;
                                setTracandoVia(null);
                                setTracandoArea(null);
                                setViaAlturaId(null);
                                setAreaAlturaId(ativar ? area.id : null);
                                if (ativar) setPreviewRecorte(true);
                              }}
                              className={`w-full rounded-[3px] border py-1 text-[10px] font-semibold ${
                                areaAlturaId === area.id
                                  ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                                  : "border-white/10 text-white/60 hover:border-white/25"
                              }`}>
                              {areaAlturaId === area.id ? "Concluir ajuste" : "Ajustar no 3D"}
                            </button>
                            <NumIn label="Folga do corte (m)" v={area.folgaCorte ?? 0}
                              step={0.1} casas={2}
                              onChange={(x) => patchArea(area.id, {
                                folgaCorte: Math.max(-5, Math.min(5, x)),
                              })} />
                            <p className="text-[9px] leading-relaxed text-white/30">
                              Arraste o pivô <b className="text-lime-300">verde</b> para
                              cima e para baixo. <b>Shift</b> arrasta no plano do chão.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </Section>
          )}

          {tab === "modelo" && (
            <Section title="Encaixe do modelo">
              {/* Estado da trava, no lugar onde se posiciona — o cabeçalho fica
                  longe do olhar de quem está calibrando. */}
              <button
                onClick={() => setConfig({ travado: !travado })}
                className={`flex w-full items-center justify-center gap-1.5 rounded-[3px] border py-1.5 text-[11px] font-semibold transition-colors ${
                  travado
                    ? "border-amber-400/40 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25"
                    : "border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/85"
                }`}>
                {travado ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                {travado ? "Encaixe travado — destravar" : "Travar encaixe"}
              </button>

              {travado ? (
                <p className="text-[10px] leading-relaxed text-white/35">
                  O pivô do empreendimento saiu da cena e os controles abaixo estão
                  inertes. Nada some do modelo — só o gesto que o move. Destrave
                  quando precisar reposicionar.
                </p>
              ) : (
                <>
                  <div className="flex gap-1">
                    {([
                      ["mover", "Mover", "W", <Move key="m" className="h-3.5 w-3.5" />],
                      ["girar", "Girar", "E", <RotateCw key="g" className="h-3.5 w-3.5" />],
                      ["escalar", "Escalar", "R", <Maximize key="e" className="h-3.5 w-3.5" />],
                    ] as const).map(([m, label, tecla, icone]) => (
                      <button key={m} onClick={() => setGizmoModo(m as GizmoModo)}
                        title={`${label} (${tecla})`}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-[3px] border py-1.5 text-[11px] transition-colors ${
                          gizmoModo === m
                            ? "border-teal-400/50 bg-teal-500/15 font-semibold text-teal-300"
                            : "border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/85"
                        }`}>
                        {icone}{label}
                        <span className="text-[9px] text-white/30">{tecla}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] leading-relaxed text-white/35">
                    Arraste a alça no modelo. <b>Ctrl</b> encaixa em passos redondos
                    (1 m, 15°, 0,05) e <b>Shift</b> dá ajuste fino.
                  </p>
                  <p className="text-[10px] leading-relaxed text-white/25">
                    <b>Alt + botão do meio</b> reposiciona o pivô no ponto clicado —
                    girar e escalar passam a acontecer em torno dele, e não do centro.
                    O ponto fica <b className="text-amber-300">âmbar</b> quando está
                    deslocado; Alt + meio no vazio devolve ao centro.
                  </p>
                </>
              )}
              {!travado && gizmoModo === "girar" && (
                <p className="text-[10px] leading-relaxed text-white/25">
                  Três anéis, um por eixo, na cor do eixo:{" "}
                  <b className="text-[#4aa8ff]">azul</b> gira (rotação),{" "}
                  <b className="text-[#ff5a5a]">vermelho</b> rola e{" "}
                  <b className="text-[#4ade80]">verde</b> inclina. O puxador de
                  cada anel fica na posição do ângulo atual.
                </p>
              )}
              <div>
                <label className="mb-0.5 block text-[11px] text-white/50">Asset (GLB)</label>
                <div className="flex gap-1.5">
                  <input type="text" value={c.modelUrl ?? ""} placeholder="/models/arquivo.glb ou URL"
                    onChange={(e) => setConfig({ modelUrl: e.target.value })}
                    className="min-w-0 flex-1 rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
                  <button onClick={() => glbRef.current?.click()} className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/20">
                    <Upload className="h-3 w-3" />
                  </button>
                  <input ref={glbRef} type="file" accept=".glb" className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = ""; // permite reenviar o mesmo arquivo
                      if (!f || !conferirPesoGlb(f)) return;
                      const u = await upload(f);
                      if (u) setConfig({ modelUrl: u });
                    }} />
                </div>
              </div>
            </Section>
          )}

          {tab === "modelo" && (
            <Section title="Mini mapa (sem cidade 3D)" aberta={false}>
              <p className="text-[10px] leading-relaxed text-white/35">
                GLB de terreno/quadra que entra no lugar da fotogrametria quando a
                cidade 3D é desligada. Sem ele, esse modo deixa o prédio sobre um
                fundo liso. Opcional — vazio, nada muda.
              </p>
              {/* O preview vem ANTES do resto, como no modo noturno: com a
                  cidade ligada o mini mapa não é desenhado, e mexer nos sliders
                  abaixo não mudaria um pixel na tela. */}
              <button
                onClick={() => setPreviewEstudio((v) => !v)}
                className={`flex w-full items-center justify-center gap-1.5 rounded-[3px] border py-1.5 text-[11px] font-semibold transition-colors ${
                  previewEstudio
                    ? "border-teal-400/50 bg-teal-500/15 text-teal-300 hover:bg-teal-500/25"
                    : "border-white/[0.08] text-white/55 hover:border-white/25 hover:text-white/85"
                }`}>
                {previewEstudio
                  ? <><Globe className="h-3.5 w-3.5" /> Voltar à cidade 3D</>
                  : <><MapIcon className="h-3.5 w-3.5" /> Pré-visualizar sem a cidade</>}
              </button>
              {!previewEstudio && (
                <p className="text-[10px] leading-relaxed text-white/30">
                  Ligue o preview para ver o mini mapa e o efeito dos ajustes abaixo.
                </p>
              )}
              <div>
                <label className="mb-0.5 block text-[11px] text-white/50">Asset (GLB)</label>
                <div className="flex gap-1.5">
                  <input type="text" value={c.mapaUrl ?? ""} placeholder="/models/terreno.glb ou URL"
                    onChange={(e) => setConfig({ mapaUrl: e.target.value })}
                    className="min-w-0 flex-1 rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
                  <button onClick={() => mapaGlbRef.current?.click()} className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/20">
                    <Upload className="h-3 w-3" />
                  </button>
                  <input ref={mapaGlbRef} type="file" accept=".glb" className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = ""; // permite reenviar o mesmo arquivo
                      if (!f || !conferirPesoGlb(f)) return;
                      const u = await upload(f);
                      // Subir o mini mapa já liga o preview: quem acabou de
                      // enviar quer ver onde ele caiu, e com a cidade ligada
                      // não veria nada acontecer.
                      if (u) { setConfig({ mapaUrl: u }); setPreviewEstudio(true); }
                    }} />
                </div>
              </div>
              {c.mapaUrl && (
                <>
                  {/* Transformação PRÓPRIA, separada da do prédio: os dois GLBs
                      quase nunca vêm no mesmo referencial. Ver `MapaBase`. */}
                  <Slider label="Rotação" v={c.mapaHeading ?? 0} min={0} max={360} step={1} suffix="°"
                    onChange={(x) => setConfig({ mapaHeading: x })} />
                  <Num label="Escala" v={c.mapaScale ?? 1} onChange={(x) => setConfig({ mapaScale: x })} />
                  <Slider label="Altura base" v={c.mapaHeightOffset ?? 0} min={-80} max={150} step={0.5} suffix="m"
                    onChange={(x) => setConfig({ mapaHeightOffset: x })} />
                  <Slider label="Mover L↔O" v={c.mapaOffsetEast ?? 0} min={-400} max={400} step={1} suffix="m"
                    onChange={(x) => setConfig({ mapaOffsetEast: x })} />
                  <Slider label="Mover N↔S" v={c.mapaOffsetNorth ?? 0} min={-400} max={400} step={1} suffix="m"
                    onChange={(x) => setConfig({ mapaOffsetNorth: x })} />
                  <button
                    onClick={() => setConfig({ mapaUrl: "" })}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md bg-white/5 px-3 py-1.5 text-[11px] text-white/50 hover:bg-red-500/15 hover:text-red-300">
                    <Trash2 className="h-3 w-3" /> Remover o mini mapa
                  </button>
                </>
              )}
            </Section>
          )}

          {tab === "modelo" && (
            <Section title="Transformação">
              <Slider label="Rotação" v={c.heading} min={0} max={360} step={1} suffix="°" disabled={travado} onChange={(x) => setConfig({ heading: x })} />
              <Slider label="Inclinar" v={c.pitch} min={-180} max={180} step={1} suffix="°" disabled={travado} onChange={(x) => setConfig({ pitch: x })} />
              <Slider label="Rolar" v={c.roll} min={-180} max={180} step={1} suffix="°" disabled={travado} onChange={(x) => setConfig({ roll: x })} />
              <Num label="Escala" v={c.scale} disabled={travado} onChange={(x) => setConfig({ scale: x })} />
              <Slider label="Altura base" v={c.heightOffset} min={-80} max={150} step={0.5} suffix="m" disabled={travado} onChange={(x) => setConfig({ heightOffset: x })} />
              <Slider label="Mover L↔O" v={c.offsetEast} min={-400} max={400} step={1} suffix="m" disabled={travado} onChange={(x) => setConfig({ offsetEast: x })} />
              <Slider label="Mover N↔S" v={c.offsetNorth} min={-400} max={400} step={1} suffix="m" disabled={travado} onChange={(x) => setConfig({ offsetNorth: x })} />
            </Section>
          )}

          {tab === "cameras" && (
            <Section title="Câmera inicial" aberta={false}>
              <p className="text-[10px] leading-relaxed text-white/35"
                title="A vista marcada com estrela na sequência do tour é a que abre a experiência pública; esta aqui é o enquadramento bruto do viewport.">
                Enquadramento de partida da cena, antes de qualquer vista.
              </p>
              <button onClick={() => { const cam = sceneRef.current?.getCurrentCamera(); if (cam) setConfig({ camera: cam }); }}
                className="flex w-full items-center justify-center gap-2 rounded-[3px] bg-white/10 px-3 py-1.5 text-[11px] text-white/80 hover:bg-white/20">
                <Camera className="h-3.5 w-3.5" /> {c.camera ? "Recapturar" : "Capturar"}
              </button>
              {c.camera && <p className="text-[10px] text-white/40">alt {c.camera.height.toFixed(0)}m · hdg {c.camera.heading.toFixed(0)}°</p>}
            </Section>
          )}

          {/* ===== Câmeras de destino =====
              Enquadramentos por CONTEXTO, não por momento do tour. Cada um
              atende uma tarefa diferente: escolher apartamento pede a torre
              preenchendo a tela; ler o entorno pede recuo até os pontos de
              interesse caberem junto com o prédio. Sem eles, o usuário entra
              nessas seções de onde quer que a câmera estivesse. */}
          {tab === "cameras" && (
            <Section title="Câmeras de destino" aberta={false}>
              <p className="text-[10px] leading-relaxed text-white/35">
                Para onde a cena voa ao abrir cada seção da vitrine. Posicione a
                câmera no 3D e capture.
              </p>
              {([
                {
                  campo: "cameraUnidades" as const,
                  titulo: "Ao ver as unidades",
                  ajuda: "Torre preenchendo a tela, no ângulo em que as fachadas se distinguem.",
                  valor: c.cameraUnidades,
                },
                {
                  campo: "cameraEntorno" as const,
                  titulo: "Ao ver o entorno",
                  ajuda: "Recuado, com os pontos de interesse cabendo junto com o empreendimento.",
                  valor: c.cameraEntorno,
                },
              ]).map(({ campo, titulo, ajuda, valor }) => (
                <div key={campo} className="rounded-[3px] border border-white/[0.08] p-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-white/80">
                      {titulo}
                    </span>
                    {valor
                      ? <SeloEntorno tom="pronto">definida</SeloEntorno>
                      : <SeloEntorno tom="neutro">padrão</SeloEntorno>}
                  </div>
                  <p className="mt-0.5 text-[9px] leading-relaxed text-white/30">{ajuda}</p>
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      onClick={() => {
                        const cam = sceneRef.current?.getCurrentCamera();
                        if (cam) setConfig({ [campo]: cam });
                      }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-[3px] bg-white/10 px-2 py-1 text-[10px] text-white/80 hover:bg-white/20">
                      <Camera className="h-3 w-3" /> {valor ? "Recapturar" : "Capturar"}
                    </button>
                    {valor && (
                      <>
                        <button onClick={() => sceneRef.current?.flyToCamera(valor, 1.2)}
                          title="Voar até este enquadramento"
                          className="shrink-0 rounded-[3px] border border-white/10 px-2 py-1 text-[10px] text-white/55 hover:border-white/25">
                          Ver
                        </button>
                        <button onClick={() => setConfig({ [campo]: undefined })}
                          title="Voltar ao comportamento padrão"
                          className="shrink-0 rounded-[3px] border border-[var(--ed-line)] px-1.5 py-1 text-[9px] text-white/45 hover:border-white/25 hover:text-white/85">
                          limpar
                        </button>
                      </>
                    )}
                  </div>
                  {valor && (
                    <p className="mt-1 text-[9px] text-white/35">
                      alt {valor.height.toFixed(0)} m · hdg {valor.heading.toFixed(0)}°
                      · pitch {valor.pitch.toFixed(0)}°
                    </p>
                  )}
                </div>
              ))}
            </Section>
          )}

          {tab === "cameras" && (
            <Section title="Vistas e tour">
              {/* Captura */}
              <div className="flex gap-1.5">
                <input value={newViewName} onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && capturarVista()}
                  placeholder="Nome da vista (ex: Fachada mar)"
                  className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs outline-none ring-1 ring-white/10 focus:ring-teal-400/50" />
                <button onClick={capturarVista} title="Grava a câmera atual como uma vista"
                  className="flex items-center gap-1 rounded-md bg-teal-500 px-2.5 py-1 text-xs font-semibold text-[#0a0a0a] hover:bg-teal-400">
                  <Plus className="h-3 w-3" /> Capturar
                </button>
              </div>

              {/* Tour */}
              <div className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1.5">
                <button onClick={alternarTour} disabled={views.length === 0}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold disabled:opacity-40 ${
                    tourAtivo ? "bg-amber-400 text-[#0a0a0a]" : "bg-white/10 text-white/80 hover:bg-white/20"
                  }`}>
                  {tourAtivo ? <><Square className="h-3 w-3" /> Parar</> : <><Play className="h-3 w-3" /> Pré-visualizar tour</>}
                </button>
                <span className="text-[10px] text-white/40">
                  {views.length} vista{views.length === 1 ? "" : "s"} · {formatDuracao(duracaoTotal(views))}
                </span>
              </div>

              <div className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">
                Sequência do tour
              </div>
              {views.length === 0 && (
                <p className="text-[11px] text-white/40">
                  Nenhuma vista ainda. Enquadre a cena e clique em <b>Capturar</b>. A ordem desta
                  lista é a ordem do tour.
                </p>
              )}

              {views.map((v, i) => (
                <div key={v.id}
                  className={`rounded-md ring-1 ${
                    tourIdx === i ? "bg-teal-500/15 ring-teal-400/50" : "bg-white/[0.04] ring-white/5"
                  }`}>
                  <div className="flex items-stretch gap-1.5 p-1.5">
                    {/* Miniatura */}
                    <button onClick={() => irParaVista(v)} title="Ir para esta vista"
                      className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-black/40">
                      {v.thumbUrl
                        ? <img src={v.thumbUrl} alt="" className="h-full w-full object-cover" />
                        : <Camera className="absolute inset-0 m-auto h-4 w-4 text-white/25" />}
                      <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] text-white/70">
                        {i + 1}
                      </span>
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <input value={v.name} onChange={(e) => patchView(v.id, { name: e.target.value })}
                          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs text-white/90 outline-none hover:bg-white/5 focus:bg-white/10" />
                        <button onClick={() => definirPrincipal(v.id)} title="Definir como vista principal (Main view)"
                          className={`rounded p-1 ${v.isMain ? "text-amber-300" : "text-white/25 hover:text-white/60"}`}>
                          <Star className="h-3 w-3" fill={v.isMain ? "currentColor" : "none"} />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 px-1">
                        <span className="text-[9px] text-white/35">voo</span>
                        <input type="number" min={0} step={0.5} value={v.duracao ?? DURACAO_PADRAO}
                          onChange={(e) => patchView(v.id, { duracao: Math.max(0, parseFloat(e.target.value) || 0) })}
                          className="w-10 rounded bg-white/10 px-1 py-0.5 text-[10px] outline-none" />
                        <span className="text-[9px] text-white/35">parada</span>
                        <input type="number" min={0} step={0.5} value={v.espera ?? ESPERA_PADRAO}
                          onChange={(e) => patchView(v.id, { espera: Math.max(0, parseFloat(e.target.value) || 0) })}
                          className="w-10 rounded bg-white/10 px-1 py-0.5 text-[10px] outline-none" />
                        <span className="text-[9px] text-white/35">s</span>
                      </div>
                    </div>

                    {/* Ordem e remoção */}
                    <div className="flex shrink-0 flex-col justify-between">
                      <div className="flex flex-col">
                        <button onClick={() => moverVista(i, -1)} disabled={i === 0}
                          className="rounded p-0.5 text-white/40 hover:text-white disabled:opacity-20">
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button onClick={() => moverVista(i, 1)} disabled={i === views.length - 1}
                          className="rounded p-0.5 text-white/40 hover:text-white disabled:opacity-20">
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                      <button onClick={() => setViews(views.filter((x) => x.id !== v.id))}
                        className="rounded bg-red-500/15 p-1 text-red-300 hover:bg-red-500/25">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Corte de pavimento associado à vista */}
                  <div className="flex items-center gap-1.5 border-t border-white/5 px-2 py-1">
                    <Scissors className="h-3 w-3 shrink-0 text-white/30" />
                    <select
                      value={v.cutFloorZ == null ? "" : String(v.cutFloorZ)}
                      onChange={(e) =>
                        patchView(v.id, { cutFloorZ: e.target.value === "" ? null : parseFloat(e.target.value) })
                      }
                      className="min-w-0 flex-1 rounded bg-white/10 px-1 py-0.5 text-[10px] outline-none">
                      <option value="" className="bg-[#0a0a0a]">Sem corte</option>
                      {pavimentos(pavCfg ?? undefined)
                        .filter((p) => p.cutZ != null)
                        .map((p) => (
                          <option key={p.id} value={String(p.cutZ)} className="bg-[#0a0a0a]">
                            Cortar no {p.label}
                          </option>
                        ))}
                    </select>
                    <button onClick={() => recapturarVista(v.id)} title="Atualizar posição e miniatura com o enquadramento atual"
                      className="flex shrink-0 items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/20">
                      <RefreshCw className="h-3 w-3" /> Recapturar
                    </button>
                    {/* Duplicar entra LOGO DEPOIS da original: uma variação de
                        enquadramento pertence ao mesmo trecho do tour, e mandá-la
                        para o fim da lista obrigaria a subi-la de volta a cliques. */}
                    <button onClick={() => {
                      const copia: NamedView = {
                        ...v, id: genId("view"), name: `${v.name} (cópia)`, isMain: false,
                      };
                      setViews([...views.slice(0, i + 1), copia, ...views.slice(i + 1)]);
                    }} title="Duplicar esta vista"
                      className="shrink-0 rounded bg-white/10 p-1 text-white/70 hover:bg-white/20">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}

              <p className="text-[10px] text-white/40">
                A <Star className="inline h-2.5 w-2.5 text-amber-300" /> marca a vista de abertura
                do projeto. A ordem da lista é a ordem do tour.
              </p>
            </Section>
          )}

          {tab === "pois" && (
            <>
              <Section title="Categorias" aberta={false}>
                <p className="text-[10px] leading-relaxed text-white/35"
                  title="Renomear atualiza os pontos junto; remover apenas os desclassifica.">
                  Agrupam e colorem os pontos no mapa e na vitrine.
                </p>
                {categoriasPoi.map((cat, i) => (
                  <div key={cat} className="flex items-center gap-1">
                    {/* Ícone e cor da categoria: é o que o pino do mapa usa.
                        Com categoria virando texto livre, "Marina" e
                        "Aeroporto" caíam no pino genérico e o mapa perdia a
                        leitura de relance que justifica ter categorias. */}
                    <button
                      onClick={() => setCatEstiloAberta(catEstiloAberta === cat ? null : cat)}
                      title="Ícone e cor desta categoria"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ background: corDaCategoriaPoi(cat, emp.estiloCategoriaPoi) }}
                    >
                      {(() => {
                        const Ic = iconeDaCategoria(cat, emp.estiloCategoriaPoi);
                        return <Ic className="h-3 w-3" />;
                      })()}
                    </button>
                    <input
                      defaultValue={cat}
                      key={`poi-cat-${cat}`}
                      onBlur={(e) => renomearCategoriaPoi(cat, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      className={CAMPO}
                    />
                    <span className="w-6 shrink-0 text-right text-[9px] text-white/30">
                      {pois.filter((p) => p.categoria === cat).length}
                    </span>
                    <div className="flex shrink-0 flex-col">
                      <button onClick={() => { const n = [...categoriasPoi]; if (i > 0) { [n[i - 1], n[i]] = [n[i], n[i - 1]]; setCategoriasPoi(n); } }}
                        disabled={i === 0}
                        className="rounded-[3px] p-0.5 text-white/35 hover:text-white disabled:opacity-20">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button onClick={() => { const n = [...categoriasPoi]; if (i < n.length - 1) { [n[i + 1], n[i]] = [n[i], n[i + 1]]; setCategoriasPoi(n); } }}
                        disabled={i === categoriasPoi.length - 1}
                        className="rounded-[3px] p-0.5 text-white/35 hover:text-white disabled:opacity-20">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <button onClick={() => removerCategoriaPoi(cat)} title="Remover categoria"
                      className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}

                {/* Seletor de ícone e cor da categoria aberta. */}
                {catEstiloAberta && (
                  <div className="space-y-2 rounded-[6px] border border-[var(--ed-line)] bg-[var(--ed-soft)] p-2">
                    <div className="ed-eyebrow text-[var(--ed-dim)]">{catEstiloAberta}</div>
                    <div className="grid grid-cols-8 gap-1">
                      {NOMES_ICONES_POI.map((nome) => {
                        const Ic = ICONES_POI[nome];
                        const ativo = (emp.estiloCategoriaPoi?.[catEstiloAberta]?.icone ?? "") === nome;
                        return (
                          <button key={nome} title={nome}
                            onClick={() => setEstiloCategoria(catEstiloAberta, { icone: nome })}
                            className={`flex h-7 items-center justify-center rounded-[4px] border transition-colors ${
                              ativo ? "border-white/60 bg-white/15 text-white" : "border-[var(--ed-line)] text-white/45 hover:text-white"
                            }`}>
                            <Ic className="h-3.5 w-3.5" />
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {CORES_POI.map((c2) => (
                        <button key={c2} title={c2}
                          onClick={() => setEstiloCategoria(catEstiloAberta, { cor: c2 })}
                          className={`h-5 w-5 rounded-full border-2 ${
                            corDaCategoriaPoi(catEstiloAberta, emp.estiloCategoriaPoi) === c2
                              ? "border-white"
                              : "border-transparent"
                          }`}
                          style={{ background: c2 }} />
                      ))}
                    </div>
                    <button
                      onClick={() => setEstiloCategoria(catEstiloAberta, null)}
                      className="w-full rounded-[3px] border border-[var(--ed-line)] py-1 text-[10px] text-white/45 hover:border-white/25 hover:text-white/85">
                      voltar ao padrão
                    </button>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <input
                    value={novaCategoriaPoi}
                    onChange={(e) => setNovaCategoriaPoi(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const n = novaCategoriaPoi.trim();
                      if (!n) return;
                      if (categoriasPoi.some((c) => c.toLowerCase() === n.toLowerCase())) {
                        setSaveMsg(`Erro: já existe a categoria "${n}".`);
                        return;
                      }
                      setCategoriasPoi([...categoriasPoi, n]);
                      setNovaCategoriaPoi("");
                    }}
                    placeholder="Nova categoria (ex: Marina)"
                    className={CAMPO}
                  />
                  <button
                    onClick={() => {
                      const n = novaCategoriaPoi.trim();
                      if (!n) return;
                      if (categoriasPoi.some((c) => c.toLowerCase() === n.toLowerCase())) {
                        setSaveMsg(`Erro: já existe a categoria "${n}".`);
                        return;
                      }
                      setCategoriasPoi([...categoriasPoi, n]);
                      setNovaCategoriaPoi("");
                    }}
                    disabled={!novaCategoriaPoi.trim()}
                    className="shrink-0 rounded-[3px] bg-white px-2 py-[3px] text-[11px] font-semibold text-[#0a0a0a] hover:opacity-85 disabled:opacity-40">
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </Section>

              {/*
                Mapa de configuração do entorno. Posicionar um POI clicando na
                cena 3D exige achar o ponto na fotogrametria — que muitas vezes
                nem cobre o raio inteiro do entorno. No mapa, o pino é arrastado
                para o endereço certo direto, e a rota confirma o trajeto.
              */}
              <Section title="Mapa do entorno" aberta={false}>
                <p className="text-[10px] leading-relaxed text-white/35">
                  Arraste o pino para reposicionar. Com um ponto selecionado, o
                  clique no mapa também o move — e o traçado mostra a rota real
                  desde o empreendimento.
                </p>
                {apiKey ? (
                  <MapaEntorno
                    centro={{ lat: c.lat ?? emp.lat, lng: c.lng ?? emp.lng }}
                    nomeCentro={project.name}
                    pois={pois.map((p) => ({
                      id: p.id, name: p.name, categoria: p.categoria,
                      lat: p.lat, lng: p.lng, rota: p.rota,
                    }))}
                    estiloCategorias={emp.estiloCategoriaPoi}
                    cor="#ffffff"
                    selecionadoId={selectedPoiId}
                    onSelecionar={setSelectedPoiId}
                    editavel
                    onMoverPoi={(id, lat, lng) =>
                      setPois(pois.map((p) => (p.id === id ? { ...p, lat, lng } : p)))
                    }
                    className="h-56"
                  />
                ) : (
                  <p className="text-[10px] text-amber-300">
                    Chave do Google Maps não configurada.
                  </p>
                )}
              </Section>

              {pois.length > 6 && (
                <div className="flex items-center gap-1.5">
                  <Search className="h-3 w-3 shrink-0 text-white/30" />
                  <input value={buscaPoi} onChange={(e) => setBuscaPoi(e.target.value)}
                    placeholder="Filtrar por nome ou categoria" className={CAMPO} />
                  {buscaPoi && (
                    <button onClick={() => setBuscaPoi("")}
                      className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-white/10 hover:text-white/80">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
              {pois
                .filter((p) => {
                  const q = buscaPoi.trim().toLowerCase();
                  if (!q) return true;
                  return `${p.name} ${p.categoria}`.toLowerCase().includes(q);
                })
                .map((poi) => (
                <div key={poi.id} className="rounded-md bg-white/[0.04]">
                  <button onClick={() => setSelectedPoiId(poi.id === selectedPoiId ? null : poi.id)}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${poi.id === selectedPoiId ? "text-teal-300" : "text-white/80"}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: corDaCategoriaPoi(poi.categoria, emp.estiloCategoriaPoi) }} />
                    <span className="flex-1 truncate">{poi.name}</span>
                    <span className="text-[9px] text-white/30">{poi.tempo}</span>
                  </button>
                  {poi.id === selectedPoiId && (
                    <div className="space-y-1.5 border-t border-white/5 p-2">
                      <input value={poi.name} onChange={(e) => setPois(pois.map((p) => (p.id === poi.id ? { ...p, name: e.target.value } : p)))}
                        className="w-full rounded bg-white/10 px-2 py-1 text-xs outline-none ring-1 ring-white/10" placeholder="Nome" />
                      <div className="flex gap-1.5">
                        <select value={poi.categoria} onChange={(e) => setPois(pois.map((p) => (p.id === poi.id ? { ...p, categoria: e.target.value } : p)))}
                          className="min-w-0 flex-1 rounded bg-white/10 px-1.5 py-1 text-xs outline-none ring-1 ring-white/10">
                          <option value="" className="bg-[#0a0a0a]">— sem categoria —</option>
                          {categoriasPoi.map((cat) => <option key={cat} value={cat} className="bg-[#0a0a0a]">{cat}</option>)}
                        </select>
                        <input value={poi.tempo} onChange={(e) => setPois(pois.map((p) => (p.id === poi.id ? { ...p, tempo: e.target.value } : p)))}
                          placeholder="5 min" className="w-16 rounded bg-white/10 px-1.5 py-1 text-xs outline-none ring-1 ring-white/10" />
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => setPlacingPoiId(poi.id)}
                          className="flex flex-1 items-center justify-center gap-1 rounded bg-amber-400/20 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-400/30">
                          <Move className="h-3 w-3" /> Posicionar
                        </button>
                        <button onClick={() => { const cam = sceneRef.current?.getCurrentCamera(); if (cam) setPois(pois.map((p) => (p.id === poi.id ? { ...p, camera: cam } : p))); }}
                          className="flex flex-1 items-center justify-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/20">
                          <Camera className="h-3 w-3" /> Câmera
                        </button>
                        <button title="Duplicar — nasce ao lado, já pedindo o novo lugar"
                          onClick={() => {
                            const i = pois.findIndex((p) => p.id === poi.id);
                            const copia: EditablePoi = { ...poi, id: genId("poi"), name: `${poi.name} (cópia)` };
                            setPois([...pois.slice(0, i + 1), copia, ...pois.slice(i + 1)]);
                            setSelectedPoiId(copia.id);
                            setPlacingPoiId(copia.id);
                          }}
                          className="rounded bg-white/10 px-2 py-1 text-white/70 hover:bg-white/20"><Copy className="h-3 w-3" /></button>
                        <button onClick={() => { setPois(pois.filter((p) => p.id !== poi.id)); setSelectedPoiId(null); }}
                          className="rounded bg-red-500/15 px-2 py-1 text-red-300 hover:bg-red-500/25"><Trash2 className="h-3 w-3" /></button>
                      </div>
                      {poi.camera && <p className="text-[9px] text-teal-400/70">✓ câmera salva</p>}

                      {/* Descrição e fotos: é o que transforma a lista de
                          pontos num argumento de venda. */}
                      <textarea
                        value={poi.descricao ?? ""}
                        onChange={(e) => setPois(pois.map((p) =>
                          (p.id === poi.id ? { ...p, descricao: e.target.value } : p)))}
                        rows={3}
                        placeholder="Por que este ponto importa (ex: colégio bilíngue, mercado 24h)"
                        className="w-full resize-y rounded bg-white/10 px-2 py-1 text-xs leading-relaxed outline-none ring-1 ring-white/10" />

                      <div className="flex flex-wrap items-center gap-1">
                        {(poi.fotos ?? []).map((url, iFoto) => (
                          <div key={url + iFoto} className="group relative">
                            <img src={url} alt=""
                              className={`h-10 w-14 rounded-[3px] border object-cover ${
                                iFoto === 0 ? "border-teal-400/60" : "border-white/10"
                              }`} />
                            {/* A primeira é a CAPA do cartão. Reordenar é o
                                gesto de escolher a capa, então "promover" basta
                                — arrastar seria mais caro de fazer e de usar. */}
                            {iFoto > 0 && (
                              <button title="Usar como capa"
                                onClick={() => setPois(pois.map((p) => {
                                  if (p.id !== poi.id) return p;
                                  const f = [...(p.fotos ?? [])];
                                  f.unshift(f.splice(iFoto, 1)[0]);
                                  return { ...p, fotos: f };
                                }))}
                                className="absolute left-0 top-0 rounded-[3px] bg-black/70 px-1 text-[8px] text-white/80 opacity-0 group-hover:opacity-100">
                                capa
                              </button>
                            )}
                            <button title="Remover"
                              onClick={() => setPois(pois.map((p) => (p.id === poi.id
                                ? { ...p, fotos: (p.fotos ?? []).filter((_, k) => k !== iFoto) }
                                : p)))}
                              className="absolute -right-1 -top-1 rounded-full bg-red-500/90 px-1 text-[9px] leading-tight text-white opacity-0 group-hover:opacity-100">
                              ×
                            </button>
                          </div>
                        ))}
                        <label title="Enviar do computador"
                          className="relative flex h-10 w-14 cursor-pointer items-center justify-center rounded-[3px] border border-dashed border-white/20 text-[9px] text-white/40 hover:border-teal-400/50 hover:text-white/70">
                          <Upload className="h-3 w-3" />
                          <input type="file" accept="image/*" multiple
                            onChange={async (e) => {
                              const arqs = Array.from(e.target.files ?? []);
                              e.target.value = "";
                              for (const f of arqs) {
                                const u = await upload(f);
                                if (!u) continue;
                                setPois((atual) => atual.map((p) => (p.id === poi.id
                                  ? { ...p, fotos: [...(p.fotos ?? []), u] }
                                  : p)));
                              }
                            }}
                            className="absolute inset-0 cursor-pointer opacity-0" />
                        </label>
                        {galeria.length > 0 && (
                          <button
                            title="Escolher uma imagem já enviada na Galeria"
                            onClick={() => setGaleriaParaPoi(
                              galeriaParaPoi === poi.id ? null : poi.id,
                            )}
                            className={`flex h-10 w-14 items-center justify-center rounded-[3px] border border-dashed text-[9px] ${
                              galeriaParaPoi === poi.id
                                ? "border-teal-400/60 bg-teal-400/10 text-teal-200"
                                : "border-white/20 text-white/40 hover:border-teal-400/50 hover:text-white/70"
                            }`}>
                            <Images className="h-3 w-3" />
                          </button>
                        )}
                      </div>

                      {/*
                        Escolher da GALERIA em vez de reenviar.
                        A galeria já é onde as imagens do projeto moram, com
                        categorias próprias — dá para criar uma "Entorno" e
                        manter as fotos dos pontos junto com o resto, num lugar
                        só. Reenviar a mesma foto por aqui criaria um segundo
                        arquivo no servidor e uma segunda verdade.
                      */}
                      {galeriaParaPoi === poi.id && (
                        <div className="rounded-[3px] border border-white/10 p-1.5">
                          <p className="mb-1 text-[9px] text-white/35">
                            Clique para adicionar ao ponto.
                          </p>
                          <div className="grid max-h-40 grid-cols-4 gap-1 overflow-y-auto">
                            {galeria.map((g, k) => {
                              const jaTem = (poi.fotos ?? []).includes(g.url);
                              return (
                                <button key={g.url + k}
                                  title={`${g.legenda || "sem legenda"}${g.categoria ? ` · ${g.categoria}` : ""}`}
                                  onClick={() => setPois((atual) => atual.map((p) => {
                                    if (p.id !== poi.id) return p;
                                    const f = p.fotos ?? [];
                                    return {
                                      ...p,
                                      fotos: jaTem ? f.filter((u) => u !== g.url) : [...f, g.url],
                                    };
                                  }))}
                                  className={`relative overflow-hidden rounded-[2px] border ${
                                    jaTem ? "border-teal-400" : "border-white/10 hover:border-white/40"
                                  }`}>
                                  <img src={g.url} alt="" className="h-9 w-full object-cover" />
                                  {jaTem && (
                                    <span className="absolute inset-0 flex items-center justify-center bg-teal-400/25 text-[9px] font-bold text-white">
                                      ✓
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {(poi.fotos?.length ?? 0) > 0 && (
                        <p className="text-[9px] text-white/25">
                          {poi.fotos?.length} foto(s) · a primeira é a capa do cartão
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <button onClick={() => {
                // Nome único: dois pontos com o mesmo rótulo confundem na lista
                // e no mapa, onde a etiqueta é a única identificação visível.
                let n = pois.length + 1;
                while (pois.some((p) => p.name === `Novo ponto ${n}`)) n++;
                const np: EditablePoi = {
                  id: genId("poi"), name: `Novo ponto ${n}`, categoria: categoriasPoi[0] ?? "",
                  lat: c.lat ?? emp.lat, lng: c.lng ?? emp.lng, tempo: "",
                };
                setPois([...pois, np]); setSelectedPoiId(np.id); setPlacingPoiId(np.id);
              }} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/20">
                <Plus className="h-3.5 w-3.5" /> Adicionar ponto de interesse
              </button>
            </>
          )}

          {tab === "unidades" && pavCfg && (
            <UnidadesTab
              plantasDisponiveis={plantasCadastradas}
              isolarPavimento={isolarPavimento}
              onIsolarPavimento={setIsolarPavimento}
              plantaUnidId={plantaUnidId}
              onPlantaUnid={setPlantaUnidId}
              unidades={unidades}
              torres={torres}
              pavCfg={pavCfg}
              crm={crm}
              tipologias={tipologias}
              torreSelId={torreSelId}
              onTorreSel={setTorreSelId}
              placingTorreId={placingTorreId}
              onPlacingTorre={setPlacingTorreId}
              sel={unidSel}
              onSel={setUnidSel}
              onSelClique={selecionarUnidade}
              gizmoModo={gizmoModo}
              onGizmoModo={setGizmoModo}
              onUnidades={setUnidades}
              onTorres={(t) => setConfig({ torres: t })}
              onCrm={(c) => setConfig({ crm: c })}
              onTestarCamera={(uid, cam) => sceneRef.current?.frameUnit(uid, cam, 1.2)}
            />
          )}

          {tab === "niveis" && pavCfg && (
            <>
            {/* Input único compartilhado por todos os níveis. */}
            <input ref={nivelPlantaRef} type="file" accept="image/*" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f || !nivelPlantaAlvo) return;
                const url = await upload(f);
                if (url) setNiveis(niveis.map((n) => (n.id === nivelPlantaAlvo ? { ...n, plantaUrl: url } : n)));
                setNivelPlantaAlvo(null);
              }} />
            <NiveisTab
              niveis={niveis}
              onNiveis={setNiveis}
              pavCfg={pavCfg}
              torres={torres}
              selId={nivelSelId}
              onSel={setNivelSelId}
              gizmoInfo={gizmoInfo}
              gizmoModo={gizmoModo}
              onGizmoModo={setGizmoModo}
              escalaModelo={c.scale}
              plantas={plantasCadastradas}
              pivoNivel={pivoNivel}
              onPivoNivel={setPivoNivel}
              onPavCfg={(p) => setConfig({
                pavimentosCfg: { ...(pavCfg ?? DEFAULT_PAV_CFG), ...p },
              })}
              onVer={verNivel}
              onEnviarPlanta={(id) => { setNivelPlantaAlvo(id); nivelPlantaRef.current?.click(); }}
            />
            </>
          )}

          {tab === "tipologias" && (
            <>
              <p className="text-[11px] leading-relaxed text-white/40">
                A tipologia alimenta o card e o pop-up da unidade. A <b>axonométrica</b> é o render
                isométrico mobiliado — é ela que aparece na busca, não a planta técnica.
              </p>

              {/* Input único compartilhado por todas as tipologias. */}
              <input
                ref={tipoImgRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // permite reenviar o mesmo arquivo depois
                  if (!f || !tipoAlvo) return;
                  const url = await upload(f);
                  if (url) {
                    patchTipologia(tipoAlvo.id, { plantaUrl: url });
                  }
                  setTipoAlvo(null);
                }}
              />

              {/* Plantas do formato antigo que ainda não têm dono. A vitrine
                  continua exibindo todas (ver `plantasDoProjeto`); o que este
                  card resolve é dar a cada uma o seu lugar definitivo. */}
              {plantasSemDono.length > 0 && (
                <div className="space-y-1.5 rounded-md bg-white/[0.04] p-2 ring-1 ring-white/10">
                  <p className="text-[10px] leading-relaxed text-white/50">
                    <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-300" />
                    {plantasSemDono.length} planta{plantasSemDono.length === 1 ? "" : "s"} da aba
                    antiga sem dono. Planta de <b>unidade</b> vira tipologia aqui; planta de{" "}
                    <b>pavimento</b> (térreo, rooftop, subsolo) se anexa ao nível, na aba{" "}
                    <b>Níveis e cortes</b>.
                  </p>
                  {plantasSemDono.map((p, i) => (
                    <div key={`${p.area}-${i}`} className="flex items-center gap-1.5">
                      {p.imagemUrl && (
                        <img src={p.imagemUrl} alt="" className="h-8 w-11 shrink-0 rounded-[2px] bg-black/30 object-contain" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[11px] text-white/70" title={p.area}>
                        {p.area}
                      </span>
                      <button
                        title="Criar uma tipologia com esta planta"
                        onClick={() =>
                          setTipologias([
                            ...tipologias,
                            { id: genId("tip"), nome: p.area, plantaUrl: p.imagemUrl, descricao: p.descricao },
                          ])
                        }
                        className="shrink-0 rounded-[3px] bg-teal-500 px-2 py-1 text-[10px] font-semibold text-[#0a0a0a] hover:bg-teal-400">
                        virar tipologia
                      </button>
                      <button
                        title="Descartar esta planta antiga (a imagem no Storage não é apagada)"
                        onClick={() => {
                          if (!confirm(`Remover a planta antiga "${p.area}"?\n\nEla deixa de aparecer na vitrine.`)) return;
                          setEmp({ plantas: plantas.filter((x) => !(x.area === p.area && x.imagemUrl === p.imagemUrl)) });
                        }}
                        className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {tipologiasOrfas.length > 0 && (
                <div className="rounded-md bg-amber-500/10 p-2 ring-1 ring-amber-500/25">
                  <p className="mb-1.5 text-[10px] leading-relaxed text-amber-200">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    {tipologiasOrfas.length} tipologia{tipologiasOrfas.length === 1 ? "" : "s"} usada
                    {tipologiasOrfas.length === 1 ? "" : "s"} pelas unidades mas não cadastrada
                    {tipologiasOrfas.length === 1 ? "" : "s"}.
                  </p>
                  <button
                    onClick={() =>
                      setTipologias([
                        ...tipologias,
                        ...tipologiasOrfas.map((nome) => {
                          const u = unidades.find((x) => x.tipologia === nome);
                          return {
                            id: genId("tip"),
                            nome,
                            areaPrivativa: u?.areaPrivativa,
                            quartos: u?.quartos,
                            vagas: u?.vagas,
                          } as Tipologia;
                        }),
                      ])
                    }
                    className="w-full rounded bg-amber-400/20 px-2 py-1 text-[10px] font-semibold text-amber-100 hover:bg-amber-400/30"
                  >
                    Criar as que faltam
                  </button>
                </div>
              )}

              <button
                onClick={() =>
                  setTipologias([
                    ...tipologias,
                    { id: genId("tip"), nome: `Tipo ${tipologias.length + 1}` },
                  ])
                }
                className="flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#0a0a0a] hover:opacity-85"
              >
                <Plus className="h-3.5 w-3.5" /> Nova tipologia
              </button>

              {tipologias.length === 0 && (
                <p className="text-center text-[11px] text-white/30">Nenhuma tipologia ainda.</p>
              )}

              {tipologias.map((t) => {
                const nUnid = unidadesDaTipologia(t);
                const aberta = tipoAbertaId === t.id;
                return (
                  <div key={t.id} className="rounded-[6px] border border-[var(--ed-line)] bg-[var(--ed-card)]">
                    {/*
                      Cabeçalho sempre visível, resto sob demanda.

                      Aberta, cada tipologia ocupava ~240px de altura: com seis
                      delas a aba virava uma rolagem sem fim e nada se comparava
                      com nada. Fechada, é uma linha — e a lista volta a ser uma
                      lista.
                    */}
                    <div className="flex items-center gap-1 p-1">
                      {t.plantaUrl && (
                        <img src={t.plantaUrl} alt=""
                          className="h-6 w-8 shrink-0 rounded-[3px] bg-black/30 object-cover" />
                      )}
                      <input
                        value={t.nome}
                        onChange={(e) => renomearTipologia(t.id, e.target.value)}
                        placeholder="Nome (ex: Ocean — Tipo 1)"
                        className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[11px] text-white outline-none placeholder:text-[var(--ed-dim)]"
                      />
                      <span
                        className="shrink-0 font-mono text-[9px] text-[var(--ed-dim)]"
                        title="Unidades que usam esta tipologia"
                      >
                        {nUnid}un
                      </span>
                      <button onClick={() => setTipoAbertaId(aberta ? null : t.id)}
                        title={aberta ? "Fechar" : "Editar"}
                        className={`shrink-0 rounded-[3px] p-1 transition-colors ${
                          aberta ? "text-white" : "text-white/30 hover:text-white/80"
                        }`}>
                        <ChevronRight className={`h-3 w-3 transition-transform ${aberta ? "rotate-90" : ""}`} />
                      </button>
                      {/* Duplicar: tipologias de um mesmo projeto variam em um
                          ou dois campos (a área, um quarto a mais) e compartilham
                          as imagens — recadastrar tudo do zero é retrabalho. */}
                      <button
                        title="Duplicar tipologia"
                        onClick={() => {
                          const i = tipologias.findIndex((x) => x.id === t.id);
                          const copia: Tipologia = { ...t, id: genId("tip"), nome: `${t.nome} (cópia)` };
                          setTipologias([...tipologias.slice(0, i + 1), copia, ...tipologias.slice(i + 1)]);
                          setTipoAbertaId(copia.id);
                        }}
                        className="shrink-0 rounded-[3px] p-1 text-white/30 hover:text-white"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => {
                          if (nUnid > 0 && !confirm(`${nUnid} unidade(s) usam "${t.nome}". Remover mesmo assim?`)) return;
                          setTipologias(tipologias.filter((x) => x.id !== t.id));
                        }}
                        className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {aberta && (
                      <div className="space-y-1.5 border-t border-[var(--ed-line)] p-1.5">
                    {/* Imagens: miniaturas de 40px, não painéis de 64px — aqui
                        elas confirmam QUAL imagem está anexada, não servem para
                        apreciá-la. */}
                    {/* Só a PLANTA.

                        A axonométrica era um segundo render por tipologia que
                        ninguém produzia: exigia arte dedicada, não tinha lugar
                        garantido na vitrine (aparecia só como capa, no lugar da
                        planta) e virava mais um campo vazio a explicar em toda
                        tipologia cadastrada. O campo continua no schema para os
                        projetos que já subiram uma imagem não perderem nada. */}
                    <div className="grid grid-cols-1 gap-1.5">
                      {(
                        [
                          { campo: "plantaUrl", label: "Planta", url: t.plantaUrl },
                        ] as const
                      ).map((img) => (
                        <div key={img.campo} className="min-w-0">
                          <label className="mb-0.5 block truncate text-[9px] text-[var(--ed-dim)]">{img.label}</label>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => pedirImagemTipologia(t.id, img.campo)}
                              title={img.url ? "Trocar imagem" : "Enviar imagem"}
                              className="relative h-10 w-full min-w-0 overflow-hidden rounded-[4px] border border-[var(--ed-line)] bg-black/30 hover:border-white/25"
                            >
                              {img.url ? (
                                <img src={img.url} alt="" className="h-full w-full object-contain" />
                              ) : (
                                <span className="flex h-full items-center justify-center gap-1 text-[9px] text-[var(--ed-dim)]">
                                  <Upload className="h-3 w-3" /> Enviar
                                </span>
                              )}
                            </button>
                            {img.url && (
                              <button
                                title="Remover imagem"
                                onClick={() => patchTipologia(t.id, { plantaUrl: undefined })}
                                className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Atributos — alimentam os filtros de faixa da busca */}
                    <div className="grid grid-cols-4 gap-1">
                      {(
                        [
                          { k: "areaPrivativa", label: "m²", step: 0.5 },
                          { k: "quartos", label: "quartos", step: 1 },
                          { k: "suites", label: "suítes", step: 1 },
                          { k: "vagas", label: "vagas", step: 1 },
                        ] as const
                      ).map((campo) => (
                        <div key={campo.k} className="min-w-0">
                          <label className="mb-0.5 block truncate text-[9px] text-[var(--ed-dim)]" title={campo.label}>
                            {campo.label}
                          </label>
                          <input
                            type="number"
                            min={0}
                            step={campo.step}
                            value={t[campo.k] ?? ""}
                            onChange={(e) =>
                              patchTipologia(t.id, {
                                [campo.k]: e.target.value === "" ? undefined : parseFloat(e.target.value),
                              } as Partial<Tipologia>)
                            }
                            className={`${CAMPO} !px-1`}
                          />
                        </div>
                      ))}
                    </div>

                    <input
                      value={t.descricao ?? ""}
                      onChange={(e) => patchTipologia(t.id, { descricao: e.target.value })}
                      placeholder="Descrição (ex: Bloco Ocean)"
                      className={CAMPO}
                    />
                    <input
                      value={t.tour360Url ?? ""}
                      onChange={(e) => patchTipologia(t.id, { tour360Url: e.target.value })}
                      placeholder="Tour 360º (URL, opcional)"
                      className={`${CAMPO} font-mono`}
                    />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {tab === "galeria" && (
            <>
              <Section title="Categorias" aberta={false}>
                <p className="text-[10px] leading-relaxed text-white/35"
                  title="Renomear atualiza as imagens junto; remover apenas as desclassifica, sem apagar nada.">
                  Agrupam as imagens na vitrine, na ordem definida aqui.
                </p>

                {categoriasGaleria.length === 0 && (
                  <p className="text-[10px] text-white/25">Nenhuma categoria ainda.</p>
                )}

                {categoriasGaleria.map((cat, i) => (
                  <div key={cat} className="flex items-center gap-1">
                    <span className="w-5 shrink-0 text-center font-mono text-[9px] text-white/25">{i + 1}</span>
                    <input
                      defaultValue={cat}
                      key={`in-${cat}`}
                      onBlur={(e) => renomearCategoria(cat, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      className={CAMPO}
                    />
                    <span className="w-8 shrink-0 text-right text-[9px] text-white/30">
                      {galeria.filter((g) => g.categoria === cat).length}
                    </span>
                    <div className="flex shrink-0 flex-col">
                      <button onClick={() => moverCategoria(i, -1)} disabled={i === 0}
                        className="rounded p-0.5 text-white/35 hover:text-white disabled:opacity-20">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button onClick={() => moverCategoria(i, 1)} disabled={i === categoriasGaleria.length - 1}
                        className="rounded p-0.5 text-white/35 hover:text-white disabled:opacity-20">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <button onClick={() => removerCategoria(cat)} title="Remover categoria"
                      className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}

                <div className="flex gap-1.5">
                  <input
                    value={novaCategoria}
                    onChange={(e) => setNovaCategoria(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && criarCategoria(novaCategoria)) setNovaCategoria("");
                    }}
                    placeholder="Nova categoria (ex: Lazer)"
                    className={CAMPO}
                  />
                  <button
                    onClick={() => criarCategoria(novaCategoria) && setNovaCategoria("")}
                    disabled={!novaCategoria.trim()}
                    className="shrink-0 rounded-[3px] bg-teal-500 px-2 py-[3px] text-[11px] font-semibold text-[#0a0a0a] hover:bg-teal-400 disabled:opacity-40">
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                {categoriasGaleria.length === 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    <span className="text-[9px] text-white/25">sugestões:</span>
                    {["Fachada", "Áreas comuns", "Lazer", "Apartamento decorado", "Vista", "Implantação"].map((sug) => (
                      <button key={sug} onClick={() => criarCategoria(sug)}
                        className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-white/45 hover:bg-white/15 hover:text-white/80">
                        + {sug}
                      </button>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Vídeos" aberta={false}>
                <p className="text-[10px] leading-relaxed text-white/35"
                  title="O pôster é a imagem mostrada antes de dar play.">
                  Aparecem na aba Vídeos da galeria pública.
                </p>
                <button onClick={() => { setVideoAlvo(null); videoRef.current?.click(); }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-white/10 px-3 py-1.5 text-[11px] text-white/80 hover:bg-white/20">
                  <Upload className="h-3.5 w-3.5" /> Enviar vídeo
                </button>
                <input ref={videoRef} type="file" accept="video/*" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const u = await upload(f);
                    if (u) setVideos([...videos, { url: u, titulo: f.name.replace(/\.[^.]+$/, "") }]);
                  }} />
                <input ref={posterRef} type="file" accept="image/*" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    const i = videoAlvo;
                    e.target.value = "";
                    setVideoAlvo(null);
                    if (!f || i == null) return;
                    const u = await upload(f);
                    if (u) { const n = [...videos]; n[i] = { ...n[i], poster: u }; setVideos(n); }
                  }} />

                {videos.map((vd, i) => (
                  <div key={i} className="space-y-1 rounded-[3px] border border-white/[0.08] bg-black/20 p-1.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => { setVideoAlvo(i); posterRef.current?.click(); }}
                        title="Definir pôster"
                        className="relative h-9 w-12 shrink-0 overflow-hidden rounded-[2px] bg-black/40 hover:ring-1 hover:ring-teal-400/50">
                        {vd.poster
                          ? <img src={vd.poster} alt="" className="h-full w-full object-cover" />
                          : <Images className="absolute inset-0 m-auto h-3 w-3 text-white/25" />}
                      </button>
                      <input value={vd.titulo}
                        onChange={(e) => { const n = [...videos]; n[i] = { ...n[i], titulo: e.target.value }; setVideos(n); }}
                        placeholder="Título" className={CAMPO} />
                      <button onClick={() => setVideos(videos.filter((_, j) => j !== i))}
                        className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <input value={vd.url}
                      onChange={(e) => { const n = [...videos]; n[i] = { ...n[i], url: e.target.value }; setVideos(n); }}
                      placeholder="URL do vídeo" className={`${CAMPO} font-mono`} />
                  </div>
                ))}
                {videos.length === 0 && <p className="text-center text-[11px] text-white/30">Nenhum vídeo ainda.</p>}
              </Section>

              <Section title="Imagens">
                <button onClick={() => galRef.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-teal-500 px-3 py-2 text-xs font-semibold text-[#0a0a0a] hover:bg-teal-400">
                  <Upload className="h-3.5 w-3.5" /> Enviar imagens
                </button>
                <input ref={galRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    const novas = [...galeria];
                    for (const f of files) {
                      const u = await upload(f);
                      // Herda a categoria do filtro ativo: enviar um lote já
                      // classificado poupa classificar uma a uma depois.
                      if (u) novas.push({
                        url: u,
                        legenda: f.name.replace(/\.[^.]+$/, ""),
                        categoria: filtroCategoria && filtroCategoria !== "__sem__" ? filtroCategoria : undefined,
                      });
                    }
                    setEmp({ galeria: novas });
                    setImgSel([]);
                  }} />
                {filtroCategoria && filtroCategoria !== "__sem__" && (
                  <p className="text-[10px] text-teal-300/80">
                    Os próximos envios entram em “{filtroCategoria}”.
                  </p>
                )}

                {/* Filtro da lista */}
                {(categoriasGaleria.length > 0 || galeria.some((g) => !g.categoria)) && (
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => setFiltroCategoria("")}
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        !filtroCategoria ? "bg-teal-500 font-semibold text-[#0a0a0a]" : "bg-white/5 text-white/55 hover:bg-white/10"
                      }`}>
                      Todas ({galeria.length})
                    </button>
                    {categoriasGaleria.map((cat) => (
                      <button key={cat} onClick={() => setFiltroCategoria(cat === filtroCategoria ? "" : cat)}
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          filtroCategoria === cat ? "bg-teal-500 font-semibold text-[#0a0a0a]" : "bg-white/5 text-white/55 hover:bg-white/10"
                        }`}>
                        {cat} ({galeria.filter((g) => g.categoria === cat).length})
                      </button>
                    ))}
                    {galeria.some((g) => !g.categoria) && (
                      <button onClick={() => setFiltroCategoria(filtroCategoria === "__sem__" ? "" : "__sem__")}
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          filtroCategoria === "__sem__" ? "bg-amber-400 font-semibold text-[#0a0a0a]" : "bg-white/5 text-white/40 hover:bg-white/10"
                        }`}>
                        sem categoria ({galeria.filter((g) => !g.categoria).length})
                      </button>
                    )}
                  </div>
                )}

                {/* Filtro por texto: com galerias de 40+ imagens, achar aquela
                    legenda específica rolando a lista é o gargalo real. */}
                {galeria.length > 6 && (
                  <div className="flex items-center gap-1.5">
                    <Search className="h-3 w-3 shrink-0 text-white/30" />
                    <input value={buscaImagem} onChange={(e) => setBuscaImagem(e.target.value)}
                      placeholder="Filtrar por legenda" className={CAMPO} />
                    {buscaImagem && (
                      <button onClick={() => setBuscaImagem("")}
                        className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-white/10 hover:text-white/80">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Barra de lote — classificar 20 imagens uma a uma no select
                    de cada card era o trabalho mais repetitivo do editor. */}
                {imgSel.length > 0 && (
                  <div className="space-y-1 rounded-[3px] border border-teal-400/30 bg-teal-500/10 p-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 text-[10px] font-semibold text-teal-200">
                        {imgSel.length} selecionada{imgSel.length === 1 ? "" : "s"}
                      </span>
                      <button onClick={apagarSelecionadas} title="Remover as selecionadas"
                        className="shrink-0 rounded-[3px] p-1 text-red-300 hover:bg-red-500/20">
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <button onClick={() => setImgSel([])} title="Limpar seleção"
                        className="shrink-0 rounded-[3px] p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <select value="" onChange={(e) => categoriaEmLote(e.target.value || undefined)} className={CAMPO}>
                      <option value="" className="bg-[#0a0a0a]">Mover para a categoria…</option>
                      {categoriasGaleria.map((cat) => (
                        <option key={cat} value={cat} className="bg-[#0a0a0a]">{cat}</option>
                      ))}
                    </select>
                    <button onClick={() => categoriaEmLote(undefined)}
                      className="w-full rounded-[3px] border border-white/[0.08] py-0.5 text-[9px] text-white/45 hover:border-white/20 hover:text-white/80">
                      tirar a categoria
                    </button>
                  </div>
                )}

                {galeria.length > 0 && galeriaVisivel.size > 0 && (() => {
                  // "Todas marcadas" é sobre as VISÍVEIS estarem todas na
                  // seleção — não sobre o tamanho bater, que uma seleção
                  // qualquer do mesmo tamanho satisfaria por acaso.
                  const todasMarcadas = Array.from(galeriaVisivel).every((i) => imgSel.includes(i));
                  return (
                    <button
                      onClick={() => setImgSel(todasMarcadas ? [] : Array.from(galeriaVisivel))}
                      className="w-full rounded-[3px] border border-white/[0.08] py-0.5 text-[9px] text-white/45 hover:border-white/20 hover:text-white/80">
                      {todasMarcadas ? "desmarcar todas" : `marcar as ${galeriaVisivel.size} visíveis`}
                    </button>
                  );
                })()}

                {galeria.map((g, i) => {
                  if (!galeriaVisivel.has(i)) return null;
                  const marcada = imgSel.includes(i);
                  return (
                    <div key={i} className={`space-y-1 rounded-[3px] border bg-black/20 p-1.5 ${
                      marcada ? "border-teal-400/50" : "border-white/[0.08]"
                    }`}>
                      <div className="flex items-center gap-1.5">
                        <input type="checkbox" checked={marcada} title="Selecionar para as ações em lote"
                          onChange={() => setImgSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))}
                          className="shrink-0 accent-teal-400" />
                        <img src={g.url} alt="" className="h-9 w-12 shrink-0 rounded-[2px] object-cover" />
                        <input value={g.legenda}
                          onChange={(e) => { const n = [...galeria]; n[i] = { ...n[i], legenda: e.target.value }; setEmp({ galeria: n }); }}
                          placeholder="Legenda" className={CAMPO} />
                        <div className="flex shrink-0 flex-col">
                          <button title="Subir" onClick={() => moverImagem(i, -1)}
                            disabled={vizinhaVisivel(i, -1) < 0}
                            className="rounded-[3px] p-0.5 text-white/35 hover:text-white disabled:opacity-20">
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button title="Descer" onClick={() => moverImagem(i, 1)}
                            disabled={vizinhaVisivel(i, 1) < 0}
                            className="rounded-[3px] p-0.5 text-white/35 hover:text-white disabled:opacity-20">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>
                        <button onClick={() => { setEmp({ galeria: galeria.filter((_, j) => j !== i) }); setImgSel([]); }}
                          className="shrink-0 rounded-[3px] p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <select
                        value={g.categoria ?? ""}
                        onChange={(e) => {
                          const n = [...galeria];
                          n[i] = { ...n[i], categoria: e.target.value || undefined };
                          setEmp({ galeria: n });
                        }}
                        className={`${CAMPO} ${g.categoria ? "" : "border-amber-400/25"}`}>
                        <option value="" className="bg-[#0a0a0a]">— sem categoria —</option>
                        {categoriasGaleria.map((cat) => (
                          <option key={cat} value={cat} className="bg-[#0a0a0a]">{cat}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                {galeria.length === 0 && <p className="text-center text-[11px] text-white/30">Nenhuma imagem ainda.</p>}
              </Section>
            </>
          )}

          {tab === "ambiente" && ambiente && (
            <>
              <Section title="Abertura">
                <p className="text-[10px] leading-relaxed text-white/35">
                  Hora e estação em que a experiência abre. Use a barra solar embaixo para
                  encontrar a luz que valoriza o projeto e clique em capturar.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] text-white/50">Hora de abertura</label>
                    <div className="rounded bg-white/10 px-2 py-1 font-mono text-xs text-teal-300">
                      {String(Math.floor(ambiente.horaPadrao / 60)).padStart(2, "0")}:
                      {String(ambiente.horaPadrao % 60).padStart(2, "0")}
                    </div>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] text-white/50">Estação</label>
                    <select value={ambiente.estacaoPadrao}
                      onChange={(e) => setAmbiente({ estacaoPadrao: e.target.value as AmbienteCfg["estacaoPadrao"] })}
                      className="w-full rounded bg-white/10 px-2 py-1 text-xs outline-none ring-1 ring-white/10">
                      {(["verao", "outono", "inverno", "primavera"] as const).map((s) => (
                        <option key={s} value={s} className="bg-[#0a0a0a]">{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => setAmbiente({ horaPadrao: timeMinutes, estacaoPadrao: season })}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/20">
                  <Camera className="h-3.5 w-3.5" /> Usar a luz atual como abertura
                </button>
              </Section>

              <Section title="Modo noturno" aberta={false}>
                <p className="text-[10px] leading-relaxed text-white/35"
                  title="O Cesium não tem luzes de área: janela acesa depende de material emissivo assado no GLB. Se o modelo tiver emissivos, eles acendem sozinhos.">
                  Controla a hora, a força da luz e o realce que impede o prédio
                  de virar uma silhueta preta.
                </p>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-white/60">
                  <input type="checkbox" checked={ambiente.noturnoDisponivel}
                    onChange={(e) => setAmbiente({ noturnoDisponivel: e.target.checked })}
                    className="accent-teal-400" />
                  Oferecer o botão de dia/noite ao visitante
                </label>
                {ambiente.noturnoDisponivel && (
                  <>
                    {/* O preview vem ANTES dos sliders: sem ele ligado, mexer
                        no realce não muda nada na tela — que era exatamente o
                        problema. Ligado, ele reproduz o que o botão de lua da
                        vitrine faz, inclusive levando o relógio para a hora da
                        noite. */}
                    <button
                      onClick={alternarPreviewNoturno}
                      className={`flex w-full items-center justify-center gap-1.5 rounded-[3px] border py-1.5 text-[11px] font-semibold transition-colors ${
                        previewNoturno
                          ? "border-teal-400/50 bg-teal-500/15 text-teal-300 hover:bg-teal-500/25"
                          : "border-white/[0.08] text-white/55 hover:border-white/25 hover:text-white/85"
                      }`}>
                      {previewNoturno
                        ? <><SunMedium className="h-3.5 w-3.5" /> Voltar ao dia</>
                        : <><Moon className="h-3.5 w-3.5" /> Pré-visualizar a noite</>}
                    </button>
                    {!previewNoturno && (
                      <p className="text-[10px] leading-relaxed text-white/30">
                        Ligue o preview para ver o efeito dos ajustes abaixo na cena.
                      </p>
                    )}

                    <Slider label="Hora da noite" v={ambiente.horaNoturna} min={0} max={1439} step={15}
                      suffix={` (${String(Math.floor(ambiente.horaNoturna / 60)).padStart(2, "0")}:${String(ambiente.horaNoturna % 60).padStart(2, "0")})`}
                      onChange={(v) => {
                        const min = Math.round(v);
                        setAmbiente({ horaNoturna: min });
                        // Com o preview ligado, mexer na hora move a cena junto.
                        if (previewNoturno) setTimeMinutes(min);
                      }} />
                    <Slider label="Realce do prédio à noite" v={ambiente.realceNoturno} min={0} max={1} step={0.05}
                      suffix="" onChange={(v) => setAmbiente({ realceNoturno: v })} />
                    <p className="text-[10px] leading-relaxed text-white/30">
                      <b>0</b> deixa o prédio como silhueta contra o céu; <b>1</b> o
                      levanta ao máximo. O realce não acende janela — isso depende de
                      material emissivo no próprio GLB.
                    </p>
                  </>
                )}
              </Section>

              <Section title="Controles do visitante" aberta={false}>
                {(
                  [
                    ["mostrarBussola", "Bússola no topo"],
                    ["permitirScreenshot", "Botão de captura de tela"],
                    ["mostrarBarraSolar", "Barra solar (hora e estação)"],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5 text-[11px] text-white/60">
                    <input type="checkbox" checked={ambiente[k]}
                      onChange={(e) => setAmbiente({ [k]: e.target.checked } as Partial<AmbienteCfg>)}
                      className="accent-teal-400" />
                    {l}
                  </label>
                ))}
              </Section>
            </>
          )}

          {tab === "marca" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <ColorIn label="Cor de fundo" v={b.bg ?? "#04141d"} onChange={(x) => setBranding({ bg: x })} />
                <ColorIn label="Cor primária" v={b.primary ?? "#2dd4bf"} onChange={(x) => setBranding({ primary: x })} />
              </div>
              <ImgUp label="Logo" url={b.logoUrl} inputRef={logoRef}
                onPick={async (f) => { const u = await upload(f); if (u) setBranding({ logoUrl: u }); }}
                onClear={() => setBranding({ logoUrl: undefined })} />
              <ImgUp label="Símbolo (marcador no mapa)" url={b.symbolUrl} inputRef={symbolRef}
                onPick={async (f) => { const u = await upload(f); if (u) { setBranding({ symbolUrl: u }); setEmp({ markerImageUrl: u }); } }}
                onClear={() => { setBranding({ symbolUrl: undefined }); setEmp({ markerImageUrl: undefined }); }} />
              <Text label="Fonte display (CSS)" v={b.fontDisplay ?? ""} onChange={(x) => setBranding({ fontDisplay: x })} />
              <Text label="Fonte sans (CSS)" v={b.fontSans ?? ""} onChange={(x) => setBranding({ fontSans: x })} />
              <p className="text-[10px] text-white/40">
                As fontes usam famílias já carregadas no app (ex: “Ivy Mode”, “Brandon”).
              </p>
            </>
          )}
          </div>
        </aside>
      </div>

      {/* ================= BARRA DE STATUS ================= */}
      <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--ed-line)] bg-[var(--ed-chrome)] px-3 text-[10px] text-white/35">
        <span className="font-mono">
          {(c.lat ?? emp.lat).toFixed(5)}, {(c.lng ?? emp.lng).toFixed(5)}
        </span>
        <span className="h-3 w-px bg-white/10" />
        <span>{c.modelUrl ? "modelo 3D" : "sem modelo"}</span>
        <span className="h-3 w-px bg-white/10" />
        <span>{unidades.length} unidades</span>
        <span className="h-3 w-px bg-white/10" />
        <span>{views.length} vistas</span>
        <span className="ml-auto">{MODO_LOCAL ? "modo local" : "Supabase"}</span>
      </footer>
    </div>
  );
}
