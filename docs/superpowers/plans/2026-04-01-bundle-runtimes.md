# Bundle Node.js + Python Runtimes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle Node.js 22 LTS portable and Python 3.13 embeddable as Tauri resources so `execute_bash()` can use them without user setup.

**Architecture:** A build-time script downloads and prepares runtimes into `src-tauri/resources/`. Tauri bundles them as resources. At runtime, `execute_bash()` injects PATH/NODE_PATH/PYTHONPATH pointing to the bundled runtimes before spawning commands.

**Tech Stack:** Node.js (build script), Rust (runtime integration), Tauri 2.x bundle.resources

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/setup-runtime.mjs` | Create | Download Node.js + Python, install packages |
| `src-tauri/src/runtime.rs` | Create | Resolve bundled runtime paths, build env vars |
| `src-tauri/src/commands.rs` | Modify | Inject runtime env into `execute_bash_sync()` |
| `src-tauri/src/lib.rs` | Modify | Register `runtime` module |
| `src-tauri/tauri.conf.json` | Modify | Add `bundle.resources` |
| `package.json` | Modify | Add `setup-runtime` script |
| `.gitignore` | Modify | Exclude `src-tauri/resources/` |
| `CLAUDE.md` | Modify | Document new `setup-runtime` command |

---

### Task 1: Create `scripts/setup-runtime.mjs`

**Files:**
- Create: `scripts/setup-runtime.mjs`

This script runs during build to download and prepare runtimes. Since it's a build tool (not app code), we test it manually rather than with unit tests.

- [ ] **Step 1: Create the script with version constants and helper functions**

Create `scripts/setup-runtime.mjs`:

```js
// scripts/setup-runtime.mjs
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

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
```

- [ ] **Step 2: Add the Node.js setup function**

Append to `scripts/setup-runtime.mjs`:

```js
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
```

- [ ] **Step 3: Add the Python setup function**

Append to `scripts/setup-runtime.mjs`:

```js
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
```

- [ ] **Step 4: Add the main entry point**

Append to `scripts/setup-runtime.mjs`:

```js
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
```

- [ ] **Step 5: Verify the script parses correctly**

Run: `node --check scripts/setup-runtime.mjs`
Expected: No output (syntax OK)

- [ ] **Step 6: Commit**

```bash
git add scripts/setup-runtime.mjs
git commit -m "feat: add setup-runtime script for downloading Node.js + Python"
```

---

### Task 2: Create `src-tauri/src/runtime.rs` (TDD)

**Files:**
- Create: `src-tauri/src/runtime.rs`
- Modify: `src-tauri/src/lib.rs:1` (add `mod runtime;`)

- [ ] **Step 1: Create runtime.rs with module declaration and write the first test**

Create `src-tauri/src/runtime.rs`:

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Given the resource directory, return the path to the bundled Node.js executable.
pub fn node_exe_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("node").join("node.exe")
}

/// Given the resource directory, return the path to the bundled Python executable.
pub fn python_exe_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("python").join("python.exe")
}

/// Build environment variables that prepend bundled runtimes to PATH
/// and set NODE_PATH / PYTHONPATH for package resolution.
pub fn build_runtime_env(resource_dir: &Path) -> HashMap<String, String> {
    let node_dir = resource_dir.join("node");
    let python_dir = resource_dir.join("python");
    let node_modules = node_dir.join("node_modules");
    let site_packages = python_dir.join("Lib").join("site-packages");

    let mut env = HashMap::new();

    // Prepend runtime dirs to PATH
    let path_prepend = format!(
        "{};{}",
        node_dir.display(),
        python_dir.display()
    );
    env.insert("__RUNTIME_PATH_PREPEND".to_string(), path_prepend);
    env.insert("NODE_PATH".to_string(), node_modules.display().to_string());
    env.insert("PYTHONPATH".to_string(), site_packages.display().to_string());

    env
}

/// Merge runtime env into a full env map suitable for `Command::envs()`.
/// Takes the current PATH and prepends the runtime directories.
pub fn merge_with_system_path(runtime_env: &HashMap<String, String>, system_path: &str) -> HashMap<String, String> {
    let mut env = runtime_env.clone();
    if let Some(prepend) = env.remove("__RUNTIME_PATH_PREPEND") {
        env.insert("PATH".to_string(), format!("{};{}", prepend, system_path));
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_exe_path() {
        let resource_dir = Path::new("C:\\Program Files\\dtd-desktop\\resources");
        let path = node_exe_path(resource_dir);
        assert_eq!(path, PathBuf::from("C:\\Program Files\\dtd-desktop\\resources\\node\\node.exe"));
    }

    #[test]
    fn test_python_exe_path() {
        let resource_dir = Path::new("C:\\Program Files\\dtd-desktop\\resources");
        let path = python_exe_path(resource_dir);
        assert_eq!(path, PathBuf::from("C:\\Program Files\\dtd-desktop\\resources\\python\\python.exe"));
    }

    #[test]
    fn test_build_runtime_env_keys() {
        let resource_dir = Path::new("/app/resources");
        let env = build_runtime_env(resource_dir);
        assert!(env.contains_key("__RUNTIME_PATH_PREPEND"));
        assert!(env.contains_key("NODE_PATH"));
        assert!(env.contains_key("PYTHONPATH"));
    }

    #[test]
    fn test_build_runtime_env_values() {
        let resource_dir = Path::new("/app/resources");
        let env = build_runtime_env(resource_dir);
        assert!(env["NODE_PATH"].contains("node_modules"));
        assert!(env["PYTHONPATH"].contains("site-packages"));
    }

    #[test]
    fn test_merge_with_system_path() {
        let resource_dir = Path::new("/app/resources");
        let runtime_env = build_runtime_env(resource_dir);
        let merged = merge_with_system_path(&runtime_env, "C:\\Windows\\System32");

        assert!(merged.contains_key("PATH"));
        assert!(merged.get("PATH").unwrap().contains("System32"));
        assert!(merged.get("PATH").unwrap().starts_with("/app/resources/node"));
        assert!(!merged.contains_key("__RUNTIME_PATH_PREPEND"));
    }
}
```

