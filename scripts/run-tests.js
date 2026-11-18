const { spawnSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const testsDir = path.join(root, 'tests')
const testFiles = readdirSync(testsDir)
  .filter(file => file.endsWith('.test.js'))
  .sort()

if (testFiles.length === 0) {
  throw new Error(`No test files found in ${testsDir}`)
}

const electronPath = require('electron')

for (const testFile of testFiles) {
  const result = spawnSync(electronPath, ['--test', path.join(testsDir, testFile)], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`Failed to run ${testFile}:`, result.error)
    process.exitCode = 1
    break
  }

  if (result.status !== 0) {
    process.exitCode = 1
  }
}
