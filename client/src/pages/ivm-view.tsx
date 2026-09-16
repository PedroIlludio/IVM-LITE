import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import {
  Loader2, Home, Play, Square, Camera, Moon, Maximize, Minimize, Layers3, RotateCw,
  ClipboardList, Trees, Building2, MapPin, Images,
} from "lucide-react";
import Scene3D, { type Scene3DHandle, TILES_TETO_MS } from "@/components/Scene3D";
import EmpreendimentoPanel from "@/components/EmpreendimentoPanel";
import BuscadorUnidades3D, { plantaDaUnidade, type ModoFoco } from "@/components/BuscadorUnidades3D";
import Bussola from "@/components/Bussola";
import TourVirtual from "@/components/TourVirtual";
import ClimaBar, { ehNoite } from "@/components/vitrine/ClimaBar";
import LazerView from "@/components/vitrine/LazerView";
import GaleriaView from "@/components/vitrine/GaleriaView";
import LocalView from "@/components/vitrine/LocalView";
import ComparadorPlantas from "@/components/vitrine/ComparadorPlantas";
import {
  BarraMovel, IlhaNav, Simbolo, TELAS_COM_3D, canaisDeContato,
  type ItemNav, type Secao, type Tela,
} from "@/components/vitrine/comum";
import {
  aplicarCrm,
  getProjectByPath,
  getProjectBySlug,
  normalizarLista,
  projectAmbiente,
  projectPavCfg,
  projectMapaBase,
  projectToBuilding3D,
  projectTorres,
  type IvmProject,
} from "@/lib/ivm-store";
import type { Unidade } from "@/lib/unidades";
import { buildUnitBoxes, volumeDaTorre } from "@/lib/unidades3d";
import { tocarTour, vistaPrincipal, type TourHandle } from "@/lib/tour";
import { plantasDeTipologia, unidadesComTipologia } from "@/lib/tipologias";
import { alturaDaPlanta, type NivelDef } from "@/lib/pavimentos";
import { getSunReadout, localToUtc, seasonDate, type Season } from "@/lib/solar";
import { ehAparelhoLeve } from "@/lib/cesium-setup";

/**
 * Página pública de um IVM Lite — a vitrine, na direção "Vidro".
 *
 * A cena 3D ocupa a tela inteira e fica MONTADA em todas as seções (trocar de
 * seção não remonta o viewer). A navegação é a ilha de ícones à esquerda; cada
 * seção abre um único cartão à direita ou uma tela própria (lazer, galeria,
 * localização, comparar) por cima da cena.
 */
