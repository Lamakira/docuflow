import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkeletonSection, V2PageSkeleton } from "./V2Skeleton";
import {
  administrationReadOnlyNote,
  administrationRefusal,
  canManageAdministration,
  type PolicyEdits,
} from "./administration";
import { notify } from "./notify";
import {
  ADMINISTRATION_TAB_IDS,
  administrationTabHref,
  administrationTabs,
  type AdministrationTabId,
} from "./presentation";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2EmptyState } from "./V2EmptyState";
import { V2PageHead } from "./V2PageHead";
import type { AdministrationContext } from "./V2AdministrationParts";
import { V2AdministrationWorkspace } from "./V2AdministrationWorkspace";
import { V2AdministrationBilling } from "./V2AdministrationBilling";
import { V2AdministrationTrackingPolicy } from "./V2AdministrationTrackingPolicy";
import { V2AdministrationPipelineLists } from "./V2AdministrationPipelineLists";
import { V2AdministrationIntegrations } from "./V2AdministrationIntegrations";
import { V2SupportAccess } from "./V2SupportAccess";

function isAdministrationTab(value: string): value is AdministrationTabId {
  return (ADMINISTRATION_TAB_IDS as readonly string[]).includes(value);
}

/** Shown once when the page is left with edits nobody saved, as the document editor does. */
const LEFT_UNSAVED = "Your changes in Administration were not saved.";

/**
 * Administration: the head and the tabs at once, and each tab reads only what
 * it shows (F107). The unsaved edits live here, not in a tab: Radix unmounts a
 * panel that is not open, and an edit must outlive a tab switch.
 */
export function V2AdministrationPage() {
  const params = useParams<{ tab?: string }>();
  const [, navigate] = useLocation();
  const requested = params.tab ?? "workspace";
  const tab: AdministrationTabId = isAdministrationTab(requested) ? requested : "workspace";

  // Analytics left Administration for the rail (#281). An old deep link to its
  // warnings, or a tab that does not exist, still lands somewhere real.
  useEffect(() => {
    if (window.location.hash === "#alerts") {
      navigate("/analytics#alerts", { replace: true });
      return;
    }
    if (!isAdministrationTab(requested)) navigate(administrationTabHref("workspace"), { replace: true });
  }, [navigate, requested]);

  const { layout, memberships } = useV2Chrome();
  const ownerName = useWorkspaceOwnerName();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const workspaceRole = current?.workspaceRole ?? "MEMBER";
  const condition = current?.condition ?? null;
  const canManage = canManageAdministration(workspaceRole);

  const [policyEdits, setPolicyEdits] = useState<PolicyEdits>({});
  const [zoneDraft, setZoneDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const unsaved = Object.keys(policyEdits).length > 0 || zoneDraft !== null || nameDraft !== null;

  // A switch of Workspace keeps the page mounted: an edit typed for one
  // Workspace must not become a savable edit in the next.
  const activeWorkspaceId = memberships?.activeWorkspaceId ?? null;
  const editedFor = useRef(activeWorkspaceId);
  useEffect(() => {
    if (editedFor.current === activeWorkspaceId) return;
    editedFor.current = activeWorkspaceId;
    setPolicyEdits({});
    setZoneDraft(null);
    setNameDraft(null);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // The router cannot hold a route change back, so leaving inside the app is
  // said after the fact, once.
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  useEffect(
    () => () => {
      if (unsavedRef.current) notify.error(null, { fallback: LEFT_UNSAVED, id: "v2-administration-left-unsaved" });
    },
    [],
  );

  // On a phone the strip scrolls sideways: the open tab is brought into view.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab, canManage]);

  if (!memberships) return <AdministrationSkeleton />;

  if (!canManage) {
    return (
      <div className="df-page" data-testid="v2-administration">
        <V2PageHead title="Administration" />
        <V2EmptyState
          icon="access"
          title="Administration is not open to you"
          copy={administrationRefusal({ workspaceRole, ownerName })}
          testId="v2-administration-refusal"
        />
      </div>
    );
  }

  const context: AdministrationContext = {
    workspaceName,
    workspaceRole,
    ownerName,
    condition,
    stacked: layout.stackedRegister,
  };
  const readOnlyNote = administrationReadOnlyNote(workspaceName, condition);

  return (
    <div className="df-page" data-testid="v2-administration">
      <V2PageHead title="Administration" />

      {readOnlyNote ? <p className="df-refusal">{readOnlyNote}</p> : null}

      {/* One configuration section at a time (#281). The tab lives in the path,
          so a deep link opens the section it names. Manual activation: arrowing
          across the tabs moves focus, not history. */}
      <Tabs
        value={tab}
        onValueChange={(next) => navigate(administrationTabHref(next as AdministrationTabId))}
        activationMode="manual"
        className="df-admin-tabs"
      >
        <TabsList ref={strip} className="df-tabs" aria-label="Administration">
          {administrationTabs(tab, workspaceRole).map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="df-tab"
              data-testid={`v2-administration-tab-${item.id}`}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="workspace" className="df-admin-panel" data-testid="v2-administration-panel-workspace">
          <V2AdministrationWorkspace
            context={context}
            nameDraft={nameDraft}
            onNameDraft={setNameDraft}
            zoneDraft={zoneDraft}
            onZoneDraft={setZoneDraft}
          />
        </TabsContent>

        <TabsContent value="billing" className="df-admin-panel" data-testid="v2-administration-panel-billing">
          <V2AdministrationBilling context={context} />
        </TabsContent>

        <TabsContent value="tracking-policy" className="df-admin-panel" data-testid="v2-administration-panel-tracking-policy">
          <V2AdministrationTrackingPolicy context={context} edits={policyEdits} onEdits={setPolicyEdits} />
        </TabsContent>

        <TabsContent value="pipeline-lists" className="df-admin-panel" data-testid="v2-administration-panel-pipeline-lists">
          <V2AdministrationPipelineLists context={context} />
        </TabsContent>

        <TabsContent value="integrations" className="df-admin-panel" data-testid="v2-administration-panel-integrations">
          <V2AdministrationIntegrations context={context} />
        </TabsContent>

        <TabsContent value="support-access" className="df-admin-panel" data-testid="v2-administration-panel-support-access">
          <V2SupportAccess workspaceRole={workspaceRole} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** While the Workspace Role is not known yet, so neither are the tabs. */
function AdministrationSkeleton() {
  return (
    <V2PageSkeleton
      title="Administration"
      testId="v2-administration"
      hasSubhead={false}
      status="Loading Administration for this Workspace."
    >
      <SkeletonSection title="Workspace" className="df-analytics-register" tiles={4} />
    </V2PageSkeleton>
  );
}
