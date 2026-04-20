import Stripe from "stripe"
import config from "./config"

export { PLANS, type Plan } from "./stripe-plans"

export const stripeClient: Stripe | null = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, {
      apiVersion: "2025-03-31.basil",
    })
  : null
