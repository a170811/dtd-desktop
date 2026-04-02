use std::collections::HashMap;
use std::path::Path;

const PATH_SEP: &str = if cfg!(target_os = "windows") { ";" } else { ":" };

/// Build environment variables that prepend bundled runtimes to PATH
/// and set NODE_PATH / PYTHONPATH for package resolution.
pub fn build_runtime_env(resource_dir: &Path) -> HashMap<String, String> {
    let node_dir = resource_dir.join("node");
    let python_dir = resource_dir.join("python");
    let node_modules = node_dir.join("node_modules");
    let site_packages = python_dir.join("Lib").join("site-packages");

    let mut env = HashMap::new();

    let path_prepend = format!(
        "{}{}{}",
        node_dir.display(),
        PATH_SEP,
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
        env.insert("PATH".to_string(), format!("{}{}{}", prepend, PATH_SEP, system_path));
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let merged = merge_with_system_path(&runtime_env, "/usr/bin");

        assert!(merged.contains_key("PATH"));
        let path = merged.get("PATH").unwrap();
        assert!(path.contains("/usr/bin"));
        assert!(path.starts_with("/app/resources/node"));
        assert!(path.contains(PATH_SEP));
        assert!(!merged.contains_key("__RUNTIME_PATH_PREPEND"));
    }
}
