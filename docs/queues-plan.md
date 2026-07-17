# Plan: Queue trigger cho CSM

> Trạng thái: DRAFT — chưa bắt đầu code. Bám theo khuôn hiện có: GORM/Postgres,
> `robfig/cron/v3`, `WorkflowExecutor.Run(...)` là entrypoint chạy workflow,
> pattern domain → repository → service → handler (giống Dataset/Schedule).

## 0. Mục tiêu & scope
- Thêm resource **Queue**: khi tạo chọn **1 consumer workflow**; workflow khác **push
  message** vào → dispatcher chạy consumer workflow với **payload = inputs**.
- Chỉ trong CSM. Không đụng crawler / gia-vang.
- **DB là nguồn sự thật**; RAM chỉ giữ 1 lô đang xử lý + signal channel. Sống sót qua restart.
- Semantics: **at-least-once + ack**, retry backoff, dead-letter, concurrency chỉnh trong
  setting của queue.

## 1. Data model (mirror `Dataset`/`DatasetRecord` trong internal/domain/models.go)

### Queue
| Cột | Kiểu | Ghi chú |
|---|---|---|
| ID, NamespaceID, Key, Name, Description | như Dataset | `Key` để template/API ref |
| ConsumerWorkflowID | uuid | workflow chạy khi có message |
| Concurrency | int (default 1) | số message xử lý song song |
| MaxRetries | int (default 3) | quá số này → dead-letter |
| RetryBackoffSec | int (default 5) | delay giữa các lần retry |
| BatchSize | int (default 100) | lô kéo từ DB mỗi vòng |
| MaxDepth | int (default 0 = không giới hạn) | số message `pending`+`processing` tối đa; vượt → Push bị từ chối |
| Status | string | ACTIVE / PAUSED |
| CreatedBy / CreatedByUsername / CreatedAt / UpdatedAt | | như các resource khác |

### QueueMessage
| Cột | Kiểu | Ghi chú |
|---|---|---|
| ID, QueueID | uuid, index | |
| Payload | jsonb | input cho consumer workflow |
| Status | string | `pending` / `processing` / `done` / `failed` / `dead` |
| RetryCount | int | |
| AvailableAt | timestamp | hỗ trợ delay + retry backoff |
| ClaimedAt | timestamp | thời điểm claim (audit; boot recovery reset toàn bộ `processing`) |
| ExecutionID | *uuid | trace sang WorkflowExecution |
| LastError | text | |
| CreatedAt / UpdatedAt | | |

**Index quan trọng:** `(queue_id, status, available_at)` — phục vụ câu claim.

## 2. Vòng đời message (state machine)
```
pending ──claim──> processing ──success──> done
   ▲                   │
   │                   ├─ fail & retry<max  ──> pending (available_at = now + backoff)
   │                   └─ fail & retry>=max ──> dead (dead-letter)
   └── CSM restart (boot recovery) ── reset toàn bộ processing = pending lại
```
> Không dùng visibility timeout / runtime ticker. Dispatcher là goroutine trong chính
> process CSM: process còn sống → dispatcher còn sống, nên không có message mồ côi lúc
> đang chạy. Chỉ cần dọn lúc boot (xem mục 7). *(Multi-instance: xem ghi chú mục 7.)*

## 3. Claim chống lấy trùng (Postgres `SKIP LOCKED`)
```sql
UPDATE queue_messages SET status='processing', claimed_at=now()
WHERE id IN (
  SELECT id FROM queue_messages
  WHERE queue_id = $1 AND status = 'pending' AND available_at <= now()
  ORDER BY created_at
  LIMIT $batch
  FOR UPDATE SKIP LOCKED
) RETURNING *;
```
→ Nhiều dispatcher / instance không giật trùng message. Điểm mấu chốt của độ đúng đắn.

