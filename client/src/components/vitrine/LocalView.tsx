import { lazy, Suspense, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Empreendimento } from "@shared/schema";
import type { EditablePoi } from "@/lib/ivm-store";
import { iconeDaCategoria } from "@/lib/poi-icones";
import { CartaoPoi } from "@/components/CartaoPoi";
import { Alca } from "./comum";

/* MapLibre pesa centenas de KB e só é necessário ao abrir a Localização. */
const MapaEntorno = lazy(() => import("@/components/MapaEntorno"));

/**
 * Localização: tela CLARA. O mapa segue sendo o MapLibre do projeto, repintado
 * na paleta areia/água; a lista de pontos fica num painel claro à direita.
 */
export default function LocalView({ emp, centro, nome, cor, poiSelId, onPoiSel, onFoto, onFechar }: {
  emp: Empreendimento;
  centro: { lat: number; lng: number };
  nome: string;
  /** Cor do pino do empreendimento e das rotas. */
  cor: string;
  poiSelId: string | null;
  onPoiSel: (id: string | null) => void;
  onFoto: (url: string) => void;
  onFechar: () => void;
}) {
  const pontos = useMemo(
    () => ((emp.pontosDeInteresse ?? []) as unknown as EditablePoi[])
      .map((p, i) => ({ ...p, id: p.id ?? `poi-${i}` })),
    [emp.pontosDeInteresse],
  );
  const [categoria, setCategoria] = useState("");

  /** Só as categorias com ponto, na ordem do editor; as avulsas no fim. */
  const categorias = useMemo(() => {
    const usadas = new Set(pontos.map((p) => p.categoria).filter(Boolean));
    const ordem = emp.categoriasPoi ?? [];
    return [
      ...ordem.filter((c) => usadas.has(c)),
      ...Array.from(usadas).filter((c) => !ordem.includes(c)),
    ];
  }, [pontos, emp.categoriasPoi]);

  const visiveis = categoria ? pontos.filter((p) => p.categoria === categoria) : pontos;
  const selecionado = pontos.find((p) => p.id === poiSelId) ?? null;

  return (
    <div className="vd-local absolute inset-0 z-20 bg-[#e6e3dc]" data-testid="mapa-entorno-viewport">
      <Suspense fallback={
        <div className="grid h-full w-full place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#8a6f4e]" />
        </div>
      }>
        <MapaEntorno
          centro={centro}
          nomeCentro={nome}
          pois={pontos.map((p) => ({
            id: p.id, name: p.name, categoria: p.categoria, lat: p.lat, lng: p.lng, rota: p.rota,
          }))}
          estiloCategorias={emp.estiloCategoriaPoi}
          cor={cor}
          paleta="areia"
          semControles
          /* A rota enquadrada fica entre a ilha (esquerda) e o painel (direita). */
          respiro={{ top: 48, right: 340, bottom: 48, left: 110 }}
          selecionadoId={poiSelId}
          onSelecionar={onPoiSel}
          className="h-full w-full"
        />
      </Suspense>

      {pontos.length > 0 && (
        <aside className="vd-painel vd-claro vd-entra w-[278px] overflow-hidden"
          aria-label="Pontos de interesse">
          <Alca onFechar={onFechar} />
          <div className="flex items-center px-4 py-3">
            <span className="vd-rotulo">Localização</span>
            <span className="vd-micro vd-num ml-auto text-[#8a6f4e]">{visiveis.length} locais</span>
          </div>

          {categorias.length > 1 && (
            /* Em linhas que quebram: rolando na horizontal, as categorias do
               fim ficavam escondidas atrás da borda do painel. */
            <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-3" role="group" aria-label="Categorias">
              {[["", "Todos"], ...categorias.map((c) => [c, c])].map(([v, rotulo]) => {
                const n = v ? pontos.filter((p) => p.categoria === v).length : pontos.length;
                const Icone = v ? iconeDaCategoria(v, emp.estiloCategoriaPoi) : null;
                return (
                  <button key={v || "todos"} type="button"
                    className="vd-pilula !h-7 !gap-1.5 !px-2.5 !normal-case !tracking-[0.04em] !text-[11px] !font-medium"
                    data-on={categoria === v ? "1" : undefined}
                    data-testid={`poi-cat-${v || "todos"}`}
                    aria-pressed={categoria === v}
                    onClick={() => setCategoria(v)}>
                    {Icone && <Icone className="h-3 w-3" strokeWidth={1.5} />}
                    <span className="first-letter:uppercase">{rotulo}</span>
                    <span className="vd-num opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
          )}

          <ul className="vd-scroll min-h-0 flex-1 pb-2">
            {visiveis.map((p, i) => {
              const Icone = iconeDaCategoria(p.categoria, emp.estiloCategoriaPoi);
              return (
                <li key={p.id} className={i ? "vd-linha" : ""}>
                  <button type="button" className="vd-item" data-on={poiSelId === p.id ? "1" : undefined}
                    data-testid={`poi-item-${i}`}
                    onClick={() => onPoiSel(poiSelId === p.id ? null : p.id)}>
                    <Icone className="h-3.5 w-3.5 shrink-0 text-[#8a6f4e]" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1 truncate text-[12px] tracking-[0.04em]">{p.name}</span>
                    {p.tempo && (
                      <span className="vd-num shrink-0 text-[11px] text-[rgba(28,31,28,.72)]">{p.tempo}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      )}

      <CartaoPoi
        poi={selecionado}
        estilo={emp.estiloCategoriaPoi}
        onFechar={() => onPoiSel(null)}
        onFoto={onFoto}
      />
    </div>
  );
}
