import { useEffect, useState } from "react";
import { Globe2, MessageCircle, Plus, X } from "lucide-react";
import type { Unidade } from "@/lib/unidades";
import { torreLabel, type TorreDef } from "@/lib/unidades";
import { formatArea, formatPreco } from "@/lib/tipologias";
import { COR_STATUS, Simbolo, type CanalContato } from "./comum";

export const MAX_COMPARACAO = 3;

/**
 * Comparar plantas: até três unidades lado a lado, fora da cena 3D, com a
 * ficha ALINHADA linha a linha entre as colunas.
 */
export default function ComparadorPlantas({
  unidades, ids, selecionadaId, torres, logoUrl, plantaDe, tourDe, contatoDe,
  onAdicionar, onRemover, onSelecionar, onTour, onFechar,
}: {
  /** Todas as unidades (já com a herança da tipologia aplicada). */
  unidades: Unidade[];
  ids: string[];
  selecionadaId: string | null;
  torres?: TorreDef[];
  logoUrl?: string;
  plantaDe: (u: Unidade) => string | undefined;
  tourDe: (u: Unidade) => string | undefined;
  contatoDe: (u: Unidade) => CanalContato | undefined;
  onAdicionar: (id: string) => void;
  onRemover: (id: string) => void;
  onSelecionar: (id: string) => void;
  onTour: (url: string, titulo: string) => void;
  onFechar: () => void;
}) {
  const [escolhendo, setEscolhendo] = useState(false);
  const escolhidas = ids
    .map((id) => unidades.find((u) => u.id === id))
    .filter((u): u is Unidade => !!u);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (escolhendo) setEscolhendo(false);
      else onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [escolhendo, onFechar]);

  const valor = (v: string | number | undefined, sufixo = "") =>
    v == null || v === "" ? "—" : `${v}${sufixo}`;

  const linhas: [string, (u: Unidade) => string][] = [
    ["Preço", (u) => formatPreco(u.preco)],
    ["Área privativa", (u) => formatArea(u.areaPrivativa)],
    ["Área total", (u) => formatArea(u.areaTotal)],
    ["Quartos", (u) => valor(u.quartos)],
    ["Suítes", (u) => valor(u.suites)],
    ["Vagas", (u) => valor(u.vagas)],
    ["Vista", (u) => valor(u.orientacao)],
    ["Pavimento", (u) => `${u.pavimento}º · ${torreLabel(u.torre, torres)}`],
  ];

  const candidatas = unidades
    .filter((u) => !ids.includes(u.id))
    .sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));

  return (
    <div className="absolute inset-0 z-[35] flex flex-col bg-[#e6e3dc] text-[#1c1f1c]"
      data-testid="comparador-unidades" role="dialog" aria-modal="true" aria-label="Comparar plantas">
      <header className="flex shrink-0 items-center gap-3 px-5 py-4 md:pl-[88px]">
        <Simbolo url={logoUrl} tamanho={22} claro />
        <h2 className="vd-rotulo">Comparar plantas</h2>
        <span className="vd-micro vd-num ml-auto text-[#8a6f4e]">
          {escolhidas.length} de {MAX_COMPARACAO} selecionadas
        </span>
        <button type="button" onClick={onFechar} className="vd-icone-btn vd-icone-btn-claro vd-alvo"
          aria-label="Fechar a comparação" title="Fechar" data-testid="btn-fechar-comparacao">
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </header>

      <div className="vd-scroll min-h-0 flex-1 overflow-x-auto px-5 pb-5 md:pl-[88px]">
        <div className="flex min-h-full gap-px bg-[rgba(28,31,28,.1)]">
          {escolhidas.map((u) => {
            const cor = COR_STATUS[u.status];
            const planta = plantaDe(u);
            const tour = tourDe(u);
            const canal = contatoDe(u);
            const ativa = u.id === selecionadaId;
            return (
              <section key={u.id} className="flex min-w-[262px] flex-[1_1_0] flex-col"
                style={{ background: ativa ? "#fff" : "rgba(255,255,255,.72)" }}
                onClick={() => onSelecionar(u.id)}
                aria-label={`Unidade ${u.numero}`}>
                <div className="flex items-start gap-2 px-4 pb-3 pt-4">
                  <div className="min-w-0">
                    <p className="vd-num text-[16px]">{u.numero}</p>
                    <p className="vd-micro mt-1 flex items-center gap-1.5" style={{ color: cor.claro }}>
                      <span className="vd-ponto" style={{ background: cor.claro }} />
                      {cor.label}
                    </p>
                  </div>
                  <button type="button" className="vd-icone-btn vd-icone-btn-claro vd-alvo ml-auto"
                    onClick={(e) => { e.stopPropagation(); onRemover(u.id); }}
                    aria-label={`Remover a unidade ${u.numero}`} title="Remover">
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>

                <div className="relative mx-4 grid h-[252px] shrink-0 place-items-center overflow-hidden rounded-[4px] bg-[rgba(28,31,28,.04)]">
                  {planta ? (
                    <img src={planta} alt={`Planta da unidade ${u.numero}`} className="absolute inset-0 h-full w-full object-contain p-3" />
                  ) : (
                    <span className="vd-micro text-[rgba(28,31,28,.62)]">Planta não cadastrada</span>
                  )}
                </div>

                <dl className="mt-3 px-4">
                  {linhas.map(([rotulo, ler], i) => (
                    <div key={rotulo} className={`flex items-baseline justify-between gap-3 py-2.5 ${i ? "vd-linha-clara" : ""}`}>
                      <dt className="vd-micro text-[rgba(28,31,28,.66)]">{rotulo}</dt>
                      <dd className="vd-num text-right text-[12.5px]">{ler(u)}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-auto flex gap-2 px-4 pb-4 pt-3">
                  {tour && (
                    <button type="button" className="vd-btn vd-btn-vazado-claro flex-1"
                      onClick={(e) => { e.stopPropagation(); onTour(tour, `Unidade ${u.numero}`); }}>
                      <Globe2 className="h-3.5 w-3.5" strokeWidth={1.5} /> 360°
                    </button>
                  )}
                  {canal && (
                    <a href={canal.href} target="_blank" rel="noreferrer" className="vd-btn vd-btn-tinta flex-1"
                      onClick={(e) => e.stopPropagation()}>
                      <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.5} /> Falar
                    </a>
                  )}
                </div>
              </section>
            );
          })}

          {escolhidas.length < MAX_COMPARACAO && (
            <section className="flex w-[172px] shrink-0 flex-col bg-[rgba(255,255,255,.72)]">
              {!escolhendo ? (
                <button type="button" onClick={() => setEscolhendo(true)}
                  className="flex flex-1 flex-col items-center justify-center gap-3 text-[#1c1f1c]"
                  data-testid="btn-adicionar-comparacao">
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-dashed border-[rgba(28,31,28,.4)]">
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                  </span>
                  <span className="vd-micro">Adicionar</span>
                </button>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center px-3 py-3">
                    <span className="vd-micro">Escolha</span>
                    <button type="button" onClick={() => setEscolhendo(false)}
                      className="vd-icone-btn vd-icone-btn-claro ml-auto" aria-label="Cancelar">
                      <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                  <ul className="vd-scroll max-h-[calc(100dvh-160px)] flex-1">
                    {candidatas.map((u) => (
                      <li key={u.id}>
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[rgba(28,31,28,.05)]"
                          onClick={() => { onAdicionar(u.id); setEscolhendo(false); }}>
                          <span className="vd-ponto" style={{ background: COR_STATUS[u.status].claro }} />
                          <span className="vd-num text-[12px]">{u.numero}</span>
                          <span className="vd-num ml-auto text-[10.5px] text-[rgba(28,31,28,.66)]">
                            {u.areaPrivativa != null ? formatArea(u.areaPrivativa) : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
