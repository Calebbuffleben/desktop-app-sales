"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionGate } from "@/shared/session-gate";
import { useAuth } from "@/shared/auth-context";
import { PLAYBOOK_MAX_STEPS } from "@/shared/playbook-metadata";
import type {
  CreatePlaybookTemplatePayload,
  PlaybookActionTypeValue,
  PlaybookStepPayload,
  PlaybookTemplateSummary,
} from "@/types/desktop-api";

type StepRow = {
  localKey: string;
  id: string;
  label: string;
  detail: string;
  actionType: PlaybookActionTypeValue;
  payload: string;
};

function newLocalKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyStep(): StepRow {
  return {
    localKey: newLocalKey(),
    id: "",
    label: "",
    detail: "",
    actionType: "noop",
    payload: "",
  };
}

function parseStepsFromApi(raw: unknown): StepRow[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [emptyStep()];
  }
  const rows: StepRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const label = typeof o.label === "string" ? o.label : "";
    const detail = typeof o.detail === "string" ? o.detail : "";
    const ar = o.action;
    let actionType: PlaybookActionTypeValue = "noop";
    let payload = "";
    if (ar && typeof ar === "object" && !Array.isArray(ar)) {
      const t = (ar as { type?: unknown }).type;
      if (t === "copy_text" || t === "open_url" || t === "noop") {
        actionType = t;
      }
      const p = (ar as { payload?: unknown }).payload;
      if (typeof p === "string") payload = p;
    }
    rows.push({
      localKey: newLocalKey(),
      id,
      label,
      detail,
      actionType,
      payload,
    });
  }
  return rows.length > 0 ? rows : [emptyStep()];
}

function rowsToPayload(rows: StepRow[]): PlaybookStepPayload[] {
  return rows.map((r) => {
    const base: PlaybookStepPayload = {
      id: r.id.trim(),
      label: r.label.trim(),
      ...(r.detail.trim() ? { detail: r.detail.trim() } : {}),
      action:
        r.actionType === "noop"
          ? { type: "noop" }
          : { type: r.actionType, payload: r.payload.trim() },
    };
    return base;
  });
}

const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

export default function PlaybooksPage() {
  return (
    <SessionGate>
      <PlaybooksScreen />
    </SessionGate>
  );
}

