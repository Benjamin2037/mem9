## Shared Memory

This repo uses mem9 shared memory for Codex.

- At the start of multi-step work, recall context with `mem9_context_recall`.
- Store durable discoveries with `mem9_memory_store`.
- Before compacting, handing off, or pausing, save a checkpoint with `mem9_checkpoint_save`.
