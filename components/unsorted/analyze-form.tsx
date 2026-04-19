"use client"

import { useNotification } from "@/app/(app)/context"
import { analyzeFileAction, deleteUnsortedFileAction, saveFileAsTransactionAction } from "@/app/(app)/unsorted/actions"
import { CurrencyConverterTool } from "@/components/agents/currency-converter"
import { ItemsDetectTool } from "@/components/agents/items-detect"
import ToolWindow from "@/components/agents/tool-window"
import { FormError } from "@/components/forms/error"
import { FormSelectCategory } from "@/components/forms/select-category"
import { FormSelectCurrency } from "@/components/forms/select-currency"
import { FormSelectProject } from "@/components/forms/select-project"
import { FormSelectType } from "@/components/forms/select-type"
import { FormInput, FormTextarea } from "@/components/forms/simple"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/utils"
import { Category, Currency, Field, File, Project } from "@/prisma/client"
import { format } from "date-fns"
import { ArrowDownToLine, Brain, Loader2, Trash2 } from "lucide-react"
import { startTransition, useActionState, useEffect, useMemo, useState } from "react"

const MAX_ANALYZE_ATTACHMENTS = 4

function formatElapsed(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function getActiveProviderStats(settings: Record<string, string>) {
  const providerOrder = (settings.llm_providers || "openai,google,mistral,local")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean)

  for (const provider of providerOrder) {
    if (provider === "openai" && settings.openai_api_key && settings.openai_model_name) {
      return {
        providerLabel: "OpenAI",
        model: settings.openai_model_name,
        endpointLabel: "Cloud API",
        reasoningLabel: "Managed by provider",
      }
    }

    if (provider === "google" && settings.google_api_key && settings.google_model_name) {
      return {
        providerLabel: "Google",
        model: settings.google_model_name,
        endpointLabel: "Cloud API",
        reasoningLabel: "Managed by provider",
      }
    }

    if (provider === "mistral" && settings.mistral_api_key && settings.mistral_model_name) {
      return {
        providerLabel: "Mistral",
        model: settings.mistral_model_name,
        endpointLabel: "Cloud API",
        reasoningLabel: "Managed by provider",
      }
    }

    if (provider === "local" && settings.local_llm_base_url && settings.local_llm_model_name) {
      const backend = settings.local_llm_backend || "ollama"
      const backendLabel = backend === "lmstudio" ? "LM Studio" : "Ollama"
      return {
        providerLabel: `Local LLM (${backendLabel})`,
        model: settings.local_llm_model_name,
        endpointLabel: settings.local_llm_base_url,
        reasoningLabel: backend === "lmstudio" ? "Disabled for this request" : "Model default",
      }
    }

    if (provider === "ollama" && settings.ollama_base_url && settings.ollama_model_name) {
      return {
        providerLabel: "Ollama",
        model: settings.ollama_model_name,
        endpointLabel: settings.ollama_base_url,
        reasoningLabel: "Model default",
      }
    }
  }

  return {
    providerLabel: "Not configured",
    model: "Unknown",
    endpointLabel: "No active provider",
    reasoningLabel: "Unknown",
  }
}

