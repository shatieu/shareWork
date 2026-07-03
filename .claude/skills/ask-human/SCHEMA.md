# ask-human spec schema

`spec.json` is a JSON array of question objects. Order in the array is the order shown on the
page.

## Common envelope (every question)

| field | required | description |
|---|---|---|
| `id` | yes | unique string, used as the key in `answers.json` |
| `type` | yes | one of: `single-select`, `multi-select`, `text`, `yesno`, `rating`, `ranking`, `compare` |
| `prompt` | yes | the question text, shown as a heading |
| `context` | no | markdown/code blurb shown above the prompt for background. Supports fenced code blocks (```lang), `inline code`, `**bold**`, `*italic*`, and plain paragraphs |
| `suggested` | no | a pre-filled default value (shape depends on `type`, see below) the human can accept or edit |
| `allowAttachment` | no, default `true` | set `false` to hide the paste/upload control on this question |

## Type-specific fields

### `single-select`
- `choices`: array of `{value, label}` — rendered as radio buttons
- `allowOther` (bool, default `false`): adds a write-in "Other" radio with a text field
- `suggested`: a `value` string matching one of the choices (or free text if it should preselect Other)

### `multi-select`
- `choices`: array of `{value, label}` — rendered as checkboxes
- `allowOther` (bool, default `false`): adds a write-in "Other" checkbox with a text field
- `suggested`: array of `value` strings to pre-check

### `text`
- `suggested`: a string pre-filled into the textarea
- `placeholder` (optional): placeholder text when empty

### `yesno`
- `suggested`: one of `"yes"`, `"no"`, `"unsure"`

### `rating`
- `min`, `max` (optional, default `1`/`10`)
- `minLabel`, `maxLabel` (optional): labels shown at each end of the slider
- `suggested`: a number within range

### `ranking`
- `choices`: array of `{value, label}` — human drags to reorder (or uses up/down buttons)
- `suggested`: array of `value`s in a suggested order (defaults to the given order if omitted)
- resulting `value` in `answers.json` is the final ordered array of `value`s

### `compare`
- `choices`: array of `{value, label, context}` — each rendered as a card; `context` supports the
  same mini-markdown as the top-level `context` field (use it for code/diff snippets per option)
- `suggested`: a `value` matching one of the choices
- resulting `value` is the single selected `value`

## `answers.json` output shape

```jsonc
[
  {
    "id": "auth-strategy",
    "type": "single-select",
    "value": "jwt-cookie",
    "attachments": ["attachments/auth-strategy__screenshot.png"]
  },
  {
    "id": "priorities",
    "type": "ranking",
    "value": ["perf", "dx", "cost"],
    "attachments": []
  }
]
```

- `attachments` is always present (empty array if none), listing paths relative to the session
  directory. Read them directly with your Read tool.
- For `multi-select` with `allowOther` and the Other box checked, the write-in text is appended
  to `value` as an extra string entry (not a separate field) so `value` stays a plain array of
  strings for that question.
- For `single-select`/`compare` with Other selected, `value` is just the typed string.

## Full example

See `examples/example-spec.json` for one question of every type.
