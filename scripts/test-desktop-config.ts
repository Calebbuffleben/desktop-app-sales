import assert from "node:assert/strict";
import { loadDesktopConfig } from "../src/shared/desktop-config";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const next = vars[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(prev)) {
      const value = prev[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function run(): void {
  const appRoot = new URL("..", import.meta.url).pathname;

  withEnv(
    {
      DESKTOP_PROVIDER: undefined,
      BACKEND_WS_BASE: undefined,
      PYTHON_WS_BASE: undefined,
    },
    () => {
      const cfg = loadDesktopConfig({ baseDir: appRoot });
      assert.equal(cfg.provider, "cloud_run");
      assert.equal(
        cfg.BACKEND_WS_BASE,
        "wss://backend-770631129946.southamerica-east1.run.app",
      );
      assert.equal(
        cfg.PYTHON_WS_BASE,
        "wss://python-service-770631129946.southamerica-east1.run.app",
      );
    },
  );

  withEnv({ DESKTOP_PROVIDER: "railway", BACKEND_WS_BASE: undefined, PYTHON_WS_BASE: undefined }, () => {
    const cfg = loadDesktopConfig({ baseDir: appRoot });
    assert.equal(cfg.provider, "railway");
    assert.equal(
      cfg.BACKEND_WS_BASE,
      "wss://backend-analysis-production-a688.up.railway.app",
    );
    assert.equal(
      cfg.PYTHON_WS_BASE,
      "wss://text-analysis-production.up.railway.app",
    );
  });

  withEnv({ DESKTOP_PROVIDER: "local", BACKEND_WS_BASE: undefined, PYTHON_WS_BASE: undefined }, () => {
    const cfg = loadDesktopConfig({ baseDir: appRoot });
    assert.equal(cfg.provider, "local");
    assert.equal(cfg.BACKEND_WS_BASE, "ws://localhost:3001");
    assert.equal(cfg.PYTHON_WS_BASE, "ws://localhost:8000");
  });

  withEnv(
    {
      DESKTOP_PROVIDER: "railway",
      BACKEND_WS_BASE: "wss://override.example",
      PYTHON_WS_BASE: undefined,
    },
    () => {
      const cfg = loadDesktopConfig({ baseDir: appRoot });
      assert.equal(cfg.provider, "railway");
      assert.equal(cfg.BACKEND_WS_BASE, "wss://override.example");
      assert.equal(
        cfg.PYTHON_WS_BASE,
        "wss://text-analysis-production.up.railway.app",
      );
    },
  );

  console.log("desktop-config provider checks passed");
}

run();
