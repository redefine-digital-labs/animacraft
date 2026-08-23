# Animacraft Fresh Maker v8 Mainnet 发布规格

状态：`EXECUTABLE SPEC / FAIL-CLOSED`

本规格定义 Fresh Maker v8 从可复现构建、七包 Mainnet 发布、协议初始化、产品目录 bootstrap、链上回读、源码验证，到 Vercel 切流的唯一发布路径。实现和执行不得补猜未给出的密钥、对象、commitment 或链上结果；任何不确定结果必须停在同一个已签名交易上恢复。

## 1. 目标、范围与完成定义

本阶段必须交付：

1. 用下文锁定的官方 Sui 工具链，从一个干净 Git 提交可复现地构建七个 Move 包；
2. 按固定依赖顺序在 Sui Mainnet 发布七包，保存每个原始包、可调用包和 `UpgradeCap` 的精确证据；
3. 初始化 Core 的 Mainnet USDC treasury，并启用协议；
4. 用三类 artifact commitment 认证七包，创建一个 `ProductReleaseCatalogV8` 和六个包级共享配置；
5. 对交易、对象、模块字节、依赖、type origin、commitment 和配置做独立回读；
6. 从回读证据生成无占位符的客户端配置，经 preview 验证后切换 Vercel production；
7. 在任意进程崩溃、RPC 超时或广播结果不明时，只查询或重播完全相同的已签名字节，绝不替换签名。

不属于本阶段自动完成条件：

- 获取、创建、轮换或猜测 Enoki API key；
- 把任何 Enoki/API 凭据放入交易、链上对象、Git、构建产物、浏览器配置或 Vercel 静态资源；
- 在未取得服务端凭据路径时宣称 protected-decryption 已可用；
- 自动升级、删除、隐藏或“回滚”已经发布的 Sui 包；
- 为失败或结果不明的 ordinal 另签一笔替代交易。

发布完成分成两个相互独立的结论：

- **Chain release complete**：七包发布、init、bootstrap、回读和源码验证全部通过。它不依赖 Enoki API key。
- **Production deployment complete**：Vercel preview、production promote 和 custom domain 对同一 chain certificate/config/commit 的复验全部通过；它不得先于 chain release complete。
- **Protected-decryption complete**：在 chain release complete 之后，Enoki key 仅由可信服务端代理持有，并通过真实 Mainnet Seal 加解密验收。当前外部输入未提供该 key，因此此结论必须保持 `BLOCKED_EXTERNAL_SECRET`，不得影响包发布和链上 bootstrap，也不得被伪装为已通过。

## 2. 锁定的发布身份

### 2.1 Sui 工具链

发布只接受以下精确身份；任一字段漂移均产生新 release，不得复用旧 WAL：

| 字段 | 锁定值 |
| --- | --- |
| CLI version | `sui 1.77.2-51d177ad7d65` |
| Sui source commit | `51d177ad7d65102fc368b582408f466d97b31548` |
| CLI binary SHA-256 | `91ec4642a3650d65af334728c09e19972833c12f27eafeccc3ce8cc2ac3e007c` |
| Move framework revision | `73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1` |
| Protocol version | `133` |
| `object_runtime_max_num_cached_objects` | `1000` |
| `object_runtime_max_num_store_entries` | `1000` |

二进制的绝对路径不进入 commitment；执行前必须重新计算文件 SHA-256，并从该二进制读取 version。不得用同版本号但不同哈希的本地或下载后二进制替代。

### 2.2 Mainnet 身份

| 字段 | 锁定值 |
| --- | --- |
| Network | `mainnet` |
| Full chain/genesis identifier | `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S` |
| Legacy chain identifier | `35834a8a`，仅兼容展示；不得单独作为链身份 |
| Planned sender / gas owner | `0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f` |
| Payment coin | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |

每次构建、dry-run、签名前查询和广播都必须校验完整 chain identifier。RPC/gRPC URL 是可更换的传输端点，不是链身份；端点返回不一致链身份时立即退出。

## 3. 七包 DAG、角色和 ordinal

固定角色顺序为：

| Ordinal | Role | Move package | 生产依赖 |
| ---: | --- | --- | --- |
| 0 | Core | `animacraft_v8_core` | Sui |
| 1 | Seal | `animacraft_v8_seal` | Sui, Core |
| 2 | Runtime | `animacraft_v8_runtime` | Sui, Core, Seal |
| 3 | Output | `animacraft_v8_output` | Sui, Core, Seal, Runtime |
| 4 | Physical | `animacraft_v8_physical` | Sui, Core, Output, Runtime |
| 5 | Market | `animacraft_v8_market` | Sui, Core, Output, Physical, Runtime |
| 6 | Release | `animacraft_v8_release` | Sui, Core, Seal, Runtime, Output, Physical |
| 7 | Protocol init | 同一 Core 调用 | Core, Mainnet USDC |
| 8 | Catalog bootstrap | 七包调用 | ordinals 0–7 的已验证结果 |
| 9 | Verify/export | 只读 | ordinals 0–8 的最终证据 |

`animacraft_v8_market` 对 Release 的引用仅是 dev dependency，不进入 Market 生产字节码或发布 DAG。Release 生产依赖也不包含 Market；bootstrap PTB 可以直接把 Market marker 作为 Core 认证调用的 type argument。

每个包首次发布时 `originalPackageId == callablePackageId == created package ID`。未来升级不得修改本 release 的原始证据；升级必须产生新的 callable ID、新 ABI/package commitment 和新的 catalog。

## 4. 可复现 artifact commitment v1

### 4.1 共同 canonical JSON 规则

三类 commitment 都是：

```text
sha256(UTF8(canonicalJson(document)))
```

结果是 32 bytes；审计文件表示为 64 个小写十六进制字符，不加 `0x`，传给 Move 时转换为精确 `vector<u8>`。

`canonicalJson` 必须满足：

