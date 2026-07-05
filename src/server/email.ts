/**
 * Outbound mail, via Resend. Two callers: the sign-in code, and the
 * backup-failure alert. Both are plain text in the house voice —
 * quiet, terse, no marketing.
 *
 * Unconfigured behavior differs by environment on purpose: in
 * development the mail is printed to the server console (so the OTP
 * flow is testable with no key); in production it throws, so a
 * missing key is a loud failure the caller surfaces, never a code
 * that silently goes nowhere.
 */
import "server-only";
import { Resend } from "resend";

export const emailEnabled = !!(
  process.env.RESEND_API_KEY && process.env.RESEND_FROM
);

export async function sendEmail(options: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[email:dev] to=${options.to} subject=${options.subject}\n${options.text}`,
      );
      return;
    }
    throw new Error("email is not configured (RESEND_API_KEY, RESEND_FROM)");
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
  });
  if (error) throw new Error(`resend: ${error.message}`);
}

export async function sendSignInCode(to: string, otp: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Your Snippets code",
    text: [
      `Your sign-in code is ${otp}.`,
      "",
      "It lasts ten minutes. If you didn’t ask for it, ignore this.",
    ].join("\n"),
  });
}
