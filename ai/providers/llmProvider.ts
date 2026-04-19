import { ChatOpenAI } from "@langchain/openai"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatMistralAI } from "@langchain/mistralai"
import { ChatOllama } from "@langchain/ollama"
import { BaseMessage, HumanMessage } from "@langchain/core/messages"

export type LocalLLMBackend = "ollama" | "lmstudio"
export type LLMProvider = "openai" | "google" | "mistral" | "local" | "ollama"

export interface LLMConfig {
  provider: LLMProvider
  apiKey?: string
  baseUrl?: string
  localBackend?: LocalLLMBackend
  model: string
}

export interface LLMSettings {
  providers: LLMConfig[]
}

export interface LLMRequest {
  prompt: string
  schema?: Record<string, unknown>
  attachments?: any[]
}

export interface LLMResponse {
  output: Record<string, string>
  tokensUsed?: number
  provider: LLMProvider
  error?: string
}

function summarizeRequest(req: LLMRequest) {
  return {
    promptLength: req.prompt.length,
    schemaKeys: Object.keys(req.schema?.properties as Record<string, unknown> | undefined || {}).length,
    attachmentCount: req.attachments?.length || 0,
    attachmentTypes: req.attachments?.map((attachment) => attachment.contentType) || [],
  }
}

function normalizeBaseUrl(config: LLMConfig): string | undefined {
  if (!config.baseUrl) {
    return config.baseUrl
  }

  if (config.provider === "local" && config.localBackend === "lmstudio") {
    return config.baseUrl.endsWith("/v1") ? config.baseUrl : `${config.baseUrl.replace(/\/+$/, "")}/v1`
  }

  return config.baseUrl
}

function extractJsonObjectFromText(text: string): Record<string, string> | null {
  const trimmed = text.trim()

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1])
    } catch {}
  }

  try {
    return JSON.parse(trimmed)
  } catch {}

  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {}
  }

  return null
}

async function requestLLMUnified(config: LLMConfig, req: LLMRequest): Promise<LLMResponse> {
  const startedAt = Date.now()
  const baseUrl = normalizeBaseUrl(config)
  try {
    const temperature = 0
    let model: any
    const shouldUseNativeStructuredOutput = !(config.provider === "local" && config.localBackend === "lmstudio")
    console.info("LLM request start:", {
      provider: config.provider,
      model: config.model,
      localBackend: config.localBackend,
      baseUrl,
      nativeStructuredOutput: shouldUseNativeStructuredOutput,
      ...summarizeRequest(req),
    })

    if (config.provider === "openai") {
      model = new ChatOpenAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: temperature,
      })
    } else if (config.provider === "google") {
      model = new ChatGoogleGenerativeAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: temperature,
      })
    } else if (config.provider === "mistral") {
      model = new ChatMistralAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: temperature,
      })
    } else if (config.provider === "local") {
      if (config.localBackend === "lmstudio") {
        model = new ChatOpenAI({
          apiKey: config.apiKey || "lm-studio",
          model: config.model,
          temperature: temperature,
          modelKwargs: {
            reasoning_effort: "none",
          },
          configuration: {
            baseURL: baseUrl,
          },
        })
      } else {
        model = new ChatOllama({
          baseUrl,
          model: config.model,
          temperature: temperature,
        })
      }
    } else if (config.provider === "ollama") {
      model = new ChatOllama({
        baseUrl,
        model: config.model,
        temperature: temperature,
      })
    } else {
      return {
        output: {},
        provider: config.provider,
        error: "Unknown provider",
      }
    }

    let message_content: any = req.attachments && req.attachments.length > 0
      ? [{ type: "text", text: req.prompt }]
      : req.prompt

    if (req.attachments && req.attachments.length > 0) {
      const images = req.attachments.map((att) => ({
        type: "image_url",
        image_url: {
          url: `data:${att.contentType};base64,${att.base64}`,
        },
      }))
      message_content.push(...images)
    }
    const messages: BaseMessage[] = [new HumanMessage({ content: message_content })]

    if (!shouldUseNativeStructuredOutput) {
      const response = await model.invoke(messages)
      const responseText = Array.isArray(response.content)
        ? response.content
            .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
            .join("\n")
        : String(response.content || "")
      const parsed = extractJsonObjectFromText(responseText)

      if (!parsed) {
        console.error("LLM request invalid JSON:", {
          provider: config.provider,
          model: config.model,
          durationMs: Date.now() - startedAt,
          responseExcerpt: responseText.slice(0, 300),
        })
        return {
          output: {},
          provider: config.provider,
          error: `Local model did not return valid JSON. Response excerpt: ${responseText.slice(0, 300)}`,
        }
      }

      console.info("LLM request success:", {
        provider: config.provider,
        model: config.model,
        durationMs: Date.now() - startedAt,
        outputKeys: Object.keys(parsed),
      })

      return {
        output: parsed,
        provider: config.provider,
      }
    }

    const structuredModel = model.withStructuredOutput(req.schema, { name: "transaction" })
    const response = await structuredModel.invoke(messages)

    console.info("LLM request success:", {
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - startedAt,
      outputKeys: Object.keys(response || {}),
    })

    return {
      output: response,
      provider: config.provider,
    }
  } catch (error: any) {
    console.error("LLM request failed:", {
      provider: config.provider,
      model: config.model,
      localBackend: config.localBackend,
      baseUrl,
      durationMs: Date.now() - startedAt,
      errorName: error?.name,
      errorMessage: error instanceof Error ? error.message : `${config.provider} request failed`,
      errorStatus: error?.status,
      errorCode: error?.code,
      errorCauseMessage: error?.cause?.message,
    })
    return {
      output: {},
      provider: config.provider,
      error: error instanceof Error ? error.message : `${config.provider} request failed`,
    }
  }
}

export async function requestLLM(settings: LLMSettings, req: LLMRequest): Promise<LLMResponse> {
  for (const config of settings.providers) {
    const hasRequiredCredentials =
      config.provider === "ollama" || config.provider === "local"
        ? Boolean(config.baseUrl && config.model)
        : Boolean(config.apiKey && config.model)

    if (!hasRequiredCredentials) {
      console.info("Skipping provider:", config.provider)
      continue
    }
    console.info("Use provider:", config.provider)

    const response = await requestLLMUnified(config, req)

    if (!response.error) {
      return response
    } else {
      console.error(response.error)
    }
  }

  return {
    output: {},
    provider: settings.providers[0]?.provider || "openai",
    error: "All LLM providers failed or are not configured",
  }
}
