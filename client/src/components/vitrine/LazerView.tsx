import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Globe2, Play, Trees, X } from "lucide-react";
import type { ItemLista } from "@shared/schema";
import Panorama360 from "@/components/Panorama360";
import { doisDigitos } from "./comum";
import SelecaoVidro from "./SelecaoVidro";

/**
 * Lazer como PEÇA DE MÍDIA: imagem ou vídeo do ambiente com a informação ao
 * lado. Regra de produto — o lazer nunca navega na maquete, não há hotspots.
 */
export default function LazerView({ itens }: { itens: ItemLista[] }) {
  const [filtro, setFiltro] = useState("");
  const [atualId, setAtualId] = useState(itens[0]?.id ?? "");
  const [modo, setModo] = useState<"imagem" | "video">("imagem");
  const [panorama, setPanorama] = useState<ItemLista | null>(null);

  const pavimentos = useMemo(
    () => Array.from(new Set(itens.map((i) => i.pavimento?.trim()).filter((p): p is string => !!p))),
    [itens],
  );
  const visiveis = filtro ? itens.filter((i) => i.pavimento?.trim() === filtro) : itens;
  const indice = Math.max(0, visiveis.findIndex((i) => i.id === atualId));
  const item = visiveis[indice] ?? itens[0];
  const temVideo = itens.some((i) => i.videoUrl);
  const mostrandoVideo = modo === "video" && !!item?.videoUrl;

  // Ambiente fora do filtro: cai no primeiro que passa.
  useEffect(() => {
    if (visiveis.length && !visiveis.some((i) => i.id === atualId)) setAtualId(visiveis[0].id);
  }, [filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  const ir = (delta: number) => {
    if (!visiveis.length) return;
    setAtualId(visiveis[(indice + delta + visiveis.length) % visiveis.length].id);
  };

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (panorama) {
        if (e.key === "Escape") setPanorama(null);
        return;
      }
      if (e.key === "ArrowLeft") ir(-1);
      if (e.key === "ArrowRight") ir(1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  if (!item) return null;

  return (
    <div className="absolute inset-0 z-20 overflow-hidden bg-[#101410]" data-testid="lazer-view">
      <div className="absolute inset-0" key={`${item.id}-${mostrandoVideo}`}>
        {mostrandoVideo ? (
          <video src={item.videoUrl} poster={item.imagemUrl} autoPlay muted loop playsInline
            className="h-full w-full object-cover animate-in fade-in duration-500" />
        ) : item.imagemUrl ? (
          <img src={item.imagemUrl} alt={item.titulo}
            className="h-full w-full object-cover animate-in fade-in duration-500" />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Trees className="h-20 w-20 text-white/15" strokeWidth={1} />
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(180deg, rgba(16,20,16,.34) 0%, rgba(16,20,16,.06) 32%, rgba(16,20,16,.72) 100%)" }} />

      {temVideo && (
        <div className="vd-lazer-alternador absolute left-[78px] top-5 z-10 flex gap-1.5" role="group" aria-label="Tipo de mídia">
          <button type="button" className="vd-pilula vd-pilula-vidro"
            data-on={!mostrandoVideo ? "1" : undefined} onClick={() => setModo("imagem")}>
            Imagens
          </button>
          <button type="button" className="vd-pilula vd-pilula-vidro"
            data-on={mostrandoVideo ? "1" : undefined}
            disabled={!item.videoUrl}
            title={item.videoUrl ? undefined : "Este ambiente não tem vídeo"}
            onClick={() => setModo("video")}
            style={!item.videoUrl ? { opacity: 0.45 } : undefined}>
            Vídeo
          </button>
        </div>
      )}

      {visiveis.length > 1 && (
        <div className="vd-lazer-setas pointer-events-none absolute left-[88px] right-[306px] top-1/2 z-10 flex -translate-y-1/2 justify-between">
          <button type="button" onClick={() => ir(-1)} className="vd-seta pointer-events-auto" aria-label="Ambiente anterior" title="Anterior">
            <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => ir(1)} className="vd-seta pointer-events-auto" aria-label="Próximo ambiente" title="Próximo">
            <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Lista de ambientes — termina acima do cartão de info. */}
      <aside className="vd-lazer-lista vd-vidro vd-entra absolute right-5 top-5 z-10 flex w-[266px] flex-col overflow-hidden">
        <div className="flex items-center px-4 py-3">
          <span className="vd-rotulo">Lazer</span>
          <span className="vd-micro vd-num vd-bronze ml-auto">{itens.length} ambientes</span>
        </div>
        {pavimentos.length > 1 && (
          <div className="px-4 pb-2">
            <SelecaoVidro rotulo="Filtrar por pavimento" valor={filtro} onChange={setFiltro}
              opcoes={[
                { valor: "", rotulo: "Todos os pavimentos" },
                ...pavimentos.map((p) => ({ valor: p, rotulo: p })),
              ]} />
          </div>
        )}
        <ul className="vd-scroll min-h-0 flex-1 pb-1">
          {visiveis.map((i) => (
            <li key={i.id}>
              <button type="button" className="vd-item !py-3" data-on={i.id === item.id ? "1" : undefined}
                onClick={() => setAtualId(i.id)} aria-current={i.id === item.id ? "true" : undefined}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] tracking-[0.05em]">{i.titulo}</span>
                  {i.pavimento && <span className="vd-micro vd-3 mt-0.5 block truncate">{i.pavimento}</span>}
                </span>
                {i.id === item.id && <span className="vd-ponto" style={{ background: "var(--vd-bronze)" }} />}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Informação do ambiente — rodapé direito. */}
      <section className="vd-lazer-info vd-vidro vd-entra vd-scroll absolute bottom-6 right-5 z-10 w-[308px] p-5"
        key={item.id} aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <span className="vd-micro vd-bronze">{item.pavimento ?? "Lazer"}</span>
          <span className="vd-micro vd-num vd-3">
            {doisDigitos(indice + 1)} / {doisDigitos(visiveis.length)}
          </span>
        </div>
        <h2 className="mt-2 text-[19px] font-light uppercase leading-snug tracking-[0.18em]">{item.titulo}</h2>
        {item.descricao && <p className="vd-corpo vd-2 mt-3">{item.descricao}</p>}

        {!!item.dados?.length && (
          <dl className="mt-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(item.dados.length, 3)}, minmax(0,1fr))` }}>
            {item.dados.slice(0, 3).map((d) => (
              <div key={d.rotulo}>
                <dt className="vd-micro vd-3">{d.rotulo}</dt>
                <dd className="vd-num mt-1 text-[13px]">{d.valor}</dd>
              </div>
            ))}
          </dl>
        )}

        {(item.videoUrl || item.panoramaUrl) && (
          <div className="mt-5 flex gap-2">
            {item.videoUrl && (
              <button type="button" className="vd-btn vd-btn-vazado flex-1"
                onClick={() => setModo(mostrandoVideo ? "imagem" : "video")}>
                <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
                {mostrandoVideo ? "Ver a imagem" : "Ver o vídeo"}
              </button>
            )}
            {item.panoramaUrl && (
              <button type="button" className="vd-btn vd-btn-vazado flex-1" onClick={() => setPanorama(item)}>
                <Globe2 className="h-3.5 w-3.5" strokeWidth={1.5} /> 360°
              </button>
            )}
          </div>
        )}
      </section>

      {panorama?.panoramaUrl && createPortal(
        <div
          className="vitrine fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          // Só o clique DIRETO no fundo fecha: um arraste que termina fora do
          // panorama não pode fechá-lo no meio do gesto.
          onClick={(e) => { if (e.target === e.currentTarget) setPanorama(null); }}
        >
          <div className="relative h-[85vh] w-[90vw] overflow-hidden rounded-[10px] bg-black">
            <Panorama360 url={panorama.panoramaUrl} titulo={panorama.titulo} />
            <span className="vd-rotulo vd-sombra-texto pointer-events-none absolute left-5 top-4">{panorama.titulo}</span>
            <button type="button" aria-label="Fechar" title="Fechar"
              className="vd-acao absolute right-4 top-4" onClick={() => setPanorama(null)}>
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
