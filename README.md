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

前往 [Releases](https://github.com/Entropy-Increase-Team/napcat-plugin-delta-force/releases) 下载最新的 `napcat-plugin-delta-force.zip`，解压后放入 NapCat 的插件目录即可。

### 方式三：手动构建

```bash
git clone https://github.com/Entropy-Increase-Team/napcat-plugin-delta-force.git
cd napcat-plugin-delta-force
pnpm install
pnpm build
```

构建产物在 `dist/` 目录下，将其中的文件放入插件目录。

## 插件配置

> [!WARNING]
> 插件提供了 WebUI 配置面板，可在 NapCat 管理页面中直接配置，无需手动修改配置文件
> 
> 配置项说明：
> - `api_key`: API密钥，在[管理页面](https://df.shallow.ink/api-keys)创建
> - `clientID`: 客户端ID，在[管理页面](https://df.shallow.ink/)的个人信息获取（用户id）

## 功能列表

请使用 `三角洲帮助` 或 `^帮助` 获取完整帮助

### 个人类功能

- [x] QQ/微信扫码登录
- [x] QQ/微信授权登陆（网页登陆）
- [x] QQ/微信令牌手动刷新
- [x] QQ/微信-wegame登陆
- [x] QQCK登陆
- [x] Token绑定与切换
- [x] 角色绑定
- [x] 个人信息查询
- [x] 地图统计
- [x] 日报/周报数据
- [x] 战绩查询
- [x] 战绩推送（实时订阅）
- [x] 藏品/资产查询
- [x] 货币信息查询
- [x] 封号记录查询
- [x] 特勤处状态
- [x] 特勤处制造完成推送
- [x] 大红收藏海报
- [x] 大红收藏记录列表
- [x] 日报/周报订阅推送
- [x] AI评价战绩（支持多预设多模式）

### 工具类功能

- [x] 每日密码查询
- [x] 官方文章&公告
- [x] 社区改枪码（上传、查看、投票）
- [x] 干员信息查询
- [x] 健康状态查询
- [x] 物品查询搜索
- [x] 物品价格历史
- [x] 特勤处利润排行
- [x] 特勤处制造材料价格
- [x] 每日密码定时推送
- [x] 广播通知（WebSocket）

### 娱乐类功能

- [x] 随机音频/角色语音
- [x] 鼠鼠音乐
- [x] 角色语音合成（TTS）

## 命令示例

<details><summary>点击展开</summary>

| 命令 | 功能 | 示例 |
| --- | --- | --- |
| 三角洲登录 | QQ/微信扫码登录 | 提供二维码登录并绑定账号 |
| 三角洲信息 | 查询账号基本信息 | 显示昵称、等级、UID、资产等 |
| 三角洲日报 | 查询当日游戏数据 | 烽火地带/全面战场数据 |
| 三角洲周报 | 查询本周游戏数据汇总 | 含队友协作数据 |
| 三角洲战绩 | 查询游戏战绩 | 可查烽火/全面历史战绩 |
| 三角洲数据 | 查询个人数据统计 | K/D、胜率、场次等 |
| 三角洲账号 | 账号管理 | 查看已绑定账号列表 |
| 三角洲账号切换 | 切换激活账号 | 多账号间切换 |
| 三角洲帮助 | 查看帮助菜单 | 完整功能列表 |
| ^战绩 烽火 2 | 简写战绩查询 | 烽火地带第2页 |
| ^ai锐评 | AI锐评战绩 | 使用默认预设 |

</details>

## 鸣谢

- **API支持**：感谢[浅巷墨黎](https://github.com/dnyo666)整理并提供的三角洲行动API接口文档及后端
- **代码贡献**：
  - [@冷曦](https://github.com/Entropy-Increase-Team)：NapCat 版本迁移与开发
- **特别鸣谢**：
  - [NapCatQQ](https://github.com/NapNeko/NapCatQQ)：NapCat机器人框架
  - [三角洲行动官方](https://df.qq.com)：游戏数据支持
  - [繁星攻略组](https://space.bilibili.com/3546853731731919)：授权提供计算器算法和数据

## 支持与贡献

如果你喜欢这个项目，请不妨点个 Star🌟，这是对开发者最大的动力。

有意见或者建议也欢迎提交 [Issues](https://github.com/Entropy-Increase-Team/napcat-plugin-delta-force/issues) 和 [Pull requests](https://github.com/Entropy-Increase-Team/napcat-plugin-delta-force/pulls)。

## 许可证

本项目使用 [GNU AGPLv3](https://choosealicense.com/licenses/agpl-3.0/) 作为开源许可证。