function PlaybooksScreen() {
  const { session } = useAuth();
  const isAdmin = session.membership?.role === "OWNER" || session.membership?.role === "ADMIN";

  const [list, setList] = useState<PlaybookTemplateSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stepRows, setStepRows] = useState<StepRow[]>([emptyStep()]);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const api = window.desktopApi;
    if (!api?.playbooksList || !isAdmin) return;
    setError(null);
    try {
      const rows = await api.playbooksList();
      setList(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) void refresh();
    else setLoading(false);
  }, [isAdmin, refresh]);

  const openCreate = () => {
    setEditId(null);
    setTemplateKey("");
    setTitle("");
    setDescription("");
    setStepRows([emptyStep()]);
    setPanelOpen(true);
    setBanner(null);
    setError(null);
  };

  const openEdit = (row: PlaybookTemplateSummary) => {
    setEditId(row.id);
    setTemplateKey(row.key);
    setTitle(row.title);
    setDescription(row.description ?? "");
    setStepRows(parseStepsFromApi(row.steps));
    setPanelOpen(true);
    setBanner(null);
    setError(null);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setEditId(null);
  };

  const validateForm = (): string | null => {
    if (!editId) {
      const k = templateKey.trim();
      if (!k) return "Indique a chave do playbook (slug).";
      if (k.length > 64) return "Chave demasiado longa (máx. 64).";
      if (!KEY_PATTERN.test(k)) return "Chave inválida: use apenas letras, números, _ e -.";
    }
    if (!title.trim()) return "Indique o título.";
    const steps = stepRows.filter((r) => r.id.trim() && r.label.trim());
    if (steps.length === 0) return "Adicione pelo menos um passo com id e rótulo preenchidos.";
    if (steps.length > PLAYBOOK_MAX_STEPS) return `No máximo ${PLAYBOOK_MAX_STEPS} passos.`;
    for (const s of steps) {
      if (s.actionType === "copy_text" || s.actionType === "open_url") {
        if (!s.payload.trim()) return `Passo "${s.label || s.id}": preencha o texto ou URL da ação.`;
        if (s.actionType === "open_url" && !s.payload.trim().toLowerCase().startsWith("https://")) {
          return `Passo "${s.label || s.id}": URLs devem começar por https://`;
        }
      }
    }
    return null;
  };

  const handleSave = async () => {
    const api = window.desktopApi;
    if (!api) return;
    const msg = validateForm();
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    setError(null);
    const stepsPayload = rowsToPayload(
      stepRows.filter((r) => r.id.trim() && r.label.trim()),
    );
    try {
      if (editId) {
        await api.playbooksUpdate({
          id: editId,
          title: title.trim(),
          description: description.trim() || undefined,
          steps: stepsPayload,
        });
        setBanner("Playbook atualizado.");
      } else {
        const body: CreatePlaybookTemplatePayload = {
          key: templateKey.trim(),
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          steps: stepsPayload,
        };
        await api.playbooksCreate(body);
        setBanner("Playbook criado.");
      }
      closePanel();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: PlaybookTemplateSummary) => {
    const api = window.desktopApi;
    if (!api) return;
    if (!window.confirm(`Eliminar o playbook "${row.key}"? Esta ação não pode ser anulada.`)) {
      return;
    }
    setError(null);
    try {
      await api.playbooksRemove({ id: row.id });
      setBanner(`Playbook "${row.key}" eliminado.`);
      if (editId === row.id) closePanel();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stepCountLabel = useMemo(() => {
    const n = stepRows.filter((r) => r.id.trim() && r.label.trim()).length;
    return `${n} / ${PLAYBOOK_MAX_STEPS}`;
  }, [stepRows]);

  if (!isAdmin) {
    return (
      <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
        <main className="mx-auto flex max-w-2xl flex-col gap-4 px-5 py-12 md:px-8">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-400/95">
            Acesso restrito
          </p>
          <h1 className="text-xl font-semibold text-zinc-50">Playbooks</h1>
          <p className="text-sm text-zinc-400">
            Apenas administradores (OWNER ou ADMIN) do tenant podem criar e editar playbooks. Contacta a
            gestão da tua organização se precisares de alterações.
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex w-fit rounded-md border border-zinc-700/80 bg-zinc-950/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300 hover:border-cyan-500/60 hover:text-cyan-100"
          >
            ← Voltar ao início
          </Link>
        </main>
      </div>
    );
  }

  const btn =
    "rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-cyan-500/35 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45";
  const btnPrimary =
    "rounded-lg border border-cyan-500/45 bg-cyan-600/95 px-3 py-2 text-xs font-medium text-white shadow-[0_0_22px_-8px_rgba(34,211,238,0.5)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-45";
  const btnDanger =
    "rounded-lg border border-rose-500/40 bg-rose-950/80 px-3 py-2 text-xs font-medium text-rose-200 transition hover:border-rose-400/60 hover:bg-rose-900/80";
  const field =
    "mt-1 w-full rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/35";

  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-8 md:px-8">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400/95">
              Administração do tenant
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Playbooks</h1>
            <p className="mt-1 text-xs text-zinc-400">
              {session.tenant?.name} · slug{" "}
              <span className="text-cyan-300">{session.tenant?.slug}</span>
            </p>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-zinc-500">
              Roteiros com botões no overlay (copiar texto, dicas). A chave de cada playbook deve coincidir com o
              que a análise automática envia (ex.: <code className="text-cyan-200/90">objecao_tempo</code>). Ver{" "}
              <code className="text-zinc-400">PLAYBOOKS.md</code> na raiz do projeto.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/members"
              className="rounded-md border border-zinc-700/80 bg-zinc-950/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300 hover:border-cyan-500/60 hover:text-cyan-100"
            >
              Membros
            </Link>
            <Link
              href="/"
              className="rounded-md border border-zinc-700/80 bg-zinc-950/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300 hover:border-cyan-500/60 hover:text-cyan-100"
            >
              ← Início
            </Link>
          </div>
        </header>

        {banner ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-[11px] text-emerald-200">
            {banner}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">
            {loading ? "A carregar…" : `${list?.length ?? 0} playbook(s)`}
          </p>
          <button type="button" className={btnPrimary} onClick={openCreate} disabled={loading}>
            Novo playbook
          </button>
        </div>

        {!loading && list && list.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
            Ainda não há playbooks. Cria o primeiro com &quot;Novo playbook&quot;.
          </p>
        ) : null}

        {!loading && list && list.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-zinc-800/90">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/80 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Chave</th>
                  <th className="px-3 py-2">Título</th>
                  <th className="px-3 py-2">Passos</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => {
                  const n = Array.isArray(row.steps) ? row.steps.length : 0;
                  return (
                    <tr key={row.id} className="border-b border-zinc-800/80 last:border-0 hover:bg-zinc-900/40">
                      <td className="px-3 py-2 font-mono text-xs text-cyan-200/90">{row.key}</td>
                      <td className="px-3 py-2 text-zinc-200">{row.title}</td>
                      <td className="px-3 py-2 text-zinc-500">{n}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" className={`${btn} mr-2`} onClick={() => openEdit(row)}>
                          Editar
                        </button>
                        <button type="button" className={btnDanger} onClick={() => void handleDelete(row)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {panelOpen ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
            <div
              className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl"
              role="dialog"
              aria-labelledby="playbook-form-title"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 id="playbook-form-title" className="text-lg font-semibold text-zinc-50">
                  {editId ? "Editar playbook" : "Novo playbook"}
                </h2>
                <button type="button" className={btn} onClick={closePanel}>
                  Fechar
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500">Chave (slug)</label>
                  <input
                    className={field}
                    value={templateKey}
                    onChange={(e) => setTemplateKey(e.target.value)}
                    disabled={Boolean(editId)}
                    placeholder="ex.: objecao_tempo"
                    autoComplete="off"
                  />
                  {editId ? (
                    <p className="mt-1 text-[10px] text-zinc-600">A chave não pode ser alterada após criação.</p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500">Título</label>
                  <input
                    className={field}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Título curto no overlay"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500">Descrição (opcional)</label>
                  <textarea
                    className={`${field} min-h-[72px] resize-y`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Notas internas (opcional)"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-500">Passos ({stepCountLabel})</span>
                    <button
                      type="button"
                      className={btn}
                      disabled={stepRows.length >= PLAYBOOK_MAX_STEPS}
                      onClick={() =>
                        setStepRows((prev) =>
                          prev.length >= PLAYBOOK_MAX_STEPS ? prev : [...prev, emptyStep()],
                        )
                      }
                    >
                      Adicionar passo
                    </button>
                  </div>
                  <div className="space-y-3">
                    {stepRows.map((row, idx) => (
                      <div
                        key={row.localKey}
                        className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase text-zinc-500">Passo {idx + 1}</span>
                          <button
                            type="button"
                            className="text-[10px] text-rose-400 hover:text-rose-300"
                            disabled={stepRows.length <= 1}
                            onClick={() => setStepRows((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Remover
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="text-[10px] text-zinc-600">Id</label>
                            <input
                              className={field}
                              value={row.id}
                              onChange={(e) => {
                                const v = e.target.value;
                                setStepRows((prev) =>
                                  prev.map((s, i) => (i === idx ? { ...s, id: v } : s)),
                                );
                              }}
                              placeholder="ex.: ouvir"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-600">Rótulo do botão</label>
                            <input
                              className={field}
                              value={row.label}
                              onChange={(e) => {
                                const v = e.target.value;
                                setStepRows((prev) =>
                                  prev.map((s, i) => (i === idx ? { ...s, label: v } : s)),
                                );
                              }}
                            />
                          </div>
                        </div>
                        <div className="mt-2">
                          <label className="text-[10px] text-zinc-600">Detalhe (opcional)</label>
                          <input
                            className={field}
                            value={row.detail}
                            onChange={(e) => {
                              const v = e.target.value;
                              setStepRows((prev) =>
                                prev.map((s, i) => (i === idx ? { ...s, detail: v } : s)),
                              );
                            }}
                          />
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="text-[10px] text-zinc-600">Ação</label>
                            <select
                              className={field}
                              value={row.actionType}
                              onChange={(e) => {
                                const v = e.target.value as PlaybookActionTypeValue;
                                setStepRows((prev) =>
                                  prev.map((s, i) =>
                                    i === idx ? { ...s, actionType: v, payload: v === "noop" ? "" : s.payload } : s,
                                  ),
                                );
                              }}
                            >
                              <option value="noop">Só informação (noop)</option>
                              <option value="copy_text">Copiar texto</option>
                              <option value="open_url">Abrir URL (https)</option>
                            </select>
                          </div>
                          {row.actionType !== "noop" ? (
                            <div>
                              <label className="text-[10px] text-zinc-600">
                                {row.actionType === "copy_text" ? "Texto a copiar" : "URL https"}
                              </label>
                              <textarea
                                className={`${field} min-h-[64px] resize-y font-mono text-xs`}
                                value={row.payload}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setStepRows((prev) =>
                                    prev.map((s, i) => (i === idx ? { ...s, payload: v } : s)),
                                  );
                                }}
                                placeholder={
                                  row.actionType === "copy_text"
                                    ? "Texto… pode usar {{variavel}}"
                                    : "https://…"
                                }
                              />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
                  <button type="button" className={btn} onClick={closePanel} disabled={saving}>
                    Cancelar
                  </button>
                  <button type="button" className={btnPrimary} onClick={() => void handleSave()} disabled={saving}>
                    {saving ? "A guardar…" : editId ? "Guardar alterações" : "Criar playbook"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
