import { useEffect } from "react";
import { ArrowLeft, Globe2, MessageCircle } from "lucide-react";
import type { Unidade } from "@/lib/unidades";
import { torreLabel, type TorreDef } from "@/lib/unidades";
import { formatArea, formatPreco } from "@/lib/tipologias";
import { COR_STATUS, Simbolo, type CanalContato } from "./comum";

/**
 * Comparar plantas: DUAS unidades lado a lado, fora da cena 3D. A ficha é
 * alinhada linha a linha, e as linhas em que as duas diferem ganham destaque —
 * é a diferença que o cliente veio procurar.
 */
export default function ComparadorPlantas({
  unidades, ids, torres, logoUrl, plantaDe, tourDe, contatoDe, onTour, onFechar,
}: {
  /** Todas as unidades (já com a herança da tipologia aplicada). */
  unidades: Unidade[];
  ids: string[];
  torres?: TorreDef[];
  logoUrl?: string;
  plantaDe: (u: Unidade) => string | undefined;
  tourDe: (u: Unidade) => string | undefined;
  contatoDe: (u: Unidade) => CanalContato | undefined;
  onTour: (url: string, titulo: string) => void;
  onFechar: () => void;
}) {
  const escolhidas = ids
    .map((id) => unidades.find((u) => u.id === id))
    .filter((u): u is Unidade => !!u)
    .slice(0, 2);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const valor = (v: string | number | undefined) => (v == null || v === "" ? "—" : String(v));
  const linhas: [string, (u: Unidade) => string][] = [
    ["Preço", (u) => (u.status === "vendida" ? "Vendida" : formatPreco(u.preco))],
    ["Tipologia", (u) => valor(u.tipologia)],
    ["Área privativa", (u) => formatArea(u.areaPrivativa)],
    ["Área total", (u) => formatArea(u.areaTotal)],
    ["Quartos", (u) => valor(u.quartos)],
    ["Suítes", (u) => valor(u.suites)],
    ["Vagas", (u) => valor(u.vagas)],
    ["Vista", (u) => valor(u.orientacao)],
    ["Pavimento", (u) => `${u.pavimento}º · ${torreLabel(u.torre, torres)}`],
  ];
  const [a, b] = escolhidas;
  const plantasIguais = !!a && !!b && plantaDe(a) === plantaDe(b);

  return (
    <div className="absolute inset-0 z-[35] flex flex-col bg-[#e6e3dc] text-[#1c1f1c]"
      data-testid="comparador-unidades" role="dialog" aria-modal="true" aria-label="Comparar plantas">
      <header className="mx-auto flex w-full max-w-[1080px] shrink-0 items-center gap-3 px-5 py-4 md:pl-[88px] xl:pl-5">
        <button type="button" onClick={onFechar} className="vd-btn vd-btn-vazado-claro !h-9 !px-3"
          aria-label="Voltar às unidades" data-testid="btn-fechar-comparacao">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> Unidades
        </button>
        <div className="ml-2 flex min-w-0 items-center gap-2.5">
          <Simbolo url={logoUrl} tamanho={20} claro />
          <h2 className="vd-rotulo truncate">Comparar plantas</h2>
        </div>
        {a && b && (
          <span className="vd-micro vd-num ml-auto hidden text-[#8a6f4e] sm:block">
            {a.numero} × {b.numero}
          </span>
        )}
      </header>

      <div className="vd-scroll min-h-0 flex-1 px-5 pb-6 md:pl-[88px] xl:pl-5">
        {escolhidas.length < 2 ? (
          <p className="vd-micro py-20 text-center text-[rgba(28,31,28,.66)]">
            Selecione duas plantas na lista de unidades.
          </p>
        ) : (
          <div className="mx-auto max-w-[1080px] overflow-hidden rounded-[10px] bg-white shadow-[0_6px_24px_rgba(28,31,28,.08)]">
            {/* Cabeçalho e plantas */}
            <div className="grid grid-cols-2 gap-px bg-[rgba(28,31,28,.08)]">
              {escolhidas.map((u) => {
                const cor = COR_STATUS[u.status];
                const planta = plantaDe(u);
                return (
                  <section key={u.id} className="bg-white p-4 sm:p-6" aria-label={`Unidade ${u.numero}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="vd-num text-[18px] font-light tracking-[0.12em]">Unidade {u.numero}</p>
                      <p className="vd-micro flex items-center gap-1.5" style={{ color: cor.claro }}>
                        <span className="vd-ponto" style={{ background: cor.claro }} />
                        {cor.label}
                      </p>
                    </div>
                    <div className="relative mt-4 h-[200px] overflow-hidden rounded-[6px] bg-[rgba(28,31,28,.04)] sm:h-[300px]">
                      {planta ? (
                        <img src={planta} alt={`Planta da unidade ${u.numero}`}
                          className="absolute inset-0 h-full w-full object-contain p-4" />
                      ) : (
                        <span className="vd-micro absolute inset-0 grid place-items-center text-[rgba(28,31,28,.62)]">
                          Planta não cadastrada
                        </span>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            {plantasIguais && (
              <p className="vd-micro border-t border-[rgba(28,31,28,.08)] bg-[#f6f4ef] px-4 py-2.5 text-center text-[rgba(28,31,28,.7)]">
                As duas unidades têm a mesma planta
              </p>
            )}

            {/* Ficha alinhada: rótulo no meio, valores nas laterais. */}
            <dl>
              {linhas.map(([rotulo, ler]) => {
                const va = ler(a);
                const vb = ler(b);
                const difere = va !== vb;
                return (
                  <div key={rotulo} data-different={difere ? "1" : undefined}
                    className={`grid grid-cols-[1fr_auto_1fr] items-center border-t border-[rgba(28,31,28,.08)] ${difere ? "bg-[rgba(201,160,106,.1)]" : ""}`}>
                    <dd className="vd-num px-4 py-3 text-[13px] sm:px-6">{va}</dd>
                    <dt className={`vd-micro px-2 text-center ${difere ? "text-[#8a6f4e]" : "text-[rgba(28,31,28,.62)]"}`}>
                      {rotulo}
                    </dt>
                    <dd className="vd-num px-4 py-3 text-right text-[13px] sm:px-6">{vb}</dd>
                  </div>
                );
              })}
            </dl>

            {/* Ações por unidade */}
            <div className="grid grid-cols-2 gap-px border-t border-[rgba(28,31,28,.08)] bg-[rgba(28,31,28,.08)]">
              {escolhidas.map((u) => {
                const tour = tourDe(u);
                const canal = contatoDe(u);
                return (
                  <div key={u.id} className="flex gap-2 bg-white p-4 sm:px-6">
                    {tour && (
                      <button type="button" className="vd-btn vd-btn-vazado-claro flex-1"
                        onClick={() => onTour(tour, `Unidade ${u.numero}`)}>
                        <Globe2 className="h-3.5 w-3.5" strokeWidth={1.5} /> 360°
                      </button>
                    )}
                    {canal && (
                      <a href={canal.href} target="_blank" rel="noreferrer" className="vd-btn vd-btn-tinta flex-1">
                        <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.5} /> Falar
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
