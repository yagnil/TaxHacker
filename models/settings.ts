import { prisma } from "@/lib/db"
import { getProviderByKey } from "@/lib/llm-providers"
import { cache } from "react"
import { LLMProvider } from "@/ai/providers/llmProvider"

export type SettingsMap = Record<string, string>

/**
 * Helper to extract LLM provider settings from SettingsMap.
 */
export function getLLMSettings(settings: SettingsMap) {
  const priorities = (settings.llm_providers || "openai,google,mistral,ollama")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean)

  const providers = priorities
    .map((providerKey) => {
      const providerDefinition = getProviderByKey(providerKey)
      if (!providerDefinition) {
        return null
      }

      return {
        provider: providerKey as LLMProvider,
        apiKey: providerDefinition.apiKeyName ? settings[providerDefinition.apiKeyName] || "" : "",
        baseUrl: providerDefinition.baseUrlName
          ? settings[providerDefinition.baseUrlName] || providerDefinition.baseUrlPlaceholder || ""
          : undefined,
        model: settings[providerDefinition.modelName] || providerDefinition.defaultModelName,
      }
    })
    .filter((provider): provider is NonNullable<typeof provider> => provider !== null)

  return {
    providers,
  }
}

export const getSettings = cache(async (userId: string): Promise<SettingsMap> => {
  const settings = await prisma.setting.findMany({
    where: { userId },
  })

  return settings.reduce((acc, setting) => {
    acc[setting.code] = setting.value || ""
    return acc
  }, {} as SettingsMap)
})

export const updateSettings = cache(async (userId: string, code: string, value: string | undefined) => {
  return await prisma.setting.upsert({
    where: { userId_code: { code, userId } },
    update: { value },
    create: {
      code,
      value,
      name: code,
      userId,
    },
  })
})
