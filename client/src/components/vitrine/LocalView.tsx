import { lazy, Suspense, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { Empreendimento } from "@shared/schema";
import type { EditablePoi } from "@/lib/ivm-store";
import { iconeDaCategoria } from "@/lib/poi-icones";
import { CartaoPoi } from "@/components/CartaoPoi";
import { useMovel, useTablete } from "./comum";

/* MapLibre pesa centenas de KB e só é necessário ao abrir a Localização. */

/** A rota enquadrada fica entre a ilha (esquerda) e o painel (direita). */
const RESPIRO = { top: 48, right: 340, bottom: 48, left: 110 };
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
  /** Volta à cena — no celular a barra de seções some aqui. */
  onFechar: () => void;
}) {
  const pontos = useMemo(
    () => ((emp.pontosDeInteresse ?? []) as unknown as EditablePoi[])
      .map((p, i) => ({ ...p, id: p.id ?? `poi-${i}` })),
    [emp.pontosDeInteresse],
  );
  const [categoria, setCategoria] = useState("");
  /**
   * Referência ESTÁVEL. O mapa refaz enquadramento e animação da rota sempre
   * que esta lista muda; recriada a cada render, qualquer re-render da página
   * puxava a câmera de volta e reiniciava o traçado.
   */
  const poisDoMapa = useMemo(
    () => pontos.map((p) => ({
      id: p.id, name: p.name, categoria: p.categoria, lat: p.lat, lng: p.lng, rota: p.rota,
    })),
    [pontos],
  );
  /**
   * CELULAR: só o mapa. A lista em texto disputava a tela com ele e cobria os
   * pinos; lá a escolha é tocando nos ícones, e o cartão do ponto responde.
   */
  const movel = useMovel();
  /*
   * No celular a lista sai e o alfinete é o único caminho — é a tela toda para
   * um mapa, e uma folha de dez itens comeria metade dela. No tablet em pé não:
   * a folha ocupa o terço de baixo e ainda sobram ~630px de mapa. Tirar a lista
   * lá seria esconder dez endereços com tempo de deslocamento num aparelho que
   * tem espaço de sobra para mostrá-los.
   */
  const listaEmFolha = useTablete();

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
          pois={poisDoMapa}
          estiloCategorias={emp.estiloCategoriaPoi}
          cor={cor}
          paleta="areia"
          semControles
          respiro={RESPIRO}
          selecionadoId={poiSelId}
          onSelecionar={onPoiSel}
          className="h-full w-full"
        />
      </Suspense>

      {pontos.length > 0 && (!movel || listaEmFolha) && (
        <aside className="vd-painel vd-claro vd-entra overflow-hidden"
          aria-label="Pontos de interesse">
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
                    className="vd-pilula vd-pilula-toque !gap-1.5 !px-2.5 !normal-case !tracking-[0.04em] !text-[11px] !font-medium"
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

      {movel && (
        <button type="button" onClick={onFechar} aria-label="Voltar" title="Voltar"
          className="absolute left-3 z-30 grid h-11 w-11 place-items-center rounded-full border border-[rgba(28,31,28,.14)] bg-white/95 text-[#1c1f1c] shadow-[0_6px_24px_rgba(28,31,28,.16)]"
          style={{ top: "max(12px, env(safe-area-inset-top))" }}>
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}

      <CartaoPoi
        poi={selecionado}
        estilo={emp.estiloCategoriaPoi}
        onFechar={() => onPoiSel(null)}
        onFoto={onFoto}
        mostrarBasico={movel}
      />
    </div>
  );
}
