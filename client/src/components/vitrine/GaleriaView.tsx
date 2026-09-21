import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Film, Play, X } from "lucide-react";
import { doisDigitos, useMovel } from "./comum";

export interface ImgGaleria { url: string; legenda: string; categoria?: string }
export interface VideoGaleria { url: string; poster?: string; titulo: string }

interface Peca {
  url: string;
  titulo: string;
  categoria: string;
  video?: boolean;
  poster?: string;
}

const MINIATURAS = 6;
const CAT_VIDEOS = "Vídeos";
const CAT_PLANTAS = "Plantas";

/**
 * Galeria em GRADE: miniaturas no palco e, à direita, as categorias com os
 * nomes de cada peça. Tocar numa miniatura (ou num nome) abre a peça grande,
 * com setas, tira de miniaturas e o caminho de volta à grade.
 *
 * Vídeos e plantas entram como categorias, depois das da galeria — uma lista
 * só, em vez de abas que escondiam parte do conteúdo.
 */
export default function GaleriaView({ imagens, videos, plantas, ordemCategorias = [], onFechar }: {
  imagens: ImgGaleria[];
  videos: VideoGaleria[];
  plantas: ImgGaleria[];
  ordemCategorias?: string[];
  onFechar: () => void;
}) {
  const movel = useMovel();

  const { pecas, categorias } = useMemo(() => {
    // Plantas também salvas na galeria geral não se repetem nas imagens.
    const urlsPlantas = new Set(plantas.map((p) => p.url));
    const posicao = (c: string) => {
      const i = ordemCategorias.indexOf(c);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const imgs: Peca[] = imagens
      .filter((i) => !urlsPlantas.has(i.url))
      .map((i) => ({ url: i.url, titulo: i.legenda, categoria: i.categoria?.trim() || "Imagens" }));
    // Ordem das categorias: a do editor; as demais por ordem de aparição.
    const cats = Array.from(new Set(imgs.map((p) => p.categoria)))
      .map((c, ordem) => ({ c, ordem }))
      .sort((a, b) => posicao(a.c) - posicao(b.c) || a.ordem - b.ordem)
      .map(({ c }) => c);
    const todas: Peca[] = [
      ...cats.flatMap((c) => imgs.filter((p) => p.categoria === c)),
      ...videos.map((v) => ({ url: v.url, titulo: v.titulo, categoria: CAT_VIDEOS, video: true, poster: v.poster })),
      ...plantas.map((p) => ({ url: p.url, titulo: p.legenda, categoria: CAT_PLANTAS })),
    ];
    return {
      pecas: todas,
      categorias: [...cats, ...(videos.length ? [CAT_VIDEOS] : []), ...(plantas.length ? [CAT_PLANTAS] : [])],
    };
  }, [imagens, videos, plantas, ordemCategorias]);

  const [categoria, setCategoria] = useState("");
  /** Índice da peça aberta DENTRO da lista filtrada; `null` = grade. */
  const [aberta, setAberta] = useState<number | null>(null);
  const lista = categoria ? pecas.filter((p) => p.categoria === categoria) : pecas;
  const peca = aberta != null ? lista[Math.min(aberta, lista.length - 1)] : null;
  const gradeRef = useRef<HTMLDivElement>(null);

  const ir = (d: number) =>
    setAberta((i) => (i == null || !lista.length ? i : (i + d + lista.length) % lista.length));

  function filtrar(c: string) {
    setCategoria(c);
    setAberta(null);
    gradeRef.current?.scrollTo({ top: 0 });
  }

  /** Abre uma peça pelo nome no painel: filtra pela categoria dela. */
  function abrirPeca(p: Peca) {
    const daCategoria = pecas.filter((x) => x.categoria === p.categoria);
    setCategoria(p.categoria);
    setAberta(Math.max(0, daCategoria.indexOf(p)));
  }

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (aberta != null) setAberta(null);
        else onFechar();
      }
      if (aberta == null) return;
      if (e.key === "ArrowLeft") ir(-1);
      if (e.key === "ArrowRight") ir(1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  const botaoFechar = (
    <button type="button" onClick={onFechar} className="vd-acao vd-alvo shrink-0"
      aria-label="Fechar a galeria" title="Fechar" data-testid="btn-media-close">
      <X className="h-4 w-4" strokeWidth={1.5} />
    </button>
  );

  const miniatura = (p: Peca, grande = false) =>
    p.video && !p.poster ? (
      <span className="grid h-full w-full place-items-center bg-white/10">
        <Film className={grande ? "h-6 w-6" : "h-4 w-4"} strokeWidth={1.5} />
      </span>
    ) : (
      <img src={p.video ? p.poster : p.url} alt="" loading="lazy" draggable={false}
        className="h-full w-full object-cover" />
    );

  /* ---------------- Peça aberta ---------------- */
  if (peca && aberta != null) {
    const inicio = Math.max(0, Math.min(aberta - Math.floor(MINIATURAS / 2), lista.length - MINIATURAS));
    const janela = lista.slice(inicio, inicio + MINIATURAS);
    return (
      <div className="vd-galeria absolute inset-0 z-20 bg-[#0b0e0b]" data-testid="media-overlay">
        <div className="vd-galeria-palco absolute inset-0 flex items-center justify-center">
          {peca.video ? (
            <video key={peca.url} src={peca.url} poster={peca.poster} controls autoPlay playsInline
              className="max-h-full max-w-full rounded-[4px] bg-black" />
          ) : (
            <img key={peca.url} src={peca.url} alt={peca.titulo}
              className="max-h-full max-w-full rounded-[4px] object-contain animate-in fade-in duration-300" />
          )}
        </div>

        <div className="vd-galeria-voltar absolute top-5 z-10">
          <button type="button" onClick={() => setAberta(null)} className="vd-btn vd-btn-vazado vd-pilula-vidro !h-10"
            data-testid="btn-voltar-grade">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> Grade
          </button>
        </div>
        <div className="absolute right-5 top-5 z-10">{botaoFechar}</div>

        {lista.length > 1 && (
          <>
            <button type="button" onClick={() => ir(-1)} aria-label="Anterior" title="Anterior"
              className="vd-seta vd-galeria-ant absolute top-1/2 z-10 -translate-y-1/2">
              <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
            </button>
            <button type="button" onClick={() => ir(1)} aria-label="Próxima" title="Próxima"
              className="vd-seta vd-galeria-prox absolute top-1/2 z-10 -translate-y-1/2">
              <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
            </button>
          </>
        )}

        <aside className="vd-galeria-legenda vd-vidro absolute right-5 top-1/2 z-10 -translate-y-1/2 p-5"
          key={peca.url}>
          <p className="vd-micro vd-bronze">{peca.categoria}</p>
          {peca.titulo && (
            <h2 className="mt-2 text-[16px] font-light uppercase leading-snug tracking-[0.16em]">{peca.titulo}</h2>
          )}
          <p className="vd-micro vd-num vd-3 mt-4">
            {doisDigitos(aberta + 1)} / {doisDigitos(lista.length)}
          </p>
        </aside>

        {lista.length > 1 && (
          <div className="vd-galeria-tiras vd-faixa-h absolute z-10 flex justify-center gap-2">
            {janela.map((p, k) => {
              const i = inicio + k;
              return (
                <button key={`${p.url}-${i}`} type="button" onClick={() => setAberta(i)}
                  aria-label={`Ver ${p.titulo || `item ${i + 1}`}`}
                  aria-current={i === aberta ? "true" : undefined}
                  className="relative h-[54px] w-[88px] shrink-0 overflow-hidden rounded-[4px] border transition-opacity"
                  style={{ borderColor: i === aberta ? "#fff" : "transparent", opacity: i === aberta ? 1 : 0.6 }}>
                  {miniatura(p)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ---------------- Grade ---------------- */
  const contagem = (c: string) => pecas.filter((p) => p.categoria === c).length;

  return (
    <div className="vd-galeria absolute inset-0 z-20 bg-[#0b0e0b]" data-testid="media-overlay"
      /* O cabeçalho compacto cresce quando há faixa de categorias: o recuo da
         grade sai daqui para o CSS não ter de adivinhar a altura. */
      data-faixa={movel && categorias.length > 1 ? "1" : undefined}>
      {movel && (
        <div className="vd-galeria-topo absolute inset-x-0 top-0 z-10 bg-[#0b0e0b]/95 pb-2"
          style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div className="flex items-center px-4 pb-2">
            <span className="vd-rotulo">Galeria</span>
            <span className="vd-micro vd-num vd-bronze ml-2">{pecas.length}</span>
            <span className="ml-auto">{botaoFechar}</span>
          </div>
          {categorias.length > 1 && (
            <div className="vd-faixa-h flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Categorias">
              {["", ...categorias].map((c) => (
                <button key={c || "todas"} type="button" className="vd-pilula vd-pilula-toque shrink-0"
                  data-on={categoria === c ? "1" : undefined} onClick={() => filtrar(c)}>
                  {c || "Todas"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={gradeRef} className="vd-scroll vd-galeria-rolo absolute inset-0">
        {!lista.length ? (
          <p className="vd-micro vd-3 py-20 text-center">Nenhuma mídia cadastrada.</p>
        ) : (
          <div className="vd-galeria-grade grid">
            {lista.map((p, i) => (
              <button key={`${p.url}-${i}`} type="button" onClick={() => setAberta(i)}
                className="group text-left" aria-label={`Abrir ${p.titulo || p.categoria}`}>
                <span className="relative block aspect-[16/10] overflow-hidden rounded-[6px] bg-white/5">
                  <span className="block h-full w-full transition-transform duration-300 group-hover:scale-[1.04]">
                    {miniatura(p, true)}
                  </span>
                  {p.video && (
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="vd-seta !h-10 !w-10"><Play className="h-4 w-4" strokeWidth={1.5} /></span>
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block truncate text-[11.5px] tracking-[0.04em] vd-2 group-hover:text-white">
                  {p.titulo || p.categoria}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: fechar no topo e o painel de categorias e nomes à direita. */}
      {!movel && (
        <>
          <div className="absolute right-5 top-5 z-10">{botaoFechar}</div>
          <aside className="vd-galeria-cats vd-vidro vd-entra absolute bottom-5 right-5 top-[68px] z-10 flex flex-col overflow-hidden"
            aria-label="Categorias da galeria">
            <div className="flex items-center px-4 py-3">
              <span className="vd-rotulo">Galeria</span>
              <span className="vd-micro vd-num vd-bronze ml-auto">{pecas.length} itens</span>
            </div>
            <div className="vd-scroll vd-linha min-h-0 flex-1 pb-2">
              <button type="button" className="vd-item !py-2.5" data-on={categoria === "" ? "1" : undefined}
                onClick={() => filtrar("")}>
                <span className="vd-micro flex-1">Todas</span>
                <span className="vd-micro vd-num vd-3">{pecas.length}</span>
              </button>
              {categorias.map((c) => (
                <div key={c} className="vd-linha">
                  <button type="button" className="vd-item !py-2.5" data-on={categoria === c ? "1" : undefined}
                    onClick={() => filtrar(c)} aria-pressed={categoria === c}>
                    <span className="vd-micro vd-bronze flex-1">{c}</span>
                    <span className="vd-micro vd-num vd-3">{contagem(c)}</span>
                  </button>
                  <ul className="pb-1.5">
                    {pecas.filter((p) => p.categoria === c).map((p, k) => (
                      <li key={`${p.url}-${k}`}>
                        <button type="button" onClick={() => abrirPeca(p)}
                          className="block w-full truncate px-4 py-1.5 pl-6 text-left text-[11.5px] tracking-[0.03em] vd-2 hover:bg-white/5 hover:text-white">
                          {p.titulo || `${c} ${doisDigitos(k + 1)}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