1. 只接受 `null`、布尔、字符串、数组和 plain record；拒绝 `undefined`、函数、symbol、BigInt、非 plain prototype、accessor、循环、稀疏数组和数组附加字段；
2. 本规格中的所有整数都编码成无符号 canonical 十进制字符串：`0` 或 `[1-9][0-9]*`；不得出现 JSON number、负零、指数或前导零；
3. record key 在每一层按 `compareMakerV8ProtocolText` 排序，即 ECMAScript UTF-16 code-unit 的 `<` / `>` 顺序，不用 locale、ICU 或 UTF-8 byte order；
4. 数组严格保留 schema 指定的顺序；只有下文明示为 set 的数组先按指定 key 排序；
5. 输出是 `JSON.stringify` 等价的紧凑 JSON，无空白、注释或尾逗号；
6. 字符串不做隐式 Unicode normalization；拒绝 unpaired surrogate，随后用 UTF-8 编码；
7. Sui ID 一律为小写 `0x` 加 64 个十六进制字符；SHA-256 一律为 64 个小写十六进制字符；Base64 一律为 RFC 4648 padded canonical form；
8. 相对路径使用 `/`，不得包含空段、`.`、`..`、反斜杠或绝对路径。

artifact 文件必须保存 canonical JSON 原文、其 UTF-8 byte length 和 SHA-256。解析后重编码不完全相等即失败。

### 4.2 Source artifact

每个角色的 source document 使用以下精确 shape：

```json
{
  "domain": "animacraft-v8/source-artifact/v1",
  "files": [
    {
      "byteLength": "<decimal>",
      "path": "<package-relative-path>",
      "sha256": "<lower-hex>"
    }
  ],
  "packageName": "<Move package name>",
  "release": {
    "gitCommit": "<40 lower-hex>",
    "gitTree": "<40 lower-hex>"
  },
  "role": "<core|seal|runtime|output|physical|market|release>",
  "toolchain": {
    "frameworkRevision": "73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1",
    "suiBinarySha256": "91ec4642a3650d65af334728c09e19972833c12f27eafeccc3ce8cc2ac3e007c",
    "suiSourceCommit": "51d177ad7d65102fc368b582408f466d97b31548",
    "suiVersion": "1.77.2",
    "suiVersionOutput": "sui 1.77.2-51d177ad7d65"
  }
}
```

协议 `133` 与 `1000/1000` 不混入 toolchain 子对象；它们由同一 execution plan 的独立 `protocolProfile` 精确绑定，因此仍属于 `executionPlanId`，且可在每次签名前从 Mainnet 重读比较。

`files` 恰好包含该包的：

- `Move.toml`；
- `Move.lock`；
- `sources/**/*.move`。

文件按 `path` 的 protocol text order 排序。不得包含 build、test、probe、README、生成的 `Published.toml` 或工作区外文件。每个哈希针对 Git checkout 中的原始 bytes；不得换行转换。Git worktree 必须无 tracked/untracked 发布相关改动，`gitCommit` 必须等于 `HEAD`，`gitTree` 必须等于 `HEAD^{tree}`。

### 4.3 Package artifact

每个角色的 package document 使用以下 shape：

```json
{
  "buildDigest": "<32-byte lower-hex>",
  "dependencies": ["<normalized package ID>"],
  "domain": "animacraft-v8/package-artifact/v1",
  "modules": [
    {
      "byteLength": "<decimal>",
      "bytecodeBase64": "<canonical base64>",
      "name": "<Move module name>",
      "sha256": "<lower-hex>"
    }
  ],
  "packageName": "<Move package name>",
  "role": "<role>"
}
```

约束：

- `modules` 按 module `name` 排序；名字必须唯一；`sha256` 和 `byteLength` 针对 Base64 解码后的原始 Move bytecode；
- `dependencies` 是 build dump 的全部 normalized dependency package IDs，去重后按规范化 ID 排序；其中产品依赖必须等于先前 ordinal 已回读的 package ID；
- `buildDigest` 是官方 build dump 返回的 32 bytes，不采用日志文本、路径或时间戳；
- document 不包含本包新创建的 package ID，因此其承诺的是精确代码和依赖；发布 ID 由链上 transaction/readback evidence 另行绑定；
- bootstrap 前，必须把本地 module bytes 与 Mainnet package object 的每个同名 module 做精确比较：仅允许 Sui publish 把 module 中唯一一段连续 32-byte `0x0` self address 替换为 effects 认证的 package ID；归一化该协议变换后必须 byte-for-byte 相等，current/historical package module maps 也必须原样相等。

### 4.4 ABI artifact

ABI 只能从已发布包的官方 Sui gRPC Move package descriptor 生成，不能从手写清单或源代码正则推断。document 使用：

```json
{
  "domain": "animacraft-v8/abi-artifact/v1",
  "modules": [
    {
      "datatypes": ["<normalized datatype descriptor>"],
      "functions": ["<normalized function descriptor>"],
      "name": "<module name>"
    }
  ],
  "packageName": "<Move package name>",
  "role": "<role>"
}
```

规范化必须是 allowlist 投影：

- module 按 name 排序；datatype 和 function 按 name 排序；重复 name 失败；
- datatype 保留 name、abilities、type parameters，以及按声明顺序排列的 struct fields 或 enum variants/fields；
- function 保留 name、visibility、entry 标志、type parameters、parameters 和 return types；参数、返回值及 type-parameter 顺序不变；
- ability set 按固定顺序 `copy, drop, store, key` 输出；所有 Move type/address/package ID 使用一种递归 canonical type shape 和规范化 32-byte ID；
- 删除且只删除文档注释、源码路径、源码位置/span、编译器展示文本以及服务端分页/传输 metadata；
- gRPC descriptor 出现 v1 schema 不认识的语义字段时 fail closed，不得静默丢弃；
- 规范化后的 module names 必须与 package artifact 完全相等。

ABI artifact 可在 package publish 成功并取得 descriptor 后生成，但必须在 ordinal 8 bootstrap 前写入 release artifact、重算三类 commitment 并通过回读。链上 catalog 中每个 role 的 `source_commitment`、`package_commitment`、`abi_commitment` 必须精确等于上述 32-byte 结果。

