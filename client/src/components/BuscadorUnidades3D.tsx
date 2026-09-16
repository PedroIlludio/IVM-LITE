import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, Globe2, Layers, MessageCircle, X } from "lucide-react";
import type { ContatoCfg } from "@/lib/ivm-store";
import type { Scene3DHandle } from "@/components/Scene3D";
import { niveisDe, SEA_HEADING, DEFAULT_PAV_CFG, type PavimentosCfg, type NivelDef } from "@/lib/pavimentos";
import { corteDoNivel } from "@/lib/unidades3d";
import { torresDe, torreLabel, type TorreDef, type Unidade } from "@/lib/unidades";
import { CAMERA_UNIDADE_PADRAO, type Tipologia } from "@shared/schema";
import {
  formatArea, formatPreco, tipologiaDaUnidade, unidadesComTipologia,
} from "@/lib/tipologias";
import {
  Alca, CabecalhoCartao, COR_STATUS, canaisDeContato, precoAbreviado,
} from "@/components/vitrine/comum";

/**
 * Como o visitante está olhando a unidade escolhida.
 *
 * - `volume`  — o prédio inteiro, com a caixa da unidade acesa;
 * - `corte`   — o andar cortado, visto DE FORA e de cima;
 * - `vista`   — a vista real a partir do andar, com a câmera DENTRO da torre.
 *
 * Os dois primeiros olham de fora e pedem navegação de maquete; o terceiro é
 * um ponto de vista, e ali orbitar não faz sentido nenhum.
 */
export type ModoFoco = "corte" | "vista" | "volume";

/** A planta que vale para a unidade: a DELA, depois a do tipo (e a axonométrica legada). */
export function plantaDaUnidade(u: Unidade, tipologias: Tipologia[]): string | undefined {
  const t = tipologiaDaUnidade(u, tipologias);
  return u.plantaUrl ?? t?.plantaUrl ?? t?.axonometricaUrl;
}

interface BuscadorUnidades3DProps {
  sceneRef: React.RefObject<Scene3DHandle | null>;
  /** Canais de contato do projeto; sem eles o "Falar" não aparece. */
  contato?: ContatoCfg;
  /** Nome do empreendimento, usado no texto da mensagem de contato. */
  nomeEmpreendimento?: string;
  unidades: Unidade[];
  /** Tipologias do projeto — trazem planta e atributos herdados. */
  tipologias?: Tipologia[];
  torres?: TorreDef[];
  /** Nível aberto, para a página deitar a planta dele no chão. */
  onNivel?: (n: NivelDef | null) => void;
  pavCfg?: Partial<PavimentosCfg>;
  /** Níveis editados no editor; sem eles, cai na escada da calibração. */
  niveis?: NivelDef[];
  onClose: () => void;
  /** Unidade escolhida no 3D (a página controla, para a cena receber as caixas). */
  selecionadaId?: string | null;
  onSelecionar?: (u: Unidade | null) => void;
  /** Modo de foco em curso — ver `setModo`. */
  onModo?: (m: ModoFoco) => void;
  /** Unidades que passam no filtro — a página usa para montar as caixas. */
  onFiltrar?: (ids: string[]) => void;
  /** Abre a tela Comparar plantas. */
  onComparar: (incluirId?: string) => void;
  /** Abre um tour 360 em tela cheia. */
  onTour: (url: string, titulo: string) => void;
}

/**
 * Unidades: lista de vidro à direita e cartão da unidade escolhida no canto
 * inferior direito. Escolher uma unidade isola a caixa dela no espelho 3D e
 * enquadra a câmera; o "pavimento" corta o prédio naquele andar.
 *
 * Sem etiquetas de número sobre a torre — foram removidas por ruído visual.
 */
