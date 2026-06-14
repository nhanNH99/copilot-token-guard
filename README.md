# Secure Token Kit cho GitHub Copilot

Bộ cấu hình local-only giúp GitHub Copilot và các custom agent trong repository
trả lời ngắn gọn hơn mà không cần plugin, package ngoài, MCP proxy, network hoặc
telemetry.

## Hiểu nhanh

Hệ thống gồm hai phần:

1. **Policy giảm token**: trực tiếp hướng dẫn Copilot tạo phản hồi ngắn, chính
   xác và không lặp lại thông tin, với profile `safe` hoặc `compact`.
2. **Audit policy**: kiểm tra policy đã được cài đúng và không bị custom agent
   sao chép lại hoặc khai báo profile sai.

Điểm quan trọng:

- `.github/copilot-instructions.md` là thành phần trực tiếp ảnh hưởng đến phản
  hồi của Copilot.
- Script, skill và hook chỉ kiểm tra, cảnh báo và giúp duy trì policy.
- Audit không sửa prompt, không rút gọn output và không chạy sau mỗi prompt.

## Cấu trúc

```text
.
├── .github/
│   ├── agents/
│   │   └── bug-fix-agent.agent.md
│   ├── hooks/
│   │   └── token-efficiency.json
│   ├── scripts/
│   │   └── token-efficiency-audit.mjs
│   ├── skills/
│   │   └── token-efficiency-audit/
│   │       └── SKILL.md
│   └── copilot-instructions.md
└── tests/
    └── token-efficiency-audit.test.mjs
```

Vai trò của từng thành phần:

| Thành phần | Vai trò | Cách chạy |
| --- | --- | --- |
| `copilot-instructions.md` | Áp dụng rule trả lời ngắn cho Copilot và custom agent | Tự động được Copilot nạp |
| `token-efficiency-audit.mjs` | Thực hiện việc kiểm tra policy và custom agent | Được gọi bởi hook, skill hoặc lệnh |
| `token-efficiency.json` | Gọi script audit khi bắt đầu session | Tự động |
| `token-efficiency-audit/SKILL.md` | Cho phép người dùng chủ động gọi audit trong Copilot Chat | Thủ công |
| `bug-fix-agent.agent.md` | Custom agent mẫu cho workflow sửa bug | Khi người dùng chọn agent |

## Flow hoạt động

### Khi bắt đầu session

```text
Người dùng bắt đầu agent session
              |
              v
SessionStart hook gọi script audit
              |
              v
Kiểm tra .github/copilot-instructions.md
       |                         |
       | hợp lệ                  | thiếu hoặc hỏng
       v                         v
Tiếp tục im lặng        Hiện cảnh báo tổng quát
       |                         |
       +------------+------------+
                    |
                    v
             Session tiếp tục
```

Hook không block session. Nếu audit thất bại, người dùng vẫn có thể sử dụng
Copilot.

### Khi người dùng gửi prompt

```text
.github/copilot-instructions.md
              +
Instruction của custom agent đang chọn
              +
Prompt của người dùng
              |
              v
Copilot thực hiện yêu cầu
              |
              v
Trả kết quả ngắn gọn theo policy
```

Ví dụ khi chọn `Bug Fix Agent`:

```text
[Repository instruction]
Trả kết quả trước, bỏ filler, chỉ báo cáo thay đổi và test thực tế.

[Custom agent instruction]
Token-efficiency profile: safe.
Tái hiện bug, tìm root cause, sửa tối thiểu và thêm regression test.

[User prompt]
API đang chấp nhận email rỗng. Hãy sửa lỗi.
```

Audit không chạy lại cho từng prompt. Nó chỉ tự động chạy khi bắt đầu session
hoặc chạy thủ công khi người dùng yêu cầu.

## Audit tự động và thủ công

Cả ba cách dưới đây đều gọi cùng một script:

```text
SessionStart hook tự động ----+
                              |
Skill chạy thủ công ----------+--> token-efficiency-audit.mjs
                              |
Lệnh chạy thủ công -----------+
```

### Audit tự động

File `.github/hooks/token-efficiency.json` chạy lệnh sau khi bắt đầu agent
session:

```bash
node .github/scripts/token-efficiency-audit.mjs --hook
```

Kết quả:

- Policy hợp lệ: trả `{"continue":true}` và không cảnh báo.
- Policy thiếu hoặc hỏng: thêm `systemMessage` tổng quát.
- Warning về agent profile không được inject vào session; xem bằng audit thủ
  công.