## 5. Seal policy 和外部凭据边界

### 5.1 Mainnet committee 候选

当前唯一允许进入发布候选集的 Mainnet committee 是：

| 字段 | 值 |
| --- | --- |
| committee/key-server object ID | `0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595` |
| exact Move type | `0x9636e0c761e7476b8579cb13d543838e3732ca482dc0a64f086f57b60c024e23::key_server::KeyServer` |
| exact ObjectOwner | `0x9606ed8c994ac43bc9bf03378e5cbec269050311a47699121245e829f688bfae` |
| canonical object BCS SHA-256 | `8573bed5b646dab4f03b12c212eab74ad02cd1bd4d4996191ac9c815fccc8203` |
| decoded BCS fields | `id=<committee ID>, first_version=2, last_version=2` |
| weight | `1` |
| outer Move threshold | `1` |
| aggregator URL | `https://seal-aggregator-mainnet.mystenlabs.com` |
| credential header name | `X-API-Key` |

“候选”不是对端点可用性或解密成功的宣称。bootstrap 前须至少从 Mainnet 回读对象存在性和类型，并确认 ID 规范化；有凭据后还须用官方 `@mysten/seal` 的 key-server verification 和真实 protected asset 流程验收。

`new_seal_policy_config_v8` 的链上数组固定为：

```text
key_server_ids = [0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595]
weights        = [1]
threshold      = 1
```

如果该对象在执行时的完整 type、ObjectOwner、canonical BCS、decoded fields 任一项不等于上表批准快照，必须在 ordinal 8 之前停止；不得用后缀匹配、任意 `ObjectOwner` 或未知对象替代。对象 reference/version/digest/previousTransaction 仍须逐次记录进 READY 证书，用于说明本次具体观察。服务器数组一般规则是按 key-server ID 严格排序、无重复、正权重，`0 < threshold <= sum(weights)`。

### 5.2 `keyServerSetCommitment` v1

哈希以下 canonical JSON：

```json
{
  "chainIdentifier": "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
  "domain": "animacraft-v8/seal-key-server-set/v1",
  "keyServers": [
    {
      "objectId": "0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595",
      "weight": "1"
    }
  ],
  "threshold": "1"
}
```

这里绑定链上身份和 outer weighted threshold，不绑定 API key。Aggregator URL 属于可轮换的服务端传输配置，不进入 immutable on-chain commitment；其当前值和 TLS origin 必须记录在 release 的非链上 deployment evidence 中。

### 5.3 `encryptionPolicyCommitment` v1

哈希以下 shape；其中两个 artifact commitment 用本 release 的 Seal 实值替换：

```json
{
  "approvalFunctions": [
    { "function": "seal_approve_base_v8", "scope": "BASE" },
    { "function": "seal_approve_pack_v8", "scope": "PACK" },
    { "function": "seal_approve_complete_v8", "scope": "COMPLETE" }
  ],
  "domain": "animacraft-v8/seal-encryption-policy/v1",
  "holderReadLifecycle": ["ACTIVE", "PAUSED", "ARCHIVED"],
  "module": "seal_v8",
  "sealAbiCommitment": "<64 lower-hex>",
  "sealPackageCommitment": "<64 lower-hex>",
  "version": "8"
}
```

数组顺序就是上面的 schema 顺序。commitment 只声明由已认证 Move ABI/bytecode 强制执行的 policy，不放明文、密钥、token、URL、header 值或环境变量名。

### 5.4 Enoki key 的硬边界

Mainnet aggregator 要求 `X-API-Key`，当前发布输入中没有 Enoki API key。执行器必须：

- 不猜、不生成、不向客户端索取后写入日志；
- 不把 key 放进 `public-v8/config.js`、浏览器 bundle、Vercel `NEXT_PUBLIC_*`、GitHub Actions 输出、WAL、artifact 或链上对象；
- 只允许在后续受控的 server-only proxy/edge secret 中配置，浏览器只调用同源代理，代理不得把 upstream key 回传；
- 在 key 和代理缺失时，让 protected-decryption UI/API 明确 fail closed；普通包发布、bootstrap 和非 protected 功能可以继续；
- 在 Vercel cutover 证据中明确记录 `protectedDecryptionReady: false`，直到真实加密、授权 dry-run、key share 聚合、解密和拒绝用例全部通过。

## 6. TransactionData、签名和广播契约

每个写 ordinal 都必须经历同一不可变路径：

1. 从已回读的前置对象和包 ID 构造一份完整 `TransactionData`；
2. 明确 sender、gas owner、gas price、gas budget、gas payment 和 expiration；不依赖钱包在签名时隐式改写；允许 address-balance gas 时，空 gas-payment 必须是已验证且被同一 binary/协议接受的精确编码；
3. 用同一 `TransactionData` dry-run，要求 effects success，并对创建/变更对象设定上限和精确预期；
4. 冻结 BCS bytes，计算 transaction digest 和 SHA-256，进入 `READY`；
5. 通过锁定的 Sui keystore/CLI 只签这份 bytes；解析 `SenderSignedData`，做 canonical BCS round-trip，要求恰好一份 sender signature、本地 cryptographic verification 成功、签名地址等于 sender、gas owner 等于 sender、内层 TransactionData bytes 完全相等；
6. 在任何网络提交前，把 TransactionData bytes、签名、完整 SenderSignedData、digest 和验证证据持久化并 fsync，进入 `SIGNED`；
7. **query first**：先按精确 digest 查询 Mainnet；只有得到 typed not-found 才可提交；
8. 提交持久化的相同 SenderSignedData，进入 `OUTCOME_PENDING`；任何超时、断连或非最终响应仍保持该状态；
9. 以后每次恢复都先查询 digest。只有“typed not-found 且交易尚未过期”时才可重播完全相同的 signed bytes；不得 rebuild、重新选 gas、改 budget、延长 expiration 或重签；
10. 只有 effects-certified success 加本 ordinal 的精确回读通过，才进入 `FINALIZED_SUCCESS`。Effects-certified failure 进入 `FINALIZED_FAILURE`，不得继续后续 ordinal。

