import { useCallback, useMemo, useState } from "react";
import type { Empreendimento } from "@shared/schema";
import { normalizarLista } from "@/lib/ivm-store";
import type { Unidade } from "@/lib/unidades";
import { formatArea, unidadesComTipologia } from "@/lib/tipologias";
import TourVirtual from "@/components/TourVirtual";
import { Alca, CabecalhoCartao } from "@/components/vitrine/comum";
import {
  ChevronUp, Maximize, Scan, MoveVertical, ArrowUpDown, Car, PencilRuler, Trees, Sofa,
  Orbit, ExternalLink, type LucideIcon,
} from "lucide-react";

/**
 * Ficha técnica do empreendimento — o cartão de vidro da seção "Projeto".
 *
 * Substitui a gaveta lateral opaca. A cena 3D continua atrás: o cartão ocupa
 * só a faixa direita, do topo até acima do controle de clima.
 */
export default function EmpreendimentoPanel({ emp, unidades, onFechar }: {
  emp: Empreendimento;
  unidades: Unidade[];
  onFechar: () => void;
}) {
  const [tourAberto, setTourAberto] = useState(false);
  // Estável: o TourVirtual reinicia o carregamento quando o `onClose` muda.
  const fecharTour = useCallback(() => setTourAberto(false), []);

  const comTipo = useMemo(
    () => unidadesComTipologia(unidades, emp.tipologias ?? []),
    [unidades, emp.tipologias],
  );

  /** Faixa "mín–máx" de um atributo das unidades, ou nada. */
  const faixa = (vals: (number | undefined)[], fmt: (n: number) => string) => {
    const v = vals.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (!v.length) return undefined;
    const [a, b] = [Math.min(...v), Math.max(...v)];
    return a === b ? fmt(a) : `${fmt(a)} a ${fmt(b)}`;
  };

  const preenchido = (v?: string) => (v && v.trim() && v.trim() !== "-" ? v.trim() : undefined);

  /** O número do campo, quando há um ("3 torres" → 3); senão o texto. */
  const numeroDe = (v?: string | number) => {
    if (v == null) return undefined;
    const s = String(v).trim();
    if (!s || s === "-") return undefined;
    return s.match(/\d+/)?.[0] ?? s;
  };

  const numeros = ([
    ["Unidades", numeroDe(emp.unidades ?? (unidades.length || undefined))],
    ["Torres", numeroDe(emp.torres)],
    ["Pavimentos", numeroDe(emp.pavimentos)],
  ] as [string, string | undefined][]).filter((n): n is [string, string] => !!n[1]);

  const tipologias = emp.tipologias ?? [];
  const areas = faixa(comTipo.map((u) => u.areaPrivativa), (n) => formatArea(n).replace(" m²", ""));
  const linhas = ([
    [Maximize, "Terreno", preenchido(emp.terreno)],
    [Scan, "Tipologias", areas ? `${areas} m²` : tipologias.length ? `${tipologias.length} plantas` : undefined],
    [MoveVertical, "Pé-direito", preenchido(emp.peDireito)],
    [ArrowUpDown, "Elevadores", preenchido(emp.elevadores)],
    [Car, "Vagas", faixa(comTipo.map((u) => u.vagas), String)],
    [PencilRuler, "Arquitetura", preenchido(emp.arquitetura)],
    [Trees, "Paisagismo", preenchido(emp.paisagismo)],
    [Sofa, "Interiores", preenchido(emp.interiores)],
  ] as [LucideIcon, string, string | undefined][]).filter((l) => !!l[2]);

  const destaques = normalizarLista(emp.highlights);

  return (
    <aside
      className="vd-painel vd-vidro vd-entra w-[308px] overflow-hidden"
      data-testid="panel-empreendimentos"
      aria-label="Ficha técnica do projeto"
    >
      <Alca onFechar={onFechar} />
      <CabecalhoCartao
        rotulo="Projeto"
        acao={
          <button type="button" onClick={onFechar} className="vd-icone-btn vd-alvo"
            title="Recolher" aria-label="Recolher a ficha do projeto">
            <ChevronUp className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
      />

      <div className="vd-scroll min-h-0 flex-1">
        {emp.thumbnailUrl && (
          <div className="relative h-[132px] w-full overflow-hidden">
            <img src={emp.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0"
              style={{ background: "linear-gradient(to top, rgba(16,20,16,.86), transparent 70%)" }} />
            <div className="absolute inset-x-4 bottom-3">
              {emp.neighborhood && <p className="vd-micro vd-bronze">{emp.neighborhood}</p>}
              <h2 className="mt-1 text-[14px] font-light uppercase tracking-[0.16em]">{emp.name}</h2>
            </div>
          </div>
        )}
        {!emp.thumbnailUrl && (
          <div className="px-4 pb-1">
            {emp.neighborhood && <p className="vd-micro vd-bronze">{emp.neighborhood}</p>}
            <h2 className="mt-1 text-[14px] font-light uppercase tracking-[0.16em]">{emp.name}</h2>
          </div>
        )}

        {emp.descricao && (
          <p className="vd-corpo vd-2 px-4 pt-4">{emp.descricao}</p>
        )}

        {numeros.length > 0 && (
          <div
            className="mx-4 mt-4 grid gap-px overflow-hidden rounded-[6px]"
            style={{ gridTemplateColumns: `repeat(${numeros.length}, minmax(0, 1fr))`, background: "rgba(255,255,255,.07)" }}
          >
            {numeros.map(([rotulo, valor]) => (
              <div key={rotulo} className="px-2 py-3 text-center" style={{ background: "rgba(16,20,16,.55)" }}>
                <p className="vd-num-grande">{valor}</p>
                <p className="vd-micro vd-3 mt-1">{rotulo}</p>
              </div>
            ))}
          </div>
        )}

        {linhas.length > 0 && (
          <ul className="mt-3 px-4">
            {linhas.map(([Icone, rotulo, valor], i) => (
              <li key={rotulo} className={`flex items-center gap-3 py-3 ${i ? "vd-linha" : ""}`}>
                <Icone className="h-3.5 w-3.5 shrink-0 vd-bronze" strokeWidth={1.5} />
                <span className="text-[11.5px] tracking-[0.05em] vd-2">{rotulo}</span>
                <span className="vd-num ml-auto text-right text-[12px] font-medium">{valor}</span>
              </li>
            ))}
          </ul>
        )}

        {destaques.length > 0 && (
          <div className="vd-linha mx-4 mt-1 pt-4">
            <p className="vd-micro vd-3 mb-2">Destaques</p>
            <ul className="space-y-2">
              {destaques.map((d) => (
                <li key={d.id} className="flex items-baseline gap-2.5 text-[12px] leading-relaxed vd-2">
                  <span className="vd-ponto translate-y-[-1px]" style={{ background: "var(--vd-bronze)" }} />
                  {d.titulo}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(emp.tourVirtualUrl || emp.website) && (
          <div className="px-4 pb-4 pt-5">
            {emp.tourVirtualUrl ? (
              <button type="button" onClick={() => setTourAberto(true)} className="vd-btn vd-btn-vazado w-full">
                <Orbit className="h-3.5 w-3.5" strokeWidth={1.5} /> Tour virtual 360°
              </button>
            ) : (
              <a href={emp.website} target="_blank" rel="noopener noreferrer" className="vd-btn vd-btn-vazado w-full">
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} /> Visitar site
              </a>
            )}
          </div>
        )}
        <div className="h-2" />
      </div>

      <TourVirtual
        url={emp.tourVirtualUrl ?? ""}
        open={tourAberto}
        onClose={fecharTour}
        nomeEmpreendimento={emp.name}
      />
    </aside>
  );
}
