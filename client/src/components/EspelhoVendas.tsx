import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Maximize2, ChevronRight, Building2, Layers } from "lucide-react";
import type { Torre, TorreDef, Unidade, UnidadeStatus } from "@/lib/unidades";
import { STATUS_META, contarStatus, porPavimento, torreLabel, torresDe } from "@/lib/unidades";

interface PlantaRef { area: string; url: string }

interface EspelhoVendasProps {
  open: boolean;
  onClose: () => void;
  unidades: Unidade[];
  plantas: PlantaRef[];
  amenities: string[];
  /** Torres do projeto; se omitido, são deduzidas das unidades. */
  torres?: TorreDef[];
}

// Pavimentos especiais (áreas comuns), do topo para baixo.
const ESPECIAIS_TOPO = [{ key: "rooftop", label: "Rooftop", match: "Rooftop" }];
const ESPECIAIS_BASE = [
  { key: "terreo", label: "Térreo", match: "Térreo" },
  { key: "subsolo", label: "Subsolo", match: "Subsolo" },
];

export default function EspelhoVendas({ open, onClose, unidades, plantas, amenities, torres }: EspelhoVendasProps) {
  const TORRES = useMemo(() => torresDe(unidades, torres), [unidades, torres]);
  const [torre, setTorre] = useState<Torre>("");
  const [unidade, setUnidade] = useState<Unidade | null>(null);
  const [floorPlan, setFloorPlan] = useState<{ label: string; url?: string; amenities?: string[] } | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; legenda: string } | null>(null);

  useEffect(() => {
    if (open) { setUnidade(null); setFloorPlan(null); setLightbox(null); }
  }, [open]);

  // Seleciona a primeira torre assim que as unidades chegam (ou se a torre
  // atual sumiu, ex.: espelho regerado no editor).
  useEffect(() => {
    if (TORRES.length && !TORRES.some((t) => t.id === torre)) setTorre(TORRES[0].id);
  }, [TORRES, torre]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else if (unidade || floorPlan) { setUnidade(null); setFloorPlan(null); }
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose, lightbox, unidade, floorPlan]);

  const pavimentos = useMemo(() => porPavimento(unidades, torre), [unidades, torre]);
  const cont = useMemo(() => contarStatus(unidades, torre), [unidades, torre]);
  const contGeral = useMemo(() => contarStatus(unidades), [unidades]);
  const plantaDe = (area: string) => plantas.find((p) => p.area === area)?.url;
  const plantaEspecial = (match: string) => plantas.find((p) => p.area.includes(match))?.url;

  if (!open) return null;

  const abrirEspecial = (label: string, match: string, am?: string[]) =>
    setFloorPlan({ label, url: plantaEspecial(match), amenities: am });

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex flex-col animate-in fade-in duration-200"
      style={{ background: "linear-gradient(180deg,#04222b 0%,#061a24 55%,#04141d 100%)" }}
      data-testid="espelho-overlay"
    >
      {/* Cabeçalho */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 flex-shrink-0">
        <div>
          <h2 className="font-serif text-base sm:text-lg text-white leading-none">Disponibilidade de Unidades</h2>
          <p className="text-[10px] uppercase tracking-[0.22em] text-teal-300/70 mt-1">
            {contGeral.disponivel + contGeral.reservada + contGeral.vendida} unidades · demonstrativo
          </p>
        </div>
        <button onClick={onClose} data-testid="btn-espelho-close"
          className="p-2 rounded-full bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Seletor de torre + legenda */}
      <div className="flex-shrink-0 px-4 sm:px-6 pb-2 flex flex-wrap items-center gap-3 justify-between">
        <nav className="flex items-center gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/10">
          {TORRES.map((t) => (
            <button key={t.id} onClick={() => { setTorre(t.id); setUnidade(null); setFloorPlan(null); }}
              data-testid={`torre-${t.id}`}
              className={`px-4 py-1.5 rounded-full text-xs sm:text-sm transition-colors inline-flex items-center gap-1.5 ${
                torre === t.id ? "bg-teal-500 text-[#04141d] font-semibold" : "text-white/70 hover:text-white"}`}>
              <Building2 className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-[11px]">
          {(["disponivel", "reservada", "vendida"] as UnidadeStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-white/70">
              <span className="w-3 h-3 rounded-sm" style={{ background: STATUS_META[s].cor }} />
              {STATUS_META[s].label} <span className="text-white/40">{cont[s]}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Torre empilhada */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-8" data-testid="espelho-torre">
        <div className="mx-auto max-w-3xl space-y-1.5">
          {ESPECIAIS_TOPO.map((e) => (
            <FloorEspecial key={e.key} label={e.label} onClick={() => abrirEspecial(e.label, e.match, amenities)} />
          ))}

          {pavimentos.map(({ pavimento, unidades: us }) => (
            <div key={pavimento} className="flex items-stretch gap-2" data-testid={`pavimento-${pavimento}`}>
              <div className="flex-shrink-0 w-14 flex flex-col items-center justify-center rounded-md bg-white/[0.04] ring-1 ring-white/10">
                <span className="text-[9px] uppercase tracking-wider text-white/40">Pav.</span>
                <span className="font-serif text-lg text-white leading-none">{pavimento}</span>
              </div>
              <div className="flex-1 flex flex-wrap gap-1 content-center">
                {us.map((u) => (
                  <button key={u.id} onClick={() => setUnidade(u)} data-testid={`unidade-${u.id}`}
                    title={`${u.numero} · ${STATUS_META[u.status].label}`}
                    className="w-9 h-9 rounded-md text-[10px] font-semibold flex items-center justify-center transition-transform hover:scale-110 hover:ring-2 hover:ring-white/60"
                    style={{ background: STATUS_META[u.status].cor, color: u.status === "reservada" ? "#04141d" : "#fff" }}>
                    {u.numero}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {ESPECIAIS_BASE.map((e) => (
            <FloorEspecial key={e.key} label={e.label}
              onClick={() => abrirEspecial(e.label, e.match, e.key === "terreo" ? amenities : ["Garagem", "Bicicletário", "Área de Depósito de Bagagens", "Gerador", "Estação de Tratamento de Esgoto"])} />
          ))}
        </div>
      </div>

      {/* Detalhe da unidade (bottom sheet) */}
      {unidade && (
        <DetailSheet onClose={() => setUnidade(null)} title={`Unidade ${unidade.numero}`}
          subtitle={`Torre ${torreLabel(unidade.torre, torres)} · Pavimento ${unidade.pavimento}`}>
          <div className="flex gap-4">
            <div className="flex-1 space-y-2 text-sm">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold"
                style={{ background: STATUS_META[unidade.status].corSoft, color: STATUS_META[unidade.status].cor }}>
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_META[unidade.status].cor }} />
                {STATUS_META[unidade.status].label}
              </div>
              <Row icon={<Layers className="w-3.5 h-3.5" />} label="Tipologia" value={unidade.tipologia} />
              {unidade.area && <Row icon={<Maximize2 className="w-3.5 h-3.5" />} label="Área" value={unidade.area} />}
            </div>
            {plantaDe(unidade.tipologia) && (
              <button onClick={() => setLightbox({ url: plantaDe(unidade.tipologia)!, legenda: unidade.tipologia })}
                data-testid="btn-ver-planta"
                className="relative w-28 h-28 rounded-lg overflow-hidden ring-1 ring-white/10 hover:ring-teal-400/60 transition group flex-shrink-0">
                <img src={plantaDe(unidade.tipologia)} alt={unidade.tipologia} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                  <Maximize2 className="w-5 h-5 text-white" />
                </div>
                <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] text-white/90">Ver planta</span>
              </button>
            )}
          </div>
        </DetailSheet>
      )}

      {/* Navegação por pavimento especial (planta + áreas comuns) */}
      {floorPlan && (
        <DetailSheet onClose={() => setFloorPlan(null)} title={floorPlan.label} subtitle="Áreas comuns">
          <div className="flex flex-col sm:flex-row gap-4">
            {floorPlan.url && (
              <button onClick={() => setLightbox({ url: floorPlan.url!, legenda: floorPlan.label })}
                className="relative sm:w-1/2 h-40 rounded-lg overflow-hidden ring-1 ring-white/10 hover:ring-teal-400/60 transition group">
                <img src={floorPlan.url} alt={floorPlan.label} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                  <Maximize2 className="w-6 h-6 text-white" />
                </div>
              </button>
            )}
            {floorPlan.amenities && floorPlan.amenities.length > 0 && (
              <div className="flex-1 flex flex-wrap gap-1.5 content-start">
                {floorPlan.amenities.map((a) => (
                  <span key={a} className="text-[11px] text-white/70 bg-white/5 rounded-full px-2.5 py-1 ring-1 ring-white/10">{a}</span>
                ))}
              </div>
            )}
          </div>
        </DetailSheet>
      )}

      {/* Lightbox de planta */}
      {lightbox && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white/70 hover:text-white" onClick={() => setLightbox(null)}>
            <X className="w-5 h-5" />
          </button>
          <figure className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.legenda} className="max-w-[92vw] max-h-[82vh] object-contain rounded-lg" />
            <figcaption className="font-serif text-white/80">{lightbox.legenda}</figcaption>
          </figure>
        </div>,
        document.body,
      )}
    </div>,
    document.body,
  );
}

function FloorEspecial({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} data-testid={`especial-${label}`}
      className="w-full flex items-center justify-between rounded-md bg-gradient-to-r from-teal-500/15 to-transparent ring-1 ring-teal-400/20 px-3 py-2.5 hover:ring-teal-400/50 transition group">
      <span className="inline-flex items-center gap-2 text-sm text-white/90">
        <Layers className="w-4 h-4 text-teal-300" /> {label} <span className="text-white/40 text-xs">· áreas comuns</span>
      </span>
      <ChevronRight className="w-4 h-4 text-teal-300/70 group-hover:translate-x-0.5 transition-transform" />
    </button>
  );
}

function DetailSheet({ title, subtitle, children, onClose }: {
  title: string; subtitle?: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 animate-in slide-in-from-bottom-4 duration-200">
      <div className="mx-auto max-w-3xl m-3 rounded-2xl bg-[#061a24]/95 ring-1 ring-white/10 shadow-2xl backdrop-blur p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-serif text-lg text-white leading-none">{title}</h3>
            {subtitle && <p className="text-xs text-white/50 mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-white/10 text-white/60 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-teal-300/70">{icon}</span>
      <span className="text-white/40 text-xs w-20">{label}</span>
      <span className="text-white/85">{value}</span>
    </div>
  );
}
