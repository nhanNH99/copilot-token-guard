## 1. Hook là gì?

Hook là cơ chế cho phép VS Code **chạy một command tại một thời điểm xác định trong vòng đời agent**.

Khác với instruction chỉ hướng dẫn AI, hook là automation bằng code:

```text
Sự kiện xảy ra
      ↓
VS Code phát hiện hook
      ↓
Chạy command đã cấu hình
      ↓
Đọc JSON từ stdout
      ↓
Tiếp tục, cảnh báo hoặc chặn agent
```

Một số sự kiện phổ biến:

- `SessionStart`: bắt đầu session mới.
- `UserPromptSubmit`: mỗi khi người dùng gửi prompt.
- `PreToolUse`: trước khi agent gọi tool.
- `PostToolUse`: sau khi tool chạy thành công.
- `Stop`: khi agent chuẩn bị kết thúc.

## 2. Hook của project này

File [token-efficiency.json](/Users/hongphuc/Desktop/copilot-token/.github/hooks/token-efficiency.json:1):

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

Ý nghĩa:

- `SessionStart`: chạy khi người dùng gửi prompt đầu tiên của session mới.
- `type: "command"`: chạy shell command.
- `command`: gọi script audit trong chế độ hook.
- `cwd: "."`: chạy từ repository root.
- `timeout: 5`: dừng nếu quá 5 giây.

Lưu ý: `SessionStart` không có nghĩa là chạy mỗi khi mở VS Code hoặc mỗi prompt. Nó chạy khi một agent session mới bắt đầu.

## 3. Hook giao tiếp với script

Hook có thể truyền JSON qua `stdin` và nhận JSON qua `stdout`.

Script hiện không cần đọc input của hook. Nó chỉ kiểm tra repository rồi trả:

```json
{"continue":true}
```

Nếu policy lỗi:

```json
{
  "continue": true,
  "systemMessage": "Token-efficiency policy check failed (...)"
}
```

Phần này nằm trong [formatHookResult()](/Users/hongphuc/Desktop/copilot-token/.github/scripts/token-efficiency-audit.mjs:441).

`continue: true` nghĩa là:

- Không chặn session.
- Chỉ cảnh báo khi policy lỗi.
- Người dùng vẫn tiếp tục sử dụng Copilot.

## 4. Skill là gì?

Skill là một **gói hướng dẫn chuyên biệt cho agent**, thường gồm:

```text
skill-name/
├── SKILL.md
├── scripts/       tùy chọn
├── references/    tùy chọn
└── assets/        tùy chọn
```

Skill không tự động thực thi như hook. Khi skill được gọi:

```text
Copilot đọc SKILL.md
      ↓
Nạp hướng dẫn vào context
      ↓
Agent làm theo workflow
      ↓
Agent gọi tool hoặc command cần thiết
      ↓
Trả kết quả
```

Nói ngắn gọn:

- **Hook chạy command trực tiếp.**
- **Skill hướng dẫn agent cách thực hiện task.**

## 5. Skill của project này

File [SKILL.md](/Users/hongphuc/Desktop/copilot-token/.github/skills/token-efficiency-audit/SKILL.md:1) có frontmatter:

```yaml
name: token-efficiency-audit
description: Audit shared GitHub Copilot token-efficiency policy...
argument-hint: "[optional repository path]"
disable-model-invocation: true
```

Ý nghĩa:

- `name`: tên slash command `/token-efficiency-audit`.
- `description`: mô tả để VS Code hiển thị và hiểu mục đích.
- `argument-hint`: gợi ý có thể truyền đường dẫn repository.
- `disable-model-invocation: true`: model không được tự chọn skill này; người dùng phải gọi thủ công.

Ví dụ:

```text
/token-efficiency-audit
```

Hoặc:

```text
/token-efficiency-audit /path/to/repository
```

## 6. Nguyên lý chạy của skill

Khi người dùng gọi skill:

```text
Người dùng nhập /token-efficiency-audit
              ↓
VS Code tìm SKILL.md theo tên
              ↓
Nạp nội dung SKILL.md vào context của agent
              ↓
Agent đọc yêu cầu:
  node .github/scripts/token-efficiency-audit.mjs
              ↓
Agent dùng terminal tool để chạy command
              ↓
Script trả kết quả
              ↓
Agent chỉ báo cáo status, agent count và findings
```

Điểm quan trọng: chính `SKILL.md` không chạy Node.js. Nó yêu cầu agent chạy Node.js. Việc gọi terminal vẫn chịu cơ chế permission và approval của VS Code.

## 7. Quan hệ giữa các thành phần

```text
                   TỰ ĐỘNG
SessionStart event
        ↓
Hook JSON
        ↓
Script audit --hook
        ↓
JSON cảnh báo
```

```text
                   THỦ CÔNG
/token-efficiency-audit
        ↓
SKILL.md được nạp
        ↓
Agent làm theo hướng dẫn
        ↓
Script audit
        ↓
Agent tóm tắt kết quả
```

Cả hook và skill đều dùng chung một script:

```text
Hook --------+
             +----> token-efficiency-audit.mjs
Skill -------+
```

## 8. Policy nằm ở đâu?

Policy giảm token nằm trong:

```text
.github/copilot-instructions.md
```

Nó độc lập với hook và skill:

```text
copilot-instructions.md → trực tiếp hướng dẫn model trả lời ngắn
hook                   → tự động kiểm tra policy
skill                  → cách thủ công để yêu cầu kiểm tra
script                 → logic kiểm tra thực tế
```

Vì vậy, hook hoặc skill bị lỗi không đồng nghĩa policy ngừng hoạt động. Copilot vẫn có thể nạp `copilot-instructions.md`; chỉ có việc audit không được thực hiện.

## 9. Khác biệt cốt lõi

| Thành phần | Bản chất | Tự động | Thực thi code |
|---|---|---:|---:|
| Instructions | Rule luôn áp dụng cho model | Có | Không |
| Skill | Workflow hướng dẫn agent | Không trong cấu hình này | Gián tiếp qua agent |
| Hook | Automation theo sự kiện | Có | Có |
| Script | Logic kiểm tra Node.js | Khi được gọi | Có |

Hook hiện là tính năng Preview và có thể bị organization policy tắt.

Nguồn: [VS Code Hooks](https://code.visualstudio.com/docs/agent-customization/hooks), [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).