import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  HealthResult,
  NotifyPayload,
  UploadFlowStateJSON,
  UploadStartEntries,
  UploadStartResumeEntry,
  UploadedReleaseRecord,
  UpdateCheckResult
} from '@shared/types'
import { totalUploads } from '@shared/types'
import type { Config } from '@shared/types/config'
import type { UploadStats } from '@shared/types/stats'
import { activeBackgroundTasks, UPLOAD_STEPS } from '@shared/upload/stepGating'
import { StatusBar, summarizeHealth } from './components/StatusBar'
import { TaskWidget } from './components/TaskWidget'
import { ToastStack, type ToastItem } from './components/Toast'
import { UploadScreen } from './screens/upload/UploadScreen'
import { UploadStartMenu, UploadedSummary } from './screens/upload/UploadStartMenu'
import { SettingsScreen } from './screens/SettingsScreen'
import { HealthcheckScreen } from './screens/HealthcheckScreen'
import { useTheme } from './theme/useTheme'
import { Icon, type IconName } from './ui'
import gravlaxLogo from './assets/gravlax-logo.svg'

type Screen = 'upload' | 'settings' | 'health'
type UploadView =
  | { kind: 'menu' }
  | { kind: 'flow' }
  | { kind: 'uploaded'; entry: UploadedReleaseRecord }

