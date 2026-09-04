import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("POI pode ser reposicionado clicando na fotogrametria", async ({ page }) => {
  await page.goto("/admin/1cd1debe-1878-4cf2-9b10-212bd3cd6cf9");
  await expect(page.getByRole("button", { name: "POIs" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "POIs" }).click();
  await page.getByRole("button", { name: /Bento Restaurante/ }).click();
  await page.getByRole("button", { name: "Posicionar" }).click();
  const aviso = page.getByText("CLIQUE NO MAPA PARA O PONTO");
  await expect(aviso).toBeVisible();
  const canvas = page.locator(".cesium-widget canvas").first();
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await canvas.click({ position: { x: 500, y: 420 } });
  await expect(aviso).toBeHidden({ timeout: 10_000 });
});
