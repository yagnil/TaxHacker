import { prisma } from "@/lib/db"
import { getProviderByKey } from "@/lib/llm-providers"
import { cache } from "react"
import { LLMProvider, LocalLLMBackend } from "@/ai/providers/llmProvider"

export type SettingsMap = Record<string, string>

function hasUsableProviderSettings(provider: {
  provider: LLMProvider
  apiKey?: string
  baseUrl?: string
  model: string
}) {
  if (provider.provider === "ollama") {
    return Boolean(provider.baseUrl && provider.model)
  }

  if (provider.provider === "local") {
    return Boolean(provider.baseUrl && provider.model)
  }

  return Boolean(provider.apiKey && provider.model)
}

/**
 * Helper to extract LLM provider settings from SettingsMap.
 */
export function getLLMSettings(settings: SettingsMap) {
  const priorities = (settings.llm_providers || "openai,google,mistral,local")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean)

  const providers = priorities
    .map((providerKey) => {
      if (providerKey === "ollama") {
        return {
          provider: "ollama" as LLMProvider,
          apiKey: "",
          baseUrl: settings.ollama_base_url || "http://127.0.0.1:11434",
          model: settings.ollama_model_name || "gemma3:4b",
        }
      }

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
        localBackend: providerDefinition.backendName
          ? ((settings[providerDefinition.backendName] || providerDefinition.defaultBackend) as LocalLLMBackend)
          : undefined,
      }
    })
    .filter((provider): provider is NonNullable<typeof provider> => provider !== null)

  return {
    providers,
  }
}

export function hasConfiguredLLMProvider(settings: SettingsMap) {
  return getLLMSettings(settings).providers.some(hasUsableProviderSettings)
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