export default function AnalyzeForm({
  file,
  categories,
  projects,
  currencies,
  fields,
  settings,
}: {
  file: File
  categories: Category[]
  projects: Project[]
  currencies: Currency[]
  fields: Field[]
  settings: Record<string, string>
}) {
  const { showNotification } = useNotification()
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeStep, setAnalyzeStep] = useState<string>("")
  const [analyzeError, setAnalyzeError] = useState<string>("")
  const [analyzeStartedAt, setAnalyzeStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [lastAnalysisStats, setLastAnalysisStats] = useState<{
    durationMs: number
    populatedFieldCount: number
    status: "success" | "error"
  } | null>(null)
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteUnsortedFileAction, null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  const fieldMap = useMemo(() => {
    return fields.reduce(
      (acc, field) => {
        acc[field.code] = field
        return acc
      },
      {} as Record<string, Field>
    )
  }, [fields])

  const extraFields = useMemo(() => fields.filter((field) => field.isExtra), [fields])
  const initialFormState = useMemo(() => {
    const baseState = {
      name: file.filename,
      merchant: "",
      description: "",
      type: settings.default_type,
      total: 0.0,
      currencyCode: settings.default_currency,
      convertedTotal: 0.0,
      convertedCurrencyCode: settings.default_currency,
      categoryCode: settings.default_category,
      projectCode: settings.default_project,
      issuedAt: "",
      note: "",
      text: "",
      items: [],
    }

    // Add extra fields
    const extraFieldsState = extraFields.reduce(
      (acc, field) => {
        acc[field.code] = ""
        return acc
      },
      {} as Record<string, string>
    )

    // Load cached results if they exist
    const cachedResults = file.cachedParseResult
      ? Object.fromEntries(
          Object.entries(file.cachedParseResult as Record<string, string>).filter(
            ([_, value]) => value !== null && value !== undefined && value !== ""
          )
        )
      : {}

    return {
      ...baseState,
      ...extraFieldsState,
      ...cachedResults,
    }
  }, [file.filename, settings, extraFields, file.cachedParseResult])
  const [formData, setFormData] = useState(initialFormState)
  const exchangeRateDate = useMemo(() => {
    return formData.issuedAt ? new Date(formData.issuedAt) : new Date(file.createdAt)
  }, [file.createdAt, formData.issuedAt])
  const activeProviderStats = useMemo(() => getActiveProviderStats(settings), [settings])
  const fileSize = useMemo(() => {
    return file.metadata && typeof file.metadata === "object" && "size" in file.metadata
      ? Number(file.metadata.size)
      : 0
  }, [file.metadata])
  const analysisScopeStats = useMemo(() => {
    const visibleFieldCount = fields.filter((field) => field.isVisibleInAnalysis).length
    const requiredFieldCount = fields.filter((field) => field.isRequired).length

    return {
      visibleFieldCount,
      requiredFieldCount,
      extraFieldCount: extraFields.length,
      categoryCount: categories.length,
      projectCount: projects.length,
    }
  }, [categories.length, extraFields.length, fields, projects.length])

  useEffect(() => {
    if (!isAnalyzing || !analyzeStartedAt) {
      return
    }

    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - analyzeStartedAt)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [analyzeStartedAt, isAnalyzing])

  async function saveAsTransaction(formData: FormData) {
    setSaveError("")
    setIsSaving(true)
    startTransition(async () => {
      const result = await saveFileAsTransactionAction(null, formData)
      setIsSaving(false)

      if (result.success) {
        showNotification({ code: "global.banner", message: "Saved!", type: "success" })
        showNotification({ code: "sidebar.transactions", message: "new" })
        setTimeout(() => showNotification({ code: "sidebar.transactions", message: "" }), 3000)
      } else {
        setSaveError(result.error ? result.error : "Something went wrong...")
        showNotification({ code: "global.banner", message: "Failed to save", type: "failed" })
      }
    })
  }

  const startAnalyze = async () => {
    const startedAt = Date.now()
    setIsAnalyzing(true)
    setAnalyzeError("")
    setAnalyzeStartedAt(startedAt)
    setElapsedMs(0)
    setLastAnalysisStats(null)
    try {
      setAnalyzeStep("Analyzing...")
      const results = await analyzeFileAction(file, settings, fields, categories, projects)

      console.log("Analysis results:", results)

      if (!results.success) {
        setAnalyzeError(results.error ? results.error : "Something went wrong...")
        setLastAnalysisStats({
          durationMs: Date.now() - startedAt,
          populatedFieldCount: 0,
          status: "error",
        })
      } else {
        const nonEmptyFields = Object.fromEntries(
          Object.entries(results.data?.output || {}).filter(
            ([_, value]) => value !== null && value !== undefined && value !== ""
          )
        )
        setFormData({ ...formData, ...nonEmptyFields })
        setLastAnalysisStats({
          durationMs: Date.now() - startedAt,
          populatedFieldCount: Object.keys(nonEmptyFields).length,
          status: "success",
        })
      }
    } catch (error) {
      console.error("Analysis failed:", error)
      setAnalyzeError(error instanceof Error ? error.message : "Analysis failed")
      setLastAnalysisStats({
        durationMs: Date.now() - startedAt,
        populatedFieldCount: 0,
        status: "error",
      })
    } finally {
      setIsAnalyzing(false)
      setAnalyzeStartedAt(null)
      setElapsedMs(Date.now() - startedAt)
      setAnalyzeStep("")
    }
  }

  return (
    <>
      {file.isSplitted ? (
        <div className="flex justify-end">
          <Badge variant="outline">This file has been split up</Badge>
        </div>
      ) : (
        <Button className="w-full mb-6 py-6 text-lg" onClick={startAnalyze} disabled={isAnalyzing} data-analyze-button>
          {isAnalyzing ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              <span>{analyzeStep}</span>
            </>
          ) : (
            <>
              <Brain className="mr-1 h-4 w-4" />
              <span>Analyze with AI</span>
            </>
          )}
        </Button>
      )}

      {(isAnalyzing || lastAnalysisStats) && (
        <div className="mb-6 rounded-xl border border-border/60 bg-muted/30 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Analysis stats</span>
              <Badge variant="outline">{isAnalyzing ? "Running" : lastAnalysisStats?.status === "success" ? "Completed" : "Failed"}</Badge>
            </div>
            <span className="text-sm text-muted-foreground">
              {isAnalyzing ? `Elapsed ${formatElapsed(elapsedMs)}` : lastAnalysisStats ? `Last run ${formatElapsed(lastAnalysisStats.durationMs)}` : ""}
            </span>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg bg-background/70 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Provider</div>
              <div className="mt-1 font-medium">{activeProviderStats.providerLabel}</div>
              <div className="mt-1 break-all text-xs text-muted-foreground">{activeProviderStats.endpointLabel}</div>
            </div>

            <div className="rounded-lg bg-background/70 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Model</div>
              <div className="mt-1 break-all font-medium">{activeProviderStats.model}</div>
              <div className="mt-1 text-xs text-muted-foreground">Reasoning: {activeProviderStats.reasoningLabel}</div>
            </div>

            <div className="rounded-lg bg-background/70 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">File</div>
              <div className="mt-1 font-medium">{file.mimetype}</div>
              <div className="mt-1 text-xs text-muted-foreground">{formatBytes(fileSize)}</div>
            </div>

            <div className="rounded-lg bg-background/70 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Extraction scope</div>
              <div className="mt-1 font-medium">{analysisScopeStats.visibleFieldCount} visible fields</div>
              <div className="mt-1 text-xs text-muted-foreground">{analysisScopeStats.requiredFieldCount} required, {analysisScopeStats.extraFieldCount} custom</div>
            </div>

            <div className="rounded-lg bg-background/70 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Reference data</div>
              <div className="mt-1 font-medium">{analysisScopeStats.categoryCount} categories</div>
              <div className="mt-1 text-xs text-muted-foreground">{analysisScopeStats.projectCount} projects available</div>
            </div>

            <div className="rounded-lg bg-background/70 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Attachment budget</div>
              <div className="mt-1 font-medium">Up to {MAX_ANALYZE_ATTACHMENTS} preview pages</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {lastAnalysisStats?.status === "success"
                  ? `${lastAnalysisStats.populatedFieldCount} fields filled in the last run`
                  : "Preview images are sent to the model"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div>{analyzeError && <FormError>{analyzeError}</FormError>}</div>

      <form className="space-y-4" action={saveAsTransaction}>
        <input type="hidden" name="fileId" value={file.id} />
        <FormInput
          title={fieldMap.name.name}
          name="name"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          required={fieldMap.name.isRequired}
        />

        <FormInput
          title={fieldMap.merchant.name}
          name="merchant"
          value={formData.merchant}
          onChange={(e) => setFormData((prev) => ({ ...prev, merchant: e.target.value }))}
          hideIfEmpty={!fieldMap.merchant.isVisibleInAnalysis}
          required={fieldMap.merchant.isRequired}
        />

        <FormInput
          title={fieldMap.description.name}
          name="description"
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
          hideIfEmpty={!fieldMap.description.isVisibleInAnalysis}
          required={fieldMap.description.isRequired}
        />

        <div className="flex flex-wrap gap-4">
          <FormInput
            title={fieldMap.total.name}
            name="total"
            type="number"
            step="0.01"
            value={formData.total || ""}
            onChange={(e) => {
              const newValue = parseFloat(e.target.value || "0")
              !isNaN(newValue) && setFormData((prev) => ({ ...prev, total: newValue }))
            }}
            className="w-32"
            required={fieldMap.total.isRequired}
          />

          <FormSelectCurrency
            title={fieldMap.currencyCode.name}
            currencies={currencies}
            name="currencyCode"
            value={formData.currencyCode}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, currencyCode: value }))}
            hideIfEmpty={!fieldMap.currencyCode.isVisibleInAnalysis}
            required={fieldMap.currencyCode.isRequired}
          />

          <FormSelectType
            title={fieldMap.type.name}
            name="type"
            value={formData.type}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, type: value }))}
            hideIfEmpty={!fieldMap.type.isVisibleInAnalysis}
            required={fieldMap.type.isRequired}
          />
        </div>

        {formData.total != 0 && formData.currencyCode && formData.currencyCode !== settings.default_currency && (
          <ToolWindow title={`Exchange rate on ${format(exchangeRateDate, "LLLL dd, yyyy")}`}>
            <CurrencyConverterTool
              originalTotal={formData.total}
              originalCurrencyCode={formData.currencyCode}
              targetCurrencyCode={settings.default_currency}
              date={exchangeRateDate}
              onChange={(value) => setFormData((prev) => ({ ...prev, convertedTotal: value }))}
            />
            <input type="hidden" name="convertedCurrencyCode" value={settings.default_currency} />
          </ToolWindow>
        )}

        <div className="flex flex-row gap-4">
          <FormInput
            title={fieldMap.issuedAt.name}
            type="date"
            name="issuedAt"
            value={formData.issuedAt}
            onChange={(e) => setFormData((prev) => ({ ...prev, issuedAt: e.target.value }))}
            hideIfEmpty={!fieldMap.issuedAt.isVisibleInAnalysis}
            required={fieldMap.issuedAt.isRequired}
          />
        </div>

        <div className="flex flex-row gap-4">
          <FormSelectCategory
            title={fieldMap.categoryCode.name}
            categories={categories}
            name="categoryCode"
            value={formData.categoryCode}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, categoryCode: value }))}
            placeholder="Select Category"
            hideIfEmpty={!fieldMap.categoryCode.isVisibleInAnalysis}
            required={fieldMap.categoryCode.isRequired}
          />

          {projects.length > 0 && (
            <FormSelectProject
              title={fieldMap.projectCode.name}
              projects={projects}
              name="projectCode"
              value={formData.projectCode}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, projectCode: value }))}
              placeholder="Select Project"
              hideIfEmpty={!fieldMap.projectCode.isVisibleInAnalysis}
              required={fieldMap.projectCode.isRequired}
            />
          )}
        </div>

        <FormInput
          title={fieldMap.note.name}
          name="note"
          value={formData.note}
          onChange={(e) => setFormData((prev) => ({ ...prev, note: e.target.value }))}
          hideIfEmpty={!fieldMap.note.isVisibleInAnalysis}
          required={fieldMap.note.isRequired}
        />

        {extraFields.map((field) => (
          <FormInput
            key={field.code}
            type="text"
            title={field.name}
            name={field.code}
            value={formData[field.code as keyof typeof formData]}
            onChange={(e) => setFormData((prev) => ({ ...prev, [field.code]: e.target.value }))}
            hideIfEmpty={!field.isVisibleInAnalysis}
            required={field.isRequired}
          />
        ))}

        {formData.items && formData.items.length > 0 && (
          <ToolWindow title="Detected items">
            <ItemsDetectTool file={file} data={formData} />
          </ToolWindow>
        )}

        <div className="hidden">
          <input type="text" name="items" value={JSON.stringify(formData.items)} readOnly />
          <FormTextarea
            title={fieldMap.text.name}
            name="text"
            value={formData.text}
            onChange={(e) => setFormData((prev) => ({ ...prev, text: e.target.value }))}
            hideIfEmpty={!fieldMap.text.isVisibleInAnalysis}
          />
        </div>

        <div className="flex justify-between gap-4 pt-6">
          <Button
            type="button"
            onClick={() => startTransition(() => deleteAction(file.id))}
            variant="destructive"
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4" />
            {isDeleting ? "⏳ Deleting..." : "Delete"}
          </Button>

          <Button type="submit" disabled={isSaving} data-save-button>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <ArrowDownToLine className="h-4 w-4" />
                Save as Transaction
              </>
            )}
          </Button>
        </div>

        <div>
          {deleteState?.error && <FormError>{deleteState.error}</FormError>}
          {saveError && <FormError>{saveError}</FormError>}
        </div>
      </form>
    </>
  )
}
