import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, Copy, Plus, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  agentDevicesPath,
  composeDevices,
  composeInstallers,
  devicesWriteRefusal,
  downloadAvailabilityPath,
  pairingExpiry,
  pairingStartPath,
  revokeMachinePath,
  type DeviceInput,
  type DeviceRow,
  type InstallerAvailability,
  type InstallerRow,
} from "./devices";
import { motionForSurface } from "./motion";
import { copyToClipboard, isStandingRefusal, notify } from "./notify";
import { statusTone } from "./palette";
import { useV2Chrome } from "./V2Shell";
import { Button } from "@/components/ui/button";
import { DestructiveConfirm } from "./V2DestructiveConfirm";
import { useRefreshFailure } from "./useRefreshFailure";
import { V2CompactEmpty, V2EmptyState, V2LoadFailed } from "./V2EmptyState";
import { SkeletonRegister, V2PageSkeleton } from "./V2Skeleton";
import { V2PageHead } from "./V2PageHead";

type DevicesResponse = { data: DeviceInput[] };
type PairingResponse = { pairingCode: string; expiresAt: string };

const PAIRING_MOTION = motionForSurface("pairing-code").enterExit;

/** How often a shown pairing code's expiry is read again. */
const EXPIRY_TICK_MS = 15_000;

type RevokeTarget = { key: string; name: string; os: string | null; focusNext: string | null };

