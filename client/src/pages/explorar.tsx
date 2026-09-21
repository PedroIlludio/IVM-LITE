import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Menu } from "lucide-react";
import Scene3D, { type Scene3DHandle } from "@/components/Scene3D";
import SolarBar from "@/components/SolarBar";
import EmpreendimentoPanel from "@/components/EmpreendimentoPanel";
import PavimentosView from "@/components/PavimentosView";
import { empreendimentos } from "@/lib/empreendimentos";
import { getAllBuildings3D, MARAGOGI_TZ_OFFSET } from "@/lib/vision3d-config";
import { loadPlacements, type Placements } from "@/lib/placements";
import { getSunReadout, localToUtc, seasonDate, type Season } from "@/lib/solar";

export default function ExplorarPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [placements, setPlacements] = useState<Placements>({});
  const [configError, setConfigError] = useState<string | null>(null);
  const [tilesError, setTilesError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [pavMode, setPavMode] = useState(false);
  const [season, setSeason] = useState<Season>("verao");
  const [timeMinutes, setTimeMinutes] = useState(780); // 13:00

  const sceneRef = useRef<Scene3DHandle>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        const key = d.googleMapsApiKey as string;
        if (!key) setConfigError("Chave do Google Maps não configurada no servidor.");
        else setApiKey(key);
      })
      .catch(() => setConfigError("Falha ao buscar configuração do servidor."));
    loadPlacements().then(setPlacements);
  }, []);

  // Projeto de empreendimento único: já abre direto na página do Quinta
  // (sem passar por um menu de seleção).
  useEffect(() => {
    if (empreendimentos.length === 1) setSelectedId(empreendimentos[0].id);
  }, []);

  const buildings = useMemo(() => getAllBuildings3D(placements), [placements]);
  const selected = useMemo(
    () => buildings.find((b) => b.id === selectedId) ?? null,
    [buildings, selectedId],
  );

  const utcDate = useMemo(() => {
    const [y, m, d] = seasonDate(season, new Date().getFullYear());
    return localToUtc(y, m, d, Math.floor(timeMinutes / 60), timeMinutes % 60, MARAGOGI_TZ_OFFSET);
  }, [season, timeMinutes]);

  const sun = useMemo(() => {
    const ref = selected ?? buildings[0];
    return getSunReadout(utcDate, ref?.lat ?? -8.9398, ref?.lng ?? -35.1696);
  }, [utcDate, selected, buildings]);

  const error = configError || tilesError;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#04141d]">
      {apiKey && (
        <Scene3D
          ref={sceneRef}
          apiKey={apiKey}
          buildings={buildings}
          solarUtc={utcDate}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (id) setPanelOpen(true);
          }}
          onReady={() => setReady(true)}
          onError={setTilesError}
        />
      )}

      {/* Painel rico de empreendimentos (lista + detalhes + POIs) */}
      {!error && !pavMode && (
        <EmpreendimentoPanel
          empreendimentos={empreendimentos}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (id) setPanelOpen(true);
          }}
          isOpen={panelOpen}
          onToggle={() => setPanelOpen((o) => !o)}
          onFlyToPoi={(lat, lng) => sceneRef.current?.flyToPoi(lat, lng)}
          onOpenPavimentos={() => setPavMode(true)}
        />
      )}

      {/* Modo Pavimentos 3D (corte + vista por andar) */}
      {!error && pavMode && (
        <PavimentosView
          sceneRef={sceneRef}
          plantas={empreendimentos[0].plantas
            .filter((p) => p.imagemUrl)
            .map((p) => ({ area: p.area, url: p.imagemUrl as string }))}
          onClose={() => {
            setPavMode(false);
            sceneRef.current?.cutAtFloor(null);
            sceneRef.current?.frameBuilding();
          }}
        />
      )}

      {/* Reabrir painel quando fechado */}
      {!error && !pavMode && !panelOpen && (
        <button
          onClick={() => setPanelOpen(true)}
          className="absolute left-4 top-4 z-40 flex items-center gap-2 rounded-lg bg-[#04141d]/85 px-3 py-2 text-sm text-white shadow-lg ring-1 ring-white/10 backdrop-blur"
        >
          <Menu className="h-4 w-4 text-teal-400" /> Quinta das Mangueiras
        </button>
      )}

      {/* Solar */}
      {!error && !pavMode && (
        <SolarBar
          timeMinutes={timeMinutes}
          onTimeChange={setTimeMinutes}
          season={season}
          onSeasonChange={setSeason}
          sun={sun}
        />
      )}

      {/* Loading */}
      {!ready && !error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#04141d]/90">
          <div className="text-center">
            <Loader2 className="mx-auto mb-6 h-10 w-10 animate-spin text-teal-500" />
            <h1 className="mb-2 text-2xl font-serif tracking-[0.2em] text-white">Quinta das Mangueiras</h1>
            <p className="text-xs uppercase tracking-widest text-white/40">
              Carregando experiência 3D...
            </p>
          </div>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#04141d] p-4">
          <div className="max-w-md rounded-xl bg-white/5 p-8 text-center ring-1 ring-white/10">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <span className="text-xl text-red-400">!</span>
            </div>
            <h2 className="mb-2 font-semibold text-white">Erro ao carregar o 3D</h2>
            <p className="text-sm text-white/50">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