export default function App() {
  const [screen, setScreen] = createSignal<Screen>('upload')
  const [state, setState] = createSignal<UploadFlowStateJSON | null>(null)
  const [config, setConfig] = createSignal<Config | null>(null)
  const [stats, setStats] = createSignal<UploadStats | null>(null)
  const [health, setHealth] = createSignal<HealthResult | null>(null)
  const [healthLoading, setHealthLoading] = createSignal(false)
  const [toasts, setToasts] = createSignal<ToastItem[]>([])
  const [uploadView, setUploadView] = createSignal<UploadView>({ kind: 'menu' })
  const [startEntries, setStartEntries] = createSignal<UploadStartEntries | null>(null)
  const [startLoading, setStartLoading] = createSignal(false)
  const [update, setUpdate] = createSignal<UpdateCheckResult | null>(null)
  const [updateChecking, setUpdateChecking] = createSignal(false)
  let toastTimers = new Map<number, number>()
  let toastSeq = 0

  const theme = useTheme(() => config()?.appearance.theme ?? 'system')

  const loadStartEntries = async (): Promise<void> => {
    setStartLoading(true)
    try {
      setStartEntries(await window.gravlax.upload.listStartEntries())
    } catch (err) {
      showToast({ level: 'error', message: `Could not load uploads: ${String(err)}` })
    } finally {
      setStartLoading(false)
    }
  }

  const openUploadMenu = (): void => {
    setScreen('upload')
    setUploadView({ kind: 'menu' })
    void loadStartEntries()
  }

  const refreshHealth = async (): Promise<void> => {
    setHealthLoading(true)
    try {
      setHealth(await window.gravlax.health.refresh())
    } finally {
      setHealthLoading(false)
    }
  }

  const checkForUpdates = async (announce = false): Promise<void> => {
    setUpdateChecking(true)
    try {
      const result = await window.gravlax.updates.check()
      setUpdate(result)
      if (announce && result.status === 'available') {
        showToast({
          level: 'info',
          message: `Gravlax v${result.latestVersion} is available. Open Settings to update.`
        })
      }
    } finally {
      setUpdateChecking(false)
    }
  }

  const toggleTheme = async (): Promise<void> => {
    const cfg = config()
    if (!cfg) return
    const nextTheme = theme() === 'dark' ? 'light' : 'dark'
    const next: Config = {
      ...cfg,
      appearance: { ...cfg.appearance, theme: nextTheme }
    }
    const result = await window.gravlax.config.save(next)
    if (result.ok) setConfig(next)
  }

  const onConfigChange = (next: Config): void => {
    const trackersChanged = JSON.stringify(config()?.trackers) !== JSON.stringify(next.trackers)
    setConfig(next)
    if (uploadView().kind === 'menu') void loadStartEntries()
    if (trackersChanged) {
      setHealth(null)
      void refreshHealth()
    }
  }

  const showToast = (payload: NotifyPayload): void => {
    const id = ++toastSeq
    setToasts((prev) => [...prev, { ...payload, id }].slice(-3))
    const duration = payload.durationMs ?? 4000
    if (duration > 0) {
      const timer = window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
        toastTimers.delete(id)
      }, duration)
      toastTimers.set(id, timer)
    }
  }

  const dismissToast = (id: number): void => {
    const timer = toastTimers.get(id)
    if (timer) window.clearTimeout(timer)
    toastTimers.delete(id)
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  onMount(async () => {
    setConfig(await window.gravlax.config.load())
    setStats(await window.gravlax.stats.load())
    setState(await window.gravlax.upload.getState())
    await loadStartEntries()
    void refreshHealth()
    void checkForUpdates(true)
    const offState = window.gravlax.upload.onState(setState)
    const offNotify = window.gravlax.upload.onNotify(showToast)
    const offStats = window.gravlax.stats.onChange(setStats)
    onCleanup(() => {
      offState()
      offNotify()
      offStats()
      for (const timer of toastTimers.values()) window.clearTimeout(timer)
      void window.gravlax.upload.cancel()
    })
  })

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (screen() === 'health') {
        openUploadMenu()
        event.preventDefault()
      } else if (screen() === 'upload' && uploadView().kind !== 'menu') {
        openUploadMenu()
        event.preventDefault()
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  const jumpToTaskStep = (stepId: string): void => {
    setScreen('upload')
    setUploadView({ kind: 'flow' })
    const index = UPLOAD_STEPS.find((step) => step.id === stepId)?.index
    if (index != null) void window.gravlax.upload.setCurrentStep(index)
  }

  const samePath = (a: string, b: string): boolean => {
    const clean = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
    return clean(a) === clean(b)
  }

  const startNew = (path: string): void => {
    setScreen('upload')
    setUploadView({ kind: 'flow' })
    void window.gravlax.upload.startNew(path).catch((err) => {
      showToast({ level: 'error', message: `Could not start upload: ${String(err)}` })
      openUploadMenu()
    })
  }

  const openPath = (path: string): void => {
    const entries = startEntries()
    const resume = entries?.resumeEntries.find((entry) => samePath(entry.sourcePath, path))
    if (resume) {
      void resumeUpload(resume)
      return
    }
    const uploaded = entries?.uploadedEntries.find((entry) => samePath(entry.sourcePath, path))
    if (uploaded) {
      setUploadView({ kind: 'uploaded', entry: uploaded })
      return
    }
    startNew(path)
  }

  const resumeUpload = async (entry: UploadStartResumeEntry): Promise<void> => {
    setStartLoading(true)
    try {
      await window.gravlax.upload.resume(entry.workspacePath)
      setScreen('upload')
      setUploadView({ kind: 'flow' })
    } catch (err) {
      showToast({ level: 'error', message: `Could not resume upload: ${String(err)}` })
      await loadStartEntries()
    } finally {
      setStartLoading(false)
    }
  }

  return (
    <div
      class="app-shell"
      classList={{ 'app-shell-native-titlebar': window.gravlax.platform !== 'darwin' }}
      style={{ display: 'flex', height: '100%', 'flex-direction': 'column' }}
    >
      <Show when={window.gravlax.platform === 'darwin'}>
        <div
          class="app-drag"
          style={{
            height: 'var(--titlebar-height)',
            'flex-shrink': 0,
            'background-color': 'var(--bg-surface)',
            'border-bottom': '1px solid var(--border)'
          }}
        />
      </Show>
      <div style={{ display: 'flex', flex: 1, 'min-height': 0 }}>
        <nav
          class="app-no-drag"
          style={{
            width: 'var(--sidebar-width)',
            'background-color': 'var(--bg-surface)',
            'border-right': '1px solid var(--border)',
            display: 'flex',
            'flex-direction': 'column'
          }}
        >
          <div
            style={{
              display: 'flex',
              flex: 1,
              'min-height': 0,
              'flex-direction': 'column',
              gap: '4px',
              padding: '12px'
            }}
          >
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                'font-family': 'Futura, "Arial Narrow", var(--font-ui)',
                'font-weight': 800,
                'font-stretch': 'condensed',
                'font-size': '18px',
                'letter-spacing': '0.1em',
                'margin-bottom': '12px',
                'padding-left': '8px'
              }}
            >
              <img
                src={gravlaxLogo}
                alt=""
                width={24}
                height={24}
                style={{ display: 'block', transform: 'translateY(-1px)' }}
              />
              GRAVLAX
            </div>
            <NavButton
              active={screen() === 'upload'}
              icon="upload"
              onClick={openUploadMenu}
            >
              Upload
            </NavButton>
            <NavButton
              active={screen() === 'settings'}
              icon="settings"
              onClick={() => setScreen('settings')}
            >
              Settings
            </NavButton>
            <NavButton
              active={screen() === 'health'}
              icon="activity"
              onClick={() => setScreen('health')}
            >
              Healthchecks
            </NavButton>
            <div style={{ flex: 1 }} />
          </div>
          <Show when={state()}>
            {(s) => (
              <TaskWidget
                compact
                tasks={activeBackgroundTasks(s().background.tasks)}
                onJump={jumpToTaskStep}
              />
            )}
          </Show>
        </nav>
        <main
          class="app-no-drag"
          style={{ flex: 1, 'min-width': 0, display: 'flex', 'flex-direction': 'column' }}
        >
          <Show when={screen() === 'upload' && state() && config()}>
            <Show when={uploadView().kind === 'menu'}>
              <UploadStartMenu
                entries={startEntries()}
                loading={startLoading()}
                onRefresh={() => void loadStartEntries()}
                onOpenPath={openPath}
                onResume={(entry) => void resumeUpload(entry)}
                onRestart={(entry) => startNew(entry.sourcePath)}
                onUploaded={(entry) => setUploadView({ kind: 'uploaded', entry })}
              />
            </Show>
            <Show when={uploadView().kind === 'flow'}>
              <UploadScreen
                state={state()!}
                config={config()!}
                health={health()}
                healthLoading={healthLoading()}
                onExit={openUploadMenu}
              />
            </Show>
            <Show when={uploadView().kind === 'uploaded'}>
              <UploadedSummary
                entry={(uploadView() as { kind: 'uploaded'; entry: UploadedReleaseRecord }).entry}
                onBack={openUploadMenu}
              />
            </Show>
          </Show>
          <Show when={screen() === 'settings' && config()}>
            <SettingsScreen
              config={config()!}
              stats={stats()}
              update={update()}
              updateChecking={updateChecking()}
              onChange={onConfigChange}
              onBack={openUploadMenu}
              onNotify={showToast}
              onCheckUpdates={() => void checkForUpdates()}
            />
          </Show>
          <Show when={screen() === 'health'}>
            <HealthcheckScreen
              result={health()}
              loading={healthLoading()}
              onRefresh={() => void refreshHealth()}
            />
          </Show>
        </main>
      </div>
      <StatusBar
        theme={theme()}
        onToggleTheme={() => void toggleTheme()}
        health={summarizeHealth(health(), healthLoading())}
        onOpenHealth={() => setScreen('health')}
        uploadState={state()}
        uploadCount={stats() ? totalUploads(stats()!) : 0}
      />
      <ToastStack items={toasts()} onDismiss={dismissToast} />
    </div>
  )
}

function NavButton(props: {
  active: boolean
  icon: IconName
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onClick}
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        'text-align': 'left',
        border: '1px solid transparent',
        'border-radius': 'var(--radius-sm)',
        padding: '8px 10px',
        background: props.active ? 'var(--accent)' : 'transparent',
        color: props.active ? 'var(--accent-fg)' : 'var(--fg-primary)'
      }}
    >
      <Icon name={props.icon} size={15} />
      {props.children}
    </button>
  )
}
