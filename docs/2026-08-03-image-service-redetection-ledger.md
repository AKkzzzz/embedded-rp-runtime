# Image Service Redetection Preservation Ledger

## Scope

- Re-read RP-Hub image-generation settings without reloading the card.
- Probe the RP-Hub image service with the same HEAD-status approach used by RP-Hub.
- Expose the result to the template Debug image page and derived-card settings.

## Preserved Surfaces

- Story image enablement, prompt protocol, artist/style strings, size and count settings.
- Image cache IDs, generated URLs, per-image retry, error reporting, and scene placement.
- Model refresh, conversation generation, state, world book, GUI navigation, and save format.

## Allowed Changes

- `ui/runtime/host-bridge.js`: service status and redetection API.
- `ui/runtime/image-generation.js`: public redetection adapter.
- Template Debug image controls and derived-card player settings controls.
- Focused tests, audits, and rebuilt release artifacts.

## Baseline

- RP-Hub comparison commit: `5cbcddc21a942b219fedbe9cdf132e78ddd0226f`.
- RP-Hub service check: `HEAD https://nai.sta1n.cn`, 10-second timeout, a resolved no-cors response counts as connected.