查询结果必须绑定精确 digest、TransactionData bytes fingerprint、raw effects BCS fingerprint、status、epoch 和 events digest。仅有 RPC `success: true`、checkpoint 搜索结果、explorer 页面或 CLI 人类可读文本均不充分。

## 7. Release WAL、CAS 和崩溃恢复

### 7.1 Release identity

发布身份分两次只增不改地封口：

- `executionPlanId` 是签 ordinal 0 前的 canonical preflight manifest SHA-256，绑定链、sender、commit/tree、工具链、七个 source artifacts、Seal policy template 和固定 DAG。后续包的 package artifact 依赖前序 Mainnet package ID，因此不能在 ordinal 0 前伪装成已知事实；
- 每个 ordinal 0–6 都有一个 append-only `readyArtifactSha256` 作为该 ordinal 的 build seal。它绑定当时的 canonical `Published.toml` 前缀、完整 package artifact、package commitment、modules、dependencies、dry-run 和最终 TransactionData。由于 Sui ephemeral pubfile 强制记录 checkout 的绝对 `source.local`，`publishedTomlSha256` 必须先把且只能把 checkout root 规范化为由 `executionPlanId` 派生的绝对虚拟根；所有 package ID、version、UpgradeCap、toolchain、role path、顺序和其余 bytes 必须保持原样。实际临时 pubfile 写入后必须 fsync、冷读、parse/render 和 raw hash 全等。签名前必须从批准 Git commit 新建一次性 0700 archive，校验七个 source artifact/commitment、锁定工具链和已回读的前序 package ID，再在该隔离目录冷重建并逐字节等于 READY build seal；不得复用 state 目录中的 source、build cache 或前次临时目录，仅有 WAL 自哈希不构成编译授权；
- `releaseId` 在 ordinals 0–6 全部回读、七个 Mainnet ABI artifacts 生成后计算，是 canonical final release manifest SHA-256。final manifest 引用 `executionPlanId` 和七个 publish digests/evidence，并补齐实际 package IDs、ABI artifacts 与全部 21 个 artifact commitments。它必须在 ordinal 7 签名前封口。

`releaseId` manifest 至少绑定：

- 完整 chain identifier、sender/gas owner、Mainnet USDC type；
- Git commit/tree 和 dirty-state assertion；
- Sui version、source commit、binary hash、framework revision和协议 profile；
- 七组完整的 source/package/ABI artifacts 和各自 commitment，以及七个已回读 package IDs/publish digests；
- Seal key-server set schema、outer threshold、两个 policy commitment schema；
- 固定 ordinal DAG 和 runner schema version。

ordinals 0–6 的 WAL 以 `executionPlanId` 为不可变源码/工具链身份，并以逐 ordinal READY build seal 固定后来才可确定的 package bytes 和依赖 ID；final manifest 只能引用这些已有事实，不能修改它们。`releaseId` 封口后，后续 WAL entry 同时绑定 `executionPlanId` 和 `releaseId`。任何已经签名的 transaction 所引用字段都不得原地改写；ABI 或 package 回读失败时不得生成 `releaseId`，也不得执行 init/bootstrap。

`run/resume` 不能从 WAL、环境变量或默认值自动“批准”这些身份：调用方每次必须显式传入 prepare 阶段输出并经人/发布代理保存的 `expectedExecutionPlanId`，runner 在任何 build、WAL append、签名或 RPC 前与 cold-read plan 精确比较。ordinal 6 成功后，同一 invocation 只能封印 final manifest 并返回 `FINAL_MANIFEST_REVIEW_REQUIRED`；后续每次 resume 还必须显式传入与 canonical final manifest 相等的 `expectedReleaseId`，否则不得生成或签名 ordinal 7/8。

### 7.2 Durable layout

Release WAL 独立于 Maker publication store。每个 release 使用私有、非 Web 可服务目录，至少包含：

- immutable manifest 和 canonical artifacts；
- append-only WAL entries；
- 每个 ordinal 的 frozen TransactionData、signature、SenderSignedData、dry-run、query、effects 和 readback evidence；
- 当前 snapshot，作为 WAL 重放缓存而非事实源；
- 最终 chain config 和 deployment evidence。

禁止记录 keystore 私钥、mnemonic、Enoki key、Vercel token 或 GitHub token。文件默认 owner-only 权限；输出目录必须被 Git 和 Vercel 构建上下文排除。

### 7.3 CAS 和落盘

每个 WAL entry 至少包含：`executionPlanId`、可选且一旦出现即固定的 `releaseId`、`revision`、`previousEntryHash`、`ordinal`、`state`、`attemptSequence`、canonical payload、timestamp 和 `entryHash`。`entryHash` 是去掉自身字段后的 canonical JSON SHA-256。

写入规则：

1. 获取单 release writer lock；
2. 校验磁盘当前 `revision` 和 `entryHash` 等于调用者的 expected CAS；
3. 写同目录临时文件，`fsync(file)`；
4. atomic rename 到目标；
5. `fsync(directory)`；
6. 再读并验证 canonical bytes/hash；
7. 更新 snapshot 也使用同样的 temp/fsync/rename/directory-fsync，但 snapshot 失败不能抹掉 WAL 事实。

revision 不连续、hash chain 断裂、重复 ordinal success、signed evidence 缺字段、磁盘部分写入或并发 CAS 冲突全部 fail closed。

### 7.4 状态和恢复

单 ordinal 的最小状态机：

```text
PLANNED -> BUILT -> DRY_RUN_OK -> READY -> SIGNED -> OUTCOME_PENDING
                                                   |              |
                                                   | query success|
                                                   +-------------> FINALIZED_SUCCESS -> READBACK_VERIFIED
                                                                  \-> FINALIZED_FAILURE
```

