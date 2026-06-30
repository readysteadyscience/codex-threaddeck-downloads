---
name: codex-thread-dispatch
description: Route user instructions from a controller Codex thread to other Codex threads. Use when the user asks this thread to control, message, dispatch tasks to, query, coordinate, or summarize another Codex conversation/window/thread.
---

# Codex Thread Dispatch

## Goal

Let this conversation act as the controller thread: the user talks here, and Codex can inspect other Codex threads, choose the correct target, send bounded follow-up prompts, then report back.

This Skill is for local Codex App thread coordination. It does not make other threads autonomous without user-visible routing and safety checks.

The target worker threads are user-selected. Numbered names such as `00`, `01`, or `06` are optional conventions, not requirements.

## Operating Model

```text
User in controller thread
  -> inspect project and task state
  -> choose execution surface
     -> single conversation
     -> Codex native subagents inside the current task
     -> visible worker threads for persistent roles
     -> manual TaskCards / Handoffs when tools are missing
  -> report compact evidence here
```

## Available Thread Actions

Use the current Codex App thread tools when available:

- `list_threads`: find candidate target threads by title, cwd, status, or preview.
- `read_thread`: inspect recent status and turns before sending.
- `send_message_to_thread`: send a follow-up prompt to an existing thread.
- `create_thread`: create a new background thread when no suitable one exists.
- `set_thread_title`: rename the official controller and tested worker threads when the dispatch setup needs clear labels.
- `set_thread_pinned`: pin the official controller thread when it becomes active; pin/unpin other threads only when the user explicitly asks.
- `set_thread_archived`: archive/unarchive threads if the user explicitly asks.

If these tools are not available in the current environment, stop and explain that thread dispatch cannot be performed from this session.

## Project-State Detection

Before recommending a controller/worker bootstrap for a normal user task, inspect the project state when the repository includes ThreadDeck helpers:

```bash
node ../../scripts/detect-project-state.mjs --root . --intent "<current user task>" --format text
```

Use this result to decide whether to continue normal Codex work, recommend installing the project kit, repair an incomplete `.threaddeck/` setup, or ask for minimal confirmation before dispatch. This command is read-only and does not create Codex threads.

Then recommend the smallest execution surface:

```bash
node ../../scripts/recommend-execution-mode.mjs --state /tmp/project-state.json --intent "<current user task>" --capability multi_agent --format text
```

Do not use a fixed default set of Docs/Tests/Implementation/Release workers. For bounded complex tasks, prefer Codex native subagents when available. Create or reuse visible worker threads only for persistent roles, long-running maintenance, old-project migration, or when cross-window context must be preserved. A visible worker may use Codex native subagents inside its own task.

When `.threaddeck/last-routing-decision.json` exists, read it as advisory evidence of the most recent CTD auto-route hook decision. Do not treat it as permission to create threads or dispatch work; real dispatch still requires available thread tools and the usual confirmation gates.

When available, turn the routing decision into a safe dispatch plan before touching thread tools:

```bash
node ../../scripts/ctd-plan-dispatch.mjs --root . --format text
```

If the plan says `request_user_confirmation_to_create_or_select_workers`, ask the user before creating, renaming, or registering workers. If the plan says `run_safe_test_before_dispatch`, send only the harmless safety test first. If the plan says `prepare_task_card_for_existing_workers`, read the worker status and render a bounded TaskCard before dispatch.

## Routing Rules

Before sending any message:

1. Identify the target thread by at least two signals:
   - thread title;
   - `cwd`;
   - thread id;
   - recent preview/status;
   - user-provided role name.
2. Read the target thread unless the user explicitly supplied a thread id and asked for a simple low-risk status ping.
3. Verify the target thread is appropriate for the task.
4. Keep the dispatch prompt short, scoped, and compatible with the target thread's existing role.
5. Report exactly which thread was messaged: title, thread id, `cwd`, and prompt summary.

If multiple candidates match, ask the user to choose unless one candidate is clearly superior from title plus `cwd`.

## Naming And Hygiene

When the user wants a thread to become an official dispatchable worker, prefer marking it with a visible dispatch prefix:

