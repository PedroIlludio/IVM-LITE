import type { Empreendimento, Tipologia, Unidade } from "@shared/schema";

/**
 * Tipologias do projeto e as conversões entre o formato antigo (texto) e o
 * novo (número), que é o que os filtros de faixa exigem.
 *
 * Contexto do legado: `Empreendimento.plantas[].area` guarda o NOME da
 * tipologia ("Ocean — Tipo 1"), não a área — e é por esse nome que a unidade
 * acha a sua planta. A área real vive em `Unidade.area` como texto ("48 m²").
 * A derivação abaixo reconstrói as tipologias a partir dessas duas pontas sem
 * perder o vínculo que já funciona.
 */

/** "48 m²" | "48,5m2" | "1.403" | 48 → 48. Devolve undefined se não houver número. */
export function parseArea(v?: string | number | null): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (!v) return undefined;
  // Remove separador de milhar e troca a vírgula decimal por ponto.
  const limpo = v.replace(/\./g, "").replace(",", ".");
  const m = limpo.match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 48 → "48 m²"; 37.981 → "37,981 m²".
 *
 * Sem arredondar: a área é o número do memorial e é por ele que se assina
 * contrato. Uma casa decimal era o padrão daqui, e transformava os 37,981 m²
 * cadastrados num "38 m²" na vitrine — um metro quadrado inteiro de diferença
 * declarada ao cliente, no dado que ele mais compara entre unidades.
 *
 * As casas exibidas são as que o número REALMENTE tem: quem cadastrou 44,05
 * vê 44,05, e quem cadastrou 48 continua vendo "48 m²" e não "48,000 m²".
 */
export function formatArea(m2?: number): string {
  if (m2 == null || !Number.isFinite(m2)) return "—";
  const casas = Math.min((String(m2).split(".")[1] ?? "").length, 20);
  return `${m2.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })} m²`;
}

