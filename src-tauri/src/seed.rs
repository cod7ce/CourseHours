//! 演示数据（仅 debug 构建、且设置了 COURSEHOURS_SEED=1 时在空库上写入）。
//! 全部走真实的事务函数，保证账本不变量成立。

use chrono::{Datelike, Duration};
use rusqlite::{params, Connection};

use crate::commands::recharge::{recharge_inner, RechargeInput};
use crate::commands::rollcall::confirm_rollcall_inner;
use crate::commands::scheduling::generate_inner;
use crate::core::hours::Mark;
use crate::core::recharge::OwedMode;
use crate::db::{fmt_date, new_id, now_ms, today};

pub fn seed_if_requested(conn: &mut Connection) {
    if std::env::var("COURSEHOURS_SEED").ok().as_deref() != Some("1") {
        return;
    }
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM student", [], |r| r.get(0)).unwrap_or(0);
    if n > 0 {
        return;
    }
    if let Err(e) = seed(conn) {
        eprintln!("seed failed: {}", e);
    }
}

fn seed(conn: &mut Connection) -> crate::error::AppResult<()> {
    let now = now_ms();
    let classes = [
        ("Starters A 班", "#B75E36", "A 教室", "2,4", "09:30", "11:00", 10),
        ("Movers B 班", "#4C6F55", "A 教室", "2,4", "14:00", "15:30", 10),
        ("Movers C 班", "#3F6B6E", "B 教室", "1,3", "16:30", "18:00", 10),
        ("Flyers 冲刺班", "#8C4A63", "B 教室", "4,6", "18:30", "20:00", 8),
        ("Phonics 启蒙班", "#92701F", "A 教室", "6", "10:00", "11:30", 10),
    ];
    let names: [&[(&str, &str)]; 5] = [
        &[("周子谦", "Chris"), ("高梓涵", "Hannah"), ("顾南", "Nate"), ("白桐", "Tina"), ("秦朗", "Leo"), ("马一鸣", "Owen"), ("孙悦", "Yoyo"), ("杜若", "Ruby")],
        &[("林小满", "Lily"), ("陈亦航", "Ethan"), ("苏念", "Nina"), ("何屿", "Hugo"), ("黄一诺", "Nora"), ("徐牧野", "Max"), ("罗祎", "Ivy"), ("沈清和", "Cindy"), ("温亦可", "Kiki")],
        &[("郑允儿", "Ella"), ("李昭", "Leon"), ("方知", "Zoe"), ("许愿", "Wish"), ("毛豆", "Bean"), ("钱多多", "Duo"), ("宋清", "Sunny"), ("彭然", "Ryan")],
        &[("吴与安", "Owen"), ("邵一", "Yi"), ("崔洋", "Young"), ("俞乐", "Joy"), ("章鱼", "Zoey"), ("江月", "Luna")],
        &[("叶子", "Leaf"), ("程一诺", "Nono"), ("邹小小", "Mini"), ("汪汪", "Wang"), ("霍思", "Sisi"), ("金宝", "Jinbao"), ("冯小北", "Bei")],
    ];
    let mut class_ids = Vec::new();
    let mut student_ids: Vec<Vec<String>> = Vec::new();
    for (i, (name, color, room, wd, st, et, cap)) in classes.iter().enumerate() {
        let cid = new_id();
        conn.execute(
            "INSERT INTO klass(id, name, color, room, capacity, duration_min, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 90, 'active', ?6, ?6)",
            params![cid, name, color, room, cap, now + i as i64],
        )?;
        conn.execute(
            "INSERT INTO recurrence_rule(id, class_id, weekdays, start_time, end_time, room, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![new_id(), cid, wd, st, et, room, now],
        )?;
        let mut ids = Vec::new();
        for (j, (n, en)) in names[i].iter().enumerate() {
            let sid = new_id();
            let enrolled_on = if j == names[i].len() - 1 && i == 1 { fmt_date(today() - Duration::days(15)) } else { "2026-03-05".to_string() };
            conn.execute(
                "INSERT INTO student(id, name, en_name, status, enrolled_on, created_at, updated_at) VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?5)",
                params![sid, n, en, enrolled_on, now],
            )?;
            conn.execute(
                "INSERT INTO enrollment(id, student_id, class_id, joined_on, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id(), sid, cid, enrolled_on, now],
            )?;
            ids.push(sid);
        }
        class_ids.push(cid);
        student_ids.push(ids);
    }
    // 两个停课学生
    for (n, en) in [("赵停", "Pause"), ("钱走", "Left")] {
        conn.execute(
            "INSERT INTO student(id, name, en_name, status, enrolled_on, created_at, updated_at) VALUES (?1, ?2, ?3, 'paused', '2026-01-10', ?4, ?4)",
            params![new_id(), n, en, now],
        )?;
    }
    // 课包：大部分 24 次 ¥3,600；几个人少买点，制造欠课时
    for (ci, ids) in student_ids.iter().enumerate() {
        for (j, sid) in ids.iter().enumerate() {
            let (sessions, cents) = match (ci, j) {
                (1, 0) => (10, 150000),  // 林小满：会欠
                (3, 0) => (10, 168000),  // 吴与安：会欠
                (0, 0) => (12, 180000),  // 周子谦：刚好用完
                (1, 5) => (16, 240000),
                (1, 3) => (17, 255000),
                _ => (24, 360000),
            };
            recharge_inner(
                conn,
                RechargeInput { student_id: sid.clone(), sessions, amount_cents: cents, purchased_on: Some("2026-07-02".into()), method: Some("wechat".into()), mode: Some(OwedMode::Offset), note: None },
            )?;
        }
    }
    // 回填 7 月以来的课次并点名到昨天
    let start = chrono::NaiveDate::from_ymd_opt(2026, 7, 6).unwrap();
    let weeks = ((today() - start).num_days() / 7 + 3) as i64;
    generate_inner(conn, start, weeks)?;
    let yesterday = fmt_date(today() - Duration::days(1));
    let mut st = conn.prepare("SELECT id, class_id, date FROM session WHERE date <= ?1 ORDER BY date, start_time")?;
    let past: Vec<(String, String, String)> = st
        .query_map(params![yesterday], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(st);
    let mut k = 0usize;
    for (sid, cid, date) in past {
        let ci = class_ids.iter().position(|c| c == &cid).unwrap();
        let d = crate::db::parse_date(&date)?;
        // 跳过 7/6 之前入班的判断：本月新增的温亦可只参加入班后的课
        let mut marks = Vec::new();
        for (j, stu) in student_ids[ci].iter().enumerate() {
            let enrolled: String = conn.query_row("SELECT enrolled_on FROM student WHERE id = ?1", params![stu], |r| r.get(0))?;
            if enrolled > date {
                continue;
            }
            k += 1;
            let status = match (k + j) % 17 {
                0 => "leave",
                5 => "absent",
                9 => "late",
                _ => "present",
            };
            marks.push(Mark { student_id: stu.clone(), status: status.into() });
        }
        if d.weekday().number_from_monday() == 3 && d.month() == 9 && d.day() == 9 {
            conn.execute("UPDATE session SET status = 'cancelled', cancel_reason = '老师出差' WHERE id = ?1", params![sid])?;
            continue;
        }
        confirm_rollcall_inner(conn, &sid, &marks)?;
        // 把发生时间改到课次当天，让报表按月归集
        let ms = crate::db::date_start_ms(d) + 15 * 3600 * 1000;
        conn.execute("UPDATE ledger_entry SET occurred_at = ?2 WHERE session_id = ?1", params![sid, ms])?;
        conn.execute("UPDATE session SET taken_at = ?2 WHERE id = ?1", params![sid, ms])?;
    }
    // 8 月又充值一次的几个人
    for (ci, j, s, c) in [(0usize, 4usize, 24i64, 360000i64), (2, 0, 24, 372000), (1, 1, 12, 192000)] {
        recharge_inner(
            conn,
            RechargeInput { student_id: student_ids[ci][j].clone(), sessions: s, amount_cents: c, purchased_on: Some(fmt_date(today() - Duration::days(1))), method: Some("alipay".into()), mode: Some(OwedMode::Offset), note: None },
        )?;
    }
    // 一节临时加课
    conn.execute(
        "INSERT INTO session(id, class_id, date, start_time, end_time, room, kind, status, note, created_at, updated_at) VALUES (?1, ?2, ?3, '19:00', '20:30', 'A 教室', 'extra', 'planned', '苏念 一对一补课', ?4, ?4)",
        params![new_id(), class_ids[1], fmt_date(today() + Duration::days(1)), now],
    )?;
    Ok(())
}

/// 开发用：轮询 COURSEHOURS_DEV_BRIDGE 指向的文件，内容变化时在主窗口 eval 该 JS。
/// 只在 debug 构建存在，用于从命令行驱动界面做截图验证。
pub fn spawn_dev_bridge(app: tauri::AppHandle) {
    use tauri::Manager;
    let Some(path) = std::env::var("COURSEHOURS_DEV_BRIDGE").ok() else { return };
    std::thread::spawn(move || {
        let mut last: Option<std::time::SystemTime> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            let Ok(m) = meta.modified() else { continue };
            if last == Some(m) {
                continue;
            }
            last = Some(m);
            let Ok(js) = std::fs::read_to_string(&path) else { continue };
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval(&js);
            }
        }
    });
}
