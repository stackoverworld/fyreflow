# Figma flow failure root cause (run `Zb0g5ZXDT_LjreMPBzpHu`)

## Primary root cause
- The OpenAI API path failed, so execution fell back to Codex CLI.
- Codex CLI is launched with `--sandbox read-only`, which blocks creating/updating artifacts in shared storage.
- This makes artifact-producing steps impossible (`Figma Extractor`, `Figma Extractor Remediator`).

Evidence:
- `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/state.json:94`
- `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/state.json:142`
- `server/providers/clientFactory/cliRunner.ts:840`
- `server/providers/clientFactory/cliRunner.ts:841`

## Direct failure chain
1. `Figma Extractor` cannot write `assets-manifest.json` and `figma-frames-index.json`.
2. Blocking artifact gates fail for those files.
3. `on_fail` correctly routes to `Figma Extractor Remediator`.
4. Remediator also runs in read-only mode, cannot write `figma-remediation.json`.
5. Remediator fails blocking contract gate and run terminates.

Evidence:
- Missing artifact contract/gate failures:  
  - `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/state.json:130`  
  - `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/state.json:175`
- Write-blocked model summaries:  
  - `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/state.json:126`  
  - `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/state.json:171`

## Secondary configuration issue
- Gate `Frame Count Field Gate` is configured as `json_field_exists` with `jsonPath: $.frameCount`.
- In current evaluator semantics, `json_field_exists` checks the **step text output JSON**, not an artifact file.
- `Figma Extractor` output format is markdown, so this gate fails with `Output is not valid JSON`, even when `frame-map.json` already contains `frameCount`.

Evidence:
- Gate config:  
  - `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/pipeline-snapshot.json:515`
- Runtime failure details:  
  - `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/state.json:333`  
  - `data/agent-storage/runs/Zb0g5ZXDT_LjreMPBzpHu/state.json:338`
- Evaluator behavior:  
  - `server/runner/qualityGates/evaluators.ts:997`  
  - `server/runner/qualityGates/evaluators.ts:1015`  
  - `server/runner/qualityGates/evaluators.ts:1027`

## Additional historical note
- Previous failed run (`JXe1lo2IpNLDAY0kKFrcG`) had no `on_fail` route from `Figma Extractor`, so it failed immediately after gate block.
- This was later improved in run `Zb0g5ZXDT_LjreMPBzpHu` (remediator route is present), but still blocked by read-only execution.

Evidence:
- No extractor `on_fail` in old snapshot links:  
  - `data/agent-storage/runs/JXe1lo2IpNLDAY0kKFrcG/pipeline-snapshot.json:302`
- Old terminal reason:  
  - `data/agent-storage/runs/JXe1lo2IpNLDAY0kKFrcG/state.json:110`
