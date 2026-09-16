import { expect, test } from "@playwright/test";

const vitrine = process.env.UX_PATH ?? "/meloborges/now-on";

async function abrirVitrine(page: import("@playwright/test").Page) {
  await page.goto(vitrine);
  await expect(page.locator(".vd-ilha, .vd-barra-movel").first()).toBeAttached({ timeout: 60_000 });
  // A capa bloqueia cliques enquanto a fotogrametria e o empreendimento entram.
  await expect(page.locator(".v-carregando")).toBeHidden({ timeout: 75_000 });
}

const semVazamento = (page: import("@playwright/test").Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test("jornada principal cabe no celular e preserva a cena", async ({ page }) => {
  await abrirVitrine(page);
  const viewport = page.viewportSize()!;

  // No celular a ilha dá lugar à barra de seções do rodapé, sem Home.
  await expect(page.locator(".vd-ilha")).toBeHidden();
  const barra = page.locator(".vd-barra-movel");
  await expect(barra).toBeVisible();
  await expect(barra.getByRole("button", { name: "Home" })).toHaveCount(0);
  // Ações do topo empilhadas: só as primárias (menos quando o projeto não
  // tem tour ou noturno), nunca mais que quatro.
  expect(await page.locator(".vd-acoes > button:visible").count()).toBeLessThanOrEqual(4);
  await semVazamento(page);

  // Projeto abre como folha inferior e deixa a cena à vista em cima.
  await barra.getByRole("button", { name: "Projeto" }).click();
  const ficha = page.getByTestId("panel-empreendimentos");
  await expect(ficha).toBeVisible();
  const caixaFicha = (await ficha.boundingBox())!;
  expect(caixaFicha.width).toBeCloseTo(viewport.width, 0);
  expect(caixaFicha.y).toBeGreaterThan(viewport.height * 0.3);
  await ficha.getByRole("button", { name: "Recolher a ficha do projeto" }).click();
  await expect(ficha).toBeHidden();

  // Galeria é tela cheia, sem vazamento horizontal e com saída.
  if (await barra.getByRole("button", { name: "Galeria" }).count()) {
    await barra.getByRole("button", { name: "Galeria" }).click();
    const galeria = page.getByTestId("media-overlay");
    await expect(galeria).toBeVisible();
    expect((await galeria.boundingBox())!.width).toBeCloseTo(viewport.width, 0);
    await semVazamento(page);
    await page.getByTestId("btn-media-close").click();
  }

  // Lazer é peça de mídia em tela cheia — não navega na maquete.
  if (await barra.getByRole("button", { name: "Lazer" }).count()) {
    await barra.getByRole("button", { name: "Lazer" }).click();
    const lazer = page.getByTestId("lazer-view");
    await expect(lazer).toBeVisible();
    expect((await lazer.boundingBox())!.width).toBeCloseTo(viewport.width, 0);
    expect((await lazer.boundingBox())!.height).toBeCloseTo(viewport.height, 0);
    // A mídia fica inteira, na horizontal, e não cortada pela altura da tela.
    const midia = lazer.locator("img, video").first();
    if (await midia.count()) {
      const caixa = (await midia.boundingBox())!;
      expect(caixa.width).toBeCloseTo(viewport.width, 0);
      expect(caixa.height).toBeLessThan(caixa.width);
    }
    await page.getByRole("button", { name: "Próximo ambiente" }).click();
    await expect(lazer.getByText(/^02 \//)).toBeVisible();
    // Dentro da seção a barra some; a saída é o "Voltar".
    await expect(barra).toBeHidden();
    await lazer.getByRole("button", { name: "Voltar" }).click();
    await expect(lazer).toBeHidden();
    await expect(barra).toBeVisible();
  }

  // Unidades: lista em TELA CHEIA.
  await barra.getByRole("button", { name: "Unidades" }).click();
  const busca = page.locator(".v-unit-search");
  await expect(busca).toBeVisible();
  const caixaBusca = (await busca.boundingBox())!;
  expect(caixaBusca.width).toBeCloseTo(viewport.width, 0);
  expect(caixaBusca.height).toBeCloseTo(viewport.height, 0);

  // A ficha também é tela cheia, e a cena só aparece pelo botão.
  await busca.locator('[data-testid^="unidade-card-"]').first().click();
  const cartao = page.getByTestId("cartao-unidade");
  await expect(cartao).toBeVisible();
  expect((await cartao.boundingBox())!.height).toBeCloseTo(viewport.height, 0);
  await page.getByTestId("btn-ver-unidade-3d").click();
  await expect(cartao).toBeHidden();
  await expect(busca).toBeHidden();
  const palco = page.getByTestId("mobile-unit-stage");
  await expect(palco).toContainText("Unidade em 3D");
  await expect(page.locator(".cesium-widget canvas").first()).toBeVisible();
  await expect(page.locator('img[title="Cesium ion"]')).toHaveCount(0);
  await page.getByTestId("btn-voltar-info-unidade").click();
  await expect(cartao).toBeVisible();

  // O pavimento também leva direto à cena.
  await cartao.getByRole("button", { name: "Ver o pavimento" }).click();
  await expect(palco).toContainText("Vista do pavimento");
  await page.getByTestId("btn-voltar-info-unidade").click();
  await expect(cartao).toBeVisible();

  await cartao.getByTestId("btn-mostrar-todas").click();
  await expect(cartao).toBeHidden();

  // Comparar plantas: marca exatamente duas na lista; o botão só libera com as duas.
  await page.getByTestId("btn-comparar-unidades").click();
  const abrir = page.getByTestId("btn-abrir-comparacao");
  await expect(abrir).toBeDisabled();
  const linhas = busca.locator('[data-testid^="unidade-card-"]');
  await linhas.nth(0).click();
  await linhas.nth(1).click();
  await expect(abrir).toBeEnabled();
  await expect(abrir).toContainText("Comparar 2 plantas");
  await abrir.click();
  const comparador = page.getByTestId("comparador-unidades");
  await expect(comparador).toBeVisible();
  expect((await comparador.boundingBox())!.width).toBeCloseTo(viewport.width, 0);
  expect((await comparador.boundingBox())!.height).toBeCloseTo(viewport.height, 0);
  await expect(comparador.getByRole("region", { name: /^Unidade / })).toHaveCount(2);
  await semVazamento(page);
  await page.getByTestId("btn-fechar-comparacao").click();
  await expect(busca).toBeVisible();

  await expect(cartao).toBeHidden();
  await busca.getByRole("button", { name: "Fechar unidades" }).click();
  await expect(busca).toBeHidden();

  // Entorno é SÓ o mapa: sem lista em texto; tocar num ícone abre o local.
  await barra.getByRole("button", { name: "Entorno" }).click();
  const mapa = page.getByTestId("mapa-entorno-viewport");
  await expect(mapa).toBeVisible();
  await expect(page.locator(".maplibregl-map")).toHaveCSS("height", `${viewport.height}px`, { timeout: 30_000 });
  await expect(page.getByTestId("poi-item-0")).toHaveCount(0);
  const primeiroPoi = page.locator(".maplibregl-marker span").first();
  await expect(primeiroPoi).toBeVisible({ timeout: 30_000 });
  await primeiroPoi.click();
  await expect(page.getByTestId("cartao-poi")).toBeVisible();

  // Voltar ao 3D remonta a cena com a espera curta, sem o diagnóstico.
  await expect(barra).toBeHidden();
  await mapa.getByRole("button", { name: "Voltar" }).click();
  await expect(mapa).toBeHidden();
  await expect(page.getByText("Carregando cena 3D")).toBeVisible();
  await expect(page.getByText(/Parado há/)).toHaveCount(0);
  await expect(page.locator(".v-carregando")).toBeHidden({ timeout: 75_000 });
  await expect(page.locator(".cesium-widget canvas").first()).toBeVisible();
  await expect(barra).toBeVisible();
});

test("paisagem preserva uma grande área interativa para a maquete", async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await abrirVitrine(page);

  await expect(page.locator(".vd-barra-movel")).toBeVisible();
  expect(await page.locator(".vd-acoes > button:visible").count()).toBeLessThanOrEqual(4);
  await semVazamento(page);
});

test("desktop: ilha fixa, um cartão por seção e clima só com o 3D", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await abrirVitrine(page);

  const ilha = page.locator(".vd-ilha");
  await expect(ilha).toBeVisible();
  const larguraIlha = (await ilha.boundingBox())!.width;

  // O hover mostra a etiqueta FORA da ilha, sem mudar a largura dela.
  await page.getByTestId("nav-projeto").hover();
  await expect(page.getByTestId("nav-projeto").locator(".vd-ilha-rotulo")).toHaveCSS("opacity", "1");
  expect((await ilha.boundingBox())!.width).toBe(larguraIlha);

  const clima = page.getByRole("region", { name: "Controle de luz" });
  await page.getByTestId("nav-projeto").click();
  await expect(page.getByTestId("panel-empreendimentos")).toBeVisible();
  await expect(clima).toBeVisible();

  // O cartão da ficha termina acima do clima.
  const caixaFicha = (await page.getByTestId("panel-empreendimentos").boundingBox())!;
  const caixaClima = (await clima.boundingBox())!;
  expect(caixaFicha.y + caixaFicha.height).toBeLessThanOrEqual(caixaClima.y);

  // Localização: tela clara, sem clima, lista dentro da largura do painel.
  if (await page.getByTestId("nav-local").count()) {
    await page.getByTestId("nav-local").click();
    await expect(ilha).toHaveAttribute("data-claro", "1");
    await expect(clima).toBeHidden();
    const primeiro = page.getByTestId("poi-item-0");
    await expect(primeiro).toBeVisible();
    const painel = page.getByRole("complementary", { name: "Pontos de interesse" });
    expect(await painel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await semVazamento(page);
});

test("login administrativo não cria rolagem horizontal", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator("body")).toBeVisible();
  await semVazamento(page);
});
