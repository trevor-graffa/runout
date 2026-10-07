# Range grammar and semantics

Input denotes physical two-card or four-card hands. Patterns match cards in any
order; different slots must match different physical cards. Unspecified slots
are wildcards, so Omaha `AA` includes AAxy, AAAx, and AAAA. It does not mean
"exactly two aces." Use `AA!AAA` to exclude three/four-ace hands.

Range grammar (highest precedence last in the list):

1. Comma `,`: union, with duplicate physical hands counted once.
2. Binary `!`: remove every physical hand matching the right-hand expression.
3. Colon `:`: intersection.
4. Atoms, parenthesized expressions, unary `!` complement, postfix `@weight`.

`AA,KK:$ds` means `AA,(KK:$ds)`. Write `(AA,KK):$ds` to apply double suited to
both. `AA!As` removes every AA combo containing As; `!AA` means all hands except
AA. Unary complement creates unweighted membership, even if its operand was
weighted. Spaces are ignored; separate union terms with commas.

Each physical combo starts with weight 1. `@0.5`, `@50%`, or `@5e-1` multiplies
that atom/group's weights. Weights are positive finite **relative** weights, not
percent-of-hands selectors. Union keeps the maximum weight of an overlap;
intersection keeps the minimum; exclusion preserves the left side's weights.
Thus `AA@.5,AA@.2` is AA at .5, not AA at .7. For additive mixture semantics,
construct a `Range` with explicitly merged combo weights. `Range` rejects
duplicate physical hands. Zero weights are rejected; omit zero-weight hands.

Hold'em conventional shorthand puts the higher rank first. Suited `s` and
offsuit `o` apply to nonpairs only. `ATs+` keeps A fixed and expands ATs, AJs,
AQs, AKs. All nonpair `+` expressions use this fixed-first-rank rule; use
`76s-AKs` for an increasing diagonal. Inclusive `-` intervals accept either
endpoint direction when the ranks follow a fixed-rank, pair, or equal-gap path.
They reject inconsistent suitedness or arbitrary rectangles.

Generic patterns contain rank tokens `2..9,T,J,Q,K,A`, rank sets `[AKQ]` or
`[A,K,Q]`, inclusive one-rank spans `[K-T]`, and `*` wildcards. Each token may
have an attached literal suit `c,d,h,s` or suit variable `x,y,z,w`. A suit alone
is a wildcard rank with that suit. Suit variables with different names must be
different suits; repeated variables must match the same suit. They are
independent of literal suits (a variable may equal a literal suit elsewhere).

For example, `AxAyxy` describes two aces in two different suits, and two more
cards in those same suits. `xxyy` denotes exactly 2+2; `xxyz` denotes exactly
2+1+1; `xyzw` denotes four suits. Partial `xyz` requires at least three suits.
`hh` requires at least two hearts. `AsKs**` fixes As and Ks, and leaves the
other cards free.

Omaha macros `$ds`, `$ss`, and `$r` expand to `xxyy`, `xxyz`, and `xyzw`.
An appended macro intersects the preceding atom/group: `AA$ds` becomes
`AA:xxyy`; `(AA,KK)$ds` becomes `(AA,KK):xxyy`. For this implementation `$ss`
means exactly 2+1+1, excluding three/four cards in one suit. Macro and expression
names are case-sensitive.

The implementation does not support top-N% hand rankings, arbitrary PPT macros,
PPT rank variables, multi-rank spans such as `[AK-JT]`, classic suited groups
such as `(AK)(QJ)`, or Omaha rundown shifts such as `9876+`. These reject with
an error. Spell a rundown shift out explicitly, e.g. `9876,T987,JT98`.

Examples: a random Hold'em range has 1,326 physical combos; random Omaha has
270,725. Omaha `AA` has 6,961, `AA$ds` has 864, `AA$ss` has 4,392, and `AA$r`
has 913. Higher multiplicities account for the counts differing from simple
"choose two aces, choose two nonaces" calculations.

The subset follows PPT's generic pattern and combinator approach. Historical
PPT behavior across versions and its complete grammar are not guaranteed.

## Additional Omaha builder syntax

These are extensions provided by this library, not claims about historical PPT
syntax. `{AA,AKs|A2,23}` selects two distinct cards from each Hold'em-style
range to form one four-card Omaha hand. Physical hands are deduplicated even
when several partitions match. Each side uses ordinary Hold'em syntax; nested
braces and weights inside braces are rejected. A weight outside the braces is
allowed. Suit filters apply to the complete four-card hand.

`$ts` selects exactly three cards of one suit (3+1); `$ms` selects four of one
suit. `$hs` requires a highest-rank card to share a suit with another card;
`$as` requires an ace to share a suit. `$bs` requires the two highest-rank cards
to be suited separately in distinct suits. Rank ties allow any qualifying
assignment. For example, `AsKsKh3h` satisfies `$bs` using As and Kh as the top
two cards. `AsKsQhJh` does not. These filters may be appended or intersected
with `:` like the original suit macros.

The app's Omaha editor two-card grid presets are also card-membership rules, not
hand rankings. High only restricts the first pair to ranks T–A and leaves the
other pair unrestricted. High + low restricts the second pair to A,2–8. Middle +
middle uses ranks 6–T for both pairs. The editor builds these as ordinary range
expressions.
