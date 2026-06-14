# Giải thích `token-efficiency-audit.mjs`

Tài liệu này giải thích các hằng số, hàm và luồng thực thi trong
`token-efficiency-audit.mjs`.

## Mục đích

Script kiểm tra:

- `.github/copilot-instructions.md` có tồn tại và có cấu trúc hợp lệ không.
- Các rule ID bắt buộc trong managed policy có đầy đủ và duy nhất không.
- Đường dẫn policy có đi qua symbolic link không.
- Policy và custom agent có vượt giới hạn kích thước không.
- Custom agent khai báo profile `safe` hoặc `compact` hợp lệ không.
- Custom agent có dấu hiệu sao chép rule giảm token dùng chung không.

Script chỉ đọc file và báo cáo. Nó không sửa file, gọi network hoặc chạy child
process.

## Luồng gọi hàm

```text
runCli()
  |
  +-- parseArguments()
  |
  +-- auditRepository()
  |     |
  |     +-- auditPolicy()
  |     |     |
  |     |     +-- inspectPathComponents()
  |     |     +-- readRegularFileNoFollow()
  |     |     +-- countOccurrences()
  |     |     +-- addFinding()
  |     |
  |     +-- auditAgents()
  |           |
  |           +-- collectAgentFiles()
  |           +-- readRegularFileNoFollow()
  |           +-- parseAgentProfile()
  |           +-- addFinding()
  |
  +-- formatCliResult()
        hoặc formatHookResult()
```

## Hằng số cấu hình

### `POLICY_RELATIVE_PATH`

```js
'.github/copilot-instructions.md'
```

Đường dẫn policy tính từ repository root.

### `POLICY_START_MARKER` và `POLICY_END_MARKER`

```html
<!-- token-efficiency-policy:start -->
<!-- token-efficiency-policy:end -->
```

Hai marker xác định block policy do bộ kit quản lý. Script yêu cầu mỗi marker
xuất hiện đúng một lần và start marker phải đứng trước end marker.

### `MAX_POLICY_BYTES`

Giới hạn policy ở 16 KiB. Script không đọc file nếu kích thước vượt giới hạn
này.

### `MAX_AGENT_BYTES`

Giới hạn mỗi custom agent ở 64 KiB. Agent lớn hơn giới hạn sẽ bị bỏ qua và tạo
warning.

### `MAX_AGENT_FILES`

Giới hạn số custom agent được quét là 1000 file.

### `REQUIRED_POLICY_RULE_IDS`

Danh sách rule ID bắt buộc trong managed policy:

```js
[
  'TE-CORE-01',
  'TE-EXACT-01',
  'TE-SOURCE-01',
  'TE-REPORT-01',
  'TE-PROFILE-01',
  'TE-SAFETY-01'
]
```

Mỗi ID phải xuất hiện đúng một lần dưới dạng:

```html
<!-- TE-CORE-01 -->
```

Rule ID cho phép audit phát hiện nhóm yêu cầu bị xóa hoặc bị lặp mà không khóa
toàn bộ câu chữ bằng checksum.

`TE-SOURCE-01` bảo đảm profile chỉ rút gọn phần hội thoại và báo cáo. Source
code, identifier, comment, test, documentation, configuration, schema,
migration, commit message và user-facing text vẫn theo yêu cầu chất lượng của
repository, trừ khi người dùng chủ động yêu cầu thay đổi.

### `SUPPORTED_AGENT_PROFILES`

Hai profile hợp lệ:

```js
['safe', 'compact']
```

`safe` luôn là giá trị fallback.

### `DUPLICATE_RULE_PATTERNS`

Danh sách biểu thức chính quy đại diện cho một số rule đang có trong policy
chung, ví dụ:

```text
Respond in the same language as the user.
Remove greetings, filler...
Do not narrate routine tool calls.
```

Các pattern được dùng để ước lượng custom agent có sao chép policy chung hay
không. Đây là heuristic, không phải phép so sánh nội dung tuyệt đối.

## Các hàm hỗ trợ

### `toPosix(relativePath)`

Chuẩn hóa dấu phân cách đường dẫn thành `/`.

