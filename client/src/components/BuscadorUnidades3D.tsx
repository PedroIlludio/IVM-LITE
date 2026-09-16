import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpDown, Check, ChevronDown, Columns2, Globe2, GripHorizontal, Heart, Layers,
  MessageCircle, Search, SlidersHorizontal, X,
} from "lucide-react";
import type { ContatoCfg } from "@/lib/ivm-store";
import type { Scene3DHandle } from "@/components/Scene3D";
import { niveisDe, SEA_HEADING, DEFAULT_PAV_CFG, type PavimentosCfg, type NivelDef } from "@/lib/pavimentos";
import { corteDoNivel } from "@/lib/unidades3d";
import { torresDe, torreLabel, type TorreDef, type Unidade, type UnidadeStatus } from "@/lib/unidades";
import { CAMERA_UNIDADE_PADRAO, type Tipologia } from "@shared/schema";
import {
  faixasDe, formatArea, formatPreco, formatPrecoCurto, tipologiaDaUnidade, unidadesComTipologia,
} from "@/lib/tipologias";
import {
  Alca, CabecalhoCartao, COR_STATUS, canaisDeContato, precoAbreviado,
} from "@/components/vitrine/comum";
import FaixaVidro, { faixaNoPasso } from "@/components/vitrine/FaixaVidro";
import SelecaoVidro from "@/components/vitrine/SelecaoVidro";

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

/** Quantas plantas a comparação aceita. */
export const MAX_COMPARACAO = 2;

/** A planta que vale para a unidade: a DELA, depois a do tipo (e a axonométrica legada). */
export function plantaDaUnidade(u: Unidade, tipologias: Tipologia[]): string | undefined {
  const t = tipologiaDaUnidade(u, tipologias);
  return u.plantaUrl ?? t?.plantaUrl ?? t?.axonometricaUrl;
}

const STATUSES: UnidadeStatus[] = ["disponivel", "reservada", "vendida"];
/** Rótulos curtos do filtro: os quatro precisam caber lado a lado em 266px. */
const ROTULO_STATUS: Record<UnidadeStatus, string> = {
  disponivel: "Livres",
  reservada: "Reservadas",
  vendida: "Vendidas",
};

type Ordem = "numero" | "preco-asc" | "preco-desc" | "area-asc" | "area-desc";
const ORDENS: { valor: Ordem; rotulo: string }[] = [
  { valor: "numero", rotulo: "Andar" },
  { valor: "preco-asc", rotulo: "Menor preço" },
  { valor: "preco-desc", rotulo: "Maior preço" },
  { valor: "area-asc", rotulo: "Menor área" },
  { valor: "area-desc", rotulo: "Maior área" },
];

type Faixa = [number, number];

/** Passo de cada faixa — o mesmo nos limites e no slider (ver `faixaNoPasso`). Preço em centavos. */
const PASSO = { area: 1, preco: 1000, quartos: 1 } as const;

interface BuscadorUnidades3DProps {
  sceneRef: React.RefObject<Scene3DHandle | null>;
  /** Separa os favoritos de um empreendimento dos do outro. */
  projetoId?: string;
  /** Canais de contato do projeto; sem eles o "Falar" não aparece. */
  contato?: ContatoCfg;
  nomeEmpreendimento?: string;
  unidades: Unidade[];
  tipologias?: Tipologia[];
  torres?: TorreDef[];
  /** Nível aberto, para a página deitar a planta dele no chão. */
  onNivel?: (n: NivelDef | null) => void;
  pavCfg?: Partial<PavimentosCfg>;
  niveis?: NivelDef[];
  onClose: () => void;
  /** Unidade escolhida (a página controla, para a cena receber as caixas). */
  selecionadaId?: string | null;
  onSelecionar?: (u: Unidade | null) => void;
  onModo?: (m: ModoFoco) => void;
  /** Unidades que passam no filtro — a página usa para montar as caixas. */
  onFiltrar?: (ids: string[]) => void;
  /** Plantas marcadas para comparar (até duas) — vivem na página. */
  comparacaoIds: string[];
  onComparacaoIds: (ids: string[]) => void;
  /** Abre a tela de comparação com as duas marcadas. */
  onAbrirComparacao: () => void;
  onTour: (url: string, titulo: string) => void;
}

