import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Rota viária entre o empreendimento e um ponto de interesse.
 *
 * Existia só no servidor Express (`server/routes.ts`), que **não vai para o
 * deploy**: o `.vercelignore` exclui a pasta `server`, e na Vercel só existem
 * as funções de `api/`. O resultado era o traçado de rota funcionar na máquina
 * de quem edita e falhar calado no site publicado — o mapa desenhava os pontos
 * e nunca o caminho até eles.
 *
 * Precisa ser servidor, e não chamada direta do navegador, por dois motivos: o
 * OSRM público não manda cabeçalho de CORS, e a resposta é cacheável — um
 * mesmo par empreendimento→POI é pedido por todo visitante.
 */

/** Limite de espera do OSRM. Acima disso a vitrine já parece travada. */
const TEMPO_LIMITE_MS = 12_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const num = (v: unknown) => Number(Array.isArray(v) ? v[0] : v);
  const fromLng = num(req.query.fromLng);
  const fromLat = num(req.query.fromLat);
  const toLng = num(req.query.toLng);
  const toLat = num(req.query.toLat);

  const valido =
    [fromLng, fromLat, toLng, toLat].every(Number.isFinite) &&
    Math.abs(fromLng) <= 180 && Math.abs(toLng) <= 180 &&
    Math.abs(fromLat) <= 90 && Math.abs(toLat) <= 90;
  if (!valido) {
    return res.status(400).json({ message: "Coordenadas inválidas para calcular a rota." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEMPO_LIMITE_MS);
  try {
    const url =
      "https://router.project-osrm.org/route/v1/driving/" +
      `${fromLng},${fromLat};${toLng},${toLat}` +
      "?overview=full&geometries=geojson";
    const resposta = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "IVM-Lite/1.0" },
    });
    if (!resposta.ok) throw new Error(`OSRM respondeu ${resposta.status}`);

    const corpo = (await resposta.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
    const rota = corpo.routes?.[0];
    const coordinates = rota?.geometry?.coordinates;
    if (corpo.code !== "Ok" || !coordinates || coordinates.length < 2) {
      return res.status(404).json({ message: "Nenhum caminho viário encontrado." });
    }

    // Uma hora de cache: o traçado entre dois pontos fixos não muda, e sem isto
    // cada visitante gastaria uma chamada ao OSRM público por POI aberto.
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).json({
      coordinates,
      distance: rota.distance ?? null,
      duration: rota.duration ?? null,
    });
  } catch (erro) {
    const message =
      erro instanceof Error && erro.name === "AbortError"
        ? "O cálculo da rota excedeu o tempo limite."
        : "Não foi possível calcular a rota agora.";
    return res.status(502).json({ message });
  } finally {
    clearTimeout(timeout);
  }
}
