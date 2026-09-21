import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeft, ChevronLeft, ChevronRight, Play } from "lucide-react";

export interface ImgItem { url: string; legenda: string; categoria?: string }
export interface VidItem { url: string; poster?: string; titulo: string }
export type MediaTab = "imagens" | "videos" | "plantas";

interface MediaGalleryProps {
  imagens: ImgItem[];
  /** Ordem das categorias definida no editor (as demais vão para o fim). */
  ordemCategorias?: string[];
  videos: VidItem[];
  plantas: ImgItem[];
  open: boolean;
  onClose: () => void;
  initialTab?: MediaTab;
}

/**
 * Galeria de mídia em tela cheia, estilo app de fotos do iOS, com abas
 * Imagens | Vídeos | Plantas. Imagens/plantas usam um visualizador com rolagem
 * por snap (momentum nativo); vídeos abrem um player dedicado com prev/próxima.
 * Identidade Quinta das Mangueiras (fundo petróleo, acento turquesa, Ivy Mode).
 */
export default function MediaGallery({ imagens, videos, plantas, open, onClose, initialTab = "imagens", ordemCategorias = [] }: MediaGalleryProps) {
  const [tab, setTab] = useState<MediaTab>(initialTab);
  const [viewer, setViewer] = useState<number | null>(null); // índice aberto; null = grade
  const scrollerRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<number | null>(null);

  // Projetos antigos podem ter a mesma planta salva também na galeria geral.
  // A separacao por URL garante que a aba Imagens nunca herde itens de Plantas.
  const urlsDePlantas = new Set(plantas.map((item) => item.url));
  const imagensDaGaleria = imagens.filter((item) => !urlsDePlantas.has(item.url));

  const isImg = tab !== "videos";
  const todasDaAba: ImgItem[] = tab === "imagens" ? imagensDaGaleria : tab === "plantas" ? plantas : [];

  /**
   * Categorias da aba atual. Só aparecem quando existem de fato — uma barra de
   * filtros com um único botão é ruído.
   */
  const categorias = Array.from(
    new Set(todasDaAba.map((g) => g.categoria?.trim()).filter((c): c is string => !!c)),
  ).sort((a, b) => {
    // A ordem é a do editor; o que não estiver na lista vai para o fim, em ordem
    // alfabética, para o resultado nunca depender da ordem de upload.
    const ia = ordemCategorias.indexOf(a);
    const ib = ordemCategorias.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  const [categoria, setCategoria] = useState("");
  const imgs: ImgItem[] = categoria
    ? todasDaAba.filter((g) => g.categoria === categoria)
    : todasDaAba;
  const count = tab === "videos" ? videos.length : imgs.length;

  /**
   * Só as abas que têm conteúdo.
   *
   * "Vídeos 0" era um convite a clicar que levava a uma tela vazia — e num
   * projeto sem vídeo nenhum ele aparecia em toda visita, dizendo ao cliente
   * que falta alguma coisa. Aba vazia não informa: ocupa espaço e frustra.
   */
  const tabs = ([
    { key: "imagens", label: "Imagens", n: imagensDaGaleria.length },
    { key: "videos", label: "Vídeos", n: videos.length },
    { key: "plantas", label: "Plantas", n: plantas.length },
  ] as { key: MediaTab; label: string; n: number }[]).filter((t) => t.n > 0);

  useEffect(() => {
    if (!open) return;
    // A aba pedida pode não existir neste projeto (abrir em "plantas" num
    // projeto sem planta). Cai na primeira que tem conteúdo, em vez de abrir
    // numa aba que o cabeçalho nem mostra.
    setTab(tabs.some((t) => t.key === initialTab) ? initialTab : (tabs[0]?.key ?? initialTab));
    setViewer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  // Ao trocar de aba, volta para a grade e zera o filtro (as categorias mudam).
  useEffect(() => { setViewer(null); setCategoria(""); }, [tab]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const openViewer = useCallback((i: number) => { pendingRef.current = i; setViewer(i); }, []);

  // Posiciona o scroller de imagens ao abrir o visualizador.
  useEffect(() => {
    const target = pendingRef.current;
    if (viewer === null || target === null || !isImg || !scrollerRef.current) return;
    const el = scrollerRef.current;
    pendingRef.current = null;
    requestAnimationFrame(() => el.scrollTo({ left: target * el.clientWidth, behavior: "auto" }));
  }, [viewer, isImg]);

  const goTo = useCallback((i: number, smooth = true) => {
    const el = scrollerRef.current;
    if (!el) return;
    const c = Math.max(0, Math.min(count - 1, i));
    el.scrollTo({ left: c * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  }, [count]);

  const step = useCallback((dir: number) => {
    if (isImg) {
      const el = scrollerRef.current;
      if (!el) return;
      goTo(Math.round(el.scrollLeft / el.clientWidth) + dir);
    } else {
      setViewer((v) => (v === null ? 0 : Math.max(0, Math.min(count - 1, v + dir))));
    }
  }, [isImg, goTo, count]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setViewer((cur) => (cur === i ? cur : i));
  }, []);

  useEffect(() => {
    if (viewer === null || !filmstripRef.current) return;
    (filmstripRef.current.children[viewer] as HTMLElement | undefined)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [viewer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { viewer !== null ? setViewer(null) : onClose(); }
      else if (viewer !== null && e.key === "ArrowRight") step(1);
      else if (viewer !== null && e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, viewer, onClose, step]);

  if (!open) return null;

  const legendaAtual = viewer === null ? "" : tab === "videos" ? videos[viewer]?.titulo : imgs[viewer]?.legenda;

  return createPortal(
    <div
      className="vitrine fixed inset-0 z-[9998] flex flex-col bg-[var(--v-bg)] animate-in fade-in duration-200"
      data-testid="media-overlay"
    >
      {/*
        Cabeçalho.

        Havia DOIS jeitos de sair — "← Fechar" à esquerda e "✕" à direita —
        fazendo a mesma coisa. Agora o ✕ fecha, sempre, e a seta só aparece
        quando ela significa outra coisa: voltar da foto para a grade.

        Fundo branco com hairline embaixo: separa a barra do creme da grade,
        que era o que fazia o topo parecer de outro sistema.
      */}
      <header className="relative z-10 flex flex-shrink-0 items-center gap-3 border-b border-[var(--v-line)] bg-[var(--v-surface)] px-4 py-3 sm:px-5">
        {viewer !== null ? (
          <button
            onClick={() => setViewer(null)}
            className="v-filter shrink-0"
            data-testid="btn-media-back"
          >
            <ArrowLeft className="h-4 w-4" />
            Grade
          </button>
        ) : (
          <div className="v-eyebrow shrink-0">Galeria</div>
        )}

        <div className="flex min-w-0 flex-1 justify-center">
          {viewer === null ? (
            <nav className="v-seg w-auto" data-testid="media-tabs">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  data-on={tab === t.key ? "1" : undefined}
                  data-testid={`tab-${t.key}`}
                  className="!flex-none px-4"
                >
                  {t.label}
                  <span className="ml-1.5 opacity-55">{t.n}</span>
                </button>
              ))}
            </nav>
          ) : (
            <div className="min-w-0 text-center">
              <p className="v-title truncate text-[15px] leading-tight">{legendaAtual}</p>
              <p className="v-meta mt-0.5 font-mono text-[11px]">{viewer + 1} / {count}</p>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="v-icon-btn !h-9 !w-9 shrink-0 !bg-[var(--v-surface-3)] !shadow-none hover:!bg-[var(--v-line-2)]"
          title="Fechar galeria"
          data-testid="btn-media-close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* GRADE */}
      {viewer === null && (
        <div className="flex-1 overflow-y-auto pb-6" data-testid="media-grade">
          {/*
            Barra de categorias. Antes eram pastilhas de 11px espremidas contra
            a grade, sem dizer o que eram — pareciam legenda solta. Agora têm
            faixa própria, colada no topo enquanto se rola, rótulo e alvo de
            toque de 30px.
          */}
          {isImg && categorias.length > 1 && (
            <div className="sticky top-0 z-[1] mb-3 flex flex-wrap items-center gap-1.5 border-b border-[var(--v-line)] bg-[var(--v-surface)] px-3 py-2.5">
              <span className="v-eyebrow mr-1">Categorias</span>
              <button
                onClick={() => setCategoria("")}
                data-on={!categoria ? "1" : undefined}
                className="v-filter"
              >
                Todas <span>{todasDaAba.length}</span>
              </button>
              {categorias.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoria(c === categoria ? "" : c)}
                  data-on={categoria === c ? "1" : undefined}
                  className="v-filter"
                >
                  {c} <span>{todasDaAba.filter((g) => g.categoria === c).length}</span>
                </button>
              ))}
            </div>
          )}
          <div className="px-3">
          <div key={tab} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            {tab === "videos"
              ? videos.map((v, i) => (
                  <button key={v.url} onClick={() => openViewer(i)} data-testid={`media-item-${i}`}
                    className="group relative aspect-video overflow-hidden rounded-lg bg-[var(--v-surface-2)] ring-1 ring-[var(--v-line)] hover:ring-[var(--v-accent)] transition">
                    {v.poster && <img src={v.poster} alt={v.titulo} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <span className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--v-accent)]/95 text-white shadow-lg group-hover:scale-110 transition-transform">
                        <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
                      </span>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-2 pt-6 bg-gradient-to-t from-black/70 to-transparent">
                      <span className="text-[11px] text-[var(--v-ink)]">{v.titulo}</span>
                    </div>
                  </button>
                ))
              : imgs.map((g, i) => (
                  <button key={`${tab}:${g.url}:${i}`} onClick={() => openViewer(i)} data-testid={`media-item-${i}`}
                    className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--v-surface-2)] ring-1 ring-[var(--v-line)] hover:ring-[var(--v-accent)] transition">
                    <img src={g.url} alt={g.legenda} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]" />
                    <div className="absolute inset-x-0 bottom-0 p-2 pt-6 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[11px] text-[var(--v-ink)]">{g.legenda}</span>
                    </div>
                  </button>
                ))}
          </div>
          </div>
        </div>
      )}

      {/* VISUALIZADOR DE IMAGENS/PLANTAS (swipe) */}
      {viewer !== null && isImg && (
        <div className="relative flex-1 min-h-0 flex flex-col">
          <div ref={scrollerRef} onScroll={onScroll} data-testid="media-viewer"
            className="flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style={{ scrollbarWidth: "none" }}>
            {imgs.map((g) => (
              <div key={g.url} className="snap-center shrink-0 w-full h-full flex items-center justify-center px-4">
                <img src={g.url} alt={g.legenda} className="max-w-full max-h-full object-contain rounded-xl select-none" draggable={false} />
              </div>
            ))}
          </div>
          <NavButtons onPrev={() => step(-1)} onNext={() => step(1)} />
          <Filmstrip stripRef={filmstripRef} items={imgs.map((g) => g.url)} active={viewer} onPick={(i) => goTo(i)} />
        </div>
      )}

      {/* PLAYER DE VÍDEO */}
      {viewer !== null && !isImg && (
        <div className="relative flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex items-center justify-center px-3">
            <video
              key={videos[viewer].url}
              src={videos[viewer].url}
              poster={videos[viewer].poster}
              controls
              autoPlay
              playsInline
              className="max-w-full max-h-full rounded-xl bg-black"
              data-testid="media-video"
            />
          </div>
          <NavButtons onPrev={() => step(-1)} onNext={() => step(1)} />
          <Filmstrip stripRef={filmstripRef} items={videos.map((v) => v.poster ?? "")} active={viewer} onPick={(i) => setViewer(i)} />
        </div>
      )}
    </div>,
    document.body,
  );
}

