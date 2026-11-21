# PolaPlayer for foobar2000

[English](README.md) · [完整安装指南（英文）](docs/INSTALL.md)

PolaPlayer 是面向 Windows 版 foobar2000 v2（64 位）的现代音乐播放器界面。以同一套界面访问本地曲库与 Navidrome / Subsonic 私有音乐服务器，兼顾高分辨率显示、同步歌词与 foobar2000 原有的播放能力。

## 主要功能

- 本地音乐与 Navidrome 双源曲库、歌单管理、搜索、我喜欢的音乐与随机漫游。
- 同步歌词、点击歌词跳转、Apple Music 风格全屏播放和实时频谱。
- 明暗及跟随系统主题、中英文切换、高 DPI 自适应。
- Windows 原生窗口拖拽贴靠、最大化按钮分屏布局与自绘标题栏。
- 首次启动设置向导：只使用本地音乐的用户无需安装或配置 Navidrome。

## 安装

1. 安装 [foobar2000 v2 64 位](https://www.foobar2000.org/download)、[Columns UI](https://www.foobar2000.org/components/view/foo_ui_columns) 和 [JSplitter](https://hydrogenaudio.org/index.php/topic,126743.0.html)（已测试 3.8.12）。需要云端音乐时再安装 [foo_navidrome](https://www.foobar2000.org/components/view/foo_navidrome)。
2. 下载仓库源码，将内容复制到 foobar2000 配置目录下的 `verdant` 文件夹（普通安装通常是 `%APPDATA%\foobar2000-v2\verdant`，便携版是 `profile\verdant`）。保留旧文件夹名称以兼容已有布局；先备份原配置。
3. 在 Columns UI 布局中放置一个全窗口 JSplitter 面板，打开其 Configure 窗口，加载以下脚本：

   ```js
   include(fb.ProfilePath + 'verdant\\main.js');
   ```

4. 可选：在已安装主题目录中运行 `native\register.ps1`，启用原生自绘标题栏与 Windows 分屏功能。此脚本只注册当前 Windows 用户的 COM 辅助组件，不需要管理员权限；可使用 `native\unregister.ps1` 卸载。
5. 启动后按欢迎向导选择音乐库及外观。已有用户可在顶栏「设置」重新配置。Navidrome 登录信息仍在 foobar2000 的首选项 → 工具 → Navidrome 中管理。

## 开源与鸣谢

本项目基于 [Verdant](https://github.com/superziper/verdant-foobar2000-theme)，保留原作者 superziper 的署名和 [MIT 许可证](LICENSE)，由 SpectorXCC 继续开发。第三方 foobar2000 组件不随仓库分发，见 [第三方说明](THIRD-PARTY-NOTICES.md)。

PolaPlayer 与 foobar2000、Navidrome、Spotify 及 Apple Music 官方均无附属关系。项目本身并非独立播放器或标准 `.fb2k-component`，需要 foobar2000 及上述组件。