/** Centavos → "R$ 1.000.263,32". */
export function formatPreco(centavos?: number): string {
  if (centavos == null || !Number.isFinite(centavos)) return "Sob consulta";
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

/** Centavos → "1,0 mi" / "450 mil", para os extremos do slider de preço. */
export function formatPrecoCurto(centavos?: number): string {
  if (centavos == null || !Number.isFinite(centavos)) return "—";
  const reais = centavos / 100;
  if (reais >= 1_000_000) return `${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (reais >= 1_000) return `${Math.round(reais / 1_000)} mil`;
  return reais.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** "1.000.263,32" | "1000263.32" | 1000263.32 → centavos (inteiro). */
export function parsePreco(v?: string | number | null): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : undefined;
  if (!v) return undefined;
  const limpo = v.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

/** Id estável a partir do nome da tipologia ("Ocean — Tipo 1" → "ocean-tipo-1"). */
export function tipologiaId(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Plantas que NÃO são tipologias de unidade: implantação, térreo, rooftop,
 * subsolo. Ficam de fora da lista de tipologias porque não têm unidade
 * vinculada — mas continuam sendo usadas pela régua de pavimentos.
 */
export function ehPlantaDeImplantacao(nome: string, nomesDeUnidades: Set<string>): boolean {
  return !nomesDeUnidades.has(nome);
}

/**
 * Tipologias efetivas do projeto: as declaradas em `empreendimento.tipologias`
 * ou, na falta, derivadas das plantas + unidades.
 *
 * A área de cada tipologia vem da primeira unidade que a referencia, porque no
 * formato antigo é a unidade que carrega o texto da área.
 */
export function tipologiasDe(emp: Empreendimento, unidades: Unidade[] = []): Tipologia[] {
  if (emp.tipologias?.length) return emp.tipologias;

  const nomesUsados = new Set(unidades.map((u) => u.tipologia).filter(Boolean));
  const out: Tipologia[] = [];

  // 1) Plantas que alguma unidade referencia viram tipologias, herdando a imagem.
  for (const p of emp.plantas ?? []) {
    if (!nomesUsados.has(p.area)) continue;
    const daTipologia = unidades.find((u) => u.tipologia === p.area);
    out.push({
      id: tipologiaId(p.area),
      nome: p.area,
      areaPrivativa: parseArea(daTipologia?.areaPrivativa ?? daTipologia?.area),
      vagas: parseArea(p.vagas),
      plantaUrl: p.imagemUrl,
      descricao: p.descricao,
    });
  }

  // 2) Tipologias citadas por unidades mas sem planta cadastrada.
  for (const nome of Array.from(nomesUsados)) {
    if (out.some((t) => t.nome === nome)) continue;
    const u = unidades.find((x) => x.tipologia === nome);
    out.push({
      id: tipologiaId(nome),
      nome,
      areaPrivativa: parseArea(u?.areaPrivativa ?? u?.area),
    });
  }

  return out;
}

/**
 * Lista `{ area, url }` de plantas que a vitrine consome — montada a partir das
 * duas fontes REAIS, e não mais de `emp.plantas`.
 *
 * O editor tinha duas abas concorrentes, Tipologias e Plantas, gravando coisas
 * que se sobrepunham: a planta de uma unidade cabia nas duas e ninguém sabia
 * qual valia. Agora cada planta tem um dono único —
 *
 * - planta de UNIDADE pertence à tipologia (`Tipologia.plantaUrl`);
 * - planta de PAVIMENTO (térreo, rooftop, subsolo) pertence ao nível
 *   (`NivelDef.plantaUrl`).
 *
 * `emp.plantas` continua sendo lido no fim da lista, e só para o que as duas
 * fontes novas ainda não cobrem: um IVM Lite publicado antes desta mudança não
 * pode perder imagem nenhuma da vitrine por causa de uma reorganização interna.
 *
 * O campo se chama `area` porque é o nome que os consumidores esperam — apesar
 * de guardar o NOME da planta, não a área. Renomeá-lo é outra limpeza.
 */
/**
 * Plantas de TIPOLOGIA — sem os níveis.
 *
 * `plantasDoProjeto` junta tudo o que existe, e é o certo para quem precisa
 * resolver uma planta por nome (a régua de pavimentos casa "5º Pavimento" com o
 * desenho dele). Para MOSTRAR uma lista de plantas ao visitante, incluir os
 * níveis polui: a galeria enchia de "PAV 20", "PAV 21" ao lado das tipologias,
 * repetindo o que o painel de pavimentos já mostra em outro lugar.
 *
 * O legado (`emp.plantas`) fica: é planta de projeto cadastrada antes de
 * Tipologias existir, e tirá-la esvaziaria a galeria num projeto antigo.
 */
export function plantasDeTipologia(emp: Empreendimento): { area: string; url: string }[] {
  const out: { area: string; url: string }[] = [];
  const vistos = new Set<string>();
  const add = (area?: string, url?: string) => {
    if (!area || !url || vistos.has(area)) return;
    vistos.add(area);
    out.push({ area, url });
  };
  for (const t of emp.tipologias ?? []) add(t.nome, t.plantaUrl);
  for (const p of emp.plantas ?? []) add(p.area, p.imagemUrl);
  return out;
}

export function plantasDoProjeto(
  emp: Empreendimento,
  niveis?: { label: string; plantaUrl?: string }[],
): { area: string; url: string }[] {
  const out: { area: string; url: string }[] = [];
  const vistos = new Set<string>();
  const add = (area: string, url?: string) => {
    if (!url || !area || vistos.has(area)) return;
    vistos.add(area);
    out.push({ area, url });
  };

  for (const t of emp.tipologias ?? []) add(t.nome, t.plantaUrl);
  for (const n of niveis ?? []) add(n.label, n.plantaUrl);
  for (const p of emp.plantas ?? []) add(p.area, p.imagemUrl);

  return out;
}

/**
 * Plantas legadas em `emp.plantas` que nenhuma das fontes novas cobre — o que
 * a aba Tipologias precisa oferecer para migrar. Uma planta cujo nome já é o de
 * uma tipologia ou de um nível já tem dono e não aparece aqui.
 */
export function plantasOrfas(
  emp: Empreendimento,
  niveis?: { label: string; plantaUrl?: string }[],
): { area: string; vagas: string; descricao?: string; imagemUrl?: string }[] {
  const donos = new Set<string>([
    ...(emp.tipologias ?? []).map((t) => t.nome),
    ...(niveis ?? []).map((n) => n.label),
  ]);
  return (emp.plantas ?? []).filter((p) => p.imagemUrl && !donos.has(p.area));
}

/** A tipologia de uma unidade — por id quando existe, senão pelo nome. */
export function tipologiaDaUnidade(u: Unidade, tipologias: Tipologia[]): Tipologia | undefined {
  if (u.tipologiaId) {
    const porId = tipologias.find((t) => t.id === u.tipologiaId);
    if (porId) return porId;
  }
  return tipologias.find((t) => t.nome === u.tipologia);
}

/** Atributos que a unidade herda do seu tipo quando não os declara. */
const HERDAVEIS = ["areaPrivativa", "areaTotal", "quartos", "suites", "vagas"] as const;

/** A tipologia diz alguma coisa sobre o apartamento, ou é só um nome com desenho? */
function tipologiaDescreve(t: Tipologia): boolean {
  return HERDAVEIS.some((k) => t[k] != null);
}

/**
 * A tipologia que DESCREVE a unidade — a que vale para área, quartos, suítes e
 * vagas.
 *
 * Normalmente é a tipologia ligada, por id ou por nome. O segundo caso existe
 * por causa da planta escolhida à mão: o editor deixa apontar a unidade para o
 * desenho de OUTRA tipologia (campo "Planta da unidade"), e é o que acontece
 * quando o projeto nasce com uma tipologia genérica — "Planta Padrão", sem
 * atributo nenhum — e as tipologias de verdade são cadastradas depois. A
 * unidade acabava exibindo a planta certa e ficha vazia.
 *
 * O desempate só entra quando a tipologia ligada não descreve nada: enquanto
 * ela tiver atributos, ela manda — trocar o desenho de uma unidade nunca muda
 * o tipo dela.
 */
export function tipologiaEfetiva(u: Unidade, tipologias: Tipologia[]): Tipologia | undefined {
  const ligada = tipologiaDaUnidade(u, tipologias);
  if (ligada && tipologiaDescreve(ligada)) return ligada;
  if (u.plantaUrl) {
    const daPlanta = tipologias.find((t) => t.plantaUrl === u.plantaUrl && tipologiaDescreve(t));
    if (daPlanta) return daPlanta;
  }
  return ligada;
}

/**
 * Unidade com os atributos EFETIVOS: o que ela declara vence, o resto vem da
 * tipologia.
 *
 * A herança acontece na LEITURA, de propósito. Copiar área e quartos para
 * dentro da unidade no momento em que se liga a tipologia (era o que o editor
 * fazia) congela o valor: cadastrar a área depois, ou corrigi-la, não chegava
 * nas 106 unidades já ligadas — e o corretor via ficha vazia numa vitrine cuja
 * tipologia estava preenchida. Resolvendo aqui, a tipologia é a fonte única e
 * o campo da unidade passa a ser o que sempre deveria ter sido: exceção.
 *
 * O nome e o id também são reescritos para os da tipologia efetiva, senão a
 * ficha mostra os números de um tipo com o rótulo de outro.
 */
export function unidadeComTipologia(u: Unidade, tipologias: Tipologia[]): Unidade {
  const t = tipologiaEfetiva(u, tipologias);
  if (!t) return u;
  return {
    ...u,
    tipologia: t.nome,
    tipologiaId: t.id,
    areaPrivativa: u.areaPrivativa ?? t.areaPrivativa,
    areaTotal: u.areaTotal ?? t.areaTotal,
    quartos: u.quartos ?? t.quartos,
    suites: u.suites ?? t.suites,
    vagas: u.vagas ?? t.vagas,
  };
}

/** `unidadeComTipologia` na lista inteira. Devolve a mesma lista se não há tipologia. */
export function unidadesComTipologia(unidades: Unidade[], tipologias: Tipologia[]): Unidade[] {
  if (!tipologias.length) return unidades;
  return unidades.map((u) => unidadeComTipologia(u, tipologias));
}

/** Faixas [mín, máx] de cada atributo — alimenta os limites dos sliders. */
export function faixasDe(unidades: Unidade[]): {
  area: [number, number] | null;
  preco: [number, number] | null;
  quartos: [number, number] | null;
  pavimento: [number, number] | null;
} {
  const faixa = (vals: number[]): [number, number] | null =>
    vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
  const num = (v?: number) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

  return {
    area: faixa(unidades.map((u) => num(u.areaPrivativa)).filter((v): v is number => v != null)),
    preco: faixa(unidades.map((u) => num(u.preco)).filter((v): v is number => v != null)),
    quartos: faixa(unidades.map((u) => num(u.quartos)).filter((v): v is number => v != null)),
    pavimento: faixa(unidades.map((u) => u.pavimento).filter((v): v is number => v != null)),
  };
}
