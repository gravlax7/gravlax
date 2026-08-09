const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { join } = require('node:path')

const run = promisify(execFile)

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  await run('codesign', ['--force', '--deep', '--sign', '-', appPath])
}
