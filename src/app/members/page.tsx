"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SessionGate } from "@/shared/session-gate";
import { useAuth } from "@/shared/auth-context";
import type {
  InvitationSummary,
  MemberSummary,
  MembershipRoleValue,
  PlanValue,
  SubscriptionSnapshot,
} from "@/types/desktop-api";

type TabId = "members" | "invites";

export default function MembersPage() {
  return (
    <SessionGate>
      <MembersScreen />
    </SessionGate>
  );
}

/**
 * Members + invitations + billing console.
 *
 * Authorization is enforced server-side:
 *   - OWNER/ADMIN can invite, revoke, change roles, remove members, upgrade plan.
 *   - MEMBER sees the list but gets 403 on mutations.
 * The UI mirrors these rules so MEMBERs never see destructive buttons.
 */
function MembersScreen() {
  const { session } = useAuth();
  const currentRole = session.membership?.role ?? null;
  const isAdmin = currentRole === "OWNER" || currentRole === "ADMIN";

  const [tab, setTab] = useState<TabId>("members");
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [invites, setInvites] = useState<InvitationSummary[] | null>(null);
  const [subscription, setSubscription] =
    useState<SubscriptionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.desktopApi;
    if (!api) return;
    setError(null);
    try {
      const [m, s, i] = await Promise.all([
        api.membersList(),
        api.billingSubscription(),
        isAdmin ? api.invitesList() : Promise.resolve([]),
      ]);
      setMembers(m);
      setSubscription(s);
      setInvites(i);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const seatsRemaining = subscription?.seatsRemaining ?? 0;
  const atLimit = subscription ? seatsRemaining <= 0 : false;

  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-8 md:px-8">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400/95">
              Administração do tenant
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Membros & convites
            </h1>
            <p className="mt-1 text-xs text-zinc-400">
              {session.tenant?.name} · slug{" "}
              <span className="text-cyan-300">{session.tenant?.slug}</span>
            </p>
          </div>
          <Link
            href="/"
            className="self-start rounded-md border border-zinc-700/80 bg-zinc-950/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300 hover:border-cyan-500/60 hover:text-cyan-100"
          >
            ← Voltar
          </Link>
        </header>

        <SubscriptionCard
          subscription={subscription}
          isAdmin={isAdmin}
          onUpgrade={async (plan) => {
            const api = window.desktopApi;
            if (!api) return;
            setBanner(null);
            setError(null);
            try {
              const updated = await api.billingUpgrade({ plan });
              setSubscription(updated);
              setBanner(`Plano atualizado para ${plan} (${updated.maxUsers} assentos).`);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />

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

        <div className="inline-flex rounded-lg border border-zinc-700/80 bg-zinc-950/80 p-1 text-xs">
          <TabButton active={tab === "members"} onClick={() => setTab("members")}>
            Membros ({members?.length ?? "—"})
          </TabButton>
          {isAdmin ? (
            <TabButton
              active={tab === "invites"}
              onClick={() => setTab("invites")}
            >
              Convites ({invites?.length ?? "—"})
            </TabButton>
          ) : null}
        </div>

        {tab === "members" ? (
          <MembersTable
            loading={loading}
            members={members}
            currentUserId={session.user?.id ?? null}
            isAdmin={isAdmin}
            onChangeRole={async (membershipId, role) => {
              const api = window.desktopApi;
              if (!api) return;
              try {
                await api.membersUpdateRole({ membershipId, role });
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            onRemove={async (membershipId) => {
              const api = window.desktopApi;
              if (!api) return;
              if (!confirm("Remover este membro?")) return;
              try {
                await api.membersRemove({ membershipId });
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        ) : (
          <InvitesPanel
            invites={invites}
            isAdmin={isAdmin}
            atLimit={atLimit}
            onCreate={async (email, role) => {
              const api = window.desktopApi;
              if (!api) return null;
              try {
                const created = await api.invitesCreate({ email, role });
                await refresh();
                return created.token;
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                return null;
              }
            }}
            onRevoke={async (invitationId) => {
              const api = window.desktopApi;
              if (!api) return;
              try {
                await api.invitesRevoke({ invitationId });
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 transition ${
        active
          ? "bg-cyan-500/20 text-cyan-100"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

const PLAN_OPTIONS: Array<{ plan: PlanValue; label: string; seats: number }> = [
  { plan: "FREE", label: "Free", seats: 3 },
  { plan: "PRO", label: "Pro", seats: 10 },
  { plan: "ENTERPRISE", label: "Enterprise", seats: 50 },
];

function SubscriptionCard({
  subscription,
  isAdmin,
  onUpgrade,
}: {
  subscription: SubscriptionSnapshot | null;
  isAdmin: boolean;
  onUpgrade: (plan: PlanValue) => Promise<void>;
}) {
  const [pendingPlan, setPendingPlan] = useState<PlanValue | null>(null);

  const seatLabel = useMemo(() => {
    if (!subscription) return "Carregando…";
    return `${subscription.memberCount} / ${subscription.maxUsers} membros (${subscription.pendingInvites} convites pendentes)`;
  }, [subscription]);

  if (!subscription) {
    return (
      <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/70 p-4 font-mono text-[11px] text-zinc-400">
        Carregando plano…
      </div>
    );
  }

  const atLimit = subscription.seatsRemaining <= 0;

  return (
    <div className="rounded-xl border border-cyan-500/25 bg-gradient-to-br from-zinc-900/90 via-zinc-950/95 to-[#05080f] p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300/90">
            Plano atual
          </p>
          <h2 className="mt-1 text-xl font-semibold text-zinc-100">
            {subscription.plan}{" "}
            <span className="text-xs font-normal text-zinc-500">
              · {subscription.status}
            </span>
          </h2>
          <p className="mt-1 text-xs text-zinc-400">{seatLabel}</p>
          {atLimit ? (
            <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-200">
              Você atingiu o limite do plano. Faça upgrade para convidar mais membros.
            </p>
          ) : null}
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            {PLAN_OPTIONS.filter((opt) => opt.plan !== subscription.plan).map((opt) => (
              <button
                key={opt.plan}
                type="button"
                disabled={pendingPlan !== null}
                onClick={async () => {
                  setPendingPlan(opt.plan);
                  try {
                    await onUpgrade(opt.plan);
                  } finally {
                    setPendingPlan(null);
                  }
                }}
                className="rounded-md border border-cyan-500/40 bg-cyan-600/20 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {pendingPlan === opt.plan ? "Aplicando…" : `Upgrade → ${opt.label} (${opt.seats})`}
              </button>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Apenas admins podem trocar o plano.
          </p>
        )}
      </div>
    </div>
  );
}

function MembersTable({
  loading,
  members,
  currentUserId,
  isAdmin,
  onChangeRole,
  onRemove,
}: {
  loading: boolean;
  members: MemberSummary[] | null;
  currentUserId: string | null;
  isAdmin: boolean;
  onChangeRole: (membershipId: string, role: MembershipRoleValue) => Promise<void>;
  onRemove: (membershipId: string) => Promise<void>;
}) {
  if (loading && !members) {
    return <EmptyState text="Carregando membros…" />;
  }
  if (!members || members.length === 0) {
    return <EmptyState text="Nenhum membro encontrado (isso não deveria acontecer)." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/70">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/80 text-left font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3">E-mail</th>
            <th className="px-4 py-3">Nome</th>
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            return (
              <tr key={m.id} className="border-t border-zinc-800/80">
                <td className="px-4 py-3 text-zinc-200">{m.email}</td>
                <td className="px-4 py-3 text-zinc-400">{m.name ?? "—"}</td>
                <td className="px-4 py-3">
                  {isAdmin && !isSelf && m.role !== "OWNER" ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        onChangeRole(m.id, e.target.value as MembershipRoleValue)
                      }
                      className="rounded-md border border-zinc-700/80 bg-zinc-950/80 px-2 py-1 font-mono text-[11px] text-zinc-200"
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="MEMBER">MEMBER</option>
                    </select>
                  ) : (
                    <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                      {m.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {isAdmin && !isSelf && m.role !== "OWNER" ? (
                    <button
                      type="button"
                      onClick={() => onRemove(m.id)}
                      className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-rose-200 hover:bg-rose-500/20"
                    >
                      Remover
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] text-zinc-600">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InvitesPanel({
  invites,
  isAdmin,
  atLimit,
  onCreate,
  onRevoke,
}: {
  invites: InvitationSummary[] | null;
  isAdmin: boolean;
  atLimit: boolean;
  onCreate: (email: string, role: MembershipRoleValue) => Promise<string | null>;
  onRevoke: (invitationId: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRoleValue>("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [lastToken, setLastToken] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setLastToken(null);
    try {
      const token = await onCreate(email.trim().toLowerCase(), role);
      if (token) {
        setLastToken(token);
        setEmail("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin ? (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-4"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300/90">
            Novo convite
          </p>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
            <label className="flex-1 text-xs uppercase tracking-wider text-zinc-500">
              E-mail
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/70"
                placeholder="alice@acme.com"
                disabled={atLimit}
              />
            </label>
            <label className="text-xs uppercase tracking-wider text-zinc-500">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as MembershipRoleValue)}
                className="mt-1 rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100"
                disabled={atLimit}
              >
                <option value="MEMBER">MEMBER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={submitting || atLimit}
              className="rounded-lg border border-cyan-500/45 bg-cyan-600/95 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_-8px_rgba(34,211,238,0.5)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? "Enviando…" : atLimit ? "Limite atingido" : "Convidar"}
            </button>
          </div>
          {atLimit ? (
            <p className="mt-3 font-mono text-[11px] text-amber-200">
              O plano atual não tem assentos disponíveis. Faça upgrade para
              convidar novos membros.
            </p>
          ) : null}
          {lastToken ? (
            <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                Convite criado — envie este token manualmente
              </p>
              <code className="mt-1 block break-all font-mono text-[11px] text-emerald-100">
                {lastToken}
              </code>
            </div>
          ) : null}
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/70">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/80 text-left font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expira</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(invites ?? []).map((inv) => (
              <tr key={inv.id} className="border-t border-zinc-800/80">
                <td className="px-4 py-3 text-zinc-200">{inv.email}</td>
                <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                  {inv.role}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                  {inv.status}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                  {new Date(inv.expiresAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {isAdmin && inv.status === "PENDING" ? (
                    <button
                      type="button"
                      onClick={() => onRevoke(inv.id)}
                      className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-rose-200 hover:bg-rose-500/20"
                    >
                      Revogar
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] text-zinc-600">—</span>
                  )}
                </td>
              </tr>
            ))}
            {(!invites || invites.length === 0) && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center font-mono text-[11px] text-zinc-500"
                >
                  Nenhum convite.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/70 px-4 py-6 text-center font-mono text-[11px] text-zinc-500">
      {text}
    </div>
  );
}
