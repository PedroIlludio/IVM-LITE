import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

app.use(
  express.json({
    // O padrão do Express é 100 KB — pequeno demais para um projeto do editor,
    // que carrega o empreendimento inteiro, o espelho de vendas e as miniaturas
    // das vistas em base64. Sem isto o save falha com "request entity too large".
    limit: "50mb",
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Projetos podem carregar dezenas de MB de JSON/base64. Serializar a
        // resposta inteira de novo só para o log bloqueia o event loop e ainda
        // despeja conteúdo do projeto no console. Uma amostra basta para
        // diagnóstico sem duplicar o payload na memória.
        const body = capturedJsonResponse as Record<string, unknown>;
        const resumo = typeof body.message === "string"
          ? { message: body.message }
          : typeof body.error === "string"
            ? { error: body.error }
            : Array.isArray(body)
              ? { arrayLength: body.length }
              : { keys: Object.keys(body).slice(0, 20) };
        logLine += ` :: ${JSON.stringify(resumo)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  /**
   * Rota de API inexistente é 404 JSON, não a página do app.
   *
   * Depois daqui vem o catch-all (Vite em dev, index.html em produção), que
   * responde HTML com status 200 para QUALQUER caminho. Um erro de digitação
   * numa URL de API voltava como `<!DOCTYPE html>`, o `res.json()` do cliente
   * estourava "Unexpected token '<'" e o erro real — a rota não existe —
   * ficava invisível.
   */
  app.use("/api/{*path}", (req, res) => {
    res.status(404).json({ message: `Rota inexistente: ${req.method} ${req.originalUrl}` });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      // SO_REUSEPORT não é suportado no Windows (gera ENOTSUP). Mantém no
      // Linux/Render (comportamento de produção) e desativa só no Windows
      // para permitir desenvolvimento local.
      reusePort: process.platform !== "win32",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
