import http from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.FEEDBACK_INJECT_PORT || 39201);
/** @type {Set<import("node:http").ServerResponse>} */
const streamClients = new Set();

function buildPayload(body) {
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata
      : {};

  return {
    id: typeof body.id === "string" ? body.id : `inject-${randomUUID()}`,
    meetingId: typeof body.meetingId === "string" ? body.meetingId : "abc-defg-hij",
    participantId:
      typeof body.participantId === "string" ? body.participantId : "feedback-injector-server",
    type: typeof body.type === "string" ? body.type : "llm_insight",
    severity:
      body.severity === "warning" || body.severity === "critical" ? body.severity : "info",
    ts: new Date().toISOString(),
    message:
      typeof body.message === "string"
        ? body.message
        : "Insight de teste — valide o cartão do overlay.",
    metadata: {
      source: "feedback-injector-server",
      ...metadata,
    },
  };
}

function broadcast(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of streamClients) {
    client.write(frame);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, subscribers: streamClients.size, port }));
    return;
  }

  if (req.method === "GET" && req.url === "/stream") {
    res.writeHead(200, {
      ...cors,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write("\n");
    streamClients.add(res);
    req.on("close", () => {
      streamClients.delete(res);
    });
    return;
  }

  if (req.method === "POST" && req.url === "/inject") {
    try {
      const body = await readJsonBody(req);
      const payload = buildPayload(body);
      broadcast(payload);
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          id: payload.id,
          channel: "sse",
          subscribers: streamClients.size,
        }),
      );
      console.log(
        `[feedback-injector] injected id=${payload.id} subscribers=${streamClients.size}`,
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(400, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: message }));
      return;
    }
  }

  res.writeHead(404, { ...cors, "Content-Type": "text/plain" });
  res.end("not found");
});

server.on("error", (error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
    console.error(
      `[feedback-injector] porta ${port} em uso. Libere com: kill $(lsof -ti :${port})`,
    );
    process.exit(1);
  }
  console.error("[feedback-injector] erro:", error);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[feedback-injector] listening on http://127.0.0.1:${port}`);
  console.log("[feedback-injector] GET /health | GET /stream | POST /inject");
});