- [ ] **Step 2: Register the module in lib.rs**

Modify `src-tauri/src/lib.rs:1` — add at line 1:

```rust
mod commands;
mod runtime;
```

(Replace the existing `mod commands;` line.)

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test runtime`
Expected: All 5 tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/runtime.rs src-tauri/src/lib.rs
git commit -m "feat: add runtime module for bundled Node.js/Python path resolution"
```

---

### Task 3: Integrate runtime env into `execute_bash`

**Files:**
- Modify: `src-tauri/src/commands.rs:219-276` (execute_bash_sync)
- Modify: `src-tauri/src/commands.rs:337-339` (execute_bash command)

The key change: `execute_bash_sync` needs access to the app's resource directory to inject runtime paths. We pass it as an `Option<&Path>` so existing tests still work (they pass `None`).

- [ ] **Step 1: Write the test for env injection**

Add to `src-tauri/src/commands.rs` in the `mod tests` block, before the closing `}`:

```rust
    #[test]
    fn test_execute_bash_with_runtime_env() {
        // On non-Windows, this verifies the env injection path works
        // even though the runtimes themselves are Windows-only
        let workdir = std::env::temp_dir().join("test_bash_runtime");
        std::fs::create_dir_all(&workdir).unwrap();

        // Create a fake resource dir with node/ and python/ subdirs
        let resource_dir = workdir.join("resources");
        std::fs::create_dir_all(resource_dir.join("node")).unwrap();
        std::fs::create_dir_all(resource_dir.join("python").join("Lib").join("site-packages")).unwrap();

        // execute_bash_sync with resource_dir should not error
        let result = execute_bash_sync("echo hello", workdir.to_str().unwrap(), Some(&resource_dir));
        assert!(result.is_ok());
        assert!(result.unwrap().contains("hello"));

        std::fs::remove_dir_all(&workdir).ok();
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_execute_bash_with_runtime_env`
Expected: FAIL — `execute_bash_sync` doesn't accept a third parameter yet

- [ ] **Step 3: Modify `execute_bash_sync` to accept resource_dir**

Replace `execute_bash_sync` in `src-tauri/src/commands.rs` (lines 219-276) with:

```rust
fn execute_bash_sync(command: &str, working_dir: &str, resource_dir: Option<&Path>) -> Result<String, String> {
    // Block dangerous commands
    let dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
    for pattern in &dangerous {
        if command.contains(pattern) {
            return Err(format!("Command blocked for safety: contains '{}'", pattern));
        }
    }

    use wait_timeout::ChildExt;

    let runtime_env = resource_dir.map(|dir| {
        let env = crate::runtime::build_runtime_env(dir);
        let system_path = std::env::var("PATH").unwrap_or_default();
        crate::runtime::merge_with_system_path(&env, &system_path)
    });

    let mut child = if cfg!(target_os = "windows") {
        let wrapped = format!("chcp 65001 >nul && {}", command);
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", &wrapped])
            .current_dir(working_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if let Some(ref env) = runtime_env {
            cmd.envs(env);
        }
        cmd.spawn()
    } else {
        let mut cmd = std::process::Command::new("sh");
        cmd.args(["-c", command])
            .current_dir(working_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if let Some(ref env) = runtime_env {
            cmd.envs(env);
        }
        cmd.spawn()
    }
    .map_err(|e| format!("Failed to execute command: {}", e))?;

    let timeout = std::time::Duration::from_secs(120);
    match child.wait_timeout(timeout).map_err(|e| format!("Failed to wait for command: {}", e))? {
        Some(_status) => {}
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Error: Command timed out after 120 seconds".to_string());
        }
    }

    let output = child.wait_with_output()
        .map_err(|e| format!("Failed to read command output: {}", e))?;

    let mut combined = String::new();
    combined.push_str(&decode_output(&output.stdout));
    combined.push_str(&decode_output(&output.stderr));

    if combined.is_empty() {
        return Ok("(no output)".to_string());
    }

    if combined.len() > MAX_OUTPUT_BYTES {
        combined.truncate(MAX_OUTPUT_BYTES);
        combined.push_str("\n... (output truncated)");
    }

    Ok(combined)
}
```

