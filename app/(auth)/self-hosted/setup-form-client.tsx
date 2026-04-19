"use client"
import { useState, useRef, useEffect, useCallback } from "react"
import { FormSelectCurrency } from "@/components/forms/select-currency"
import { FormInput } from "@/components/forms/simple"
import { Button } from "@/components/ui/button"
import { DEFAULT_CURRENCIES, DEFAULT_SETTINGS } from "@/models/defaults"
import { selfHostedGetStartedAction } from "../actions"
import { FormSelect } from "@/components/forms/simple"
import { PROVIDERS } from "@/lib/llm-providers"

type Props = {
  defaultProvider: string
  defaultProviderValues: Record<string, { apiKey: string; model: string; baseUrl: string; backend?: string }>
}

export default function SelfHostedSetupFormClient({ defaultProvider, defaultProviderValues }: Props) {
  const [provider, setProvider] = useState(defaultProvider)
  const selected = PROVIDERS.find(p => p.key === provider)!
  const getDefaultValues = useCallback(
    (providerKey: string) => defaultProviderValues[providerKey] ?? { apiKey: "", model: "", baseUrl: "", backend: "" },
    [defaultProviderValues]
  )

  const [apiKey, setApiKey] = useState(getDefaultValues(provider).apiKey)
  const [model, setModel] = useState(getDefaultValues(provider).model || selected.defaultModelName)
  const [baseUrl, setBaseUrl] = useState(getDefaultValues(provider).baseUrl)
  const [backend, setBackend] = useState(getDefaultValues(provider).backend || selected.defaultBackend || "")
  const userTyped = useRef(false)

  useEffect(() => {
    if (!userTyped.current) {
      const defaults = getDefaultValues(provider)
      setApiKey(defaults.apiKey)
      setModel(defaults.model || selected.defaultModelName)
      setBaseUrl(defaults.baseUrl)
      setBackend(defaults.backend || selected.defaultBackend || "")
    }
    userTyped.current = false
  }, [provider, getDefaultValues, selected.defaultBackend, selected.defaultModelName])

  const selectedBackend = selected.backendOptions?.find(option => option.value === backend)

  return (
    <form action={selfHostedGetStartedAction} className="flex flex-col gap-8 pt-8">
      <div className="flex flex-row gap-4 items-center justify-center">
        <FormSelect
          title="LLM provider"
          name="provider"
          value={provider}
          onValueChange={setProvider}
          items={PROVIDERS.map(p => ({
            code: p.key,
            name: p.label,
            logo: p.logo
          }))}
        />
        <FormSelectCurrency
          title="Default Currency"
          name="default_currency"
          defaultValue={DEFAULT_SETTINGS.find((s) => s.code === "default_currency")?.value ?? "EUR"}
          currencies={DEFAULT_CURRENCIES}
        />
      </div>
      <div>
        <div className="flex flex-col gap-4">
          {selected.backendName && selected.backendOptions && (
            <FormSelect
              title={`${selected.label} ${selected.backendLabel || "Backend"}`}
              name={selected.backendName}
              value={backend}
              onValueChange={(value) => {
                setBackend(value)
                if (selected.key === "local") {
                  const matchingOption = selected.backendOptions?.find(option => option.value === value)
                  if (matchingOption?.baseUrlPlaceholder && !userTyped.current) {
                    setBaseUrl(matchingOption.baseUrlPlaceholder)
                  }
                }
                userTyped.current = true
              }}
              items={selected.backendOptions.map(option => ({
                code: option.value,
                name: option.label,
              }))}
            />
          )}
          {selected.apiKeyName && (
            <>
              <FormInput
                title={`${selected.label} ${selected.apiKeyLabel || "API Key"}`}
                name={selected.apiKeyName}
                value={apiKey ?? ""}
                onChange={e => {
                  setApiKey(e.target.value)
                  userTyped.current = true
                }}
                placeholder={selectedBackend?.apiKeyPlaceholder || selected.placeholder}
              />
              <small className="text-xs text-muted-foreground flex justify-center mt-2">
                {selected.key === "local" ? "Use a placeholder for LM Studio if your server expects one." : "Get key from "}
                {selected.key !== "local" && (
                  <>
                    {"\u00A0"}
                    <a href={selected.help.url} target="_blank" className="underline">
                      {selected.help.label}
                    </a>
                  </>
                )}
              </small>
            </>
          )}
          {selected.baseUrlName && (
            <FormInput
              title={`${selected.label} ${selected.baseUrlLabel || "Base URL"}`}
              name={selected.baseUrlName}
              value={baseUrl ?? ""}
              onChange={e => {
                setBaseUrl(e.target.value)
                userTyped.current = true
              }}
              placeholder={selectedBackend?.baseUrlPlaceholder || selected.baseUrlPlaceholder}
            />
          )}
          <FormInput
            title={`${selected.label} Model`}
            name={selected.modelName}
            value={model}
            onChange={e => {
              setModel(e.target.value)
              userTyped.current = true
            }}
            placeholder={selected.defaultModelName}
          />
        </div>
      </div>
      <Button type="submit" className="w-auto p-6">
        Get Started
      </Button>
    </form>
  )
}