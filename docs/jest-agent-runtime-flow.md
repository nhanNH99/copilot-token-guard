# Flow thực tế và chức năng từng hàm

Tài liệu này mô tả runtime flow của Jest Agent automation bằng ví dụ:

```text
Source: src/components/UserMenu.tsx
Test:   src/components/UserMenu.test.tsx
```

## 1. Plan phase

Người dùng gửi:

```text
Hãy tạo test coverage cho src/components/UserMenu.tsx
```

Agent đọc component và test liên quan, sau đó tạo plan. Agent chưa ghi
`request.json` và chưa edit test.

Khi agent chuẩn bị kết thúc câu trả lời, VS Code gọi:

```text
Stop
  -> jest-agent-hook.mjs stop
  -> stop()
  -> verifyRepository()
  -> loadRequest()
```

`loadRequest()` không tìm thấy:

```text
.github/.cache/jest-agent/request.json
```

Runner trả `skipped`, sau đó hook trả:

```json
{"continue":true}
```

Không chạy Jest, không chặn edit và không inject message vào model. Phần hook
gần như không làm tăng token.

## 2. User approval

Người dùng trả lời:

```text
oke
```

Sau khi được duyệt, agent ghi request để runner biết target và test:

```json
{
  "schemaVersion": 1,
  "targets": [
    {
      "path": "src/components/UserMenu.tsx"
    }
  ],
  "tests": [
    "src/components/UserMenu.test.tsx"
  ],
  "artifacts": []
}
```

Approval và phạm vi edit được quản lý bằng instruction của agent.
`request.json` chỉ là input cho Jest/coverage runner.

## 3. Format và lint

Sau khi edit thành công, VS Code gọi `PostToolUse`:

```text
postToolUse()
  -> extractToolPaths()
  -> formatTestFiles()
       -> Prettier --write
       -> ESLint --fix
```

Nếu cả hai pass:

```json
{"continue":true}
```

Hook không gửi `additionalContext`; model không nhận message thành công.

Nếu fail, hook chỉ gửi error đã rút gọn:

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "ESLint: <lỗi chính>"
  }
}
```

Summary bị giới hạn 800 ký tự.

## 4. Jest và coverage

Khi agent chuẩn bị kết thúc sau khi tạo test, `Stop` chạy:

```text
stop()
  -> verifyRepository()
       -> loadConfig()
       -> loadRequest()
       -> classifyTarget()
       -> runStaticChecks()
       -> runJest()
       -> readCoverage()
       -> evaluateCoverage()
       -> writeReport()
```

### Khi pass

```text
report.status = passed
  -> xóa request.json
  -> trả {"continue":true}
```

Không có `systemMessage`, không có lượt AI bổ sung và không inject report.

### Khi fail

```text
report.status = failed
  -> summarizeFailedReport()
  -> Stop trả decision: block
  -> agent nhận summary ngắn
