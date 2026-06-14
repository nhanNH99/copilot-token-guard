# Kiến thức cần biết để hiểu Secure Token Kit

Tài liệu này giải thích các kiến thức nền tảng để đọc, sử dụng và bảo trì
project. Nội dung tập trung vào kiến trúc GitHub Copilot, prompt/context,
Node.js, filesystem, hook và bảo mật local-only.

## 1. Bức tranh tổng thể

Project giải quyết hai việc khác nhau:

1. Hướng dẫn GitHub Copilot và custom agent trả lời ngắn hơn.
2. Kiểm tra bộ hướng dẫn đó vẫn được cài đặt đúng.

Hai luồng hoạt động:

```text
PROMPT PATH

Repository instruction
        +
Custom agent instruction
        +
Prompt người dùng
        |
        v
GitHub Copilot xử lý yêu cầu
        |
        v
Phản hồi theo profile safe hoặc compact
```

```text
CONTROL PATH

SessionStart hook
        |
        v
Node.js audit script
        |
        +-- kiểm tra policy
        +-- kiểm tra rule ID
        +-- kiểm tra agent profile
        +-- kiểm tra policy bị sao chép
        |
        v
Cảnh báo nếu cấu hình sai
```

Prompt path trực tiếp ảnh hưởng phản hồi của model. Control path chỉ kiểm tra
cấu hình, không viết lại prompt hoặc response.

## 2. GitHub Copilot customization

GitHub Copilot cho phép repository bổ sung nhiều lớp tùy chỉnh. Project sử dụng
bốn loại chính: repository instruction, custom agent, skill và hook.

### Repository instruction

File:

```text
.github/copilot-instructions.md
```

Repository instruction chứa các quy tắc dùng chung cho mọi Copilot chat và
custom agent trong workspace.

Trong project này, nó quy định:

- Bỏ lời chào và filler.
- Trả kết quả trước.
- Không chép log dài.
- Dùng profile `safe` hoặc `compact`.
- Giữ nguyên cảnh báo bảo mật.
- Không áp dụng cách viết rút gọn vào source artifact.

Repository instruction là thành phần trực tiếp làm thay đổi phong cách output.
Script và hook không tự làm response ngắn hơn.

### Custom agent

Custom agent là một persona chuyên môn được định nghĩa bằng file Markdown trong:

```text
.github/agents/
```

Ví dụ:

```text
.github/agents/bug-fix-agent.agent.md
```

Agent mẫu chứa:

- Vai trò: kỹ sư sửa lỗi.
- Workflow: đọc code, tái hiện lỗi, sửa và xác minh.
- Constraint: không sửa code không liên quan, không che giấu lỗi.
- Profile giảm token.

```markdown
**Token-efficiency profile:** safe
```

Custom agent không nên sao chép toàn bộ repository instruction. Việc sao chép
làm tăng input context và tạo nhiều bản policy khó đồng bộ.

### Agent skill

Skill là một capability có hướng dẫn riêng, đặt tại:

```text
.github/skills/<skill-name>/SKILL.md
```

Skill của project:

```text
.github/skills/token-efficiency-audit/SKILL.md
```

Skill không chứa logic audit. Nó hướng dẫn agent:

1. Chạy script Node.js.
2. Đọc kết quả.
3. Báo cáo policy status, profile count và finding code.
4. Không chỉnh sửa file hoặc đọc dữ liệu không liên quan.

Frontmatter:

```yaml
disable-model-invocation: true
```

nghĩa là model không tự chọn skill này trong task thông thường. Người dùng phải
chủ động gọi skill.

### Hook

Hook là cơ chế chạy command khi một sự kiện trong vòng đời agent xảy ra.

Project dùng:

```json
"SessionStart"
```

Khi session bắt đầu, VS Code chạy:

```bash
node .github/scripts/token-efficiency-audit.mjs --hook
```

Hook là automation xác định bằng code. Nó khác instruction:

| Thành phần | Vai trò |
| --- | --- |
| Instruction | Hướng dẫn model nên hành xử thế nào |
| Hook | Chạy command tại một sự kiện |
| Skill | Hướng dẫn agent thực hiện một capability |
| Script | Chứa logic chương trình thực tế |

## 3. Prompt và context engineering

### Prompt không chỉ là câu người dùng nhập

Khi người dùng gửi prompt, model có thể nhận nhiều lớp context:

