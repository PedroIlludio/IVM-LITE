import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, Menu, Search, Home, Play, Square, Camera, Moon, SunMedium, Layers3 } from "lucide-react";
import Scene3D, { type Scene3DHandle } from "@/components/Scene3D";
import SolarBar from "@/components/SolarBar";
import EmpreendimentoPanel from "@/components/EmpreendimentoPanel";
import PavimentosView from "@/components/PavimentosView";
import BuscadorUnidades3D from "@/components/BuscadorUnidades3D";
import Bussola from "@/components/Bussola";
import {
  aplicarCrm,
  getProjectByPath,
  getProjectBySlug,
  projectAmbiente,
  projectPavCfg,
  projectToBuilding3D,
  projectTorres,
  type IvmProject,
} from "@/lib/ivm-store";
import type { Unidade } from "@/lib/unidades";
import { buildUnitBoxes } from "@/lib/unidades3d";
import { tocarTour, vistaPrincipal, type TourHandle } from "@/lib/tour";
import { plantasDoProjeto } from "@/lib/tipologias";
import { niveisDe, alturaDaPlanta, type NivelDef } from "@/lib/pavimentos";
import MapaEntorno from "@/components/MapaEntorno";
import { CartaoPoi } from "@/components/CartaoPoi";
import type { EditablePoi } from "@/lib/ivm-store";
import { getSunReadout, getSunTimesLocal, localToUtc, seasonDate, type Season } from "@/lib/solar";