```

Summary tối đa gồm:

- Hai test failures đầu tiên.
- Tối đa 12 uncovered lines.
- Tối đa 12 uncovered branch arms.
- Error chính của Prettier hoặc ESLint.
- Tổng độ dài tối đa 800 ký tự trước phần hướng dẫn cố định.

Full report vẫn nằm local:

```text
.github/.cache/jest-agent/report.json
```

Agent đề xuất sửa và chờ người dùng trả lời `oke`. Khi VS Code gọi `Stop` lần
hai với `stop_hook_active: true`, hook trả `continue` để tránh vòng lặp.

## 5. Token impact

| Trường hợp | Nội dung đưa vào model | Ảnh hưởng token |
| --- | --- | --- |
| `PostToolUse` pass | Không có context | Gần như 0 |
| `PostToolUse` fail | Error tối đa 800 ký tự | Thấp |
| `Stop` khi plan | Không có context | Gần như 0 |
| `Stop` verification pass | Không có context | Gần như 0 |
| `Stop` verification fail | Summary tối thiểu và một lượt AI | Trung bình |
| Full `report.json` | Không tự inject | 0 cho đến khi được đọc |

Không thể đạt 0 token khi muốn AI hiểu lỗi và đề xuất sửa. Flow này giữ success
path im lặng và chỉ dùng token khi cần AI xử lý failure.

# Hàm trong hook

File:

```text
.github/scripts/jest-agent-hook.mjs
```

## `readHookInput()`

Đọc JSON event từ `stdin`. Trả object rỗng nếu hook không có input và từ chối
input không phải JSON object.

## `printHookResult(result)`

Serialize kết quả hook thành một dòng JSON trên `stdout` để VS Code đọc.

## `compactText(value, maximum)`

Gộp whitespace và cắt error theo giới hạn. Mục đích là không inject stack trace
hoặc log dài vào model context.

## `postToolUse(input, config)`

Chạy sau edit:

1. Bỏ qua tool không edit.
2. Chỉ lấy test artifacts thực sự vừa thay đổi.
3. Gọi `formatTestFiles()`.
4. Pass thì im lặng.
5. Fail thì inject error ngắn qua `additionalContext`.

## `stop(input, config)`

Điều phối verification cuối lượt:

1. Nếu `stop_hook_active` là `true`, cho phép dừng để tránh loop.
2. Gọi `verifyRepository()`.
3. Nếu runner trả `skipped` vì chưa có request, cho phép dừng.
4. Pass: xóa request và im lặng.
5. Fail: block đúng một lần và đưa summary ngắn cho agent.

## `summarizeFailedReport(report)`

Chuyển structured report thành failure summary tối thiểu. Không đưa full Jest
log, stack trace hoặc toàn bộ coverage vào context.

## `run()`

Entry point của hook:

1. Đọc mode từ command line.
2. Đọc event JSON.
3. Load config.
4. Dispatch đến `postToolUse` hoặc `stop`.
5. Nếu hook lỗi, fail closed bằng `continue: false`.

# Hàm trong runner

File:

```text
.github/scripts/jest-agent-runner.mjs
```

## Config và path safety

### `toPosix(value)`

Chuẩn hóa path separator thành `/` để report giống nhau trên Windows, macOS và
Linux.

### `uniqueSortedNumbers(values)`

Loại line number trùng và sắp xếp tăng dần.

### `trimOutput(value, limit)`

Cắt stdout/stderr trước khi lưu report, tránh report quá lớn.

### `readJson(filePath, maxBytes)`

Đọc JSON regular file và từ chối file vượt giới hạn.

### `assertString()`, `assertStringArray()`, `assertPositiveLineArray()`

Validate config và request fields, đặc biệt path strings và coverage line
numbers.

### `isInside(root, candidate, allowRoot)`

Kiểm tra absolute path còn nằm trong repository.

### `rejectSymlinkComponents(root, absolutePath)`

Từ chối path đi qua symbolic link để tránh thoát repository qua symlink.

### `resolveRepositoryPath(root, inputPath, label, options)`

Resolve relative, absolute hoặc `file://` path; áp dụng repository boundary và
symlink checks; trả cả absolute và relative path.

### `mergeConfig(rawConfig)`

Ghép config repository với default values, bao gồm nested `timeouts`.

### `loadConfig(root)`

Đọc `.github/jest-agent.config.json`, validate schema, path, regex, timeout và
trả config đã resolve.

### `isAllowedTestArtifact(relativePath, config)`

Kiểm tra test, mock, fixture hoặc test utility có match
`allowedEditPatterns`.

### `isEditTool(toolName)`

Nhận diện tool có khả năng create/write/edit file.

### `extractToolPaths(toolInput)`

Tìm path trong các field phổ biến như `file`, `files`, `path`, `paths` và trong
header của patch.

## Request

### `normalizeRequestPath(config, inputPath, label)`

Resolve một request path bằng repository path guard.

### `validateRequest(rawRequest, config)`

Validate toàn bộ request:

- `schemaVersion` phải là `1`.
- Phải có targets và tests.
- Source extension phải hợp lệ.
- Test/artifact phải match allowlist.
- Không có duplicate path.
- Legacy coverage arrays phải xuất hiện thành cặp và chứa số dòng dương.

### `loadRequest(config)`

Đọc và validate `request.json`; trả `null` nếu file chưa tồn tại.

## Process và local tools

### `runProcess(command, args, options)`

Chạy process với `shell: false`, timeout và argv tách riêng. Trả status,
stdout/stderr và process error.

### `runGit(config, args)`

Wrapper gọi Git tại repository root với timeout cố định.

### `resolveDiffRevision(config)`

Với `origin/main...HEAD`, gọi `git merge-base` để có base commit rồi vẫn đo cả
working tree hiện tại.

### `repositoryRelativeFromProject(config, relativePath)`

Chuẩn hóa path dùng làm argument cho local tools. Project hiện chạy từ repo
root nên hàm trả repository-relative path.

### `resolveLocalTool(config, toolName)`

Tìm Jest, ESLint hoặc Prettier trong `node_modules` đã có của project.

### `invokeLocalTool(config, toolName, args, timeoutSeconds)`

