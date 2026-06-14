# Phân tích giải pháp giảm token cho GitHub Copilot Custom Agents

## 1. Bài toán thực tế

Project cần giải quyết vấn đề:

> Nhiều GitHub Copilot custom agent trong dự án bảo mật tạo phản hồi quá dài,
> làm tăng output token và làm context của các lượt sau lớn hơn.

Giải pháp phải đáp ứng các ràng buộc:

1. Chạy trong repository đang sử dụng GitHub Copilot.
2. Không cài package hoặc thư viện bên thứ ba.
3. Không dùng MCP proxy, plugin ngoài hoặc dịch vụ trung gian.
4. Không gửi thêm source code, transcript, log hoặc secret ra network.
5. Không lưu telemetry.
6. Không làm mất cảnh báo bảo mật, rủi ro mất dữ liệu hoặc lỗi chưa xử lý.
7. Áp dụng chung cho nhiều custom agent mà không lặp rule trong từng agent.
8. Dễ đọc, dễ audit và dễ được đội bảo mật phê duyệt.

Lưu ý: “local-only” ở đây mô tả **bộ policy và audit bổ sung**. GitHub Copilot
vẫn là dịch vụ AI của GitHub và có cơ chế xử lý dữ liệu riêng. Bộ kit này không
thể biến Copilot thành model chạy hoàn toàn local.

## 2. Hai hướng giải quyết

### Giải pháp của project này

Kiến trúc:

```text
.github/copilot-instructions.md
        |
        +--> trực tiếp yêu cầu mọi Copilot chat/custom agent trả lời ngắn

.github/hooks/token-efficiency.json
        |
        +--> tự động gọi audit khi bắt đầu session

.github/skills/token-efficiency-audit/SKILL.md
        |
        +--> cho phép người dùng chủ động chạy audit

.github/scripts/token-efficiency-audit.mjs
        |
        +--> kiểm tra policy và agent bằng Node.js standard library
```

Đây là mô hình **policy tập trung + kiểm tra local**.

### Giải pháp Caveman

[JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) là một hệ
sinh thái nén output cho nhiều AI coding agent.

Nó cung cấp:

- Skill thay đổi trực tiếp phong cách phản hồi.
- Nhiều mức nén như `lite`, `full` và `ultra`.
- Installer tự phát hiện nhiều AI agent.
- Rule file luôn bật cho các agent không hỗ trợ hook phù hợp.
- Hook, token statistics, memory compression và MCP middleware tùy nền tảng.
- Benchmark do chính project công bố.

Đây là mô hình **bộ công cụ nén output đa nền tảng**.

## 3. So sánh theo yêu cầu bắt buộc

| Tiêu chí | Project này | Caveman |
| --- | --- | --- |
| Tập trung vào GitHub Copilot | Có | Có hỗ trợ, nhưng không phải mục tiêu duy nhất |
| Không thư viện bên thứ ba | Có | Runtime chính có phần dùng Node.js standard library, nhưng luồng cài đặt có thể gọi `npx`, plugin và công cụ ngoài |
| Không network khi vận hành | Có | Skill có thể chạy local, nhưng cài đặt và cập nhật cần tải từ GitHub/npm |
| Không plugin | Có | Tùy nền tảng; một số đường cài dùng plugin/extension |
| Không MCP proxy | Có | MCP compression là tùy chọn nhưng thuộc hệ sinh thái |
| Không đọc transcript/session log | Có | Tính năng stats của Claude Code đọc session log |
| Không telemetry | Có | Không nên coi thống kê token cục bộ là telemetry từ xa, nhưng nó làm tăng phạm vi dữ liệu được đọc |
| Phạm vi file nhỏ | Chỉ các file policy và agent đã khai báo | Có thể ghi nhiều vị trí cấu hình theo từng AI agent |
| Dễ security review | Cao | Thấp hơn vì phạm vi và số thành phần lớn |
| Mức độ nén | Hai profile `safe` và `compact` | Mạnh và có nhiều mức |
| Phong cách chuyên nghiệp | Cao | `lite` phù hợp; `full/ultra` có thể quá rút gọn |
| Cảnh báo bảo mật | Policy yêu cầu giữ đầy đủ | Có Auto-Clarity cho cảnh báo và thao tác không thể hoàn tác |
| Đo token thực tế | Không thu thập; không công bố tỷ lệ | Có benchmark và stats trên một số nền tảng |
| Audit cấu hình repository | Có | Có verification/installer test, nhưng không cùng mô hình audit policy của project này |
| Độ phức tạp bảo trì | Thấp | Cao |

## 4. Đánh giá project này theo mục tiêu bảo mật

### Ưu điểm

#### Phạm vi tin cậy nhỏ

Toàn bộ phần thực thi chính là một script Node.js dùng standard library. Đội bảo
mật có thể đọc và review source mà không phải kiểm tra dependency tree.

