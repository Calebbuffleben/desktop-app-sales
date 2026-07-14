"use client";

import type { SellerRoomSummary } from "@/types/desktop-api";
import type { AcousticClass } from "@/shared/fingerprint-types";

export type SellerRoomsPanelProps = {
  rooms: SellerRoomSummary[];
  currentUserId?: string | null;
  activeSellerRoomId: string;
  sellerRoomName: string;
  inviteeEmail: string;
  sellerRoomStatus: string;
  acousticClass: AcousticClass;
  correlationConfidence: number;
  syncJoined: boolean;
  syncPresenceIds: string[];
  disabled?: boolean;
  onSellerRoomNameChange: (value: string) => void;
  onInviteeEmailChange: (value: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onSelectRoom: (roomId: string) => void;
  onJoinMembership: (roomId: string) => void;
  onLeave: (roomId: string) => void;
  onAcceptInvite: (invitationId: string) => void;
  onInvite: () => void;
  onEnd: (roomId: string) => void;
};

function memberLabel(
  room: SellerRoomSummary,
  userId: string,
): string {
  const member = room.members?.find((m) => m.userId === userId);
  return member?.user?.name || member?.user?.email || userId.slice(0, 8);
}

export function SellerRoomsPanel(props: SellerRoomsPanelProps) {
  const {
    rooms,
    currentUserId,
    activeSellerRoomId,
    sellerRoomName,
    inviteeEmail,
    sellerRoomStatus,
    acousticClass,
    correlationConfidence,
    syncJoined,
    syncPresenceIds,
    disabled,
    onSellerRoomNameChange,
    onInviteeEmailChange,
    onRefresh,
    onCreate,
    onSelectRoom,
    onJoinMembership,
    onLeave,
    onAcceptInvite,
    onInvite,
    onEnd,
  } = props;

  const btn =
    "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200 disabled:opacity-40 hover:border-zinc-500";
  const btnDanger =
    "rounded border border-red-900/80 bg-red-950/40 px-2 py-1 font-mono text-[11px] text-red-200 disabled:opacity-40 hover:border-red-700";

  const presentRooms = rooms.filter(
    (r) =>
      r.myMemberStatus === "JOINED" &&
      (r.status === "OPEN" || r.status === "ACTIVE"),
  );
  const pendingInvites = rooms.filter(
    (r) =>
      (r.myMemberStatus === "INVITED" || Boolean(r.pendingInvitationId)) &&
      (r.status === "OPEN" || r.status === "ACTIVE"),
  );
  const endedRooms = rooms.filter(
    (r) => r.status === "ENDED" || r.status === "ARCHIVED",
  );
  const activeRoom =
    rooms.find((r) => r.id === activeSellerRoomId) ?? null;
  const liveOnlineIds =
    syncJoined && activeSellerRoomId
      ? Array.from(
          new Set([
            ...syncPresenceIds,
            ...(activeRoom?.onlineUserIds ?? []),
            ...(currentUserId ? [currentUserId] : []),
          ]),
        )
      : (activeRoom?.onlineUserIds ?? []);

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Seller Rooms — presença
        </p>
        <button
          className={btn}
          type="button"
          disabled={disabled}
          onClick={onRefresh}
        >
          Atualizar
        </button>
      </div>

      {/* Live sync presence */}
      <section className="mb-3 rounded border border-cyan-900/50 bg-cyan-950/20 p-2">
        <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-cyan-400/90">
          Presente agora (sync acústica)
        </p>
        {!activeSellerRoomId ? (
          <p className="font-mono text-[11px] text-zinc-500">
            Nenhuma sala selecionada para esta captura. Escolha uma em &quot;Minhas
            salas&quot;.
          </p>
        ) : (
          <>
            <p className="font-mono text-[11px] text-cyan-100">
              {activeRoom?.name ?? activeSellerRoomId.slice(0, 8)} ·{" "}
              {activeRoom?.status ?? "?"} · meeting{" "}
              {activeRoom?.meetingId ?? "—"}
            </p>
            <p className="mt-1 font-mono text-[11px] text-zinc-300">
              Sync:{" "}
              <span className={syncJoined ? "text-emerald-400" : "text-amber-400"}>
                {syncJoined ? "conectado" : "aguardando captura"}
              </span>
              {" · "}
              loopback: <span className="text-cyan-300">{acousticClass}</span>
              {" · "}
              conf {correlationConfidence.toFixed(2)}
            </p>
            <ul className="mt-2 space-y-1">
              {(activeRoom?.members ?? [])
                .filter((m) => m.status === "JOINED")
                .map((m) => {
                  const online = liveOnlineIds.includes(m.userId);
                  const isMe = m.userId === currentUserId;
                  return (
                    <li
                      key={m.userId}
                      className="flex items-center gap-2 font-mono text-[11px] text-zinc-300"
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          online ? "bg-emerald-400" : "bg-zinc-600"
                        }`}
                        title={online ? "online" : "offline"}
                      />
                      <span className="truncate">
                        {memberLabel(activeRoom!, m.userId)}
                        {isMe ? " (você)" : ""}
                      </span>
                      <span className="text-zinc-600">
                        {online ? "online" : "offline"}
                      </span>
                    </li>
                  );
                })}
              {(activeRoom?.members ?? []).filter((m) => m.status === "JOINED")
                .length === 0 ? (
                <li className="font-mono text-[10px] text-zinc-500">
                  Nenhum membro JOINED
                </li>
              ) : null}
            </ul>
          </>
        )}
        {sellerRoomStatus ? (
          <p className="mt-2 font-mono text-[10px] text-zinc-500">
            {sellerRoomStatus}
          </p>
        ) : null}
      </section>

      {/* My rooms */}
      <section className="mb-3">
        <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Minhas salas ({presentRooms.length})
        </p>
        {presentRooms.length === 0 ? (
          <p className="font-mono text-[11px] text-zinc-500">
            Você ainda não está JOINED em nenhuma sala aberta.
          </p>
        ) : (
          <ul className="max-h-44 space-y-2 overflow-auto">
            {presentRooms.map((room) => {
              const selected = activeSellerRoomId === room.id;
              return (
                <li
                  key={room.id}
                  className={`rounded border px-2 py-2 ${
                    selected
                      ? "border-cyan-600 bg-cyan-950/30"
                      : "border-zinc-800 bg-zinc-900/80"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12px] text-zinc-100">
                        {room.name}
                        {room.isCreator ? (
                          <span className="ml-1 text-[10px] text-zinc-500">
                            · criador
                          </span>
                        ) : null}
                      </p>
                      <p className="font-mono text-[10px] text-zinc-500">
                        {room.status} · {room.onlineCount ?? 0} online ·{" "}
                        {room.meetingId}
                        {room.iAmOnline ? " · você online" : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(room.members ?? [])
                          .filter((m) => m.status === "JOINED")
                          .slice(0, 6)
                          .map((m) => {
                            const online = (room.onlineUserIds ?? []).includes(
                              m.userId,
                            );
                            return (
                              <span
                                key={m.userId}
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                                  online
                                    ? "border-emerald-800 text-emerald-300"
                                    : "border-zinc-700 text-zinc-500"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    online ? "bg-emerald-400" : "bg-zinc-600"
                                  }`}
                                />
                                {memberLabel(room, m.userId).split("@")[0]}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        className={btn}
                        type="button"
                        disabled={disabled || selected}
                        onClick={() => onSelectRoom(room.id)}
                      >
                        {selected ? "Selecionada" : "Usar na captura"}
                      </button>
                      <button
                        className={btn}
                        type="button"
                        disabled={disabled}
                        onClick={() => onLeave(room.id)}
                      >
                        Sair
                      </button>
                      {room.isCreator ? (
                        <button
                          className={btnDanger}
                          type="button"
                          disabled={disabled}
                          onClick={() => onEnd(room.id)}
                        >
                          Encerrar
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Pending invites */}
      <section className="mb-3">
        <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Convites pendentes ({pendingInvites.length})
        </p>
        {pendingInvites.length === 0 ? (
          <p className="font-mono text-[11px] text-zinc-500">Nenhum convite.</p>
        ) : (
          <ul className="space-y-2">
            {pendingInvites.map((room) => {
              const invitationId =
                room.pendingInvitationId ||
                room.invitations?.find(
                  (inv) =>
                    inv.inviteeId === currentUserId && inv.status === "PENDING",
                )?.id;
              const invitedBy =
                room.invitations?.find((inv) => inv.id === invitationId)
                  ?.invitedBy?.email ?? room.createdBy?.email;
              return (
                <li
                  key={room.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-900/40 bg-amber-950/20 px-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] text-amber-100">
                      {room.name}
                    </p>
                    <p className="font-mono text-[10px] text-zinc-500">
                      de {invitedBy ?? "—"} · {room.meetingId}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {invitationId ? (
                      <button
                        className={btn}
                        type="button"
                        disabled={disabled}
                        onClick={() => onAcceptInvite(invitationId)}
                      >
                        Aceitar
                      </button>
                    ) : (
                      <button
                        className={btn}
                        type="button"
                        disabled={disabled}
                        onClick={() => onJoinMembership(room.id)}
                      >
                        Entrar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Invite + create */}
      <section className="mb-2 space-y-2 border-t border-zinc-800 pt-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Convidar / criar
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[160px] flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200"
            type="email"
            autoComplete="email"
            value={inviteeEmail}
            onChange={(e) => onInviteeEmailChange(e.target.value)}
            placeholder="e-mail do vendedor"
            disabled={disabled || !activeSellerRoomId}
          />
          <button
            className={btn}
            type="button"
            disabled={disabled || !activeSellerRoomId || !inviteeEmail.trim()}
            onClick={onInvite}
          >
            Convidar
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[160px] flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200"
            value={sellerRoomName}
            onChange={(e) => onSellerRoomNameChange(e.target.value)}
            placeholder="Nome da nova sala"
            disabled={disabled}
          />
          <button
            className={btn}
            type="button"
            disabled={disabled}
            onClick={onCreate}
          >
            Criar sala
          </button>
        </div>
      </section>

      {endedRooms.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer font-mono text-[10px] text-zinc-600">
            Salas encerradas ({endedRooms.length})
          </summary>
          <ul className="mt-1 max-h-24 space-y-1 overflow-auto">
            {endedRooms.map((room) => (
              <li
                key={room.id}
                className="truncate font-mono text-[10px] text-zinc-600"
              >
                {room.name} · {room.status} · {room.meetingId}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
