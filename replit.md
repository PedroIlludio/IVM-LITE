# Quinta das Mangueiras — App Piloto (HSM)

## Visão geral

Tour interativo 3D do empreendimento **Quinta das Mangueiras**, resort residencial
frente-mar em **Ponta do Mangue — Barra Grande, Maragogi/AL** (Caribe Brasileiro).
Uma realização **Farias Incorporadora + HSM**.

O app mostra o modelo 3D da fachada (GLB) posicionado sobre os **Google Photorealistic
3D Tiles** (fotogrametria estilo Google Earth) via Cesium, com simulação solar, painel
de informações (tipologias, amenities, pontos de interesse) e galeria de imagens.

Derivado da base "JOOY Empreendimentos Map", porém reduzido a **um único empreendimento**
e com identidade visual própria (marca Quinta das Mangueiras — turquesa + areia, fontes
Ivy Mode e Brandon).

## Arquitetura

- **Frontend**: React 18 + TypeScript, bundler Vite. Rotas via Wouter: `/` (landing),
  `/explorar` (experiência 3D) e `/editor` (editor de posicionamento, sem link público).
- **3D**: Cesium + `createGooglePhotorealistic3DTileset`. O modelo GLB otimizado
  (23 MB, Draco+WebP) fica em `client/public/models/hsm-fachada.glb`.
- **Backend**: Express (tsx em dev). Endpoints: `/api/config` (serve a chave do Google
  Maps ao client), `/api/vision3d/placements` (lê/grava o posicionamento do editor) e
  rotas de object storage.
- **Dados**: empreendimento hardcoded em `client/src/lib/empreendimentos.ts` (não usa DB).

## Configuração / como rodar

1. `npm install`
2. Crie um `.env` na raiz com a chave do Google Maps:
   ```
   GOOGLE_MAPS_API_KEY=<sua_chave>
   GOOGLE_MAP_ID=DEMO_MAP_ID
   PORT=5050
   ```
   A chave precisa ter **Map Tiles API** + **Maps JavaScript API** habilitadas no Google
   Cloud. Sem ela, `/explorar` exibe "Chave do Google Maps não configurada".
3. `npm run dev` (ou `npx tsx server/index.ts`) → abre em `http://localhost:5050`.
4. Ajuste fino da posição do modelo em `/editor` (salva em `data/vision3d-placements.json`).

`npm run build` gera produção em `dist/`; `npm start` roda o build.

## Pontos de posicionamento 3D

- Coordenada do terreno: `-8.939762, -35.169635` (em `empreendimentos.ts` e no override
  de `client/src/lib/vision3d-config.ts`).
- Fuso horário: `MARAGOGI_TZ_OFFSET = -3` (Alagoas, sem horário de verão).
- Elevação de fallback (nível do mar): `FALLBACK_GROUND_HEIGHT = 3` em `cesium-setup.ts`.
- O encaixe visual do GLB sobre a fotogrametria (heading/escala/altura) é calibrado no
  `/editor` — os valores salvos sobrepõem os defaults do código.

## Assets da marca

- Fontes: `client/public/fonts/` (Ivy Mode = serif/display, Brandon = sans).
- Logos/símbolo: `client/src/assets/`.
- Galeria: `client/public/gallery/` (39 imagens; ver observação sobre otimização abaixo).
- Plantas humanizadas: `client/src/assets/plantas/`.
- Fontes originais dos assets (Book PDF, artes, .ai/.psd): pasta `arquivos hsm/` (fora do app).

## Observações

- **Galeria pesada**: as imagens originais têm 8–13 MB cada. Para produção, recomenda-se
  gerar versões web (máx. ~2000px, ~85% de qualidade → ~300–500 KB) para carregamento fluido.
- Cobertura dos Google 3D Tiles nessa faixa litorânea pode ser limitada; validar no `/editor`.