恢复决策：

| 已持久状态 | 允许动作 |
| --- | --- |
| `< READY` | 可从已封口 artifacts 重建；不得签名 |
| `READY` 无签名 | 重新核对 chain/epoch/object refs 后，可对同 bytes 发起一次签名 |
| `SIGNED` | 只按 digest 查询；typed not-found 且未过期时可提交相同 bytes |
| `OUTCOME_PENDING` | 只查询；typed not-found 且未过期时可重播相同 bytes |
| success 未回读 | 只补回读，不重播、不重签 |
| finalized failure | 停止整个 release |
| 过期且 typed not-found | 将整个 release 标记 `ABANDONED_EXPIRED_NOT_FOUND`；不得为该 release 重签 |
| 结果仍不明 | 保持 `OUTCOME_PENDING`，不得推进 |

## 8. 精确链上调用

### 8.1 Ordinals 0–6：publish

每包使用官方 build dump 的 `modules` 和 normalized `dependencies` 构造：

```text
UpgradeCap = tx.publish({ modules, dependencies })
tx.transferObjects([UpgradeCap], sender)
```

不得改用不冻结 TransactionData 的一体式 CLI publish。每个成功 publish 的回读必须唯一识别：

- 一个新 package object；
- 一个由 sender 持有的 `0x2::package::UpgradeCap`，其 `package` 等于新 package ID、初始 `version == 1`、`policy == 0`；
- package 的 `previousTransaction` 等于该 ordinal digest；
- on-chain module name/bytes 完全等于 package artifact；
- linkage table、type origins 和 dependency IDs 完全等于 DAG/build artifact。

Core publish 还必须恰好识别模块 initializer 创建的：

- 一个 shared `ProtocolConfigV8`，version 8、revision 0、treasury `None`、enabled false、payment coin 为 Mainnet USDC、Core original/callable 都等于 Core package ID；
- 一个由 sender 持有的 `ProtocolAdminCapV8`，其 config ID 精确匹配。

其他 companion publish 不应借发布创建协议共享配置；发现额外的协议权威对象或对象形状不符即停止。

### 8.2 Ordinal 7：protocol init PTB

在一个 PTB 中严格按顺序调用：

```text
core::protocol_config_v8::initialize_protocol_treasury_v8<MAINNET_USDC>(
  &mut ProtocolConfigV8,
  &ProtocolAdminCapV8
)

core::protocol_config_v8::set_protocol_enabled_v8(
  &mut ProtocolConfigV8,
  &ProtocolAdminCapV8,
  true
)
```

成功回读必须证明：

- 创建且共享唯一 `ProtocolTreasuryV8<MAINNET_USDC>`；
- `ProtocolConfigV8` 与 owned `ProtocolAdminCapV8` 都由 effects 精确标记为 `MUTATED`，并使用同一 ordinal 7 transaction 产生的新 version/digest；bootstrap 只能使用该 v2 AdminCap 引用，不得复用 Core publish 时的 v1 引用；
- config treasury ID 精确等于新 treasury ID；
- config 从 revision 0 依次变为 revision 2，`enabled == true`；
- `ProtocolTreasuryV8Initialized` 和 `ProtocolV8EnabledChanged` 事件的 config ID、treasury ID、revision、enabled 和 commitment 精确匹配；
- treasury version 8、config ID 匹配、余额/累计 collected/withdrawn 初始为零；
- config 最终 commitment 可由 on-chain BCS schema独立重算。

不得把 init 和 bootstrap 合并；ordinal 7 必须先 effects-certified 和回读通过。

### 8.3 Ordinal 8：catalog bootstrap PTB

该 PTB 对 `ProtocolAdminCapV8` 的 owned input 即使只以引用参与，也会把 object reference 从 ordinal 7 的 v2 推进到 v3。effects 写集必须精确为 7 个 shared `CREATED`（Catalog + 六 config）和该 AdminCap 唯一一项 `MUTATED`；bootstrap 证书和最终 authority evidence 必须保存 v3 引用。

先为七个角色各调用一次：

```text
core::package_binding_v8::new_package_commitments_v8(
  source_commitment_bytes,
  package_commitment_bytes,
  abi_commitment_bytes
)
```

随后调用 `core::package_binding_v8::certify_product_release_catalog_v8`，其 14 个 type arguments 固定为：

1. `core::protocol_config_v8::CorePackageMarkerV8`
2. `core::protocol_config_v8::CorePackageMarkerV8`
3. `seal::seal_v8::SealOriginalMarkerV8`
4. `seal::seal_v8::SealCallableMarkerV8`
5. `runtime::runtime_v8::RuntimeOriginalMarkerV8`
6. `runtime::runtime_v8::RuntimeCallableMarkerV8`
7. `output::output_v8::OutputOriginalMarkerV8`
8. `output::output_v8::OutputCallableMarkerV8`
9. `physical::physical_v8::PhysicalOriginalMarkerV8`
10. `physical::physical_v8::PhysicalCallableMarkerV8`
11. `market::market_v8::MarketOriginalMarkerV8`
12. `market::market_v8::MarketCallableMarkerV8`
13. `release::release_v8::ReleaseOriginalMarkerV8`
14. `release::release_v8::ReleaseCallableMarkerV8`

value arguments 是 immutable ProtocolConfig、owned ProtocolAdminCap 引用，以及 Core/Seal/Runtime/Output/Physical/Market/Release 顺序的七个 commitment results。

catalog 尚未 share 时，依次取出六个不可复制 call cap，并在同一 PTB 立即消费到相应 config：

