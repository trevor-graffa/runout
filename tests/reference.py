"""Deliberately simple, independent oracle. Never used in production."""
from collections import Counter
from itertools import combinations


def five(cards):
    ranks = sorted((c // 4 + 2 for c in cards), reverse=True)
    groups = sorted(((n, r) for r, n in Counter(ranks).items()), reverse=True)
    flush = len({c % 4 for c in cards}) == 1
    unique = sorted(set(ranks))
    straight = (unique[-1] if len(unique) == 5 and unique[-1] - unique[0] == 4 else
                5 if unique == [2, 3, 4, 5, 14] else 0)
    if flush and straight:
        return (8, straight)
    if groups[0][0] == 4:
        return (7, groups[0][1], groups[1][1])
    if [g[0] for g in groups] == [3, 2]:
        return (6, groups[0][1], groups[1][1])
    if flush:
        return (5, *ranks)
    if straight:
        return (4, straight)
    if groups[0][0] == 3:
        return (3, groups[0][1], *sorted((r for n, r in groups[1:]), reverse=True))
    if [g[0] for g in groups[:2]] == [2, 2]:
        return (2, *sorted((groups[0][1], groups[1][1]), reverse=True), groups[2][1])
    if groups[0][0] == 2:
        return (1, groups[0][1], *sorted((r for n, r in groups[1:]), reverse=True))
    return (0, *ranks)


def score(value):
    result = value[0] << 20
    for i, r in enumerate(value[1:]):
        result |= r << (16 - 4 * i)
    return result


def high(cards):
    return score(max(five(c) for c in combinations(cards, 5)))


def low(cards):
    ranks = sorted((1 if c // 4 == 12 else c // 4 + 2 for c in cards), reverse=True)
    if len(set(ranks)) != 5 or ranks[0] > 8:
        return 0
    result = 0
    for r in ranks:
        result = result * 16 + r
    return result


def omaha(hole, board):
    hands = [h + b for h in combinations(hole, 2) for b in combinations(board, 3)]
    lows = [low(h) for h in hands if low(h)]
    return max(score(five(h)) for h in hands), min(lows, default=0)