```text
⇄ <controller thread title>
↳ <worker or specialist thread title>
```

Use the prefix to distinguish the active ThreadDeck controller and active ThreadDeck-managed workers from legacy, duplicate, backup, or migration-only threads.

Recommended hygiene rules:

- Keep only the active controller and active workers unarchived when possible.
- Pin the active controller when `set_thread_pinned` is available.
- Archive legacy or backup threads after migration or replacement.
- Never dispatch to a legacy thread when an official `↳` thread exists for the same role.
- If the user wants to preserve an old thread's history, have the tool-enabled controller read and migrate it into the active controller instead of trying to inject tools into the old thread.
- For a candidate target, prefer an official `↳` thread over an unprefixed older thread when title/cwd otherwise overlap.

## Message Types

Allowed by default:

- status query;
- progress summary request;
- task handoff inside the target thread's existing responsibility;
- request to inspect files or run non-destructive checks;
- request to pause and summarize before continuing;
- request to create a plan, research card, or implementation note.
- compact evidence handoff from one worker to another through the controller.

Require explicit user confirmation before sending:

- publish, release, deploy, upload, or external posting;
- deletion, destructive git operations, reset, checkout, or cleanup;
- account, payment, credential, token, signing, notarization, production, customer delivery, or private repository actions;
- any instruction that could conflict with the target thread's current task;
- sending the same instruction to more than one thread;
- changing model or reasoning settings for another thread;
- creating new threads in bulk.

Refuse or narrow:

- hidden or silent control of other threads;
- bulk autonomous task dispatch without status checks;
- instructions that intentionally bypass user approval or project safety rules;
- moving secrets between threads.

## Dispatch Prompt Template

Use this shape unless the user asks for a different format:

```text
来自主控线程的任务交接：

目标：
<one concrete objective>

边界：
- <what to touch>
- <what not to touch>

上下文：
- <minimal relevant context from controller thread>

请先做：
1. 读取当前线程已有上下文和项目入口文件。
2. 判断这项任务是否属于本线程职责。
3. 如果属于，继续执行并在完成后给出状态摘要。
4. 如果不属于或会冲突，先停止并说明原因。
```

## Status Query Template

```text
来自主控线程的状态查询：

请用简短格式汇报当前线程：
- 当前目标
- 进行状态
- 最近完成的事
- 阻塞点
- 下一步建议

不要改文件，除非当前线程原本正在执行的任务已经需要继续。
```

## Workflow

1. Parse the user's controller request.
2. Decide whether to list, read, send, create, or manage a thread.
3. Use `list_threads` when the target thread is not already known.
4. Use `read_thread` before dispatch for non-trivial tasks.
5. Compose the prompt using the smallest necessary context.
6. If the action is high risk or ambiguous, ask for confirmation before sending.
7. Send with `send_message_to_thread` or create a new worker with `create_thread`.
8. Report the result in the controller thread.
9. For important dispatches, suggest or write a local dispatch log if the project has a log location.

For active multi-worker projects, use compact dispatch:

- One short send message.
- One short receive/status report.
- Preserve only the critical evidence: artifact path, version, checksum, test result, blocker, or next owner.
- Avoid long summaries unless the user asks.

## Output Back To User

After dispatch, report:

- target thread title;
- target thread id;
- target `cwd`;
- sent message type;
- one-line prompt summary;
- whether the target was active or idle before sending;
- any follow-up needed.

Keep the report concise. Do not paste a long prompt unless the user asks.

For compact mode, prefer this shape:

```text
Sent: <target title> / <message type>.
Result: <one-line status or callback>.
Next: <next owner or wait state>.
```

## Notes

- This Skill controls Codex threads through available local thread tools; it does not guarantee that the target thread finishes before the controller responds.
- Prefer a small number of well-named worker threads over many ad hoc threads.
- For multi-project work, route by project directory first, title second.
- Treat the controller thread as the source of coordination, not as a place to import every worker thread's full context.
- A controller may act as a lightweight event bus between workers by forwarding compact evidence from one worker to another, as long as the forwarded content is scoped, non-secret, and relevant to the receiving worker's role.
