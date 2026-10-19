# 可选Windows／WSL桌面启动

标准跨平台入口是项目根目录的`npm run dev`，或构建后的`npm run start`。这里的脚本只为Windows上的WSL本地快捷启动提供便利，不是独立安装包。

`open-jiagoutu.ps1`调用WSL中的`launch-local.sh`：已有本项目4173生产服务则复用；没有时启动现有dist，检查页面可达后才打开默认浏览器。不会下载依赖、构建源码、切换端口或停止其他服务。

默认使用Windows当前默认WSL发行版和用户，不绑定开发者账号。需要指定时：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\open-jiagoutu.ps1 -Distribution Ubuntu-24.04 -LinuxUser your-user
```

可使用环境变量`JIAGOUTU_WSL_DISTRO`和`JIAGOUTU_WSL_USER`设置同样的本机偏好。快捷方式应指向当前项目内的脚本；项目移动后需要修改快捷方式路径，不把个人桌面路径写入仓库。

`-CheckOnly`执行相同健康检查但不打开浏览器。启动器缺构建、依赖或端口冲突时给出提示。服务日志位于WSL的`${XDG_RUNTIME_DIR:-/tmp}/jiagoutu-$UID-4173/server.log`。

固定4173保留生产浏览器工程地址；5173为开发地址，自动保存按地址隔离。更新构建前保存未应用参数和工程，不用启动器部署未验收源码。

`npm run test:tools`覆盖浏览器发现和Linux启动器；启动器测试使用独立临时目录与空闲测试端口，验证缺构建、外部占用保护、冷启动和复用，不停止用户服务。Windows路径与WSL整机冷启动另按实际环境验收。
