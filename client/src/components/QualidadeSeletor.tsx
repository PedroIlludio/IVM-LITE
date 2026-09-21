import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import {
  definirQualidade, detectarPerfil, qualidadeEscolhida,
  type QualidadeOpcao,
} from "@/lib/cesium-setup";

/**
 * Escolha da qualidade de render pelo visitante.
 *
 * A detecção automática acerta na maioria, mas erra nos dois sentidos: um
 * notebook fraco de plantão pede "baixa", e um tablet bom ligado no telão da
 * sala de vendas pede "alta". O override é o que o §7 do plano chama de
 * "porque no plantão de vendas vocês vão querer forçar o alto".
 *
 * RECARREGA A PÁGINA de propósito. MSAA, tamanho do mapa de sombras e FXAA são
 * definidos na CONSTRUÇÃO do Viewer do Cesium — não há como trocá-los a quente
 * sem destruir e recriar a cena inteira, o que custaria um novo download da
 * fotogrametria e do GLB. Recarregar é mais honesto (e mais rápido) do que
 * fingir uma troca ao vivo que na prática refaz tudo.
 */
const OPCOES: { v: QualidadeOpcao; label: string; ajuda: string }[] = [
  { v: "auto", label: "Automática", ajuda: "Decide pelo aparelho" },
  { v: "alto", label: "Alta", ajuda: "Sombras suaves e antisserrilhado" },
  { v: "baixo", label: "Leve", ajuda: "Mais fluidez em aparelho fraco" },
];

export default function QualidadeSeletor() {
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState<QualidadeOpcao>("auto");
  const caixaRef = useRef<HTMLDivElement>(null);

  // Lido no efeito, e não na inicialização do state: a leitura toca
  // `localStorage` e a URL, que não existem numa renderização de servidor.
  useEffect(() => setAtual(qualidadeEscolhida()), []);

  // Fecha ao clicar fora ou no Esc — um menu que só fecha no próprio botão
  // fica preso aberto sobre a cena.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixaRef.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      window.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  function escolher(v: QualidadeOpcao) {
    if (v === atual) return setAberto(false);
    definirQualidade(v);
    window.location.reload();
  }

  const efetivo = atual === "auto" ? detectarPerfil() : atual;

  return (
    <div ref={caixaRef} className="relative">
      <button
        onClick={() => setAberto((o) => !o)}
        className="v-icon-btn"
        data-on={aberto ? "1" : undefined}
        title={`Qualidade do 3D — ${OPCOES.find((o) => o.v === atual)?.label}`}
      >
        <Gauge className="h-4 w-4" />
      </button>

      {aberto && (
        <div className="v-panel absolute right-0 top-11 z-50 w-56 overflow-hidden p-1.5">
          <p className="v-eyebrow px-2 pb-1.5 pt-1">Qualidade do 3D</p>
          {OPCOES.map((o) => (
            <button
              key={o.v}
              onClick={() => escolher(o.v)}
              className={`flex w-full flex-col items-start rounded-[var(--v-r-sm)] px-2 py-1.5 text-left transition-colors ${
                atual === o.v
                  ? "bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                  : "text-[var(--v-ink)] hover:bg-[var(--v-surface-3)]"
              }`}
            >
              <span className="text-[13px] font-medium">
                {o.label}
                {o.v === "auto" && (
                  <span className="v-faint ml-1 text-[11px] font-normal">
                    ({efetivo === "alto" ? "alta" : "leve"} aqui)
                  </span>
                )}
              </span>
              <span className="v-faint text-[11px]">{o.ajuda}</span>
            </button>
          ))}
          <p className="v-faint px-2 pb-1 pt-1.5 text-[10px] leading-relaxed">
            Trocar recarrega a página — a cena é montada com esses ajustes.
          </p>
        </div>
      )}
    </div>
  );
}
