import { For, Show } from 'solid-js'
import type { Release } from '@shared/types'
import {
  applySeparatorArtistAction,
  pendingSeparatorArtists,
  separatorArtistOptions,
  type SeparatorArtistAction
} from '@shared/tags/editor'
import { Button, Card, Icon } from '../../ui'

export function SeparatorArtistBanner(props: {
  release: Release | undefined
  onResolve: (release: Release) => void
}) {
  const pending = () => pendingSeparatorArtists(props.release)

  const resolve = (name: string, action: SeparatorArtistAction): void => {
    props.onResolve(applySeparatorArtistAction(props.release ?? {}, name, action))
  }

  return (
    <Show when={pending().length > 0}>
      <Card class="tags-separator-banner">
        <div class="tags-separator-header">
          <Icon name="info" class="tags-separator-icon" />
          <div>
            <div class="tags-separator-headline">Ambiguous artist names</div>
            <div class="tags-separator-hint">
              We don't know what's in these names. Pick how to read each one.
            </div>
          </div>
        </div>
        <div class="tags-separator-list">
          <For each={pending()}>
            {(name) => (
              <div class="tags-separator-row">
                <span class="mono tags-separator-name">{name}</span>
                <div class="tags-separator-actions">
                  <For each={separatorArtistOptions(name)}>
                    {(option) => (
                      <Button
                        size="sm"
                        variant={option.action === 'keep' ? 'ghost' : 'secondary'}
                        onClick={() => resolve(name, option.action)}
                      >
                        {option.label}
                      </Button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Card>
    </Show>
  )
}
