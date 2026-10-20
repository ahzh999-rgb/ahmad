# Read-only legislation library

Open `/library.html` to browse the eligible documents already published in
`data.json`. A link on the question page opens the library.

- Search matches document titles or all query terms in an individual article.
  Arabic diacritics and letter/digit variants are normalized for search only.
  Numeric queries match article keys exactly. Canonical source bodies and hashes remain unchanged. Displayed and copied
  text uses Latin digits; repeated-article labels are shown in Arabic.
- Category labels are navigation aids, not a legal classification.
- `/library.html?doc=civil-service&article=29` opens a material directly.
  These URLs resolve against the current site snapshot, whose ID is displayed;
  archived source links are pinned to that snapshot.
- The browser checks the catalog and selected section hashes with the same
  shared implementation as the Worker. Failed catalog integrity prevents display;
  a failed section check produces an explicit source warning and retry action.
- The library exposes only eligible indexed articles. It does not declare a
  document complete, qualify missing material, or infer current applicability.
  Future recorded commencement dates require a verified single recorded date.
- Asking about an article opens a prefilled `/?q=...&draft=1`. The user reviews
  and submits it; no generation is triggered by opening that link. Existing
  shared question links without `draft=1` retain their behavior.
- No account or search history is stored. The existing local theme preference
  is shared with the question page. Copy uses the browser clipboard API.

Validation: `npm test` and
`python -m unittest discover -s site/tests -p 'test_*.py'`.
Browser checks cover desktop/mobile, Arabic searches and article numbers,
category filters, direct links, missing/excluded articles, exact text copy,
prefilled draft questions, source corruption, empty states and dark mode.


## Decisions and Umm al-Qura

`?view=decisions` lists archived decisions, decrees and adoption instruments.
It is a source-discovery catalog, not a grant of answer eligibility. Records have
metadata, source files and recorded verification limits; no unqualified body is
sent to the answer generator.

`?view=gazette` groups identifiable issue files and publication witnesses by
issue number. Path-based associations are labelled as such. Explicit publication
relations can identify a number absent from the filename. Newspaper-like names
are required, so secondary reports are not mistaken for issues, and dates in
folder names are not counted as issue numbers. A PDF is never labelled a verified
complete issue. Related documents are not an exhaustive table of contents.

`library_inventory.py` builds `library-inventory.json` from the pinned checkout.
Only tracked evidence files are considered. Its hash is included in the source
manifest and checked by the browser. The source synchronization workflow stages
this new asset alongside the ordinary article export. Source-file links point to
the pinned canonical repository and may require repository read access; binaries
are not republished by this change.


## Presentation and document types

The document-type dropdown separates laws, regulations, rules, organizations,
decisions and royal decrees, and gazette issues. Existing deep links remain valid.
Arabic-Indic and Persian digits are converted to Latin digits in displayed text
and clipboard output, while the canonical bodies, source offsets, hashes and URL
keys are unchanged. `15-bis` displays as `15 مكرر`.

Gazette cards and issue pages show linked legislation first, with reverse links
from legislation to issues. Associations include explicit publication metadata
and source references in tracked per-document evidence registers; these are
witness relationships, not a certified table of issue contents. Raw source file
names are replaced with Arabic descriptions. Review details remain available
without dominating the reading layout.
