import { For, Show, createMemo, createSignal } from 'solid-js'
import type { MetadataSearchResult, MetadataSelection, UploadFlowStateJSON } from '@shared/types'
import { METADATA_PROVIDER_MANUAL } from '@shared/types/upload'
import { ProviderIcon } from '../../../components/ProviderIcon'
import { Badge, Card, Icon, IconButton, Section } from '../../../ui'
import {
  metadataDisplayText,
  providerStatusTone,
  styleMetadataDisplay
} from '../metadataDisplay'

export function MetadataStep(props: {
  state: UploadFlowStateJSON
  onSelect: (selection: MetadataSelection) => void
}) {
  const [expandedProviders, setExpandedProviders] = createSignal<Set<string>>(new Set())

  const manualSelected = () =>
    props.state.metadata.selected?.provider === METADATA_PROVIDER_MANUAL

  const toggleExpanded = (provider: string): void => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  const isSelected = (result: MetadataSearchResult): boolean => {
    const selected = props.state.metadata.selected
    if (!selected) return false
    return (
      selected.provider === result.provider &&
      (selected.releaseId ?? '') === (result.releaseId ?? '') &&
      (selected.url ?? '') === (result.url ?? '')
    )
  }

  return (
    <Section
      title="Metadata"
      description="Choose a release match from a provider or enter metadata manually."
    >
      <Card
        interactive
        selected={manualSelected()}
        onClick={() => props.onSelect({ provider: METADATA_PROVIDER_MANUAL })}
      >
        <div class="metadata-card-row">
          <div class="metadata-card-main">
            <div class="metadata-card-title">Manual</div>
            <div class="metadata-card-desc">Enter tags yourself without a provider match.</div>
          </div>
          <Show when={manualSelected()}>
            <Icon name="check" size={16} class="metadata-check" />
          </Show>
        </div>
      </Card>

      <For
        each={(props.state.metadata.providers ?? []).filter((p) => p.status !== 'inactive')}
      >
        {(provider) => {
          const providerName = () => provider.provider ?? 'Provider'
          const results = () => provider.results ?? []
          const showAll = () => expandedProviders().has(providerName())
          const visibleResults = () =>
            showAll() ? results() : results().slice(0, 3)
          const hiddenCount = () => Math.max(0, results().length - 3)

          return (
            <div class="metadata-provider">
              <div class="metadata-provider-header">
                <span class="metadata-provider-name">
                  <ProviderIcon provider={providerName()} size={18} />
                  <strong>{providerName()}</strong>
                </span>
                <Badge tone={providerStatusTone(provider.status)}>{provider.status}</Badge>
              </div>

              <For each={visibleResults()}>
                {(result) => {
                  const selected = () => isSelected(result)
                  return (
                    <div class="metadata-result-row">
                      <Card
                        interactive
                        selected={selected()}
                        class="metadata-result-card"
                        onClick={() =>
                          props.onSelect({
                            provider: result.provider,
                            releaseId: result.releaseId,
                            url: result.url
                          })
                        }
                      >
                        <div class="metadata-card-row">
                          <div class="metadata-card-main">
                            <MetadataResultDisplay result={result} />
                            <Show when={result.url}>
                              <div class="metadata-result-url mono">{result.url}</div>
                            </Show>
                          </div>
                          <Show when={selected()}>
                            <Icon name="check" size={16} class="metadata-check" />
                          </Show>
                        </div>
                      </Card>
                      <Show when={result.url}>
                        <IconButton
                          icon="external-link"
                          label="Open on provider site"
                          size="sm"
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation()
                            void window.gravlax.shell.openExternal(result.url!)
                          }}
                        />
                      </Show>
                    </div>
                  )
                }}
              </For>

              <Show when={hiddenCount() > 0 && !showAll()}>
                <button
                  type="button"
                  class="metadata-show-all"
                  onClick={() => toggleExpanded(providerName())}
                >
                  Show all {results().length} results
                </button>
              </Show>
              <Show when={showAll() && results().length > 3}>
                <button
                  type="button"
                  class="metadata-show-all"
                  onClick={() => toggleExpanded(providerName())}
                >
                  Show fewer
                </button>
              </Show>
            </div>
          )
        }}
      </For>
    </Section>
  )
}

function MetadataResultDisplay(props: { result: MetadataSearchResult }) {
  const segments = createMemo(() =>
    styleMetadataDisplay(metadataDisplayText(props.result), props.result)
  )

  return (
    <For each={segments()}>
      {(segment) => <span style={{ color: segment.color }}>{segment.text}</span>}
    </For>
  )
}
