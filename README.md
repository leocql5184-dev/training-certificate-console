# Ocean Academy · 学习与认证工作台

FastAPI + React + TypeScript + SQLite 实现的本地多租户培训管理后台。管理员查看本租户的课程、学员、选课进度与证书，批量签发、撤销、查询并导出 CSV。

## 一条命令启动

前置条件：Python 3.12+、Node.js 22.12+ 或 24 LTS、npm；首次安装依赖需要联网。在仓库根目录运行：

```powershell
python run.py
```

脚本自动创建本地 `.venv`、安装锁定依赖、构建 React、初始化 SQLite 演示数据，并启动完整应用。打开 http://127.0.0.1:8000 。使用 `python run.py --port 8010` 可以换端口。按 Ctrl+C 停止服务。数据库在 `data/certificates.db`；再次启动不会重置已经签发或撤销的记录。首次启动前请勿删除锁文件。

## 操作路径

1. 顶部选择 Alice / East 或 Bob / West。管理员身份决定数据范围。
2. 在“课程与选课”查看课程和学员学习进度；选择课程进行批量签发，逐人查看成功、跳过及失败原因。
3. 在“证书管理”按姓名或编号搜索，按课程/状态筛选，调整排序和分页；打开详情查看证书与审计记录，确认后撤销。
4. 使用“导出 CSV”导出当前筛选条件下的全部结果，保留当前排序；不会只导出当前页。
5. 在“学员目录”和“审计日志”查看学员汇总及实际签发/撤销历史。

## 演示身份与数据

| 身份 header | 邮箱 | 租户 | 时区 |
|---|---|---|---|
| `X-Actor-Id: alice` | alice@east.test | East | Australia/Sydney |
| `X-Actor-Id: bob` | bob@west.test | West | Australia/Perth |

这是考核要求的演示身份选择，不是生产登录或认证系统。接口文档位于 `/docs`。

两边都有 Alex Lee、Jordan Chen、Morgan Wang、Taylor Lin、Casey Wu、Riley Zhang；课程均为 Safety 101、Data Privacy、Workplace Essentials。名称一致，数据库主键和租户归属独立。每个租户默认有 18 条学习记录、7 张证书（5 张有效、2 张已撤销）。记录覆盖已完成可签发、学习中、未开始、已获证、已撤销、跨本地日期等情况。

实体与关联见 [数据模型](docs/data-model.md)，接口和实现约定见 [架构文档](docs/architecture.md)。

## 验证

构建前端并运行隔离数据库上的验收测试：

```powershell
python run.py --verify
```

运行完整验收及真实 HTTP 十万行导出基准：

```powershell
python run.py --verify --benchmark
```

测试使用临时数据库，不修改正在使用的演示数据。基准启动独立的本地服务，导出两次并检查耗时、行数、顺序及导出期间列表可用性。

### A1：租户隔离

分别切换 Alice/Bob 查看同名课程和学员。使用 Alice 的证书 ID，携带 `X-Actor-Id: bob` 访问详情或撤销接口，应返回 404。Bob 调用 East 课程的签发接口同样返回 404；证书、操作记录和审计数量不增加。列表与导出只能返回当前管理员的租户数据。

### A2：串行与并发重试

向 `POST /api/courses/east-course-safety/issue` 发送 JSON `{}`，携带 `X-Actor-Id: alice` 和 `Idempotency-Key: demo-retry-1`。重复及并发发送相同请求，必须得到相同 operation_id 和结果；每次实际签发只有一条审计。自动化测试还检查重新打开数据库后的结果重放。

### A3：幂等键误用

先按 A2 发起请求，再使用相同 key 改为 `east-course-privacy`，或更换 JSON payload，应返回 409。原结果不得被覆盖。

### A4：逐人结果

对 Safety 101 批量签发。初始化后有 2 人可签发；其余已获证、已撤销、学习中和未开始的学员均应跳过并给出原因。页面展示 `issued / skipped / failed` 对应结果。撤销后不重新签发是本次明确的业务取舍。

### A5：时区和本地日期

查看两边 Alex Lee 的 Safety 101 历史证书。UTC 都是 `2026-01-10T13:30:00Z`，East 显示 `2026-01-11 00:30`，West 显示 `2026-01-10 21:30`。CSV 日期分别为 2026-01-11 和 2026-01-10。签发日期排序采用租户本地日历日期，ID 作为稳定的第二排序键。Windows 的 IANA 时区数据由声明的 tzdata 依赖提供。

### A6：十万行导出

运行上述 `--benchmark` 命令，要求每次导出不超过 60 秒，并发的列表请求成功，匹配行数精确且两次顺序一致。也可以手动生成独立数据库：

```powershell
.\.venv\Scripts\python.exe -m backend.seed_large --count 100000 --tenant east --db data/large-demo.db
$env:CERT_DB_PATH = 'data/large-demo.db'
python run.py --port 8010
```

该命令不改变默认快速启动数据。退出测试后使用 `Remove-Item Env:CERT_DB_PATH` 恢复默认数据库选择。

### A7：重复撤销

打开一张有效证书并确认撤销，再向同一 `/api/certificates/{id}/revoke` 接口发送相同请求。状态维持已撤销，撤销审计仍只有一条。自动化测试同时检查并发撤销。

## 实现取舍与范围

- 服务器从 actor 映射租户；复合外键在数据层阻止跨租户关联。前端参数不能切换归属。
- 同租户同课程同学员最多一张证书，撤销保留记录且不释放唯一关系。
- 幂等键在租户内唯一；请求摘要包含课程及 payload；最终逐人结果持久化。
- 证书、签发审计和操作结果同事务提交；撤销状态和撤销审计同事务提交。
- 列表与导出共用查询规则。CSV 分批读取、流式发送，日期按租户时区计算；文本单元格做公式注入防护。
- SQLite 的写事务会串行化，适合这次本地考核规模。性能结论以实际基准机器为准，不承诺生产负载能力。
- 没有实现生产认证、通知、云部署或证书 PDF，这些不属于本项目范围。

## 考核提交材料

本仓库是可运行项目。正式提交还需完整 AI 原生会话导出、会话索引、关联 Git 提交的决策日志、工具操作记录和完整性声明；规划与子代理交互也要纳入。不能用代码或本 README 替代原始会话证据。

文档第 6 节的 `written-answers.md` 为候选人独立书面回答，本仓库未代写。正式考核的一小时计时及最终提交由候选人按考核安排管理；本地开发结果不等同于已完成提交。
