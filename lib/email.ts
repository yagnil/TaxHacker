import { NewsletterWelcomeEmail } from "@/components/emails/newsletter-welcome-email"
import { OTPEmail } from "@/components/emails/otp-email"
import React from "react"
import { Resend } from "resend"
import config from "./config"

const resendApiKey = config.email.apiKey.trim()

export const resend = resendApiKey ? new Resend(resendApiKey) : null

export function getResendClient() {
  if (!resend) {
    throw new Error("Resend is not configured. Set RESEND_API_KEY to enable email features.")
  }

  return resend
}

export async function sendOTPCodeEmail({ email, otp }: { email: string; otp: string }) {
  const html = React.createElement(OTPEmail, { otp })

  return await getResendClient().emails.send({
    from: config.email.from,
    to: email,
    subject: "Your TaxHacker verification code",
    react: html,
  })
}

export async function sendNewsletterWelcomeEmail(email: string) {
  const html = React.createElement(NewsletterWelcomeEmail)

  return await getResendClient().emails.send({
    from: config.email.from,
    to: email,
    subject: "Welcome to TaxHacker Newsletter!",
    react: html,
  })
}
