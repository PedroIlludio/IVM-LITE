import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search, X, Eye, Maximize2, SlidersHorizontal,
  Heart, LayoutGrid, List, ChevronDown, ArrowUpDown, ArrowLeft,
  MessageCircle, Phone, Mail,
} from "lucide-react";
import { montarMensagemContato, type ContatoCfg } from "@/lib/ivm-store";
import type { Scene3DHandle } from "@/components/Scene3D";
import FaixaSlider, { faixaNoPasso } from "@/components/FaixaSlider";
import { niveisDe, SEA_HEADING, DEFAULT_PAV_CFG, type PavimentosCfg, type NivelDef } from "@/lib/pavimentos";
import { corteDoNivel } from "@/lib/unidades3d";
import {
  STATUS_META,
  STATUS_CLARO,
  STATUS_CLARO_FUNDO,
  torresDe,
  torreLabel,
  type TorreDef,
  type Unidade,
  type UnidadeStatus,
} from "@/lib/unidades";
import { CAMERA_UNIDADE_PADRAO, type Tipologia } from "@shared/schema";
import {
  faixasDe, formatArea, formatPreco, formatPrecoCurto, tipologiaDaUnidade,
  unidadesComTipologia,
} from "@/lib/tipologias";

interface BuscadorUnidades3DProps {
  sceneRef: React.RefObject<Scene3DHandle | null>;
  /** Identifica o projeto — separa os favoritos de um empreendimento dos do outro. */
  projetoId?: string;
  /** Canais de contato do projeto; sem eles o pop-up não mostra a seção. */
  contato?: ContatoCfg;
  /** Nome do empreendimento, usado no texto da mensagem de contato. */
  nomeEmpreendimento?: string;
  unidades: Unidade[];
  plantas: { area: string; url: string }[];
  /** Tipologias do projeto — trazem a axonométrica e os atributos do card. */
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
  /** Unidades que passam no filtro — a página usa para montar as caixas. */
  onFiltrar?: (ids: string[]) => void;
}

const STATUSES: UnidadeStatus[] = ["disponivel", "reservada", "vendida"];

/** Cor + fundo do status na paleta clara (ver `STATUS_CLARO` em unidades.ts). */
const corStatus = (s: UnidadeStatus) => ({ cor: STATUS_CLARO[s], fundo: STATUS_CLARO_FUNDO[s] });

type Ordem = "numero" | "preco-asc" | "preco-desc" | "area-asc" | "area-desc";
const ORDENS: { v: Ordem; l: string }[] = [
  { v: "numero", l: "Unidade A–Z" },
  { v: "preco-asc", l: "Menor preço" },
  { v: "preco-desc", l: "Maior preço" },
  { v: "area-asc", l: "Menor área" },
  { v: "area-desc", l: "Maior área" },
];

type Faixa = [number, number];

/**
 * Passo de cada slider de faixa. Constante, e não escrito no JSX, porque os
 * LIMITES precisam do mesmo número para as duas pontas serem alcançáveis —
 * ver `faixaNoPasso`. Preço anda em centavos: 1000 = R$ 10.
 */
const PASSO = { area: 1, preco: 1000, quartos: 1 } as const;

/**
 * Buscador de unidades ligado ao 3D: filtra o espelho por faixa (área, quartos,
 * andar, preço) além de torre, tipologia e status; ao escolher uma unidade,
 * corta o modelo no andar dela e mostra a vista real daquele nível.
 *
 * O GLB é uma fachada (sem geometria por unidade), então a ligação unidade→3D é
 * feita pelo pavimento — e o "interior" é o pop-up com a planta e os dados.
 */