Ví dụ trên Windows:

```text
.github\agents\review.agent.md
```

được chuyển thành:

```text
.github/agents/review.agent.md
```

Việc chuẩn hóa giúp output giống nhau trên Windows, macOS và Linux.

### `countOccurrences(text, needle)`

Đếm số lần `needle` xuất hiện trong `text`.

Script dùng hàm này để kiểm tra start marker và end marker chỉ xuất hiện đúng
một lần.

### `addFinding(list, code, relativePath, message)`

Thêm một finding vào danh sách error hoặc warning.

Ví dụ:

```js
{
  code: 'POLICY_MISSING',
  path: '.github/copilot-instructions.md',
  message: 'Repository-wide Copilot instruction file is missing.'
}
```

Tham số:

- `list`: `result.errors` hoặc `result.warnings`.
- `code`: mã ổn định để test hoặc công cụ khác xử lý.
- `relativePath`: đường dẫn tương đối từ repository root.
- `message`: mô tả dành cho người đọc.

### `parseAgentProfile(content)`

Tìm declaration trong body custom agent:

```markdown
**Token-efficiency profile:** safe
```

Kết quả hợp lệ:

```js
{
  profile: 'safe',
  profileDeclared: true,
  issue: null
}
```

Nếu declaration thiếu hoặc không hợp lệ, hàm trả profile `safe` cùng issue
`missing` hoặc `invalid`. Nhiều declaration cũng được xem là không hợp lệ.

### `readRegularFileNoFollow(filePath, maxBytes)`

Đọc file với các kiểm tra an toàn:

1. Mở file ở chế độ chỉ đọc.
2. Dùng `O_NOFOLLOW` nếu hệ điều hành hỗ trợ.
3. Xác nhận đối tượng đã mở là regular file.
4. Kiểm tra kích thước không vượt `maxBytes`.
5. Đọc nội dung dưới dạng UTF-8.
6. Luôn đóng file trong khối `finally`.

Kết quả:

```js
{
  content: 'Nội dung file',
  size: 1024
}
```

Hàm có thể ném lỗi `NOT_REGULAR_FILE`, `FILE_TOO_LARGE` hoặc lỗi filesystem.

### `inspectPathComponents(root, relativePath)`

Kiểm tra từng thành phần của đường dẫn bằng `lstatSync()`.

Với đường dẫn:

```text
.github/copilot-instructions.md
```

hàm lần lượt kiểm tra:

```text
.github
.github/copilot-instructions.md
```

Nếu một thành phần là symbolic link, hàm trả đường dẫn đó trong thuộc tính
`symlink`.

Kết quả thông thường:

```js
{
  stat,
  symlink: null
}
```

## Kiểm tra policy

### `auditPolicy(root, result)`

Kiểm tra `.github/copilot-instructions.md` theo thứ tự:

1. Đường dẫn có tồn tại không.
2. Đường dẫn có chứa symbolic link không.
3. Đối tượng có phải regular file không.
4. Kích thước có vượt 16 KiB không.
5. File có đọc được an toàn không.
6. Start marker và end marker có xuất hiện đúng một lần không.
7. End marker có đứng sau start marker không.
8. Block giữa hai marker có nội dung không.
9. Mỗi rule ID bắt buộc có xuất hiện đúng một lần không.

Nếu tất cả kiểm tra đều đạt:

```js
result.policy.valid = true;
```

Nếu có lỗi, hàm thêm finding vào `result.errors` rồi dừng kiểm tra policy.

Các error code:

| Code | Ý nghĩa |
| --- | --- |
| `POLICY_MISSING` | Không tìm thấy policy |
| `POLICY_UNREADABLE` | Không thể kiểm tra hoặc đọc policy |
| `POLICY_PATH_SYMLINK` | Đường dẫn policy chứa symbolic link |
| `POLICY_NOT_REGULAR_FILE` | Policy không phải regular file |
| `POLICY_TOO_LARGE` | Policy vượt 16 KiB |
| `POLICY_MARKERS_INVALID` | Marker thiếu, lặp hoặc sai thứ tự |
| `POLICY_BLOCK_EMPTY` | Block giữa hai marker không có nội dung |
| `POLICY_RULE_MISSING` | Managed policy thiếu rule ID bắt buộc |
| `POLICY_RULE_DUPLICATED` | Rule ID bắt buộc xuất hiện nhiều lần |