export default function BuscadorUnidades3D({
  sceneRef,
  contato,
  nomeEmpreendimento = "",
  unidades: unidadesProp,
  tipologias = [],
  torres,
  onNivel,
  pavCfg,
  niveis: niveisProp,
  onClose,
  selecionadaId,
  onSelecionar,
  onModo,
  onFiltrar,
  onComparar,
  onTour,
}: BuscadorUnidades3DProps) {
  /**
   * Área, quartos, suítes e vagas resolvidos ANTES de qualquer leitura: a
   * unidade que não os declara herda os da sua tipologia.
   */
  const unidades = useMemo(
    () => unidadesComTipologia(unidadesProp, tipologias),
    [unidadesProp, tipologias],
  );

  const TORRES = useMemo(() => torresDe(unidades, torres), [unidades, torres]);
  const niveis = useMemo(() => niveisDe(pavCfg ?? {}, niveisProp), [pavCfg, niveisProp]);
  const cfg = useMemo(() => ({ ...DEFAULT_PAV_CFG, ...pavCfg }), [pavCfg]);

  const [torre, setTorre] = useState("");
  const [modo, setModoInterno] = useState<ModoFoco>("volume");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  /**
   * Troca o modo e AVISA a página: o modo decide a navegação da câmera (em
   * "vista" ela pousa DENTRO da torre, e ali orbitar não serve).
   */
  function setModo(m: ModoFoco) {
    setModoInterno(m);
    onModo?.(m);
  }

  /** Faixa de área: um corte mínimo, em metros inteiros. */
  const limitesArea = useMemo(() => {
    const v = unidades.map((u) => u.areaPrivativa).filter((a): a is number => typeof a === "number" && Number.isFinite(a));
    return v.length ? [Math.floor(Math.min(...v)), Math.ceil(Math.max(...v))] as [number, number] : null;
  }, [unidades]);
  const [areaMin, setAreaMin] = useState<number | null>(null);
  const assinaturaArea = limitesArea?.join("-") ?? "";
  // Só volta ao mínimo quando o LIMITE muda de valor — um refresh do CRM não
  // pode desfazer o filtro do visitante.
  useEffect(() => { setAreaMin(limitesArea?.[0] ?? null); }, [assinaturaArea]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = useMemo(
    () => unidades.find((u) => u.id === selecionadaId) ?? null,
    [unidades, selecionadaId],
  );

  const disponiveis = unidades.filter((u) => u.status === "disponivel").length;

  const resultados = useMemo(() => {
    const filtroArea = limitesArea && areaMin != null && areaMin > limitesArea[0];
    return unidades
      .filter((u) => !torre || u.torre === torre)
      // Sem área cadastrada, a unidade só some quando o filtro foi mexido.
      .filter((u) => !filtroArea || (u.areaPrivativa != null && u.areaPrivativa >= (areaMin as number)))
      .sort((a, b) => b.pavimento - a.pavimento || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
  }, [unidades, torre, areaMin, limitesArea]);

  // Publica o filtro para a página montar as caixas do espelho 3D.
  useEffect(() => {
    onFiltrar?.(resultados.map((u) => u.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultados]);

  /**
   * A unidade pode chegar selecionada antes deste painel existir, ou por
   * clique na caixa da cena. Não houve clique na lista para disparar o voo da
   * câmera, então enquadramos aqui — esperando as caixas entrarem na cena.
   */
  useEffect(() => {
    if (!sel) return;
    setModo("volume");
    let cancelado = false;
    let timer: number | undefined;
    const focar = (tentativa = 0) => {
      if (cancelado) return;
      sceneRef.current?.cutAtFloor(null);
      const enquadrou = sceneRef.current?.frameUnit(sel.id, sel.camera ?? CAMERA_UNIDADE_PADRAO);
      if (!enquadrou && tentativa < 8) timer = window.setTimeout(() => focar(tentativa + 1), 80);
    };
    const frame = window.requestAnimationFrame(() => focar());
    // A linha escolhida entra na área visível da lista.
    const frameLista = window.requestAnimationFrame(() => {
      listaRef.current?.querySelector<HTMLElement>('[data-on="1"]')
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => {
      cancelado = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(frameLista);
      if (timer != null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, sceneRef]);

  // Limpa o corte ao sair, para não deixar o prédio "cortado" na cena.
  useEffect(() => () => { sceneRef.current?.cutAtFloor(null); }, [sceneRef]);

  /** Nível de uma unidade — casando TORRE e pavimento, nesta ordem. */
  const nivelDe = (u: Unidade) =>
    niveis.find((n) => n.torreId === u.torre && n.pavimento === u.pavimento) ??
    niveis.find((n) => !n.torreId && n.pavimento === u.pavimento);

  /** Volume da unidade no espelho 3D, ou o andar cortado visto de cima. */
  function ver(u: Unidade, como: ModoFoco) {
    setModo(como);
    if (como === "volume") {
      onNivel?.(null);
      sceneRef.current?.cutAtFloor(null);
      sceneRef.current?.frameUnit(u.id, u.camera ?? CAMERA_UNIDADE_PADRAO);
      return;
    }
    const nivel = nivelDe(u);
    // Sem nível correspondente, um enquadramento externo ainda é uma resposta.
    if (!nivel) {
      onNivel?.(null);
      sceneRef.current?.cutAtFloor(null);
      sceneRef.current?.viewCutExternal();
      return;
    }
    onNivel?.(nivel);
    const corte = corteDoNivel(nivel);
    sceneRef.current?.cutAtFloor(corte);
    if (como === "vista") sceneRef.current?.viewFromFloor(nivel.camH, cfg.viewHeading ?? SEA_HEADING);
    else if (corte) sceneRef.current?.viewCorteDeCima(
      corte, (nivel.camDist ?? cfg.camDist) * 1.2, nivel.camPitch ?? cfg.camPitch,
      nivel.camGiro ?? cfg.camGiro, 1.4, nivel.plantaArea,
    );
    else sceneRef.current?.viewCutExternal();
  }

  /**
   * Desfaz a escolha inteira — corte, isolamento e enquadramento. Fechar o
   * cartão tem de desfazer o que abri-lo fez.
   */
  function mostrarTodas() {
    setModo("volume");
    onNivel?.(null);
    onSelecionar?.(null);
    sceneRef.current?.cutAtFloor(null);
    sceneRef.current?.frameBuilding();
  }

  const tipDe = (u: Unidade) => tipologiaDaUnidade(u, tipologias);
  const canalGeral = canaisDeContato(contato, nomeEmpreendimento)[0];

  return (
    <>
      <aside
        className="vd-painel vd-unidades vd-vidro vd-entra v-unit-search w-[298px] overflow-hidden"
        data-com-cartao={sel ? "1" : undefined}
        aria-label="Unidades"
      >
        <Alca onFechar={onClose} />
        <CabecalhoCartao
          rotulo="Unidades"
          extra={
            <span className="vd-micro vd-num vd-bronze" title="Disponíveis / total">
              <span className="max-md:hidden">{disponiveis} / {unidades.length}</span>
              <span className="md:hidden">{unidades.length} unidades / {disponiveis} livres</span>
            </span>
          }
          acao={
            <button type="button" onClick={onClose} className="vd-icone-btn vd-alvo"
              title="Fechar" aria-label="Fechar unidades">
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          }
        />

        <div className="shrink-0 space-y-3 px-4 pb-3">
          {TORRES.length > 1 && (
            <div className="vd-scroll flex gap-1.5 overflow-x-auto" role="group" aria-label="Bloco">
              {[{ id: "", label: "Todos" }, ...TORRES].map((t) => (
                <button key={t.id || "todos"} type="button" className="vd-pilula !h-7 shrink-0 !px-3"
                  data-on={torre === t.id ? "1" : undefined} onClick={() => setTorre(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {limitesArea && areaMin != null && limitesArea[0] < limitesArea[1] && (
            <label className="block">
              <span className="flex items-baseline justify-between">
                <span className="vd-micro vd-3">Área</span>
                <span className="vd-num text-[11px] vd-2">a partir de {areaMin} m²</span>
              </span>
              <input type="range" className="vd-range" min={limitesArea[0]} max={limitesArea[1]} step={1}
                value={areaMin} onChange={(e) => setAreaMin(Number(e.target.value))}
                aria-label="Área mínima" aria-valuetext={`${areaMin} metros quadrados`} />
            </label>
          )}

          {unidades.length >= 2 && (
            <button type="button" className="vd-btn vd-btn-vazado !h-9 w-full"
              onClick={() => onComparar(sel?.id)} data-testid="btn-comparar-unidades">
              <Columns3 className="h-3.5 w-3.5" strokeWidth={1.5} /> Comparar plantas
            </button>
          )}
        </div>

        <ul ref={listaRef} className="vd-scroll vd-linha min-h-0 flex-1">
          {resultados.length === 0 && (
            <li className="vd-micro vd-3 px-4 py-10 text-center">Nenhuma unidade com esses filtros.</li>
          )}
          {resultados.map((u) => {
            const cor = COR_STATUS[u.status];
            const resumo = [
              u.areaPrivativa != null ? formatArea(u.areaPrivativa) : null,
              `${u.pavimento}º`,
              torreLabel(u.torre, torres),
            ].filter(Boolean).join(" · ");
            return (
              <li key={u.id}>
                <button type="button" className="vd-item" data-on={sel?.id === u.id ? "1" : undefined}
                  data-testid={`unidade-card-${u.id}`}
                  aria-label={`Unidade ${u.numero}, ${cor.label}`}
                  onClick={() => onSelecionar?.(sel?.id === u.id ? null : u)}>
                  <span className="vd-ponto" style={{ background: cor.escuro }} title={cor.label} />
                  <span className="min-w-0 flex-1">
                    <span className="vd-num block text-[13px] font-medium">{u.numero}</span>
                    <span className="vd-num mt-0.5 block truncate text-[10.5px] tracking-[0.04em] vd-3">{resumo}</span>
                  </span>
                  <span className="vd-num shrink-0 text-[12px] vd-2">
                    {u.status === "vendida" ? "—" : precoAbreviado(u.preco)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {canalGeral && (
          <div className="shrink-0 p-3 md:hidden">
            <a href={canalGeral.href} target="_blank" rel="noreferrer"
              className="vd-btn vd-btn-bronze !h-[46px] w-full">
              <MessageCircle className="h-4 w-4" strokeWidth={1.5} /> Falar com o corretor
            </a>
          </div>
        )}
      </aside>

      {sel && (() => {
        const cor = COR_STATUS[sel.status];
        const tip = tipDe(sel);
        const planta = plantaDaUnidade(sel, tipologias);
        const canal = canaisDeContato(contato, nomeEmpreendimento, sel.numero)[0];
        const resumo = [
          tip?.nome ?? sel.tipologia,
          sel.quartos != null ? `${sel.quartos} quartos` : null,
          sel.suites != null ? `${sel.suites} suítes` : null,
          sel.vagas != null ? `${sel.vagas} vagas` : null,
          sel.areaPrivativa != null ? formatArea(sel.areaPrivativa) : null,
          `${sel.pavimento}º pav. · ${torreLabel(sel.torre, torres)}`,
        ].filter(Boolean).join(" · ");
        return (
          <section className="vd-unidade-card vd-vidro vd-entra vd-scroll p-4" key={sel.id}
            aria-label={`Unidade ${sel.numero}`} data-testid="cartao-unidade">
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <p className="vd-num text-[16px] font-light tracking-[0.08em]">Unidade {sel.numero}</p>
                <p className="vd-micro mt-1 flex items-center gap-1.5" style={{ color: cor.escuro }}>
                  <span className="vd-ponto" style={{ background: cor.escuro }} />
                  {cor.label}
                </p>
              </div>
              <div className="ml-auto flex shrink-0">
                <button type="button" className="vd-icone-btn vd-alvo"
                  data-on={modo === "corte" ? "1" : undefined}
                  onClick={() => ver(sel, modo === "corte" ? "volume" : "corte")}
                  title={modo === "corte" ? "Voltar à unidade" : "Ver o pavimento"}
                  aria-label={modo === "corte" ? "Voltar à unidade" : "Ver o pavimento"}>
                  <Layers className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button type="button" className="vd-icone-btn vd-alvo"
                  onClick={() => onComparar(sel.id)} title="Comparar" aria-label="Comparar esta planta">
                  <Columns3 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button type="button" className="vd-icone-btn vd-alvo" onClick={mostrarTodas}
                  title="Fechar" aria-label="Fechar a unidade" data-testid="btn-mostrar-todas">
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {planta && (
              <button type="button" onClick={() => setLightbox(planta)}
                className="vd-planta mt-3 block h-[150px] w-full overflow-hidden rounded-[6px]"
                title="Ampliar a planta" aria-label="Ampliar a planta">
                <img src={planta} alt={`Planta da unidade ${sel.numero}`} className="h-full w-full object-contain p-2" />
              </button>
            )}

            <p className="vd-num mt-3 text-[19px] font-extralight">
              {sel.status === "vendida" ? "Vendida" : formatPreco(sel.preco)}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed tracking-[0.03em] vd-2">{resumo}</p>

            {(tip?.tour360Url || canal) && (
              <div className="mt-4 flex gap-2">
                {tip?.tour360Url && (
                  <button type="button" className="vd-btn vd-btn-vazado flex-1"
                    onClick={() => onTour(tip.tour360Url as string, `Unidade ${sel.numero}`)}>
                    <Globe2 className="h-3.5 w-3.5" strokeWidth={1.5} /> 360°
                  </button>
                )}
                {canal && (
                  <a href={canal.href} target="_blank" rel="noreferrer" className="vd-btn vd-btn-bronze flex-1">
                    <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.5} /> Falar
                  </a>
                )}
              </div>
            )}
          </section>
        );
      })()}

      {lightbox && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 p-6"
          onClick={() => setLightbox(null)} role="dialog" aria-label="Planta ampliada">
          <img src={lightbox} alt="" className="max-h-[88vh] max-w-[92vw] rounded-[6px] bg-white object-contain p-4" />
        </div>,
        document.body,
      )}
    </>
  );
}
