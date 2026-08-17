/**
 * Gera um espelho de vendas FICTÍCIO (mock determinístico) para o piloto:
 * 309 unidades em 3 torres (Ocean/Sea/River) × 9 pavimentos, com status
 * (disponível/reservada/vendida), preço, quartos e vagas — além das tipologias.
 * Rode: `npx tsx script/gen-unidades.ts`.
 * Substitua depois pelos dados reais de vendas mantendo o mesmo formato.
 */
import { promises as fs } from "fs";
import path from "path";
import type { Orientacao, Tipologia, Torre, Unidade, UnidadeStatus } from "../shared/schema";

// PRNG determinístico (mulberry32) — mesmo resultado a cada geração.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260709);

const TORRES: Torre[] = ["ocean", "sea", "river"];
const PLANTA_POR_TORRE: Record<Torre, string> = {
  ocean: "Ocean",
  sea: "Sea",
  river: "Sea", // River reutiliza as plantas Sea (não há plantas River nos assets)
};

/**
 * Atributos por tipo. As áreas são as mesmas de antes (48…72 m²); quartos,
 * suítes e vagas são fictícios e coerentes com a metragem.
 */
const TIPOS = [
  { tipo: 1, area: 48, quartos: 1, suites: 0, vagas: 1 },
  { tipo: 2, area: 52, quartos: 1, suites: 1, vagas: 1 },
  { tipo: 3, area: 56, quartos: 2, suites: 1, vagas: 1 },
  { tipo: 4, area: 60, quartos: 2, suites: 1, vagas: 1 },
  { tipo: 5, area: 64, quartos: 2, suites: 2, vagas: 2 },
  { tipo: 6, area: 72, quartos: 3, suites: 1, vagas: 2 },
];

// 12 unidades nos pav. 1–4, 11 nos pav. 5–9 => 103 por torre => 309 no total.
const UNIDADES_POR_PAVIMENTO = (pav: number) => (pav <= 4 ? 12 : 11);

/** Frente-mar vale mais; andar alto também. Valores fictícios. */
const PRECO_M2_BASE = 12_000; // R$/m²
const PREMIO_TORRE: Record<Torre, number> = { ocean: 1.12, sea: 1.06, river: 1.0 };
const PREMIO_POR_ANDAR = 0.025; // +2,5% a cada pavimento acima do 1º

/** Orientação da vista: Ocean e Sea olham o mar (leste), River para o interior. */
const ORIENTACAO_POR_TORRE: Record<Torre, Orientacao> = { ocean: "L", sea: "L", river: "O" };

/**
 * Preço em CENTAVOS. Determinístico e sem consumir o PRNG — assim os status
 * sorteados continuam idênticos aos da geração anterior.
 */
function precoDe(torre: Torre, pav: number, area: number): number {
  const reais = area * PRECO_M2_BASE * PREMIO_TORRE[torre] * (1 + (pav - 1) * PREMIO_POR_ANDAR);
  // Arredonda para a centena de reais mais próxima, como tabela de vendas real.
  return Math.round(reais / 100) * 100 * 100;
}

function statusSorteado(): UnidadeStatus {
  const r = rand();
  if (r < 0.62) return "disponivel";
  if (r < 0.85) return "reservada";
  return "vendida";
}

const unidades: Unidade[] = [];
for (const torre of TORRES) {
  for (let pav = 1; pav <= 9; pav++) {
    const n = UNIDADES_POR_PAVIMENTO(pav);
    for (let i = 0; i < n; i++) {
      const t = TIPOS[i % 6];
      const numero = `${pav}${String(i + 1).padStart(2, "0")}`;
      const nomeTipologia = `${PLANTA_POR_TORRE[torre]} — Tipo ${t.tipo}`;
      unidades.push({
        id: `${torre}-${numero}`,
        torre,
        pavimento: pav,
        numero,
        tipologia: nomeTipologia,
        tipologiaId: nomeTipologia
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        areaPrivativa: t.area,
        quartos: t.quartos,
        suites: t.suites,
        vagas: t.vagas,
        orientacao: ORIENTACAO_POR_TORRE[torre],
        preco: precoDe(torre, pav, t.area),
        status: statusSorteado(),
        // Texto mantido para compatibilidade com o formato antigo.
        area: `${t.area} m²`,
      });
    }
  }
}

/** Tipologias: uma por combinação de bloco de planta (Ocean/Sea) × tipo. */
const tipologias: Tipologia[] = [];
for (const bloco of ["Ocean", "Sea"]) {
  for (const t of TIPOS) {
    const nome = `${bloco} — Tipo ${t.tipo}`;
    tipologias.push({
      id: nome
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      nome,
      areaPrivativa: t.area,
      quartos: t.quartos,
      suites: t.suites,
      vagas: t.vagas,
      descricao: `Bloco ${bloco}`,
      // plantaUrl / axonometricaUrl ficam para o editor: as plantas técnicas já
      // existem em empreendimentos.ts e as axonométricas ainda não existem.
    });
  }
}

const precos = unidades.map((u) => u.preco ?? 0);
const out = {
  geradoEm: new Date().toISOString(),
  observacao:
    "Dados de disponibilidade e PREÇOS DEMONSTRATIVOS (mock). Substituir pelos dados reais de vendas.",
  legenda: { disponivel: "verde", reservada: "amarelo", vendida: "vermelho" },
  total: unidades.length,
  faixaPreco: { min: Math.min(...precos), max: Math.max(...precos) },
  tipologias,
  unidades,
};

const file = path.resolve(process.cwd(), "data", "unidades.json");
await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, JSON.stringify(out, null, 2), "utf-8");

const cont = unidades.reduce(
  (a, u) => ((a[u.status] = (a[u.status] ?? 0) + 1), a),
  {} as Record<string, number>,
);
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
console.log(`Gerado ${unidades.length} unidades e ${tipologias.length} tipologias em ${file}`);
console.log("Distribuição:", cont);
console.log(`Preço: ${brl(Math.min(...precos))} → ${brl(Math.max(...precos))}`);