export default function BuscadorUnidades3D({
  sceneRef,
  projetoId,
  contato,
  nomeEmpreendimento = "",
  unidades: unidadesProp,
  plantas,
  tipologias = [],
  torres,
  onNivel,
  pavCfg,
  niveis: niveisProp,
  onClose,
  selecionadaId,
  onSelecionar,
  onFiltrar,
}: BuscadorUnidades3DProps) {
  /**
   * Área, quartos, suítes e vagas resolvidos ANTES de qualquer leitura: a
   * unidade que não os declara herda os da sua tipologia. Feito aqui uma vez,
   * a herança vale para a lista, os cards, os sliders de faixa, a ordenação e
   * o pop-up — sem cada um deles ter de lembrar de olhar para a tipologia.
   */
  const unidades = useMemo(
    () => unidadesComTipologia(unidadesProp, tipologias),
    [unidadesProp, tipologias],
  );

  const TORRES = useMemo(() => torresDe(unidades, torres), [unidades, torres]);
  const niveis = useMemo(() => niveisDe(pavCfg ?? {}, niveisProp), [pavCfg, niveisProp]);
  const cfg = useMemo(() => ({ ...DEFAULT_PAV_CFG, ...pavCfg }), [pavCfg]);

  const [torre, setTorre] = useState<string>("");
  const [status, setStatus] = useState<UnidadeStatus | "">("");
  const [tipologiaId, setTipologiaId] = useState<string>("");
  const [pavimento, setPavimento] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [modo, setModo] = useState<"corte" | "vista" | "volume">("volume");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [avancados, setAvancados] = useState(false);
  const [ordem, setOrdem] = useState<Ordem>("numero");
  const [visual, setVisual] = useState<"lista" | "grade">("lista");
  /**
   * Favoritos por PROJETO, guardados no navegador.
   *
   * Antes viviam só em memória: o cliente marcava cinco unidades, atualizava a
   * página e perdia a seleção inteira — num plantão de vendas, é a lista de
   * interesse dele que ia embora. A chave leva o projeto para dois
   * empreendimentos não misturarem favoritos no mesmo navegador.
   */
  const chaveFavoritos = `ivm-favoritos:${projetoId ?? "sem-projeto"}`;
  const [favoritos, setFavoritos] = useState<Set<string>>(() => {
    try {
      const bruto = localStorage.getItem(`ivm-favoritos:${projetoId ?? "sem-projeto"}`);
      return new Set<string>(bruto ? (JSON.parse(bruto) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(chaveFavoritos, JSON.stringify(Array.from(favoritos)));
    } catch {
      /* navegação privada ou cota cheia: os favoritos valem só nesta sessão */
    }
  }, [favoritos, chaveFavoritos]);
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [popup, setPopup] = useState<Unidade | null>(null);
  const resultadosRef = useRef<HTMLDivElement>(null);

  /**
   * Limites vindos dos dados: um filtro só aparece se o projeto o preencheu.
   *
   * Alargados até a grade do passo de cada slider (ver `faixaNoPasso`), e não
   * só na hora de desenhar: estes mesmos números são o estado inicial das
   * faixas e a referência de "o usuário mexeu nisto?". Arredondar só num dos
   * lugares faria arrastar até o fim da barra contar como filtro ativo.
   */
  const limites = useMemo(() => {
    const f = faixasDe(unidades);
    return {
      area: faixaNoPasso(f.area, PASSO.area),
      preco: faixaNoPasso(f.preco, PASSO.preco),
      quartos: faixaNoPasso(f.quartos, PASSO.quartos),
      pavimento: f.pavimento,
    };
  }, [unidades]);
  const [fArea, setFArea] = useState<Faixa | null>(null);
  const [fPreco, setFPreco] = useState<Faixa | null>(null);
  const [fQuartos, setFQuartos] = useState<Faixa | null>(null);

  /**
   * Reabre as faixas nos extremos quando os LIMITES mudam de valor.
   *
   * Depender do objeto `limites` era o mesmo que depender de `unidades`:
   * `faixasDe` devolve um objeto novo a cada chamada e `aplicarCrm` devolve um
   * array novo a cada atualização. Com o CRM em modo `endpoint` e um intervalo
   * de refresh, os sliders do visitante voltavam sozinhos ao máximo no meio da
   * busca — um espelho atualizado não é motivo para desfazer o filtro dele.
   * A assinatura só muda quando algum extremo muda de fato.
   */
  const assinaturaLimites = JSON.stringify(limites);
  useEffect(() => {
    setFArea(limites.area);
    setFPreco(limites.preco);
    setFQuartos(limites.quartos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaLimites]);

  const pavimentosDisponiveis = useMemo(
    () => Array.from(new Set(unidades.map((u) => u.pavimento))).sort((a, b) => b - a),
    [unidades],
  );

  const sel = useMemo(
    () => unidades.find((u) => u.id === selecionadaId) ?? null,
    [unidades, selecionadaId],
  );

  // A unidade pode chegar selecionada antes deste painel existir (por exemplo,
  // ao escolhe-la na lista de pavimentos). Nesse caso nao houve um clique aqui
  // para disparar o voo da camera, entao enquadramos depois que a cena montou.
  useEffect(() => {
    if (!sel) {
      setPopup(null);
      return;
    }

    setModo("volume");
    setPopup(sel);
    let cancelado = false;
    let timer: number | undefined;
    const focar = (tentativa = 0) => {
      if (cancelado) return;
      sceneRef.current?.cutAtFloor(null);
      const enquadrou = sceneRef.current?.frameUnit(
        sel.id,
        sel.camera ?? CAMERA_UNIDADE_PADRAO,
      );
      // Na troca pavimento -> unidades, as caixas entram na cena em outro
      // efeito do React. Aguarda a entidade existir, sem exigir segundo clique.
      if (!enquadrou && tentativa < 8) {
        timer = window.setTimeout(() => focar(tentativa + 1), 80);
      }
    };
    const frame = window.requestAnimationFrame(() => focar());
    return () => {
      cancelado = true;
      window.cancelAnimationFrame(frame);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [sel?.id, sceneRef]);

  /** Tipologias realmente usadas pelas unidades. */
  const tipsUsadas = useMemo(() => {
    const ids = new Set(unidades.map((u) => u.tipologiaId ?? u.tipologia));
    return tipologias.filter((t) => ids.has(t.id) || ids.has(t.nome));
  }, [tipologias, unidades]);

  const tipDe = (u: Unidade) => tipologiaDaUnidade(u, tipologias);
  /**
   * Imagem do card: a planta.
   *
   * Antes a axonométrica vinha na frente. Ela deixou de ser cadastrável — era
   * um segundo render por tipologia que ninguém produzia — e o campo só
   * sobrevive para os projetos que já tinham uma. Onde houver, ela ainda é
   * usada; onde não houver (todos os novos), a planta ocupa o lugar.
   */
  /**
   * A planta que vale para a unidade, nesta ordem: a DELA, depois a do tipo.
   *
   * A busca por nome em `plantas` saiu daqui. Aquela lista é a unificada do
   * projeto — inclui as plantas de PAVIMENTO — e casava pelo rótulo, então uma
   * unidade acabava exibindo o desenho de um andar inteiro em vez do próprio
   * apartamento. Uma unidade sem planta e sem tipologia agora não mostra
   * imagem, que é honesto: nada é melhor que a planta errada.
   */
  const plantaDe = (u: Unidade) => u.plantaUrl ?? tipDe(u)?.plantaUrl;
  const imagemDe = (u: Unidade) => plantaDe(u) ?? tipDe(u)?.axonometricaUrl;

  const dentro = (v: number | undefined, f: Faixa | null) =>
    !f || v == null || (v >= f[0] && v <= f[1]);

  /**
   * A faixa saiu dos extremos? Nos extremos ela não filtra nada — é o estado
   * "não mexi nisso", e não "quero tudo o que tem esse dado".
   */
  const faixaMexida = (f: Faixa | null, limite: Faixa | null) =>
    !!f && !!limite && (f[0] !== limite[0] || f[1] !== limite[1]);

  /**
   * Preço é o único atributo em que a ausência do dado é significativa: uma
   * unidade sem preço cadastrado não é barata nem cara, e deixá-la passar por
   * um slider mexido fazia "até R$ 500 mil" devolver unidades de preço
   * desconhecido — o filtro dizia uma coisa e o resultado mostrava outra.
   *
   * Com o slider intacto ela continua na lista: sumir de um filtro que ninguém
   * usou seria esconder estoque real do corretor.
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

    const porNumero = (a: Unidade, b: Unidade) =>
      b.pavimento - a.pavimento || a.numero.localeCompare(b.numero);
    // Unidades sem o dado da ordenação vão para o fim, em vez de fingir zero.
    const porCampo = (campo: "preco" | "areaPrivativa", asc: boolean) => (a: Unidade, b: Unidade) => {
      const va = a[campo];
      const vb = b[campo];
      if (va == null && vb == null) return porNumero(a, b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return asc ? va - vb : vb - va;
    };

    const cmp =
      ordem === "preco-asc" ? porCampo("preco", true)
      : ordem === "preco-desc" ? porCampo("preco", false)
      : ordem === "area-asc" ? porCampo("areaPrivativa", true)
      : ordem === "area-desc" ? porCampo("areaPrivativa", false)
      : porNumero;

    return [...lista].sort(cmp);
    // `limites` entra porque o filtro de preço compara a faixa com os extremos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidades, torre, status, pavimento, tipologiaId, busca, soFavoritos, favoritos, fArea, fPreco, fQuartos, ordem, limites]);

  // Mantem a lista sincronizada com selecoes vindas da tela de pavimentos.
  // O scroll fica restrito a gaveta esquerda e centraliza o card ativo.
  useEffect(() => {
    if (!sel) return;
    const frame = window.requestAnimationFrame(() => {
      const card = resultadosRef.current?.querySelector<HTMLElement>('[data-sel="1"]');
      card?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sel?.id, resultados, visual]);

  // Publica o filtro para a página montar as caixas do espelho 3D.
  useEffect(() => {
    onFiltrar?.(resultados.map((u) => u.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultados]);

  // Limpa o corte ao sair, para não deixar o prédio "cortado" na cena.
  useEffect(() => {
    return () => {
      sceneRef.current?.cutAtFloor(null);
    };
  }, [sceneRef]);

  /**
   * Nível de uma unidade — casando TORRE e pavimento, nesta ordem.
   *
   * Antes casava só pelo pavimento, e com níveis por bloco isso pegava o
   * primeiro "5º Pavimento" da lista: clicar numa unidade da River abria o
   * corte da Sea. O casamento por pavimento sozinho fica como reserva, para
   * os projetos cujos níveis não estão separados por bloco.
   */
  const nivelDe = (u: Unidade) =>
    niveis.find((n) => n.torreId === u.torre && n.pavimento === u.pavimento) ??
    niveis.find((n) => !n.torreId && n.pavimento === u.pavimento);

  /**
   * Escolher uma unidade tem três leituras: o volume dela no espelho 3D, o corte
   * do prédio no andar e a vista real a partir daquele nível.
   */
  function escolher(u: Unidade, como: "volume" | "corte" | "vista" = "volume") {
    onSelecionar?.(u);
    setModo(como);
    const nivel = nivelDe(u);
    if (como === "volume") {
      // O espelho 3D precisa do prédio inteiro visível para ler a distribuição.
      sceneRef.current?.cutAtFloor(null);
      // Voa para o enquadramento configurado da unidade (ângulo, inclinação e
      // distância definidos no editor); sem ele, o padrão do projeto.
      sceneRef.current?.frameUnit(u.id, u.camera ?? CAMERA_UNIDADE_PADRAO);
      return;
    }
    // Sem nível correspondente não há corte a fazer — acontece quando os níveis
    // foram editados por bloco e o andar desta unidade ficou de fora. Antes a
    // função simplesmente retornava, e o botão do pop-up não fazia NADA: um
    // enquadramento externo é uma resposta pior que o corte, mas é uma resposta.
    if (!nivel) {
      onNivel?.(null);
      sceneRef.current?.cutAtFloor(null);
      sceneRef.current?.viewCutExternal();
      return;
    }
    // A página precisa saber qual nível está aberto: é dela que sai a planta
    // deitada no chão, que é PROP do Scene3D e não passa pelo `sceneRef`.
    onNivel?.(nivel);
    const corte = corteDoNivel(nivel);
    sceneRef.current?.cutAtFloor(corte);
    if (como === "vista") sceneRef.current?.viewFromFloor(nivel.camH, cfg.viewHeading ?? SEA_HEADING);
    // Corte: de cima, no mesmo enquadramento derivado da régua de pavimentos —
    // pular entre unidades de andares diferentes tem de dar a mesma leitura.
    else if (corte) sceneRef.current?.viewCorteDeCima(
      // Usa exatamente o alvo, a inclinacao e o giro salvos para o andar.
      // Apenas abre um pouco o enquadramento para compensar as gavetas laterais.
      corte, (nivel.camDist ?? cfg.camDist) * 1.2, nivel.camPitch ?? cfg.camPitch,
      nivel.camGiro ?? cfg.camGiro, 1.4,
    );
    else sceneRef.current?.viewCutExternal();
  }

  /**
   * Volta ao estado de partida: prédio inteiro, todas as unidades.
   *
   * Escolher uma unidade encadeia três coisas — corte no andar, isolamento da
   * caixa e um enquadramento próprio — e desfazê-las uma a uma exigia saber que
   * as três existem. O caminho de volta tem de ser um gesto só, no mesmo lugar
   * em que a ida aconteceu.
   */
  function mostrarTodas() {
    setPopup(null);
    setModo("volume");
    onNivel?.(null);
    onSelecionar?.(null);
    sceneRef.current?.cutAtFloor(null);
    sceneRef.current?.frameBuilding();
  }

  function alternarFavorito(id: string) {
    setFavoritos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function limparFiltros() {
    setTorre("");
    setStatus("");
    setTipologiaId("");
    setPavimento(null);
    setBusca("");
    setSoFavoritos(false);
    setFArea(limites.area);
    setFPreco(limites.preco);
    setFQuartos(limites.quartos);
  }

  const temFiltro =
    !!torre || !!status || pavimento != null || !!tipologiaId || !!busca.trim() || soFavoritos ||
    faixaMexida(fArea, limites.area) ||
    faixaMexida(fPreco, limites.preco) ||
    faixaMexida(fQuartos, limites.quartos);

  return (
    <>
      {/*
        Painel colado à borda esquerda, de altura cheia — como na referência.
        Antes ele flutuava com margem em volta, e a margem é justamente o que
        faz a tela parecer feita de blocos soltos: o painel vira mais uma
        caixa sobre a cena, em vez de uma coluna de leitura.
      */}
      <div className="v-scroll absolute inset-y-0 left-0 z-40 flex w-[380px] max-w-full flex-col bg-[var(--v-surface)] shadow-[var(--v-sh-3)]">
        <header className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <h2 className="v-title text-[22px]">Unidades</h2>
            <p className="v-faint mt-1 text-[12px]">
              <span className="v-num font-semibold text-[var(--v-ink)]">{resultados.length}</span>
              {" de "}{unidades.length} no empreendimento
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={onClose} title="Fechar"
              className="grid h-9 w-9 place-items-center rounded-[var(--v-r-sm)] text-[var(--v-ink-3)] transition-colors hover:bg-[var(--v-surface-3)] hover:text-[var(--v-ink)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Filtros */}
        <div className="space-y-4 px-6 pb-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--v-ink-3)]" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nº da unidade ou tipologia"
              className="v-input v-input-icone"
            />
            {temFiltro && (
              <button onClick={limparFiltros} title="Limpar filtros"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[var(--v-ink-3)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-ink)]">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Faixas: só aparecem quando o projeto tem o dado. */}
          {(limites.area || limites.preco) && (
            <div className="space-y-3.5">
              {limites.area && fArea && (
                /* O limite do slider é um corte, não uma medida: ele anda de
                   metro em metro e a etiqueta acompanha. Quem mostra a área
                   exata é a ficha da unidade. */
                <FaixaSlider label="Área" min={limites.area[0]} max={limites.area[1]} step={PASSO.area}
                  value={fArea} onChange={setFArea} format={(v) => formatArea(Math.round(v))} />
              )}
              {limites.preco && fPreco && (
                <FaixaSlider label="Preço" min={limites.preco[0]} max={limites.preco[1]} step={PASSO.preco}
                  value={fPreco} onChange={setFPreco} format={(v) => `R$ ${formatPrecoCurto(v)}`} />
              )}
            </div>
          )}

          <div className="v-seg">
            {[...STATUSES.map((s) => ({ v: s as string, l: STATUS_META[s].label })), { v: "", l: "Todas" }].map((o) => (
              <button key={o.v} onClick={() => setStatus(o.v as UnidadeStatus | "")}
                data-on={status === o.v ? "1" : undefined}>
                {o.l}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="v-eyebrow mb-2 block">Pavimento</span>
            <select
              value={pavimento ?? ""}
              onChange={(e) => setPavimento(e.target.value === "" ? null : Number(e.target.value))}
              className="v-input cursor-pointer"
            >
              <option value="">Todos os pavimentos</option>
              {pavimentosDisponiveis.map((andar) => (
                <option key={andar} value={andar}>{andar}º pavimento</option>
              ))}
            </select>
          </label>

          <button onClick={() => setAvancados((v) => !v)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--v-ink-2)] transition-colors hover:text-[var(--v-ink)]">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros avançados
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${avancados ? "rotate-180" : ""}`} />
          </button>

          {avancados && (
            <div className="v-in space-y-3.5 border-t border-[var(--v-line)] pt-4">
              {limites.quartos && fQuartos && (
                <FaixaSlider label="Quartos" min={limites.quartos[0]} max={limites.quartos[1]} step={PASSO.quartos}
                  value={fQuartos} onChange={setFQuartos} />
              )}
              {TORRES.length > 1 && (
                <Chips label="Torre" value={torre} onChange={setTorre}
                  options={[{ v: "", l: "Todas" }, ...TORRES.map((t) => ({ v: t.id, l: t.label }))]} />
              )}
              {tipsUsadas.length > 1 && (
                <Chips label="Tipologia" value={tipologiaId} onChange={setTipologiaId}
                  options={[{ v: "", l: "Todas" }, ...tipsUsadas.map((t) => ({ v: t.id, l: t.nome }))]} />
              )}
            </div>
          )}
        </div>

        {/*
          Faixa de resultados sobre a superfície secundária: é a mudança de
          fundo que separa "o que eu procuro" de "o que encontrei", sem
          precisar de mais uma borda.
        */}
        <div className="flex items-center gap-2 border-y border-[var(--v-line)] bg-[var(--v-surface-2)] px-6 py-2.5">
          <span className="v-eyebrow mr-auto">
            {resultados.length} {resultados.length === 1 ? "resultado" : "resultados"}
          </span>
          <div className="flex items-center gap-1 text-[var(--v-ink-2)]">
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}
              className="cursor-pointer bg-transparent text-[12px] font-medium outline-none hover:text-[var(--v-ink)]">
              {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <button onClick={() => setSoFavoritos((v) => !v)} title="Só favoritas"
            className={`flex h-7 items-center gap-1 rounded-[6px] px-1.5 transition-colors ${
              soFavoritos ? "bg-rose-50 text-rose-600" : "text-[var(--v-ink-3)] hover:text-[var(--v-ink)]"}`}>
            <Heart className="h-3.5 w-3.5" fill={soFavoritos ? "currentColor" : "none"} />
            {favoritos.size > 0 && <span className="v-num text-[11px] font-semibold">{favoritos.size}</span>}
          </button>
          <button onClick={() => setVisual(visual === "lista" ? "grade" : "lista")}
            title={visual === "lista" ? "Ver em grade" : "Ver em lista"}
            className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--v-ink-3)] transition-colors hover:text-[var(--v-ink)]">
            {visual === "lista" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
          </button>
        </div>

        {/* Resultados */}
        <div ref={resultadosRef} className="v-scroll min-h-0 flex-1 overflow-y-auto bg-[var(--v-surface-2)] px-5 py-4">
          {resultados.length === 0 ? (
            <p className="v-faint py-14 text-center text-[13px]">Nenhuma unidade com esses filtros.</p>
          ) : (
            <div className={visual === "grade" ? "grid grid-cols-2 gap-3" : "space-y-3"}>
              {resultados.map((u) => (
                <CardUnidade key={u.id} u={u} torres={torres} imagem={imagemDe(u)}
                  compacto={visual === "grade"}
                  selecionada={sel?.id === u.id} favorita={favoritos.has(u.id)}
                  onFavoritar={() => alternarFavorito(u.id)}
                  onClick={() => { escolher(u); setPopup(u); }} />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Pop-up da unidade: a planta e a ficha — é o "interior" da experiência. */}
      {popup && (
        <PopupUnidade
          u={popup}
          tipologia={tipDe(popup)}
          imagem={imagemDe(popup)}
          planta={plantaDe(popup)}
          torres={torres}
          contato={contato}
          nomeEmpreendimento={nomeEmpreendimento}
          modo={modo}
          favorita={favoritos.has(popup.id)}
          onFavoritar={() => alternarFavorito(popup.id)}
          onAmpliar={(url) => setLightbox(url)}
          onVerNo3D={(como) => escolher(popup, como)}
          onMostrarTodas={mostrarTodas}
          onClose={() => setPopup(null)}
        />
      )}

      {lightbox &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 backdrop-blur-sm"
            onClick={() => setLightbox(null)}>
            <img src={lightbox} alt="" className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain" />
          </div>,
          document.body,
        )}
    </>
  );
}

/** Card da unidade — o formato da referência: imagem, código, status e atributos. */
function CardUnidade({
  u, torres, imagem, selecionada, favorita, onFavoritar, onClick, compacto,
}: {
  u: Unidade;
  torres?: TorreDef[];
  imagem?: string;
  selecionada: boolean;
  favorita: boolean;
  onFavoritar: () => void;
  onClick: () => void;
  compacto?: boolean;
}) {
  const meta = STATUS_META[u.status];
  const cor = corStatus(u.status);
  return (
    <div
      onClick={onClick}
      data-sel={selecionada ? "1" : undefined}
      className={`v-card group relative cursor-pointer overflow-hidden ${compacto ? "" : "flex"}`}
    >
      {/*
        A axonométrica ganhou peso: é ela que o cliente reconhece antes de ler
        qualquer número. Fundo neutro e `contain` — a imagem é um desenho, e
        recortá-la para preencher tira justamente o contorno da planta.
      */}
      <div className={`shrink-0 overflow-hidden bg-[var(--v-surface-3)] ${
        compacto ? "h-28 w-full" : "order-last h-auto w-[112px] self-stretch"}`}>
        {imagem ? (
          <img src={imagem} alt="" loading="lazy"
            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.04]" />
        ) : (
          <div className="v-faint grid h-full min-h-[92px] place-items-center text-[10px]">sem planta</div>
        )}
      </div>

      <div className="min-w-0 flex-1 px-3.5 py-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="v-title truncate text-[15px] font-semibold">{u.numero}</span>
          <span className="v-chip" style={{ background: cor.fundo, color: cor.cor }}>
            <span className="v-dot" style={{ background: cor.cor }} />
            {meta.label}
          </span>
        </div>

        {/* O preço fora da lista de atributos: é a informação que decide. */}
        {u.preco != null && (
          <p className="v-num mb-1.5 text-[15px] font-semibold">{formatPreco(u.preco)}</p>
        )}

        <div className="-mb-1">
          {u.areaPrivativa != null && (
            <div className="v-row"><span>Área</span><span>{formatArea(u.areaPrivativa)}</span></div>
          )}
          {u.quartos != null && (
            <div className="v-row"><span>Quartos</span><span>{u.quartos}</span></div>
          )}
          <div className="v-row">
            <span>Andar</span>
            <span>{u.pavimento}º · {torreLabel(u.torre, torres)}</span>
          </div>
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onFavoritar(); }}
        title={favorita ? "Remover dos favoritos" : "Favoritar"}
        className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/85 shadow-[var(--v-sh-1)] backdrop-blur transition-opacity ${
          favorita ? "text-rose-500" : "text-[var(--v-ink-3)] opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        <Heart className="h-3.5 w-3.5" fill={favorita ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

/**
 * Pop-up da unidade: planta ampliável + ficha completa. É o que substitui um
 * tour de interior — sem modelagem 3D interna, e por isso roda igual no celular.
 */
function PopupUnidade({
  u, tipologia, imagem, planta, torres, modo, favorita, contato, nomeEmpreendimento,
  onFavoritar, onAmpliar, onVerNo3D, onMostrarTodas, onClose,
}: {
  u: Unidade;
  tipologia?: Tipologia;
  imagem?: string;
  planta?: string;
  torres?: TorreDef[];
  contato?: ContatoCfg;
  /** Vai no texto da mensagem e no assunto do e-mail. */
  nomeEmpreendimento: string;
  modo: "volume" | "corte" | "vista";
  favorita: boolean;
  onFavoritar: () => void;
  onAmpliar: (url: string) => void;
  onVerNo3D: (como: "volume" | "corte" | "vista") => void;
  /** Desfaz corte, isolamento e enquadramento — volta ao prédio inteiro. */
  onMostrarTodas: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Canais oferecidos: só os que o projeto preencheu. WhatsApp vira a ação
   * primária quando existe — é o canal em que uma corretora responde rápido, e
   * o único que carrega a mensagem já escrita.
   */
  const canaisContato = (() => {
    const c = contato;
    if (!c) return [];
    const out: { id: string; href: string; label: string; icone: React.ReactNode; primario?: boolean }[] = [];
    const texto = montarMensagemContato(c.mensagem, {
      unidade: u.numero,
      empreendimento: nomeEmpreendimento,
    });
    const zap = (c.whatsapp ?? "").replace(/\D/g, "");
    if (zap) {
      out.push({
        id: "whatsapp",
        href: `https://wa.me/${zap}?text=${encodeURIComponent(texto)}`,
        label: "WhatsApp",
        icone: <MessageCircle className="h-4 w-4" />,
        primario: true,
      });
    }
    if (c.telefone?.trim()) {
      out.push({
        id: "telefone",
        href: `tel:${c.telefone.replace(/[^\d+]/g, "")}`,
        label: "Ligar",
        icone: <Phone className="h-4 w-4" />,
      });
    }
    if (c.email?.trim()) {
      const assunto = `${nomeEmpreendimento} — unidade ${u.numero}`;
      out.push({
        id: "email",
        href: `mailto:${c.email.trim()}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`,
        label: "E-mail",
        icone: <Mail className="h-4 w-4" />,
      });
    }
    return out;
  })();

  const meta = STATUS_META[u.status];
  const linhas: [string, string][] = [
    ["Tipologia", u.tipologia || "—"],
    ["Torre", torreLabel(u.torre, torres)],
    ["Pavimento", `${u.pavimento}º`],
    ...(u.areaPrivativa != null ? ([["Área privativa", formatArea(u.areaPrivativa)]] as [string, string][]) : []),
    ...(u.areaTotal != null ? ([["Área total", formatArea(u.areaTotal)]] as [string, string][]) : []),
    ...(u.quartos != null ? ([["Quartos", String(u.quartos)]] as [string, string][]) : []),
    ...(u.suites != null ? ([["Suítes", String(u.suites)]] as [string, string][]) : []),
    ...(u.vagas != null ? ([["Vagas", String(u.vagas)]] as [string, string][]) : []),
    ...(u.orientacao ? ([["Orientação", u.orientacao]] as [string, string][]) : []),
  ];

  const cor = corStatus(u.status);

  return (
    <aside className="vitrine fixed inset-y-0 right-0 z-[90] w-[390px] max-w-full border-l border-[var(--v-line)] bg-[var(--v-surface)] shadow-[-18px_0_45px_rgba(25,28,31,0.14)] animate-in slide-in-from-right duration-300">
      <div className="v-in v-scroll h-full overflow-y-auto">
        <header className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="v-title text-[26px]">Unidade {u.numero}</h2>
              <span className="v-chip" style={{ background: cor.fundo, color: cor.cor }}>
                <span className="v-dot" style={{ background: cor.cor }} />
                {meta.label}
              </span>
            </div>
            {u.preco != null && (
              <p className="v-num mt-2 text-[22px] font-semibold">{formatPreco(u.preco)}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={onFavoritar} title={favorita ? "Remover dos favoritos" : "Favoritar"}
              className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
                favorita ? "text-rose-500" : "text-[var(--v-ink-3)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-ink)]"}`}>
              <Heart className="h-4 w-4" fill={favorita ? "currentColor" : "none"} />
            </button>
            <button onClick={onClose} title="Fechar"
              className="grid h-9 w-9 place-items-center rounded-full text-[var(--v-ink-3)] transition-colors hover:bg-[var(--v-surface-3)] hover:text-[var(--v-ink)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {imagem && (
          <button onClick={() => onAmpliar(planta ?? imagem)}
            className="group relative mx-6 mb-5 block overflow-hidden rounded-[var(--v-r)] bg-[var(--v-surface-3)]"
            title="Ampliar">
            <img src={imagem} alt={u.tipologia} className="max-h-72 w-full object-contain p-3" />
            <span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[var(--v-ink)] opacity-0 shadow-[var(--v-sh-1)] transition group-hover:opacity-100">
              <Maximize2 className="h-4 w-4" />
            </span>
          </button>
        )}

        {/* Ficha em coluna única: duas colunas de pares rótulo/valor forçam o
            olho a saltar, e é o que fazia isto parecer formulário. */}
        <div className="px-6">
          {linhas.map(([k, v]) => (
            <div key={k} className="v-row"><span>{k}</span><span>{v}</span></div>
          ))}
        </div>

        {tipologia?.descricao && (
          <p className="v-muted px-6 pt-4 text-[13px] leading-relaxed">{tipologia.descricao}</p>
        )}

        <div className="flex gap-2 px-6 pt-5">
          {modo === "volume" ? (
            <Acao ativo={false} onClick={() => onVerNo3D("corte")}
              icon={<Eye className="h-4 w-4" />} label="Vista do andar" />
          ) : (
            <Acao ativo={false} onClick={() => onVerNo3D("volume")}
              icon={<ArrowLeft className="h-4 w-4" />} label="Voltar para a unidade" />
          )}
          {tipologia?.tour360Url && (
            <a href={tipologia.tour360Url} target="_blank" rel="noreferrer" className="v-btn flex-1">
              Tour 360º
            </a>
          )}
        </div>

        {/* Saída do foco, logo abaixo da entrada nele. */}
        <div className="px-6 pt-2">
          <button onClick={onMostrarTodas}
            data-testid="btn-mostrar-todas"
            className="w-full rounded-[10px] border border-[var(--v-line)] py-2 text-[12px] text-[var(--v-ink-2)] transition-colors hover:border-[var(--v-line-2)] hover:text-[var(--v-ink)]">
            Mostrar todas as unidades
          </button>
        </div>

        {/*
          Fim do funil. Sem isto o visitante encontrava o apartamento certo e
          não tinha o que fazer em seguida — a experiência terminava no elogio.
          A mensagem já vai escrita com o número da unidade, para o corretor
          receber a conversa sabendo do que se trata.
        */}
        {canaisContato.length > 0 && (
          <div className="px-6 pb-6 pt-4">
            <p className="v-eyebrow mb-2">Falar sobre esta unidade</p>
            <div className="flex flex-wrap gap-2">
              {canaisContato.map((c) => (
                <a key={c.id} href={c.href} target="_blank" rel="noreferrer"
                  className={`flex h-10 min-w-[7rem] flex-1 items-center justify-center gap-1.5 rounded-[var(--v-r-sm)] text-[12.5px] font-medium transition-colors ${
                    c.primario
                      ? "bg-[var(--v-accent)] text-white hover:opacity-90"
                      : "border border-[var(--v-line-2)] text-[var(--v-ink)] hover:bg-[var(--v-surface-3)]"
                  }`}>
                  {c.icone} {c.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function Chips({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string; cor?: string }[];
}) {
  return (
    <div>
      <span className="v-eyebrow mb-2 block">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.v} onClick={() => onChange(o.v)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
              value === o.v
                ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] font-semibold text-[var(--v-accent)]"
                : "border-[var(--v-line-2)] text-[var(--v-ink-2)] hover:border-[var(--v-ink-3)] hover:text-[var(--v-ink)]"
            }`}>
            {o.cor && <span className="v-dot" style={{ background: o.cor }} />}
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Acao({
  ativo, onClick, icon, label,
}: {
  ativo: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[var(--v-r-sm)] text-[12.5px] font-medium transition-colors ${
        ativo
          ? "bg-[var(--v-accent)] text-white"
          : "border border-[var(--v-line-2)] text-[var(--v-ink)] hover:bg-[var(--v-surface-3)]"
      }`}>
      {icon} {label}
    </button>
  );
}