- Session luôn tiếp tục.

VS Code Hooks đang là tính năng Preview và có thể bị organization policy tắt.
Kiểm tra output channel `GitHub Copilot Chat Hooks` để xác nhận hook đã chạy.

### Audit thủ công bằng lệnh

Yêu cầu Node.js 18 trở lên:

```bash
node .github/scripts/token-efficiency-audit.mjs
```

Kiểm tra repository khác:

```bash
node .github/scripts/token-efficiency-audit.mjs --root "/path/to/repository"
```

Nên chạy thủ công khi:

- Vừa cài bộ kit vào project.
- Vừa sửa `.github/copilot-instructions.md`.
- Vừa thêm hoặc sửa custom agent.
- Hook bị tắt hoặc không chạy.
- Muốn kiểm tra trước khi commit hoặc tạo pull request.

### Audit thủ công bằng skill

Trong Copilot Chat, chọn:

```text
/token-efficiency-audit
```

Skill có `disable-model-invocation: true`, vì vậy Copilot không tự động tải
skill này vào các task bình thường. Skill chỉ được dùng khi người dùng chủ động
gọi.

### Audit kiểm tra gì?

- Policy tồn tại và là regular file.
- Đường dẫn policy không đi qua symbolic link.
- Policy không vượt quá 16 KiB.
- Marker xuất hiện đúng một cặp và đúng thứ tự.
- Các rule ID bắt buộc xuất hiện đúng một lần.
- Profile của mỗi custom agent là `safe` hoặc `compact`.
- Custom agent nào có dấu hiệu sao chép rule dùng chung.

Audit chỉ đọc:

```text
.github/copilot-instructions.md
.github/agents/**/*.md
```

Script không sửa file, chạy child process, truy cập network, đọc source code,
secret, transcript hoặc session history.

## Áp dụng vào project

### Trường hợp 1: Project chưa có Copilot instructions

Từ repository này, sao chép các file sau vào root của project:

```text
.github/copilot-instructions.md
.github/hooks/token-efficiency.json
.github/scripts/token-efficiency-audit.mjs
.github/skills/token-efficiency-audit/SKILL.md
```

Trong đó:

- `copilot-instructions.md`, hook và script là bộ tối thiểu để policy hoạt động
  và được audit tự động.
- Skill là tùy chọn nhưng nên giữ để có thể chạy audit thủ công trong Copilot
  Chat.
- Không cần sao chép `bug-fix-agent.agent.md`; đây chỉ là agent mẫu.

Sau khi sao chép:

1. Mở project đó làm workspace root trong VS Code.
2. Chạy audit:

   ```bash
   node .github/scripts/token-efficiency-audit.mjs
   ```

3. Mở Copilot Chat và bắt đầu một agent session mới.
4. Kiểm tra `GitHub Copilot Chat Hooks` để xác nhận hook đã chạy.
5. Mở Chat Diagnostics hoặc phần References để xác nhận
   `.github/copilot-instructions.md` được nạp.

### Trường hợp 2: Project đã có Copilot instructions

Không ghi đè `.github/copilot-instructions.md` hiện tại.

1. Mở file `.github/copilot-instructions.md` của project đích.
2. Sao chép toàn bộ block sau từ repository này:

   ```text
   <!-- token-efficiency-policy:start -->
   ...
   <!-- token-efficiency-policy:end -->
   ```

3. Chèn block vào file hiện tại.
4. Giữ instruction riêng của project ở bên ngoài block marker.
5. Sao chép hook, script và skill:

   ```text
   .github/hooks/token-efficiency.json
   .github/scripts/token-efficiency-audit.mjs
   .github/skills/token-efficiency-audit/SKILL.md
   ```

6. Chạy audit để kiểm tra kết quả:

   ```bash
   node .github/scripts/token-efficiency-audit.mjs
   ```

Ví dụ:

```markdown
# Project Instructions

- Dùng Node.js 22.
- Chạy test bằng `npm test`.

<!-- token-efficiency-policy:start -->
...shared response efficiency rules...
<!-- token-efficiency-policy:end -->
```

### Trường hợp 3: Project đã có custom agent

Không cần sao chép policy vào từng agent. Các agent trong `.github/agents/`
nhận repository instruction dùng chung.