## Kiểm tra custom agent

### `collectAgentFiles(root, result)`

Quét đệ quy thư mục:

```text
.github/agents/
```

Hàm sử dụng `stack` để duyệt các thư mục con và thu thập mọi file có đuôi:

```text
.md
```

Ví dụ kết quả:

```js
[
  {
    absolutePath: '/repo/.github/agents/bug-fix.agent.md',
    relativePath: '.github/agents/bug-fix.agent.md'
  }
]
```

Hành vi đặc biệt:

- Không có thư mục `.github/agents`: trả danh sách rỗng, không báo lỗi.
- Thư mục không đọc được: thêm warning.
- Gặp symbolic link: bỏ qua và thêm warning.
- Dừng sau tối đa `MAX_AGENT_FILES` và luôn warning nếu phát hiện thêm agent.

### `auditAgents(root, result)`

Nhận danh sách từ `collectAgentFiles()` rồi kiểm tra từng agent:

1. Thêm agent vào `result.agents`.
2. Xác nhận agent vẫn là regular file.
3. Kiểm tra kích thước không vượt 64 KiB.
4. Đọc file bằng `readRegularFileNoFollow()`.
5. Đọc profile bằng `parseAgentProfile()`.
6. Fallback về `safe` và warning nếu profile thiếu hoặc sai.
7. Tính `duplicateScore` từ `DUPLICATE_RULE_PATTERNS`.
8. Kiểm tra agent có chứa marker của policy không.

Agent được đánh dấu sao chép policy nếu:

```text
Chứa start marker
hoặc chứa end marker
hoặc khớp ít nhất hai duplicate rule pattern
```

Kết quả agent:

```js
{
  path: '.github/agents/example.agent.md',
  profile: 'safe',
  profileDeclared: true,
  duplicatePolicy: true
}
```

Các warning code:

| Code | Ý nghĩa |
| --- | --- |
| `AGENTS_DIRECTORY_UNREADABLE` | Không thể kiểm tra hoặc đọc thư mục agent |
| `AGENTS_DIRECTORY_UNSAFE` | Đường dẫn agent là symlink hoặc không phải thư mục |
| `AGENT_PATH_SYMLINK` | Một entry trong thư mục agent là symbolic link |
| `AGENT_SCAN_LIMIT_REACHED` | Đã đạt giới hạn số agent cần quét |
| `AGENT_UNREADABLE` | Không thể kiểm tra hoặc đọc agent |
| `AGENT_TOO_LARGE` | Agent vượt 64 KiB |
| `AGENT_NOT_REGULAR_FILE` | Agent không còn là regular file |
| `AGENT_PROFILE_MISSING` | Agent không khai báo profile; fallback `safe` |
| `AGENT_PROFILE_INVALID` | Profile sai hoặc lặp; fallback `safe` |
| `AGENT_DUPLICATES_SHARED_POLICY` | Agent có dấu hiệu sao chép policy chung |

Sau khi kiểm tra, danh sách agent được sắp xếp theo đường dẫn để output ổn định.

## Hàm audit chính

### `auditRepository(rootInput = process.cwd())`

Đây là API chính để test hoặc module khác gọi trực tiếp.

Hàm tạo kết quả ban đầu:

```js
{
  root,
  ok: false,
  policy: {
    path: '.github/copilot-instructions.md',
    bytes: 0,
    valid: false
  },
  agents: [],
  errors: [],
  warnings: []
}
```

Sau đó hàm:

1. Chuyển `rootInput` thành đường dẫn tuyệt đối.
2. Kiểm tra root tồn tại, là thư mục và không phải symbolic link.
3. Gọi `auditPolicy()`.
4. Gọi `auditAgents()`.
5. Đặt `result.ok` dựa trên số error.

```js
result.ok = result.errors.length === 0;
```

