#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dirs::home_dir;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct RemoteDefaults {
    host: Option<String>,
    port: Option<u16>,
    token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SidebarTaskItem {
    id: String,
    title: String,
    instruction: String,
    enabled: bool,
    schedule_kind: String,
    schedule_at_ms: Option<i64>,
    schedule_every_ms: Option<i64>,
    schedule_expr: Option<String>,
    schedule_tz: Option<String>,
    next_run_at_ms: Option<i64>,
    run_count: i64,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SidebarSkillItem {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SidebarMcpItem {
    name: String,
    enabled: bool,
    transport: String,
    command: String,
    args: Vec<String>,
    url: String,
    enabled_tools: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSidebarData {
    tasks: Vec<SidebarTaskItem>,
    skills: Vec<SidebarSkillItem>,
    mcp_servers: Vec<SidebarMcpItem>,
}

fn nomi_config_path() -> Option<PathBuf> {
    let home = home_dir()?;
    Some(home.join(".nomi").join("config.json"))
}

fn nomi_root_path() -> Option<PathBuf> {
    let home = home_dir()?;
    Some(home.join(".nomi"))
}

fn clear_nomi_runtime_entries(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(root).map_err(|err| format!("读取 .nomi 目录失败: {err}"))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("遍历 .nomi 目录失败: {err}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "config.json" || name == "weixin" {
            continue;
        }
        if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|err| format!("删除目录失败 {}: {err}", path.display()))?;
        } else {
            fs::remove_file(&path)
                .map_err(|err| format!("删除文件失败 {}: {err}", path.display()))?;
        }
    }

    Ok(())
}

fn read_json(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn value_as_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(Value::as_i64)
}

fn value_as_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
}

#[tauri::command]
fn load_remote_defaults() -> Result<RemoteDefaults, String> {
    let path = nomi_config_path().ok_or("无法定位用户目录")?;
    let raw = fs::read_to_string(&path).map_err(|err| format!("读取配置失败: {err}"))?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|err| format!("解析配置失败: {err}"))?;
    let remote = value
        .get("remote")
        .and_then(Value::as_object)
        .ok_or("配置中缺少 remote 段")?;

    let host = remote
        .get("host")
        .and_then(Value::as_str)
        .map(str::to_string);
    let port = remote
        .get("port")
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok());
    let token = remote
        .get("authToken")
        .or_else(|| remote.get("auth_token"))
        .and_then(Value::as_str)
        .map(str::to_string);

    Ok(RemoteDefaults { host, port, token })
}

#[tauri::command]
fn load_desktop_sidebar_data() -> Result<DesktopSidebarData, String> {
    let root = nomi_root_path().ok_or("无法定位用户目录")?;
    let config = read_json(&root.join("config.json")).unwrap_or(Value::Null);
    let task_store = read_json(&root.join("workspace").join("tasks").join("tasks.json"))
        .unwrap_or(Value::Null);
    let cron_store = read_json(&root.join("workspace").join("cron").join("jobs.json"))
        .unwrap_or(Value::Null);

    let cron_jobs = cron_store
        .get("jobs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut tasks: Vec<SidebarTaskItem> = Vec::new();
    if let Some(task_items) = task_store.get("tasks").and_then(Value::as_array) {
        for task in task_items {
            let task_id = task
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let payload = task.get("payload").and_then(Value::as_object);
            let schedule = task.get("schedule").and_then(Value::as_object);
            let run = task.get("run").and_then(Value::as_object);

            let next_run_at_ms = cron_jobs
                .iter()
                .find(|job| {
                    job.get("payload")
                        .and_then(Value::as_object)
                        .map(|payload| {
                            payload
                                .get("target_kind")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                == "task"
                                && payload
                                    .get("target_id")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    == task_id
                        })
                        .unwrap_or(false)
                })
                .and_then(|job| {
                    value_as_i64(
                        job.get("state")
                            .and_then(Value::as_object)
                            .and_then(|state| state.get("next_run_at_ms")),
                    )
                })
                .or_else(|| value_as_i64(task.get("deliver_at_ms")));

            tasks.push(SidebarTaskItem {
                id: task_id.clone(),
                title: task
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(task_id.as_str())
                    .to_string(),
                instruction: payload
                    .and_then(|value| value.get("instruction"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                enabled: task.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                schedule_kind: schedule
                    .and_then(|value| value.get("kind"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                schedule_at_ms: value_as_i64(schedule.and_then(|value| value.get("at_ms"))),
                schedule_every_ms: value_as_i64(schedule.and_then(|value| value.get("every_ms"))),
                schedule_expr: value_as_string(schedule.and_then(|value| value.get("expr"))),
                schedule_tz: value_as_string(schedule.and_then(|value| value.get("tz"))),
                next_run_at_ms,
                run_count: run
                    .and_then(|value| value.get("run_count"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
                status: run
                    .and_then(|value| value.get("status"))
                    .and_then(Value::as_str)
                    .unwrap_or("pending")
                    .to_string(),
            });
        }
    }

    let mut skills: Vec<SidebarSkillItem> = Vec::new();
    let skills_root = root.join("skills");
    if let Ok(entries) = fs::read_dir(&skills_root) {
        for entry in entries.flatten() {
            let skill_path = entry.path();
            if !skill_path.is_dir() {
                continue;
            }
            if !skill_path.join("SKILL.md").exists() {
                continue;
            }
            skills.push(SidebarSkillItem {
                name: entry.file_name().to_string_lossy().to_string(),
                path: skill_path.to_string_lossy().to_string(),
            });
        }
        skills.sort_by(|left, right| left.name.cmp(&right.name));
    }

    let mcp_servers_value = config
        .get("tools")
        .and_then(Value::as_object)
        .and_then(|tools| {
            tools
                .get("mcpServers")
                .or_else(|| tools.get("mcp_servers"))
                .and_then(Value::as_object)
        });
    let mut mcp_servers: Vec<SidebarMcpItem> = Vec::new();
    if let Some(servers) = mcp_servers_value {
        for (name, raw) in servers {
            let args = raw
                .get("args")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let enabled_tools = raw
                .get("enabledTools")
                .or_else(|| raw.get("enabled_tools"))
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            mcp_servers.push(SidebarMcpItem {
                name: name.clone(),
                enabled: raw.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                transport: raw
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                command: raw
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                args,
                url: raw
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                enabled_tools,
            });
        }
        mcp_servers.sort_by(|left, right| left.name.cmp(&right.name));
    }

    Ok(DesktopSidebarData {
        tasks,
        skills,
        mcp_servers,
    })
}

#[tauri::command]
fn clear_nomi_runtime_state() -> Result<(), String> {
    let root = nomi_root_path().ok_or("无法定位用户目录")?;
    clear_nomi_runtime_entries(&root)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_websocket::init())
        .invoke_handler(tauri::generate_handler![
            load_remote_defaults,
            load_desktop_sidebar_data,
            clear_nomi_runtime_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run nomi desktop");
}
