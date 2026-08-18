import { useEffect, useRef, useState } from "react";
// maplibre-gl v6 nao tem export default: so nomeados.
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  LngLatBounds,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot, type Root } from "react-dom/client";
import { Loader2, AlertTriangle } from "lucide-react";
import { corDaCategoriaPoi, iconeDaCategoria, type EstiloPoi } from "@/lib/poi-icones";

/**
 * Basemap: OpenFreeMap, estilo Positron.
 *
 * Trocamos o Google por isto por três motivos, nessa ordem: é MINIMALISTA E
 * CLARO de fábrica (o Positron é o basemap cinza-claro do CARTO, feito para
 * sumir por baixo do conteúdo — no Google era preciso desligar POIs, trânsito e
 * ícones na mão e ainda sobrava ruído); não pede chave, registro nem cartão; e
 * não tem limite de requisições. A atribuição do OSM é obrigatória e o MapLibre
 * a coloca sozinho.
 */
const ESTILO_POSITRON = "https://tiles.openfreemap.org/styles/positron";

export interface PoiDoMapa {
  id: string;
  name: string;
  categoria: string;
  lat: number;
  lng: number;
  /** Traçado já calculado e guardado no projeto (`[lng, lat][]`). */
  rota?: [number, number][];
}

interface Props {
  centro: { lat: number; lng: number };
  nomeCentro?: string;
  pois: PoiDoMapa[];
  /** Estilo (ícone/cor) por categoria, definido no editor. */
  estiloCategorias?: EstiloPoi;
  /** Cor do empreendimento e do traçado — a da marca do projeto. */
  cor?: string;
  selecionadoId?: string | null;
  onSelecionar?: (id: string | null) => void;
  /** Modo edição: pinos arrastáveis e clique no mapa reposiciona o escolhido. */
  editavel?: boolean;
  onMoverPoi?: (id: string, lat: number, lng: number) => void;
  /**
   * Traçado em edição — o eixo de uma via.
   *
   * Fica aqui, e não na cena 3D, pelo mesmo motivo dos POIs: no mapa a rua está
   * DESENHADA, com nome e esquina, e o traçado acompanha o arruamento real. Na
   * fotogrametria seria adivinhar onde a rua passa por baixo das árvores.
   */
  tracado?: { lat: number; lng: number }[];
  /** Anel fechado (contorno de área) em vez de linha aberta (eixo de via). */
  fechado?: boolean;
  editandoTracado?: boolean;
  onTracado?: (pontos: { lat: number; lng: number }[]) => void;
  className?: string;
}

/** Pino: círculo na cor da categoria com o ícone dela dentro. */
function Pino({ categoria, estilo, ativo }: {
  categoria: string; estilo?: EstiloPoi; ativo?: boolean;
}) {
  const Icone = iconeDaCategoria(categoria, estilo);
  const cor = corDaCategoriaPoi(categoria, estilo);
  return (
    <span
      className="flex items-center justify-center rounded-full border-2 border-white transition-transform"
      style={{
        width: ativo ? 34 : 26,
        height: ativo ? 34 : 26,
        background: cor,
        boxShadow: "0 1px 3px rgba(0,0,0,.35)",
        cursor: "pointer",
      }}
    >
      <Icone className="text-white" style={{ width: ativo ? 17 : 13, height: ativo ? 17 : 13 }} />
    </span>
  );
}

/**
 * Mapa 2D do entorno — MapLibre sobre OpenFreeMap.
 *
 * Serve às duas pontas: na vitrine é leitura (onde as coisas estão e como se
 * chega) e no editor é escrita (arrastar o pino para o lugar certo). Mesma
 * cena, permissões diferentes — dois componentes divergiriam no primeiro
 * ajuste de estilo.
 *
 * A ROTA não é calculada aqui: vem pronta em `poi.rota`, gravada no projeto
 * pelo editor. Ver o comentário de `PontoDeInteresse.rota`.
 */