/**
 * Página pública de um IVM Lite (projeto do Supabase): mesma experiência rica
 * do /explorar, porém com os dados vindos da plataforma.
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
   * O servidor respondeu, mas sem chave do Google.
   *
   * Sem isto a página ficava presa em "Carregando experiência 3D…" para sempre:
   * a cena nunca monta (o `apiKey` vazio é falsy), logo `ready` nunca vira
   * true, e nada na tela dizia o motivo. Uma variável de ambiente esquecida no
   * deploy transformava toda vitrine publicada numa animação infinita.
   */
  const [semChave, setSemChave] = useState(false);
  const [project, setProject] = useState<IvmProject | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tilesError, setTilesError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** O GLB terminou de carregar (ou o projeto não tem modelo a esperar). */
  const [modeloPronto, setModeloPronto] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [pavMode, setPavMode] = useState(false);
  const [buscaMode, setBuscaMode] = useState(false);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [unidadeSelId, setUnidadeSelId] = useState<string | null>(null);
  const [filtradas, setFiltradas] = useState<string[]>([]);
  const [season, setSeason] = useState<Season>("verao");
  const [timeMinutes, setTimeMinutes] = useState(780);
  /** Entorno: 3D ou mapa. Vive aqui porque o mapa ocupa o viewport. */
  const [modoEntorno, setModoEntorno] = useState<"3d" | "mapa">("3d");
  const [poiEntornoId, setPoiEntornoId] = useState<string | null>(null);
  /** Foto do cartão do POI aberta em tela cheia. */
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  /** Nível aberto na vista de pavimentos — de onde sai a planta no chão. */
  const [nivelAberto, setNivelAberto] = useState<NivelDef | null>(null);

  /**
   * Fotogrametria (a cidade em volta) ligada?
   *
   * O que pesa na cena é o streaming de tiles do Google, não o modelo do
   * empreendimento: são milhares de triângulos e texturas chegando pela rede a
   * cada movimento de câmera. Desligá-la deixa o prédio FLUTUANDO — leitura de
   * maquete — com o espelho de vendas, as sombras e a simulação solar
   * intactos.
   *
   * NÃO é lembrada entre visitas, de propósito. A altura do terreno sob o
   * empreendimento é medida CONTRA a fotogrametria: recarregar com ela já
   * desligada deixava o prédio sem referência de solo e ele nascia despencado,
   * como se viesse do infinito. Começar sempre com a cidade garante a medição;
   * desligar depois é seguro, porque a altura já foi resolvida.
   */
  const [cidade3D, setCidade3D] = useState(true);
  const alternarCidade3D = () => setCidade3D((v) => !v);

  const sceneRef = useRef<Scene3DHandle>(null);

  /**
   * A vitrine trava a rolagem da PÁGINA enquanto estiver aberta.
   *
   * Ela é uma tela cheia com painéis que rolam por dentro; a página em si não
   * tem por que deslizar. No tablet isso não era detalhe: a barra solar e os
   * botões do rodapé ficavam escondidos atrás da barra do navegador, e só
   * apareciam arrastando a tela — que ao mesmo tempo tirava a cena do lugar.
   *
   * Posto e retirado aqui, e não no CSS global, porque /admin e editor precisam
   * rolar normalmente.
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
   * Título da aba e metadados de compartilhamento, por PROJETO.
   *
   * O documento estático traz um título genérico — ele é o mesmo para /admin,
   * para o editor e para a vitrine de qualquer incorporadora, então não pode
   * carregar o nome de um empreendimento. Só aqui se sabe qual projeto está
   * aberto.
   *
   * Importa além da aba: é o que aparece quando o corretor manda o link no
   * WhatsApp. Com o nome fixo do piloto, todo projeto compartilhado anunciava
   * outro empreendimento, em outra cidade.
   */
  useEffect(() => {
    if (!project) return;
    const emp = project.data.empreendimento;
    const local = emp.neighborhood?.trim();
    const titulo = local ? `${project.name} | ${local}` : project.name;
    // `Empreendimento` não tem campo de descrição livre; o endereço é o que há
    // de mais próximo de uma frase útil no compartilhamento.
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

    /*
      O ÍCONE da aba não muda por projeto — é o símbolo da plataforma, um
      arquivo só em `/favicon.png`. Cheguei a trocá-lo pelo símbolo do
      empreendimento e estava errado: o favicon identifica a FERRAMENTA, e é o
      que faz o corretor reconhecer suas abas entre dezenas de outras. Quem
      identifica o empreendimento é o logo — na capa de carregamento, no painel
      e no marcador do mapa — e o título, logo acima.
    */

    // Sair da vitrine devolve o genérico: sem isto, navegar para o editor na
    // mesma aba deixava o nome do último projeto visitado no título.
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

  const building = useMemo(() => (project ? projectToBuilding3D(project.data) : null), [project]);
  const buildings = useMemo(() => (building ? [building] : []), [building]);
  const emps = useMemo(
    () => (project ? [project.data.empreendimento] : []),
    [project],
  );
  const tz = project?.data.config.tzOffset ?? -3;

  const utcDate = useMemo(() => {
    const [y, m, d] = seasonDate(season, new Date().getFullYear());
    return localToUtc(y, m, d, Math.floor(timeMinutes / 60), timeMinutes % 60, tz);
  }, [season, timeMinutes, tz]);

  const sun = useMemo(
    () => getSunReadout(utcDate, building?.lat ?? -8.9398, building?.lng ?? -35.1696),
    [utcDate, building],
  );
  const sunTimes = useMemo(
    () => getSunTimesLocal(utcDate, building?.lat ?? -8.9398, building?.lng ?? -35.1696, tz),
    [utcDate, building, tz],
  );

  // Identidade visual do projeto: aplicada via CSS vars + overrides escopados,
  // para os componentes existentes (que usam a paleta do Quinta) herdarem a
  // marca de cada IVM Lite sem refatoração.
  const brand = project?.data.config.branding ?? {};
  const brandBg = brand.bg || "#04141d";
  const brandPrimary = brand.primary || "#2dd4bf";

  const torres = useMemo(() => (project ? projectTorres(project.data) : []), [project]);

  const pavCfg = useMemo(() => (project ? projectPavCfg(project.data) : undefined), [project]);

  // --- Ambiente ---------------------------------------------------------------
  const ambiente = useMemo(() => (project ? projectAmbiente(project.data) : null), [project]);
  const [noturno, setNoturno] = useState(false);
  const [heading, setHeading] = useState(0);
  const [capturando, setCapturando] = useState(false);

  // Abre na luz definida no editor. Só na carga do projeto: depois disso quem
  // manda é o visitante (barra solar ou botão de noite).
  useEffect(() => {
    if (!ambiente) return;
    setTimeMinutes(ambiente.horaPadrao);
    setSeason(ambiente.estacaoPadrao as Season);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /** Dia/noite: além do realce da cena, move o relógio solar. */
  function alternarNoturno() {
    if (!ambiente) return;
    const indo = !noturno;
    setNoturno(indo);
    setTimeMinutes(indo ? ambiente.horaNoturna : ambiente.horaPadrao);
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
  /** Nome da vista em curso no tour — só o título, em destaque na cena. */
  const [tituloVista, setTituloVista] = useState<string | null>(null);
  const tourRef = useRef<TourHandle | null>(null);

  /**
   * Abre a experiência 3D de unidades — o mesmo destino, venha de onde vier.
   *
   * Havia três portas para cá (a barra, a gaveta e o clique numa unidade) e
   * cada uma fazia um subconjunto diferente do trabalho: só a de pavimentos
   * aplicava o enquadramento salvo, e a gaveta não mexia na câmera nenhuma —
   * clicar nela parecia não fazer nada, porque a cena continuava onde estava.
   */
  function abrirUnidades(unidadeId?: string) {
    pararTour();
    setModoEntorno("3d");
    setUnidadeSelId(unidadeId ?? null);
    // Antes de trocar de vista: a torre já aparece enquadrada quando a lista
    // abre, em vez de a câmera deslizar por baixo do painel depois.
    const cam = project?.data.config.cameraUnidades;
    if (cam) sceneRef.current?.flyToCamera(cam, 1.4);
    setBuscaMode(true);
    setPanelOpen(false);
  }

  function pararTour() {
    tourRef.current?.parar();
    tourRef.current = null;
    setTourAtivo(false);
    setTituloVista(null);
  }

  /**
   * Volta ao enquadramento de abertura. Usa a vista marcada como principal no
   * editor; se o projeto não tiver vistas salvas, apenas reenquadra o prédio.
   */
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
        // Título da vista em curso: é a legenda da cinemática. Sem ela o
        // visitante vê a câmera passear e não sabe o que está sendo mostrado —
        // "Fachada mar" e "Rooftop" são a diferença entre um voo bonito e uma
        // apresentação.
        aoEntrar: (vista) => setTituloVista(vista.name),
        aoTerminar: () => {
          tourRef.current = null;
          setTourAtivo(false);
          setTituloVista(null);
        },
      },
    );
  }

  // O tour move a câmera por temporizador: precisa parar ao entrar nos modos que
  // controlam a câmera por conta própria, e ao sair da página.
  useEffect(() => {
    if (pavMode || buscaMode) pararTour();
  }, [pavMode, buscaMode]);
  useEffect(() => () => tourRef.current?.parar(), []);

  /**
   * Espelho de vendas em 3D: só existe no modo busca e reflete o filtro atual.
   *
   * Com uma unidade escolhida, o espelho ISOLA: só ela fica na cena, colorida,
   * e as demais somem — inclusive as fantasmas. Uma unidade no meio de trezentas
   * caixas do mesmo tamanho não se distingue por realce nenhum; tirar as outras
   * da frente é o que efetivamente a mostra.
  */
  const unitBoxes = useMemo(() => {
    if (!buscaMode || !building || !pavCfg || unidades.length === 0) return [];
    const isolando = !!unidadeSelId;
    const boxes = buildUnitBoxes({
      buildingId: building.id,
      unidades,
      torres,
      pavCfg,
      visiveis: isolando ? new Set([unidadeSelId as string]) : new Set(filtradas),
      selecionadaId: unidadeSelId,
      mostrarFantasmas: !isolando,
      // O modelo fica íntegro (ver `aplicarAparenciaModelo`) e são as caixas
      // que ficam translúcidas: assim a fachada continua legível por trás
      // delas e o cliente enxerga em que altura e em que face a unidade está.
      // A escolhida volta a ser opaca — é a que ele quer ver.
      opacidade: 0.5,
    });
    return boxes;
  }, [buscaMode, building, pavCfg, unidades, torres, filtradas, unidadeSelId]);

  /**
   * A experiência está pronta quando: o projeto chegou, a cena montou e — se o
   * projeto tem modelo — o GLB terminou de carregar. Sem `modelUrl` não há o
   * que esperar, senão a capa nunca sairia num projeto que ainda não subiu o 3D.
   */
  const temModelo = !!project?.data.config.modelUrl;
  const carregando = !project || !ready || (temModelo && !modeloPronto);

  /**
   * Segundos parado na tela de carregamento.
   *
   * Serve ao diagnóstico: passado um tempo razoável, o que era "carregando"
   * vira "algo não chegou", e a tela precisa dizer O QUÊ. Sem isso a única
   * saída era o console do navegador — que num tablet não existe, e é onde a
   * vitrine mais roda em plantão de vendas.
   */
  const [segundosCarregando, setSegundosCarregando] = useState(0);
  useEffect(() => {
    if (!carregando) return;
    const t = setInterval(() => setSegundosCarregando((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [carregando]);

  const etapaCarregamento = !project
    ? "Abrindo o empreendimento..."
    : !ready
      ? "Carregando a fotogrametria..."
      : "Carregando o modelo do empreendimento...";

  if (notFound) {
    return (
      <div className="vitrine flex h-[100dvh] items-center justify-center bg-[var(--v-bg)] text-[var(--v-ink-2)]">
        IVM Lite não encontrado ou não publicado.
      </div>
    );
  }

  // Plantas da vitrine: tipologias (unidade) + níveis (pavimento), com o
  // `emp.plantas` legado só cobrindo o que sobrou. Ver `plantasDoProjeto`.
  const plantas = project
    ? plantasDoProjeto(
        project.data.empreendimento,
        niveisDe(project.data.config.pavimentosCfg ?? {}, project.data.config.niveis),
      )
    : [];

  return (
    <div
      className="vitrine ivm-brand relative h-[100dvh] w-full overflow-hidden"
      style={
        {
          background: brandBg,
          "--ivm-bg": brandBg,
          "--ivm-primary": brandPrimary,
          // O acento do sistema da vitrine vem da marca do projeto: um só
          // ponto de entrada, em vez de `text-teal-*` remapeado por !important.
          "--v-accent": brandPrimary,
          "--v-accent-soft": `color-mix(in srgb, ${brandPrimary} 12%, transparent)`,
          "--ivm-font-display": brand.fontDisplay || "",
          "--ivm-font-sans": brand.fontSans || "",
        } as React.CSSProperties
      }
    >
      {/* Marca do projeto: remapeia a paleta base (Quinta) para as cores/fontes
          deste IVM Lite, sem precisar refatorar cada componente. */}
      <style>{`
        .ivm-brand [class*="bg-[#04141d]"] {
          background-color: color-mix(in srgb, var(--ivm-bg) 90%, transparent) !important;
        }
        .ivm-brand .text-teal-300,
        .ivm-brand .text-teal-400,
        .ivm-brand .text-teal-500 { color: var(--ivm-primary) !important; }
        .ivm-brand .bg-teal-400,
        .ivm-brand .bg-teal-500,
        .ivm-brand [class*="bg-teal-500/"] { background-color: var(--ivm-primary) !important; }
        .ivm-brand .accent-teal-400 { accent-color: var(--ivm-primary) !important; }
        .ivm-brand [class*="ring-teal-"] { --tw-ring-color: var(--ivm-primary) !important; }
        ${brand.fontSans ? `.ivm-brand { font-family: ${brand.fontSans}, sans-serif; }` : ""}
        ${brand.fontDisplay ? `.ivm-brand .font-serif { font-family: ${brand.fontDisplay}, serif; }` : ""}
      `}</style>

      {apiKey && building && (
        <Scene3D
          ref={sceneRef}
          apiKey={apiKey}
          buildings={buildings}
          solarUtc={utcDate}
          solarAltitude={sun.altitude}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (id) setPanelOpen(true);
          }}
          onReady={() => setReady(true)}
          onModelLoading={(carregando) => { if (!carregando) setModeloPronto(true); }}
          onError={setTilesError}
          unitBoxes={unitBoxes}
          onSelectUnit={(id) => setUnidadeSelId(id)}
          cidade={cidade3D}
          /* Vitrine navega em órbita: arrasta e o prédio roda, roda dá zoom. */
          orbitar
          noturno={noturno}
          realceNoturno={ambiente?.realceNoturno}
          /* Na vitrine o recorte vale SEMPRE: não há edição a proteger. */
          recorteTerreno={project?.data.config.recorteTerreno ?? null}
          {...(() => {
            // A planta só entra quando o nível aberto tem tudo: desenho,
            // permissão de deitar no chão, cota e retângulo. Faltando qualquer
            // um, o pavimento segue como antes.
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
          /* Vias, superfícies e POIs acompanham a cidade: os três existem
             para situar o empreendimento NO ENTORNO, e sem a fotogrametria
             perdem o chão a que se referem — viram linhas e pinos boiando no
             vazio, pior que ausentes, porque parecem defeito. */
          vias={cidade3D ? (project?.data.config.entorno?.vias ?? null) : null}
          corVia={project?.data.config.entorno?.corVia}
          superficies={cidade3D ? (project?.data.config.entorno?.superficies ?? null) : null}
          onCameraMove={setHeading}
        />
      )}

      {/*
        Mapa do entorno NO VIEWPORT — por cima da cena 3D, não dentro do painel.
        São duas leituras do mesmo lugar disputando o mesmo palco: espremer o
        mapa num retângulo de 256px dentro da lateral desperdiçava justamente o
        que ele tem de melhor, que é a escala do entorno.
      */}
      {project && modoEntorno === "mapa" && (
        <div className="absolute inset-0 z-20">
          <MapaEntorno
            centro={{ lat: building?.lat ?? emps[0].lat, lng: building?.lng ?? emps[0].lng }}
            nomeCentro={project.name}
            pois={(project.data.empreendimento.pontosDeInteresse ?? []).map((p, i) => ({
              id: p.id ?? `poi-${i}`,
              name: p.name,
              categoria: p.categoria,
              lat: p.lat,
              lng: p.lng,
              rota: p.rota,
            }))}
            estiloCategorias={project.data.empreendimento.estiloCategoriaPoi}
            cor={brandPrimary}
            selecionadoId={poiEntornoId}
            onSelecionar={setPoiEntornoId}
            className="h-full w-full"
          />
        </div>
      )}

      {/* Bússola */}
      {project && modoEntorno !== "mapa" && !tilesError && ambiente?.mostrarBussola && (
        <Bussola heading={heading} onClick={() => sceneRef.current?.flyToCamera({
          ...(sceneRef.current.getCurrentCamera() ?? { lng: 0, lat: 0, height: 500, pitch: -30, roll: 0, heading: 0 }),
          heading: 0,
        }, 1)} />
      )}

      {project && !tilesError && !pavMode && !buscaMode && (
        <EmpreendimentoPanel
          empreendimentos={emps}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (id) setPanelOpen(true);
          }}
          isOpen={panelOpen}
          onToggle={() => setPanelOpen((o) => !o)}
          onFlyToPoi={(lat, lng, poi) => {
            pararTour();
            // Enquadramento escolhido no editor tem prioridade sobre o genérico.
            if (poi?.camera) sceneRef.current?.flyToCamera(poi.camera, 1.6);
            else sceneRef.current?.flyToPoi(lat, lng);
          }}
          onVerUnidades={() => abrirUnidades()}
          onOpenPavimentos={() => {
            // Nível anterior fora: sair e voltar da vista de pavimentos deixava
            // a planta do último andar deitada no chão do prédio inteiro.
            setNivelAberto(null);
            // Enquadramento das unidades antes de trocar de vista: a torre já
            // aparece posicionada quando a lista abre, em vez de a câmera
            // deslizar por baixo do painel depois.
            const cam = project?.data.config.cameraUnidades;
            if (cam) sceneRef.current?.flyToCamera(cam, 1.4);
            setPavMode(true);
          }}
          onSelectUnit={(id) => {
            abrirUnidades(id);
            setPanelOpen(false);
          }}
          unidades={unidades}
          torres={torres}
          logoUrl={brand.logoUrl}
          plantas={plantas}
          entorno={{
            modo: modoEntorno,
            onModo: setModoEntorno,
            poiSelId: poiEntornoId,
            onPoiSel: setPoiEntornoId,
            onEntrarEntorno: () => {
              const cam = project?.data.config.cameraEntorno;
              if (!cam) return;
              pararTour();
              sceneRef.current?.flyToCamera(cam, 1.6);
            },
          }}
        />
      )}

      {/*
        Título da vista do tour.

        Centralizado e alto, longe dos painéis: é legenda de cinema, não
        controle. Só o título, como pedido — duração, ordem e o resto do
        aparato do tour são coisa do editor; na vitrine seriam ruído sobre o que
        se está tentando mostrar.

        `pointer-events-none` porque ele passa por cima da cena: um retângulo
        invisível engolindo cliques no meio da tela seria pior que não ter
        legenda nenhuma.
      */}
      {tituloVista && !pavMode && !buscaMode && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 px-4">
          {/* `key` no título: reinicia a animação a cada vista, senão a
              transição só aconteceria na primeira. */}
          <div key={tituloVista} className="v-titulo-vista text-center">
            <span className="font-serif text-[clamp(18px,3.2vw,30px)] tracking-[0.14em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.75)]">
              {tituloVista.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/*
        Cartão do ponto de interesse, à direita.

        Fora das vistas que tomam o palco (`pavMode`, `buscaMode`): elas trocam
        a cena inteira, e o cartão de um ponto do entorno ficaria pairando sobre
        uma planta de pavimento sem relação nenhuma com ela.
      */}
      {project && !tilesError && !pavMode && !buscaMode && (
        <CartaoPoi
          poi={
            (project.data.empreendimento.pontosDeInteresse as unknown as EditablePoi[] | undefined)
              ?.find((p, i) => (p.id ?? `poi-${i}`) === poiEntornoId) ?? null
          }
          estilo={project.data.empreendimento.estiloCategoriaPoi}
          onFechar={() => setPoiEntornoId(null)}
          onFoto={setFotoAmpliada}
        />
      )}

      {/* Foto do cartão em tela cheia. */}
      {fotoAmpliada && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setFotoAmpliada(null)}
        >
          <img src={fotoAmpliada} alt=""
            className="max-h-full max-w-full rounded-[8px] object-contain" />
        </div>
      )}

      {project && !tilesError && pavMode && (
        <PavimentosView
          sceneRef={sceneRef}
          plantas={plantas}
          unidades={unidades}
          pavCfg={pavCfg}
          niveis={project.data.config.niveis}
          torres={torres}
          onNivel={setNivelAberto}
          onClose={() => {
            setPavMode(false);
            setNivelAberto(null);
            sceneRef.current?.cutAtFloor(null);
            sceneRef.current?.frameBuilding();
            // Volta para a gaveta, de onde se veio. Ver `abrirUnidades`.
            setPanelOpen(true);
          }}
        />
      )}

      {project && !tilesError && buscaMode && (
        <BuscadorUnidades3D
          sceneRef={sceneRef}
          projetoId={project.id}
          contato={project.data.config.contato}
          nomeEmpreendimento={project.name}
          unidades={unidades}
          plantas={plantas}
          tipologias={project.data.empreendimento.tipologias}
          torres={torres}
          pavCfg={pavCfg}
          niveis={project.data.config.niveis}
          onNivel={setNivelAberto}
          selecionadaId={unidadeSelId}
          onSelecionar={(u) => setUnidadeSelId(u?.id ?? null)}
          onFiltrar={setFiltradas}
          onClose={() => {
            setBuscaMode(false);
            setUnidadeSelId(null);
            // Sem isto a planta do último andar visitado ficava deitada no
            // prédio inteiro depois de fechar a busca.
            setNivelAberto(null);
            sceneRef.current?.cutAtFloor(null);
            sceneRef.current?.frameBuilding();
            /**
             * Reabre a gaveta.
             *
             * `abrirUnidades` fecha o painel para a busca ocupar a lateral, e
             * fechar a busca desfazia só metade do caminho: a categoria sumia e
             * a gaveta ficava fechada junto, deixando o visitante na cena nua
             * com a pastilha do menu no canto. O ✕ da categoria fecha a
             * CATEGORIA — quem fecha o painel é o painel.
             */
            setPanelOpen(true);
          }}
        />
      )}

      {/*
        Controles da cena. Ações com nome viram pastilhas; as de alternância
        viram botões redondos de ícone — a distinção de forma é o que permite
        achar o certo sem ler, e é a da referência.
      */}
      {!tilesError && modoEntorno !== "mapa" && !pavMode && !buscaMode && (
        <div className="absolute right-4 top-4 z-40 flex items-center gap-2">
          {/* Mostrar/esconder a fotogrametria. O prédio nunca some. */}
          <button
            onClick={alternarCidade3D}
            className="v-icon-btn"
            data-on={cidade3D ? undefined : "1"}
            title={cidade3D
              ? "Esconder o entorno (deixa o prédio isolado e a cena mais leve)"
              : "Mostrar o entorno"}
          >
            <Layers3 className="h-4 w-4" />
          </button>

          <button onClick={irParaPrincipal} title="Voltar à vista principal" className="v-pill">
            <Home className="h-4 w-4" />
            <span className="hidden sm:inline">Vista principal</span>
          </button>

          {views.length > 0 && (
            <button onClick={alternarTour} className="v-pill" data-on={tourAtivo ? "1" : undefined}
              title={tourAtivo ? "Parar o tour" : "Rodar o tour de vistas"}>
              {tourAtivo ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span className="hidden sm:inline">{tourAtivo ? "Parar" : "Tour"}</span>
            </button>
          )}

          {unidades.length > 0 && (
            <button
              onClick={() => abrirUnidades()}
              className="v-pill">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Buscar unidade</span>
            </button>
          )}

          {ambiente?.noturnoDisponivel && (
            <button onClick={alternarNoturno} className="v-icon-btn" data-on={noturno ? "1" : undefined}
              title={noturno ? "Voltar ao dia" : "Ver à noite"}>
              {noturno ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          )}

          {ambiente?.permitirScreenshot && (
            <button onClick={capturarTela} className="v-icon-btn" data-on={capturando ? "1" : undefined}
              title="Capturar a tela">
              <Camera className="h-4 w-4" />
            </button>
          )}

        </div>
      )}

      {!tilesError && !pavMode && !buscaMode && !panelOpen && (
        <button onClick={() => setPanelOpen(true)} className="v-pill absolute left-4 top-4 z-40">
          <Menu className="h-4 w-4" />
          <span className="max-w-[42vw] truncate">{project?.name ?? "Detalhes"}</span>
        </button>
      )}

      {!tilesError && modoEntorno !== "mapa" && !pavMode && !buscaMode && ambiente?.mostrarBarraSolar !== false && (
        <SolarBar
          timeMinutes={timeMinutes}
          onTimeChange={(v) => {
            setTimeMinutes(v);
            // Mexer na hora à mão sai do modo noturno: quem manda passa a ser
            // o visitante, e o botão não pode continuar dizendo "é noite".
            if (noturno) setNoturno(false);
          }}
          season={season}
          onSeasonChange={setSeason}
          sun={sun}
          sunriseMin={sunTimes.sunriseMin}
          sunsetMin={sunTimes.sunsetMin}
        />
      )}

      {/*
        A capa só sai quando a EXPERIÊNCIA está pronta, e isso inclui o GLB.

        Antes ela saía com `ready`, que é só "o viewer existe" — coisa de
        milissegundos. O cliente via a fotogrametria sem prédio nenhum e o
        empreendimento surgia do nada segundos depois. Agora o modelo é parte
        da conta; um projeto sem `modelUrl` não espera por nada.
      */}
      {carregando && !tilesError && !semChave && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--v-bg)]">
          <div className="w-[min(88vw,320px)] text-center">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={project?.name ?? ""} className="mx-auto mb-6 h-20 w-auto" />
            ) : (
              <Loader2 className="mx-auto mb-6 h-10 w-10 animate-spin text-[var(--v-accent)]" />
            )}
            <h1 className="mb-2 font-serif text-2xl tracking-[0.2em] text-white">
              {project?.name ?? "IVM Lite"}
            </h1>
            {/* A etapa dita a frase: um modelo de 23 MB numa conexão de plantão
                leva dezenas de segundos, e "carregando" genérico por tanto tempo
                se lê como travado. */}
            <p className="v-eyebrow">{etapaCarregamento}</p>
            {/* Barra indeterminada: não há progresso confiável do Cesium para
                mostrar percentual, e um número inventado é pior que nenhum. */}
            <div className="mx-auto mt-5 h-[3px] w-40 overflow-hidden rounded-full bg-white/10">
              <div className="v-carregando h-full w-1/3 rounded-full bg-[var(--v-accent)]" />
            </div>

            {/*
              Diagnóstico, depois de 15s.

              Passado esse tempo o que se vê não é mais "carregando", é "algo
              não chegou" — e a barra girando some com a informação de qual das
              três etapas falhou. Cada linha aqui é uma das condições de
              `carregando`, com o dado que permite agir: variável de ambiente
              faltando, tile do Google recusado, GLB que não baixa.

              Vive na tela, e não no console, porque a vitrine roda em tablet no
              plantão de vendas — lá não há F12.
            */}
            {segundosCarregando >= 15 && (
              <div className="mt-8 space-y-2 text-left">
                <p className="v-eyebrow text-[var(--v-ink-3)]">
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
                    dica: "a fotogrametria do Google não montou — confira GOOGLE_MAPS_API_KEY, se a Map Tiles API está ativa e se a restrição de domínio inclui este site",
                  },
                  {
                    ok: !temModelo || modeloPronto,
                    label: "Modelo 3D",
                    dica: "o GLB não baixou — se a URL for do Supabase, o bucket ivm-assets precisa estar público",
                  },
                ] as { ok: boolean; label: string; dica: string }[]).map((c) => (
                  <p key={c.label} className={`text-[11px] leading-relaxed ${
                    c.ok ? "text-[var(--v-ink-3)]" : "text-amber-300"}`}>
                    {c.ok ? "✓" : "✕"} <span className="font-semibold">{c.label}</span>
                    {!c.ok && <> — {c.dica}</>}
                  </p>
                ))}
                {temModelo && !modeloPronto && (
                  <p className="break-all text-[10px] text-[var(--v-ink-3)]">
                    modelo: {project?.data.config.modelUrl}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chave do Google ausente: a cena nunca vai montar, então diz o porquê
          em vez de girar para sempre. */}
      {semChave && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--v-bg)] p-4">
          <div className="v-panel max-w-md p-8 text-center">
            <h2 className="mb-2 font-semibold text-white">Experiência 3D indisponível</h2>
            <p className="text-sm text-[var(--v-ink-2)]">
              A chave do Google Maps não está configurada no servidor. Sem ela a
              fotogrametria não pode ser carregada.
            </p>
            <p className="mt-3 text-xs text-[var(--v-ink-3)]">
              Configure <code>GOOGLE_MAPS_API_KEY</code> no ambiente e recarregue.
            </p>
          </div>
        </div>
      )}

      {tilesError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--v-bg)] p-4">
          <div className="v-panel max-w-md p-8 text-center">
            <h2 className="mb-2 font-semibold text-white">Erro ao carregar o 3D</h2>
            <p className="text-sm text-[var(--v-ink-2)]">{tilesError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
