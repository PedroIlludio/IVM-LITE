import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, Camera, MapPin, Check, AlertTriangle } from "lucide-react";
import Scene3D, { type Scene3DHandle } from "@/components/Scene3D";
import SolarBar from "@/components/SolarBar";
import { getAllBuildings3D, MARAGOGI_TZ_OFFSET } from "@/lib/vision3d-config";
import {
  loadPlacements,
  savePlacements,
  type Placement,
  type Placements,
} from "@/lib/placements";
import { getSunReadout, localToUtc, seasonDate, type Season } from "@/lib/solar";

type NumKey = "heading" | "pitch" | "roll" | "scale" | "heightOffset" | "offsetEast" | "offsetNorth";

export default function EditorPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [working, setWorking] = useState<Placements>({});
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [season, setSeason] = useState<Season>("verao");
  const [timeMinutes, setTimeMinutes] = useState(780);

  const sceneRef = useRef<Scene3DHandle>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        if (!d.googleMapsApiKey) setError("Chave do Google Maps não configurada.");
        else setApiKey(d.googleMapsApiKey);
      })
      .catch(() => setError("Falha ao buscar configuração."));
    loadPlacements().then((p) => {
      setWorking(p);
      setLoaded(true);
    });
  }, []);

  const buildings = useMemo(() => getAllBuildings3D(working), [working]);
  const selected = useMemo(
    () => buildings.find((b) => b.id === selectedId) ?? null,
    [buildings, selectedId],
  );

  const utcDate = useMemo(() => {
    const [y, m, d] = seasonDate(season, new Date().getFullYear());
    return localToUtc(y, m, d, Math.floor(timeMinutes / 60), timeMinutes % 60, MARAGOGI_TZ_OFFSET);
  }, [season, timeMinutes]);

  const sun = useMemo(
    () => getSunReadout(utcDate, selected?.lat ?? -8.9398, selected?.lng ?? -35.1696),
    [utcDate, selected],
  );

  function patch(id: string, p: Partial<Placement>) {
    setWorking((w) => ({ ...w, [id]: { ...w[id], ...p } }));
    setSaveMsg(null);
  }

  function setField(key: NumKey, value: number) {
    if (!selectedId) return;
    patch(selectedId, { [key]: value });
  }

  async function handleSave() {
    const res = await savePlacements(working);
    setSaveMsg(res.ok ? "Salvo em data/vision3d-placements.json" : `Erro: ${res.error}`);
    setTimeout(() => setSaveMsg(null), 4000);
  }

  function captureCamera() {
    if (!selectedId) return;
    const cam = sceneRef.current?.getCurrentCamera();
    if (cam) patch(selectedId, { camera: cam });
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0a0c12]">
      {apiKey && (
        <Scene3D
          ref={sceneRef}
          apiKey={apiKey}
          buildings={buildings}
          solarUtc={utcDate}
          selectedId={selectedId}
          editMode
          onSelect={setSelectedId}
          onReady={() => setReady(true)}
          onError={setError}
          onEditPlace={(id, lat, lng) => patch(id, { lat, lng })}
          onEditTransform={(id, p) => patch(id, p)}
        />
      )}

      {/* Barra superior do editor */}
      {!error && (
        <div className="pointer-events-auto absolute left-4 top-4 z-20 flex items-center gap-2 rounded-lg bg-teal-500/90 px-3 py-2 text-sm font-semibold text-[#0a0c12] shadow-lg">
          <MapPin className="h-4 w-4" /> MODO EDIÇÃO
        </div>
      )}

      {/* Painel do editor */}
      {!error && (
        <div className="pointer-events-auto absolute right-4 top-4 z-20 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-[#0a0c12]/90 p-4 text-white shadow-xl ring-1 ring-white/10 backdrop-blur">
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/40">
            Empreendimento
          </label>
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="mb-3 w-full rounded-md bg-white/10 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-teal-400/50"
          >
            <option value="" className="bg-[#0a0c12]">
              — selecione (ou clique no mapa) —
            </option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id} className="bg-[#0a0c12]">
                {b.empreendimento.name}
                {b.modelUrl ? " (3D)" : ""}
              </option>
            ))}
          </select>

          {selected ? (
            <div className="space-y-2.5">
              <div className="rounded bg-white/5 px-2 py-2 text-[11px] text-white/50 space-y-1">
                <p className="text-white/70">Arraste os gizmos no modelo:</p>
                <p><span style={{ color: "#ff5a5a" }}>●</span> Leste · <span style={{ color: "#4ade80" }}>●</span> Norte · <span style={{ color: "#4aa8ff" }}>●</span> Altura</p>
                <p><span style={{ color: "#ffd54f" }}>●</span> Anel = rotação · <span style={{ color: "#22d3ee" }}>●</span> Ponto = escala</p>
                <p className="text-white/40">Ou clique no terreno para reposicionar. Ajuste fino nos controles abaixo.</p>
              </div>
              <Slider label="Rotação" v={selected.heading} min={0} max={360} step={1} suffix="°"
                onChange={(x) => setField("heading", x)} />
              <Slider label="Inclinar (pitch)" v={selected.pitch} min={-180} max={180} step={1} suffix="°"
                onChange={(x) => setField("pitch", x)} />
              <Slider label="Rolar (roll)" v={selected.roll} min={-180} max={180} step={1} suffix="°"
                onChange={(x) => setField("roll", x)} />
              <NumberField label="Escala" v={selected.scale} presets={[0.001, 0.01, 0.1, 1]}
                onChange={(x) => setField("scale", x)} />
              <Slider label="Altura base" v={selected.heightOffset} min={-80} max={150} step={0.5} suffix="m"
                onChange={(x) => setField("heightOffset", x)} />
              <Slider label="Mover L↔O" v={selected.offsetEast} min={-400} max={400} step={1} suffix="m"
                onChange={(x) => setField("offsetEast", x)} />
              <Slider label="Mover N↔S" v={selected.offsetNorth} min={-400} max={400} step={1} suffix="m"
                onChange={(x) => setField("offsetNorth", x)} />

              <button
                onClick={captureCamera}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-white/10 px-3 py-2 text-sm text-white/80 hover:bg-white/20"
              >
                <Camera className="h-4 w-4" />
                {selected.camera ? "Recapturar câmera inicial" : "Capturar câmera inicial"}
              </button>
              {selected.camera && (
                <p className="text-[10px] text-white/40">
                  Câmera salva: alt {selected.camera.height.toFixed(0)}m · hdg {selected.camera.heading.toFixed(0)}°
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-white/50">
              Selecione um empreendimento acima ou clique num marcador/modelo no mapa.
            </p>
          )}

          <button
            onClick={handleSave}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-teal-500 px-3 py-2.5 text-sm font-semibold text-[#0a0c12] hover:bg-teal-400"
          >
            <Save className="h-4 w-4" /> Salvar configuração
          </button>
          {saveMsg && (
            <p
              className={`mt-2 flex items-center gap-1.5 text-[11px] ${
                saveMsg.startsWith("Erro") ? "text-red-400" : "text-teal-400"
              }`}
            >
              {saveMsg.startsWith("Erro") ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {saveMsg}
            </p>
          )}
        </div>
      )}

      {!error && (
        <SolarBar
          timeMinutes={timeMinutes}
          onTimeChange={setTimeMinutes}
          season={season}
          onSeasonChange={setSeason}
          sun={sun}
        />
      )}

      {(!ready || !loaded) && !error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0a0c12]/90">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-teal-500" />
            <p className="text-xs uppercase tracking-widest text-white/40">Carregando editor 3D...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0a0c12] p-4">
          <div className="max-w-md rounded-xl bg-white/5 p-8 text-center ring-1 ring-white/10">
            <h2 className="mb-2 font-semibold text-white">Erro</h2>
            <p className="text-sm text-white/50">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  v,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  v: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[11px] text-white/50">
        <span>{label}</span>
        <span className="font-mono text-white/80">
          {v.toFixed(step < 1 ? 1 : 0)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-teal-400"
      />
    </div>
  );
}

function NumberField({
  label,
  v,
  presets,
  onChange,
}: {
  label: string;
  v: number;
  presets: number[];
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px] text-white/50">
        <span>{label}</span>
        <div className="flex gap-1">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => onChange(p)}
              className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/20"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <input
        type="number"
        value={v}
        min={0.0001}
        step={0.001}
        onChange={(e) => onChange(Number(e.target.value) || v)}
        className="w-full rounded-md bg-white/10 px-2 py-1 font-mono text-sm outline-none ring-1 ring-white/10 focus:ring-teal-400/50"
      />
    </div>
  );
}
