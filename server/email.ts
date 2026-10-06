// Resend email integration for DocuFlow
import { Resend } from 'resend';
import { config } from './config';

/**
 * The Resend client and the address DocuFlow sends from, both from configuration.
 *
 * Throws when `RESEND_API_KEY` is unset: every sender below calls this inside its
 * try block, so an unconfigured deployment reports a failed send rather than
 * failing the request that triggered it.
 */
export function getResendClient(): { client: Resend; fromEmail: string } {
  const { apiKey, fromAddress } = config.email;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set — email is not configured');
  }
  return {
    client: new Resend(apiKey),
    fromEmail: fromAddress
  };
}

// Send project assignment notification email
export async function sendProjectAssignmentEmail(
  toEmail: string, 
  assigneeName: string, 
  projectName: string,
  assignerName: string,
  appUrl: string,
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient();
    
    const result = await client.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `DocuFlow - You've been assigned to "${projectName}"`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">New Project Assignment</h1>
          <p>Hello ${assigneeName},</p>
          <p><strong>${assignerName}</strong> has assigned you to the project:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="margin: 0; color: #0070f3;">${projectName}</h2>
          </div>
          <p>Click the button below to view the project details:</p>
          <p>
            <a href="${appUrl}/crm/project/${projectId}" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              View Project
            </a>
          </p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            This is an automated notification from DocuFlow.
          </p>
        </div>
      `
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send assignment email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

// Send reminder due notification email
export async function sendReminderDueEmail(
  toEmail: string,
  recipientName: string,
  reminderTitle: string,
  reminderNote: string | null,
  projectName: string,
  appUrl: string,
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient();

    const result = await client.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `DocuFlow Reminder - ${reminderTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Reminder Due</h1>
          <p>Hello ${recipientName},</p>
          <p>You have a reminder that is now due:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="margin: 0 0 8px; color: #0070f3;">${reminderTitle}</h2>
            ${reminderNote ? `<p style="margin: 0 0 8px; color: #444;">${reminderNote}</p>` : ''}
            <p style="margin: 0; color: #666; font-size: 14px;">Project: ${projectName}</p>
          </div>
          <p>
            <a href="${appUrl}/crm/project/${projectId}" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              View Project
            </a>
          </p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            This is an automated reminder from DocuFlow.
          </p>
        </div>
      `
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send reminder email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

// Send a 6 PM reminder to submit the daily update
export async function sendDailyUpdateReminderEmail(
  toEmail: string,
  recipientName: string,
  appUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient();

    const result = await client.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: 'Reminder: submit your daily update',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Daily update reminder</h1>
          <p>Hello ${recipientName},</p>
          <p>Before you finish your day, please take a moment to submit your daily update so your team knows what you worked on.</p>
          <p>
            <a href="${appUrl}/daily-update" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              Submit daily update
            </a>
          </p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            This is an automated reminder from DocuFlow.
          </p>
        </div>
      `
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send daily update reminder email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

export async function sendInvitationEmail(input: {
  toEmail: string;
  workspaceName: string;
  workspaceRole: string;
  acceptUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient();
    const result = await client.emails.send({
      from: fromEmail,
      to: input.toEmail,
      subject: `DocuFlow — Invitation to ${input.workspaceName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Invitation</h1>
          <p>You have been invited to join <strong>${input.workspaceName}</strong> as ${input.workspaceRole}.</p>
          <p>This Invitation does not consume a Billable Seat until you accept.</p>
          <p>
            <a href="${input.acceptUrl}" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              Accept Invitation
            </a>
          </p>
        </div>
      `,
    });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send Invitation email";
    console.error("Failed to send Invitation email:", error);
    return { success: false, error: message };
  }
}

/** Text a User or Workspace chose, made safe to place in an email's HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A calendar date in words, read in UTC so every recipient sees the same day. */
export function dateInWords(at: Date): string {
  return at.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function emailButton(href: string, label: string): string {
  return `<a href="${href}" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">${label}</a>`;
}

async function sendBillingEmail(input: {
  toEmail: string;
  subject: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient();
    const result = await client.emails.send({
      from: fromEmail,
      to: input.toEmail,
      subject: input.subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${input.body}
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            You receive this email because you own this Workspace. Billing notices cannot be turned off.
          </p>
        </div>
      `,
    });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send billing email";
    console.error("Failed to send billing email:", error);
    return { success: false, error: message };
  }
}

/** Who a billing email goes to, about which Workspace, and where its links point. */
export type BillingEmailRecipient = {
  toEmail: string;
  recipientName: string;
  workspaceName: string;
  appUrl: string;
};

export type TrialEndingStage = "three-days" | "last-day";

export async function sendWelcomeEmail(
  input: BillingEmailRecipient & { trialEndsAt: Date; trialDays: number }
): Promise<{ success: boolean; error?: string }> {
  const workspaceName = escapeHtml(input.workspaceName);
  return sendBillingEmail({
    toEmail: input.toEmail,
    subject: `DocuFlow — Your Trial of ${input.workspaceName} has started`,
    body: `
      <h1 style="color: #333;">Welcome to DocuFlow</h1>
      <p>Hello ${escapeHtml(input.recipientName)},</p>
      <p>Your ${input.trialDays}-day Trial of <strong>${workspaceName}</strong> runs until <strong>${dateInWords(input.trialEndsAt)}</strong>. It includes the complete product.</p>
      <p>Install the desktop app to track time and capture activity:</p>
      <p>${emailButton(`${input.appUrl}/devices`, "Get the desktop app")}</p>
      <p>Then invite the people you work with:</p>
      <p>${emailButton(`${input.appUrl}/people`, "Invite Members")}</p>
    `,
  });
}

export async function sendTrialEndingEmail(
  input: BillingEmailRecipient & { stage: TrialEndingStage; trialEndsAt: Date }
): Promise<{ success: boolean; error?: string }> {
  const workspaceName = escapeHtml(input.workspaceName);
  return sendBillingEmail({
    toEmail: input.toEmail,
    subject:
      input.stage === "three-days"
        ? `DocuFlow — Your Trial of ${input.workspaceName} ends in 3 days`
        : `DocuFlow — Last day of your Trial of ${input.workspaceName}`,
    body: `
      <h1 style="color: #333;">Your Trial is ending</h1>
      <p>Hello ${escapeHtml(input.recipientName)},</p>
      <p>Your Trial of <strong>${workspaceName}</strong> ends on <strong>${dateInWords(input.trialEndsAt)}</strong>.</p>
      <p>After that, the Workspace becomes read-only: everyone keeps viewing and exporting its data, but nothing new can be recorded or changed until you choose a Plan.</p>
      <p>${emailButton(`${input.appUrl}/administration/billing`, "Choose a Plan")}</p>
    `,
  });
}

export async function sendPaymentFailedEmail(
  input: BillingEmailRecipient & { nextAttemptAt: Date | null }
): Promise<{ success: boolean; error?: string }> {
  const workspaceName = escapeHtml(input.workspaceName);
  const readOnly = `<strong>${workspaceName}</strong> becomes read-only: its data is kept, but nothing new can be recorded or changed.`;
  const outlook = input.nextAttemptAt
    ? `<p>We will try again on <strong>${dateInWords(input.nextAttemptAt)}</strong>. Everyone keeps full access in the meantime.</p>
       <p>If no attempt succeeds, ${readOnly}</p>`
    : `<p>That was the last attempt. ${readOnly}</p>`;
  return sendBillingEmail({
    toEmail: input.toEmail,
    subject: `DocuFlow — Payment failed for ${input.workspaceName}`,
    body: `
      <h1 style="color: #333;">Payment failed</h1>
      <p>Hello ${escapeHtml(input.recipientName)},</p>
      <p>We could not collect the latest payment for <strong>${workspaceName}</strong>.</p>
      ${outlook}
      <p>Update the payment method in Billing:</p>
      <p>${emailButton(`${input.appUrl}/administration/billing`, "Update payment method")}</p>
    `,
  });
}

/** Why the Workspace became read-only, as the state machine and projection record it. */
function readOnlyCause(reason: string, workspaceName: string): string {
  if (reason === "trial_expired") return `Your Trial of <strong>${workspaceName}</strong> has ended.`;
  if (reason === "offer_expired") {
    return `The Plan offered to <strong>${workspaceName}</strong> has ended. Choose a Plan to restore full access.`;
  }
  if (reason === "dunning_exhausted") {
    return `We could not collect payment for <strong>${workspaceName}</strong>.`;
  }
  return `The Subscription for <strong>${workspaceName}</strong> has ended.`;
}

export async function sendReadOnlyEmail(
  input: BillingEmailRecipient & { reason: string }
): Promise<{ success: boolean; error?: string }> {
  const workspaceName = escapeHtml(input.workspaceName);
  return sendBillingEmail({
    toEmail: input.toEmail,
    subject: `DocuFlow — ${input.workspaceName} is now read-only`,
    body: `
      <h1 style="color: #333;">Your Workspace is read-only</h1>
      <p>Hello ${escapeHtml(input.recipientName)},</p>
      <p>${readOnlyCause(input.reason, workspaceName)}</p>
      <p><strong>${workspaceName}</strong> is now read-only. Nothing is deleted: everyone keeps viewing and exporting its data, but nothing new can be recorded or changed.</p>
      <p>To restore full access, choose a Plan in Billing:</p>
      <p>${emailButton(`${input.appUrl}/administration/billing`, "Restore full access")}</p>
    `,
  });
}

async function sendSupportEmail(input: {
  toEmail: string;
  subject: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient();
    const result = await client.emails.send({
      from: fromEmail,
      to: input.toEmail,
      subject: input.subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${input.body}
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            You receive this email because you sent a Support Request to DocuFlow.
          </p>
        </div>
      `,
    });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send support email";
    console.error("Failed to send support email:", error);
    return { success: false, error: message };
  }
}

/** A Platform Staff answer to a Support Request, mailed to the User who sent it. */
export async function sendSupportAnswerEmail(input: {
  toEmail: string;
  recipientName: string;
  answer: string;
}): Promise<{ success: boolean; error?: string }> {
  return sendSupportEmail({
    toEmail: input.toEmail,
    subject: "DocuFlow — An answer to your Support Request",
    body: `
      <h1 style="color: #333;">An answer to your Support Request</h1>
      <p>Hello ${escapeHtml(input.recipientName)},</p>
      <p style="white-space: pre-wrap;">${escapeHtml(input.answer)}</p>
    `,
  });
}

/** Tells the User their Support Request moved, without repeating what it said. */
export async function sendSupportStatusEmail(input: {
  toEmail: string;
  recipientName: string;
  statusLabel: string;
}): Promise<{ success: boolean; error?: string }> {
  return sendSupportEmail({
    toEmail: input.toEmail,
    subject: `DocuFlow — Your Support Request is now ${input.statusLabel}`,
    body: `
      <h1 style="color: #333;">Support Request update</h1>
      <p>Hello ${escapeHtml(input.recipientName)},</p>
      <p>Your Support Request is now <strong>${escapeHtml(input.statusLabel)}</strong>.</p>
    `,
  });
}
