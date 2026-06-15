# Áp dụng Jest Hooks vào Agent hiện tại

Hướng dẫn này dùng cho **một custom agent đã tồn tại** trong repository công
ty. Project được giả định đã có Jest, React Testing Library, ESLint, Prettier
và test utilities.

Flow runtime và mục đích từng hàm:
[jest-agent-runtime-flow.md](jest-agent-runtime-flow.md).

Không thay agent công ty bằng
`.github/agents/jest-test-agent.agent.md`. File đó chỉ là ví dụ tham khảo.

## Flow sau khi tích hợp

```text
Người dùng chỉ định component
          |
          v
Agent hiện tại tạo plan, không edit
          |
          | người dùng trả lời "oke"
          v
Agent ghi request rồi tạo test
          |
          +-- PostToolUse: format + lint
          +-- Stop: Jest + coverage
          |
          v
Pass hoặc đề xuất sửa và chờ "oke"
```

## Bước 1: Copy automation

Copy ba file bắt buộc vào repository công ty:

```text
.github/scripts/jest-agent-hook.mjs
.github/scripts/jest-agent-runner.mjs
.github/jest-agent.config.json
```

Skill này là tùy chọn:

```text
.github/skills/react-jest-test-authoring/SKILL.md
```

Không cần copy:

```text
.github/agents/jest-test-agent.agent.md
package.json
README.md
tests/
```

## Bước 2: Merge hooks vào agent

Mở file agent thực tế, ví dụ:

```text
.github/agents/company-jest-agent.agent.md
```

Giữ nguyên `name`, `description`, `tools`, model và instruction hiện tại. Chỉ
thêm `hooks` vào YAML frontmatter:

```yaml
hooks:
  PostToolUse:
    - type: command
      command: node .github/scripts/jest-agent-hook.mjs post-tool-use
      cwd: .
      timeout: 45
  Stop:
    - type: command
      command: node .github/scripts/jest-agent-hook.mjs stop
      cwd: .
      timeout: 210
```

Ví dụ file agent sau khi merge:

```markdown
---
name: Company Jest Agent
description: Generate Jest tests for React components.
tools: ['search/codebase', 'search/usages', 'edit']
hooks:
  PostToolUse:
    - type: command
      command: node .github/scripts/jest-agent-hook.mjs post-tool-use
      cwd: .
      timeout: 45
  Stop:
    - type: command
      command: node .github/scripts/jest-agent-hook.mjs stop
      cwd: .
      timeout: 210
---

# Instruction hiện tại của công ty
...
```

Nếu agent đã có hooks, thêm command vào event tương ứng; không xóa hook cũ.

## Bước 3: Merge workflow vào instruction

Thêm block sau vào body của agent hiện tại:

```markdown
## Approval and verification flow

1. Khi người dùng chỉ định component, chỉ đọc component, test liên quan và code
   trực tiếp cần thiết.
2. Tạo plan ngắn gồm test file, behavior/branch cases và mocks/fixtures.
3. Không edit file. Yêu cầu người dùng trả lời `oke` để duyệt plan.
4. Chỉ sau khi người dùng trả lời `oke`:
   - Ghi `.github/.cache/jest-agent/request.json`.
   - Tạo hoặc sửa đúng các test/mock/fixture đã khai báo trong request.
5. Không tự chạy terminal command. Hooks sẽ format, lint, chạy Jest và coverage.
6. Nếu verification fail, tóm tắt lỗi và đề xuất sửa. Chờ người dùng trả lời
   `oke` trước khi edit vòng tiếp theo.
7. Không kiểm tra lại package, Jest config, ESLint config hoặc testing libraries
   nếu chưa có lỗi verification thực tế.
```

Thêm tiếp request contract:

```markdown
## Verification request

Only after the user approves the plan, write:

`.github/.cache/jest-agent/request.json`

The request must use schema version 1 and contain:

- `targets`: source components requiring coverage.
- `tests`: approved Jest test files.
- `artifacts`: approved mocks, fixtures or test utilities.

Do not include commands or paths outside the repository.
```

Cho agent một ví dụ JSON ngay dưới instruction trên:

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

