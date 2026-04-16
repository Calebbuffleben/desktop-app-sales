import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = 3001;
const stateFile = path.join(process.cwd(), "tmp", "mock-feedback.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return { recent: [] };
  }
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const corsHeaders = {
    "Access-Control-Allow-Origin":
      typeof origin === "string" && origin.length > 0 ? origin : "http://localhost:3211",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    Vary: "Origin",
  };

  if (req.url?.startsWith("/feedback/metrics/")) {
    const payload = readState();
    res.writeHead(200, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock feedback server listening on http://127.0.0.1:${port}`);
});
