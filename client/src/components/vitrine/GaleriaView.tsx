import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Film, X } from "lucide-react";
import { doisDigitos } from "./comum";

export interface ImgGaleria { url: string; legenda: string; categoria?: string }
export interface VideoGaleria { url: string; poster?: string; titulo: string }
type Aba = "imagens" | "videos" | "plantas";

interface Peca {
  url: string;
  titulo: string;
  categoria: string;
  video?: boolean;
  poster?: string;
}

const MINIATURAS = 6;

/**
 * Galeria em tela cheia: uma peça grande, legenda à direita e tira de
 * miniaturas no rodapé. O padding do palco reserva a ilha (esquerda) e o
 * cartão de legenda (direita).
 */
export default function GaleriaView({ imagens, videos, plantas, ordemCategorias = [], onFechar }: {
  imagens: ImgGaleria[];
  videos: VideoGaleria[];
  plantas: ImgGaleria[];
  ordemCategorias?: string[];
  onFechar: () => void;
}) {
  const pecasPorAba = useMemo((): Record<Aba, Peca[]> => {
    // Plantas também salvas na galeria geral não se repetem em Imagens.
    const urlsPlantas = new Set(plantas.map((p) => p.url));
    const posicao = (c?: string) => {
      const i = c ? ordemCategorias.indexOf(c) : -1;
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const imgs = imagens
      .filter((i) => !urlsPlantas.has(i.url))
      .map((i, ordem) => ({ i, ordem }))
      .sort((a, b) => posicao(a.i.categoria) - posicao(b.i.categoria) || a.ordem - b.ordem)
      .map(({ i }) => ({ url: i.url, titulo: i.legenda, categoria: i.categoria?.trim() || "Imagens" }));
    return {
      imagens: imgs,
      videos: videos.map((v) => ({ url: v.url, titulo: v.titulo, categoria: "Vídeo", video: true, poster: v.poster })),
      plantas: plantas.map((p) => ({ url: p.url, titulo: p.legenda, categoria: "Planta" })),
    };
  }, [imagens, videos, plantas, ordemCategorias]);

  const abas = ([
    ["imagens", "Imagens"],
    ["videos", "Vídeos"],
    ["plantas", "Plantas"],
  ] as [Aba, string][]).filter(([a]) => pecasPorAba[a].length > 0);

  const [aba, setAba] = useState<Aba>(abas[0]?.[0] ?? "imagens");
  const [indice, setIndice] = useState(0);
  const pecas = pecasPorAba[aba];
  const peca = pecas[Math.min(indice, pecas.length - 1)];

  const ir = (d: number) => pecas.length && setIndice((i) => (i + d + pecas.length) % pecas.length);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
      if (e.key === "ArrowLeft") ir(-1);
      if (e.key === "ArrowRight") ir(1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  // Janela de miniaturas centrada na peça ativa.
  const inicio = Math.max(0, Math.min(indice - Math.floor(MINIATURAS / 2), pecas.length - MINIATURAS));
  const janela = pecas.slice(inicio, inicio + MINIATURAS);

  return (
    <div className="absolute inset-0 z-20 bg-[#0b0e0b]" data-testid="media-overlay">
      <div className="vd-galeria-palco absolute inset-0 flex items-center justify-center"
        style={{ padding: "70px 320px 104px 88px" }}>
        {!peca ? (
          <p className="vd-micro vd-3">Nenhuma mídia cadastrada.</p>
        ) : peca.video ? (
          <video key={peca.url} src={peca.url} poster={peca.poster} controls autoPlay playsInline
            className="max-h-full max-w-full rounded-[4px] bg-black" />
        ) : (
          <img key={peca.url} src={peca.url} alt={peca.titulo}
            className="max-h-full max-w-full rounded-[4px] object-contain animate-in fade-in duration-300" />
        )}
      </div>

      <div className="absolute right-5 top-5 z-10 flex items-center gap-1.5">
        {abas.length > 1 && abas.map(([a, rotulo]) => (
          <button key={a} type="button" className="vd-pilula vd-pilula-vidro"
            data-on={aba === a ? "1" : undefined}
            onClick={() => { setAba(a); setIndice(0); }}>
            {rotulo}
          </button>
        ))}
        <button type="button" onClick={onFechar} className="vd-acao vd-alvo ml-1.5"
          aria-label="Fechar a galeria" title="Fechar" data-testid="btn-media-close">
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      {pecas.length > 1 && (
        <>
          <button type="button" onClick={() => ir(-1)} aria-label="Anterior" title="Anterior"
            className="vd-seta absolute left-[98px] top-1/2 z-10 -translate-y-1/2 max-md:left-3">
            <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => ir(1)} aria-label="Próxima" title="Próxima"
            className="vd-seta absolute right-[330px] top-1/2 z-10 -translate-y-1/2 max-md:right-3">
            <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </>
      )}

      {peca && (
        <aside className="vd-galeria-legenda vd-vidro absolute right-5 top-1/2 z-10 w-[260px] -translate-y-1/2 p-5"
          key={`${aba}-${indice}`}>
          <p className="vd-micro vd-bronze">{peca.categoria}</p>
          {peca.titulo && (
            <h2 className="mt-2 text-[16px] font-light uppercase leading-snug tracking-[0.16em]">{peca.titulo}</h2>
          )}
          <p className="vd-micro vd-num vd-3 mt-4">
            {doisDigitos(indice + 1)} / {doisDigitos(pecas.length)}
          </p>
        </aside>
      )}

      {pecas.length > 1 && (
        <div className="absolute bottom-6 left-[88px] right-[320px] z-10 flex justify-center gap-2 max-md:left-2.5 max-md:right-2.5 max-md:bottom-4 max-md:overflow-x-auto">
          {janela.map((p, k) => {
            const i = inicio + k;
            return (
              <button key={`${p.url}-${i}`} type="button" onClick={() => setIndice(i)}
                aria-label={`Ver ${p.titulo || `item ${i + 1}`}`}
                aria-current={i === indice ? "true" : undefined}
                className="relative h-[54px] w-[88px] shrink-0 overflow-hidden rounded-[4px] border transition-opacity"
                style={{
                  borderColor: i === indice ? "#fff" : "transparent",
                  opacity: i === indice ? 1 : 0.6,
                }}>
                {p.video && !p.poster ? (
                  <span className="grid h-full w-full place-items-center bg-white/10">
                    <Film className="h-4 w-4" strokeWidth={1.5} />
                  </span>
                ) : (
                  <img src={p.video ? p.poster : p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
