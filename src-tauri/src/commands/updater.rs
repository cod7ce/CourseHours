//! 版本检查与自动更新：直接读 GitHub Releases（公开仓库，匿名即可），
//! 下载 zip → ditto 解压 → 退出后用脚本原地替换 .app → 重新拉起。
//! 不依赖签名，也不依赖 tauri-plugin-updater（它要求对更新包签名）。

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

const API: &str = "https://api.github.com/repos/cod7ce/CourseHours/releases?per_page=10";
pub const RELEASES_PAGE: &str = "https://github.com/cod7ce/CourseHours/releases/latest";
const FIRST_CHECK_DELAY_SECS: u64 = 20;
const CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;

static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub notes: String,
    pub published_at: Option<String>,
    pub page_url: String,
    pub asset: Option<UpdateAsset>,
    pub checked_at: i64,
    /// 当前不是 .app（开发模式）时不能原地安装
    pub can_install: bool,
}

// ---- 版本比较 ----
fn parse_version(v: &str) -> Option<(Vec<u64>, Option<String>)> {
    let v = v.trim().trim_start_matches('v');
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p.to_string())),
        None => (v, None),
    };
    let nums: Vec<u64> = core.split('.').map(|x| x.parse().ok()).collect::<Option<Vec<_>>>()?;
    if nums.len() != 3 {
        return None;
    }
    Some((nums, pre))
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    let (Some(a), Some(b)) = (parse_version(candidate), parse_version(current)) else { return false };
    for i in 0..3 {
        if a.0[i] != b.0[i] {
            return a.0[i] > b.0[i];
        }
    }
    match (&a.1, &b.1) {
        (None, None) => false,
        (None, Some(_)) => true,
        (Some(_), None) => false,
        (Some(x), Some(y)) => x > y,
    }
}

fn asset_suffix() -> String {
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    format!("-mac-{}.zip", arch)
}

fn ua(app: &AppHandle) -> String {
    format!("CourseHours/{}", app.package_info().version)
}

fn current_app_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let s = exe.to_string_lossy();
    let idx = s.find(".app/")?;
    Some(PathBuf::from(&s[..idx + 4]))
}

fn fetch_latest(app: &AppHandle) -> AppResult<UpdateInfo> {
    let current = app.package_info().version.to_string();
    let resp = ureq::get(API)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", &ua(app))
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| AppError::rule(match e {
            ureq::Error::Status(404, _) => "还没有发布过任何版本".to_string(),
            ureq::Error::Status(code, _) => format!("GitHub 返回 {}", code),
            ureq::Error::Transport(t) => format!("没能连上 GitHub：{}", t),
        }))?;
    let releases: serde_json::Value = resp.into_json().map_err(|e| AppError::rule(format!("解析发布信息失败：{}", e)))?;
    let list = releases.as_array().cloned().unwrap_or_default();
    let suffix = asset_suffix();
    // 最近 10 个里挑第一个「非草稿、非预发布、带本平台安装包」的；都没有安装包就退回最新的正式版
    let mut best: Option<&serde_json::Value> = None;
    let mut fallback: Option<&serde_json::Value> = None;
    for r in &list {
        if r["draft"].as_bool().unwrap_or(false) || r["prerelease"].as_bool().unwrap_or(false) {
            continue;
        }
        if fallback.is_none() {
            fallback = Some(r);
        }
        let has = r["assets"].as_array().map(|a| a.iter().any(|x| x["name"].as_str().map(|n| n.ends_with(&suffix)).unwrap_or(false))).unwrap_or(false);
        if has {
            best = Some(r);
            break;
        }
    }
    let Some(r) = best.or(fallback) else {
        return Err(AppError::rule("还没有发布过任何版本"));
    };
    let asset = r["assets"].as_array().and_then(|a| a.iter().find(|x| x["name"].as_str().map(|n| n.ends_with(&suffix)).unwrap_or(false))).map(|x| UpdateAsset {
        name: x["name"].as_str().unwrap_or_default().to_string(),
        url: x["browser_download_url"].as_str().unwrap_or_default().to_string(),
        size: x["size"].as_u64().unwrap_or(0),
    });
    let latest = r["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    Ok(UpdateInfo {
        available: is_newer(&latest, &current),
        current,
        latest,
        notes: r["body"].as_str().unwrap_or("").to_string(),
        published_at: r["published_at"].as_str().map(|s| s.to_string()),
        page_url: r["html_url"].as_str().unwrap_or(RELEASES_PAGE).to_string(),
        asset,
        checked_at: crate::db::now_ms(),
        can_install: current_app_path().is_some(),
    })
}

#[tauri::command]
pub async fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// 检查更新。force = true 时即使版本相同也标记为可安装（用于测试更新流程）
#[tauri::command]
pub async fn check_update(app: AppHandle, force: Option<bool>) -> AppResult<UpdateInfo> {
    let h = app.clone();
    let mut info = tauri::async_runtime::spawn_blocking(move || fetch_latest(&h))
        .await
        .map_err(|e| AppError::rule(e.to_string()))??;
    if force.unwrap_or(false) && info.asset.is_some() {
        info.available = true;
    }
    Ok(info)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    received: u64,
    total: u64,
}

fn emit_progress(app: &AppHandle, phase: &'static str, received: u64, total: u64) {
    let _ = app.emit("update-progress", Progress { phase, received, total });
}

fn run(cmd: &str, args: &[&str]) -> AppResult<()> {
    let out = std::process::Command::new(cmd).args(args).output()?;
    if !out.status.success() {
        return Err(AppError::rule(format!("{} 失败：{}", cmd, String::from_utf8_lossy(&out.stderr))));
    }
    Ok(())
}

