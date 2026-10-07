# Mercury 3 for omp

Register **Inception Mercury 3 Preview (1002)** in [oh-my-pi / omp](https://github.com/dankalish/oh-my-pi), using the OpenAI-compatible chat-completions adapter. No proxy, plugin, or source patch is needed.

Tested with **omp 18.6.1**. This is a preview-specific integration, not an official Inception installer. Your Inception account must have access to `mercury-3-preview-1002`; it may not appear in the public models list. Preview IDs and limits can change.

## Quick start

Prerequisites: an installed `omp`, **Node.js 20+**, npm, and an Inception API key from [the Inception dashboard](https://docs.inceptionlabs.ai/get-started/authentication).

```sh
git clone https://github.com/vantasnerdan/omp-mercury3.git
cd omp-mercury3
./setup.sh
```

Export your own key in the terminal that launches omp. To avoid putting the key in shell history, use this **Bash** prompt:

```bash
read -r -s -p 'Inception API key: ' INCEPTION_API_KEY
printf '\n'
export INCEPTION_API_KEY

omp models inception --json
omp --model inception/mercury-3-preview-1002 --thinking high
```

For a small, paid API smoke check:

```sh
omp --model inception/mercury-3-preview-1002 --thinking minimal \
  --system-prompt 'Reply with the requested literal token only.' \
  --no-tools --no-extensions --no-skills --no-rules --no-session --no-title \
  -p 'Reply with MERCURY_OK and nothing else.'
```

The environment variable must also be available to omp launched in another terminal or herdr pane. Existing processes do not inherit later exports. A stored omp credential or a runtime `--api-key` can take precedence over the environment reference; see [omp's credential resolution documentation](https://github.com/dankalish/oh-my-pi/blob/main/docs/models.md).

## What setup changes

`./setup.sh` installs the pinned `yaml` npm package with dependency lifecycle scripts disabled, then runs `setup.mjs`. After that, `node setup.mjs` reruns setup without reinstalling dependencies.

The installer:

- Defaults to `~/.omp/agent/models.yml`, or `$PI_CODING_AGENT_DIR/models.yml` when set.
- Sets the `inception` provider connection to `https://api.inceptionlabs.ai/v1`, `openai-completions`, and `apiKey: INCEPTION_API_KEY`.
- Adds or replaces only the `mercury-3-preview-1002` model definition. Removes an existing `modelOverrides` entry for this model so it cannot silently override the new definition.
- Preserves unrelated providers, other Inception models, and unrelated YAML settings/comments. Does not change your selected/default model in `config.yml`.
- Makes a uniquely named, private `.bak` copy before replacing an existing changed file; writes the new file atomically with owner-only permissions. Unchanged reruns do not create another backup.
- Refuses malformed configuration or duplicate definitions rather than discarding existing registrations.
- If a legacy `models.json` exists without `models.yml`, asks you to run omp once for its built-in migration first.

It never prompts for, reads, prints, or saves your API key. The configuration stores the **environment variable's name**, not its value. Backups can contain credentials already present in your original configuration: keep them local. Nothing is automatically committed or uploaded.

For an isolated omp profile or another config directory, specify the actual profile's YAML file explicitly:

```sh
./setup.sh --models-file /path/to/profile/models.yml
```

## Parameters

```sh
./setup.sh --max-tokens 32768 --context-window 1000000 --thinking high
```

| Installer option / config field | Default | Meaning |
| --- | --- | --- |
| `--models-file` | `~/.omp/agent/models.yml` | Destination YAML model registry; respects `PI_CODING_AGENT_DIR`. |
| Model `id` | `mercury-3-preview-1002` | Exact preview API model ID. Select with `inception/mercury-3-preview-1002`. |
| `--context-window` / `contextWindow` | `1000000` | omp's advertised total context capacity, not a request token budget. Configured preview capacity; not a guarantee for every account. Supports smaller values, not values above 1M. Leave room for system prompts, tools, and output. |
| `--max-tokens` / `maxTokens` | `32768` | Per-response upper budget for **reasoning plus visible output**. Sent as API `max_tokens`. Supported installer range: 1–65,536, less than the context window. Not an input limit, and not a promise of that much visible text. |
| `--thinking` / `thinking.defaultLevel` | `high` | Default reasoning-effort level when registering the model. Set the runtime level explicitly with `omp --thinking …`. No separate fixed thinking-token budget is configured. |

### Thinking-level translation

The preview endpoint accepts different values from older Mercury models:

| omp `--thinking` | API `reasoning_effort` | Suggested use |
| --- | --- | --- |
| `minimal` | `instant` | Fast extraction, lightweight mappers, simple tool calls. |
| `medium` | `medium` | General work and routine summaries. |
| `high` | `high` | Difficult retrieval, cross-document reconciliation, complex coding. |
| `max` | `max` | Harder reasoning when additional latency is acceptable. |

This integration advertises only these four levels. **Do not use `low`**: this preview returned an API validation error accepting only `instant`, `medium`, `high`, and `max`. `off`, `xhigh`, and `auto` are not configured preview effort choices. Inception's [public reasoning guide](https://docs.inceptionlabs.ai/capabilities/reasoning-efforts) currently describes Mercury 2/2.5, not this preview's exact enum.

### Compatibility switches

The registered model uses text input only and `reasoning: true`. Its adapter compatibility block:

- `supportsReasoningParams: true`, `supportsReasoningEffort: true`, `thinkingFormat: openai`: send the translated OpenAI-style reasoning effort.
- `maxTokensField: max_tokens`: use `max_tokens`, not `max_completion_tokens`.
- `supportsDeveloperRole: false`: do not send an unsupported developer-role message.
- `supportsStore: false`: do not send OpenAI's `store` option.

No speculative pricing is registered. omp may show unknown/zero local cost estimates; that **does not mean the API is free**.

## Map/reduce and summarization

Example role selection (for that invocation only):

```sh
omp --model inception/mercury-3-preview-1002 \
  --smol inception/mercury-3-preview-1002 --thinking medium
```

`--smol` selects the lightweight model role; it does not force every child task's effort. Use `minimal` for straightforward standalone mappers and `high` for a reducer that must resolve conflicting evidence. Preserve document paths, exact values, historical corrections, and unsupported claims in intermediate summaries.

A large context window does **not** increase your account's input-token-per-minute quota. Repeated agent rounds resend growing conversation context; overlapping large mappers can trigger **429 input token limit exceeded**. Start large-context runs sequentially, then increase concurrency only within your account limits. See [Inception rate limits](https://docs.inceptionlabs.ai/get-started/rate-limits).

## Verification and limits

Local evaluation on 2026-10-07: Mercury 3 read 69 raw chunks containing 268 substrate-framework documents (~351,529 estimated corpus tokens), then returned **14/14 correct fields**, including the corrected accepted claim, numerical interaction, provenance, and verbatim evidence quote. The UI showed 36.8% of a 1M context. This was one observed retrieval run, not a general accuracy guarantee or an exact tokenizer count. The private corpus, evaluation transcripts, and API credentials are not included here.

The installer was verified against a fresh temporary omp registry; a live, minimal-system-prompt completion returned `MERCURY_OK`. A local wire smoke exercised all four effort mappings, confirmed `max_tokens: 32768`, and confirmed streaming without `store` or developer-role messages. All five regression tests passed. An initial larger-system-prompt smoke hit HTTP 429 after the context evaluation; the reduced-input check succeeded. Development checks:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
node setup.mjs --help
```

For removal, restore the printed backup if no subsequent changes were made, or remove the installed model and its provider connection settings manually. Do not restore an old backup over newer unrelated changes.

References: [omp model configuration](https://github.com/dankalish/oh-my-pi/blob/main/docs/models.md), [Inception authentication](https://docs.inceptionlabs.ai/get-started/authentication), [chat completions](https://docs.inceptionlabs.ai/api-reference/chat/create-a-chat-completion).