function NavButtons({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  return (
    <>
      <button onClick={onPrev} aria-label="Anterior"
        className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-[var(--v-surface-3)] text-[var(--v-ink-2)] hover:text-[var(--v-ink)] hover:bg-black/50 transition-colors">
        <ChevronLeft className="w-6 h-6" />
      </button>
      <button onClick={onNext} aria-label="Próxima"
        className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-[var(--v-surface-3)] text-[var(--v-ink-2)] hover:text-[var(--v-ink)] hover:bg-black/50 transition-colors">
        <ChevronRight className="w-6 h-6" />
      </button>
    </>
  );
}

const Filmstrip = ({ stripRef, items, active, onPick }: { stripRef: React.RefObject<HTMLDivElement | null>; items: string[]; active: number; onPick: (i: number) => void }) => (
  <div ref={stripRef as React.RefObject<HTMLDivElement>} className="flex-shrink-0 flex gap-1.5 overflow-x-auto px-4 py-3" style={{ scrollbarWidth: "none" }}>
    {items.map((src, i) => (
      <button key={i} onClick={() => onPick(i)}
        className={`relative shrink-0 h-12 w-16 overflow-hidden rounded-md transition-all ${i === active ? "ring-2 ring-teal-400" : "ring-1 ring-[var(--v-line-2)] opacity-60 hover:opacity-100"}`}>
        {src && <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />}
      </button>
    ))}
  </div>
);