`request.json` không phải permission gate. Nó chỉ cung cấp target, test và
artifact cho runner khi `Stop` chạy verification.

## Bước 4: Bật hooks

Merge vào `.vscode/settings.json`:

```json
{
  "chat.useCustomAgentHooks": true
}
```

Nếu organization policy tắt hooks, instruction vẫn hoạt động nhưng format,
lint và coverage sẽ không tự chạy.

## Bước 5: Ignore cache

Merge vào `.gitignore`:

```gitignore
.github/.cache/jest-agent/
```

Không commit `request.json`, report hoặc coverage artifacts.

## Bước 6: Fallback command

Tùy chọn merge vào `package.json` hiện có:

```json
{
  "scripts": {
    "test:agent:verify": "node .github/scripts/jest-agent-runner.mjs verify"
  }
}
```

Command này dành cho developer kiểm tra thủ công khi hooks bị tắt. Agent không
cần terminal tool.

## Bước 7: Điều chỉnh config một lần

Config mặc định:

```json
{
  "allowedEditPatterns": [
    "(^|/)(tests?|__tests__|__mocks__|test-utils|fixtures)/",
    "\\.(test|spec)\\.[cm]?[jt]sx?$"
  ],
  "jestArgs": [
    "--runInBand"
  ]
}
```

Chỉ cần kiểm tra hai điểm:

1. Test, mock và fixture của công ty có match `allowedEditPatterns`.
2. Các flag cố định từ command coverage hiện tại đã có trong `jestArgs`.

Ví dụ command hiện tại:

```bash
jest --runInBand --detectOpenHandles
```

Config tương ứng:

```json
{
  "jestArgs": [
    "--runInBand",
    "--detectOpenHandles"
  ]
}
```

Runner dùng Jest, ESLint và Prettier đã cài trong `node_modules`; không cài hoặc
kiểm tra lại dependency trong mỗi task.

## Bước 8: Smoke test

Trong VS Code:

1. Chọn agent công ty hiện tại.
2. Nhập component cần coverage.
3. Xác nhận agent chỉ trả plan và chưa edit file.
4. Trả lời `oke`.
5. Mở output channel `GitHub Copilot Chat Hooks`.
6. Xác nhận test được format/lint.
7. Xác nhận report được tạo:

```text
.github/.cache/jest-agent/report.json
```

Kết quả mong đợi:

- Plan phase chưa có request nên runner trả `skipped`.
- Sau `oke`, agent ghi request rồi mới edit test.
- Verification pass sẽ xóa request để component tiếp theo bắt đầu lại từ plan.
- Verification fail sẽ gửi summary cho agent và chờ `oke` trước vòng sửa.
- `PostToolUse` pass và `Stop` pass chỉ trả `continue`, không inject success
  message vào model context.

## Coverage policy

- File source mới: statements, branches, functions và lines đạt 100%.
- File đang sửa: executable lines và branch arms trong Git diff phải được
  cover.
- Component legacy không có Git diff: plan thêm `requiredLines` và
  `requiredBranchLines` vào target.

Ví dụ legacy target:

```json
{
  "path": "src/components/LegacyMenu.tsx",
  "requiredLines": [24, 37],
  "requiredBranchLines": [37]
}
```

`diffBase` mặc định là `HEAD`. Nếu team đo toàn bộ branch:

```json
{
  "diffBase": "origin/main...HEAD"
}
```

## Khi không hoạt động

- Agent edit trước `oke`: tăng độ ưu tiên hoặc đưa approval flow lên đầu body.
- Hook không chạy: kiểm tra `chat.useCustomAgentHooks` và organization policy.
- File không được format/lint: kiểm tra path có match `allowedEditPatterns`.
- Jest cần flag riêng: thêm flag cố định vào `jestArgs`.
- Xem full report tại `.github/.cache/jest-agent/report.json`.

Tài liệu VS Code:

- [Agent Hooks](https://code.visualstudio.com/docs/agent-customization/hooks)
- [Custom Agents](https://code.visualstudio.com/docs/agent-customization/custom-agents)
