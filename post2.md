[AI Sharing] Agent Skill là gì? Làm sao để custom agent có “kỹ năng” như một DEV/Tester/BA thực thụ?

Ở bài trước, mình đã chia sẻ cách biến một ý tưởng thành custom agent bằng Plan Mode.

Flow chính là:

Idea
→ Input/Output/Success Criteria
→ Plan Mode
→ Review plan
→ Implement nhỏ
→ Golden Examples
→ Detect Agent Bugs
→ Fix Plan
→ Retest

Nhưng sau khi tạo được agent, mình gặp một câu hỏi khác:

Làm sao để agent không chỉ “có role”, mà còn có kỹ năng xử lý giống một DEV/Tester/BA thực thụ?

Ví dụ:

Mình có một agent chuyên viết testcase.

Ban đầu agent vẫn viết được testcase, nhưng thường gặp các lỗi như:

* Thiếu boundary case.
* Thiếu permission case.
* Tự suy diễn nghiệp vụ.
* Viết quá dài.
* Lặp lại toàn bộ requirement.

Sau một thời gian sửa prompt liên tục, mình nhận ra vấn đề không nằm ở role của agent.

Vấn đề là agent chưa được dạy cách làm việc.

Đó chính là lúc Agent Skill xuất hiện.

Thông điệp ngắn gọn:

Custom Agent = Agent là ai.
Agent Skill = Agent biết làm gì và làm như thế nào.

---

## Agent Skill là gì?

Theo cách hiểu đơn giản:

Agent Skill là một bộ hướng dẫn đóng gói sẵn để AI xử lý một loại công việc cụ thể.

Bên trong skill thường có:

* Workflow xử lý.
* Checklist cần kiểm tra.
* Rule được làm và không được làm.
* Format output.
* Ví dụ mẫu.

Có thể hiểu nó giống như:

"Sổ tay hướng dẫn công việc" dành cho AI.

Thay vì mỗi lần chat đều phải paste lại:

* Hãy kiểm tra boundary case.
* Đừng tự suy diễn.
* Hãy output theo format này.
* Hãy đặt câu hỏi nếu thiếu thông tin.

Thì mình đóng gói tất cả thành một skill để agent tái sử dụng.

---

## Custom Agent khác Agent Skill như thế nào?

Mình hay dùng ví dụ này:

Custom Agent = Nhân viên
Agent Skill = Kỹ năng của nhân viên đó

Ví dụ:

Custom Agent:

* Testcase Agent

Skill:

* testcase-design
* bug-analysis
* requirement-review

Agent vẫn là cùng một người.

Nhưng khi được trang bị thêm skill, chất lượng công việc sẽ khác hoàn toàn.

Điểm quan trọng:

* Một agent có thể dùng nhiều skill.
* Một skill có thể dùng cho nhiều agent.

---

## Khi nào nên tạo Agent Skill?

Không phải việc gì cũng cần tạo skill.

Mình chỉ tạo skill khi:

* Công việc lặp lại nhiều lần.
* Có workflow tương đối ổn định.
* Có checklist rõ ràng.
* Có output mong muốn.
* AI thường mắc cùng một lỗi.

Ví dụ:

✅ Nên tạo skill

* Viết testcase.
* Review requirement.
* Phân tích bug.
* Review PR.
* Phân tích log.
* Lập kế hoạch implement.

❌ Chưa nên tạo skill

* Một câu hỏi chỉ dùng một lần.
* Quy trình còn thay đổi liên tục.
* Task chưa rõ input/output.

Nguyên tắc đơn giản:

Nếu bạn phải copy cùng một hướng dẫn nhiều lần thì có thể đã đến lúc tạo skill.

---

## Cấu trúc cơ bản của một Agent Skill

Một skill thường nằm trong một folder riêng.

Ví dụ:

.github/skills/testcase-design/SKILL.md

Trong đó `SKILL.md` là file chính mô tả skill.

Ví dụ đơn giản:

```md
---
name: testcase-design
description: Use this skill when creating or reviewing test cases from requirements.
---

# Mission

Help the agent create concise and reviewable test cases.

# Workflow

1. Read requirement.
2. Extract fields and business rules.
3. Detect missing information.
4. Create test scenarios.
5. Cover positive, negative and boundary cases.
6. Output in review-friendly format.

# Rules

- Do not invent business rules.
- Do not repeat the full requirement.
- Keep output concise.

# Output

1. Testcases
2. Missing questions
3. Risks
```

Thực tế, phiên bản đầu tiên chỉ cần 5 phần:

* Khi nào dùng skill.
* Input là gì.
* Workflow xử lý.
* Rules.
* Output format.

Là đã đủ để bắt đầu.

---

## Flow mình dùng để tạo Agent Skill

Thay vì ngồi nghĩ lý thuyết, mình thường đi từ pain point thực tế.