1. `take_seal_call_cap_v8` → `seal::seal_v8::new_seal_policy_config_v8(config, admin, catalog, cap, keyServerIds, weights, 1, keyServerSetCommitment, encryptionPolicyCommitment)` → `share_seal_policy_config_v8`；
2. `take_runtime_call_cap_v8` → `runtime::runtime_binding_v8::new_runtime_package_config_v8(catalog, cap)` → `share_runtime_package_config_v8`；
3. `take_output_call_cap_v8` → `output::output_v8::new_output_package_config_v8(catalog, cap)` → `share_output_package_config_v8`；
4. `take_physical_call_cap_v8` → `physical::physical_v8::new_physical_package_config_v8(catalog, cap)` → `share_physical_package_config_v8`；
5. `take_market_call_cap_v8` → `market::market_v8::new_market_package_config_v8(catalog, cap)` → `share_market_package_config_v8`；
6. `take_release_call_cap_v8` → `release::release_v8::new_release_package_config_v8(catalog, cap)` → `share_release_package_config_v8`。

最后且仅最后调用：

```text
core::package_binding_v8::share_product_release_catalog_v8(catalog)
```

该 share 会验证六个 cap slot 全为空。bootstrap 成功必须恰好产生七个新的 shared object：一个 catalog 和 Seal/Runtime/Output/Physical/Market/Release 六个 configs。不得把任何 call cap 转移给 sender、丢弃或留在 catalog 中。

## 9. Readback、verify-source 和 runtime attestation

### 9.1 Catalog/config 回读

bootstrap 后必须从 pinned Core gRPC 回读并重算：

- catalog version 8、protocol config ID/revision/commitment；
- capability mask `127`；
- 七个 role 的 original/callable package ID、三类 artifact commitment、exact binding commitment；
- product binding commitment；
- 六个 authority IDs、call-cap-set commitment；
- 六个 config 的 catalog ID、product binding、authority/call-cap-set 绑定；
- Seal config 的服务器 ID/weight/threshold、两个 policy commitment 和最终 BCS policy commitment；
- 所有 shared object 的 initial shared version、当前 version/digest 和 previous transaction。

任何字段来自作者输入、静态配置或交易预期都不算回读；必须从链上 raw/typed object 独立取得并与预期双向比较。

### 9.2 Verify-source

在一个新的干净 checkout 中，以 release 的 Git commit/tree 和同一二进制执行：

1. 重新枚举并哈希 source artifact 文件；
2. 按已发布依赖 ID 重新 build 七包；
3. 比较 build digest、module names、module bytes、module SHA 和 dependency set；
4. 从 Mainnet gRPC 重新取 package object，按上述唯一 self-address publication substitution 规则比较 raw modules，并精确比较 linkage 和 type origins；
5. 重新规范化 ABI descriptor并比较 ABI canonical bytes/hash；
6. 重新计算七组 source/package/ABI commitments、exact bindings、product binding、call-cap set、Seal policy和 protocol config commitment；
7. 比较 catalog/config 的全部链上字段。

verify-source 运行目录不得复用发布时的 build cache；cache hit 不能代替字节比较。

### 9.3 客户端 runtime attestation

导出的客户端配置只是发现入口，不是信任根。浏览器在允许签名/广播前仍须：

- 校验 full chain identifier 和 protocol profile hash；
- 回读七个 package/config/catalog refs 和 package object digest；
- canonical 解码并校验已测量的 Core module bytes/hash；
- 校验 original/callable type origins、commitments、authority IDs、shared refs 和 Mainnet USDC；
- 对任一版本、digest、module、protocol 或 config 漂移 fail closed。

生产传输只允许官方 `SuiGrpcClient` 和 `SuiGraphQLClient`：对象、协议、余额、模拟、执行、交易终局、checkpoint 和历史 BCS 走 gRPC；事件/列表等索引发现及自定义 selection 走 GraphQL，并逐次绑定完整 Mainnet chain identifier。不得 import、实例化或动态回退到 `SuiJsonRpcClient`、`getJsonRpcFullnodeUrl`、`@mysten/sui/jsonRpc` 或手写 JSON-RPC HTTP envelope。测试/localnet 证据文件可以保留历史 JSON-RPC artifact，但不得进入 production dependency graph、factory 或 bundle。

## 10. Mainnet 停止、abandon 和不可逆规则

### 10.1 签名前硬门

任一写 ordinal 只有在以下条件同时为真时才可进入 `READY`：干净 commit/tree、工具链完全匹配、协议 133/profile 匹配、完整 chain ID 匹配、sender 匹配、余额覆盖保守 gas 上限、所有前序 ordinal readback verified、本 ordinal dry-run success、WAL/CAS 健康、预期对象集合无歧义。任一 publish READY 在真正签名前还必须从归档源码和 canonical Published 前缀重新 build，要求 source/package artifact、modules、dependency set、package commitment 和 frozen TransactionData 全量相等；ordinal 7/8 在签名前还必须重读并逐字节复核对应 ProtocolConfig、ProtocolAdminCap，以及 ordinal 8 的批准 Seal committee exact type/owner/BCS/reference 证书；不相等时签名调用数必须为零。构建和 `keytool sign` 不得继续使用仅在流程开始时量过哈希的可变 pathname：每次调用须先把批准 binary copy-on-write/完整复制到本次 0700 临时目录，对副本重跑 exact version + SHA-256，再只执行该副本，调用结束即删除。

签名前可安全 abandon，原因写入 WAL；没有链上副作用。

### 10.2 签名后的硬规则

