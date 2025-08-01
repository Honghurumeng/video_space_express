use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    Manager, PhysicalPosition
};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::process::{Command, Child};
use std::sync::Mutex;

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SERVER_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

// 托盘菜单处理函数
fn handle_tray_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::tray::TrayIconEvent) {
    match event {
        tauri::tray::TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        tauri::tray::TrayIconEvent::Click {
            button: MouseButton::Right,
            button_state: MouseButtonState::Up,
            position,
            ..
        } => {
            if let Some(tray) = app.tray_by_id("main-tray") {
                let _ = tray.show_menu_at_position(PhysicalPosition::new(position.x, position.y));
            }
        }
        tauri::tray::TrayIconEvent::MenuItemClick { id } => {
            match id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        }
        _ => {}
    }
}

#[tauri::command]
async fn start_server() -> Result<String, String> {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        return Ok("服务器已在运行".to_string());
    }

    println!("正在启动服务器...");
    
    // 启动Node.js Express服务器
    let mut command = Command::new("node");
    command.arg("server.js");
    
    // 在当前工作目录启动
    command.current_dir("..");
    
    match command.spawn() {
        Ok(child) => {
            let mut process = SERVER_PROCESS.lock().unwrap();
            *process = Some(child);
            SERVER_RUNNING.store(true, Ordering::SeqCst);
            println!("服务器启动成功");
            Ok("服务器启动成功".to_string())
        }
        Err(e) => {
            eprintln!("启动服务器失败: {}", e);
            Err(format!("启动服务器失败: {}", e))
        }
    }
}

#[tauri::command]
async fn stop_server() -> Result<String, String> {
    if !SERVER_RUNNING.load(Ordering::SeqCst) {
        return Ok("服务器未运行".to_string());
    }

    println!("正在停止服务器...");
    
    // 停止Node.js服务器进程
    let mut process = SERVER_PROCESS.lock().unwrap();
    if let Some(mut child) = process.take() {
        match child.kill() {
            Ok(_) => {
                println!("服务器进程已终止");
                SERVER_RUNNING.store(false, Ordering::SeqCst);
                Ok("服务器已停止".to_string())
            }
            Err(e) => {
                eprintln!("停止服务器失败: {}", e);
                Err(format!("停止服务器失败: {}", e))
            }
        }
    } else {
        SERVER_RUNNING.store(false, Ordering::SeqCst);
        Ok("服务器已停止".to_string())
    }
}

#[tauri::command]
async fn get_server_status() -> Result<bool, String> {
    Ok(SERVER_RUNNING.load(Ordering::SeqCst))
}

#[tauri::command]
async fn open_in_browser(url: String) -> Result<(), String> {
    match webbrowser::open(&url) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("无法打开浏览器: {}", e)),
    }
}

#[tauri::command]
async fn get_system_info() -> Result<serde_json::Value, String> {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    
    let info = serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "total_memory": sys.total_memory(),
        "available_memory": sys.available_memory(),
        "cpu_count": sys.cpus().len(),
        "uptime": sys.uptime()
    });
    
    Ok(info)
}

#[tauri::command]
async fn handle_deep_link(url: String) -> Result<(), String> {
    println!("处理深度链接: {}", url);
    // 处理 video-space:// 协议链接
    // 可以解析链接中的参数并执行相应操作
    
    Ok(())
}

fn main() {
    env_logger::init();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 设置深度链接处理
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                app.deep_link().register_all("video-space")?;
            }

            // 创建托盘菜单
            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>);
            let hide_i = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>);
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>);
            
            let menu = MenuBuilder::new(app)
                .item(&show_i)
                .item(&hide_i)
                .separator()
                .item(&quit_i)
                .build()?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("Video Space")
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(handle_tray_event)
                .build(app)?;

            // 窗口初始化
            let main_window = app.get_webview_window("main").unwrap();
            
            // 自动启动服务器
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_server().await {
                    eprintln!("自动启动服务器失败: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_server,
            stop_server,
            get_server_status,
            open_in_browser,
            get_system_info,
            handle_deep_link
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}