fn download_and_install(app: &AppHandle, asset: &UpdateAsset) -> AppResult<()> {
    let current_app = current_app_path().ok_or_else(|| AppError::rule("当前不是 .app 形式（开发模式），无法原地更新"))?;
    let parent = current_app.parent().ok_or_else(|| AppError::rule("找不到应用所在目录"))?;
    if std::fs::metadata(parent).map(|m| m.permissions().readonly()).unwrap_or(true) {
        return Err(AppError::rule(format!("没有权限写入 {}，请把应用放到「应用程序」或个人目录下再更新", parent.display())));
    }
    let work = std::env::temp_dir().join("coursehours-update");
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work)?;
    let archive = work.join(&asset.name);

    // 下载
    emit_progress(app, "downloading", 0, asset.size);
    let resp = ureq::get(&asset.url)
        .set("User-Agent", &ua(app))
        .timeout(std::time::Duration::from_secs(600))
        .call()
        .map_err(|e| AppError::rule(format!("下载失败：{}", e)))?;
    let total = resp.header("Content-Length").and_then(|x| x.parse::<u64>().ok()).unwrap_or(asset.size);
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&archive)?;
    let mut buf = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    let mut last = std::time::Instant::now();
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        received += n as u64;
        if last.elapsed().as_millis() > 200 {
            last = std::time::Instant::now();
            emit_progress(app, "downloading", received, total);
        }
    }
    file.flush()?;
    drop(file);
    emit_progress(app, "downloading", received, total);
    if asset.size > 0 && received != asset.size {
        return Err(AppError::rule(format!("下载的文件大小不对（{} / {}）", received, asset.size)));
    }

    // 解压
    emit_progress(app, "installing", received, total);
    let extract = work.join("extracted");
    std::fs::create_dir_all(&extract)?;
    run("/usr/bin/ditto", &["-x", "-k", &archive.to_string_lossy(), &extract.to_string_lossy()])?;
    let new_app = std::fs::read_dir(&extract)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.extension().map(|x| x == "app").unwrap_or(false))
        .ok_or_else(|| AppError::rule("安装包里没找到 .app"))?;
    let _ = run("/usr/bin/xattr", &["-dr", "com.apple.quarantine", &new_app.to_string_lossy()]);

    // 退出后替换：脚本等本进程结束，换好包再拉起。失败则回滚。
    let script = work.join("swap.sh");
    let q = |p: &std::path::Path| format!("'{}'", p.to_string_lossy().replace('\'', "'\\''"));
    let body = format!(
        "#!/bin/bash\nset -e\nPID={pid}\nfor i in $(seq 1 100); do kill -0 \"$PID\" 2>/dev/null || break; sleep 0.2; done\nNEW={new}\nCUR={cur}\nBACKUP=\"$CUR.old-$$\"\nmv \"$CUR\" \"$BACKUP\"\nif /usr/bin/ditto \"$NEW\" \"$CUR\"; then\n  rm -rf \"$BACKUP\"\nelse\n  rm -rf \"$CUR\"; mv \"$BACKUP\" \"$CUR\"\nfi\n/usr/bin/xattr -dr com.apple.quarantine \"$CUR\" || true\nsleep 0.5\n/usr/bin/open \"$CUR\"\nrm -rf {work} || true\n",
        pid = std::process::id(),
        new = q(&new_app),
        cur = q(&current_app),
        work = q(&work),
    );
    std::fs::write(&script, body)?;
    run("/bin/chmod", &["755", &script.to_string_lossy()])?;
    emit_progress(app, "restarting", received, total);
    std::process::Command::new("/bin/bash")
        .arg(&script)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        h.exit(0);
    });
    Ok(())
}

/// 下载并安装指定资产；成功后应用会自动退出并重启
#[tauri::command]
pub async fn install_update(app: AppHandle, asset: serde_json::Value) -> AppResult<()> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err(AppError::rule("已经在更新中"));
    }
    let a = UpdateAsset {
        name: asset["name"].as_str().unwrap_or_default().to_string(),
        url: asset["url"].as_str().unwrap_or_default().to_string(),
        size: asset["size"].as_u64().unwrap_or(0),
    };
    if a.url.is_empty() {
        BUSY.store(false, Ordering::SeqCst);
        return Err(AppError::rule("这个版本没有可以自动安装的安装包"));
    }
    let h = app.clone();
    let r = tauri::async_runtime::spawn_blocking(move || download_and_install(&h, &a))
        .await
        .map_err(|e| AppError::rule(e.to_string()));
    let r = match r { Ok(inner) => inner, Err(e) => Err(e) };
    if r.is_err() {
        BUSY.store(false, Ordering::SeqCst);
        let _ = app.emit("update-progress", Progress { phase: "error", received: 0, total: 0 });
    }
    r
}

/// 后台静默检查：启动 20 秒后一次，之后每 6 小时；发现新版本发 `update-available` 事件
pub fn spawn_auto_check(app: AppHandle) {
    if cfg!(debug_assertions) && std::env::var("COURSEHOURS_UPDATE_DEV").is_err() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(FIRST_CHECK_DELAY_SECS));
        loop {
            if let Ok(info) = fetch_latest(&app) {
                if info.available {
                    let _ = app.emit("update-available", info);
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(CHECK_INTERVAL_SECS));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn version_compare() {
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(is_newer("0.2.0", "0.2.0-beta.1"));
        assert!(!is_newer("0.2.0-beta.1", "0.2.0"));
        assert!(!is_newer("abc", "0.1.0"));
    }
}
