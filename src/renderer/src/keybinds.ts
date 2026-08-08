export function keySymbol(key: string, platform: NodeJS.Platform): string {
  const lower = key.toLowerCase()
  if (lower === 'ctrl') {
    return platform === 'darwin' ? '⌘' : '⌃'
  }
  switch (lower) {
    case 'tab':
      return '⇥'
    case 'backspace':
      return '⌫'
    case 'shift':
      return '⇧'
    case 'alt':
    case 'option':
      return '⌥'
    case 'enter':
    case 'return':
      return '↵'
    case 'up':
      return '↑'
    case 'down':
      return '↓'
    case 'left':
      return '←'
    case 'right':
      return '→'
    case 'esc':
    case 'escape':
      return 'esc'
    default:
      return key
  }
}

export function formatKeybind(keys: string[], platform: NodeJS.Platform): string {
  return keys.map((k) => keySymbol(k, platform)).join('')
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

export function hasPrimaryModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}
