import type { JSX } from 'solid-js'
import redactedIcon from '../assets/trackers/redacted.png'

const thesungodIcon =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAQAAADZc7J/AAADF0lEQVRIx5XVfWgVZBQG8N/dvboxP0IX1KiWm27qTLbpMqlpudk2NcwkJpSiU8pgZE1ihYJFEBoWgk0IDYSUiD5UFBPmRtZqqJjbrq5t0pdobrjNhmal++qPanjVu63n/e/hnOec93y8LwMhIMduXbp86BGB25tER7bN7lEtLCDDLOe84rubjWKiui9yUKVC+4w0wufyHXHIwqFmkKlSsd+956p6AZmGK3GXHR4TNihiVHldjjbL/s0xaKU2M2x0eICs+zHNT+7TYHkE+4I6Sc7JHLwGuY5Kd92uCPYDISlOyB1cINkZU53SG8F2O+0BzZIHF+gVo0fwFj6oRzBS9vYCZ0xRK9OwCDbOVPXSNQ8uUGm6X/xpTQS7VocWGaoMAZ/ZaqpWrxoFRlvvgkm2+8SQkOyc52So1mi/Axp9KV2J8+4f6i7M9JEDtkkwSZ9GnUoVWOL40JdpnH0mqlGvyxQ5vrZK262NuT1ClnpLnK+cNkeRNN0CEtX6YygVyPKNBsuNlWKDBm+YZbzZ9mhSFDVoP1Zot9EohSpd0moymO8lvKjJuoHd12k3T5L9wpbabZOgT40xwlhk2672xum5eZDKlJqrV7WwQgnm69BrvDWuuaTYHtNc1hctepHLsizV4nE56hz0jiMCpvveEcmazDPMvdHcU3V40kItMq12QbE7lLtusxijTVOgXmigV+iwcmlaPazUWZkSnbTXUZ0qxGGVbwcq3lPOSlDjZQVapYt3yiaLHbPDISF8rFtq9Pg1VlvmuLGaLcBmX2Cv9Y55FEv8oM7zor7CP0tUb46VflTifd3eFnLSM8ISPKtFnjdti/Yv5Dphoi7tysTK16nM05YJaDFGhZ0OqXJenhVSImf+vw6EzRVSaYctOkCixXpcMdK7Et2JDql2+tUuG3RFZhCLB6W7aEL/rLe5W69uF5XrFMQ1bLFAvq03X6FPvBTlsvymymvSEO8vXa7q1SeoG9RZq16ufHmR61wg2zhhSVolKFHsCTOFJAiZLdsiww031wQ9HjLZJLEqbqzFDFf0/Y/TKfsfx78BJfMASiXr4rwAAAAASUVORK5CYII='
const imgbbIcon =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAACEFBMVEUjqOAdpt8gp+Adpd8hp+Abpd8iqOAept8cpd8apN9vxuvJ6vej2vItrOEwreJQuuZrxep3yewnqeAoquFKuOVjwel/zO04sOMgp986seP0+/3///+Fz+4apd+g2fHK6vcfpt9pxOr8/v72+/43sOMfp989suT4/P6K0O4ZpN/Q7PiV1fCa1/HL6vh4yezR7fis3vMxreLw+f1nw+rG6PcYpN8ip+AlqeAqq+Favej1+/48suMmqeAxruLp9vxrxOrd8vrd8fqY1vDu+P275PXm9fvU7vlmwun9/v/g8/vf8vqN0u8pquHg8/qHz+6z4fT0+v3k9PsXo956yuz7/f7T7vllwulDteVYvefb8fqL0e8Rod1NueYSod6o3fPB5/ZqxOrv+f1BtOT3/P5ZveiGz+7S7fmQ0++u3/O/5vaX1vDP7Phnw+kfp+Dc8fqEzu3x+v2q3fPD5/al2/KU1fA0r+Lt+PxUu+f1+/0+s+TB5vYvreLn9fvA5vak2/L+///7/v+Ezu7X7/l9zO1NuOb8/v9Ouebq9vx0yOun3PLR7fm24vVuxuvu+PwurOETod6M0e9VvOcOoN1zyOuO0u8Nn90rq+HW7/mr3vNsxeqb1/Gi2vL6/f7i9Pu+5fbN6/jl9fsfpuA/s+Tz+v1fwOi85PV+zO2e2PFFteUvrOLM6/ix4PR5yuzC5/bO6/iCze3c6yXhAAAB4klEQVQ4y92SZ1cTURCGd+O9WwCDGFHDk8AKibjYIMYISrHEAmKvUUQNoliigtiwF7D3ir1gb3/R7MYYPYdfwHyaO/PcmXfmjKKMHFM9o4SiCFXKzFvTDVP8k9fz8gtGC+EtHFM0VnPyvnHF4yfkiIn+EgiYwVIos5yAnFRORcjzFwhProQptlYFU20nYE+D6f+1mDGzukYPRWCW6bQIR6F0diwHzFFq0wrrYO48X72qiIZGaBK1hpYtUDB/wULDDsCi+OIlS1W9cBnl8eaW5X+6aK0rYKUtV8Hq6Boi/rXrYH3VBthouIC1Ka1xs/QlYMvWtkrytrXDdtmaoN10AbkDdoaMZAfskr5mOs3dsMe2u9iru4C9D/Zr8oCDpXwHOeQ9DMVGsDsL6D1wxLR7Hcxz9BhNx+HEybDeR3fQyYtTp6HIVM/AWdOoO3c+eQEu1ntqGrnkatAv99M/IBuuwNWgfY3r6g2olvZNKpJWVuOt23fuAvfuD5TwQKYHfPjo8ROeZqaUg+mpnz2PvICezpe80jyvoSUQ5Y3/bWYN796nP3cMdeHYB29KfnS9RJuR3fRQX9mnz/aX3vyv3waVlKLFvv/4Gf/lVXP3ZAlpKUIKYUj3XqQVU4NimMvThvFGhv0GEnteIopbxA0AAAAASUVORK5CYII='
const catboxIcon =
  'data:image/png;base64,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'

export type ImageHostIconId = 'thesungod' | 'imgbb' | 'catbox' | 'redacted'

const ICONS: Record<ImageHostIconId, string> = {
  thesungod: thesungodIcon,
  imgbb: imgbbIcon,
  catbox: catboxIcon,
  redacted: redactedIcon
}

const LABELS: Record<ImageHostIconId, string> = {
  thesungod: 'Ra (thesungod)',
  imgbb: 'imgbb',
  catbox: 'Catbox',
  redacted: 'Redacted Image Host'
}

export function imageHostIdFromFieldName(fieldName: string): ImageHostIconId | null {
  const prefix = fieldName.split('.')[0]
  if (
    prefix === 'thesungod' ||
    prefix === 'imgbb' ||
    prefix === 'catbox' ||
    prefix === 'redacted'
  ) {
    return prefix
  }
  return null
}

export function ImageHostIcon(props: {
  imageHostId: ImageHostIconId
  size?: number
  class?: string
  alt?: string
}): JSX.Element {
  const size = () => props.size ?? 16
  return (
    <img
      class={`image-host-icon ${props.class ?? ''}`.trim()}
      src={ICONS[props.imageHostId]}
      width={size()}
      height={size()}
      alt={props.alt ?? LABELS[props.imageHostId]}
      draggable={false}
    />
  )
}
