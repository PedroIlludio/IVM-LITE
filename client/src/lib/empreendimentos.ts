import type { Empreendimento } from "@shared/schema";

// Logo/símbolo da marca (usado como marcador no mapa 3D). Servido de
// client/public/brand — URL estável, para o projeto ser serializável no Supabase.
const simboloQuinta = "/brand/simbolo-quinta-branco.png";

// Plantas humanizadas (servidas de client/public/plantas — URLs estáveis, para
// o projeto ser serializável no Supabase).
const plantaSubsolo = "/plantas/01-subsolo.webp";
const plantaTerreo = "/plantas/02-terreo.webp";
const plantaRooftop = "/plantas/03-rooftop.webp";
const plantaOcean1 = "/plantas/04-ocean-tipo-1.webp";
const plantaOcean2 = "/plantas/06-ocean-tipo-2.webp";
const plantaOcean3 = "/plantas/05-ocean-tipo-3.webp";
const plantaOcean4 = "/plantas/06-ocean-tipo-4.webp";
const plantaOcean5 = "/plantas/05-ocean-tipo-5.webp";
const plantaOcean6 = "/plantas/07-ocean-tipo-6.webp";
const plantaSea1 = "/plantas/08-sea-tipo-1.webp";
const plantaSea2 = "/plantas/09-sea-tipo-2.webp";
const plantaSea3 = "/plantas/10-sea-tipo-3.webp";
const plantaSea4 = "/plantas/11-sea-tipo-4.webp";
const plantaSea5 = "/plantas/12-sea-tipo-5.webp";
const plantaSea6 = "/plantas/13-sea-tipo-6.webp";

// Galeria: imagens servidas de client/public/gallery (referência por URL).
// Ordenada para liderar com as imagens-herói (fachadas, vista aérea, lazer).
const galeria: { url: string; legenda: string }[] = [
  { url: "/gallery/30-fotomontagem-01.jpg", legenda: "Vista Aérea" },
  { url: "/gallery/31-fotomontagem-02.jpg", legenda: "Vista Aérea" },
  { url: "/gallery/36-fachada-ocean-01.jpg", legenda: "Fachada Ocean" },
  { url: "/gallery/32-fachada-river.jpg", legenda: "Fachada River" },
  { url: "/gallery/33-fachada-sea-01.jpg", legenda: "Fachada Sea" },
  { url: "/gallery/17-beach-club.jpg", legenda: "Beach Club" },
  { url: "/gallery/15-piscina.jpg", legenda: "Piscina" },
  { url: "/gallery/41-piscina-detalhe.jpg", legenda: "Piscina — Detalhe" },
  { url: "/gallery/18-espaco-beira-mar.jpg", legenda: "Espaço Beira-Mar" },
  { url: "/gallery/16-praca-convivencia.jpg", legenda: "Praça de Convivência" },
  { url: "/gallery/14-convivencia-gourmet.jpg", legenda: "Convivência Gourmet" },
  { url: "/gallery/02-restaurante-01.jpg", legenda: "Restaurante" },
  { url: "/gallery/03-restaurante-02.jpg", legenda: "Restaurante" },
  { url: "/gallery/25-bar-01.jpg", legenda: "Bar" },
  { url: "/gallery/26-bar-02.jpg", legenda: "Bar" },
  { url: "/gallery/40-bar-detalhe.jpg", legenda: "Bar — Detalhe" },
  { url: "/gallery/01-hall-river.jpg", legenda: "Hall River" },
  { url: "/gallery/09-hall-sea.jpg", legenda: "Hall Sea" },
  { url: "/gallery/13-hall-ocean.jpg", legenda: "Hall Ocean" },
  { url: "/gallery/23-spa.jpg", legenda: "Spa" },
  { url: "/gallery/22-deck-hidromassagem.jpg", legenda: "Deck Hidromassagem" },
  { url: "/gallery/21-sauna-umida.jpg", legenda: "Sauna Úmida" },
  { url: "/gallery/24-espaco-beleza.jpg", legenda: "Espaço Beleza" },
  { url: "/gallery/19-academia.jpg", legenda: "Academia" },
  { url: "/gallery/08-coworking.jpg", legenda: "Coworking" },
  { url: "/gallery/07-mini-mercado.jpg", legenda: "Self Market" },
  { url: "/gallery/05-lavanderia.jpg", legenda: "Lavanderia" },
  { url: "/gallery/06-brinquedoteca.jpg", legenda: "Brinquedoteca" },
  { url: "/gallery/11-parquinho.jpg", legenda: "Playground" },
  { url: "/gallery/10-pet-place.jpg", legenda: "Pet Place & Pet Wash" },
  { url: "/gallery/12-pomar.jpg", legenda: "Pomar" },
  { url: "/gallery/20-garagem.jpg", legenda: "Garagem" },
  { url: "/gallery/28-studio-sea.jpg", legenda: "Studio Sea" },
  { url: "/gallery/29-studio-ocean.jpg", legenda: "Studio Ocean" },
  { url: "/gallery/37-fachada-ocean-02.jpg", legenda: "Fachada Ocean" },
  { url: "/gallery/38-fachada-ocean-03.jpg", legenda: "Fachada Ocean" },
  { url: "/gallery/34-fachada-sea-02.jpg", legenda: "Fachada Sea" },
  { url: "/gallery/39-fachadadetalhe-01.jpg", legenda: "Fachada — Detalhe" },
  { url: "/gallery/42-fachada-detalhe-02.jpg", legenda: "Fachada — Detalhe" },
];

