#!/usr/bin/env node
/**
 * Testa o pipeline de feedback local do desktop-app (sem backend).
 *
 * Uso:
 *   node scripts/test-feedback.mjs
 *   node scripts/test-feedback.mjs --preset spin-implicacao
 *
 * O script:
 * 1. Garante que o injector SSE está rodando (:39201)
 * 2. Aguarda o overlay conectar (pnpm dev + Electron aberto)
 * 3. Dispara feedback e confirma entrega via SSE
 */

import { spawn, execSync } from "node:child_process";
import { createInterface } from "node:readline";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.FEEDBACK_INJECT_PORT || 39201);
const BASE = `http://127.0.0.1:${PORT}`;
const OVERLAY_URL = process.env.OVERLAY_URL || "http://localhost:3210/overlay";

const PRESETS = {
  default: {
    message: "Teste de feedback — o copiloto entendeu o momento da conversa.",
    metadata: {
      tips: ["Valide se o cartão apareceu no overlay."],
    },
  },
  "spin-situacao": {
    message: "Cliente descreveu o contexto atual da operação com detalhes concretos.",
    metadata: {
      spinPhase: "situacao",
      severity: "low",
      confidence: 0.71,
      pattern: "context mapping",
      coachSource: "AI Sales Coach",
      coachStatus: "Live analysis",
      tips: ["Aprofunde com uma pergunta sobre como isso funciona no dia a dia."],
    },
  },
  "spin-problema": {
    message: "Processo atual consome tempo demais da equipe.",
    metadata: {
      spinPhase: "problema",
      severity: "med",
      confidence: 0.78,
      pattern: "pain discovery",
      coachSource: "Conversation Analyst",
      coachStatus: "Strategic engine",
      tips: ["Quantifique o impacto antes de sugerir solução."],
    },
  },
  "spin-implicacao": {
    message: "O cliente está comparando sua solução com uma experiência anterior.",
    metadata: {
      spinPhase: "implicacao",
      severity: "critical",
      confidence: 0.86,
      pattern: "previous solution comparison",
      coachSource: "Deal Intelligence",
      coachStatus: "Live analysis",
      tips: [
        "O cliente está comparando sua solução com uma experiência anterior. Descubra exatamente o que fez a tentativa anterior falhar antes de defender sua proposta.",
      ],
    },
  },
  "spin-necessidade": {
    message: "Prospect verbalizou o que precisa mudar — não está mais explorando.",
    metadata: {
      spinPhase: "necessidade",
      severity: "med",
      confidence: 0.8,
      pattern: "need articulation",
      coachSource: "Strategic Insight",
      coachStatus: "AI active",
      tips: ["Confirme o critério de sucesso nos próximos 90 dias."],
    },
  },
  "spin-payoff": {
    message: "Cliente visualizou o resultado positivo de resolver agora.",
    metadata: {
      spinPhase: "pay_off",
      severity: "low",
      confidence: 0.74,
      pattern: "value resonance",
      coachSource: "AI Sales Coach",
      coachStatus: "Live analysis",
      tips: ["Conecte o benefício ao objetivo que ele já mencionou."],
    },
  },
  "intent-shift": {
    message: "Cliente já avalia implementação internamente.",
    metadata: {
      insightType: "Mudança de intenção",
      severity: "high",
      confidence: 0.83,
      pattern: "buying intent shift",
      coachSource: "Deal Intelligence",
      coachStatus: "Strategic engine",
      tips: ["Valide quem lidera a avaliação interna."],
    },
  },
  "opportunity-window": {
    message: "Cliente pediu comparativo com critérios de decisão.",
    metadata: {
      insightType: "Janela de oportunidade",
      severity: "high",
      confidence: 0.88,
      pattern: "closing window",
      coachSource: "AI Sales Coach",
      coachStatus: "Live analysis",
      tips: ["Confirme o timeline antes de enviar proposta."],
    },
  },
};