- `SIGNED` 后，唯一允许广播的 payload 是已落盘的相同 SenderSignedData；
- 任何 ambiguous outcome 都不得签替代交易或推进下一 ordinal；
- typed not-found 以外的错误不是“未上链”证据；
- 过期且 typed not-found 时 abandon 整个 release，不为同 release 重签；
- 链上 success 但对象/事件/readback 不满足本规格时，标为 `INCIDENT_STOPPED`，保留全部证据，禁止自动继续或 Web 切流；
- 唯一允许的 readback repair 是本轮已锁定的六个本地证书解析器缺陷：`MAINNET_V8_CREATED_OUTPUT_INVALID`（把 V2 `AccumulatorWriteV1` 误当 created object）、`MAINNET_V8_PACKAGE_BYTES_DRIFT`（未按 Sui publish 规则把每个 module 唯一的 32-byte `0x0` self address 与新 package ID 归一化比较）、`MAINNET_V8_INIT_WRITE_SET_INVALID`（旧 certifier 漏计 ordinal 7 PTB 中 owned `ProtocolAdminCapV8` 的版本推进）、仅限 ordinal 7 且消息精确为 `ProtocolTreasuryV8.revenue has no exact Move field record.` 的 `MAINNET_V8_MOVE_FIELDS_INVALID`（官方 gRPC 将 `Balance<USDC>` JSON 投影为 canonical u64 标量，而不是旧 nested `{value}` 形状）、仅限 ordinal 8、消息精确为 `Bootstrap effects must contain exactly seven created shared outputs.` 且 durable effects 恰有八项 writes 的 `MAINNET_V8_BOOTSTRAP_WRITE_SET_INVALID`（旧 certifier 漏计 bootstrap 对 owned AdminCap 的 v2→v3 推进），以及仅限 ordinal 8、空 details 且消息精确为 `ProductReleaseCatalogV8.seal_call_cap must be an exact Move Option<PackageCallCapV8>.` 的 `MAINNET_V8_BOOTSTRAP_BCS_DRIFT`（官方 gRPC 将已取走的 Move `Option<PackageCallCapV8>` 投影为 `null`，而不是旧测试夹具的 `[]`）。必须由显式 `--repair-readback-incident` 触发，在同一 ordinal/attempt/digest/signature/finality bytes 上 append-only 地重新进入 `FINALIZED_SUCCESS_PENDING_READBACK`，不得 query、签名、广播或替换交易；module 比较只允许恰好一段连续 32 bytes 从全零变为 effects 认证的 package ID，任何其他 byte drift 仍 fail closed；init 写集修复必须精确绑定同一 finality 中的 config `MUTATED`、AdminCap `MUTATED`、treasury `CREATED` 三项并历史回读 v2 AdminCap；treasury Balance 修复仍必须以历史 raw BCS 独立解码为零并与当前 gRPC 标量相等；bootstrap 写集修复必须精确绑定 7 个 shared `CREATED` 和同一 AdminCap `MUTATED`，并历史回读 v3 AdminCap；Catalog Option 修复必须同时证明 raw BCS 六个 call-cap 都为 `None` 且 current JSON 六项都为 `null`。WAL 必须拒绝任何 finality 漂移，修复调用在得到 `FINALIZED_SUCCESS` 后立即停止，下一 ordinal 只能由后续独立 resume 启动。其他 incident 一律保持 terminal；
- effects-certified failure 后停止；不得跳过、重排或把新交易冒充同 ordinal；
- 已有部分 package 成功时不能删除。放弃 release 会留下未被 production config 引用的 orphan packages/UpgradeCaps，必须明确登记，未来 release 使用新 releaseId 从头认证；
- AdminCap、UpgradeCaps 是高价值权威对象；不得在自动恢复中转移、销毁或更改 upgrade policy。

### 10.3 可操作的回滚点

| 层 | 回滚/隔离方式 | 边界 |
| --- | --- | --- |
| 未签交易 | abandon WAL | 无链上副作用 |
| 部分 package | 不继续、不导出配置 | package 永久存在，无法删除 |
| init 后、bootstrap 前 | production config 保持 disabled；必要时由独立审计交易调用 `set_protocol_enabled_v8(..., false)` | 禁用本身是新的链上写入，不得由 runner静默执行 |
| bootstrap 后 | 不切 Vercel；标记 catalog 未投产 | catalog/config 永久存在 |
| Vercel preview | 删除/忽略 preview | 不影响链 |
| Vercel production | 把域名/production alias 指回已记录的上一个健康 deployment | 链上 release 不回滚 |

任何 emergency disable/upgrade 都是新的、单独规格化和签名的 Mainnet 操作，不是本 runner 的自动补偿事务。

## 11. Config 导出和 Vercel cutover

ordinal 9 只能从 verified readback 生成 config，禁止人工复制 package/object ID。进入 `FINALIZED_SUCCESS` 前必须再次从批准 commit 的一次性 0700 archive 按每个 ordinal 当时的 canonical Published 前缀重建七包，并把每个 package 的 modules、dependencies、package commitment、gRPC ABI/type origins/linkage、历史 Package Object BCS、current immutable ref 与 sealed manifest 逐项全等；该七包 verification record 及其 hash 必须进入 WAL、导出 config 和 chain certificate。输出至少包含：

- full chain identifier（legacy 值仅展示）；
- protocol config、treasury、catalog exact object refs；
- 七个 role 的 original/callable package IDs 和 package digests；
- 六个 role config exact refs；
- Mainnet USDC 和 Clock ID；
- protocol/profile/artifact/product/call-cap-set commitments；
- `chainReleaseReady: true`；
- `protectedDecryptionReady: false`，直到服务端代理验收完成；
- 空的或经链上回读认证的 Maker bindings，不得放示例/placeholder ID。

静态 config 和 bundle 中必须扫描并拒绝：占位符 `0x10…0x88`、私钥/mnemonic、Enoki/API key、Vercel/GitHub token、localhost/testnet/devnet URL、旧 v7/legacy package ID、`allowWalletSignature`/`allowBroadcast` 与证据不一致的组合。

同时必须扫描并拒绝 production source/bundle 中的 `@mysten/sui/jsonRpc`、`SuiJsonRpcClient`、`getJsonRpcFullnodeUrl`、legacy `queryTransactionBlocks/getTransactionBlock/dryRunTransactionBlock/executeTransactionBlock` 调用及任何 JSON-RPC fallback。等价能力必须分别由 gRPC Core/Ledger API 或 GraphQL indexed query 提供；迁移后的 typed-not-found、分页、历史对象和 effects BCS 负向测试必须保持 fail closed。

Vercel 顺序固定为：