Gọi local tool bằng Node.js, không dùng `npx`, network hoặc shell command.

### `summarizeToolResult(result)`

Chuyển process result thành structured status để ghi report.

## Format và lint

### `formatTestFiles(config, inputPaths)`

Dùng cho `PostToolUse`:

1. Giữ lại files match test artifact allowlist.
2. Chạy `Prettier --write`.
3. Chạy `ESLint --fix`.
4. Trả structured result cho hook.

### `collectChangedTestFiles(config, request)`

Lấy đúng `request.tests` và `request.artifacts` còn tồn tại để static check.

### `runStaticChecks(config, files)`

Chạy lại `Prettier --check` và ESLint không auto-fix trước Jest, bảo đảm report
cuối phản ánh trạng thái thật.

## Git classification

### `parseNameList(output)`

Chuyển output nhiều dòng của Git thành danh sách path.

### `parseChangedLines(diffText)`

Đọc hunk headers từ `git diff --unified=0` và trả các added/modified line
numbers ở phiên bản mới.

### `classifyTarget(config, target)`

Phân loại source:

- `new`: untracked hoặc added.
- `modified`: có changed lines so với diff base.
- `legacy-gaps`: không có diff và dùng lines được plan duyệt.

## Jest

### `prepareArtifactDirectories(config)`

Xóa coverage/Jest JSON cũ và tạo cache directories mới để tránh đọc artifact
từ lượt trước.

### `runJest(config, request)`

Chạy Jest local với:

- `--runTestsByPath` cho approved tests.
- `--collectCoverageFrom` cho targets.
- JSON test result.
- Istanbul `coverage-final.json`.

### `summarizeJestResult(result, outputLimit)`

Rút Jest JSON thành test counts và tối đa 20 failures trong full local report.
Hook sau đó chỉ chọn tối đa hai failures để inject.

## Coverage helpers

### `locationContainsLine(location, line)`

Kiểm tra một statement hoặc branch location có chứa source line.

### `statementIdsForLines(fileCoverage, lines)`

Tìm Istanbul statement IDs liên quan đến các source lines.

### `branchMatchesLines(branch, lines)`

Kiểm tra branch hoặc branch arm có liên quan đến changed/required lines.

### `summarizeMetric(counts)`

Tính `total`, `covered` và phần trăm cho một coverage metric.

### `coverageMetrics(fileCoverage)`

Tính statements, branches, functions và lines từ Istanbul file coverage.

### `normalizeCoverageEntries(config, coverage)`

Chuẩn hóa coverage file keys thành absolute paths để match targets.

### `evaluateNewTarget(target, fileCoverage)`

Yêu cầu cả bốn metrics của file mới đạt 100%.

### `uncoveredBranchesForLines(fileCoverage, lines)`

Tìm branch arms chưa cover tại các changed hoặc required lines.

### `evaluateModifiedTarget(target, classification, fileCoverage)`

Gate executable statements và branch arms liên quan đến Git changed lines.

### `evaluateLegacyTarget(target, classification, fileCoverage)`

Gate `requiredLines` và `requiredBranchLines`; đồng thời báo line khai báo sai
nếu không phải executable statement hoặc branch.

### `evaluateCoverage(config, request, classifications, coverage)`

Chọn evaluator theo mode của từng target và tổng hợp trạng thái pass/fail.

### `readCoverage(config, request, classifications)`

Đọc `coverage-final.json`; trả structured failure nếu file thiếu hoặc JSON lỗi.

## Report và orchestration

### `reportCheckFailed(check)`

Helper xác định một check có status `failed`.

### `writeReport(config, report)`

Ghi `report.json` theo cách atomic: ghi file tạm rồi rename.

### `failureReport(config, message)`

Tạo report lỗi cấp runner khi config, request hoặc Git classification thất bại.

### `verifyRepository(root)`

Orchestrator chính:

1. Load config và request.
2. Bỏ qua nếu chưa có request.
3. Resolve diff base.
4. Classify targets.
5. Chạy static checks.
6. Chạy Jest.
7. Đánh giá coverage.
8. Ghi report.
9. Trả `passed`, `failed` hoặc `skipped`.

### `printCliSummary(report)`

In kết quả ngắn khi developer chạy fallback command.

### `parseCliArguments(argv)`

Chỉ chấp nhận command `verify` và optional `--root`.

### `runCli()`

Entry point cho:

```bash
node .github/scripts/jest-agent-runner.mjs verify
```

Đặt exit code `1` khi verification fail, `0` khi pass hoặc skipped, và `2` khi
CLI argument không hợp lệ.
