import { useEffect, useRef, useState } from "react";

/**
 * Visualizador de foto 360 equirretangular.
 *
 * WebGL cru, sem biblioteca. Um visualizador de panorama é essencialmente uma
 * conta de trigonometria por pixel, e as bibliotecas do gênero (three.js,
 * photo-sphere-viewer) chegam com uma engine 3D inteira a reboque — centenas de
 * kB para uma vitrine que já carrega o Cesium. Aqui não há nem geometria: um
 * triângulo cobrindo a tela e um shader que, para cada pixel, calcula a direção
 * do raio e vai buscar na imagem o ponto correspondente.
 *
 * Sem esfera, sem malha, sem matriz de projeção — e o resultado é mais nítido
 * que o da esfera texturizada, porque não há interpolação de vértice no meio do
 * caminho.
 */

/** Campo de visão vertical, em graus: o mínimo é o zoom máximo. */
const FOV_MIN = 25;
const FOV_MAX = 100;
const FOV_INICIAL = 75;

/**
 * Limite de inclinação, um pouco antes dos polos.
 *
 * Exatamente a 90° a direção do raio fica paralela ao eixo e o azimute perde
 * significado — a imagem gira em torno de si mesma e o arraste horizontal para
 * de responder. Parar a 88° evita o ponto degenerado sem que se perceba.
 */
const PITCH_MAX = (88 * Math.PI) / 180;

const VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;
const float PI = 3.14159265359;