#### Không thêm luồng dữ liệu

Script audit không:

- Gọi network.
- Đọc source code ứng dụng.
- Đọc transcript hoặc session history.
- Đọc secret.
- Chạy child process.
- Ghi telemetry.

Điều này phù hợp hơn với repository có yêu cầu bảo mật cao.

#### Policy tập trung

Rule giảm token nằm trong một file:

```text
.github/copilot-instructions.md
```

Mọi custom agent nhận cùng policy. Không cần sao chép rule vào từng file
`.agent.md`, nhờ đó:

- Giảm input token bị lặp.
- Tránh agent có các phiên bản rule khác nhau.
- Dễ cập nhật và review.

#### Giữ thông tin an toàn

Policy không chỉ yêu cầu “trả lời ngắn”. Nó bảo vệ các nội dung không được phép
rút gọn:

- Security impact.
- Destructive-action warning.
- Data-loss risk.
- Migration và rollback requirement.
- Compatibility concern.
- Failed check và unresolved error.

Đây là điểm quan trọng hơn việc đạt tỷ lệ nén cao nhất.

#### Hoạt động độc lập với audit

Nếu hook bị tắt hoặc script audit lỗi, `copilot-instructions.md` vẫn có thể được
Copilot nạp. Audit không nằm trên critical path của từng prompt.

### Nhược điểm

#### Không có số liệu định lượng

Project không thu thập token usage hoặc đọc session log, nên không công bố:

- Giảm bao nhiêu output token.
- Task nào giảm nhiều hoặc ít.

Đây là đánh đổi có chủ đích để giữ phạm vi dữ liệu nhỏ. Hiệu quả được đánh giá
định tính qua chất lượng phản hồi và việc giảm nội dung thừa.

#### Profile phụ thuộc vào khai báo của agent

Project hỗ trợ `safe` và `compact`, nhưng mỗi custom agent phải khai báo:

```markdown
**Token-efficiency profile:** safe
```

Nếu thiếu hoặc sai, audit fallback về `safe` và tạo warning. Cách này ưu tiên an
toàn nhưng yêu cầu đội dự án xử lý warning khi thêm agent mới.

#### Rule ID không xác minh toàn bộ ngữ nghĩa

Audit yêu cầu các rule ID bắt buộc xuất hiện đúng một lần. Cơ chế này phát hiện
rule bị xóa hoặc lặp, nhưng không thể chứng minh câu chữ nằm sau ID vẫn giữ đúng
toàn bộ ý nghĩa ban đầu.

Đây là đánh đổi để cho phép đội dự án chỉnh câu chữ mà không cần cập nhật
checksum.

#### Hook chỉ kiểm tra đầu session

Hook không đo hoặc cưỡng chế độ dài của từng phản hồi. Việc giảm token vẫn phụ
thuộc vào model tuân thủ repository instruction.

## 5. Đánh giá Caveman theo mục tiêu bảo mật

### Ưu điểm

#### Nén output mạnh hơn

Caveman có các mức `lite`, `full` và `ultra`, cho phép điều chỉnh giữa tính dễ
đọc và lượng token tiết kiệm.

#### Có kinh nghiệm thực nghiệm

Project công bố benchmark trung bình giảm khoảng 65% output token trên bộ prompt
của họ. Đây là dữ liệu tham khảo hữu ích, nhưng không phải bảo đảm cho GitHub
Copilot hoặc workload của project này.

#### Có Auto-Clarity

Caveman tạm dùng văn phong đầy đủ khi gặp:

- Cảnh báo bảo mật.
- Thao tác không thể hoàn tác.
- Chuỗi nhiều bước dễ hiểu sai.
- Người dùng yêu cầu làm rõ.

Nguyên tắc này phù hợp với dự án bảo mật và nên được học hỏi.

#### Hỗ trợ nhiều AI agent

Nếu tổ chức dùng đồng thời Claude Code, Codex, Cursor và Copilot, Caveman giảm
chi phí xây một giải pháp riêng cho từng công cụ.

### Nhược điểm

#### Phạm vi hệ thống quá rộng so với yêu cầu

Mục tiêu hiện tại chỉ cần GitHub Copilot custom agents. Caveman còn có:

- Installer đa agent.
- Plugin.
- Hook và status line theo nền tảng.
- Token stats.
- Memory compression.
- MCP middleware tùy chọn.

Các phần này làm tăng code cần review và bề mặt tấn công dù không phải tất cả
đều được bật mặc định.

#### Cài đặt cần network hoặc công cụ ngoài

Các cách cài phổ biến sử dụng GitHub, `curl`, `npx`, plugin marketplace hoặc
extension mechanism. Điều này không phù hợp với yêu cầu “không thư viện ngoài,
không network” nếu áp dụng nguyên bộ.

#### Có thể rút gọn quá mức

