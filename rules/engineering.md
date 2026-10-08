## Change discipline

- Make only changes that are explicitly requested or directly related.
- After each iteration, review and revert any changes or files no longer needed.
- Don't touch code unrelated to the task.
- Avoid duplication: check for similar existing code before writing new code.
- Exhaust existing patterns before introducing new ones; remove the old when replaced.

## Design principles

- Prefer modular, extensible designs without overengineering.
- Take scalability into account, but don't optimize for problems that don't exist.

## Code hygiene

- Never mock data for dev or prod. Mocking is for tests only.
- Never fix a logic-error failure by mocking the failed function. Understand and fix the underlying logic.

## Documentation

- Add a concise purpose description at the top of every module created or modified.
