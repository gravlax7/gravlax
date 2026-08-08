export function Toggle(props: {
  on: boolean
  onChange: (on: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      class={`toggle${props.on ? ' toggle-on' : ''}`}
      aria-checked={props.on}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => {
        if (props.disabled) return
        props.onChange(!props.on)
      }}
    >
      <span class="toggle-thumb" />
    </button>
  )
}
