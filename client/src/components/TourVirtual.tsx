import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";

interface TourVirtualProps {
  url: string;
  open: boolean;
  onClose: () => void;
  /** Nome do empreendimento, exibido sob o título do tour. */
  nomeEmpreendimento?: string;
}

/**
 * Overlay em tela cheia com o tour virtual 360° (iframe externo — Biganto).
 */
export default function TourVirtual({ url, open, onClose, nomeEmpreendimento }: TourVirtualProps) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex flex-col bg-[#04141d] animate-in fade-in duration-200" data-testid="tour-overlay">
      <header className="flex items-center justify-between px-4 sm:px-5 py-3 flex-shrink-0">
        <div>
          <h2 className="font-serif text-base sm:text-lg text-[var(--v-ink)] leading-none">Tour Virtual 360°</h2>
          {/* Nome do PROJETO. Estava fixo no piloto: o tour de qualquer
              empreendimento se anunciava como "Quinta das Mangueiras". */}
          {nomeEmpreendimento && (
            <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--v-accent)]/70 mt-1">
              {nomeEmpreendimento}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-[var(--v-surface-3)] text-[var(--v-ink-2)] hover:text-[var(--v-ink)] hover:bg-[var(--v-line-2)] transition-colors"
          data-testid="btn-tour-close"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="relative flex-1 min-h-0">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#04141d]">
            <div className="text-center">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-[var(--v-accent)]" />
              <p className="text-xs uppercase tracking-widest text-[var(--v-ink-3)]">Carregando tour...</p>
            </div>
          </div>
        )}
        <iframe
          src={url}
          title="Tour Virtual 360°"
          className="w-full h-full border-0"
          allow="fullscreen; gyroscope; accelerometer; xr-spatial-tracking; vr"
          allowFullScreen
          onLoad={() => setLoaded(true)}
          data-testid="tour-iframe"
        />
      </div>
    </div>,
    document.body,
  );
}
