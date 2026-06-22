[AI Sharing] Custom Agent là gì? Cách mình biến một ý tưởng thành Custom Agent bằng Plan Mode

Hiện tại dự án mình đang hướng tới việc sử dụng AI Agent trong nhiều bước của quy trình phát triển như invest, BD/DD, coding, testing và review.



Tuy nhiên, có một vấn đề khá thực tế:

Không phải Dev/Tester/BA nào cũng biết cách tạo custom agent hoặc tuning agent ngay từ đầu.

Vì vậy, hôm nay mình chia sẻ một flow cá nhân mình hay dùng để biến một ý tưởng ban đầu thành custom agent có thể dùng được.



Thông điệp chính:

Muốn tạo custom agent, đừng bắt đầu bằng kỹ thuật.

Hãy bắt đầu bằng input, output và tiêu chí đánh giá agent có đạt hay chưa.



1. Custom Agent là gì?

Theo cách hiểu đơn giản:

Custom Agent là một AI assistant được thiết kế riêng cho một mục đích cụ thể, có role rõ ràng, input rõ ràng, output rõ ràng và rule xử lý phù hợp với workflow của team.

Khác với chat AI thông thường, custom agent không chỉ trả lời từng câu hỏi rời rạc, mà được thiết kế để xử lý một nhóm việc lặp lại theo cách ổn định hơn.



2. Vấn đề khi bắt đầu tạo custom agent

Nhiều khi mình có ý tưởng:

Mình muốn có agent hỗ trợ viết testcase.
Mình muốn có agent phân tích bug.
Mình muốn có agent review PR.
Mình muốn có agent summarize BD/DD.
Nhưng khi bắt tay vào tạo thì lại bị kẹt:

- Không biết viết instruction ra sao
- Không biết workflow nên đi như thế nào
- Không biết rule nào cần đưa vào
- Không biết output format nên thiết kế ra sao
- Không biết khi nào thì xem là agent đã đạt
Vì vậy, thay vì tự nghĩ hết từ đầu, mình thường dùng Plan Mode của GitHub Copilot để AI hỗ trợ lên plan tạo agent trước.



3. Flow mình hay dùng

Idea
→ Define Input/Output/Success Criteria
→ Ask Copilot Plan Mode to create Agent Plan
→ Review & adjust plan
→ Implement small version
→ Test with Golden Examples
→ Detect Agent Bugs
→ Ask Plan Mode to create Fix Plan
→ Apply fix & retest
→ Iterate until usable
4. Step 1: Define Input, Output và Success Criteria

Ở bước đầu, mình chưa cần biết implement agent như thế nào.

Mình chỉ cần làm rõ:

Idea:
Agent này dùng để làm gì?

Role:
Ai sẽ sử dụng agent? Dev, Tester, BA hay Reviewer?

Input:
User sẽ đưa gì cho agent?

Output:
Agent cần trả ra kết quả gì?

Success Criteria:
Dựa vào đâu để biết agent đã đạt?
Ví dụ:

Idea:
Tạo QA Testcase Agent.

Role:
Tester.

Input:
Requirement, acceptance criteria, screenshot nếu có.

Output:
Testcase theo format chuẩn của team.

Success Criteria:
- Testcase tách theo từng field/trạng thái.
- Có positive/negative/boundary/permission case.
- Có case reset dữ liệu khi qua ngày mới nếu liên quan.
- Không tự suy diễn business rule.
- Nếu requirement thiếu, phải list câu hỏi cần confirm.
- Output đủ ngắn để reviewer có thể review nhanh.
Điểm quan trọng là:

Nếu không có Success Criteria, mình rất khó biết agent đã “đủ tốt” hay chưa.



5. Step 2: Dùng Plan Mode để tạo Agent Plan

Sau khi có idea, input, output và success criteria, mình dùng Plan Mode để yêu cầu AI tạo plan.

Prompt mẫu:

Tôi muốn tạo một custom agent với thông tin sau:

Idea:
[Agent dùng để làm gì]

User role:
[Dev/Tester/BA/Reviewer]

Input:
[Input agent sẽ nhận]

Output:
[Output mong muốn]

Success Criteria:
[Tiêu chí đánh giá agent đạt]

Hãy dùng Plan Mode để tạo plan xây dựng custom agent này.

Plan cần bao gồm:
1. Mission của agent
2. Input cần có
3. Output format đề xuất
4. Workflow xử lý
5. Rules/constraints agent cần tuân thủ
6. Things agent must not do
7. Golden examples cần chuẩn bị
8. Cách test để validate agent
9. Gợi ý giảm token nếu có
Ở bước này, mình chưa implement ngay.

Mục tiêu chỉ là biến ý tưởng ban đầu thành một bản thiết kế rõ hơn.



6. Step 3: Review plan như review requirement

Sau khi AI tạo plan, mình sẽ review lại trước khi implement.

Checklist mình hay dùng:

- Plan có đúng mục tiêu không?
- Output có đúng thứ user cần không?
- Có rule nào quá chung chung không?
- Có thiếu rule quan trọng không?
- Có phần nào AI tự suy diễn không?
- Có phần nào làm output quá dài không?
- Có lặp lại context không cần thiết không?
- Có cách nào giảm token không?
Thông điệp ở bước này là:

Đừng implement agent từ plan đầu tiên của AI.

Hãy review plan như review một bản design draft.



7. Step 4: Implement bản nhỏ trước

Sau khi plan ổn, mình mới implement custom agent.

Nhưng mình không cố làm bản quá hoàn chỉnh ngay từ đầu.

Mình thường bắt đầu với version nhỏ:

Version 0.1:
- Cover use case chính trước
- Chỉ dùng context cần thiết
- Output ngắn
- Có rule không lặp lại context
- Có success criteria rõ
Làm nhỏ trước giúp dễ test, dễ detect bug và dễ chỉnh hơn.



8. Step 5: Test bằng data thực tế ở những anken đã làm trước đó

Sau khi implement, mình chạy thử agent bằng bằng data thự tế ở những anken đã làm trước đó. Dựa vào data ở những anken trước đó giúp mình dễ detect bug và dễ chỉnh hơn



9. Step 6: Detect Agent Bugs

Khi run thử, mình không chỉ xem agent có trả output hay không. Mình sẽ ghi lại bug của agent.

Có thể chia bug thành 4 nhóm:

1. Output Bug
Agent trả sai format, thiếu case, sai logic.

2. Reasoning Bug
Agent tự suy diễn, hiểu sai requirement, bỏ qua assumption.

3. Token Bug
Agent lặp lại context, giải thích quá dài, output quá verbose.

4. Workflow Bug
Agent làm sai thứ tự, nhảy sang implement khi chưa phân tích, bỏ qua checkpoint.
Ví dụ:

Bug:
Agent lặp lại toàn bộ requirement trước khi trả testcase.

Bug type:
Token Bug.

Expected:
Không repeat context. Chỉ trả output cần dùng, missing questions và risk.
10. Step 7: Dùng Plan Mode để tạo Fix Plan

Sau khi có bug list, mình lại dùng Plan Mode để nhờ AI tạo plan fix agent.

Prompt mẫu:

Dưới đây là bug list sau khi test custom agent:

1. Agent gộp nhiều trạng thái vào một testcase.
2. Agent thiếu case reset dữ liệu khi qua ngày mới.
3. Agent lặp lại requirement quá dài trước khi trả output.
4. Agent tự suy diễn rule BHYT khi requirement chưa rõ.
5. Output quá dài và khó review.

Hãy tạo fix plan cho agent.

Với mỗi bug, hãy trả:
1. Root cause có thể
2. Instruction/rule cần chỉnh
3. Output format cần update không
4. Golden example nào cần thêm
5. Cách retest
6. Acceptance criteria sau khi fix
7. Có cách nào giảm token không
Điểm mình thấy hiệu quả là:

AI không chỉ giúp tạo agent.

AI còn giúp phân tích bug của agent và đề xuất cách fix agent.



11. Step 8: Apply fix, retest và lặp lại

Sau khi có fix plan, mình review lại rồi mới apply.

Sau đó chạy lại Golden Examples.

Flow lặp lại:

Review fix plan
→ Apply fix
→ Retest
→ Detect new bugs
→ Update plan
→ Retest tiếp
Mình sẽ dừng khi agent đạt mức usable:

- Agent ouput khối lượng được mục tiêu mình đề ra
- Output đúng format.
- Không còn bug nghiêm trọng.
- Human chỉ cần chỉnh nhẹ.
- Agent không tự suy diễn business rule.
- Agent không lặp lại context không cần thiết.
- Output đủ ngắn để review nhanh.
12. Mini challenge cho team

Nếu mọi người chưa biết cách tạo custom agent, hãy thử bắt đầu rất nhỏ.

Chọn một việc mình làm lặp lại trong tuần này và điền 5 dòng:

Tôi muốn tạo agent hỗ trợ:
Role sử dụng:
Input:
Output mong muốn:
Success Criteria:
Ví dụ:

Tôi muốn tạo agent hỗ trợ:
Review testcase.

Role sử dụng:
Tester/QA Lead.

Input:
Requirement + testcase draft.

Output mong muốn:
Danh sách testcase thiếu, testcase trùng, expected result chưa rõ, case cần confirm với BA.

Success Criteria:
- Chỉ ra được missing case.
- Chỉ ra được testcase quá chung chung.
- Không viết lại toàn bộ testcase nếu không cần.
- Không lặp lại requirement.
- Output ngắn, dễ review.
Sau đó dùng Plan Mode để hỏi:

Hãy giúp tôi lập plan tạo custom agent cho use case trên.
Kết luận

Custom agent không nhất thiết phải bắt đầu từ kỹ thuật phức tạp.

Flow mình hay dùng là:

Input/Output/Success Criteria
→ Plan Mode
→ Review plan
→ Implement nhỏ
→ Golden Examples
→ Detect Agent Bugs
→ Fix Plan
→ Retest
Dev/Tester/BA không cần trở thành AI engineer ngay.

Chỉ cần biết mình muốn agent nhận gì, trả ra gì, output như thế nào là dùng được, và tiêu chí nào để đánh giá agent đạt.



Thông điệp chính:

Đừng kỳ vọng custom agent đúng ngay từ lần đầu.
Hãy xem việc tạo agent giống như phát triển một mini product: có requirement, có test case, có bug, có fix và có iteration.
