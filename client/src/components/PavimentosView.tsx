import { useEffect, useMemo, useRef, useState } from "react";
import { X, Play, Pause, Layers, Waves, Maximize2, LayoutGrid } from "lucide-react";
import type { Scene3DHandle } from "@/components/Scene3D";
import {
  niveisDe, DEFAULT_PAV_CFG,
  type Pavimento, type PavimentosCfg, type NivelDef,
} from "@/lib/pavimentos";
import {
  loadUnidades, contarStatus, torreLabel, STATUS_META, STATUS_CLARO, type Unidade, type TorreDef,
} from "@/lib/unidades";
import { corteDoNivel } from "@/lib/unidades3d";

interface PavimentosViewProps {
  sceneRef: React.RefObject<Scene3DHandle | null>;
  plantas: { area: string; url: string }[];
  onClose: () => void;
  /** Unidades do projeto; se omitido, busca o espelho do piloto (/api/unidades). */
  unidades?: Unidade[];
  /** Calibração dos pavimentos do modelo; default = a do piloto. */
  pavCfg?: Partial<PavimentosCfg>;
  /** Níveis editados no editor. Quando existem, mandam sobre a calibração. */
  niveis?: NivelDef[];
  /** Torres do projeto — o corte por bloco precisa da pegada delas. */
  torres?: TorreDef[];
  /**
   * Nível em exibição, avisado à página.
   *
   * O corte é aplicado daqui pelo `sceneRef`, mas a planta deitada no chão é
   * uma PROP do Scene3D — quem a monta é a página. Sem este aviso, ela não teria
   * como saber qual pavimento está aberto.
   */
  onNivel?: (n: Pavimento | null) => void;
}

/**
 * Controle "Pavimentos 3D": régua vertical de pavimentos sobre a cena. Ao
 * escolher um andar, corta o modelo naquele nível (Cesium clipping) e voa a
 * câmera para a altura do andar olhando para o mar (vista real). Um "tour de
 * vistas" percorre os andares.
 */
