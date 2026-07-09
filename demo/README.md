# Demo recording (#38)

The landing-page demo is rendered from a VHS tape, so it can be re-recorded in
one command whenever the CLI's output changes. Every command in it is real:
a real `npm` install of the published package, the real CLI, a real API
(local, in-memory storage).

## Re-record

```bash
brew install vhs          # once
demo/setup.sh             # scratch HOME + npm prefix + local API + project dir
vhs demo/demo.tape        # renders demo/keyline-demo.{gif,mp4,webm}
demo/teardown.sh
```

Keep it under 60 seconds (currently ~45s). The tape sources `demo/.demo-env`
in a hidden frame, so nothing touches your real HOME, keystore, npm prefix,
or the production API.

The landing page (`index.html`) embeds the mp4/webm; the GIF is for READMEs
and social embeds.