Warning không làm audit thất bại.

Mỗi phần tử `agents` có interface:

```js
{
  path: '.github/agents/review.md',
  profile: 'compact',
  profileDeclared: true,
  duplicatePolicy: false
}
```

Các root error:

| Code | Ý nghĩa |
| --- | --- |
| `ROOT_UNREADABLE` | Không thể kiểm tra repository root |
| `ROOT_UNSAFE` | Root là symlink hoặc không phải thư mục |

## Xử lý dòng lệnh

### `parseArguments(argv)`

Chuyển mảng tham số dòng lệnh thành options.

Các tham số được hỗ trợ:

| Tham số | Ý nghĩa |
| --- | --- |
| `--root PATH` | Chọn repository cần audit |
| `--hook` | Xuất JSON dành cho SessionStart hook |
| `--help`, `-h` | Hiện hướng dẫn sử dụng |

Ví dụ:

```bash
node .github/scripts/token-efficiency-audit.mjs --root "/project" --hook
```

Kết quả options:

```js
{
  root: '/project',
  hook: true,
  help: false
}
```

Hàm ném lỗi nếu `--root` không có giá trị hoặc gặp tham số không hỗ trợ.

### `formatCliResult(result)`

Chuyển kết quả audit thành text dễ đọc trong terminal.

Ví dụ:

```text
Token efficiency audit
Policy: PASS (.github/copilot-instructions.md)
Custom agents: 1
Profiles: safe=1, compact=0
Result: PASS
```

Nếu có finding, mỗi error hoặc warning được in trên một dòng.

### `formatHookResult(result)`

Chuyển kết quả audit thành object dành cho hook.

Policy hợp lệ:

```json
{"continue":true}
```

Policy lỗi:

```json
{
  "continue": true,
  "systemMessage": "Token-efficiency policy check failed (...)."
}
```

`continue` luôn là `true`, vì audit không được phép chặn agent session.

### `printHelp()`

In cú pháp sử dụng:

```text
Usage: node .github/scripts/token-efficiency-audit.mjs [--root PATH] [--hook]
```

### `runCli(argv = process.argv.slice(2))`

Điểm điều phối cho chế độ CLI:

1. Kiểm tra người dùng có yêu cầu `--hook` không.
2. Gọi `parseArguments()`.
3. Xử lý `--help`.
4. Gọi `auditRepository()`.
5. Dùng `formatHookResult()` hoặc `formatCliResult()`.
6. Trả exit code.

Exit code:

| Code | Ý nghĩa |
| --- | --- |
| `0` | Audit thành công hoặc đang chạy ở hook mode |
| `1` | Audit hoàn tất nhưng phát hiện error |
| `2` | Tham số không hợp lệ hoặc quá trình audit bị lỗi |

Trong hook mode, exception được chuyển thành JSON có `continue: true` và exit
code `0` để không làm gián đoạn session.

## Điểm bắt đầu chương trình

### `isMain`

`isMain` xác định file đang được chạy trực tiếp hay được import:

```js
const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
```

Khi chạy:

```bash
node .github/scripts/token-efficiency-audit.mjs
```

`isMain` là `true` và script gọi:

```js
process.exitCode = runCli();
```

Khi test import:

```js
import { auditRepository } from '../.github/scripts/token-efficiency-audit.mjs';
```

`isMain` là `false`, vì vậy CLI không tự chạy.

## Ví dụ sử dụng như module

```js
import {
  auditRepository,
} from './.github/scripts/token-efficiency-audit.mjs';

const result = auditRepository('/path/to/repository');

console.log(result.ok);
console.log(result.errors);
console.log(result.warnings);
```

## Giới hạn hiện tại

- Rule ID xác nhận nhóm yêu cầu còn tồn tại, nhưng không xác minh toàn bộ ngữ
  nghĩa của câu chữ nằm sau ID.
- Phát hiện agent sao chép policy dựa trên một số pattern tiếng Anh, nên có thể
  bỏ sót nội dung được viết lại hoặc dịch sang ngôn ngữ khác.
- Warning không làm `result.ok` thành `false`.