export default function PavimentosView({
  sceneRef, plantas, onClose, unidades: unidadesProp, pavCfg, niveis, torres = [],
  onNivel,
}: PavimentosViewProps) {
  const lista = useMemo(() => niveisDe(pavCfg ?? {}, niveis), [pavCfg, niveis]);
  const [sel, setSel] = useState<Pavimento | null>(null);
  const [fetched, setFetched] = useState<Unidade[]>([]);
  const unidades = unidadesProp ?? fetched;
  const [tour, setTour] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const tourRef = useRef<number | null>(null);

  useEffect(() => {
    if (!unidadesProp) loadUnidades().then(setFetched);
  }, [unidadesProp]);

  const cfg = useMemo(() => ({ ...DEFAULT_PAV_CFG, ...pavCfg }), [pavCfg]);

  /**
   * Clicar no andar → corte, visto de cima.
   *
   * O enquadramento é DERIVADO (centro da área, olhando para baixo, a uma
   * distância fixa): entre um pavimento e o outro só a altura muda, e a troca
   * vira uma subida limpa em vez de um salto de enquadramento.
   */
  const aplicar = (p: Pavimento) => {
    setSel(p);
    onNivel?.(p);
    const corte = corteDoNivel(p);
    sceneRef.current?.cutAtFloor(corte);
    if (!corte) sceneRef.current?.frameBuilding();
    else sceneRef.current?.viewCorteDeCima(
      corte, p.camDist ?? cfg.camDist, p.camPitch ?? cfg.camPitch,
      p.camGiro ?? cfg.camGiro, 1.4,
    );
  };

  /**
   * Tour: percorre os níveis da base para o topo, no mesmo enquadramento.
   *
   * Havia aqui um segundo modo de câmera ("Vista do mar", a partir da altura
   * do andar) que convivia com o corte. Foram removidos os dois botões: a
   * experiência passa a ter UM enquadramento, o definido no editor — que é o
   * que faz a sequência de pavimentos parecer um movimento só.
   */
  useEffect(() => {
    if (!tour) { if (tourRef.current) { clearInterval(tourRef.current); tourRef.current = null; } return; }
    const ordem = [...lista].reverse(); // base → topo
    let i = 0;
    aplicar(ordem[0]);
    tourRef.current = window.setInterval(() => {
      i++;
      if (i >= ordem.length) { setTour(false); return; }
      aplicar(ordem[i]);
    }, 3200);
    return () => { if (tourRef.current) clearInterval(tourRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (lightbox) setLightbox(null); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, lightbox]);

  // A planta escolhida no editor manda; o casamento por nome é o fallback dos
  // projetos que ainda não passaram pela aba Níveis.
  const plantaDe = (n?: Pavimento) =>
    n?.plantaUrl ?? (n?.plantaMatch ? plantas.find((p) => p.area.includes(n.plantaMatch!))?.url : undefined);
  /**
   * Níveis agrupados pelo bloco a que pertencem.
   *
   * Com mais de uma torre, a régua plana virava três “5º Pavimento” iguais,
   * um embaixo do outro: não dava para saber em qual se estava clicando. O
   * cabeçalho do bloco resolve, e some quando só existe um grupo — não há o
   * que diferenciar num prédio único.
   */
  const grupos = useMemo(() => {
    const m = new Map<string, Pavimento[]>();
    for (const n of lista) {
      const k = n.torreId ?? "";
      (m.get(k) ?? m.set(k, []).get(k)!).push(n);
    }
    return Array.from(m.entries()).map(([id, itens]) => ({
      id,
      label: id ? torreLabel(id, torres) : "Empreendimento",
      itens,
    }));
  }, [lista, torres]);
  const mostrarGrupos = grupos.length > 1;

  /**
   * Bloco em foco na régua.
   *
   * Com três torres de onze níveis, uma lista única — mesmo com cabeçalhos —
   * são trinta e três botões rolando: “Pav 1” aparece três vezes e escolher o
   * certo vira contagem. As abas mostram um bloco por vez, e aí cada “Pav 1”
   * pertence visivelmente a um prédio.
   */
  const [blocoAtivo, setBlocoAtivo] = useState<string>("");
  useEffect(() => {
    // Acompanha a seleção vinda de fora (o buscador abre uma unidade e o nível
    // dela pode ser de outro bloco).
    const alvo = sel?.torreId ?? (sel ? "" : null);
    if (alvo != null && grupos.some((g) => g.id === alvo)) setBlocoAtivo(alvo);
    else if (!grupos.some((g) => g.id === blocoAtivo)) setBlocoAtivo(grupos[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, grupos]);
  const grupoAtivo = grupos.find((g) => g.id === blocoAtivo) ?? grupos[0];

  /** Bloco do nível em foco, para o cartão dizer de qual torre ele é. */
  const blocoDoSel = sel?.torreId ? torreLabel(sel.torreId, torres) : null;

  /**
   * Contagem de disponibilidade do nível, SEMPRE separada por bloco.
   *
   * Somar as torres num “5º Pavimento” dá um número que não é de nenhum andar
   * que o cliente está vendo: são dois andares diferentes, em dois prédios
   * diferentes, que por acaso têm o mesmo número. Quando o nível pertence a um
   * bloco, conta só ele; quando não pertence e há mais de uma torre, a
   * contagem sai discriminada em vez de virar um total sem significado.
   *
   * `!= null` e não a checagem de verdade: o pavimento 0 (térreo) é um andar
   * legítimo e desaparecia da contagem por ser falsy.
   */
  const contagens = useMemo(() => {
    if (sel?.tipo !== "unidades" || sel.pavimento == null) return [];
    const doAndar = unidades.filter((u) => u.pavimento === sel.pavimento);
    if (sel.torreId) {
      const doBloco = doAndar.filter((u) => u.torre === sel.torreId);
      return doBloco.length ? [{ label: "", cont: contarStatus(doBloco) }] : [];
    }
    const ids = Array.from(new Set(doAndar.map((u) => u.torre)));
    if (ids.length <= 1) {
      return doAndar.length ? [{ label: "", cont: contarStatus(doAndar) }] : [];
    }
    return ids.map((t) => ({
      label: torreLabel(t, torres),
      cont: contarStatus(doAndar.filter((u) => u.torre === t)),
    }));
  }, [sel, unidades, torres]);

  return (
    <>
      {/* Cabeçalho: pastilhas flutuantes, sem a faixa de gradiente que
          escurecia o topo da cena inteira. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between p-4">
        <div className="v-glass pointer-events-auto px-4 py-2.5">
          <h2 className="v-title text-[15px]">Pavimentos</h2>
          <p className="v-faint mt-0.5 text-[11px]">Corte por nível</p>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button onClick={() => setTour((t) => !t)} data-testid="btn-tour-vistas"
            className="v-pill" data-on={tour ? "1" : undefined}>
            {tour ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} Tour
          </button>
          <button onClick={onClose} data-testid="btn-pav-close" className="v-icon-btn" title="Fechar">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {/* Régua de pavimentos (esquerda), com um bloco por vez */}
      <div className="v-panel absolute left-4 top-1/2 z-40 flex max-h-[72vh] w-[min(80vw,212px)] -translate-y-1/2 flex-col overflow-hidden">
        {mostrarGrupos && (
          <div className="border-b border-[var(--v-line)] px-4 pb-3 pt-4">
            <span className="v-eyebrow mb-2 block">Bloco</span>
            <div className="flex flex-wrap gap-1.5">
              {grupos.map((g) => (
                <button key={g.id || "geral"} onClick={() => setBlocoAtivo(g.id)}
                  data-testid={`bloco-${g.id || "geral"}`}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                    g.id === grupoAtivo?.id
                      ? "border-[var(--v-accent)] bg-[var(--v-accent)] font-semibold text-white"
                      : "border-[var(--v-line-2)] text-[var(--v-ink-2)] hover:border-[var(--v-ink-3)] hover:text-[var(--v-ink)]"}`}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/*
          A régua é uma LISTA, não uma pilha de botões: sem cartão por item,
          divisória fina entre eles e o ativo marcado por uma barra na borda.
          Onze caixas empilhadas eram exatamente o "blocado".
        */}
        <div className="v-scroll min-h-0 flex-1 overflow-y-auto py-2">
          {(grupoAtivo?.itens ?? []).map((p) => {
            const active = sel?.id === p.id;
            return (
              <button key={p.id} onClick={() => { setTour(false); aplicar(p); }} data-testid={`pav-${p.id}`}
                className={`relative flex w-full items-center gap-2.5 py-2 pl-5 pr-4 text-left transition-colors ${
                  active ? "bg-[var(--v-accent-soft)]" : "hover:bg-[var(--v-surface-3)]"}`}>
                {active && (
                  <span className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-[var(--v-accent)]" />
                )}
                <span className={`min-w-0 flex-1 truncate text-[13px] ${
                  active ? "font-semibold text-[var(--v-accent)]" : "text-[var(--v-ink)]"}`}>
                  {p.label}
                </span>
                {plantaDe(p) && (
                  <LayoutGrid className={`h-3.5 w-3.5 shrink-0 ${
                    active ? "text-[var(--v-accent)]" : "text-[var(--v-ink-3)]"}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cartão de informação do nível (base) */}
      {sel && (
        <div className="v-panel v-in absolute bottom-5 left-1/2 z-40 w-[min(92vw,560px)] -translate-x-1/2 p-5">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="text-[var(--v-accent)]">
                  {sel.tipo === "rooftop" ? <Waves className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
                </span>
                <h3 className="v-title text-[20px]">{sel.label}</h3>
                {/* Com várias torres, o rótulo sozinho é ambíguo. */}
                {blocoDoSel && (
                  <span className="v-chip bg-[var(--v-accent-soft)] text-[var(--v-accent)]">{blocoDoSel}</span>
                )}
              </div>

              {/* Contagem do espelho, uma linha por bloco. */}
              {contagens.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  {contagens.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                      {c.label && <span className="v-eyebrow w-16 shrink-0 truncate">{c.label}</span>}
                      {(["disponivel", "reservada", "vendida"] as const).map((s) => (
                        <span key={s} className="inline-flex items-center gap-1.5 text-[var(--v-ink-2)]">
                          <span className="v-dot" style={{ background: STATUS_CLARO[s] }} />
                          {STATUS_META[s].label}
                          <span className="v-num font-semibold text-[var(--v-ink)]">{c.cont[s]}</span>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Texto do nível: o que foi escrito no editor, e só.
                  Aqui havia três frases FIXAS no código ("Garagem e
                  infraestrutura", "Lazer no rooftop — vista panorâmica do
                  mar"…) escolhidas pelo tipo do nível. Eram copy do piloto
                  vazando para qualquer projeto: um empreendimento sem rooftop
                  de lazer, ou com subsolo que não é garagem, exibia uma
                  descrição simplesmente falsa — e não havia onde corrigir. */}
              {sel.descricao?.trim() && (
                <p className="v-muted mt-2 text-[13px] leading-relaxed">{sel.descricao}</p>
              )}
            </div>
            {/* A planta do nível, ao lado das informações. `contain` sobre um
                fundo claro: a planta é um desenho técnico — recortá-la com
                `cover` cortava justamente a legenda e o contorno. */}
            {plantaDe(sel) && (
              <button onClick={() => setLightbox(plantaDe(sel)!)} data-testid="btn-pav-planta"
                title="Ampliar a planta"
                className="group relative h-[124px] w-[140px] flex-shrink-0 overflow-hidden rounded-[var(--v-r)] border border-[var(--v-line)] bg-[var(--v-surface-3)] transition-colors hover:border-[var(--v-accent)]">
                <img src={plantaDe(sel)} alt={`Planta — ${sel.label}`} className="h-full w-full object-contain p-2" />
                <div className="absolute inset-0 grid place-items-center bg-[#16191c]/25 opacity-0 transition group-hover:opacity-100">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-[var(--v-ink)] shadow-[var(--v-sh-1)]">
                    <Maximize2 className="h-4 w-4" />
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Dica inicial */}
      {!sel && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-40 -translate-x-1/2">
          <p className="v-glass px-5 py-2.5 text-[13px] text-[var(--v-ink-2)]">
            Escolha um pavimento na régua — o prédio é cortado naquele nível
          </p>
        </div>
      )}

      {/* Lightbox da planta */}
      {lightbox && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#16191c]/85 p-6 backdrop-blur-[3px]"
          onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} title="Fechar"
            className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/95 text-[var(--v-ink)] shadow-[var(--v-sh-2)] hover:bg-white">
            <X className="h-5 w-5" />
          </button>
          <img src={lightbox} alt="Planta" onClick={(e) => e.stopPropagation()}
            className="max-h-[86vh] max-w-[92vw] rounded-[var(--v-r-lg)] bg-white object-contain p-4 shadow-[var(--v-sh-3)]" />
        </div>
      )}
    </>
  );
}