Các mức `full` hoặc `ultra` bỏ mạo từ, liên từ và dùng fragment. Trong dự án bảo
mật, cách viết này có thể làm mơ hồ:

- Thứ tự thao tác.
- Điều kiện trước và sau.
- Chủ thể chịu ảnh hưởng.
- Phạm vi của cảnh báo.
- Quan hệ nguyên nhân và kết quả.

#### Khó phê duyệt hơn

Đội bảo mật phải xem xét:

- Installer.
- Các vị trí file được ghi.
- Command được spawn.
- Nguồn tải từ xa.
- Hook theo từng nền tảng.
- Tính năng đọc session log.
- MCP proxy nếu được bật.

Chi phí review lớn hơn nhiều so với script local hiện tại.

## 6. Kết luận lựa chọn

Với ràng buộc:

```text
GitHub Copilot custom agents
+ repository bảo mật
+ local-only cho lớp bổ sung
+ không package/thư viện ngoài
+ không MCP/plugin/network/telemetry
```

**Project hiện tại phù hợp hơn Caveman.**

Không nên tích hợp toàn bộ Caveman vì sẽ làm mất lợi thế:

- Phạm vi nhỏ.
- Dễ audit.
- Không dependency.
- Không thêm luồng dữ liệu.
- Dễ được security review.

Caveman nên được dùng như nguồn tham khảo thiết kế, không phải dependency.

## 7. Những ý tưởng nên học từ Caveman

### Hai mức policy được chọn

Project dùng hai profile:

- `safe`: mặc định, câu đầy đủ và ưu tiên rõ ràng.
- `compact`: dùng cho task ít rủi ro, phản hồi ngắn hơn.

Không nên dùng mức tương đương `ultra` trong dự án bảo mật.

### Auto-Clarity

Policy yêu cầu `compact` tự động quay về `safe` khi:

- Có security vulnerability.
- Có thao tác destructive.
- Có thay đổi authorization/authentication.
- Có migration hoặc rollback.
- Có nhiều bước phụ thuộc thứ tự.
- Người dùng thể hiện chưa hiểu kết quả trước.

### Audit rule ID và agent profile

Script kiểm tra:

- Rule ID bắt buộc trong managed block.
- Rule bảo vệ source artifact không bị profile nén làm thay đổi.
- Profile `safe` hoặc `compact` của từng agent.
- Mọi file `.md` trong `.github/agents`.
- Giới hạn quét agent và policy bị sao chép.

## 8. Kiến trúc đề xuất

```text
                        PROMPT PATH

User prompt
    +
Custom agent chuyên môn
    +
Repository token/security policy
    |
    v
GitHub Copilot xử lý task
    |
    v
Phản hồi ngắn nhưng giữ cảnh báo bắt buộc


                        CONTROL PATH

SessionStart
    |
    v
Local Node.js audit
    |
    +-- kiểm tra policy tồn tại
    +-- kiểm tra marker và rule ID bắt buộc
    +-- kiểm tra agent profile và policy bị lặp
    +-- không đọc source, secret hoặc transcript
    |
    v
Cảnh báo nếu cấu hình sai, không block session
```

Nguyên tắc:

1. Policy chịu trách nhiệm giảm token.
2. Custom agent chỉ chứa workflow chuyên môn.
3. Hook chỉ kích hoạt kiểm tra xác định.
4. Script audit chỉ đọc phạm vi tối thiểu.
5. Không thêm dependency để thực hiện việc standard library đã làm được.
6. Không hy sinh độ rõ ràng để đạt tỷ lệ nén cao hơn.

## 9. Quyết định đề xuất

Tiếp tục phát triển project hiện tại theo hướng:

1. Giữ local-only và zero dependency.
2. Không tích hợp Caveman như package, plugin hay installer.
3. Dùng Auto-Clarity và hai profile `safe`/`compact`.
4. Dùng rule ID để bảo vệ cấu trúc policy bắt buộc.
5. Không xây benchmark hoặc công bố tỷ lệ tiết kiệm token.
6. Ưu tiên `safe concise` thay vì `maximum compression`.

Mục tiêu cuối cùng không phải tạo câu ngắn nhất. Mục tiêu là:

> Giảm token dư thừa mà vẫn giữ nguyên thông tin cần thiết để xử lý công việc
> bảo mật chính xác và an toàn.

## Nguồn tham khảo

- [Caveman repository](https://github.com/JuliusBrussee/caveman)
- [Caveman main skill](https://github.com/JuliusBrussee/caveman/blob/main/skills/caveman/SKILL.md)
- [Caveman installation guide](https://github.com/JuliusBrussee/caveman/blob/main/INSTALL.md)
- [Project policy](.github/copilot-instructions.md)
- [Project audit skill](.github/skills/token-efficiency-audit/SKILL.md)
- [Project audit script](.github/scripts/token-efficiency-audit.mjs)