```text
Platform/system instruction
        +
Repository instruction
        +
Custom agent instruction
        +
Skill instruction nếu được gọi
        +
Prompt và context của người dùng
```

Model phải tổng hợp các lớp này để quyết định hành vi.

### Input token và output token

- Input token: instruction, prompt, code và lịch sử được gửi vào model.
- Output token: nội dung model tạo ra.

Nếu một custom agent sao chép policy dùng chung, input token tăng ở mọi request
có agent đó. Nếu response dài, lịch sử của lượt sau cũng lớn hơn.

Project giảm token theo hai hướng:

1. Policy chỉ tồn tại một lần ở repository level.
2. Policy yêu cầu model loại bỏ nội dung không cần thiết khỏi response.

### Instruction conflict

Xung đột xảy ra khi các instruction yêu cầu hành vi trái ngược.

Ví dụ:

```text
Repository: trả lời ngắn.
Agent: giải thích mọi bước thật chi tiết.
User: chỉ trả kết quả.
```

Để giảm xung đột:

- Repository instruction chỉ giữ quy tắc dùng chung.
- Agent chỉ giữ workflow chuyên môn.
- Người dùng có thể yêu cầu chi tiết khi thực sự cần.
- Rule an toàn luôn ưu tiên hơn mục tiêu rút gọn.

### Safe và compact

`safe`:

- Là profile mặc định.
- Dùng câu ngắn nhưng đầy đủ.
- Phù hợp bug fix, security review, migration và task có rủi ro.

`compact`:

- Dùng cho task ít rủi ro.
- Cho phép fragments và danh sách dày hơn.
- Không được làm thay đổi source artifact.

`compact` phải quay về `safe` khi có:

- Security vulnerability.
- Authentication hoặc authorization.
- Secret.
- Destructive action.
- Data-loss risk.
- Migration hoặc rollback.
- Failed check hoặc unresolved error.
- Chuỗi bước mà thứ tự dễ bị hiểu sai.

Nguyên tắc này được gọi là Auto-Clarity: ưu tiên rõ ràng khi việc nén có thể tạo
rủi ro.

## 4. Bảo vệ source artifact

Rule `TE-SOURCE-01` phân biệt hai loại output:

### Conversational output

Có thể rút gọn:

- Progress update.
- Giải thích trong chat.
- Completion report.
- Tóm tắt thay đổi.

### Generated artifact

Không được rút gọn chỉ vì profile:

- Source code.
- Identifier.
- Code comment.
- Test.
- Documentation.
- Configuration.
- Schema.
- Migration.
- Commit message.
- User-facing text.

Ví dụ, `compact` không được tự đổi:

```js
function validateAuthenticationToken(token) {}
```

thành:

```js
function valAuthTok(t) {}
```

Nó cũng không được xóa comment hữu ích hoặc làm error message khó hiểu. Artifact
chỉ thay đổi theo yêu cầu task, convention của repository và yêu cầu rõ ràng từ
người dùng.

## 5. Managed block và rule ID

Policy được đặt giữa hai marker:

```html
<!-- token-efficiency-policy:start -->
...
<!-- token-efficiency-policy:end -->
```

Nội dung ngoài marker thuộc project đích. Nội dung trong marker thuộc Secure
Token Kit.

Mỗi nhóm yêu cầu có một ID:

```text
TE-CORE-01
TE-EXACT-01
TE-SOURCE-01
TE-REPORT-01
TE-PROFILE-01
TE-SAFETY-01
```

Ví dụ:

```html
<!-- TE-SOURCE-01 -->
```

Audit yêu cầu mỗi ID xuất hiện đúng một lần.

Lợi ích:

- Phát hiện nhóm rule bị xóa.
- Phát hiện rule bị copy lặp.
- Cho phép chỉnh câu chữ mà không cần checksum toàn block.
- Tạo mã ổn định để tài liệu và script cùng tham chiếu.

Giới hạn: rule ID chỉ chứng minh marker còn tồn tại. Nó không thể tự hiểu toàn
bộ ngữ nghĩa của câu chữ phía sau.

## 6. Node.js và ES Modules

Script sử dụng Node.js 18+ và không có package ngoài.

### Shebang

Dòng đầu:

```js
#!/usr/bin/env node
```

cho phép hệ điều hành dùng Node.js để chạy file khi file được thực thi trực
tiếp.

### ES Module