export default function IvmViewPage() {
  // A página atende os dois endereços: o legado `/v/:slug` (projeto ainda sem
  // incorporadora) e o definitivo `/:incorporadora/:slug`. O padrão de dois
  // segmentos também casa com "/v/algo", então o legado é testado primeiro.
  const [ehLegado, paramsLegado] = useRoute("/v/:slug");
  const [, paramsTenant] = useRoute("/:incorporadora/:slug");
  const slug = (ehLegado ? paramsLegado?.slug : paramsTenant?.slug) ?? "";
  const incorporadoraSlug = ehLegado ? null : (paramsTenant?.incorporadora ?? null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  /**
   * O servidor respondeu, mas sem chave do Google. Sem isto a página ficava
   * presa na capa para sempre — a cena nunca monta sem `apiKey`.
   */
  const [semChave, setSemChave] = useState(false);
  const [project, setProject] = useState<IvmProject | null>(null);
  const [notFound, setNotFound] = useState(false);
  /** Falha que deixa a cena SEM O PRODUTO — fotogrametria ou GLB. */
  const [tilesError, setTilesError] = useState<string | null>(null);
  /**
   * A falha foi da FOTOGRAMETRIA (e não do modelo)? Só esse caso tem saída
   * alternativa: sem o GLB, entrar sem a cidade abriria a vitrine vazia.
   */
  const [erroDeFotogrametria, setErroDeFotogrametria] = useState(false);
  /**
   * Abrir a cena sem pedir a fotogrametria do Google. Ligado pelo botão da
   * tela de erro — nunca automático, para não esconder do plantão que algo na
   * configuração está errado.
   */
  const [semFotogrametria, setSemFotogrametria] = useState(false);
  const [ready, setReady] = useState(false);
  /** O GLB terminou de carregar (ou o projeto não tem modelo a esperar). */
  const [modeloPronto, setModeloPronto] = useState(false);

  // --- Navegação --------------------------------------------------------------
  const [tela, setTela] = useState<Tela>("home");
  const secao: Secao = tela === "comparar" ? "unidades" : tela;
  const com3D = TELAS_COM_3D.includes(tela);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [unidadeSelId, setUnidadeSelId] = useState<string | null>(null);
  /**
   * Como a unidade está sendo olhada — ver `ModoFoco`. Vive aqui porque decide
   * a NAVEGAÇÃO da câmera, que é prop do `Scene3D`.
   */
  const [modoFoco, setModoFoco] = useState<ModoFoco>("volume");
  const [filtradas, setFiltradas] = useState<string[]>([]);
  /** As duas plantas marcadas para a tela Comparar plantas. */
  const [comparacao, setComparacao] = useState<string[]>([]);
  const [season, setSeason] = useState<Season>("verao");
  const [timeMinutes, setTimeMinutes] = useState(780);
  /** Retorno da localização no celular: espera curta, própria para o visitante. */
  const [voltandoDoMapa, setVoltandoDoMapa] = useState(false);
  const [poiEntornoId, setPoiEntornoId] = useState<string | null>(null);
  /** Foto do cartão do POI aberta em tela cheia. */
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  /** Nível aberto (vista do pavimento de uma unidade) — de onde sai a planta no chão. */
  const [nivelAberto, setNivelAberto] = useState<NivelDef | null>(null);
  /** Tour 360 de uma unidade, em tela cheia. */
  const [tour360, setTour360] = useState<{ url: string; titulo: string } | null>(null);
  const fecharTour360 = useCallback(() => setTour360(null), []);
  const [telaCheia, setTelaCheia] = useState(false);

  /**
   * Fotogrametria (a cidade em volta) ligada? Desligá-la deixa o prédio
   * flutuando — leitura de maquete — com espelho de vendas, sombras e luz
   * intactos. Começa ligada, exceto no aparelho fraco com mini mapa e cota
   * salva (ver abaixo).
   */
  const [cidade3D, setCidade3D] = useState(true);
  /**
   * A cidade está REALMENTE em cena? Sem fotogrametria não há tileset e a
   * preferência perde o objeto — e sombras, vias e o modo de navegação
   * perguntam por isto para escolher comportamento.
   */
  const cidadeEfetiva = cidade3D && !semFotogrametria;

  /**
   * Aparelho fraco abre pelo MINI MAPA, não pela fotogrametria. As três
   * condições são obrigatórias: mini mapa (senão abre no vazio), cota salva
   * (senão o prédio nasce enterrado) e aparelho leve.
   */
  const aberturaDecididaRef = useRef(false);
  useEffect(() => {
    if (!project || aberturaDecididaRef.current) return;
    aberturaDecididaRef.current = true;
    const c = project.data.config;
    if (c.mapaUrl && c.alturaSolo != null && ehAparelhoLeve()) setCidade3D(false);
  }, [project]);

  const [mobileViewport, setMobileViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(
      "(max-width: 767px), (max-width: 1024px) and (max-height: 500px) and (pointer: coarse)",
    );
    const ver = () => setMobileViewport(mq.matches);
    ver();
    mq.addEventListener("change", ver);
    return () => mq.removeEventListener("change", ver);
  }, []);

  useEffect(() => {
    const ver = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", ver);
    return () => document.removeEventListener("fullscreenchange", ver);
  }, []);
  const alternarTelaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const sceneRef = useRef<Scene3DHandle>(null);

  /**
   * A vitrine trava a rolagem da PÁGINA: é uma tela cheia com painéis que
   * rolam por dentro. No tablet, a rolagem escondia o rodapé atrás da barra do
   * navegador. Posto aqui, e não no CSS global, porque /admin e editor rolam.
   */
  useEffect(() => {
    document.body.classList.add("sem-rolagem");
    return () => document.body.classList.remove("sem-rolagem");
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        const chave = (d.googleMapsApiKey as string) || "";
        setApiKey(chave);
        if (!chave) setSemChave(true);
      })
      .catch(() => setSemChave(true));
    const buscar = incorporadoraSlug
      ? getProjectByPath(incorporadoraSlug, slug)
      : getProjectBySlug(slug);
    buscar
      .then(async (p) => {
        if (!p) return setNotFound(true);
        setProject(p);
        setSelectedId(p.data.empreendimento.id);
        // Espelho do projeto, atualizado pelo CRM quando configurado.
        setUnidades(await aplicarCrm(p.data.unidades ?? [], p.data.config.crm));
      })
      .catch(() => setNotFound(true));
  }, [slug, incorporadoraSlug]);

  /**
   * Título da aba e metadados de compartilhamento, por PROJETO — é o que
   * aparece quando o corretor manda o link no WhatsApp. O favicon continua o
   * da plataforma: ele identifica a ferramenta, não o empreendimento.
   */
  useEffect(() => {
    if (!project) return;
    const emp = project.data.empreendimento;
    const local = emp.neighborhood?.trim();
    const titulo = local ? `${project.name} | ${local}` : project.name;
    const onde = [emp.address?.trim(), local].filter(Boolean).join(" · ");
    const descricao = `Tour interativo 3D${onde ? ` — ${onde}` : ""}.`;

    document.title = titulo;
    const meta = (seletor: string, valor: string) => {
      const el = document.head.querySelector<HTMLMetaElement>(seletor);
      if (el) el.content = valor;
    };
    meta('meta[name="description"]', descricao);
    meta('meta[property="og:title"]', titulo);
    meta('meta[property="og:description"]', descricao);
    return () => { document.title = "IVM Lite"; };
  }, [project]);

  // Atualização periódica da disponibilidade (quando o CRM define um intervalo).
  useEffect(() => {
    const crm = project?.data.config.crm;
    const base = project?.data.unidades;
    if (!crm || crm.mode !== "endpoint" || !crm.refreshMin || !base) return;
    const t = setInterval(
      () => aplicarCrm(base, crm).then(setUnidades),
      crm.refreshMin * 60_000,
    );
    return () => clearInterval(t);
  }, [project]);

  const emp = project?.data.empreendimento ?? null;
  const building = useMemo(() => (project ? projectToBuilding3D(project.data) : null), [project]);
  const mapaBase = useMemo(() => (project ? projectMapaBase(project.data) : null), [project]);
  const buildings = useMemo(() => (building ? [building] : []), [building]);
  const tz = project?.data.config.tzOffset ?? -3;
  const tipologias = useMemo(() => emp?.tipologias ?? [], [emp]);
  const unidadesCompletas = useMemo(
    () => unidadesComTipologia(unidades, tipologias),
    [unidades, tipologias],
  );

  const utcDate = useMemo(() => {
    const [y, m, d] = seasonDate(season, new Date().getFullYear());
    return localToUtc(y, m, d, Math.floor(timeMinutes / 60), timeMinutes % 60, tz);
  }, [season, timeMinutes, tz]);

  const sun = useMemo(
    () => getSunReadout(utcDate, building?.lat ?? -8.9398, building?.lng ?? -35.1696),
    [utcDate, building],
  );

  const brand = project?.data.config.branding ?? {};
  const torres = useMemo(() => (project ? projectTorres(project.data) : []), [project]);
  const pavCfg = useMemo(() => (project ? projectPavCfg(project.data) : undefined), [project]);

  /**
   * Centro da torre do pavimento aberto — o eixo da órbita na vista de andar.
   * Num projeto de várias torres o centro do EMPREENDIMENTO fica entre elas.
   */
  const centroDaTorreAberta = useMemo(() => {
    const id = nivelAberto?.torreId;
    if (!id) return null;
    const i = torres.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const vol = volumeDaTorre(torres[i], i, torres.length);
    return { x: vol.x, y: vol.y };
  }, [nivelAberto?.torreId, torres]);

  // --- Ambiente ---------------------------------------------------------------
  const ambiente = useMemo(() => (project ? projectAmbiente(project.data) : null), [project]);
  const [heading, setHeading] = useState(0);
  const [capturando, setCapturando] = useState(false);

  /**
   * Noite segue a HORA, não um botão: o escurecimento da cena e o realce
   * noturno do modelo acompanham o controle de luz.
   */
  const noite = ehNoite(timeMinutes);
  const noturno = !!ambiente?.noturnoDisponivel && noite;

  // Abre na luz definida no editor. Só na carga do projeto: depois disso quem
  // manda é o visitante.
  useEffect(() => {
    if (!ambiente) return;
    setTimeMinutes(ambiente.horaPadrao);
    setSeason(ambiente.estacaoPadrao as Season);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /** A lua leva o relógio para a hora noturna do projeto, e volta. */
  function alternarNoturno() {
    if (!ambiente) return;
    setTimeMinutes(noite ? ambiente.horaPadrao : ambiente.horaNoturna);
  }

  function capturarTela() {
    const url = sceneRef.current?.captureImage(1920, 0.92);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.slug ?? "ivm"}-${Date.now()}.jpg`;
    a.click();
    setCapturando(true);
    setTimeout(() => setCapturando(false), 1200);
  }

  // --- Cinemática: vista principal e tour -------------------------------------
  const views = useMemo(() => project?.data.config.sectionCameras ?? [], [project]);
  const principal = useMemo(() => vistaPrincipal(views), [views]);
  const [tourAtivo, setTourAtivo] = useState(false);
  /** Nome da vista em curso no tour — a legenda da cinemática. */
  const [tituloVista, setTituloVista] = useState<string | null>(null);
  const tourRef = useRef<TourHandle | null>(null);

  function pararTour() {
    tourRef.current?.parar();
    tourRef.current = null;
    setTourAtivo(false);
    setTituloVista(null);
  }

  /** Volta ao enquadramento de abertura (a vista principal do editor). */
  function irParaPrincipal() {
    pararTour();
    const cena = sceneRef.current;
    if (!cena) return;
    cena.cutAtFloor(principal?.cutFloorZ ?? null);
    if (principal) cena.flyToCamera(principal, principal.duracao ?? 2);
    else cena.frameBuilding();
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
        aoEntrar: (vista) => setTituloVista(vista.name),
        aoTerminar: () => {
          tourRef.current = null;
          setTourAtivo(false);
          setTituloVista(null);
        },
      },
    );
  }

  const buscaMode = tela === "unidades";
  // O tour move a câmera por temporizador: para ao entrar nas unidades, que
  // controlam a câmera por conta própria, e ao sair da página.
  useEffect(() => {
    if (buscaMode) pararTour();
  }, [buscaMode]);
  useEffect(() => () => tourRef.current?.parar(), []);

  /**
   * Troca de seção. A cena fica montada; o que muda é o cartão e, ao sair das
   * unidades, o estado de foco que elas deixaram na cena.
   */
  function irPara(destino: Tela) {
    if (destino === tela) return;
    const saindoDasUnidades = (tela === "unidades" || tela === "comparar")
      && destino !== "unidades" && destino !== "comparar";
    if (saindoDasUnidades) {
      setUnidadeSelId(null);
      setModoFoco("volume");
      setNivelAberto(null);
      sceneRef.current?.cutAtFloor(null);
      sceneRef.current?.frameBuilding();
    }
    if (destino === "unidades" && tela !== "comparar") {
      // A torre já aparece enquadrada quando a lista abre.
      const cam = project?.data.config.cameraUnidades;
      if (cam) sceneRef.current?.flyToCamera(cam, 1.4);
    }
    if (tela === "local") {
      setPoiEntornoId(null);
      // O mapa do celular liberou o contexto WebGL: a cena volta do zero.
      if (mobileViewport) setVoltandoDoMapa(true);
    }
    if (destino === "local" && mobileViewport) {
      setVoltandoDoMapa(false);
      // A cena é desmontada no celular (ver o `Scene3D` abaixo); marcá-la como
      // pendente garante a capa certa na volta.
      setReady(false);
      setModeloPronto(false);
    }
    setTela(destino);
  }

  /**
   * Espelho de vendas em 3D: só existe nas unidades e reflete o filtro. Com
   * uma unidade escolhida, o espelho ISOLA — só ela fica na cena.
   */
  const unitBoxes = useMemo(() => {
    if (!buscaMode || !building || !pavCfg || unidades.length === 0) return [];
    const isolando = !!unidadeSelId;
    return buildUnitBoxes({
      buildingId: building.id,
      unidades,
      torres,
      pavCfg,
      visiveis: isolando ? new Set([unidadeSelId as string]) : new Set(filtradas),
      selecionadaId: unidadeSelId,
      mostrarFantasmas: !isolando,
      // O modelo fica íntegro e são as caixas que ficam translúcidas.
      opacidade: 0.5,
    });
  }, [buscaMode, building, pavCfg, unidades, torres, filtradas, unidadeSelId]);

  /**
   * A experiência está pronta quando o projeto chegou, a cena montou e — se o
   * projeto tem modelo — o GLB terminou de carregar.
   */
  const temModelo = !!project?.data.config.modelUrl;
  const carregando = !project || !ready || (temModelo && !modeloPronto);
  useEffect(() => {
    if (!carregando) setVoltandoDoMapa(false);
  }, [carregando]);

  /** Segundos parado na capa — passado um tempo, a tela diz o que não chegou. */
  const [segundosCarregando, setSegundosCarregando] = useState(0);
  useEffect(() => {
    if (!carregando) return;
    const t = setInterval(() => setSegundosCarregando((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [carregando]);

  /**
   * Remonta a cena do zero pela `key` do `Scene3D`, sem recarregar a página e
   * jogar fora o projeto que já chegou.
   */
  const [tentativaCena, setTentativaCena] = useState(0);
  const recarregarCena = () => {
    setTilesError(null);
    setErroDeFotogrametria(false);
    setReady(false);
    setModeloPronto(false);
    setSegundosCarregando(0);
    // "Tentar de novo" é tentar o Google OUTRA VEZ.
    setSemFotogrametria(false);
    setTentativaCena((n) => n + 1);
  };

  /** Entrar no 3D com o entorno do PROJETO no lugar da cidade do Google. */
  const entrarSemFotogrametria = () => {
    setTilesError(null);
    setErroDeFotogrametria(false);
    setReady(false);
    setModeloPronto(false);
    setSegundosCarregando(0);
    setSemFotogrametria(true);
    setTentativaCena((n) => n + 1);
  };

  const etapaCarregamento = !project
    ? "Abrindo o empreendimento"
    : !ready
      ? "Carregando a fotogrametria"
      : "Carregando o modelo";

  // --- Conteúdo das seções ----------------------------------------------------
  const lazer = useMemo(() => {
    if (!emp) return [];
    // Amenidade repetida nos destaques não vira ambiente duas vezes.
    const destaques = new Set(normalizarLista(emp.highlights).map((h) => h.titulo.toLowerCase()));
    return normalizarLista(emp.amenities).filter((a) => !destaques.has(a.titulo.toLowerCase()));
  }, [emp]);
  const plantasGaleria = useMemo(
    () => (emp ? plantasDeTipologia(emp).map((p) => ({ url: p.url, legenda: p.area })) : []),
    [emp],
  );
  const temGaleria = !!emp && ((emp.galeria?.length ?? 0) + (emp.videos?.length ?? 0) + plantasGaleria.length > 0);
  const temPois = (emp?.pontosDeInteresse?.length ?? 0) > 0;

  const nav: ItemNav[] = [
    { id: "home", rotulo: "Home", icone: Home },
    { id: "projeto", rotulo: "Projeto", icone: ClipboardList },
    ...(lazer.length ? [{ id: "lazer" as const, rotulo: "Lazer", icone: Trees }] : []),
    ...(unidades.length ? [{ id: "unidades" as const, rotulo: "Unidades", icone: Building2 }] : []),
    ...(temPois ? [{ id: "local" as const, rotulo: "Localização", icone: MapPin }] : []),
    ...(temGaleria ? [{ id: "galeria" as const, rotulo: "Galeria", icone: Images }] : []),
  ];
  // O celular tem ordem e nomes próprios: sem Home, e "Entorno" no fim.
  const ordemMovel: Secao[] = ["projeto", "lazer", "unidades", "galeria", "local"];
  const navMovel = ordemMovel
    .map((id) => nav.find((n) => n.id === id))
    .filter((n): n is ItemNav => !!n)
    .map((n) => (n.id === "local" ? { ...n, rotulo: "Entorno" } : n));

  if (notFound) {
    return (
      <div className="vitrine flex h-[100dvh] items-center justify-center bg-[#101410] px-6 text-center">
        <p className="vd-rotulo text-[var(--vd-pedra)]">IVM Lite não encontrado ou não publicado.</p>
      </div>
    );
  }

  const cenaMontada = !!apiKey && !!building && !(mobileViewport && tela === "local");
  const telaClara = tela === "local" || tela === "comparar";
  const semErro = !tilesError && !semChave;

  return (
    <div className="vitrine relative h-[100dvh] w-full overflow-hidden bg-[#101410]">
      {cenaMontada && (
        <Scene3D
          /* Ver `recarregarCena`: trocar a chave é o que remonta a cena. */
          key={tentativaCena}
          ref={sceneRef}
          apiKey={apiKey as string}
          buildings={buildings}
          solarUtc={utcDate}
          solarAltitude={sun.altitude}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReady={() => setReady(true)}
          onModelLoading={(c) => { if (!c) setModeloPronto(true); }}
          /* Vitrine sem o prédio não é vitrine: falhar aqui vale a tela de
             erro, com o "Tentar de novo". */
          onModelError={(msg) => {
            setErroDeFotogrametria(false);
            setTilesError(`O modelo 3D do empreendimento não carregou. ${msg}`);
          }}
          onError={(msg) => {
            setErroDeFotogrametria(true);
            setTilesError(msg);
          }}
          unitBoxes={unitBoxes}
          onSelectUnit={(id) => setUnidadeSelId(id)}
          cidade={cidadeEfetiva}
          fotogrametria={!semFotogrametria}
          sombras={ambiente?.sombras}
          /* Composição do modo sem fotogrametria — só é desenhado ali. */
          mapaBase={mapaBase}
          /*
            Órbita em toda vista que OLHA DE FORA. Em `vista` a câmera está
            dentro da torre: com cidade, a navegação padrão do Cesium pivota no
            chão sob o cursor; sem cidade o buffer de profundidade está vazio e
            a órbita continua ligada, com o pivô à frente da câmera.
          */
          orbitar={modoFoco !== "vista" || !cidadeEfetiva}
          orbitaAlvo={{
            unidadeId: unidadeSelId,
            pavimentoZ: nivelAberto?.cutZ ?? null,
            torreXY: centroDaTorreAberta,
            naCamera: modoFoco === "vista",
          }}
          noturno={noturno}
          realceNoturno={ambiente?.realceNoturno}
          /* Na vitrine o recorte vale SEMPRE: não há edição a proteger. */
          recorteTerreno={project?.data.config.recorteTerreno ?? null}
          {...(() => {
            // A planta só deita no chão quando o nível aberto tem tudo.
            const n = nivelAberto;
            const pa = n?.plantaArea ?? n?.area;
            if (!building || !n?.plantaNoChao || !n.plantaUrl
              || n.cutZ == null || !pa) return { plantaPavimento: null };
            return {
              plantaPavimento: {
                buildingId: building.id,
                url: n.plantaUrl,
                area: pa,
                z: alturaDaPlanta(n)!,
                opacidade: n.plantaOpacidade,
              },
            };
          })()}
          /* Vias e superfícies existem para situar o prédio NO ENTORNO: sem a
             fotogrametria viram linhas boiando no vazio. */
          vias={cidadeEfetiva ? (project?.data.config.entorno?.vias ?? null) : null}
          corVia={project?.data.config.entorno?.corVia}
          superficies={cidadeEfetiva ? (project?.data.config.entorno?.superficies ?? null) : null}
          onCameraMove={setHeading}
        />
      )}

      {/* Escurecimento noturno: segue a hora do controle de luz. */}
      {com3D && semErro && (
        <div className="vd-noite" style={{ opacity: noite ? 1 : 0 }} aria-hidden="true" />
      )}

      {/* ---- Telas que cobrem a cena ---- */}
      {emp && semErro && tela === "lazer" && <LazerView itens={lazer} />}

      {emp && semErro && tela === "galeria" && (
        <GaleriaView
          imagens={emp.galeria ?? []}
          videos={emp.videos ?? []}
          plantas={plantasGaleria}
          ordemCategorias={emp.categoriasGaleria}
          onFechar={() => irPara("home")}
        />
      )}

      {emp && tela === "local" && (
        <LocalView
          emp={emp}
          centro={{ lat: building?.lat ?? emp.lat, lng: building?.lng ?? emp.lng }}
          nome={project?.name ?? emp.name}
          poiSelId={poiEntornoId}
          onPoiSel={setPoiEntornoId}
          onFoto={setFotoAmpliada}
          /* Pino e rota na cor da marca do projeto — a mesma do mapa de antes. */
          cor={brand.primary || "#2dd4bf"}
          onFechar={() => irPara("home")}
        />
      )}

      {emp && semErro && tela === "comparar" && (
        <ComparadorPlantas
          unidades={unidadesCompletas}
          ids={comparacao}
          torres={torres}
          logoUrl={brand.logoUrl}
          plantaDe={(u) => plantaDaUnidade(u, tipologias)}
          tourDe={(u) => tipologias.find((t) => t.id === u.tipologiaId || t.nome === u.tipologia)?.tour360Url}
          contatoDe={(u) => canaisDeContato(project?.data.config.contato, project?.name ?? "", u.numero)[0]}
          onTour={(url, titulo) => setTour360({ url, titulo })}
          onFechar={() => irPara("unidades")}
        />
      )}

      {/* ---- Sobre a cena: marca, ações, bússola, legenda do tour ---- */}
      {com3D && semErro && (
        <div className="pointer-events-none absolute left-5 top-5 z-30 max-w-[calc(100%-120px)]">
          <div className="vd-sombra-texto flex items-center gap-2.5">
            <Simbolo url={brand.logoUrl} tamanho={26} />
            <span className="vd-rotulo truncate">{project?.name}</span>
          </div>
          {tela === "home" && (
            <p className="vd-orbitar vd-micro vd-sombra-texto mt-2 !text-[9px] text-[var(--vd-pedra)]">
              Arraste para orbitar
            </p>
          )}
        </div>
      )}

      {com3D && semErro && ambiente?.mostrarBussola && (
        <Bussola heading={heading} onClick={() => sceneRef.current?.flyToCamera({
          ...(sceneRef.current.getCurrentCamera() ?? { lng: 0, lat: 0, height: 500, pitch: -30, roll: 0, heading: 0 }),
          heading: 0,
        }, 1)} />
      )}

      {tituloVista && tela === "home" && (
        /* Legenda de cinema, não controle: não engole cliques. */
        <div className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 px-4">
          <div key={tituloVista} className="v-titulo-vista text-center">
            <span className="vd-sombra-texto text-[clamp(16px,2.4vw,24px)] font-light uppercase tracking-[0.34em]">
              {tituloVista}
            </span>
          </div>
        </div>
      )}

      {com3D && semErro && (
        <div className="vd-acoes absolute right-5 top-5 z-40 flex items-center gap-2">
          <button type="button" onClick={irParaPrincipal} className="vd-acao"
            title="Voltar à vista principal" aria-label="Voltar à vista principal">
            <Home className="h-4 w-4" strokeWidth={1.5} />
          </button>
          {views.length > 0 && tela !== "unidades" && (
            <button type="button" onClick={alternarTour} className="vd-acao"
              data-on={tourAtivo ? "1" : undefined}
              title={tourAtivo ? "Parar o tour" : "Rodar o tour de vistas"}
              aria-label={tourAtivo ? "Parar o tour" : "Rodar o tour de vistas"}>
              {tourAtivo
                ? <Square className="h-3.5 w-3.5" strokeWidth={1.5} />
                : <Play className="h-4 w-4" strokeWidth={1.5} />}
            </button>
          )}
          {ambiente?.noturnoDisponivel && (
            <button type="button" onClick={alternarNoturno} className="vd-acao"
              data-on={noite ? "1" : undefined}
              title={noite ? "Voltar ao dia" : "Ver à noite"}
              aria-label={noite ? "Voltar ao dia" : "Ver à noite"}>
              <Moon className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          <button type="button" onClick={alternarTelaCheia} className="vd-acao"
            data-on={telaCheia ? "1" : undefined}
            title={telaCheia ? "Sair da tela cheia" : "Tela cheia"}
            aria-label={telaCheia ? "Sair da tela cheia" : "Tela cheia"}>
            {telaCheia
              ? <Minimize className="h-4 w-4" strokeWidth={1.5} />
              : <Maximize className="h-4 w-4" strokeWidth={1.5} />}
          </button>
          {/* Sem fotogrametria não há tileset a alternar: um botão que não faz
              nada faz a vitrine parecer travada. */}
          {!semFotogrametria && (
            <button type="button" onClick={() => setCidade3D((v) => !v)} className="vd-acao vd-acao-extra"
              data-on={cidade3D ? undefined : "1"}
              title={cidade3D
                ? (mapaBase ? "Trocar a fotogrametria pelo mini mapa (cena mais leve)" : "Esconder o entorno (cena mais leve)")
                : "Mostrar o entorno"}
              aria-label={cidade3D ? "Esconder o entorno" : "Mostrar o entorno"}>
              <Layers3 className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          {ambiente?.permitirScreenshot && (
            <button type="button" onClick={capturarTela} className="vd-acao vd-acao-extra"
              data-on={capturando ? "1" : undefined}
              title="Capturar a tela" aria-label="Capturar a tela">
              <Camera className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}

      {/* ---- Cartões das seções com 3D ---- */}
      {emp && semErro && tela === "projeto" && (
        <EmpreendimentoPanel emp={emp} unidades={unidades} onFechar={() => irPara("home")} />
      )}

      {project && semErro && tela === "unidades" && (
        <BuscadorUnidades3D
          sceneRef={sceneRef}
          projetoId={project.id}
          contato={project.data.config.contato}
          nomeEmpreendimento={project.name}
          unidades={unidades}
          tipologias={tipologias}
          torres={torres}
          pavCfg={pavCfg}
          niveis={project.data.config.niveis}
          onNivel={setNivelAberto}
          selecionadaId={unidadeSelId}
          onSelecionar={(u) => setUnidadeSelId(u?.id ?? null)}
          onModo={setModoFoco}
          onFiltrar={setFiltradas}
          comparacaoIds={comparacao}
          onComparacaoIds={setComparacao}
          onAbrirComparacao={() => irPara("comparar")}
          onTour={(url, titulo) => setTour360({ url, titulo })}
          onClose={() => irPara("home")}
        />
      )}

      {com3D && semErro && ambiente?.mostrarBarraSolar !== false && (
        <ClimaBar
          minutos={timeMinutes}
          onMinutos={setTimeMinutes}
          estacao={season}
          onEstacao={setSeason}
          sol={sun}
        />
      )}

      {/* ---- Navegação ---- */}
      {project && semErro && (
        <>
          <IlhaNav itens={nav} ativa={secao} onEscolher={irPara} claro={telaClara} />
          {tela !== "comparar" && <BarraMovel itens={navMovel} ativa={secao} onEscolher={irPara} />}
        </>
      )}

      {/* Foto do cartão do POI em tela cheia. */}
      {fotoAmpliada && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 p-6"
          onClick={() => setFotoAmpliada(null)}
        >
          <img src={fotoAmpliada} alt="" className="max-h-full max-w-full rounded-[6px] object-contain" />
        </div>
      )}

      <TourVirtual
        url={tour360?.url ?? ""}
        open={!!tour360}
        onClose={fecharTour360}
        nomeEmpreendimento={tour360?.titulo}
      />

      {/*
        Capa. Só sai quando a EXPERIÊNCIA está pronta, e isso inclui o GLB —
        senão o cliente via a cidade sem prédio e o empreendimento surgia do
        nada segundos depois.
      */}
      {carregando && !(mobileViewport && tela === "local") && semErro && (
        <div className={`absolute inset-0 flex items-center justify-center overflow-hidden bg-[#101410] ${voltandoDoMapa ? "z-[100]" : "z-[70]"}`}>
          {emp?.thumbnailUrl && !voltandoDoMapa && (
            <img src={emp.thumbnailUrl} alt="" aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-105 object-cover"
              style={{ filter: "blur(2px) brightness(.5)" }} />
          )}
          <div className="relative w-[min(88vw,420px)] text-center">
            {voltandoDoMapa ? (
              <>
                <Loader2 className="mx-auto mb-4 h-7 w-7 animate-spin text-[var(--vd-bronze)]" strokeWidth={1.5} />
                <p className="vd-rotulo">Carregando cena 3D</p>
              </>
            ) : (
              <>
                {brand.logoUrl && (
                  <div className="mb-6 flex justify-center">
                    <Simbolo url={brand.logoUrl} tamanho={52} alt={project?.name ?? ""} />
                  </div>
                )}
                <h1 className="mx-auto max-w-[16ch] text-[clamp(18px,1.9vw,24px)] font-light uppercase leading-[1.6] tracking-[0.34em]">
                  {project?.name ?? "IVM Lite"}
                </h1>
                {/* Barra indeterminada: o Cesium não dá progresso confiável, e um
                    número inventado é pior que nenhum. */}
                <div className="mx-auto mt-7 h-[2px] w-[196px] overflow-hidden bg-white/20"
                  role="progressbar" aria-label={etapaCarregamento}>
                  <div className="v-carregando h-full w-1/3 bg-[var(--vd-bronze)]" />
                </div>
                <p className="vd-micro mt-5 text-[var(--vd-pedra)]">
                  {emp?.neighborhood || etapaCarregamento}
                </p>

                {/*
                  Diagnóstico, acima do teto de espera da fotogrametria. Vive na
                  tela porque a vitrine roda em tablet de plantão — lá não há F12.
                */}
                {segundosCarregando >= TILES_TETO_MS / 1000 + 5 && (
                  <div className="vd-vidro mt-8 space-y-2 p-4 text-left">
                    <p className="vd-micro text-[var(--vd-pedra)]">
                      Parado há {segundosCarregando}s. O que falta:
                    </p>
                    {([
                      {
                        ok: !!project,
                        label: "Projeto",
                        dica: "não veio do banco — confira SUPABASE_URL e SUPABASE_ANON_KEY no deploy",
                      },
                      {
                        ok: ready,
                        label: "Cena 3D",
                        dica: "a fotogrametria do Google não chegou — quase sempre é a conexão; se persistir, confira GOOGLE_MAPS_API_KEY, se a Map Tiles API está ativa e se a restrição de domínio inclui este site",
                      },
                      {
                        ok: !temModelo || modeloPronto,
                        // O GLB só é pedido depois que a cena monta: enquanto
                        // `ready` for falso, ele não falhou — nem começou.
                        esperando: !ready,
                        label: "Modelo 3D",
                        dica: "o GLB não baixou — se a URL for do Supabase, o bucket ivm-assets precisa estar público",
                      },
                    ] as { ok: boolean; esperando?: boolean; label: string; dica: string }[]).map((c) => {
                      const emEspera = !c.ok && c.esperando;
                      return (
                        <p key={c.label} className={`text-[11px] leading-relaxed ${
                          c.ok || emEspera ? "vd-2" : "text-[#e3b98a]"}`}>
                          {c.ok ? "✓" : emEspera ? "·" : "✕"}{" "}
                          <span className="font-semibold">{c.label}</span>
                          {emEspera
                            ? <> — na fila, ainda não foi pedido</>
                            : !c.ok && <> — {c.dica}</>}
                        </p>
                      );
                    })}
                    {ready && temModelo && !modeloPronto && (
                      <p className="break-all text-[10px] vd-3">
                        modelo: {project?.data.config.modelUrl}
                      </p>
                    )}
                    <button type="button" onClick={recarregarCena} className="vd-btn vd-btn-vazado mt-3">
                      <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} /> Tentar de novo
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Chave do Google ausente: a cena nunca vai montar, então diz o porquê. */}
      {semChave && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-[#101410] p-4">
          <div className="vd-vidro max-w-md p-8 text-center">
            <h2 className="vd-rotulo mb-3">Experiência 3D indisponível</h2>
            <p className="vd-corpo vd-2">
              A chave do Google Maps não está configurada no servidor. Sem ela a
              fotogrametria não pode ser carregada.
            </p>
            <p className="mt-3 text-[11px] vd-3">
              Configure <code>GOOGLE_MAPS_API_KEY</code> no ambiente e recarregue.
            </p>
          </div>
        </div>
      )}

      {tilesError && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-[#101410] p-4">
          <div className="vd-vidro max-w-md p-8 text-center">
            <h2 className="vd-rotulo mb-3">Erro ao carregar o 3D</h2>
            <p className="vd-corpo vd-2">{tilesError}</p>
            <button type="button" onClick={recarregarCena} className="vd-btn vd-btn-vazado mx-auto mt-5">
              <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} /> Tentar de novo
            </button>

            {/*
              Saída alternativa quando SÓ a cidade do Google faltou: a maquete
              sem a cidade é incomparavelmente melhor que uma tela de erro na
              frente do cliente.
            */}
            {erroDeFotogrametria && (
              <>
                <button type="button" onClick={entrarSemFotogrametria} className="vd-btn vd-btn-bronze mx-auto mt-3">
                  <Layers3 className="h-3.5 w-3.5" strokeWidth={1.5} /> Entrar no 3D mesmo assim
                </button>
                <p className="mt-3 text-[11px] leading-relaxed vd-3">
                  O empreendimento e o entorno do projeto aparecem normalmente.
                  Só a cidade 3D do Google fica de fora.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
