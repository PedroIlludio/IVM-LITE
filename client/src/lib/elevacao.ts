/**
 * Cota do terreno por DEM público — a referência de altura da cena SEM
 * fotogrametria.
 *
 * Com a cidade do Google em cena, a altura do solo sob o empreendimento é
 * medida com uma sonda contra os próprios tiles. Tirada a fotogrametria, some
 * a sonda e some a referência: o prédio cai para `alturaSolo` do projeto e, se
 * ela nunca foi calibrada, para o fallback de 3 m.
 *
 * Três metros é o nível do mar. Num planalto isso é um erro de MAIS DE UM
 * QUILÔMETRO, e ele não fica contido no prédio: todas as câmeras salvas — vista
 * principal, tour, unidades, entorno — guardam altitude ABSOLUTA e foram
 * gravadas com o terreno real embaixo. Com o empreendimento a 3 m e as câmeras
 * a 1.070 m, elas miram um ponto a um quilômetro de distância do que deveriam
 * mostrar, e a vitrine abre em tela vazia.
 *
 * O SRTM resolve isso sem chave, sem cadastro e sem cartão — as três razões
 * pelas quais o mini mapa já havia trocado o Google pelo OpenFreeMap. A
 * precisão vertical (~15 m) é grosseira perto da fotogrametria, e é
 * irrelevante perto do erro que ela substitui.
 */

/** Uma consulta por coordenada, para a vida da aba. */
const CACHE = new Map<string, number>();

/**
 * Teto de espera.
 *
 * A cota é um REFINAMENTO: a cena já está de pé quando ela chega. Esperar
 * muito por ela seria trocar um enquadramento imperfeito por uma tela de
 * carregamento mais longa — mau negócio numa vitrine.
 */
const TIMEOUT_MS = 6000;

/**
 * Altitude do terreno em metros, ou `null` se não deu para saber.
 *
 * `null` nunca é motivo de erro na tela: quem chama mantém a cota que já
 * tinha. É o mesmo contrato do resto da cena — serviço externo que não
 * responde degrada a experiência, não a interrompe.
 */
export async function elevacaoDoTerreno(lat: number, lng: number): Promise<number | null> {
  // 4 casas ≈ 11 m: mais fino que isso pediria consultas novas para o mesmo
  // lugar, e o DEM não tem resolução para distinguir.
  const chave = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const guardado = CACHE.get(chave);
  if (guardado !== undefined) return guardado;

  const ctrl = new AbortController();
  const expirar = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(
      `https://api.opentopodata.org/v1/srtm90m?locations=${chave}`,
      { signal: ctrl.signal },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      status?: string;
      results?: { elevation?: number | null }[];
    };
    if (j.status !== "OK") return null;
    const e = j.results?.[0]?.elevation;
    if (typeof e !== "number" || !Number.isFinite(e)) return null;
    /**
     * Só o ACERTO entra no cache.
     *
     * Guardar a falha transformaria uma oscilação de rede de dois segundos em
     * uma sessão inteira sem cota — e o "Tentar de novo" da vitrine não
     * recarrega a página, então nada limparia esse `null`.
     */
    CACHE.set(chave, e);
    return e;
  } catch {
    return null;
  } finally {
    clearTimeout(expirar);
  }
}