Script dùng:

```js
import path from 'node:path';
export function auditRepository() {}
```

- `import`: nạp module.
- `export`: công khai hằng số hoặc hàm cho module khác.
- Prefix `node:`: chỉ rõ đây là module built-in của Node.js.

### `process`

`process` cung cấp thông tin về chương trình đang chạy:

```js
process.cwd()
process.argv
process.stdout
process.stderr
process.exitCode
```

Ý nghĩa:

- `cwd()`: thư mục làm việc hiện tại.
- `argv`: tham số command line.
- `stdout`: output thông thường.
- `stderr`: output lỗi.
- `exitCode`: mã kết thúc chương trình.

### Giá trị mặc định

Ví dụ:

```js
function auditRepository(rootInput = process.cwd()) {}
```

Nếu không truyền `rootInput`, script audit repository hiện tại.

### Optional chaining

Ví dụ:

```js
if (error?.code === 'ENOENT') {}
```

`?.` tránh lỗi nếu `error` không có thuộc tính mong đợi.

### Array operations

Script dùng các thao tác phổ biến:

```js
array.map(...)
array.filter(...)
array.reduce(...)
array.sort(...)
array.includes(...)
```

Ví dụ `reduce()` tính số pattern trùng với nội dung agent. `sort()` giúp output
ổn định giữa các lần chạy.

### Regular expression

Profile được nhận bằng regex:

```js
/^\s*\*\*Token-efficiency profile:\*\*\s*(\S+)\s*$/i
```

Các phần chính:

- `^` và `$`: phải khớp toàn bộ dòng.
- `\s*`: cho phép khoảng trắng.
- `\*\*`: ký tự `**` trong Markdown.
- `(\S+)`: lấy tên profile.
- `i`: không phân biệt chữ hoa và chữ thường.

## 7. Command-line interface

Script hỗ trợ:

```bash
node .github/scripts/token-efficiency-audit.mjs
node .github/scripts/token-efficiency-audit.mjs --root "/path/to/repo"
node .github/scripts/token-efficiency-audit.mjs --hook
node .github/scripts/token-efficiency-audit.mjs --help
```

### Parse argument

`parseArguments()` duyệt từng phần tử trong `process.argv` và tạo options:

```js
{
  root: '/repository',
  hook: true,
  help: false
}
```

Tham số không được hỗ trợ tạo lỗi thay vì bị bỏ qua im lặng.

### Exit code

Quy ước:

```text
0 = thành công
1 = audit chạy được nhưng policy có error
2 = tham số hoặc quá trình chạy không hợp lệ
```

Hook mode luôn trả `0` để audit không chặn agent session.

### stdout và stderr

CLI thông thường in báo cáo vào `stdout`.

Hook mode chỉ in JSON vào `stdout`:

```json
{"continue":true}
```

Không được in debug text cùng JSON, vì VS Code cần parse toàn bộ output.

## 8. Node.js filesystem

Filesystem là phần quan trọng nhất của audit script.

### Path tuyệt đối và path tương đối

Path tương đối:

```text
.github/copilot-instructions.md
```

Path tuyệt đối:

```text
/repository/.github/copilot-instructions.md
```

Script dùng:

```js
path.resolve(rootInput)
path.join(root, relativePath)
path.relative(root, absolutePath)
```

### `lstatSync()`

`lstatSync()` trả metadata của chính path và không tự đi theo symbolic link.

Nó giúp phân biệt:

- Regular file.
- Directory.
- Symbolic link.

### `openSync()` và file descriptor

`openSync()` mở file và trả về file descriptor:

```js
const descriptor = openSync(filePath, constants.O_RDONLY);
```

File descriptor là handle đại diện cho file đang mở.

Sau khi dùng phải đóng:

```js
closeSync(descriptor);
```

Script đặt việc đóng file trong `finally` để file luôn được đóng dù đọc thành
công hay phát sinh lỗi.

### `fstatSync()`

`fstatSync(descriptor)` đọc metadata từ file đã mở. Nó giúp script xác nhận đối
tượng thực sự được mở là regular file và kiểm tra kích thước trước khi đọc.

### `readFileSync()`

Script đọc UTF-8:

```js
readFileSync(descriptor, 'utf8');
```

Giới hạn kích thước được kiểm tra trước nhằm tránh nạp file quá lớn vào memory.

### `readdirSync()`

