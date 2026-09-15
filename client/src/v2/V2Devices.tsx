import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  agentDevicesPath,
  composeDevices,
  devicesWriteRefusal,
  pairingStartPath,
  revokeMachinePath,
  type DeviceInput,
} from "./devices";
import { motionForSurface } from "./motion";
import { useV2Chrome } from "./V2Shell";

type DevicesResponse = { data: DeviceInput[] };
type PairingResponse = { pairingCode: string; expiresAt: string };

const PAIRING_MOTION = motionForSurface("pairing-code").enterExit;

export function V2DevicesPage() {
  const { layout, memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const condition = current?.condition ?? null;
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairing, setPairing] = useState<{ pending: boolean; code: string | null; expiresAt: string | null }>({
    pending: false,
    code: null,
    expiresAt: null,
  });
  const [revokeKey, setRevokeKey] = useState<string | null>(null);
  const [actionRefusal, setActionRefusal] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<DevicesResponse>({
    queryKey: [agentDevicesPath()],
    refetchInterval: 15_000,
  });

  const page = composeDevices({
    now: new Date(),
    workspaceName,
    condition,
    pairing,
    devices: data?.data ?? [],
  });

  function refuseWrite(message: string) {
    setActionRefusal(
      devicesWriteRefusal({
        kind: "error",
        workspaceName,
        errorMessage: message,
      }),
    );
  }

  const pair = useMutation({
    mutationFn: () => apiRequest("POST", pairingStartPath(), {}) as Promise<PairingResponse>,
    onSuccess: (result) => {
      setPairing({ pending: false, code: result.pairingCode, expiresAt: result.expiresAt });
      setActionRefusal(null);
    },
    onError: (error: Error) => {
      setPairing((currentPairing) => ({ ...currentPairing, pending: false }));
      refuseWrite(error.message);
    },
  });

  const revoke = useMutation({
    mutationFn: (row: { name: string; os: string | null }) =>
      apiRequest("POST", revokeMachinePath(), { name: row.name, os: row.os }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [agentDevicesPath()] });
      setRevokeKey(null);
      setActionRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  function onPair() {
    if (!page.pairAllowed) {
      setActionRefusal(page.writeRefusal);
      return;
    }
    setPairingOpen(true);
    setPairing({ pending: true, code: null, expiresAt: null });
    pair.mutate();
  }

  function onRevoke(row: { key: string; name: string; os: string | null }) {
    if (!page.revokeAllowed) {
      setActionRefusal(page.writeRefusal);
      return;
    }
    if (revokeKey !== row.key) {
      setRevokeKey(row.key);
      return;
    }
    revoke.mutate({ name: row.name, os: row.os });
  }

  if (isLoading) {
    return (
      <div className="df-page" data-testid="v2-devices">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Devices</h1>
            <p className="df-subhead">Loading enrolled Devices…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-devices">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Devices</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
        <div className="df-devices-actions">
          <button type="button" className="df-ink-btn" data-testid="v2-devices-pair" onClick={onPair}>
            Pair a device
          </button>
        </div>
      </header>

      {actionRefusal ? <p className="df-refusal">{actionRefusal}</p> : null}

      {pairingOpen ? (
        <section className="df-card" data-testid="v2-devices-pairing">
          <div className="df-card-head">
            <h2 className="df-card-title">Pairing code</h2>
            <button type="button" className="df-ghost-btn" onClick={() => setPairingOpen(false)}>
              Close
            </button>
          </div>
          <div className="df-daily-form">
            {page.pairing.pending ? (
              <p className="df-pairing-pending">Generating a code…</p>
            ) : page.pairing.appear && page.pairing.code ? (
              <>
                <p className="df-pairing-code" data-motion={PAIRING_MOTION} data-testid="v2-devices-pairing-code">
                  {page.pairing.code}
                </p>
                {page.pairing.expiresAt ? (
                  <p className="df-empty" style={{ padding: 0 }}>
                    Expires {new Date(page.pairing.expiresAt).toLocaleTimeString()}. Enter it once in the desktop
                    agent.
                  </p>
                ) : null}
                <div className="df-devices-actions">
                  <button type="button" className="df-ghost-btn" onClick={onPair} disabled={pair.isPending}>
                    New code
                  </button>
                  <button
                    type="button"
                    className="df-ink-btn"
                    onClick={() => void navigator.clipboard.writeText(page.pairing.code!)}
                  >
                    Copy code
                  </button>
                </div>
              </>
            ) : (
              <p className="df-empty">Could not generate a code.</p>
            )}
          </div>
        </section>
      ) : null}

      {isError ? (
        <p className="df-empty">Enrolled Devices could not be loaded.</p>
      ) : (
        <section className="df-card df-devices-register" data-testid="v2-devices-register">
          <div className="df-card-head">
            <h2 className="df-card-title">Your Devices</h2>
          </div>
          {layout.stackedRegister ? null : (
            <div className="df-register-head df-desktop-only">
              <span>DEVICE</span>
              <span>OS</span>
              <span>STATUS</span>
              <span>LAST SEEN</span>
              <span />
            </div>
          )}
          {page.empty ? (
            <p className="df-empty">{page.emptyCopy}</p>
          ) : (
            page.rows.map((row) => (
              <div key={row.key} className="df-register-row" data-testid={`v2-devices-row-${row.key}`}>
                {layout.stackedRegister ? (
                  <span className="df-project-mobile">
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="df-row-title">{row.name}</div>
                      <div className="df-mono df-meta">
                        {row.os ?? "—"} · {row.status}
                        {row.version ? ` · ${row.version}` : ""} · {row.lastSeen}
                      </div>
                    </span>
                    {row.revoke ? (
                      <RevokeControl
                        row={row}
                        pending={revoke.isPending}
                        confirming={revokeKey === row.key}
                        onRevoke={onRevoke}
                        onCancel={() => setRevokeKey(null)}
                      />
                    ) : null}
                  </span>
                ) : (
                  <>
                    <span>
                      <div className="df-row-title">{row.name}</div>
                      <div className="df-mono df-meta">{row.version ?? "—"}</div>
                    </span>
                    <span className="df-mono df-meta">{row.os ?? "—"}</span>
                    <span className="df-status" data-status={row.status}>
                      {row.status}
                    </span>
                    <span className="df-mono df-meta">{row.lastSeen}</span>
                    <span className="df-devices-action">
                      {row.revoke ? (
                        <RevokeControl
                          row={row}
                          pending={revoke.isPending}
                          confirming={revokeKey === row.key}
                          onRevoke={onRevoke}
                          onCancel={() => setRevokeKey(null)}
                        />
                      ) : null}
                    </span>
                  </>
                )}
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}

function RevokeControl({
  row,
  pending,
  confirming,
  onRevoke,
  onCancel,
}: {
  row: { key: string; name: string; os: string | null };
  pending: boolean;
  confirming: boolean;
  onRevoke: (row: { key: string; name: string; os: string | null }) => void;
  onCancel: () => void;
}) {
  if (confirming) {
    return (
      <span className="df-devices-confirm">
        <span className="df-empty" style={{ padding: 0 }}>
          Revoke this Device Enrollment? It ends access to the Workspace.
        </span>
        <button
          type="button"
          className="df-ghost-btn"
          disabled={pending}
          data-testid={`v2-devices-revoke-${row.key}`}
          onClick={() => onRevoke(row)}
        >
          Revoke
        </button>
        <button type="button" className="df-ghost-btn" onClick={onCancel}>
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="df-ghost-btn"
      disabled={pending}
      data-testid={`v2-devices-revoke-${row.key}`}
      onClick={() => onRevoke(row)}
    >
      Revoke
    </button>
  );
}