import type { Config, SectionID, ValidationIssue } from '@shared/types/config'
import {
  defaultConfig,
  gravlaxConfigPath,
  loadConfig,
  normalizeTools,
  resetSection,
  saveConfig,
  validate
} from '@main/core/config'
import { diagnosticError, logDiagnostic } from '@main/core/diagnosticLog'

export class ConfigService {
  private cfg: Config = defaultConfig()
  private readonly path: string
  private loaded = false
  private revision = 0

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
    const normalized = structuredClone(cfg)
    normalized.tools = normalizeTools(cfg.tools, cfg.tools)
    const issues = validate(normalized)
    if (issues.length > 0) {
      logDiagnostic('config_save_rejected', { issueCount: issues.length })
      return { ok: false, issues }
    }
    try {
      await saveConfig(this.path, normalized)
    } catch (error) {
      logDiagnostic('config_save_failed', diagnosticError(error))
      throw error
    }
    this.cfg = normalized
    this.revision += 1
    logDiagnostic('config_save_complete', { configRevision: this.revision })
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