`readdirSync()` đọc danh sách entry trong thư mục:

```js
readdirSync(directory, { withFileTypes: true });
```

`withFileTypes` cho phép kiểm tra entry là file, directory hay symbolic link mà
không cần đọc nội dung.

### Duyệt thư mục bằng stack

Audit dùng stack:

```js
const stack = [agentsPath];
```

Quy trình:

1. Lấy một thư mục khỏi stack.
2. Đọc các entry.
3. Thêm thư mục con vào stack.
4. Thu thập file `.md`.
5. Dừng khi đạt giới hạn.

Đây là depth-first traversal không đệ quy bằng function call.

## 9. Path đa nền tảng

Windows dùng dấu:

```text
\
```

macOS và Linux dùng:

```text
/
```

`path.sep` đại diện cho separator của hệ điều hành hiện tại.

Hàm `toPosix()` chuyển output thành `/`:

```js
relativePath.split(path.sep).join('/');
```

Việc này giúp finding path có cùng format trên mọi nền tảng.

Không nên tự nối path bằng chuỗi:

```js
root + '/.github/agents'
```

Nên dùng:

```js
path.join(root, '.github', 'agents')
```

## 10. Kiến thức bảo mật filesystem

### Symbolic link

Symbolic link là một path trỏ tới path khác.

Ví dụ:

```text
.github/copilot-instructions.md -> /outside/secret.txt
```

Nếu script đi theo link, nó có thể đọc file ngoài repository.

Project chống việc này bằng hai lớp:

1. Kiểm tra từng thành phần path với `lstatSync()`.
2. Dùng `O_NOFOLLOW` khi mở file nếu hệ điều hành hỗ trợ.

### Regular file

Audit chỉ đọc regular file. Nó không đọc:

- Directory.
- Device.
- Socket.
- Named pipe.

Điều này tránh hành vi bất ngờ hoặc việc đọc bị treo.

### Giới hạn kích thước

Project giới hạn:

```text
Policy: 16 KiB
Agent:  64 KiB
Agent count: 1000
```

Giới hạn giúp kiểm soát:

- Memory usage.
- Thời gian chạy hook.
- Phạm vi dữ liệu được đọc.
- Repository được tạo cố ý để làm audit chậm.

### Fail-safe default

Khi agent profile thiếu hoặc sai:

```text
fallback = safe
```

Đây là fail-safe default: trạng thái lỗi phải quay về lựa chọn ít rủi ro hơn.

### Least privilege

Script chỉ đọc:

```text
.github/copilot-instructions.md
.github/agents/**/*.md
```

Nó không cần đọc source code, `.env`, secret, transcript hoặc session log để
hoàn thành nhiệm vụ.

## 11. Hook protocol

Hook config:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node .github/scripts/token-efficiency-audit.mjs --hook",
        "cwd": ".",
        "timeout": 5
      }
    ]
  }
}
```

### `SessionStart`

Command chạy khi agent session bắt đầu, không phải ở mọi prompt.

Điều này giảm:

- Số lần chạy audit.
- Độ trễ.
- CPU và filesystem work.
- Nội dung có thể được inject vào context.

### `cwd`

```json
"cwd": "."
```

Command chạy từ workspace root. Vì vậy path tương đối trong command mới trỏ
đúng script.

### `timeout`

```json
"timeout": 5
```

Hook chỉ có tối đa năm giây. Giới hạn file và agent giúp audit hoàn thành trong
thời gian này.

### Non-blocking behavior

Kết quả thành công:

```json
{"continue":true}
```

Kết quả policy lỗi:

```json
{
  "continue": true,
  "systemMessage": "Token-efficiency policy check failed (...)"
}
```

Session vẫn tiếp tục. Warning profile không được inject vì warning đó có thể
làm tăng context mà không cần thiết; người dùng xem warning bằng audit thủ công.

## 12. Markdown, YAML frontmatter và JSON

### Markdown

Markdown chứa instruction mà con người và model cùng đọc được.

Các thành phần project dùng:

````markdown
# Heading
- List item
**Bold text**
```text
code block
```
````

Marker HTML comment không hiện khi render nhưng script vẫn đọc được:

```html
<!-- TE-CORE-01 -->
```

### YAML frontmatter

Frontmatter nằm giữa hai dòng `---`:

```yaml
---
name: Bug Fix Agent
description: Reproduce, diagnose, fix, and verify software defects.
---
```

Frontmatter là metadata để VS Code biết tên, mô tả và tùy chọn của agent hoặc
skill. Nội dung Markdown phía sau là instruction cho model.

Profile được đặt trong body thay vì frontmatter vì nó là convention riêng của
project, không phải field chuẩn của VS Code.

### JSON

Hook dùng JSON vì VS Code cần cấu trúc dữ liệu xác định.

JSON yêu cầu:

- Key và string dùng dấu `"`.
- Không có comment.
- Không có dấu phẩy thừa cuối object hoặc array.

