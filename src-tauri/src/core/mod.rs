//! 纯函数业务逻辑层。不碰数据库、不碰 Tauri。
//! 输入是普通结构体，输出是「要写哪些行」的描述，由 commands 层执行事务。

pub mod hours;
pub mod packages;
pub mod recharge;
pub mod scheduling;
