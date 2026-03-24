# simplify-refactor-review

Use this skill after an end-to-end RainCheck path works.

## Goal

- remove duplication
- collapse unnecessary abstractions
- simplify component trees
- simplify backend control flow
- tighten types
- improve naming
- remove dead code
- improve error handling
- check readability for a new engineer

## Workflow

1. Start with the user-facing path that already works.
2. Look for repeated branches, thin wrapper layers, and vague names.
3. Prefer direct modules and switch statements over registries or magic.
4. Keep the chat workflow primary and hide unfinished surfaces.
5. Re-run the smallest relevant tests after each cleanup pass.

## Review lens

- Can a new engineer follow the request path quickly?
- Are contracts explicit at important boundaries?
- Are tool names and source labels obvious?
- Is there any dead or half-built UI that should be hidden?
- Is there any backend control flow that would be clearer in one file?
