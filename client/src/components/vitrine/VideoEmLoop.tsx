import { useEffect, useRef } from "react";

/** Quanto antes do fim o vídeo volta ao começo, em segundos. */
const ANTECIPACAO = 0.25;

/**
 * Vídeo de fundo em loop sem parar no último quadro.
 *
 * O `loop` nativo só volta ao início DEPOIS que o vídeo termina: ele para no
 * último quadro e então busca o começo. Aqui o retorno acontece um pouco antes
 * do fim, com o vídeo ainda tocando.
 *
 * O `src` nunca é trocado depois de montado: trocar reinicia o elemento e
 * mostra a capa por um instante — uma piscada a cada vez. Foi o que aconteceu
 * quando se tentou tocar de uma cópia local baixada em segundo plano (que ainda
 * dobrava o download); a tentativa foi desfeita.
 *
 * O `loop` nativo fica ligado como rede de segurança (aba em segundo plano
 * atrasa o quadro de verificação).
 */
export default function VideoEmLoop({ src, poster, className }: {
  src: string;
  poster?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let quadro = 0;
    const verificar = () => {
      const d = v.duration;
      if (Number.isFinite(d) && d > ANTECIPACAO * 4 && !v.seeking && v.currentTime >= d - ANTECIPACAO) {
        v.currentTime = 0;
      }
      quadro = requestAnimationFrame(verificar);
    };
    quadro = requestAnimationFrame(verificar);
    return () => cancelAnimationFrame(quadro);
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      className={className}
    />
  );
}