void main() {
  // Coordenada normalizada pela ALTURA: assim o campo de visão vertical é o
  // mesmo em qualquer proporção de tela, e girar o tablet não muda o zoom.
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float f = 0.5 / tan(uFov * 0.5);
  vec3 dir = normalize(vec3(p.x, p.y, -f));

  // Inclinação primeiro, giro depois: a ordem inversa faria o horizonte
  // tombar, que é o defeito clássico de panorama com ordem de rotação trocada.
  float cp = cos(uPitch), sp = sin(uPitch);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  float cy = cos(uYaw), sy = sin(uYaw);
  dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);

  // Direção -> coordenada da equirretangular. O centro da imagem é o -Z.
  float u = atan(dir.x, -dir.z) / (2.0 * PI) + 0.5;
  float t = 1.0 - acos(clamp(dir.y, -1.0, 1.0)) / PI;
  gl_FragColor = texture2D(uTex, vec2(u, t));
}
`;

function compilar(gl: WebGLRenderingContext, tipo: number, src: string): WebGLShader | null {
  const sh = gl.createShader(tipo);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[Panorama360]", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

const ehPotencia2 = (n: number) => (n & (n - 1)) === 0;

/**
 * Prepara a imagem para virar textura.
 *
 * Panorama de qualidade sai da câmera com 8192 px de largura, e muito tablet
 * tem `MAX_TEXTURE_SIZE` de 4096: acima disso o `texImage2D` falha e a tela
 * fica preta, sem erro visível. Reduzir na hora custa um passe de canvas e
 * transforma "não funciona neste aparelho" em "funciona com um pouco menos de
 * resolução".
 */
function prepararTextura(img: HTMLImageElement, maxTam: number): TexImageSource {
  if (img.width <= maxTam && img.height <= maxTam) return img;
  const escala = maxTam / Math.max(img.width, img.height);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.floor(img.width * escala));
  cv.height = Math.max(1, Math.floor(img.height * escala));
  cv.getContext("2d")?.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

export default function Panorama360({ url, titulo }: { url: string; titulo?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  /** Some no primeiro gesto: quem já entendeu não precisa da instrução. */
  const [dica, setDica] = useState(true);

  // A câmera vive em refs, não em estado: ela muda a cada quadro do arraste, e
  // um `setState` por movimento do dedo re-renderizaria a árvore inteira a
  // 60 Hz para desenhar um canvas que o React nem toca.
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const fovRef = useRef((FOV_INICIAL * Math.PI) / 180);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = (canvas.getContext("webgl", { alpha: false })
      ?? canvas.getContext("experimental-webgl", { alpha: false })) as WebGLRenderingContext | null;
    if (!gl) {
      setErro("Este navegador não tem WebGL para exibir a foto 360.");
      setCarregando(false);
      return;
    }

    const vs = compilar(gl, gl.VERTEX_SHADER, VS);
    const fs = compilar(gl, gl.FRAGMENT_SHADER, FS);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      setErro("Não foi possível iniciar o visualizador 360.");
      setCarregando(false);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Um triângulo que cobre a tela inteira — mais barato que dois de um quad,
    // e sem a costura na diagonal onde eles se encontram.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTex = gl.getUniformLocation(prog, "uTex");
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uYaw = gl.getUniformLocation(prog, "uYaw");
    const uPitch = gl.getUniformLocation(prog, "uPitch");
    const uFov = gl.getUniformLocation(prog, "uFov");

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Placeholder de 1px: sem isto o primeiro quadro amostra uma textura
    // incompleta e o WebGL emite aviso a cada frame até a imagem chegar.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
      new Uint8Array([20, 20, 20]));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    let vivo = true;
    let raf = 0;

    const desenhar = () => {
      if (!vivo) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const l = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const a = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== l || canvas.height !== a) {
        canvas.width = l;
        canvas.height = a;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uYaw, yawRef.current);
      gl.uniform1f(uPitch, pitchRef.current);
      gl.uniform1f(uFov, fovRef.current);
      gl.uniform1i(uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    /**
     * Desenha SOB DEMANDA, como a cena do Cesium.
     *
     * Um panorama parado é uma imagem parada: manter um `requestAnimationFrame`
     * girando manteria a GPU acordada e o tablet esquentando para redesenhar
     * exatamente os mesmos pixels.
     */
    const pedirQuadro = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; desenhar(); });
    };

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!vivo) return;
      const maxTam = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const fonte = prepararTextura(img, maxTam);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, fonte);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      /**
       * Repetição horizontal fecha a costura da volta completa.
       *
       * No ponto em que o panorama dá a volta, `u` salta de 1 para 0 dentro de
       * um pixel; com `CLAMP_TO_EDGE` a filtragem mistura as duas bordas e
       * aparece um risco vertical na emenda. O WebGL 1 só aceita `REPEAT` em
       * textura com lados potência de dois — o que a maioria dos panoramas é
       * (4096×2048, 8192×4096). Fora disso, o risco é o preço.
       */
      const l = (fonte as HTMLCanvasElement).width ?? img.width;
      const a = (fonte as HTMLCanvasElement).height ?? img.height;
      const pot = ehPotencia2(l) && ehPotencia2(a);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      setCarregando(false);
      pedirQuadro();
    };
    img.onerror = () => {
      if (!vivo) return;
      setErro("A foto 360 não carregou.");
      setCarregando(false);
    };
    img.src = url;

    // --- Gestos ---------------------------------------------------------------
    const arrastando = new Map<number, { x: number; y: number }>();
    /** Distância entre dois dedos no início da pinça. */
    let pincaBase = 0;
    let fovBase = fovRef.current;

    const aoDescer = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      arrastando.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (arrastando.size === 2) {
        const [a, b] = Array.from(arrastando.values());
        pincaBase = Math.hypot(a.x - b.x, a.y - b.y);
        fovBase = fovRef.current;
      }
      setDica(false);
    };

    const aoMover = (e: PointerEvent) => {
      const ant = arrastando.get(e.pointerId);
      if (!ant) return;
      arrastando.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (arrastando.size >= 2) {
        const [a, b] = Array.from(arrastando.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pincaBase > 0 && d > 0) {
          fovRef.current = Math.min(
            (FOV_MAX * Math.PI) / 180,
            Math.max((FOV_MIN * Math.PI) / 180, fovBase * (pincaBase / d)),
          );
        }
        pedirQuadro();
        return;
      }

      /**
       * A velocidade do arraste acompanha o ZOOM.
       *
       * Um deslocamento em pixels sempre valeu o mesmo em graus: ampliado ao
       * máximo, um gesto curto atravessava o ambiente inteiro e era impossível
       * mirar num detalhe. Dividindo pela altura da tela e multiplicando pelo
       * campo de visão atual, o pixel sob o dedo permanece sob o dedo.
       */
      const escala = fovRef.current / Math.max(1, canvas.clientHeight);
      yawRef.current -= (e.clientX - ant.x) * escala;
      pitchRef.current = Math.max(
        -PITCH_MAX,
        Math.min(PITCH_MAX, pitchRef.current + (e.clientY - ant.y) * escala),
      );
      pedirQuadro();
    };

    const aoSubir = (e: PointerEvent) => {
      arrastando.delete(e.pointerId);
      if (arrastando.size < 2) pincaBase = 0;
    };

    const aoRolar = (e: WheelEvent) => {
      e.preventDefault();
      fovRef.current = Math.min(
        (FOV_MAX * Math.PI) / 180,
        Math.max((FOV_MIN * Math.PI) / 180, fovRef.current * (e.deltaY > 0 ? 1.1 : 1 / 1.1)),
      );
      setDica(false);
      pedirQuadro();
    };

    canvas.addEventListener("pointerdown", aoDescer);
    canvas.addEventListener("pointermove", aoMover);
    canvas.addEventListener("pointerup", aoSubir);
    canvas.addEventListener("pointercancel", aoSubir);
    canvas.addEventListener("wheel", aoRolar, { passive: false });
    window.addEventListener("resize", pedirQuadro);

    return () => {
      vivo = false;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", aoDescer);
      canvas.removeEventListener("pointermove", aoMover);
      canvas.removeEventListener("pointerup", aoSubir);
      canvas.removeEventListener("pointercancel", aoSubir);
      canvas.removeEventListener("wheel", aoRolar);
      window.removeEventListener("resize", pedirQuadro);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      /**
       * Devolve o contexto WebGL.
       *
       * O navegador mantém um punhado deles vivos (8 a 16) e derruba o mais
       * antigo ao estourar. Nesta página o mais antigo é o da CENA — abrir e
       * fechar meia dúzia de panoramas apagaria a vitrine por trás.
       */
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [url]);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        aria-label={titulo ? `Foto 360: ${titulo}` : "Foto 360"}
      />
      {carregando && !erro && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="v-meta animate-pulse">Carregando a foto 360...</span>
        </div>
      )}
      {erro && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <span className="v-meta">{erro}</span>
        </div>
      )}
      {dica && !carregando && !erro && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <span className="text-[11px] text-white/55 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
            Arraste para olhar em volta
          </span>
        </div>
      )}
    </div>
  );
}
