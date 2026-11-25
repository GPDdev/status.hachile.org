# Hachile 站群运行状态

<div align="center"><img alt="巡检与部署" src="https://github.com/GPDdev/status.hachile.org/actions/workflows/status.yml/badge.svg"><img alt="许可证 MIT" src="https://img.shields.io/badge/license-MIT-green"><img alt="站群版本 1.16" src="https://img.shields.io/badge/launch-v1.16-blue"><img alt="Python 和 JavaScript" src="https://img.shields.io/badge/language-Python%20%2F%20JavaScript-lightgrey"></div>

在 [status.hachile.org](https://status.hachile.org/) 查看 Hachile 公开站点的访问情况、检查时间和故障记录，也可以从树形目录访问各站，阅读 Hachile 宗旨与完整更新日志。

[检查口径](#检查口径) / [本地运行](#本地运行) / [目录与历史维护](#目录与历史维护) / [数据接口](#数据接口) / [许可证](#许可证)

## 检查口径

GitHub Actions 计划每 15 分钟巡检一次，实际执行时间取决于任务排队情况。监测程序从运行节点向每个站点的公开入口发送 GET 请求，跟随重定向，最终返回 HTTP 2xx 时记为可访问。首次失败后再请求一次，连续失败才记为异常。这项检查只覆盖入口页面，登录、支付等站内操作需要另行验证。

故障起止时间分别是首次观测到异常和其后首次观测到恢复的时间。连续多轮失败合并在一条记录中。页面以北京时间展示结果，异常站点排在前面。浏览器打开时每分钟重新读取快照，超过一小时没有新检查会显示数据过期提示。

## 本地运行

在仓库根目录运行以下命令，使用 Python 3 预览页面。随仓库提供的空快照用于初次启动，页面会显示待检查。

```sh
python -m http.server 8000
```

打开 [本地页面](http://localhost:8000/)。执行一次实际巡检并刷新页面，可看到当前网络的探测结果。

```sh
python scripts/check_sites.py --directory index.html --output data/status.json
python -m unittest discover -s tests
```

第二次及以后的本地巡检带上 `--previous data/status.json` 即可沿用已有记录。生产巡检从独立的 `monitor-data` 分支加载历史。要立即在生产节点复查，在 [Actions](https://github.com/GPDdev/status.hachile.org/actions/workflows/status.yml) 选择 **Run workflow**。

## 目录与历史维护

树形目录、宗旨、更新日志的来源是 [Site 仓库](https://github.com/GPDdev/site.hachile.org)。每次发布会读取该仓库的最新内容，在状态页目录中同时列出 Site 自身，再从目录提取巡检目标。新增公开站点时，在来源目录添加入口即可。可使用 Node.js 22 在本地预览同步后的页面。

```sh
node scripts/sync-showcase.mjs ../site.hachile.org/index.html
```

每轮快照和故障记录写入 `monitor-data` 分支，GitHub Pages 发布本轮页面与 JSON。定时任务和手动任务共用部署队列。监测任务本身失败时，线上保留上次已发布的结果。站点目录或故障展示有问题，可以在 [Issues](https://github.com/GPDdev/status.hachile.org/issues) 提交对应网址与观测时间。

## 数据接口

公开地址为 [data/status.json](https://status.hachile.org/data/status.json)。JSON 中的时间使用 UTC。

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 当前格式版本为 1 |
| `checkedAt` | 本轮检查完成时间，空快照为 null |
| `sites` | 各站名称、URL、状态、检查时间、HTTP 状态码和异常说明 |
| `incidents` | 故障站点、首次发现时间、恢复时间和原因，恢复时间为空表示尚未观测到恢复 |

## 许可证

采用 [MIT License](LICENSE)。树形展示及插画沿用 The Hachile Project 的 MIT 授权。
