import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface OpcaoVidro<T extends string> {
  valor: T;
  rotulo: string;
}

/**
 * Seletor no visual de vidro.
 *
 * Substitui o `<select>` nativo: a lista que ele abre é desenhada pelo sistema
 * (fundo branco, destaque azul) e não aceita estilo — destoava do resto da
 * vitrine. Teclado: setas navegam, Enter escolhe, Esc fecha.
 */
export default function SelecaoVidro<T extends string>({
  valor, opcoes, onChange, rotulo, icone, variante = "campo", className = "",
}: {
  valor: T;
  opcoes: OpcaoVidro<T>[];
  onChange: (v: T) => void;
  /** Nome acessível do controle. */
  rotulo: string;
  icone?: ReactNode;
  /** `campo`: pílula de largura cheia; `texto`: só o rótulo, para barras compactas. */
  variante?: "campo" | "texto";
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  /**
   * Posição do menu na TELA. Ele vai por portal para o body: dentro dos
   * painéis, que rolam e cortam o que transborda, o menu sairia pela metade.
   */
  const [pos, setPos] = useState<{ top: number; left: number; right: number; largura: number } | null>(null);
  const idLista = useId();
  const atual = opcoes.find((o) => o.valor === valor) ?? opcoes[0];

  useEffect(() => {
    if (!aberto) return;
    setFoco(Math.max(0, opcoes.findIndex((o) => o.valor === valor)));
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!raiz.current?.contains(alvo) && !lista.current?.contains(alvo)) setAberto(false);
    };
    // Rolar o painel por baixo deixaria o menu solto no ar: fecha.
    const rolou = (e: Event) => {
      if (!lista.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    window.addEventListener("scroll", rolou, true);
    window.addEventListener("resize", rolou);
    return () => {
      document.removeEventListener("pointerdown", fora);
      window.removeEventListener("scroll", rolou, true);
      window.removeEventListener("resize", rolou);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  useLayoutEffect(() => {
    if (!aberto) return;
    const r = raiz.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right, largura: r.width });
  }, [aberto]);

  function escolher(v: T) {
    onChange(v);
    setAberto(false);
  }

  function teclar(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (aberto) { e.stopPropagation(); setAberto(false); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!aberto) { setAberto(true); return; }
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setFoco((i) => (i + passo + opcoes.length) % opcoes.length);
    }
    if ((e.key === "Enter" || e.key === " ") && aberto) {
      e.preventDefault();
      escolher(opcoes[foco].valor);
    }
  }

  return (
    <div ref={raiz} className={`relative ${className}`} onKeyDown={teclar}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-label={`${rotulo}: ${atual?.rotulo ?? ""}`}
        className={variante === "campo"
          ? "vd-campo flex items-center gap-2 text-left"
          : "vd-micro flex items-center gap-1 vd-2 hover:text-white"}
      >
        {icone}
        <span className="min-w-0 flex-1 truncate">{atual?.rotulo}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} strokeWidth={1.5} />
      </button>

      {aberto && pos && createPortal(
        <div className="vitrine">
        <ul
          ref={lista}
          id={idLista}
          role="listbox"
          aria-label={rotulo}
          className="vd-menu vd-scroll fixed z-[10001] py-1"
          style={{
            top: pos.top,
            maxHeight: Math.min(260, window.innerHeight - pos.top - 12),
            ...(variante === "campo"
              ? { left: pos.left, width: pos.largura }
              : { right: pos.right, minWidth: 168 }),
          }}
        >
          {opcoes.map((o, i) => {
            const sel = o.valor === valor;
            return (
              <li key={o.valor} role="option" aria-selected={sel}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => escolher(o.valor)}
                  onPointerEnter={() => setFoco(i)}
                  data-foco={i === foco ? "1" : undefined}
                  data-on={sel ? "1" : undefined}
                  className="vd-menu-item"
                >
                  <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                  {sel && <Check className="h-3 w-3 shrink-0 vd-bronze" strokeWidth={2} />}
                </button>
              </li>
            );
          })}
        </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
