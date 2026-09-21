# Modelos 3D (GLB) das torres

Coloque aqui os arquivos `.glb` das torres usados pelo visualizador **Vision 3D** (`/3d`).

## Como usar

1. Exporte/baixe a torre como `.glb` (glTF binário). Ex: `ikon.glb`.
2. Copie o arquivo para esta pasta: `client/public/models/ikon.glb`.
3. Em `client/src/lib/vision3d-config.ts`, no objeto `OVERRIDES`, defina o
   `modelUrl` do empreendimento correspondente:

   ```ts
   ikon: {
     modelUrl: "/models/ikon.glb",
     heading: 0,
     scale: 1,
   },
   ```

4. Abra `/3d`, selecione o empreendimento e use o painel **"Ajuste do modelo"**
   para acertar rotação, escala e altura da base. Cole os valores finais de
   volta no `OVERRIDES` para virarem o padrão.

> Enquanto não houver `modelUrl`, o visualizador desenha um volume placeholder
> (mesma pegada/altura aproximada) para a simulação solar funcionar mesmo sem o
> GLB final.

## Observação

O GLB original da torre (`tower_*.zip`, ~111 MB) **não veio** no pacote enviado —
era apenas um ponteiro do Git LFS. Forneça o arquivo para colocá-lo de verdade.

Arquivos `.glb` grandes não deveriam ser commitados no Git comum; prefira Git LFS
ou o object storage que o app já usa.
