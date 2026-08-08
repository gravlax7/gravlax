export function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

export function spectralUrl(path: string): string {
  return `gravlax-spectral://local/?path=${encodeURIComponent(path)}`
}