## 13. Local-only và ranh giới bảo mật

“Local-only” trong project nghĩa là lớp bổ sung này:

- Không gọi network.
- Không cài dependency.
- Không dùng MCP proxy.
- Không đọc transcript.
- Không ghi telemetry.
- Không gửi thêm dữ liệu đến dịch vụ khác.

Nó không có nghĩa GitHub Copilot chạy model trên máy local. Copilot vẫn là dịch
vụ AI của GitHub và chịu chính sách xử lý dữ liệu của nền tảng.

Ranh giới đúng:

```text
Secure Token Kit: local policy + local audit
GitHub Copilot: model service bên ngoài project
```

## 14. Finding, error và warning

Finding có cấu trúc:

```js
{
  code: 'AGENT_PROFILE_MISSING',
  path: '.github/agents/review.md',
  message: 'Agent has no token-efficiency profile; using safe.'
}
```

### Error

Error làm:

```js
result.ok = false;
```

Ví dụ:

- Policy không tồn tại.
- Marker sai.
- Rule ID bắt buộc bị thiếu.
- Policy đi qua symbolic link.

### Warning

Warning không làm audit fail.

Ví dụ:

- Agent thiếu profile.
- Agent khai báo profile sai.
- Agent sao chép policy dùng chung.
- Đạt giới hạn số agent.

Phân loại này phản ánh nguyên tắc:

- Policy sai có thể ảnh hưởng mọi agent nên là error.
- Agent profile sai có fallback `safe`, nên có thể tiếp tục với warning.

## 15. Cách đọc project

Đọc theo thứ tự:

1. `README.md`: mục tiêu, flow và cách sử dụng.
2. `.github/copilot-instructions.md`: policy trực tiếp tác động model.
3. `.github/agents/bug-fix-agent.agent.md`: cách agent khai báo profile.
4. `.github/hooks/token-efficiency.json`: thời điểm script tự chạy.
5. `.github/skills/token-efficiency-audit/SKILL.md`: workflow audit thủ công.
6. `.github/scripts/token-efficiency-audit.md`: giải thích từng hàm.
7. `.github/scripts/token-efficiency-audit.mjs`: implementation thực tế.
8. `task.md`: quyết định kiến trúc và đánh đổi bảo mật.

Khi đọc một thành phần, trả lời bốn câu hỏi:

1. Ai đọc hoặc chạy thành phần này?
2. Thành phần chạy tự động hay thủ công?
3. Nó đọc và ghi dữ liệu gì?
4. Nếu nó lỗi, prompt path hoặc session có bị ảnh hưởng không?

## 16. Thuật ngữ

| Thuật ngữ | Ý nghĩa |
| --- | --- |
| Policy | Nhóm quy tắc dùng chung cho phản hồi |
| Managed block | Phần policy nằm giữa start/end marker |
| Rule ID | Marker ổn định đại diện cho một nhóm yêu cầu |
| Profile | Mức độ rút gọn `safe` hoặc `compact` |
| Auto-Clarity | Tự quay về cách viết đầy đủ khi có rủi ro |
| Audit | Kiểm tra cấu trúc và cấu hình policy/agent |
| Finding | Một error hoặc warning do audit tạo ra |
| Hook | Command tự chạy khi một event xảy ra |
| Skill | Capability có instruction để agent làm theo |
| Custom agent | Persona với workflow và constraint chuyên môn |
| Context | Toàn bộ instruction và dữ liệu model nhận ở một lượt |
| Token | Đơn vị văn bản model dùng để xử lý input/output |
| Artifact | Code, config, docs hoặc nội dung được tạo ra |
| Fallback | Giá trị an toàn dùng khi cấu hình thiếu hoặc sai |
| Symlink | Path tham chiếu tới một path khác |
| File descriptor | Handle của file đang được mở |
