"use server"

import { ActionState } from "@/lib/actions"
import { updateFile } from "@/models/files"
import { getLLMSettings, getSettings } from "@/models/settings"
import { AnalyzeAttachment } from "./attachments"
import { requestLLM } from "./providers/llmProvider"

export type AnalysisResult = {
  output: Record<string, string>
  tokensUsed: number
}

export async function analyzeTransaction(
  prompt: string,
  schema: Record<string, unknown>,
  attachments: AnalyzeAttachment[],
  fileId: string,
  userId: string
): Promise<ActionState<AnalysisResult>> {
  const startedAt = Date.now()
  const settings = await getSettings(userId)
  const llmSettings = getLLMSettings(settings)

  console.info("Analyze transaction start:", {
    fileId,
    userId,
    providerOrder: llmSettings.providers.map((provider) => ({
      provider: provider.provider,
      model: provider.model,
      localBackend: provider.localBackend,
      baseUrl: provider.baseUrl,
    })),
    promptLength: prompt.length,
    schemaPropertyCount: Object.keys((schema.properties ?? {}) as Record<string, unknown>).length,
    attachmentCount: attachments.length,
    attachmentTypes: attachments.map((attachment) => attachment.contentType),
  })

  try {
    const response = await requestLLM(llmSettings, {
      prompt,
      schema,
      attachments,
    })

    if (response.error) {
      throw new Error(response.error)
    }

    const result = response.output
    const tokensUsed = response.tokensUsed || 0

    console.log("LLM response:", result)
    console.log("LLM tokens used:", tokensUsed)
    console.info("Analyze transaction success:", {
      fileId,
      durationMs: Date.now() - startedAt,
      outputKeys: Object.keys(result),
      tokensUsed,
    })

    await updateFile(fileId, userId, { cachedParseResult: result })

    return {
      success: true,
      data: {
        output: result,
        tokensUsed: tokensUsed,
      },
    }
  } catch (error) {
    console.error("AI Analysis error:", {
      fileId,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "Failed to analyze invoice",
      errorName: error instanceof Error ? error.name : undefined,
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to analyze invoice",
    }
  }
}
