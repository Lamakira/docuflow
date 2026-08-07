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

// Send welcome email with credentials to new user
export async function sendWelcomeEmail(
  toEmail: string, 
  firstName: string, 
  password: string,
  appUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient();
    
    const result = await client.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: 'Welcome to DocuFlow - Your Account Credentials',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Welcome to DocuFlow!</h1>
          <p>Hello ${firstName},</p>
          <p>Your account has been created. Here are your login credentials:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Email:</strong> ${toEmail}</p>
            <p style="margin: 5px 0;"><strong>Password:</strong> ${password}</p>
          </div>
          <p>Please log in and change your password as soon as possible for security.</p>
          <p>
            <a href="${appUrl}/auth" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              Log In to DocuFlow
            </a>
          </p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            If you did not request this account, please ignore this email.
          </p>
        </div>
      `
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send welcome email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
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

// Send password reset/update email
export async function sendPasswordUpdateEmail(
  toEmail: string, 
  firstName: string, 
  newPassword: string,
  appUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient();
    
    const result = await client.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: 'DocuFlow - Your Password Has Been Updated',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Password Updated</h1>
          <p>Hello ${firstName},</p>
          <p>Your DocuFlow password has been updated by an administrator. Here are your new credentials:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Email:</strong> ${toEmail}</p>
            <p style="margin: 5px 0;"><strong>New Password:</strong> ${newPassword}</p>
          </div>
          <p>Please log in and change your password as soon as possible for security.</p>
          <p>
            <a href="${appUrl}/auth" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              Log In to DocuFlow
            </a>
          </p>
        </div>
      `
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send password update email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}
