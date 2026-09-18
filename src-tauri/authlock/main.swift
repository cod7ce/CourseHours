// authlock：用 macOS LocalAuthentication 做一次本机身份验证。
// 有 Touch ID 走 Touch ID，没有（或失败几次）自动退到登录密码。退出码：0 通过，1 未通过，2 不可用。
import Foundation
import LocalAuthentication

let reason = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "查看金额"
let ctx = LAContext()
ctx.localizedCancelTitle = "取消"
var err: NSError?
let policy = LAPolicy.deviceOwnerAuthentication
guard ctx.canEvaluatePolicy(policy, error: &err) else {
    FileHandle.standardError.write(("unavailable: " + (err?.localizedDescription ?? "")).data(using: .utf8)!)
    exit(2)
}
let sem = DispatchSemaphore(value: 0)
var ok = false
var msg = ""
ctx.evaluatePolicy(policy, localizedReason: reason) { success, error in
    ok = success
    msg = error?.localizedDescription ?? ""
    sem.signal()
}
sem.wait()
if ok { exit(0) }
FileHandle.standardError.write(msg.data(using: .utf8)!)
exit(1)