## 4. Dispatcher (mirror ScheduleService + cron)
`QueueService` giữ, per queue ACTIVE, một **goroutine dispatcher**:
```
loop:
  1. claim 1 lô (BatchSize) bằng SQL trên → vào RAM
  2. chạy lô qua worker pool size = Concurrency
        mỗi msg: executor.Run(ctx, ConsumerWorkflowID, execID,
                              payload→inputs, nil, nil, "QUEUE", user, ...)
        SUCCESS → status=done (+ExecutionID)
        FAIL    → retry++/backoff hoặc dead
  3. còn pending → lặp; hết → block chờ signal channel (không busy-poll)
```
- **Signal channel** (buffered nhỏ, cap 1): push xong → `select { case ch<-struct{}{}: default: }`
  (non-blocking) đánh thức dispatcher. Không chứa payload.
- **RAM chặn trên** = BatchSize × 1 lô, bất kể queue sâu bao nhiêu.

## 5. Producer: cách bơm message vào
Làm cả hai:
- **Step type mới `QUEUE_PUSH`** trong `WorkflowStep` (mirror khối `DATASET` field ở
  models.go): thêm `QueueID`, `QueuePayload` (JSON template). Đúng ý "workflow khác insert
  giống Dataset".
- **HTTP API** `POST /api/queues/:key/messages` (body = payload) để trigger từ ngoài / nội bộ.

Cả hai gọi `QueueService.Push(queueID, payload, availableAt?)` → ghi DB pending + signal.

**Backpressure (`MaxDepth`):** trước khi ghi, nếu `MaxDepth > 0` và số message `pending`+`processing`
của queue >= `MaxDepth` → `Push` trả lỗi (HTTP 429 cho API, step `QUEUE_PUSH` fail). Ngăn producer
nhanh hơn consumer làm bảng `queue_messages` phình vô hạn. `MaxDepth = 0` = không chặn (default).
UI nên hiển thị độ sâu queue hiện tại (đếm `pending`) để theo dõi backlog.

## 6. Map payload → inputs (lưu ý quan trọng)
`WorkflowExecutor.Run` nhận `inputs map[string]string`, có `validateInputs` + SecurityRegex.
- Payload JSON → flatten thành `map[string]string` (field lồng nhau → JSON-encode giá trị).
- **Validate như input thường** (message từ workflow khác vẫn coi là untrusted).
- `triggerSource="QUEUE"`, `scheduledID/pageID=nil`.
- Thêm cột `queue_id` (hoặc `queue_message_id`) vào `WorkflowExecution` để audit đúng nguồn.

## 7. Boot & restart recovery (mirror ScheduleService.Init())
- `QueueService.Init()` lúc khởi động: load Queue ACTIVE → spawn dispatcher.
- **Recovery (đơn giản):** trước khi spawn dispatcher, reset **toàn bộ** message `processing`
  về `pending` (`UPDATE queue_messages SET status='pending' WHERE status='processing'`).
  Sau restart chẳng có gì đang thật sự chạy → dọn sạch là đúng. Không mất message. Mirror
  [CleanupZombieExecutions](../backend/internal/service/workflow_service.go).
- **Multi-instance (chỉ khi chạy replica):** boot recovery kiểu reset-tất-cả sẽ cướp message
  của instance khác đang chạy. Khi đó mới cần quay lại cơ chế visibility timeout: thêm
  `VisibilityTimeoutSec` + ticker quét `processing` quá hạn + heartbeat `claimed_at` cho
  consumer chạy lâu. Ngoài scope hiện tại (1 instance).

## 8. Files đụng tới (theo khuôn có sẵn)
- **Sửa** `internal/domain/models.go`: thêm `Queue`, `QueueMessage`, step fields, interface
  `QueueRepository`.
- **Tạo** `internal/repository/postgres_queue_repo.go`: mirror `postgres_dataset_repo.go`,
  thêm `ClaimBatch`, `Ack`, `Fail`, `RequeueStale`.
- **Tạo** `internal/service/queue_service.go`: dispatcher, signal, worker pool, Init.
- **Tạo** `internal/handler/queue_handler.go`: CRUD queue + push message + list messages +
  dead-letter view/replay.