/**
 * Unidades: lista de vidro com busca e filtros à direita; a unidade escolhida
 * abre numa ilha flutuante à esquerda da lista, que o visitante pode arrastar.
 * Escolher uma unidade isola a caixa dela no espelho 3D e enquadra a câmera.
 */
export default function BuscadorUnidades3D({
  sceneRef, projetoId, contato, nomeEmpreendimento = "", unidades: unidadesProp,
  tipologias = [], torres, onNivel, pavCfg, niveis: niveisProp, onClose,
  selecionadaId, onSelecionar, onModo, onFiltrar,
  comparacaoIds, onComparacaoIds, onAbrirComparacao, onTour,
}: BuscadorUnidades3DProps) {
  /** A unidade que não declara área, quartos, vagas… herda da tipologia. */
  const unidades = useMemo(
    () => unidadesComTipologia(unidadesProp, tipologias),
    [unidadesProp, tipologias],
  );

  const TORRES = useMemo(() => torresDe(unidades, torres), [unidades, torres]);
  const niveis = useMemo(() => niveisDe(pavCfg ?? {}, niveisProp), [pavCfg, niveisProp]);
  const cfg = useMemo(() => ({ ...DEFAULT_PAV_CFG, ...pavCfg }), [pavCfg]);

  // --- Filtros ----------------------------------------------------------------
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<UnidadeStatus | "">("");
  const [torre, setTorre] = useState("");
  const [tipologiaId, setTipologiaId] = useState("");
  const [pavimento, setPavimento] = useState<number | null>(null);
  const [ordem, setOrdem] = useState<Ordem>("numero");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const limites = useMemo(() => {
    const f = faixasDe(unidades);
    return {
      area: faixaNoPasso(f.area, PASSO.area),
      preco: faixaNoPasso(f.preco, PASSO.preco),
      quartos: faixaNoPasso(f.quartos, PASSO.quartos),
    };
  }, [unidades]);
  const [fArea, setFArea] = useState<Faixa | null>(null);
  const [fPreco, setFPreco] = useState<Faixa | null>(null);
  const [fQuartos, setFQuartos] = useState<Faixa | null>(null);
  // Só volta aos extremos quando um LIMITE muda de valor: um refresh do CRM
  // não pode desfazer o filtro do visitante.
  const assinaturaLimites = JSON.stringify(limites);
  useEffect(() => {
    setFArea(limites.area);
    setFPreco(limites.preco);
    setFQuartos(limites.quartos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaLimites]);

  /**
   * Favoritos por PROJETO, no navegador: atualizar a página no plantão não
   * pode apagar a lista de interesse do cliente.
   */
  const chaveFavoritos = `ivm-favoritos:${projetoId ?? "sem-projeto"}`;
  const [favoritos, setFavoritos] = useState<Set<string>>(() => {
    try {
      const bruto = localStorage.getItem(chaveFavoritos);
      return new Set<string>(bruto ? (JSON.parse(bruto) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(chaveFavoritos, JSON.stringify(Array.from(favoritos)));
    } catch {
      /* navegação privada: os favoritos valem só nesta sessão */
    }
  }, [favoritos, chaveFavoritos]);
  const [soFavoritos, setSoFavoritos] = useState(false);
  const alternarFavorito = (id: string) => setFavoritos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const pavimentosDisponiveis = useMemo(
    () => Array.from(new Set(unidades.map((u) => u.pavimento))).sort((a, b) => b - a),
    [unidades],
  );
  const tipsUsadas = useMemo(() => {
    const ids = new Set(unidades.map((u) => u.tipologiaId ?? u.tipologia));
    return tipologias.filter((t) => ids.has(t.id) || ids.has(t.nome));
  }, [tipologias, unidades]);

  const faixaMexida = (f: Faixa | null, limite: Faixa | null) =>
    !!f && !!limite && (f[0] !== limite[0] || f[1] !== limite[1]);
  const dentro = (v: number | undefined, f: Faixa | null) =>
    !f || v == null || (v >= f[0] && v <= f[1]);
  /**
   * Preço é o único atributo em que a ausência é significativa: com o slider
   * mexido, "sob consulta" não é barato nem caro, e sai da lista.
   */
  const dentroDoPreco = (u: Unidade) =>
    u.preco == null ? !faixaMexida(fPreco, limites.preco) : dentro(u.preco, fPreco);

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = unidades
      .filter((u) => (!torre || u.torre === torre) && (!status || u.status === status))
      .filter((u) => pavimento == null || u.pavimento === pavimento)
      .filter((u) => !tipologiaId || u.tipologiaId === tipologiaId || u.tipologia === tipologiaId)
      .filter((u) => !soFavoritos || favoritos.has(u.id))
      .filter((u) => dentro(u.areaPrivativa, fArea))
      .filter(dentroDoPreco)
      .filter((u) => dentro(u.quartos, fQuartos))
      .filter((u) => !q || u.numero.toLowerCase().includes(q) || u.tipologia.toLowerCase().includes(q));

    const porAndar = (a: Unidade, b: Unidade) =>
      b.pavimento - a.pavimento || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true });
    // Sem o dado da ordenação, vai para o fim em vez de fingir zero.
    const porCampo = (campo: "preco" | "areaPrivativa", asc: boolean) => (a: Unidade, b: Unidade) => {
      const va = a[campo];
      const vb = b[campo];
      if (va == null && vb == null) return porAndar(a, b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return asc ? va - vb : vb - va;
    };
    const cmp =
      ordem === "preco-asc" ? porCampo("preco", true)
      : ordem === "preco-desc" ? porCampo("preco", false)
      : ordem === "area-asc" ? porCampo("areaPrivativa", true)
      : ordem === "area-desc" ? porCampo("areaPrivativa", false)
      : porAndar;
    return [...lista].sort(cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidades, torre, status, pavimento, tipologiaId, busca, soFavoritos, favoritos, fArea, fPreco, fQuartos, ordem, limites]);

  const nFiltrosAvancados =
    (pavimento != null ? 1 : 0) + (tipologiaId ? 1 : 0)
    + (faixaMexida(fArea, limites.area) ? 1 : 0)
    + (faixaMexida(fPreco, limites.preco) ? 1 : 0)
    + (faixaMexida(fQuartos, limites.quartos) ? 1 : 0);
  const temFiltro = nFiltrosAvancados > 0 || !!torre || !!status || !!busca.trim() || soFavoritos;

  function limparFiltros() {
    setBusca("");
    setStatus("");
    setTorre("");
    setTipologiaId("");
    setPavimento(null);
    setSoFavoritos(false);
    setFArea(limites.area);
    setFPreco(limites.preco);
    setFQuartos(limites.quartos);
  }

  const temAvancados = !!(limites.area || limites.preco || limites.quartos)
    || pavimentosDisponiveis.length > 1 || tipsUsadas.length > 1;

  // Publica o filtro para a página montar as caixas do espelho 3D.
  useEffect(() => {
    onFiltrar?.(resultados.map((u) => u.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultados]);

  // --- Foco na cena -----------------------------------------------------------
  const [modo, setModoInterno] = useState<ModoFoco>("volume");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  /** Troca o modo e AVISA a página — ele decide a navegação da câmera. */
  function setModo(m: ModoFoco) {
    setModoInterno(m);
    onModo?.(m);
  }

  const sel = useMemo(
    () => unidades.find((u) => u.id === selecionadaId) ?? null,
    [unidades, selecionadaId],
  );

  /**
   * A unidade pode chegar escolhida por clique na caixa da cena, sem clique na
   * lista para disparar o voo da câmera: enquadramos aqui, esperando as
   * caixas entrarem na cena.
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
    const frameLista = window.requestAnimationFrame(() => {
      listaRef.current?.querySelector<HTMLElement>('[data-sel="1"]')
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

  // --- Ilha flutuante da unidade ----------------------------------------------
  const [posCartao, setPosCartao] = useState({ x: 0, y: 0 });
  const cartaoRef = useRef<HTMLElement>(null);
  const arraste = useRef<{ px: number; py: number; x: number; y: number; lim: DOMRect; caixa: DOMRect } | null>(null);

  function iniciarArraste(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    // No celular o cartão é folha inferior fixa.
    if (window.matchMedia("(max-width: 767px)").matches) return;
    const caixa = cartaoRef.current?.getBoundingClientRect();
    const lim = cartaoRef.current?.parentElement?.getBoundingClientRect();
    if (!caixa || !lim) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    arraste.current = { px: e.clientX, py: e.clientY, x: posCartao.x, y: posCartao.y, lim, caixa };
  }
  function moverArraste(e: React.PointerEvent) {
    const a = arraste.current;
    if (!a) return;
    // Nunca sai da tela: o deslocamento é limitado às bordas do palco.
    const dx = Math.min(Math.max(e.clientX - a.px, a.lim.left + 8 - a.caixa.left), a.lim.right - 8 - a.caixa.right);
    const dy = Math.min(Math.max(e.clientY - a.py, a.lim.top + 8 - a.caixa.top), a.lim.bottom - 8 - a.caixa.bottom);
    setPosCartao({ x: a.x + dx, y: a.y + dy });
  }
  const soltarArraste = () => { arraste.current = null; };

  /**
   * Desfaz a escolha inteira — corte, isolamento e enquadramento. Fechar o
   * cartão tem de desfazer o que abri-lo fez.
   */
  function mostrarTodas() {
    setModo("volume");
    setPosCartao({ x: 0, y: 0 });
    onNivel?.(null);
    onSelecionar?.(null);
    sceneRef.current?.cutAtFloor(null);
    sceneRef.current?.frameBuilding();
  }

  // --- Comparação -------------------------------------------------------------
  const [comparando, setComparando] = useState(false);
  function entrarNaComparacao(inicial?: string) {
    setComparando(true);
    onComparacaoIds(inicial ? [inicial] : []);
  }
  function sairDaComparacao() {
    setComparando(false);
    onComparacaoIds([]);
  }
  /** A terceira escolha substitui a mais antiga: trocar uma não exige desmarcar. */
  function marcar(id: string) {
    const ids = comparacaoIds;
    if (ids.includes(id)) onComparacaoIds(ids.filter((x) => x !== id));
    else onComparacaoIds(ids.length < MAX_COMPARACAO ? [...ids, id] : [...ids.slice(1), id]);
  }
  const prontas = comparacaoIds.length === MAX_COMPARACAO;

  const tipDe = (u: Unidade) => tipologiaDaUnidade(u, tipologias);
  const canalGeral = canaisDeContato(contato, nomeEmpreendimento)[0];
  const disponiveis = unidades.filter((u) => u.status === "disponivel").length;

  return (
    <>
      <aside className="vd-painel vd-unidades vd-vidro vd-entra v-unit-search w-[298px] overflow-hidden"
        aria-label="Unidades">
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

        <div className="shrink-0 space-y-2.5 px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/60" strokeWidth={1.5} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Nº da unidade ou tipologia" aria-label="Buscar unidade"
              className="vd-campo !pl-8 !pr-8" />
            {temFiltro && (
              <button type="button" onClick={limparFiltros} title="Limpar filtros" aria-label="Limpar filtros"
                className="vd-icone-btn absolute right-1 top-1/2 !h-7 !w-7 -translate-y-1/2">
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            )}
          </div>

          <div className="vd-seg" role="group" aria-label="Disponibilidade">
            {[...STATUSES.map((s) => ({ v: s as string, l: ROTULO_STATUS[s] })), { v: "", l: "Todas" }].map((o) => (
              <button key={o.v || "todas"} type="button" onClick={() => setStatus(o.v as UnidadeStatus | "")}
                data-on={status === o.v ? "1" : undefined}>
                {o.l}
              </button>
            ))}
          </div>

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

          {temAvancados && (
            <button type="button" onClick={() => setFiltrosAbertos((v) => !v)}
              aria-expanded={filtrosAbertos}
              className="vd-micro flex w-full items-center gap-2 py-1 vd-2 hover:text-white">
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
              Filtros{nFiltrosAvancados > 0 && <span className="vd-bronze">({nFiltrosAvancados})</span>}
              <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform ${filtrosAbertos ? "rotate-180" : ""}`} strokeWidth={1.5} />
            </button>
          )}

          {temAvancados && filtrosAbertos && (
            <div className="vd-scroll max-h-[34vh] space-y-3 pb-1">
              {limites.area && fArea && (
                <FaixaVidro label="Área" min={limites.area[0]} max={limites.area[1]} step={PASSO.area}
                  value={fArea} onChange={setFArea} format={(v) => formatArea(Math.round(v))} />
              )}
              {limites.preco && fPreco && (
                <FaixaVidro label="Preço" min={limites.preco[0]} max={limites.preco[1]} step={PASSO.preco}
                  value={fPreco} onChange={setFPreco} format={(v) => `R$ ${formatPrecoCurto(v)}`} />
              )}
              {limites.quartos && fQuartos && limites.quartos[0] < limites.quartos[1] && (
                <FaixaVidro label="Quartos" min={limites.quartos[0]} max={limites.quartos[1]} step={PASSO.quartos}
                  value={fQuartos} onChange={setFQuartos} />
              )}
              {pavimentosDisponiveis.length > 1 && (
                <div>
                  <span className="vd-micro vd-3 mb-1 block">Pavimento</span>
                  <SelecaoVidro rotulo="Pavimento" valor={pavimento == null ? "" : String(pavimento)}
                    onChange={(v) => setPavimento(v === "" ? null : Number(v))}
                    opcoes={[
                      { valor: "", rotulo: "Todos os pavimentos" },
                      ...pavimentosDisponiveis.map((p) => ({ valor: String(p), rotulo: `${p}º pavimento` })),
                    ]} />
                </div>
              )}
              {tipsUsadas.length > 1 && (
                <div>
                  <span className="vd-micro vd-3 mb-1 block">Tipologia</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[{ id: "", nome: "Todas" }, ...tipsUsadas].map((t) => (
                      <button key={t.id || "todas"} type="button" className="vd-pilula !h-7 !px-3"
                        data-on={tipologiaId === t.id ? "1" : undefined} onClick={() => setTipologiaId(t.id)}>
                        {t.nome}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {unidades.length >= 2 && (
            !comparando ? (
              <button type="button" className="vd-btn vd-btn-vazado !h-9 w-full"
                onClick={() => entrarNaComparacao()} data-testid="btn-comparar-unidades">
                <Columns2 className="h-3.5 w-3.5" strokeWidth={1.5} /> Comparar plantas
              </button>
            ) : (
              <div className="flex gap-1.5" data-testid="barra-comparacao">
                <button type="button" disabled={!prontas} onClick={onAbrirComparacao}
                  className={`vd-btn !h-9 flex-1 ${prontas ? "vd-btn-bronze" : "vd-btn-vazado"}`}
                  data-testid="btn-abrir-comparacao">
                  <Columns2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {prontas ? "Comparar 2 plantas" : `Selecione 2 plantas · ${comparacaoIds.length}/2`}
                </button>
                <button type="button" onClick={sairDaComparacao} className="vd-icone-btn !h-9 !w-9"
                  title="Cancelar comparação" aria-label="Cancelar comparação">
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            )
          )}
        </div>

        <div className="vd-linha flex shrink-0 items-center gap-2 px-4 py-2">
          <span className="vd-micro vd-num vd-3 mr-auto">
            {resultados.length} {resultados.length === 1 ? "resultado" : "resultados"}
          </span>
          <SelecaoVidro variante="texto" rotulo="Ordenar" valor={ordem} opcoes={ORDENS} onChange={setOrdem}
            icone={<ArrowUpDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />} />
          <button type="button" onClick={() => setSoFavoritos((v) => !v)}
            data-on={soFavoritos ? "1" : undefined} className="vd-icone-btn !h-7 !w-auto gap-1 !px-2 !flex"
            title="Só favoritas" aria-label="Só favoritas" aria-pressed={soFavoritos}>
            <Heart className="h-3.5 w-3.5" strokeWidth={1.5} fill={soFavoritos ? "currentColor" : "none"} />
            {favoritos.size > 0 && <span className="vd-num text-[10px]">{favoritos.size}</span>}
          </button>
        </div>

        <ul ref={listaRef} className="vd-scroll vd-linha min-h-0 flex-1">
          {resultados.length === 0 && (
            <li className="vd-micro vd-3 px-4 py-10 text-center">Nenhuma unidade com esses filtros.</li>
          )}
          {resultados.map((u) => {
            const cor = COR_STATUS[u.status];
            const marcada = comparacaoIds.includes(u.id);
            const resumo = [
              u.areaPrivativa != null ? formatArea(u.areaPrivativa) : null,
              `${u.pavimento}º`,
              torreLabel(u.torre, torres),
            ].filter(Boolean).join(" · ");
            return (
              <li key={u.id}>
                <button type="button" className="vd-item"
                  data-on={(comparando ? marcada : sel?.id === u.id) ? "1" : undefined}
                  data-sel={sel?.id === u.id ? "1" : undefined}
                  data-testid={`unidade-card-${u.id}`}
                  aria-pressed={comparando ? marcada : undefined}
                  aria-label={`Unidade ${u.numero}, ${cor.label}`}
                  onClick={() => (comparando ? marcar(u.id) : onSelecionar?.(sel?.id === u.id ? null : u))}>
                  {comparando ? (
                    <span className="vd-check" data-on={marcada ? "1" : undefined}>
                      {marcada && <Check className="h-3 w-3" strokeWidth={2.5} />}
                    </span>
                  ) : (
                    <span className="vd-ponto" style={{ background: cor.escuro }} title={cor.label} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="vd-num flex items-center gap-1.5 text-[13px] font-medium">
                      {u.numero}
                      {favoritos.has(u.id) && <Heart className="h-2.5 w-2.5 text-[#d79a92]" fill="currentColor" />}
                    </span>
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
        const favorita = favoritos.has(sel.id);
        const resumo = [
          tip?.nome ?? sel.tipologia,
          sel.quartos != null ? `${sel.quartos} quartos` : null,
          sel.suites != null ? `${sel.suites} suítes` : null,
          sel.vagas != null ? `${sel.vagas} vagas` : null,
          sel.areaPrivativa != null ? formatArea(sel.areaPrivativa) : null,
          `${sel.pavimento}º pav. · ${torreLabel(sel.torre, torres)}`,
        ].filter(Boolean).join(" · ");
        return (
          <section ref={cartaoRef} className="vd-unidade-card vd-vidro vd-entra vd-scroll"
            style={{ translate: `${posCartao.x}px ${posCartao.y}px` }}
            aria-label={`Unidade ${sel.numero}`} data-testid="cartao-unidade">
            <div className="vd-arrastar px-4 pb-1 pt-1.5"
              onPointerDown={iniciarArraste} onPointerMove={moverArraste}
              onPointerUp={soltarArraste} onPointerCancel={soltarArraste}
              title="Arraste para mover">
              <GripHorizontal className="mx-auto h-3.5 w-3.5 text-white/40 max-md:hidden" strokeWidth={1.5} />
              <div className="flex items-start gap-1">
                <div className="min-w-0 pt-1">
                  <p className="vd-micro vd-3">Unidade</p>
                  <p className="vd-num truncate text-[20px] font-light leading-tight tracking-[0.06em]">{sel.numero}</p>
                  <p className="vd-micro mt-1 flex items-center gap-1.5" style={{ color: cor.escuro }}>
                    <span className="vd-ponto" style={{ background: cor.escuro }} />
                    {cor.label}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0">
                  <button type="button" className="vd-icone-btn vd-alvo" onClick={() => alternarFavorito(sel.id)}
                    title={favorita ? "Remover dos favoritos" : "Favoritar"}
                    aria-label={favorita ? "Remover dos favoritos" : "Favoritar"} aria-pressed={favorita}>
                    <Heart className="h-3.5 w-3.5" strokeWidth={1.5} fill={favorita ? "currentColor" : "none"} />
                  </button>
                  <button type="button" className="vd-icone-btn vd-alvo"
                    data-on={modo === "corte" ? "1" : undefined}
                    onClick={() => ver(sel, modo === "corte" ? "volume" : "corte")}
                    title={modo === "corte" ? "Voltar à unidade" : "Ver o pavimento"}
                    aria-label={modo === "corte" ? "Voltar à unidade" : "Ver o pavimento"}>
                    <Layers className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button type="button" className="vd-icone-btn vd-alvo"
                    onClick={() => entrarNaComparacao(sel.id)}
                    title="Comparar com outra planta" aria-label="Comparar esta planta">
                    <Columns2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button type="button" className="vd-icone-btn vd-alvo" onClick={mostrarTodas}
                    title="Fechar" aria-label="Fechar a unidade" data-testid="btn-mostrar-todas">
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            </div>

            <div className="px-4 pb-4">
              {planta && (
                <button type="button" onClick={() => setLightbox(planta)}
                  className="vd-planta mt-2 block h-[160px] w-full overflow-hidden rounded-[6px]"
                  title="Ampliar a planta" aria-label="Ampliar a planta">
                  <img src={planta} alt={`Planta da unidade ${sel.numero}`} className="h-full w-full object-contain p-2" draggable={false} />
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
            </div>
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