/** Where focus goes once a row is revoked: the next row's Revoke, else the previous one's, else none. */
function neighbourKey(rows: DeviceRow[], key: string): string | null {
  const index = rows.findIndex((row) => row.key === key);
  const next = rows[index + 1] ?? rows[index - 1];
  return next && next.revoke ? next.key : null;
}

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
  const [actionRefusal, setActionRefusal] = useState<string | null>(null);
  const [, setExpiryTick] = useState(0);
  const pendingFocus = useRef<{ removed: string; next: string | null } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<DevicesResponse>({
    queryKey: [agentDevicesPath()],
    refetchInterval: 15_000,
  });

  useRefreshFailure(isError && data !== undefined, "Your Devices could not be refreshed.", "v2-devices-refresh-failed");

  const availability = useQuery<InstallerAvailability>({
    queryKey: [downloadAvailabilityPath()],
    staleTime: 60_000,
  });

  const installers = composeInstallers({
    availability: availability.data ?? null,
    loading: availability.isPending,
    failed: availability.isError,
  });

  const page = composeDevices({
    now: new Date(),
    workspaceName,
    condition,
    pairing,
    devices: data?.data ?? [],
  });

  const expiry = page.pairing.code && page.pairing.expiresAt ? pairingExpiry(page.pairing.expiresAt, new Date()) : null;
  const codeShown = pairingOpen && page.pairing.appear && expiry !== null && !expiry.expired;

  // Keep the expiry current while the code is on screen; stop once it is hidden or spent.
  useEffect(() => {
    if (!codeShown) return;
    const timer = window.setInterval(() => setExpiryTick((tick) => tick + 1), EXPIRY_TICK_MS);
    return () => window.clearInterval(timer);
  }, [codeShown]);

  // Once the revoked row has left the list, focus its neighbour's Revoke, else Pair a device.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || page.rows.some((row) => row.key === target.removed)) return;
    pendingFocus.current = null;
    const next = target.next
      ? document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(`v2-devices-revoke-${target.next}`)}"]`)
      : null;
    (next ?? document.querySelector<HTMLElement>('[data-testid="v2-devices-pair"]'))?.focus();
  });

  function refuseWrite(error: Error) {
    if (!isStandingRefusal(error)) return notify.error(error);
    setActionRefusal(
      devicesWriteRefusal({
        kind: "error",
        workspaceName,
        errorMessage: error.message,
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
      // A refusal that explains the reader's standing (Read-only) closes the
      // card and stays above the page; any other failure is the card's own
      // failed state with Try again, said once, not also as a toast.
      if (isStandingRefusal(error)) {
        setPairingOpen(false);
        refuseWrite(error);
      }
    },
  });

  const revoke = useMutation({
    mutationFn: (row: RevokeTarget) => apiRequest("POST", revokeMachinePath(), { name: row.name, os: row.os }),
    onSuccess: (_result, row) => {
      pendingFocus.current = { removed: row.key, next: row.focusNext };
      queryClient.invalidateQueries({ queryKey: [agentDevicesPath()] });
      setActionRefusal(null);
      notify.success("Device revoked");
    },
    onError: refuseWrite,
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

  function onRevoke(row: DeviceRow) {
    if (!page.revokeAllowed) {
      setActionRefusal(page.writeRefusal);
      return;
    }
    revoke.mutate({ key: row.key, name: row.name, os: row.os, focusNext: neighbourKey(page.rows, row.key) });
  }

  function revokeControl(row: DeviceRow) {
    return (
      <DestructiveConfirm
        icon={Ban}
        label="Revoke"
        title="Revoke this Device?"
        consequence={`${row.name} stops recording time and is signed out of DocuFlow in every Workspace. Captures it has not sent yet are lost; to use it again, pair it with a new code.`}
        keepLabel="Keep Device"
        confirmLabel="Revoke Device"
        pending={revoke.isPending}
        testId={`v2-devices-revoke-${row.key}`}
        onConfirm={() => onRevoke(row)}
      />
    );
  }

  if (isLoading) {
    return (
      <V2PageSkeleton
        title="Devices"
        testId="v2-devices"
        status="Loading your enrolled Devices."
      >
        <SkeletonRegister
          className="df-devices-register"
          title="Your Devices"
          heads={["Device", "OS", "Status", "Last seen"]}
          rows={3}
        />
      </V2PageSkeleton>
    );
  }

  return (
    <div className="df-page" data-testid="v2-devices">
      <V2PageHead
        title="Devices"
        subhead={page.subhead}
        actions={
          <Button variant="default" type="button" data-testid="v2-devices-pair" onClick={onPair} className="df-btn">
            <Plus strokeWidth={1.6} aria-hidden />
            Pair a device
          </Button>
        }
      />

      {actionRefusal ? <p className="df-refusal">{actionRefusal}</p> : null}

      {pairingOpen ? (
        <section className="df-card" data-testid="v2-devices-pairing">
          <div className="df-card-head">
            <h2 className="df-card-title">Pairing code</h2>
            <Button variant="outline" type="button" onClick={() => setPairingOpen(false)} className="df-btn">
              Close
            </Button>
          </div>
          <div className="df-daily-form">
            <p className="df-sr-only" role="status">
              {codeShown ? "Pairing code ready" : ""}
            </p>
            {page.pairing.pending ? (
              <p className="df-pairing-pending">Generating a code…</p>
            ) : page.pairing.appear && page.pairing.code && expiry?.expired ? (
              <>
                <p className="df-note df-flush" data-testid="v2-devices-pairing-expired">
                  This code has expired. Get a new code to pair the desktop agent.
                </p>
                <div className="df-devices-actions">
                  <Button variant="default" type="button" onClick={onPair} disabled={pair.isPending} className="df-btn">
                    <RefreshCw strokeWidth={1.6} aria-hidden />
                    New code
                  </Button>
                </div>
              </>
            ) : page.pairing.appear && page.pairing.code ? (
              <>
                <p className="df-pairing-code" data-motion={PAIRING_MOTION} data-testid="v2-devices-pairing-code">
                  {page.pairing.code}
                </p>
                <p className="df-note df-flush">
                  {expiry ? `${expiry.label}. ` : ""}Enter it once in the desktop agent.
                </p>
                <div className="df-devices-actions">
                  <Button variant="outline" type="button" onClick={onPair} disabled={pair.isPending} className="df-btn">
                    <RefreshCw strokeWidth={1.6} aria-hidden />
                    New code
                  </Button>
                  <Button variant="default" type="button" onClick={() => copyToClipboard(page.pairing.code!, "Pairing code copied")} className="df-btn">
                    <Copy strokeWidth={1.6} aria-hidden />
                    Copy code
                  </Button>
                </div>
              </>
            ) : (
              <V2LoadFailed
                title="A pairing code could not be generated"
                copy="Something went wrong while generating it. Try again."
                onRetry={onPair}
                testId="v2-devices-pairing-failed"
              />
            )}
          </div>
        </section>
      ) : null}

      {isError && data === undefined ? (
        <V2LoadFailed
          title="Your Devices could not be loaded"
          copy="Something went wrong while loading them. Try again."
          onRetry={() => refetch()}
          testId="v2-devices-load-failed"
        />
      ) : (
        <section className="df-card df-devices-register" data-testid="v2-devices-register">
          <div className="df-card-head">
            <h2 className="df-card-title">Your Devices</h2>
          </div>
          {layout.stackedRegister ? null : (
            <div className="df-register-head df-desktop-only">
              <span>Device</span>
              <span>OS</span>
              <span>Status</span>
              <span>Last seen</span>
              <span />
            </div>
          )}
          {page.emptyState ? (
            <V2EmptyState
              icon="devices"
              title={page.emptyState.title}
              copy={page.emptyState.copy}
              action={
                page.pairAllowed ? (
                  <Button variant="default" type="button" onClick={onPair} className="df-btn">
                    <Plus strokeWidth={1.6} aria-hidden />
                    Pair a device
                  </Button>
                ) : undefined
              }
              testId="v2-devices-empty"
            />
          ) : (
            page.rows.map((row) => (
              <div key={row.key} className="df-register-row" data-testid={`v2-devices-row-${row.key}`}>
                {layout.stackedRegister ? (
                  <span className="df-project-mobile">
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="df-row-title">{row.name}</div>
                      <div className="df-mono df-meta">
                        {row.osLabel} · {row.status}
                        {row.version ? ` · ${row.version}` : ""} · {row.lastSeen}
                      </div>
                    </span>
                    {row.revoke ? revokeControl(row) : null}
                  </span>
                ) : (
                  <>
                    <span>
                      <div className="df-row-title">{row.name}</div>
                      <div className="df-mono df-meta">{row.version ?? "-"}</div>
                    </span>
                    <span className="df-mono df-meta">{row.osLabel}</span>
                    <span className="df-status-word" data-status={row.status} data-tone={statusTone(row.status)}>
                      {row.status}
                    </span>
                    <span className="df-mono df-meta">{row.lastSeen}</span>
                    <span className="df-devices-action">
                      {row.revoke ? revokeControl(row) : null}
                    </span>
                  </>
                )}
              </div>
            ))
          )}
        </section>
      )}

      <section className="df-card" data-testid="v2-devices-installers">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">{installers.heading}</h2>
            <p className="df-card-sub">{installers.blurb}</p>
          </div>
        </div>
        {installers.rows.map((row) => (
          <InstallerRowView key={row.platform} row={row} />
        ))}
        {installers.unavailableCopy ? <V2CompactEmpty>{installers.unavailableCopy}</V2CompactEmpty> : null}
      </section>
    </div>
  );
}

function InstallerRowView({ row }: { row: InstallerRow }) {
  return (
    <div className="df-installer-row" data-testid={`v2-devices-installer-${row.platform}`}>
      <div className="df-installer-text">
        <div className="df-row-title">{row.label}</div>
        <p className="df-card-sub">{row.requirement}</p>
        {row.note ? <p className="df-card-sub">{row.note}</p> : null}
      </div>
      {row.ready && row.href ? (
        <Button asChild variant="outline" className="df-btn">
          <a
            className="df-installer-get"
            href={row.href}
            data-testid={`v2-devices-installer-get-${row.platform}`}
          >
            {row.action}
          </a>
        </Button>
      ) : (
        <span className="df-installer-state" data-testid={`v2-devices-installer-state-${row.platform}`}>
          {row.action}
        </span>
      )}
    </div>
  );
}
