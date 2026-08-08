import type { Config, SectionID, ValidationIssue } from '@shared/types/config'
import {
  defaultConfig,
  gravlaxConfigPath,
  loadConfig,
  resetSection,
  saveConfig,
  validate
} from '@main/core/config'

export class ConfigService {
  private cfg: Config = defaultConfig()
  private readonly path: string
  private loaded = false

  constructor(private readonly userDataPath: string) {
    this.path = gravlaxConfigPath(userDataPath)
  }

  get(): Config {
    return structuredClone(this.cfg)
  }

  pathFor(): string {
    return this.path
  }

  async ensureLoaded(): Promise<Config> {
    if (this.loaded) {
      return this.get()
    }
    this.cfg = await loadConfig(this.path)
    this.loaded = true
    return this.get()
  }

  async save(cfg: Config): Promise<{ ok: true } | { ok: false; issues: ValidationIssue[] }> {
    const issues = validate(cfg)
    if (issues.length > 0) {
      return { ok: false, issues }
    }
    this.cfg = structuredClone(cfg)
    await saveConfig(this.path, this.cfg)
    return { ok: true }
  }

  reset(section: SectionID): Config {
    this.cfg = resetSection(this.cfg, section)
    return this.get()
  }

  validate(cfg: Config): ValidationIssue[] {
    return validate(cfg)
  }
}