1. 从链上 source release commit 创建一个干净后继 deployment commit；该提交只允许加入由 chain certificate 生成的生产 config、公开 chain/deployment 证书和与其直接相关的静态部署元数据，不得修改七包 Move 源码、compiler、release runner、transport authority 或既有链证据；
2. 构建该固定 deployment commit，Node runtime 与 CI 锁定版本一致，并在构建前证明其父链包含精确 source release commit、allowlist 外的 source tree 与 source release commit 相同；
3. 部署 preview，不改 production alias；
4. 对 preview 做静态扫描、HTTP、配置 schema、chain attestation、钱包连接、dry-run 和非 protected 路径 smoke test；
5. 确认 protected UI 在无 server proxy/key 时明确不可用且不会直接请求带 key 的 aggregator；
6. 保存当前 production deployment ID/commit/domain 作为回滚点；
7. 仅把通过验收的同一 immutable deployment promote/alias 到 production，不从不同工作树重建；
8. 从自定义域名重新下载 config/bundle，比较 SHA-256 与 preview，并重复 Mainnet attestation；
9. 失败时立即把 alias 指回前一个健康 deployment，链上对象保持原样。

source release commit/tree 必须在签名前 push 并通过 required checks；deployment commit/tree 必须在 Vercel preview 前单独 push 并通过同等 Web/production checks。两者不得混同：chain certificate 固定 source release commit/tree，production deployment certificate 同时固定 source release commit/tree、deployment commit/tree、允许的 tree delta 和静态 config hash。dirty deployment、非后继提交、allowlist 外代码漂移或 provenance 不一致均禁止切流。

## 12. 验收矩阵

`P` 表示 package/chain release 必须项；`D` 表示 protected-decryption 独立门。

| Gate | 类别 | 通过证据 | 失败动作 |
| --- | --- | --- | --- |
| Git provenance | P | clean commit/tree；七包 source manifest 重算一致 | 签名前停止 |
| Toolchain identity | P | version/source commit/binary SHA/framework rev 全匹配 | 新建 release，不复用 WAL |
| Protocol/network | P | full genesis ID、protocol 133、1000/1000 profile 匹配 | 停止 |
| Local quality | P | JS/Move tests、七包 adversarial probes、package byte-size gates 全绿 | 修复后重新封口 artifacts |
| Sender/gas | P | sender/gas owner匹配；余额覆盖全部 ordinal 保守预算；address-balance gas dry-run通过 | 停止 |
| Publish 0–6 | P | 每 ordinal exact signed bytes、effects certificate、package/modules/deps/typeOrigins/UpgradeCap 回读 | 结果不明则 query-only；不符则 incident stop |
| Protocol init | P | revision 2、treasury、enabled、事件和 commitment 精确回读 | 停止；不自动补偿 |
| Artifact v1 | P | 三类 canonical artifact 原文与 21 个 hash 可重算 | 禁止 bootstrap |
| Seal on-chain policy | P | committee 对象存在/类型确认；ID/1/threshold1及两个 commitment 精确回读 | 禁止 bootstrap 或停止 |
| Catalog bootstrap | P | catalog + 六 configs 七个 shared objects；六 cap 全消费；全部 binding 重算一致 | 停止 |
| Verify-source | P | fresh checkout byte-for-byte rebuild、gRPC ABI、catalog/config 全一致 | 禁止 config export |
| Config export | P | 无 placeholder/secret/legacy；只来自 readback；chain release 标志准确 | 禁止 deploy |
| Transport cutover | P | production source/dist 无 JSON-RPC；gRPC authority + GraphQL discovery 的 Mainnet、分页、not-found、历史/终局测试全绿 | 禁止 deploy |
| Vercel preview | P | 同 commit 构建，静态/HTTP/attestation/非 protected smoke 全通过 | 不 promote |
| Vercel production | P | immutable preview promote；custom domain bytes/hash 和链 attestation 复验 | alias 回滚 |
| Enoki secret path | D | key 仅 server-only secret，日志/静态包/链扫描无泄漏 | 保持 protected disabled |
| Seal E2E | D | 官方 SDK verify、授权解密成功、未授权/错误 holder/错误 scope拒绝、轮换/故障测试 | `BLOCKED_EXTERNAL_SECRET` 或 fail closed |

### 12.1 Chain release 完成证书

只有链上 publish/init/bootstrap、final readback、七包 fresh rebuild 与 verify/export gate 通过，chain certificate 才可写 `CHAIN_RELEASE_COMPLETE`。证书至少列出：execution plan、releaseId、sealed manifest、commit/tree、七个 package/UpgradeCap IDs、九个写 transaction digests、protocol/config/treasury/catalog/config IDs、21 个 artifact commitments、每包 module/Object BCS/ABI verification、effects/readback fingerprints，以及 init/bootstrap authority evidence；不得提前声称 Vercel 已部署。

### 12.2 Production deployment 完成证书

Vercel preview、immutable production promote 和 custom domain 验证完成后，另写 `PRODUCTION_DEPLOYMENT_COMPLETE`。证书必须绑定 chain certificate SHA-256、releaseId、source release commit/tree、deployment commit/tree、两者之间经过 allowlist 验证的 tree delta、静态 config SHA-256、Vercel project/deployment ID、preview/production/custom-domain URL、production bundle hash、HTTP/security smoke 结果和上一个健康 deployment 回滚点。只有 chain 与 deployment 两份证书同时成立，才可对外宣称本轮 Mainnet production release 完成。

### 12.3 当前已知 blocker 的准确表述

当前没有提供 Mainnet Seal aggregator 所需的 Enoki `X-API-Key`。因此：

- 不能把 `PROTECTED_DECRYPTION_COMPLETE` 标为通过；
- 不能在浏览器或静态 Vercel 配置中补一个 key；
- 可以且应当独立完成七包 publish、protocol init、catalog bootstrap、verify-source、无密钥链上配置和非 protected production cutover；
- protected UI 必须保持明确禁用，直到后续 server-only proxy 和真实 E2E 验收通过。

这不是 package publish 或 chain bootstrap 的 blocker，也不得被用作猜密钥、弱化 Seal policy 或跳过链上回读的理由。