function log(step, message) {
  console.log(`[test-feedback] ${step} ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  let preset = "default";
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--preset" && argv[i + 1]) {
      preset = argv[++i];
    }
    if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        `Uso: node scripts/test-feedback.mjs [--preset ${Object.keys(PRESETS).join(" | ")}]`,
      );
      process.exit(0);
    }
  }
  if (!PRESETS[preset]) {
    throw new Error(`Preset inválido: ${preset}. Opções: ${Object.keys(PRESETS).join(", ")}`);
  }
  return { preset };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data, text };
}

async function isInjectorHealthy() {
  try {
    const result = await fetchJson(`${BASE}/health`);
    return result.ok && result.data?.ok === true;
  } catch {
    return false;
  }
}

async function killPortIfNeeded() {
  try {
    const pid = execSync(`lsof -ti :${PORT}`, { encoding: "utf8" }).trim();
    if (!pid) return;
    log("cleanup", `liberando porta ${PORT} (pid ${pid.split("\n")[0]})`);
    execSync(`kill ${pid.split("\n")[0]}`);
    await sleep(400);
  } catch {
    /* porta livre */
  }
}

let injectorChild = null;

function startInjectorServer() {
  return new Promise((resolve, reject) => {
    injectorChild = spawn(process.execPath, ["scripts/feedback-injector-server.mjs"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FEEDBACK_INJECT_PORT: String(PORT) },
    });

    const timeout = setTimeout(() => {
      reject(new Error("timeout aguardando injector subir"));
    }, 8000);

    const onData = (chunk) => {
      const line = chunk.toString();
      if (line.includes("listening on")) {
        clearTimeout(timeout);
        resolve();
      }
    };

    injectorChild.stdout?.on("data", onData);
    injectorChild.stderr?.on("data", onData);
    injectorChild.on("error", reject);
    injectorChild.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`injector exit code ${code}`));
      }
    });
  });
}

async function ensureInjector() {
  if (await isInjectorHealthy()) {
    log("injector", `ok em ${BASE} (já rodando)`);
    return;
  }
  await killPortIfNeeded();
  log("injector", "subindo servidor SSE…");
  await startInjectorServer();
  for (let i = 0; i < 20; i += 1) {
    if (await isInjectorHealthy()) {
      log("injector", `ok em ${BASE}`);
      return;
    }
    await sleep(200);
  }
  throw new Error("injector não respondeu em /health");
}

async function waitForOverlaySubscriber(maxMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const health = await fetchJson(`${BASE}/health`);
    const subscribers = Number(health.data?.subscribers ?? 0);
    if (subscribers >= 1) {
      log("overlay", `conectado via SSE (${subscribers} subscriber(s))`);
      return subscribers;
    }
    await sleep(500);
  }
  return 0;
}

function listenForSseMessage(token, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}/stream`, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE HTTP ${res.statusCode}`));
        return;
      }

      const rl = createInterface({ input: res });
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("timeout aguardando evento SSE"));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        rl.close();
        req.destroy();
      };

      rl.on("line", (line) => {
        if (!line.startsWith("data: ")) return;
        try {
          const payload = JSON.parse(line.slice(6));
          if (String(payload.message || "").includes(token)) {
            cleanup();
            resolve(payload);
          }
        } catch {
          /* ignore */
        }
      });

      rl.on("close", () => {
        /* stream closed after cleanup */
      });
    });

    req.on("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ECONNRESET") {
        return;
      }
      reject(error);
    });
  });
}

async function checkOverlayPage() {
  try {
    const response = await fetch(OVERLAY_URL);
    if (response.ok) {
      log("overlay", `página acessível em ${OVERLAY_URL}`);
      return true;
    }
    log("overlay", `HTTP ${response.status} em ${OVERLAY_URL}`);
    return false;
  } catch (error) {
    log("overlay", `indisponível (${error instanceof Error ? error.message : error})`);
    return false;
  }
}

async function injectFeedback(payload) {
  const result = await fetchJson(`${BASE}/inject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    throw new Error(`inject falhou HTTP ${result.status}: ${result.text}`);
  }
  return result.data;
}

async function run() {
  const { preset } = parseArgs(process.argv);
  const token = `test-${Date.now()}`;
  const presetData = PRESETS[preset];

  log("start", `preset=${preset} port=${PORT}`);

  await ensureInjector();
  await checkOverlayPage();

  log("wait", "aguardando overlay conectar ao SSE (rode pnpm dev)…");
  const subscribers = await waitForOverlaySubscriber(25000);
  if (subscribers === 0) {
    log(
      "warn",
      "overlay não conectou ao SSE — dispare mesmo assim (cartão não aparecerá sem Electron)",
    );
  }

  const sseWait = listenForSseMessage(token, 6000);
  const payload = {
    message: `${token} — ${presetData.message}`,
    metadata: presetData.metadata,
    severity: "info",
    type: "llm_insight",
  };

  log("inject", "disparando feedback…");
  const injectResult = await injectFeedback(payload);
  log("inject", `ok id=${injectResult.id} subscribers=${injectResult.subscribers}`);

  const received = await sseWait;
  log("sse", `evento recebido id=${received.id}`);

  if (Number(injectResult.subscribers) >= 1) {
    log("pass", "feedback entregue ao overlay — verifique o cartão na tela");
  } else {
    log(
      "pass",
      "pipeline SSE ok, mas overlay offline — abra pnpm dev e rode de novo para ver o cartão",
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: injectResult.id,
        preset,
        subscribers: injectResult.subscribers,
        overlayConnected: subscribers >= 1,
      },
      null,
      2,
    ),
  );
}

run()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[test-feedback] FALHOU: ${message}`);
    console.error("[test-feedback] dica: rode pnpm dev em outro terminal e tente novamente");
    process.exitCode = 1;
  })
  .finally(() => {
    if (injectorChild && !process.env.TEST_FEEDBACK_KEEP_INJECTOR) {
      injectorChild.kill("SIGTERM");
    }
  });