- **Sửa** `internal/service/workflow_executor.go`: thêm nhánh xử lý step `QUEUE_PUSH`.
- **Migration** GORM AutoMigrate + index.
- **Wire** vào main: khởi tạo QueueService + gọi Init, cạnh chỗ ScheduleService.
- **Frontend:** trang Queues (list/create: chọn consumer workflow + concurrency/retry),
  viewer messages + dead-letter replay; thêm step `QUEUE_PUSH` vào workflow builder.

## 9. Cấu hình trong setting queue
Concurrency, MaxRetries, RetryBackoff, BatchSize, MaxDepth, Status(pause) — đều là cột `Queue`,
sửa trên UI. Pause = dừng dispatcher, message vẫn tồn ở DB.

## 10. Edge cases phải test
- Producer push nhanh hơn consumer → backlog dồn DB, RAM vẫn phẳng; vượt `MaxDepth` → Push bị từ chối (429).
- Consumer workflow fail → retry backoff → dead-letter sau MaxRetries.
- CSM restart giữa `processing` → boot recovery reset về `pending`, chạy lại.
- Nhiều instance CSM (nếu chạy replica) → `SKIP LOCKED` đảm bảo không trùng.
- Concurrency=1 → serial đúng thứ tự; >1 → không đảm bảo thứ tự (ghi rõ trong doc).
- Xóa queue → cascade messages; xóa consumer workflow → chặn hoặc pause queue.

## 11. Retention
Job dọn `done` sau N ngày (tái dùng cơ chế cleanup execution đã có); **giữ `dead`** để
debug / replay.

## 12. Phân giai đoạn
- **P1 — Core:** model + migration + repo (claim/ack/fail) + QueueService dispatcher +
  Init/recovery. Test bằng push API. *(xương sống, chứng minh đúng đắn)*
- **P2 — Producer tích hợp:** step `QUEUE_PUSH` trong builder + executor. *(khép vòng
  workflow → queue → workflow)*
- **P3 — Retry / dead-letter** hoàn chỉnh (backoff, MaxRetries → dead, dead-letter replay).
- **P4 — Frontend** quản lý queue + viewer + dead-letter replay.
- **P5 — Retention + docs** (`docs/queues.md` theo style `schedules.md`).

## 13. Quyết định đã chốt
- **1 consumer workflow cố định / queue** (thay vì nhiều consumer, hay message tự chỉ định
  workflow). Lý do: giữ model phẳng "1 queue = 1 kênh việc, 1 loại xử lý, DB là state machine
  1 giá trị status/message". Hai nhu cầu hay bị gộp vào "nhiều consumer" đều đã có lời giải
  tốt hơn mà không phá model:
  - **Chạy song song nhanh hơn** → dùng cột `Concurrency` (N execution *cùng* consumer chạy
    song song — competing workers). KHÔNG cần nhiều workflow.
  - **1 message → kích nhiều workflow khác nhau (fan-out/pub-sub)** → hoặc (a) tạo nhiều queue,
    producer push vào từng cái (mỗi queue có backlog/retry/dead-letter riêng, dễ debug); hoặc
    (b) consumer duy nhất gọi sub-workflow (đã có child execution `RunWithDepth`).
- **Vì sao không cho nhiều consumer/queue:** pub-sub (mỗi msg → tất cả consumer) buộc track
  ack/retry/dead-letter riêng cho từng consumer trên từng message → status không còn 1 giá trị,
  nhân bội độ phức tạp. Load-balance khác-workflow thì vô nghĩa (khác workflow xử lý cùng payload
  = phải cùng contract = thực chất 1 workflow, và đó là việc của `Concurrency`).
- **Nếu sau này thật sự cần pub-sub** 1-message-nhiều-subscriber → thêm *sau* như layer riêng
  (queue có nhiều subscriber + bảng delivery riêng per-subscriber), không nhét vào core.
