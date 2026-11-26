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

以上命令可从新检出的仓库根目录运行。每个 pytest 用例使用全新的 SQLite 文件，基准使用单独的临时目录和随机端口。签收全套时应看到 pytest 全部通过、基准 JSON 的 `status` 为 `passed`，且整个命令退出码为 0。

### 逐项复现与签收

需要单独复核时，先运行 `python run.py --prepare`，再在 PowerShell 中设置 `$py = '.\.venv\Scripts\python.exe'`。下表命令各自独立，可按任意顺序执行。

| 场景 | 仓库根目录命令 | 签收时核对 |
|---|---|---|
| A1 租户隔离 | `& $py -m pytest -v -k test_a1 tests` | Bob 读、撤销 East 证书及签发 East 课程均返回 404。West 导出的所有编号与 West 列表一致，数据库证书、操作、审计总数保持原值。 |
| A2 请求重试 | `& $py -m pytest -v -k test_a2 tests` | 串行重试、重建应用后重放、6 个客户端调用并发提交，分别核对完整响应相同。每轮一个逻辑操作，每张新证书一条签发审计。 |
| A3 幂等键冲突 | `& $py -m pytest -v -k test_a3 tests` | 分别只改课程、只改请求体，两次都是 409。恢复原请求并调换 JSON 字段顺序仍返回首次结果，三张表计数相同。 |
| A4 批量资格 | `& $py -m pytest -v -k 'test_a4 or test_audit_failure' tests` | 新库 East / Safety 101 中 Jordan Chen、Riley Zhang 获证，另四人各有跳过原因。注入一次审计写入失败后，1 人成功、1 人失败、4 人跳过，失败学员没有残留证书。 |
| A5 时区与日期排序 | `& $py -m pytest -v -k test_a5 tests` | 比较下文的两地固定时间，再用同一天内 ID 与签发时刻反序的三张证书核对列表、CSV、升序和降序。 |
| A6 导出与恢复 | `python run.py --benchmark` | 查看两次完整导出的耗时、行数、SHA-256 和并发列表状态。另一次导出读到 50,000 行时终止测试服务；同库同端口重启后，第三份完整 CSV 必须与前两份逐行一致。 |
| A7 撤销审计 | `& $py -m pytest -v -k test_a7 tests` | 对有效证书并发撤销 4 次，再重试 1 次。均返回已撤销，撤销时间相同，审计总数只增加 1。 |

**手动操作时使用新的演示库。** 在新的 PowerShell 窗口运行以下命令并打开 http://127.0.0.1:8010 。每次执行会生成新的数据库文件；停止服务并关闭此窗口即可结束本次演示。A2 和 A4 会消耗同一课程的可签发名额，单独复核首次签发人数时应各用一个新库。

```powershell
$env:CERT_DB_PATH = Join-Path $env:TEMP ("ocean-review-" + [guid]::NewGuid() + ".db")
python run.py --port 8010
```

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

### 已知问题与验证边界

- 学员目录会一次取回本租户的学员及选课记录，再由浏览器筛选选课。十万行基准覆盖证书列表与导出；学员目录的大数据量响应和渲染耗时未设上限。
- 自动化验证覆盖 HTTP、数据库和构建产物。按钮禁用、确认对话框和错误重试等浏览器交互仍依赖人工回归；以前的浏览器检查见 [验证记录](docs/verification.md)。
- 单独移走 `.venv` 并保留 `.runtime/python-dependencies.sha256` 时，启动脚本可能为新环境跳过依赖安装。遇到此情况可在新建的项目虚拟环境运行 `.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt`，再启动。

本仓库是可运行项目。正式提交还需完整 AI 原生会话导出、会话索引、关联 Git 提交的决策日志、工具操作记录和完整性声明；规划与子代理交互也要纳入。不能用代码或本 README 替代原始会话证据。

文档第 6 节的 `written-answers.md` 为候选人独立书面回答，本仓库未代写。正式考核的一小时计时及最终提交由候选人按考核安排管理；本地开发结果不等同于已完成提交。
