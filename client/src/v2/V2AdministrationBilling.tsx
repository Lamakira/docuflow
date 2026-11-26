import { useState } from "react";
import { Ban, CalendarDays, Lock, PenLine } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  billingCancelPath,
  billingCheckoutPath,
  billingKeepPath,
  billingPaymentMethodPath,
  billingPricesPath,
  billingSeatsPath,
  billingSubscriptionPath,
  checkoutTotalLine,
  composeBilling,
  hostedBillingSession,
  planPickerNote,
  planPrice,
  seatChangeConfirmation,
  seatFloorNote,
  seatPriceLine,
  seatQuantityIssue,
  type BillingInput,
  type BillingPrice,
} from "./administration";
import { notify } from "./notify";
import { billingConditionTone } from "./palette";
import {
  BILLING_INTERVAL_LABEL,
  FEATURE_LABEL,
  billingPlanPath,
  entitlementsPath,
  intendedPricedPlan,
  planIncludes,
  planIntentNote,
  pricedPlans,
  useEntitlements,
  type BillingInterval,
  type Entitlements,
  type PricedPlanKey,
} from "./plan";
import { administrationTabHref } from "./presentation";
import { V2FilterSelect } from "./V2Select";
import { SkeletonSection } from "./V2Skeleton";
import { V2LoadFailed } from "./V2EmptyState";
import { DestructiveConfirm } from "./V2DestructiveConfirm";
import {
  AdministrationRefused,
  WriteRefusal,
  useAdministrationRead,
  useAdministrationWrites,
  type AdministrationContext,
} from "./V2AdministrationParts";

/** Stripe hands the customer back to the tab that sent them. */
function returnUrl(): string {
  return `${window.location.origin}${administrationTabHref("billing")}`;
}

/** Prices change rarely; the server caches them too. A provider that cannot answer gives none. */
const PRICES_STALE_MS = 10 * 60 * 1000;

function useBillingPrices(): BillingPrice[] {
  const { data } = useQuery<{ prices: BillingPrice[] }>({
    queryKey: [billingPricesPath()],
    staleTime: PRICES_STALE_MS,
    queryFn: async () => {
      const res = await fetch(billingPricesPath(), { credentials: "include" });
      if (!res.ok) return { prices: [] };
      return res.json();
    },
  });
  return data?.prices ?? [];
}