```text
.github/agents/
├── bug-fix-agent.agent.md
├── test-agent.agent.md
├── review-agent.agent.md
└── documentation-agent.agent.md
```

Mỗi agent chỉ nên chứa:

- Vai trò chuyên môn.
- Workflow riêng.
- Tool hoặc constraint riêng.
- Một dòng khai báo token-efficiency profile.

Ví dụ:

```markdown
# Role

**Token-efficiency profile:** safe

Review authentication and authorization changes.
```

Hai profile được hỗ trợ:

| Profile | Dùng khi | Cách trả lời |
| --- | --- | --- |
| `safe` | Security review, bug fix, migration và task có rủi ro | Câu ngắn nhưng đầy đủ, ưu tiên rõ ràng |
| `compact` | Task ít rủi ro như format, đổi tên hoặc cập nhật nhỏ | Có thể dùng fragments và danh sách dày hơn |

Nếu profile thiếu, sai hoặc xuất hiện nhiều lần, audit dùng `safe` và tạo
warning. `compact` cũng tự chuyển về `safe` khi có security vulnerability,
authentication, authorization, secret, destructive action, data loss,
migration, rollback, failed check, unresolved error hoặc thứ tự thao tác dễ
hiểu sai.

Rule về cách trả lời ngắn nên được giữ tập trung trong
`.github/copilot-instructions.md`.

## Chỉ muốn audit tự động

Không cần loại bỏ thành phần nào. Giữ tối thiểu:

```text
.github/copilot-instructions.md
.github/hooks/token-efficiency.json
.github/scripts/token-efficiency-audit.mjs
```

Có thể giữ skill mà không ảnh hưởng đến các prompt thông thường. Skill chỉ hoạt
động khi người dùng gọi `/token-efficiency-audit`.

## Policy giảm token

Policy hiện tại yêu cầu Copilot:

- Trả kết quả, quyết định hoặc hành động trước.
- Bỏ lời chào, filler, hedging và kết luận lặp.
- Dùng profile `safe` mặc định hoặc `compact` khi agent khai báo hợp lệ.
- Chỉ áp dụng profile cho hội thoại, progress update và completion report.
- Không kể lại routine tool call hoặc chép toàn bộ log.
- Chỉ báo cáo thay đổi, rủi ro và kết quả test thực tế.
- Giữ nguyên code, command, path, API, identifier và error.
- Không rút gọn source code, identifier, comment, test, documentation, config,
  schema, migration, commit message hoặc user-facing text nếu người dùng không
  yêu cầu.
- Không rút gọn cảnh báo bảo mật, mất dữ liệu, migration hoặc lỗi chưa xử lý.

Instruction làm input tăng nhẹ nhưng giảm trực tiếp output token. Phản hồi ngắn
hơn cũng làm context của các lượt tiếp theo nhỏ hơn. Project không công bố tỷ
lệ tiết kiệm cụ thể vì không thu thập hoặc benchmark token usage.

## Custom agent mẫu

`Bug Fix Agent` thực hiện workflow:

```markdown
**Token-efficiency profile:** safe
```

1. Đọc code, test, config và error liên quan.
2. Tái hiện bug hoặc xác định failing path.
3. Xác định root cause.
4. Thực hiện thay đổi tối thiểu.
5. Thêm regression test khi phù hợp.
6. Chạy các kiểm tra liên quan.

Prompt thử:

```text
API tạo user đang chấp nhận email chỉ chứa khoảng trắng. Hãy tìm nguyên nhân,
sửa lỗi, thêm regression test và chạy các kiểm tra liên quan.
```

## Kiểm tra repository này

Chạy từ repository root:

```bash
node --check .github/scripts/token-efficiency-audit.mjs
node --test tests/token-efficiency-audit.test.mjs
node -e "JSON.parse(require('fs').readFileSync('.github/hooks/token-efficiency.json', 'utf8'))"
node .github/scripts/token-efficiency-audit.mjs
```

## Mô hình bảo mật

Bộ kit không:

- Cài package hoặc plugin.
- Gọi network hoặc dịch vụ ngoài.
- Đọc transcript hay session history.
- Thu thập hoặc lưu telemetry.
- Nén tool output hoặc MCP description.
- Tự sửa custom agent hoặc instruction.

Instruction không phải access control. Project bảo mật vẫn cần kiểm soát tool,
MCP, network, secret, repository permission và approval policy ở cấp nền tảng.
