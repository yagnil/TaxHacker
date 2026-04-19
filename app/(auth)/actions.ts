"use server"

import { createUserDefaults, isDatabaseEmpty } from "@/models/defaults"
import { updateSettings } from "@/models/settings"
import { getOrCreateSelfHostedUser } from "@/models/users"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

export async function selfHostedGetStartedAction(formData: FormData) {
  const user = await getOrCreateSelfHostedUser()

  if (await isDatabaseEmpty(user.id)) {
    await createUserDefaults(user.id)
  }

  const apiKeys = [
    "openai_api_key",
    "google_api_key",
    "mistral_api_key",
    "local_llm_api_key",
  ]

  const otherSettings = [
    "openai_model_name",
    "google_model_name",
    "mistral_model_name",
    "local_llm_backend",
    "local_llm_base_url",
    "local_llm_model_name",
    "ollama_base_url",
    "ollama_model_name",
  ]

  const provider = formData.get("provider") as string | null

  for (const key of apiKeys) {
    const value = formData.get(key)
    if (value) {
      await updateSettings(user.id, key, value as string)
    }
  }

  for (const key of otherSettings) {
    const value = formData.get(key)
    if (value) {
      await updateSettings(user.id, key, value as string)
    }
  }

  if (provider) {
    const providerOrder = [provider, "openai", "google", "mistral", "local"].filter(
      (item, index, items) => items.indexOf(item) === index
    )
    await updateSettings(user.id, "llm_providers", providerOrder.join(","))
  }


  const defaultCurrency = formData.get("default_currency")
  if (defaultCurrency) {
    await updateSettings(user.id, "default_currency", defaultCurrency as string)
  }

  revalidatePath("/dashboard")
  redirect("/dashboard")
}