export default function MapaEntorno({
  centro, nomeCentro, pois, estiloCategorias, cor = "#12a19a",
  selecionadoId, onSelecionar, editavel, onMoverPoi,
  tracado, fechado = false, editandoTracado, onTracado, className = "",
}: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const marcadores = useRef<Map<string, { m: Marker; raiz: Root }>>(new Map());
  /** Alças dos vértices do traçado, recriadas a cada mudança da lista. */
  const vertices = useRef<Marker[]>([]);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * Segundos esperando o mapa carregar.
   *
   * O MapLibre avisa por `error` quando a requisição FALHA, mas não quando ela
   * simplesmente não volta — servidor de tiles lento, rede do plantão, DNS
   * preso. Nesse caso não há `load` nem `error`: fica o giro eterno, sem uma
   * palavra sobre o que se espera. O contador transforma isso em informação.
   */
  const [esperando, setEsperando] = useState(0);
  useEffect(() => {
    if (pronto || erro) return;
    const t = setInterval(() => setEsperando((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pronto, erro]);
  const [rotaCalculada, setRotaCalculada] = useState<{
    chave: string;
    coordenadas: [number, number][];
  } | null>(null);

  // Callbacks em ref: os marcadores são criados uma vez e os ouvintes
  // registrados neles veriam para sempre a primeira versão da função.
  const onSelRef = useRef(onSelecionar);
  const onMoverRef = useRef(onMoverPoi);
  onSelRef.current = onSelecionar;
  onMoverRef.current = onMoverPoi;
  const onTracadoRef = useRef(onTracado);
  onTracadoRef.current = onTracado;
  const tracadoRef = useRef(tracado);
  tracadoRef.current = tracado;

  // --- Mapa (uma vez) --------------------------------------------------------
  useEffect(() => {
    const div = divRef.current;
    if (!div) return;

    // Coordenada inválida deixa o MapLibre num estado silencioso: ele monta,
    // não desenha nada e não reclama. Vale checar antes de culpar a rede.
    if (!Number.isFinite(centro.lat) || !Number.isFinite(centro.lng)) {
      setErro("Empreendimento sem coordenada definida.");
      return;
    }

    const map = new MapLibreMap({
      container: div,
      style: ESTILO_POSITRON,
      center: [centro.lng, centro.lat],
      zoom: 13.5,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setPronto(true));
    // Sem isto uma falha de estilo/tile some em silêncio e o mapa fica branco.
    map.on("error", (e) => {
      const msg = (e as { error?: { message?: string } })?.error?.message ?? "erro desconhecido";
      console.error("[MapaEntorno]", e);
      setErro(msg);
    });
    mapRef.current = map;

    /**
     * O MapLibre mede o container UMA vez, na criação. Quando ele nasce dentro
     * de algo que ainda está abrindo — a seção recolhida do editor, o painel
     * com animação de entrada — a medida é zero e o mapa fica em branco para
     * sempre, mesmo depois do container ganhar tamanho. O observador refaz a
     * medida a cada mudança.
     */
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(div);

    /**
     * Marcador do empreendimento: um PIN, não uma bolinha.
     *
     * A bolinha empatava visualmente com os pontos de interesse — mesma forma,
     * só outra cor — e o empreendimento é a origem de tudo o que o mapa mostra:
     * as distâncias e as rotas partem dele. Um pin com haste e sombra tem
     * silhueta própria, aponta para um lugar exato em vez de cobrir uma área, e
     * se lê como "aqui" à primeira vista.
     *
     * SVG inline, sem imagem: acompanha a cor da marca do projeto sem gerar
     * arquivo por cor, e escala sem borrar em tela de alta densidade.
     *
     * `anchor: "bottom"` porque a ponta do pin é que marca a coordenada — com o
     * padrão (centro) ele ficaria meio quarteirão acima do prédio.
     */
    const el = document.createElement("div");
    el.style.cssText = "width:30px;height:40px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.45))";
    el.title = nomeCentro ?? "";
    el.innerHTML = `
      <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="pinLuz" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#fff" stop-opacity=".45"/>
            <stop offset="55%" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="M15 39.2C15 39.2 28 24.6 28 14.6A13 13 0 1 0 2 14.6C2 24.6 15 39.2 15 39.2Z"
              fill="${cor}" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
        <path d="M15 39.2C15 39.2 28 24.6 28 14.6A13 13 0 1 0 2 14.6C2 24.6 15 39.2 15 39.2Z"
              fill="url(#pinLuz)"/>
        <circle cx="15" cy="14.4" r="4.6" fill="#fff"/>
      </svg>`;
    new Marker({ element: el, anchor: "bottom" })
      .setLngLat([centro.lng, centro.lat])
      .addTo(map);

    return () => {
      ro.disconnect();
      marcadores.current.forEach(({ m, raiz }) => {
        m.remove();
        // Desmonta fora do ciclo de render do React (aviso de "unmount durante render").
        setTimeout(() => raiz.unmount(), 0);
      });
      marcadores.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O centro pode mudar (o editor move o empreendimento).
  useEffect(() => {
    if (pronto) mapRef.current?.setCenter([centro.lng, centro.lat]);
  }, [pronto, centro.lat, centro.lng]);

  // --- Pinos dos POIs --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map) return;

    const vistos = new Set<string>();
    for (const p of pois) {
      vistos.add(p.id);
      let reg = marcadores.current.get(p.id);
      if (!reg) {
        const el = document.createElement("div");
        const raiz = createRoot(el);
        const m = new Marker({ element: el, draggable: !!editavel })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelRef.current?.(p.id);
        });
        m.on("dragend", () => {
          const { lng, lat } = m.getLngLat();
          onMoverRef.current?.(p.id, lat, lng);
        });
        reg = { m, raiz };
        marcadores.current.set(p.id, reg);
      }
      reg.m.setLngLat([p.lng, p.lat]);
      reg.m.setDraggable(!!editavel);
      reg.raiz.render(
        <Pino categoria={p.categoria} estilo={estiloCategorias} ativo={selecionadoId === p.id} />,
      );
    }

    marcadores.current.forEach((reg, id) => {
      if (vistos.has(id)) return;
      reg.m.remove();
      setTimeout(() => reg.raiz.unmount(), 0);
      marcadores.current.delete(id);
    });
  }, [pronto, pois, selecionadoId, editavel, estiloCategorias]);

  // --- Traçado do POI selecionado -------------------------------------------
  useEffect(() => {
    const alvo = pois.find((p) => p.id === selecionadoId);
    if (!alvo || alvo.rota?.length) {
      setRotaCalculada(null);
      return;
    }

    const chave = [centro.lng, centro.lat, alvo.lng, alvo.lat].join(":");
    const controller = new AbortController();
    const params = new URLSearchParams({
      fromLng: String(centro.lng),
      fromLat: String(centro.lat),
      toLng: String(alvo.lng),
      toLat: String(alvo.lat),
    });

    setRotaCalculada(null);
    fetch(`/api/route?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Rota indisponível (${response.status})`);
        return response.json() as Promise<{ coordinates: [number, number][] }>;
      })
      .then(({ coordinates }) => {
        if (coordinates.length >= 2) setRotaCalculada({ chave, coordenadas: coordinates });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[MapaEntorno] falha ao calcular rota:", error);
      });

    return () => controller.abort();
  }, [selecionadoId, pois, centro.lat, centro.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map) return;
    const alvo = pois.find((p) => p.id === selecionadoId);
    // Sem rota gravada, a linha reta ainda comunica direção e distância —
    // melhor do que nada enquanto o traçado não foi calculado no editor.
    const chave = alvo ? [centro.lng, centro.lat, alvo.lng, alvo.lat].join(":") : "";
    const calculada = rotaCalculada?.chave === chave ? rotaCalculada.coordenadas : undefined;
    const linha: [number, number][] = alvo
      ? alvo.rota?.length
        ? alvo.rota
        : calculada?.length
          ? calculada
          : [[centro.lng, centro.lat], [alvo.lng, alvo.lat]]
      : [];
    const tracada = !!alvo?.rota?.length || !!calculada?.length;
    const dados = {
      type: "Feature" as const,
      properties: { tracada },
      geometry: { type: "LineString" as const, coordinates: linha },
    };

    const src = map.getSource("rota") as GeoJSONSource | undefined;
    if (src) {
      src.setData(dados);
    } else {
      map.addSource("rota", { type: "geojson", data: dados });
      map.addLayer({
        id: "rota",
        type: "line",
        source: "rota",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": cor,
          "line-width": 5,
          "line-opacity": 0.9,
          // Tracejado quando é linha reta: o visitante precisa saber que
          // aquilo é direção, não o caminho que o carro faz.
          "line-dasharray": ["case", ["get", "tracada"], ["literal", [1, 0]], ["literal", [2, 1.6]]],
        },
      });
    }

    if (alvo) {
      const b = new LngLatBounds();
      linha.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 56, maxZoom: 15, duration: 700 });
    }
  }, [pronto, selecionadoId, pois, centro.lat, centro.lng, cor, rotaCalculada]);

  // --- Clique no mapa reposiciona o POI selecionado (só no editor) ------------
  useEffect(() => {
    const map = mapRef.current;
    // Traçando uma via, o clique pertence a ELA: mover um POI sem querer no
    // meio do traçado seria um estrago silencioso.
    if (!pronto || !editavel || !map || editandoTracado) return;
    const aoClicar = (e: MapMouseEvent) => {
      if (!selecionadoId) return;
      onMoverRef.current?.(selecionadoId, e.lngLat.lat, e.lngLat.lng);
    };
    map.on("click", aoClicar);
    return () => { map.off("click", aoClicar); };
  }, [pronto, editavel, selecionadoId, editandoTracado]);

  // --- Traçado da via: linha + vértices arrastáveis ---------------------------
  const chaveTracado = JSON.stringify(tracado ?? []);
  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map) return;
    const base = tracado ?? [];
    // Fecha o anel só para DESENHAR. Repetir o primeiro ponto nos dados faria o
    // usuário ganhar um vértice fantasma arrastável em cima de outro.
    const pts = fechado && base.length >= 3 ? [...base, base[0]] : base;
    const dados = {
      type: "FeatureCollection" as const,
      features: pts.length >= 2
        ? [{
            type: "Feature" as const,
            properties: {},
            geometry: {
              type: "LineString" as const,
              coordinates: pts.map((p) => [p.lng, p.lat] as [number, number]),
            },
          }]
        : [],
    };
    const src = map.getSource("tracado") as GeoJSONSource | undefined;
    if (src) { src.setData(dados); return; }
    map.addSource("tracado", { type: "geojson", data: dados });
    map.addLayer({
      id: "tracado-linha",
      type: "line",
      source: "tracado",
      paint: { "line-color": "#f59e0b", "line-width": 4, "line-opacity": 0.9 },
    });
  }, [pronto, chaveTracado, tracado, fechado]);

  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map) return;
    // Recria a cada mudança: são poucos pontos, e reconciliar por índice
    // custaria mais — remover um vértice desloca todos os seguintes, e é aí
    // que a reconciliação por posição erra.
    vertices.current.forEach((m) => m.remove());
    vertices.current = [];
    if (!editandoTracado) return;

    (tracado ?? []).forEach((p, i) => {
      const el = document.createElement("div");
      el.style.cssText =
        "width:13px;height:13px;border-radius:999px;background:#f59e0b;" +
        "border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:grab";
      el.title = `Ponto ${i + 1} — arraste para mover, botão direito remove`;
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const atual = tracadoRef.current ?? [];
        onTracadoRef.current?.(atual.filter((_, j) => j !== i));
      });
      const m = new Marker({ element: el, draggable: true })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      m.on("dragend", () => {
        const { lat, lng } = m.getLngLat();
        const atual = tracadoRef.current ?? [];
        onTracadoRef.current?.(atual.map((q, j) => (j === i ? { lat, lng } : q)));
      });
      vertices.current.push(m);
    });

    return () => {
      vertices.current.forEach((m) => m.remove());
      vertices.current = [];
    };
  }, [pronto, editandoTracado, chaveTracado, tracado]);

  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map || !editandoTracado) return;
    const aoClicar = (e: MapMouseEvent) => {
      const atual = tracadoRef.current ?? [];
      onTracadoRef.current?.([...atual, { lat: e.lngLat.lat, lng: e.lngLat.lng }]);
    };
    map.on("click", aoClicar);
    return () => { map.off("click", aoClicar); };
  }, [pronto, editandoTracado]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* O container do MapLibre precisa existir e ter tamanho SEMPRE — se ele
          for trocado por uma mensagem de erro, a instância perde o elemento e
          nem uma nova tentativa funciona. Erro e carregando vão por cima. */}
      <div ref={divRef} className="absolute inset-0" />
      {erro && (
        <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 bg-[var(--v-surface-3)] p-6 text-center">
          <AlertTriangle className="h-5 w-5 text-[var(--v-ink-3)]" />
          <p className="v-meta">Não foi possível desenhar o mapa.</p>
          <p className="v-meta font-mono text-[11px] opacity-70">{erro}</p>
        </div>
      )}
      {!pronto && !erro && (
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-[var(--v-surface-3)] p-6 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--v-ink-3)]" />
          {/* Passados 12s não é mais "carregando", é "não veio" — e a tela
              precisa dizer de ONDE não veio. Sem isto o diagnóstico dependia do
              console, que não existe no tablet do plantão. */}
          {esperando >= 12 && (
            <>
              <p className="v-meta">
                O mapa não respondeu em {esperando}s.
              </p>
              <p className="v-meta font-mono text-[10px] leading-relaxed opacity-70">
                tiles.openfreemap.org
              </p>
              <p className="v-meta max-w-[38ch] text-[11px] opacity-70">
                É um serviço externo de mapas, sem chave e sem conta. Se ele
                estiver fora do ar ou bloqueado nesta rede, o mapa não desenha —
                o 3D não depende dele.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