// Vídeos: comprimidos (H.264, web) servidos de client/public/videos, com poster.
const videos: { url: string; poster: string; titulo: string }[] = [
  { url: "/videos/video-01.mp4", poster: "/videos/video-01.jpg", titulo: "Cinematográfico 01" },
  { url: "/videos/video-02.mp4", poster: "/videos/video-02.jpg", titulo: "Cinematográfico 02" },
  { url: "/videos/video-03.mp4", poster: "/videos/video-03.jpg", titulo: "Cinematográfico 03" },
  { url: "/videos/video-04.mp4", poster: "/videos/video-04.jpg", titulo: "Cinematográfico 04" },
  { url: "/videos/video-05.mp4", poster: "/videos/video-05.jpg", titulo: "Cinematográfico 05" },
  { url: "/videos/video-06.mp4", poster: "/videos/video-06.jpg", titulo: "Cinematográfico 06" },
  { url: "/videos/video-07.mp4", poster: "/videos/video-07.jpg", titulo: "Cinematográfico 07" },
];

export const empreendimentos: Empreendimento[] = [
  {
    id: "quinta-das-mangueiras",
    name: "Quinta das Mangueiras",
    slug: "quinta-das-mangueiras",
    address: "Ponta do Mangue — Barra Grande",
    neighborhood: "Maragogi",
    lat: -8.939762,
    lng: -35.169635,
    tipo: "Resort Residencial — Frente Mar",
    descricao:
      "Um projeto com essência de casa de praia no Caribe Brasileiro. Nascido da união entre a Farias Incorporadora e a HSM, o Quinta das Mangueiras reúne conforto, exclusividade, natureza e futuro em Maragogi/AL. Com design biofílico, integra natureza, arquitetura e sensações em cada detalhe — três blocos frente-mar (Ocean, Sea e River) com lazer completo no térreo e no rooftop.",
    terreno: "-",
    torres: "3 (Ocean, Sea e River)",
    pavimentos: "9 pavimentos",
    unidades: 309,
    elevadores: "9 elevadores",
    peDireito: "-",
    plantas: [
      { area: "Ocean — Tipo 1", vagas: "-", descricao: "Bloco Ocean", imagemUrl: plantaOcean1 },
      { area: "Ocean — Tipo 2", vagas: "-", descricao: "Bloco Ocean", imagemUrl: plantaOcean2 },
      { area: "Ocean — Tipo 3", vagas: "-", descricao: "Bloco Ocean", imagemUrl: plantaOcean3 },
      { area: "Ocean — Tipo 4", vagas: "-", descricao: "Bloco Ocean", imagemUrl: plantaOcean4 },
      { area: "Ocean — Tipo 5", vagas: "-", descricao: "Bloco Ocean", imagemUrl: plantaOcean5 },
      { area: "Ocean — Tipo 6", vagas: "-", descricao: "Bloco Ocean", imagemUrl: plantaOcean6 },
      { area: "Sea — Tipo 1", vagas: "-", descricao: "Bloco Sea", imagemUrl: plantaSea1 },
      { area: "Sea — Tipo 2", vagas: "-", descricao: "Bloco Sea", imagemUrl: plantaSea2 },
      { area: "Sea — Tipo 3", vagas: "-", descricao: "Bloco Sea", imagemUrl: plantaSea3 },
      { area: "Sea — Tipo 4", vagas: "-", descricao: "Bloco Sea", imagemUrl: plantaSea4 },
      { area: "Sea — Tipo 5", vagas: "-", descricao: "Bloco Sea", imagemUrl: plantaSea5 },
      { area: "Sea — Tipo 6", vagas: "-", descricao: "Bloco Sea", imagemUrl: plantaSea6 },
      { area: "Implantação — Subsolo", vagas: "-", descricao: "Planta humanizada", imagemUrl: plantaSubsolo },
      { area: "Implantação — Térreo", vagas: "-", descricao: "Planta humanizada", imagemUrl: plantaTerreo },
      { area: "Implantação — Rooftop", vagas: "-", descricao: "Planta humanizada", imagemUrl: plantaRooftop },
    ],
    galeria,
    videos,
    tourVirtualUrl: "https://biganto.com/tour/48601/",
    highlights: [
      "Frente mar com vista definitiva",
      "3 blocos — Ocean, Sea e River",
      "Lazer no térreo e no rooftop",
      "Beach Club e Espaço Beira-Mar",
      "Conceito de caminhabilidade",
    ],
    amenities: [
      "Recepção",
      "Restaurante",
      "Beach Club",
      "Espaço Beira-Mar",
      "Piscina",
      "Deck de Hidromassagem",
      "Spa",
      "Sauna Úmida",
      "Espaço Beleza",
      "Academia",
      "Coworking",
      "Self Market",
      "Lavanderia",
      "Brinquedoteca",
      "Playground",
      "Pet Place & Pet Wash",
      "Pomar",
      "Praça de Convivência",
      "Convivência Gourmet",
      "Bar",
      "Bicicletário",
      "Estacionamento Rotativo",
      "Área de Depósito de Bagagens",
      "Gerador",
      "Estação de Tratamento de Esgoto",
    ],
    pontosDeInteresse: [
      { name: "Praia de Ponta do Mangue", tempo: "0 min", lat: -8.9412, lng: -35.1665, categoria: "praia" },
      { name: "Barra Grande", tempo: "5 min", lat: -8.9210, lng: -35.1770, categoria: "praia" },
      { name: "Caminho de Moisés", tempo: "~7 km", lat: -8.9860, lng: -35.1490, categoria: "lazer" },
      { name: "Aeroporto de Maragogi", tempo: "~13 km", lat: -9.0090, lng: -35.2230, categoria: "via" },
      { name: "Crôas de São Bento", tempo: "~18 km", lat: -9.0630, lng: -35.2110, categoria: "praia" },
      { name: "Japaratinga", tempo: "~37 km", lat: -9.0898, lng: -35.2571, categoria: "praia" },
    ],
    status: "Lançamento",
    thumbnailUrl: "/gallery/30-fotomontagem-01.jpg",
    markerImageUrl: simboloQuinta,
    arquitetura: "Ricardo Nogueira",
    interiores: "Mary Rached",
  },
];

// Centro do mapa: terreno do Quinta das Mangueiras em Ponta do Mangue, Maragogi/AL.
export const MARAGOGI_CENTER = {
  lat: -8.939762,
  lng: -35.169635,
};
