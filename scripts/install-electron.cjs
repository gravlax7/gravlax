const path = require('node:path')
const { spawnSync } = require('node:child_process')

let packagePath
try {
  packagePath = require.resolve('electron/package.json')
} catch {
  // Electron is a dev dependency, so production-only installs do not need it.
  process.exit(0)
}

const installScript = path.join(path.dirname(packagePath), 'install.js')
const result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' })

if (result.error) throw result.error
process.exit(result.status ?? 1)
