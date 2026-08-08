export function Spinner(props: { size?: 'sm' | 'md' | 'lg'; class?: string }) {
  const size = () => props.size ?? 'md'
  const sizeClass = () => {
    if (size() === 'sm') return 'ui-spinner-sm'
    if (size() === 'lg') return 'ui-spinner-lg'
    return ''
  }
  return (
    <span
      class={`ui-spinner ${sizeClass()} ${props.class ?? ''}`}
      role="status"
      aria-label="Loading"
    />
  )
}
