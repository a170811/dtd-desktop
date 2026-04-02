// scripts/setup-runtime.mjs
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

if (!import.meta.dirname) {
  console.error('Error: Node.js 20.11+ required to run this script');
  process.exit(1);
}

const NODE_VERSION = '22.16.0';
const PYTHON_VERSION = '3.13.5';

const RESOURCES_DIR = resolve(import.meta.dirname, '..', 'src-tauri', 'resources');
const NODE_DIR = join(RESOURCES_DIR, 'node');
const PYTHON_DIR = join(RESOURCES_DIR, 'python');
const CACHE_DIR = join(RESOURCES_DIR, '.cache');

const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
const PYTHON_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

async function downloadFile(url, destPath) {
  if (existsSync(destPath)) {
    console.log(`  [skip] ${destPath} already exists`);
    return;
  }
  console.log(`  Downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  mkdirSync(join(destPath, '..'), { recursive: true });
  const fileStream = createWriteStream(destPath);
  await pipeline(res.body, fileStream);
  console.log(`  Saved to ${destPath}`);
}

function extractZip(zipPath, destDir) {
  console.log(`  Extracting ${zipPath} to ${destDir}...`);
  mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-Command',
      `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
  }
}

async function setupNode() {
  console.log('\n=== Setting up Node.js ===');

  const versionFile = join(NODE_DIR, '.version');
  if (existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === NODE_VERSION) {
    console.log(`  [skip] Node.js ${NODE_VERSION} already set up`);
    return;
  }

  const zipPath = join(CACHE_DIR, `node-v${NODE_VERSION}-win-x64.zip`);
  await downloadFile(NODE_URL, zipPath);

  // Extract to temp then move contents (zip has a top-level folder)
  const tmpDir = join(RESOURCES_DIR, '.tmp-node');
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  extractZip(zipPath, tmpDir);

  // Move from nested folder to NODE_DIR
  if (existsSync(NODE_DIR)) rmSync(NODE_DIR, { recursive: true });
  renameSync(join(tmpDir, `node-v${NODE_VERSION}-win-x64`), NODE_DIR);
  rmSync(tmpDir, { recursive: true });

  // Install npm packages
  console.log('  Installing Node.js packages...');
  const npmCmd = join(NODE_DIR, process.platform === 'win32' ? 'npm.cmd' : 'bin/npm');
  execFileSync(npmCmd, ['install', '--prefix', NODE_DIR, 'docx', 'pptxgenjs', 'pdf-lib'], {
    stdio: 'inherit',
    env: { ...process.env, PATH: `${NODE_DIR}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` },
  });

  writeFileSync(versionFile, NODE_VERSION);
  console.log(`  Node.js ${NODE_VERSION} setup complete`);
}

async function setupPython() {
  console.log('\n=== Setting up Python ===');

  const versionFile = join(PYTHON_DIR, '.version');
  if (existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === PYTHON_VERSION) {
    console.log(`  [skip] Python ${PYTHON_VERSION} already set up`);
    return;
  }

  const zipPath = join(CACHE_DIR, `python-${PYTHON_VERSION}-embed-amd64.zip`);
  await downloadFile(PYTHON_URL, zipPath);

  if (existsSync(PYTHON_DIR)) rmSync(PYTHON_DIR, { recursive: true });
  extractZip(zipPath, PYTHON_DIR);

  // Enable pip: uncomment "import site" in python313._pth
  const pthFile = join(PYTHON_DIR, 'python313._pth');
  if (existsSync(pthFile)) {
    let pth = readFileSync(pthFile, 'utf8');
    pth = pth.replace(/^#\s*import site/m, 'import site');
    writeFileSync(pthFile, pth);
    console.log('  Enabled import site in ._pth');
  }

  // Install pip
  const getPipPath = join(CACHE_DIR, 'get-pip.py');
  await downloadFile(GET_PIP_URL, getPipPath);
  const pythonExe = join(PYTHON_DIR, 'python.exe');
  console.log('  Installing pip...');
  execFileSync(pythonExe, [getPipPath], { stdio: 'inherit' });

  // Install packages
  const sitePackages = join(PYTHON_DIR, 'Lib', 'site-packages');
  mkdirSync(sitePackages, { recursive: true });
  console.log('  Installing Python packages...');
  execFileSync(pythonExe, [
    '-m', 'pip', 'install', '--target', sitePackages,
    'pypdf', 'pdfplumber', 'reportlab', 'openpyxl', 'pandas',
    'markitdown[pptx]', 'Pillow', 'pdf2image',
  ], { stdio: 'inherit' });

  writeFileSync(versionFile, PYTHON_VERSION);
  console.log(`  Python ${PYTHON_VERSION} setup complete`);
}

async function main() {
  console.log('Setting up bundled runtimes...');
  mkdirSync(CACHE_DIR, { recursive: true });

  await setupNode();
  await setupPython();

  console.log('\nAll runtimes ready.');
}

main().catch((err) => {
  console.error('Runtime setup failed:', err);
  process.exit(1);
});
