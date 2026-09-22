#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="$repo_root/.github/workflows/dogfood-gate.yml"
lock="$repo_root/.github/workflows/actions.lock"

if ! command -v yq >/dev/null; then
    printf 'FAIL: yq v4 is required to parse the workflow and actions lock\n' >&2
    exit 1
fi

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

assert_equal() {
    if [[ "$1" != "$2" ]]; then
        printf 'FAIL: %s\nExpected: %s\nActual:   %s\n' "$3" "$1" "$2" >&2
        exit 1
    fi
}

assert_contains() {
    [[ "$1" == *"$2"* ]] || fail "$3: missing $2"
}

assert_not_contains() {
    [[ "$1" != *"$2"* ]] || fail "$3: unexpectedly contains $2"
}

jobs="$(yq -r '.jobs | keys | .[]' "$workflow" | sort)"
remaining_jobs="$(printf '%s\n' "$jobs" | sed '/^dogfood-summary$/d')"
needs="$(yq -r '.jobs."dogfood-summary".needs[]' "$workflow" | sort)"
assert_equal "$(printf '%s\n' k9-validate empty-lint groove-check eclexiaiser-validate | sort)" "$remaining_jobs" 'remaining validation jobs'
assert_equal "$remaining_jobs" "$needs" 'summary needs every remaining validation job'
assert_equal 'always()' "$(yq -r '.jobs."dogfood-summary".if' "$workflow")" 'summary runs after failed checks'
assert_not_contains "${jobs,,}" 'a2ml' 'retired job'
assert_not_contains "$(tr '[:upper:]' '[:lower:]' < "$workflow")" 'a2ml' 'retired workflow references'

actual_actions="$(yq -r '.jobs.*.steps[].uses | select(. != null)' "$workflow" | sed -E 's#^(hyperpolymath/[^/]+)/[^@]+@#\1@#' | sort -u)"
locked_actions="$(yq -r '.workflows.".github/workflows/dogfood-gate.yml"[]' "$lock" | sort -u)"
assert_equal "$actual_actions" "$locked_actions" 'lock references match workflow uses'
assert_equal 'null' "$(yq -r '.dependencies."hyperpolymath/a2ml-ecosystem@main"' "$lock")" 'retired action has no dependency entry'
assert_equal 'main' "$(yq -r '.dependencies."hyperpolymath/k9-ecosystem@main".ref' "$lock")" 'surviving K9 action has a dependency entry'

scorecard_script="$(yq -r '.jobs."dogfood-summary".steps[] | select(.name == "Generate dogfooding scorecard") | .run' "$workflow")"
[[ -n "$scorecard_script" && "$scorecard_script" != null ]] || fail 'scorecard step is missing'

fixtures="$(mktemp -d)"
trap 'rm -rf "$fixtures"' EXIT

check_scorecard() {
    local name="$1" score="$2" k9="$3" editorconfig="$4" groove="$5" verisimdb="$6" eclexiaiser="$7"
    local directory="$fixtures/$name" summary
    mkdir -p "$directory"
    (cd "$directory" && GITHUB_STEP_SUMMARY="$directory/summary" bash --noprofile --norc -e -o pipefail -c "$scorecard_script")
    summary="$(< "$directory/summary")"
    assert_contains "$summary" "**Score: $score/5**" "$name score"
    assert_contains "$summary" "| K9 contracts | $k9 |" "$name K9 row"
    assert_contains "$summary" "| .editorconfig | $editorconfig |" "$name editorconfig row"
    assert_contains "$summary" "| Groove endpoint | $groove |" "$name Groove row"
    assert_contains "$summary" "| VeriSimDB integration | $verisimdb |" "$name VeriSimDB row"
    assert_contains "$summary" "| eclexiaiser | $eclexiaiser |" "$name eclexiaiser row"
    assert_not_contains "${summary,,}" 'a2ml' "$name retired row"
    assert_equal 5 "$(printf '%s\n' "$summary" | grep -c '^| .* | :.*: |')" "$name scorecard row count"
}

passed=':white_check_mark:'
missing=':x:'
optional=':ballot_box_with_check:'

mkdir -p "$fixtures/retired-only/nested"
touch "$fixtures/retired-only/nested/0-AI-MANIFEST.a2ml"
check_scorecard retired-only 0 "$missing" "$missing" "$optional" "$optional" "$optional"

mkdir -p "$fixtures/k9-only"
touch "$fixtures/k9-only/contract.k9.ncl"
check_scorecard k9-only 1 "$passed" "$missing" "$optional" "$optional" "$optional"

mkdir -p "$fixtures/editorconfig-only"
touch "$fixtures/editorconfig-only/.editorconfig"
check_scorecard editorconfig-only 1 "$missing" "$passed" "$optional" "$optional" "$optional"

mkdir -p "$fixtures/groove-only/.well-known/groove"
touch "$fixtures/groove-only/.well-known/groove/manifest.json"
check_scorecard groove-only 1 "$missing" "$missing" "$passed" "$optional" "$optional"

mkdir -p "$fixtures/verisimdb-only"
printf 'database = "verisimdb"\n' > "$fixtures/verisimdb-only/storage.toml"
check_scorecard verisimdb-only 1 "$missing" "$missing" "$optional" "$passed" "$optional"

mkdir -p "$fixtures/eclexiaiser-only"
touch "$fixtures/eclexiaiser-only/eclexiaiser.toml"
check_scorecard eclexiaiser-only 1 "$missing" "$missing" "$optional" "$optional" "$passed"

mkdir -p "$fixtures/all/.well-known/groove"
touch "$fixtures/all/contract.k9" "$fixtures/all/.editorconfig" "$fixtures/all/.well-known/groove/manifest.json" "$fixtures/all/eclexiaiser.toml" "$fixtures/all/0-AI-MANIFEST.a2ml"
printf 'database = "VeriSimDB"\n' > "$fixtures/all/storage.toml"
check_scorecard all 5 "$passed" "$passed" "$passed" "$passed" "$passed"

printf 'PASS: dogfood job, lock and scorecard regression tests\n'