Flow:

Pain Point
→ Repeated Task
→ Skill Mission
→ Workflow
→ Rules
→ Output Format
→ Golden Examples
→ Test
→ Fix
→ Retest

Ví dụ:

Pain point:

Agent viết testcase quá chung chung.

Skill:

testcase-design

Rules:

* Không tự suy diễn nghiệp vụ.
* Không gộp nhiều trạng thái vào một testcase.
* Luôn có câu hỏi nếu requirement chưa rõ.
* Không lặp lại requirement.

Sau đó lấy requirement thật trong dự án để test.

Nếu kết quả tốt hơn thì giữ lại.

Nếu chưa tốt thì tiếp tục chỉnh skill.

---

## Prompt mẫu để tạo Agent Skill bằng Plan Mode

```text
Tôi muốn tạo Agent Skill cho custom agent của tôi.

Context:
[Agent hiện tại dùng để làm gì]

Skill muốn tạo:
[Tên skill]

Repeated task:
[Việc lặp lại]

Input:
[Input]

Output:
[Output mong muốn]

Pain points:
[Những lỗi AI thường gặp]

Success Criteria:
[Tiêu chí đánh giá]

Hãy dùng Plan Mode để tạo kế hoạch xây dựng Agent Skill.

Bao gồm:
1. Mission
2. Trigger
3. Input
4. Workflow
5. Rules
6. Must not do
7. Output format
8. Golden examples
9. Test plan
```

Sau khi có plan, mình review lại giống như review requirement trước khi implement.

---

## Cách kiểm tra một Skill có thực sự tốt hay không

Đừng tạo skill xong rồi tin ngay.

Hãy test bằng các ví dụ thật.

Checklist mình thường dùng:

* Agent có làm đúng workflow không?
* Output có đúng format không?
* Có giảm lỗi cũ không?
* Có tự suy diễn không?
* Có lặp lại context không?
* Có quá dài không?
* Human review có nhanh hơn không?

Nếu output dài hơn nhưng không tốt hơn thì skill đó chưa đạt.

---

## Những lỗi phổ biến khi viết Skill

### 1. Skill quá lớn

Một skill cố làm mọi thứ:

* Review requirement
* Viết testcase
* Phân tích bug
* Review code

Kết quả thường không tốt.

Skill nên nhỏ và tập trung.

---

### 2. Rule không đủ rõ

Ví dụ:

```text
Write concise test cases.
```

Agent sẽ hiểu mỗi lần một kiểu.

Tốt hơn:

```text
Do not repeat the requirement.
Maximum 1-2 lines per testcase.
```

---

### 3. Không có "Must Not Do"

Đây là phần mình thấy quan trọng nhất.

Ví dụ:

```text
Must not:
- Invent business rules.
- Repeat the full requirement.
- Output unnecessary explanations.
```

Nhiều lỗi của agent thực ra chỉ cần thêm vài dòng "không được làm gì".

---

### 4. Không có Golden Examples

Nếu không có ví dụ thật để test thì rất khó biết skill có tốt hơn hay không.

Mình thường chuẩn bị:

* 1 case chuẩn.
* 1 case thiếu thông tin.
* 1 case dễ suy diễn sai.
* 1 case output dễ bị quá dài.

---

## Mini Challenge

Nếu bạn đã có custom agent, hãy thử tạo skill đầu tiên bằng cách điền 5 dòng:

```text
Agent hiện tại:
Skill muốn tạo:
Task lặp lại:
Pain Point:
Success Criteria:
```

Ví dụ:

```text
Agent hiện tại:
Testcase Agent

Skill muốn tạo:
testcase-design

Task lặp lại:
Viết testcase từ requirement

Pain Point:
Thiếu boundary case và hay lặp lại requirement

Success Criteria:
- Có positive/negative/boundary case
- Không tự suy diễn
- Có câu hỏi nếu requirement chưa rõ
- Output ngắn gọn
```

Sau đó đưa cho Plan Mode và nhờ nó tạo kế hoạch xây dựng skill.

---

## Kết luận

Sau khi dùng custom agent một thời gian, mình nhận ra:

Role chỉ giúp AI biết nó là ai.

Skill mới là thứ giúp AI làm việc tốt hơn.

Flow mình đang dùng:

Identify repeated task
→ Define skill mission
→ Write workflow
→ Add rules
→ Add output format
→ Add golden examples
→ Test
→ Detect bugs
→ Improve

Thông điệp chính:

Đừng chỉ tạo agent rồi kỳ vọng agent tự giỏi.

Hãy đóng gói kinh nghiệm, checklist và quy trình làm việc của bạn thành Agent Skill.

Đó là cách nhanh nhất để biến AI từ một chatbot thành một trợ lý thực sự hữu ích.