export function V2AdministrationBilling({ context }: { context: AdministrationContext }) {
  const read = useAdministrationRead<BillingInput>(billingSubscriptionPath(), "Billing", "billing");
  const { data: entitlements } = useEntitlements();
  const prices = useBillingPrices();
  const writes = useAdministrationWrites(context);
  const [chosenPlan, setChosenPlan] = useState<PricedPlanKey | null>(null);
  const [chosenInterval, setChosenInterval] = useState<BillingInterval | null>(null);
  const [checkoutSeats, setCheckoutSeats] = useState<string | null>(null);
  const [seatText, setSeatText] = useState<string | null>(null);

  const pin = read.data ?? null;
  const billing = composeBilling({ billing: pin, condition: context.condition });
  const currentPriced = pricedPlans(entitlements).some((plan) => plan.planKey === entitlements?.planKey)
    ? (entitlements!.planKey as PricedPlanKey)
    : null;
  const planChoice: PricedPlanKey = chosenPlan ?? currentPriced ?? intendedPricedPlan(entitlements) ?? "business";
  const intervalChoice: BillingInterval =
    chosenInterval ?? entitlements?.billingInterval ?? entitlements?.intendedInterval ?? "monthly";
  // Checkout starts from the Members, never from the seats a Trial holds (F103).
  const checkoutSeatText = checkoutSeats ?? String(billing.seatFloor);

  function refreshBilling() {
    void queryClient.invalidateQueries({ queryKey: [billingSubscriptionPath()] });
  }

  const startCheckout = useMutation({
    mutationFn: async () => {
      const session = await apiRequest("POST", billingCheckoutPath(), {
        planKey: planChoice,
        interval: intervalChoice,
        seatQuantity: Number(checkoutSeatText),
        successUrl: returnUrl(),
        cancelUrl: returnUrl(),
      });
      const redirect = hostedBillingSession({ url: session.url });
      window.location.assign(redirect.url);
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  const changePlan = useMutation({
    mutationFn: () => apiRequest("POST", billingPlanPath(), { planKey: planChoice, interval: intervalChoice }),
    onSuccess: () => {
      refreshBilling();
      queryClient.invalidateQueries({ queryKey: [entitlementsPath()] });
      setChosenPlan(null);
      setChosenInterval(null);
      writes.clear();
      notify.success("Plan changed");
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  const changeSeats = useMutation({
    mutationFn: (seatQuantity: number): Promise<BillingInput> => apiRequest("POST", billingSeatsPath(), { seatQuantity }),
    onSuccess: (next, seatQuantity) => {
      queryClient.setQueryData([billingSubscriptionPath()], next);
      refreshBilling();
      setSeatText(null);
      writes.clear();
      const before = pin?.purchasedSeatCapacity ?? seatQuantity;
      notify.success(
        seatQuantity > before
          ? "Seats added"
          : seatQuantity === before
            ? "The planned seat change is cancelled"
            : "Seat change planned",
      );
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  const updatePaymentMethod = useMutation({
    mutationFn: async () => {
      const session = await apiRequest("POST", billingPaymentMethodPath(), { returnUrl: returnUrl() });
      const redirect = hostedBillingSession({ url: session.url });
      window.location.assign(redirect.url);
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  const cancelAtPeriodEnd = useMutation({
    mutationFn: () => apiRequest("POST", billingCancelPath(), {}),
    onSuccess: () => {
      refreshBilling();
      writes.clear();
      notify.success("Subscription set to cancel at period end");
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  const keepSubscription = useMutation({
    mutationFn: () => apiRequest("POST", billingKeepPath(), {}),
    onSuccess: () => {
      refreshBilling();
      writes.clear();
      notify.success("Subscription kept");
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  if (read.state === "loading") return <SkeletonSection title="Billing" className="df-policy-form" tiles={3} />;

  const cardHead = (
    <div className="df-card-head">
      <div className="df-card-head-text">
        <h2 className="df-card-title">Billing</h2>
        <p className="df-card-sub">Plan, Billable Seats, and the term for this Workspace. Card details stay with Stripe.</p>
      </div>
    </div>
  );

  if (read.state === "failed" || read.state === "refused") {
    return (
      <section className="df-card df-policy-form" data-testid="v2-administration-billing">
        {cardHead}
        {read.state === "failed" ? (
          <V2LoadFailed title="Billing could not be loaded" onRetry={read.retry} testId="v2-administration-billing-failed" />
        ) : (
          <AdministrationRefused context={context} />
        )}
      </section>
    );
  }

  const has = (id: string) => billing.actions.some((action) => action.id === id);
  const current = pin?.purchasedSeatCapacity ?? 0;
  const seatValue = seatText ?? billing.seatQuantityDefault;
  const seatIssue = seatText === null ? null : seatQuantityIssue(seatValue, billing.seatFloor);
  const seatTarget = seatIssue === null ? Number(seatValue) : current;
  const seatConfirmation = seatChangeConfirmation({
    from: current,
    to: seatTarget,
    periodEndsAt: pin?.periodEndsAt ?? null,
    unitAmountMinor: pin?.unitAmountMinor,
    currency: pin?.currency,
    interval: entitlements?.billingInterval,
  });
  const cancel = billing.actions.find((action) => action.id === "cancel");
  const keep = billing.actions.find((action) => action.id === "keep");

  return (
    <section className="df-card df-policy-form" data-testid="v2-administration-billing">
      {cardHead}
      <WriteRefusal refusal={writes.refusal} />

      {billing.summary ? (
        <div className="df-billing-summary" data-testid="v2-administration-billing-summary">
          <div className="df-billing-plan">
            <span className="df-billing-label">Current Plan</span>
            <div className="df-billing-plan-line">
              <span className="df-billing-plan-name">{billing.summary.plan}</span>
              {billing.condition ? (
                <span className="df-status" data-status={billing.condition} data-tone={billingConditionTone(billing.condition)}>
                  {billing.condition}
                </span>
              ) : null}
            </div>
            {billing.summary.lead ? <p className="df-billing-lead">{billing.summary.lead}</p> : null}
          </div>
          <div className="df-billing-seats">
            <div className="df-billing-seats-row">
              <span className="df-billing-label">Billable Seats</span>
              <span className="df-billing-seats-count">{billing.summary.seats.label}</span>
            </div>
            <Progress
              value={billing.summary.seats.percent}
              className="df-billing-meter"
              data-tone={billing.summary.seats.over ? "over" : "within"}
              aria-label="Billable Seats used"
            />
          </div>
          <div className="df-billing-facts">
            <div className="df-billing-fact">
              {billing.summary.writes.allowed ? (
                <PenLine size={16} strokeWidth={1.5} className="df-billing-fact-icon" data-tone="allowed" aria-hidden="true" />
              ) : (
                <Lock size={16} strokeWidth={1.5} className="df-billing-fact-icon" data-tone="blocked" aria-hidden="true" />
              )}
              <span className="df-billing-fact-text">{billing.summary.writes.label}</span>
            </div>
            <div className="df-billing-fact">
              <CalendarDays size={16} strokeWidth={1.5} className="df-billing-fact-icon" aria-hidden="true" />
              <span className="df-billing-label">{billing.summary.term.label}</span>
              <span className="df-billing-term-value">{billing.summary.term.value}</span>
            </div>
          </div>
        </div>
      ) : null}

      {entitlements && (has("checkout") || has("plan")) ? (
        <PlanPicker
          entitlements={entitlements}
          mode={has("plan") ? "change" : "checkout"}
          plan={planChoice}
          interval={intervalChoice}
          prices={prices}
          seats={checkoutSeatText}
          seatFloor={billing.seatFloor}
          onPlan={setChosenPlan}
          onInterval={setChosenInterval}
          onSeats={setCheckoutSeats}
          pending={startCheckout.isPending || changePlan.isPending}
          // Checkout is how a Read-only Workspace recovers, so it is not a
          // write the Read-only guard stops.
          onCheckout={() => startCheckout.mutate()}
          onChange={() => {
            if (!writes.guard()) return;
            changePlan.mutate();
          }}
        />
      ) : null}

      {has("seats") ? (
        <div className="df-admin-seat-form" data-testid="v2-administration-seats">
          <form className="df-admin-form df-inline-form" onSubmit={(event) => event.preventDefault()}>
            <label className="df-daily-field">
              Seats
              <Input
                type="text"
                inputMode="numeric"
                value={seatValue}
                aria-label="Seats"
                aria-invalid={seatIssue ? true : undefined}
                aria-describedby="df-seat-floor"
                onChange={(event) => setSeatText(event.target.value)}
              />
            </label>
            {/* A change asks first: an increase is charged at once, a decrease waits for the period's end (F104). */}
            <DestructiveConfirm
              tone="neutral"
              label={changeSeats.isPending ? "Changing…" : "Change seats"}
              title={seatConfirmation.title}
              consequence={seatConfirmation.consequence}
              confirmLabel={seatConfirmation.confirmLabel}
              keepLabel={`Keep ${current} ${current === 1 ? "seat" : "seats"}`}
              pending={changeSeats.isPending}
              disabled={seatIssue !== null || seatTarget === current}
              testId="v2-administration-seats-change"
              onConfirm={() => {
                if (!writes.guard()) return;
                changeSeats.mutate(seatTarget);
              }}
            />
          </form>
          <p id="df-seat-floor" className={seatIssue ? "df-form-note df-refusal-inline" : "df-form-note"} role={seatIssue ? "alert" : undefined}>
            {seatIssue ?? seatFloorNote(billing.seatFloor)}
          </p>
          {billing.pendingSeats ? (
            <div className="df-billing-pending" data-testid="v2-administration-seats-pending">
              <span className="df-row-title">{billing.pendingSeats.label}</span>
              <Button
                type="button"
                variant="outline"
                className="df-btn"
                disabled={changeSeats.isPending}
                onClick={() => {
                  if (!writes.guard()) return;
                  changeSeats.mutate(billing.pendingSeats!.quantity);
                }}
              >
                {billing.pendingSeats.keepLabel}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {has("payment-method") ? (
        <div className="df-billing-actions">
          <Button variant="outline" type="button" disabled={updatePaymentMethod.isPending} onClick={() => updatePaymentMethod.mutate()} className="df-btn">
            Update payment method
          </Button>
        </div>
      ) : null}

      {/* A cancelling Subscription can be kept until its last day (F102). */}
      {keep ? (
        <div className="df-billing-keep" data-testid="v2-administration-billing-keep">
          <span className="df-row-title">{keep.consequence}</span>
          <Button
            type="button"
            variant="outline"
            className="df-btn"
            disabled={keepSubscription.isPending}
            onClick={() => {
              if (!writes.guard()) return;
              keepSubscription.mutate();
            }}
          >
            {keepSubscription.isPending ? "Keeping…" : keep.label}
          </Button>
        </div>
      ) : null}

      {/* The one action that ends the Subscription sits apart from the
          routine ones, with its cost stated before it runs (#245 F1). */}
      {cancel ? (
        <div className="df-danger-row" data-testid="v2-administration-billing-cancel-row">
          <div className="df-danger-copy">
            <span className="df-row-title">{cancel.label}</span>
            <span className="df-meta">{cancel.consequence}</span>
          </div>
          <DestructiveConfirm
            icon={Ban}
            label={cancel.label}
            title={cancel.label}
            consequence={cancel.consequence ?? ""}
            confirmLabel={cancelAtPeriodEnd.isPending ? "Cancelling…" : cancel.label}
            keepLabel="Keep subscription"
            pending={cancelAtPeriodEnd.isPending}
            testId="v2-administration-billing-cancel"
            onConfirm={() => {
              if (!writes.guard()) return;
              cancelAtPeriodEnd.mutate();
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The Plans a Workspace can buy or move to (#299), each with its price per seat
 * when Stripe gives one (F103). Checkout opens Stripe for the seats chosen here;
 * a change to a live Subscription asks first, because a lower Plan leaves areas
 * read-only and Stripe prorates the difference.
 */
function PlanPicker({
  entitlements,
  mode,
  plan,
  interval,
  prices,
  seats,
  seatFloor,
  onPlan,
  onInterval,
  onSeats,
  pending,
  onCheckout,
  onChange,
}: {
  entitlements: Entitlements;
  mode: "checkout" | "change";
  plan: PricedPlanKey;
  interval: BillingInterval;
  prices: BillingPrice[];
  seats: string;
  seatFloor: number;
  onPlan: (plan: PricedPlanKey) => void;
  onInterval: (interval: BillingInterval) => void;
  onSeats: (seats: string) => void;
  pending: boolean;
  onCheckout: () => void;
  onChange: () => void;
}) {
  const plans = pricedPlans(entitlements);
  const intentNote = planIntentNote(entitlements);
  const chosen = plans.find((row) => row.planKey === plan);
  const chosenPrice = planPrice(prices, plan, interval);
  const seatIssue = mode === "checkout" ? seatQuantityIssue(seats, seatFloor) : null;
  const unchanged =
    mode === "change" && plan === entitlements.planKey && interval === entitlements.billingInterval;
  const lost = chosen
    ? (Object.keys(entitlements.features) as (keyof Entitlements["features"])[]).filter(
        (feature) => entitlements.features[feature] && !chosen.features[feature],
      )
    : [];
  const consequence =
    lost.length > 0
      ? `${chosen?.label} leaves out ${lost.map((feature) => FEATURE_LABEL[feature]).join(", ")}. What is already there stays visible but read-only. Stripe prorates the difference on the next invoice.`
      : "Stripe prorates the difference on the next invoice.";

  return (
    <>
      <p className="df-admin-billing-note" data-testid="v2-administration-plans-note">
        {planPickerNote(mode, entitlements.planLabel)}
      </p>
      {intentNote ? (
        <p className="df-admin-billing-note" data-testid="v2-administration-plan-intent">
          {intentNote}
        </p>
      ) : null}
      <div className="df-plan-grid" data-testid="v2-administration-plans">
        {plans.map((row) => {
          const current = row.planKey === entitlements.planKey;
          const selected = row.planKey === plan;
          const price = planPrice(prices, row.planKey, interval);
          return (
            <div
              key={row.planKey}
              className="df-plan-card"
              data-current={current ? "true" : "false"}
              data-testid={`v2-administration-plan-${row.planKey}`}
            >
              <div className="df-plan-card-head">
                <span className="df-row-title">{row.label}</span>
                {current ? <span className="df-status-word" data-tone="active">Current Plan</span> : null}
              </div>
              {price ? <p className="df-plan-card-price" data-testid={`v2-administration-plan-price-${row.planKey}`}>{seatPriceLine(price)}</p> : null}
              <p className="df-plan-card-includes">{planIncludes(row)}</p>
              <Button
                type="button"
                variant={selected ? "default" : "outline"}
                size="sm"
                className="df-btn"
                aria-pressed={selected}
                onClick={() => onPlan(row.planKey as PricedPlanKey)}
              >
                {selected ? "Selected" : `Select ${row.label}`}
              </Button>
            </div>
          );
        })}
      </div>
      <div className="df-plan-controls">
        <V2FilterSelect
          label="Billing"
          ariaLabel="Billing interval"
          value={interval}
          onChange={(next) => onInterval(next as BillingInterval)}
          options={(Object.keys(BILLING_INTERVAL_LABEL) as BillingInterval[]).map((value) => ({
            value,
            label: BILLING_INTERVAL_LABEL[value],
          }))}
          testId="v2-administration-plan-interval"
        />
        {mode === "checkout" ? (
          <>
            <label className="df-daily-field df-plan-seats">
              Seats
              <Input
                type="text"
                inputMode="numeric"
                value={seats}
                aria-label="Seats to buy"
                aria-invalid={seatIssue ? true : undefined}
                aria-describedby="df-checkout-seat-floor"
                onChange={(event) => onSeats(event.target.value)}
                data-testid="v2-administration-plan-seats"
              />
            </label>
            <Button
              type="button"
              className="df-btn"
              disabled={pending || seatIssue !== null}
              onClick={onCheckout}
              data-testid="v2-administration-plan-checkout"
            >
              {pending ? "Opening Checkout…" : "Continue to Checkout"}
            </Button>
          </>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" className="df-btn" disabled={pending || unchanged}>
                {unchanged ? "Current Plan" : `Change to ${chosen?.label ?? "this Plan"}`}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="df-v2 df-alert">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Change to {chosen?.label}, billed {BILLING_INTERVAL_LABEL[interval].toLowerCase()}
                </AlertDialogTitle>
                <AlertDialogDescription>{consequence}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="df-btn" autoFocus>
                  Keep {entitlements.planLabel}
                </AlertDialogCancel>
                <AlertDialogAction
                  className={lost.length > 0 ? "df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90" : "df-btn"}
                  disabled={pending}
                  data-testid="v2-administration-plan-confirm"
                  onClick={onChange}
                >
                  {pending ? "Changing…" : `Change to ${chosen?.label}`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {mode === "checkout" ? (
        <div className="df-plan-total">
          <p id="df-checkout-seat-floor" className={seatIssue ? "df-form-note df-refusal-inline" : "df-form-note"} role={seatIssue ? "alert" : undefined}>
            {seatIssue ?? seatFloorNote(seatFloor)}
          </p>
          {chosenPrice && seatIssue === null ? (
            <p className="df-plan-total-line" data-testid="v2-administration-plan-total">
              {checkoutTotalLine(chosenPrice, Number(seats))}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
