import { expect, test } from "@playwright/test";

const vitrine = process.env.UX_PATH ?? "/meloborges/now-on";

async function abrirVitrine(page: import("@playwright/test").Page) {
  await page.goto(vitrine);
  await expect(page.getByTestId("panel-empreendimentos")).toBeVisible({ timeout: 60_000 });
  // A capa bloqueia cliques enquanto a fotogrametria e o empreendimento entram.
  await expect(page.locator(".v-carregando")).toBeHidden({ timeout: 75_000 });
}

test("jornada principal cabe no celular e preserva a cena", async ({ page }) => {
  await abrirVitrine(page);

  const viewport = page.viewportSize()!;
  const painel = page.getByTestId("panel-empreendimentos");
  const caixaMenu = await painel.boundingBox();
  expect(caixaMenu).not.toBeNull();
  expect(caixaMenu!.height).toBeLessThan(viewport.height * 0.25);

  // No topo ficam só as ações primárias; as secundárias abrem sob demanda.
  await expect(page.locator(".v-scene-controls > button:visible")).toHaveCount(3);
  await page.getByRole("button", { name: "Mais ações" }).click();
  await expect(page.getByRole("menu", { name: "Mais ações da cena" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar mais ações" }).click();

  // Uma categoria com leitura expande a folha; voltar a deixa compacta.
  await page.getByTestId("cat-ficha").click();
  const caixaDetalhe = await painel.boundingBox();
  expect(caixaDetalhe).not.toBeNull();
  expect(caixaDetalhe!.height).toBeGreaterThan(viewport.height * 0.6);
  await page.getByTestId("btn-voltar-categoria").click();
  expect((await painel.boundingBox())!.height).toBeLessThan(viewport.height * 0.25);

  // O trilho é realmente rolável e o último destino pode entrar inteiro na tela.
  const categorias = page.getByTestId("categorias-scroll-mobile");
  await expect(categorias).toBeVisible();
  expect(await categorias.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await categorias.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: "instant" }));
  await expect.poll(() => categorias.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const ultimaCategoria = categorias.locator(".v-gaveta-item").last();
  const caixaCategorias = await categorias.boundingBox();
  const caixaUltimaCategoria = await ultimaCategoria.boundingBox();
  expect(caixaUltimaCategoria!.x + caixaUltimaCategoria!.width)
    .toBeLessThanOrEqual(caixaCategorias!.x + caixaCategorias!.width + 1);

  // Galeria é um overlay verdadeiro: sem vazamento horizontal e com saída.
  await page.getByTestId("cat-galeria").click();
  const galeria = page.getByTestId("media-overlay");
  await expect(galeria).toBeVisible();
  const caixaGaleria = await galeria.boundingBox();
  expect(caixaGaleria?.width).toBe(viewport.width);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId("btn-media-close").click();

  // A busca não deixa uma faixa morta da cena na lateral no celular.
  await page.getByTestId("cat-unidades").click();
  const busca = page.locator(".v-unit-search");
  await expect(busca).toBeVisible();
  expect((await busca.boundingBox())!.width).toBe(viewport.width);

  // O detalhe da unidade também é tela cheia; meia gaveta lateral deixa a
  // ficha estreita demais e cria gesto acidental na cena que sobra ao lado.
  const primeiraUnidade = busca.locator(".v-card").first();
  await expect(primeiraUnidade).toBeVisible();
  await primeiraUnidade.click();
  const popup = page.locator(".v-unit-popup");
  await expect(popup).toBeVisible();
  expect((await popup.boundingBox())!.width).toBe(viewport.width);

  // A ficha cheia sai de cena sob demanda, mas continua montada para voltar ao
  // mesmo apartamento e ao mesmo modo de visualização.
  await page.getByTestId("btn-ver-unidade-3d").click();
  await expect(busca).toBeHidden();
  await expect(popup).toBeHidden();
  const palcoUnidade = page.getByTestId("mobile-unit-stage");
  await expect(palcoUnidade).toBeVisible();
  await expect(palcoUnidade).toContainText(/Unidade .* pavimento/);
  await expect(page.locator(".cesium-widget canvas").first()).toBeVisible();
  await page.getByTestId("btn-voltar-info-unidade").click();
  await expect(popup).toBeVisible();

  // A ação de pavimento também entrega a cena imediatamente; antes ela mudava
  // a câmera atrás da ficha cheia e parecia não funcionar.
  await popup.getByRole("button", { name: "Vista do andar" }).click();
  await expect(popup).toBeHidden();
  await expect(palcoUnidade).toContainText("Vista do pavimento");
  await page.getByTestId("btn-voltar-info-unidade").click();
  await expect(popup).toBeVisible();
  await popup.locator('button[title="Fechar"]').click();

  await busca.locator('button[title="Fechar"]').click();
  await expect(painel).toBeVisible();
});

test("paisagem preserva uma grande área interativa para a maquete", async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await abrirVitrine(page);

  const painel = page.getByTestId("panel-empreendimentos");
  const caixa = await painel.boundingBox();
  expect(caixa).not.toBeNull();
  expect(caixa!.width).toBeLessThanOrEqual(915 * 0.65);
  expect(caixa!.height).toBe(412);
  await expect(page.locator(".v-scene-controls > button:visible")).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("login administrativo não cria rolagem horizontal", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator("body")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
