export const PROVIDERS = [
  {
    key: "openai",
    label: "OpenAI",
    apiKeyName: "openai_api_key",
    apiKeyLabel: "API Key",
    modelName: "openai_model_name",
    defaultModelName: "gpt-4o-mini",
    apiDoc: "https://platform.openai.com/settings/organization/api-keys",
    apiDocLabel: "OpenAI Platform Console",
    placeholder: "sk-...",
    help: {
      url: "https://platform.openai.com/settings/organization/api-keys",
      label: "OpenAI Platform Console"
    },
    logo: "/logo/openai.svg"
  },
  {
    key: "google",
    label: "Google",
    apiKeyName: "google_api_key",
    apiKeyLabel: "API Key",
    modelName: "google_model_name",
    defaultModelName: "gemini-2.5-flash",
    apiDoc: "https://aistudio.google.com/apikey",
    apiDocLabel: "Google AI Studio",
    placeholder: "...",
    help: {
      url: "https://aistudio.google.com/apikey",
      label: "Google AI Studio"
    },
    logo: "/logo/google.svg"
  },
  {
    key: "mistral",
    label: "Mistral",
    apiKeyName: "mistral_api_key",
    apiKeyLabel: "API Key",
    modelName: "mistral_model_name",
    defaultModelName: "mistral-medium-latest",
    apiDoc: "https://admin.mistral.ai/organization/api-keys",
    apiDocLabel: "Mistral Admin Console",
    placeholder: "...",
    help: {
      url: "https://admin.mistral.ai/organization/api-keys",
      label: "Mistral Admin Console"
    },
    logo: "/logo/mistral.svg"
  },
  {
    key: "ollama",
    label: "Ollama",
    baseUrlName: "ollama_base_url",
    baseUrlLabel: "Base URL",
    baseUrlPlaceholder: "http://127.0.0.1:11434",
    modelName: "ollama_model_name",
    defaultModelName: "gemma3:4b",
    apiDoc: "https://ollama.com/download",
    apiDocLabel: "Ollama",
    help: {
      url: "https://ollama.com/download",
      label: "Install Ollama"
    },
    logo: "/logo/logo.svg"
  },
]

export type ProviderDefinition = (typeof PROVIDERS)[number]

export function getProviderByKey(key: string) {
  return PROVIDERS.find((provider) => provider.key === key)
}
