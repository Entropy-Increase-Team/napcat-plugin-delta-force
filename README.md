@ -1,30 +1,26 @@
![napcat-plugin-delta-force](https://socialify.git.ci/Entropy-Increase-Team/napcat-plugin-delta-force/image?description=1&font=Raleway&forks=1&issues=1&language=1&name=1&owner=1&pattern=Circuit%20Board&pulls=1&stargazers=1&theme=Auto)

# NapCat-Plugin-Delta-Force

- 一个适用于 [NapCat](https://github.com/NapNeko/NapCatQQ) 框架的三角洲行动游戏数据查询和娱乐功能插件

- 支持QQ/微信扫码登录或Token手动绑定，支持查询个人信息、日报、周报、战绩等游戏数据

- **使用中遇到问题请加QQ群咨询：631348711（插件反馈）| 932459332（API交流）**

> [!TIP]
> 三角洲行动是一款由腾讯琳琅天上工作室开发的FPS游戏，本插件旨在帮助玩家更方便地查询游戏数据，提升游戏体验。支持烽火地带和全面战场两种模式的数据查询。

> [!TIP]
> 插件采用统一后端处理，使用插件请前往管理页面进行注册登陆并获取apikey，如果需要部分功能，可选择订阅专业版（4.5元/月），费用仅供服务器维护

## 安装插件

### 方式一：下载 Release

前往napcat插件市场中搜索该三角洲行动，安装即可

### 方式二：下载 Release
### 方式一：Napcat插件商场下载

前往 [Releases](https://github.com/Entropy-Increase-Team/napcat-plugin-delta-force/releases) 下载最新的 `napcat-plugin-delta-force.zip`，解压后放入 NapCat 的插件目录即可。

### 方式三：手动构建
### 方式二：手动构建

```bash
git clone https://github.com/Entropy-Increase-Team/napcat-plugin-delta-force.git
@ -115,13 +111,27 @@ pnpm build
## 鸣谢

- **API支持**：感谢[浅巷墨黎](https://github.com/dnyo666)整理并提供的三角洲行动API接口文档及后端
- **原版插件**：[delta-force-plugin](https://github.com/dnyo666/delta-force-plugin)（Yunzai版本）
- **API功能参考**：
  - [deltaforce-酷曦科技](https://github.com/coolxitech/deltaforce) 参考QQ、微信等登陆部分
- **代码贡献**：
  - [@浅巷墨黎（Dnyo666）](https://github.com/dnyo666)：原版项目主要开发者
  - [@冷曦](https://github.com/Entropy-Increase-Team)：NapCat 版本迁移与开发
  - [@MapleLeaf](https://github.com/MapleLeaf2007)：后端基础架构开发
  - [@Admilk](https://github.com/Admilkk)：后端基础架构开发
- **特别鸣谢**：
  - [NapCatQQ](https://github.com/NapNeko/NapCatQQ)：NapCat机器人框架
  - [三角洲行动官方](https://df.qq.com)：游戏数据支持
  - [繁星攻略组](https://space.bilibili.com/3546853731731919)：授权提供计算器算法和数据

## 其他框架

- **云崽**：[delta-force-plugin](https://github.com/Dnyo666/delta-force-plugin)
- **NapCat**：[napcat-plugin-delta-force](https://github.com/Entropy-Increase-Team/napcat-plugin-delta-force)
- **Nonebot2**：[nonebot-plugin-delta-force](https://github.com/Entropy-Increase-Team/nonebot-plugin-delta-force)
- **Koishi**：[koishi-plugin-delta-force](https://github.com/Entropy-Increase-Team/koishi-plugin-delta-force)
- **Karin**：[karin-plugin-delta-force](https://github.com/Entropy-Increase-Team/karin-plugin-delta-force)

## 支持与贡献

如果你喜欢这个项目，请不妨点个 Star🌟，这是对开发者最大的动力。
