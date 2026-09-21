import { useLocation } from "wouter";
import logoQuinta from "@/assets/logo-quinta-branco.png";

// Imagem-herói (vista aérea do resort à beira-mar), servida de public/gallery.
const HERO = "/gallery/30-fotomontagem-01.jpg";

export default function LandingPage() {
  const [, navigate] = useLocation();

  return (
    <div className="relative w-full h-screen overflow-hidden flex flex-col">
      {/* Fundo: foto aérea com leve zoom + overlays de leitura na paleta da marca */}
      <div className="absolute inset-0">
        <img
          src={HERO}
          alt=""
          className="w-full h-full object-cover animate-[hero-zoom_24s_ease-in-out_infinite_alternate]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#04141d]/70 via-[#04141d]/45 to-[#04141d]/92" />
        <div className="absolute inset-0 bg-[#061a24]/25" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-8 px-6 max-w-xl mx-auto text-center">
        <img
          src={logoQuinta}
          alt="Quinta das Mangueiras"
          className="h-40 w-auto drop-shadow-[0_8px_30px_rgba(0,0,0,0.5)] animate-[pulse-logo_4s_ease-in-out_infinite]"
          data-testid="img-landing-logo"
        />

        <div className="flex flex-col items-center gap-3">
          <p className="text-teal-200/90 text-[11px] font-medium uppercase tracking-[0.35em]">
            Ponta do Mangue · Maragogi — AL
          </p>
          <h1 className="font-serif text-2xl md:text-3xl text-white leading-snug">
            O Caribe Brasileiro para viver, sentir e investir
          </h1>
          <p className="text-white/70 text-sm font-light tracking-wide max-w-md">
            Explore o tour interativo 3D do seu refúgio frente-mar.
          </p>
        </div>

        <button
          data-testid="btn-enter-map"
          onClick={() => navigate("/explorar")}
          className="group relative px-10 py-3.5 rounded-full bg-gradient-to-r from-teal-500 to-teal-400 shadow-[0_10px_40px_-10px_rgba(18,161,154,0.7)] transition-all duration-300 hover:shadow-[0_14px_50px_-8px_rgba(18,161,154,0.9)] hover:-translate-y-0.5"
        >
          <span className="relative text-sm font-semibold tracking-[0.2em] text-[#04141d] uppercase">
            Explorar Projeto
          </span>
        </button>
      </div>

      <footer className="relative z-10 w-full border-t border-white/10 px-6 py-4" data-testid="footer-landing">
        <div className="max-w-2xl mx-auto text-center space-y-2">
          <p className="text-[10px] text-white/40 leading-relaxed">
            Pode conter produtos em fase de registro. É proibida a comercialização de unidades sem a prévia aprovação do registro de incorporação. Imagens ilustrativas, com sugestão de layout, móveis, decoração e acabamento a serem entregues conforme memorial descritivo e contrato de venda.
          </p>
          <div className="flex items-center justify-center gap-1">
            <span className="text-[10px] text-white/40">Uma realização</span>
            <span className="text-[10px] text-white/60 font-medium">Farias Incorporadora + HSM</span>
          </div>
          <div className="flex items-center justify-center gap-1 pt-1">
            <span className="text-[10px] text-white/30">Desenvolvido por</span>
            <span className="text-[10px] text-teal-300/70 font-semibold tracking-wide">Vizen LABS</span>
            <span className="text-[10px] text-white/20 mx-0.5">|</span>
            <span className="text-[10px] text-white/30">Uma empresa</span>
            <span className="text-[10px] text-white/40 font-medium">Illúdio Soluções Visuais</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
