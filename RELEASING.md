# Releasing

A single `vX.Y.Z` tag publishes to PyPI.

| Target | Auth | Reversible? |
|---|---|---|
| [PyPI](https://pypi.org/project/sphinx-typst-render/) | Trusted Publishing (OIDC), no stored token | **No.** A version number is burned forever |
| [anaconda.org/NB_TUDelft](https://anaconda.org/NB_TUDelft) | `ANACONDA_API_KEY` secret | Currently **disabled**, see "Conda is off" below |

The mechanics live in
[PlohnenSoftware/PyPI-Anaconda-Publish](https://github.com/PlohnenSoftware/PyPI-Anaconda-Publish),
so `.github/workflows/publish.yml` here is only job scaffolding: the triggers,
the `pypi` environment and the OIDC permission.

The package itself is pure Python, so one wheel and one sdist cover every
architecture and every Python >=3.10. There is no build matrix. Note that the
`typst` dependency it pulls in is **not** pure Python: it ships a large
prebuilt binary wheel per platform, and has no musllinux wheel, so Alpine
installs build it from source and need a Rust toolchain.

---

## Cutting a release

Bump the version, commit, push a tag. The version lives in **three** places and
they must agree:

- `pyproject.toml`'s `[project] version`, which is what gets published.
- `src/sphinx_typst_render/__init__.py`'s `__version__`, which the action
  cross-checks against it (its `version_module` input points here).
- `uv.lock`, which records the project's own version.

```bash
$EDITOR pyproject.toml                        # version = "0.2.1"
$EDITOR src/sphinx_typst_render/__init__.py   # __version__ = "0.2.1"
uv lock                                       # refreshes the project version
git commit -am "Release 0.2.1"
git tag v0.2.1
git push origin main v0.2.1
```

Open a pull request first. On every PR the workflow runs in **dry-run mode**,
building and checking everything and uploading nothing. That is the rehearsal,
and it needs nothing installed locally. Tag once CI is green.

Watch it at
<https://github.com/NB-TUDelft/sphinx-typst-render/actions>.

### The tag does not set the version

A tag only *triggers* the release; the published version comes from
`pyproject.toml`. The workflow's `tag` and `version_module` inputs make a
mismatch fail fast, before anything is built, instead of surfacing later as a
duplicate-version rejection that cannot be undone.

---

## One-time setup

### 1. PyPI trusted publisher

Not on PyPI yet, so register a **pending** publisher at
<https://pypi.org/manage/account/publishing/>:

| Field | Value |
|---|---|
| PyPI Project Name | `sphinx-typst-render` |
| Owner | `NB-TUDelft` |
| Repository name | `sphinx-typst-render` |
| Workflow name | `publish.yml` |
| Environment name | `pypi` |

Register **this** repo and **this** workflow filename, not the action repo: a
composite action runs as steps inside this job, so the OIDC claims point here.

The account that creates the pending publisher **becomes the owner** of the
project on first publish. Use whichever account should own it long term.

### 2. One GitHub environment: `pypi`

Settings -> Environments -> `pypi`. Restrict deployment branches to the tag
pattern `v*`. With no PyPI secret to gate on, the OIDC claims are the only gate,
and the environment name is one of them.

That single environment covers TestPyPI too. Register a publisher on
test.pypi.org with the same environment name; the workflow only swaps the index
URL, never the environment.

### 3. `ANACONDA_API_KEY` secret

Only needed once conda is enabled. Create a token with **Allow write access to
the API site** at <https://anaconda.org/settings/access>, as a user with upload
rights to the `NB_TUDelft` organisation. Add it as a repository secret named
`ANACONDA_API_KEY`.

> The name is `ANACONDA_API_KEY`, not `..._TOKEN`. That is the variable
> rattler-build reads.

---

## Conda is off, and why

`anaconda_owner` is empty in `publish.yml`, which makes the action skip conda
entirely. Two runtime dependencies block it:

| Dependency | On conda-forge? |
|---|---|
| `sphinx` | yes |
| `typst` (the Python binding) | **no** |
| `typst-fillable` | **no** |

conda-forge does ship a package called `typst`, but it is the **Rust command
line program**, not the importable Python module. It has 147 platform builds
and no Python-version build strings. Mapping our dependency onto it would
produce a conda package that installs cleanly and then fails at
`import typst`, which is worse than having no conda package.

### Turning conda on

All three of these have to be true:

1. `typst` (the Python binding, PyPI project `typst`) exists on a channel you
   can depend on, under a name that is not taken by the CLI.
2. `typst-fillable` exists on a channel you can depend on.
3. `[tool.conda-recipe].name-map` in `pyproject.toml` maps the PyPI names onto
   whatever those channel packages are actually called.

Then set `anaconda_owner: NB_TUDelft` in `publish.yml` and add the
`ANACONDA_API_KEY` secret. Nothing else changes: the recipe is generated from
`pyproject.toml`, so the conda package cannot drift from the PyPI one.

Check whether a package has appeared:

```bash
curl -s https://api.anaconda.org/package/conda-forge/<name> | head -c 200
```

---

## Re-running a partial release

Actions -> Publish -> Run workflow, on the tag.

- **Rehearse on TestPyPI**: tick *Use TestPyPI instead of PyPI*.
- A PyPI version that was already uploaded can never be re-uploaded. Bump and
  tag again.

---

## Changing dependencies

Edit `[project].dependencies`. If conda is ever enabled, the recipe follows
automatically; the generator translates PEP 508 to conda syntax and **fails
loudly** rather than silently dropping anything:

- a name that differs on conda-forge -> `[tool.conda-recipe].name-map`
- an environment marker or extras, which conda cannot express ->
  `[tool.conda-recipe].requirement-overrides`, keyed by normalised PyPI name

## Publishing by hand

Only if Actions is unavailable. Prefer the tag flow, which needs no credentials
locally.

```bash
uv build
UV_PUBLISH_TOKEN=pypi-... uv publish
```