- [ ] **Step 4: Update the `execute_bash` Tauri command**

Replace `execute_bash` at lines 337-339 with:

```rust
#[tauri::command]
pub async fn execute_bash(app: AppHandle, command: String, working_dir: String) -> Result<String, String> {
    let resource_dir = app.path().resource_dir().ok();
    execute_bash_sync(&command, &working_dir, resource_dir.as_deref())
}
```

Note: `AppHandle` is auto-injected by Tauri — the frontend `invoke('execute_bash', { command, workingDir })` call does not need to change.

- [ ] **Step 5: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: All tests pass (including the new `test_execute_bash_with_runtime_env`)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat: inject bundled runtime env vars into execute_bash"
```

---

### Task 4: Update config files

**Files:**
- Modify: `src-tauri/tauri.conf.json:27-37`
- Modify: `package.json:6-13`
- Modify: `.gitignore:28-29`
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Add bundle.resources to tauri.conf.json**

In `src-tauri/tauri.conf.json`, replace the `"bundle"` block (lines 27-37) with:

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": {
      "resources/node/**": "resources/node/",
      "resources/python/**": "resources/python/"
    }
  }
```

- [ ] **Step 2: Add setup-runtime script to package.json**

In `package.json`, add to the `"scripts"` section:

```json
    "setup-runtime": "node scripts/setup-runtime.mjs"
```

- [ ] **Step 3: Add src-tauri/resources/ to .gitignore**

Append to `.gitignore`:

```
# Bundled runtimes (downloaded at build time)
src-tauri/resources/
```

- [ ] **Step 4: Update CLAUDE.md**

In the project-level `CLAUDE.md` (`/Users/ken/sharing/side-agent/test-tauri/CLAUDE.md`), add to the Commands section after `cd src-tauri && cargo test`:

```markdown
# Download Node.js + Python runtimes for bundling (Windows build only)
npm run setup-runtime
```

And add to the Architecture section after the "Rust backend" table:

```markdown
### Bundled runtimes

Node.js 22 LTS portable and Python 3.13 embeddable are bundled as Tauri resources (Windows only). `scripts/setup-runtime.mjs` downloads and prepares them at build time into `src-tauri/resources/`. At runtime, `execute_bash()` injects `PATH`, `NODE_PATH`, and `PYTHONPATH` environment variables pointing to the bundled runtimes via `src-tauri/src/runtime.rs`.

Pre-installed packages: Node.js (`docx`, `pptxgenjs`, `pdf-lib`), Python (`pypdf`, `pdfplumber`, `reportlab`, `openpyxl`, `pandas`, `markitdown[pptx]`, `Pillow`, `pdf2image`).
```

- [ ] **Step 5: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json package.json .gitignore CLAUDE.md
git commit -m "chore: configure Tauri resource bundling and add setup-runtime script"
```

---

### Task 5: End-to-end verification (Windows)

This task is manual — run on a Windows machine or CI with Windows.

- [ ] **Step 1: Run setup-runtime**

Run: `npm run setup-runtime`
Expected: Downloads Node.js + Python, installs packages, outputs "All runtimes ready."

- [ ] **Step 2: Verify directory structure**

Run: `dir src-tauri\resources\node\node.exe` and `dir src-tauri\resources\python\python.exe`
Expected: Both files exist

- [ ] **Step 3: Verify Node.js packages**

Run: `src-tauri\resources\node\node.exe -e "require('docx'); require('pptxgenjs'); require('pdf-lib'); console.log('OK')"`
Expected: Prints "OK"

- [ ] **Step 4: Verify Python packages**

Run: `src-tauri\resources\python\python.exe -c "import pypdf, pdfplumber, reportlab, openpyxl, pandas, markitdown, PIL, pdf2image; print('OK')"`
Expected: Prints "OK"

- [ ] **Step 5: Build the app**

Run: `npm run setup-runtime && npm run tauri build`
Expected: Build succeeds, `.exe` is created

- [ ] **Step 6: Verify bundled app**

Launch the built `.exe`, open a chat, and have the LLM run:
- `node -e "console.log('Node ' + process.version)"`
- `python -c "import sys; print('Python ' + sys.version)"`

Expected: Both commands return version info via `execute_bash`.
