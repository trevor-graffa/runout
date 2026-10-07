#include "fast_eval.hpp"
#include <array>
#include <iostream>
#include <set>

int main() {
    std::array<uint64_t, 9> counts{};
    std::set<uint32_t> scores;
    poker::Card cards[5];
    for (unsigned a = 0; a < 48; ++a) for (unsigned b = a + 1; b < 49; ++b)
    for (unsigned c = b + 1; c < 50; ++c) for (unsigned d = c + 1; d < 51; ++d)
    for (unsigned e = d + 1; e < 52; ++e) {
        cards[0] = a; cards[1] = b; cards[2] = c; cards[3] = d; cards[4] = e;
        auto score = poker::evaluate_high(cards, 5);
        if (score != poker::evaluate_high_reference(cards, 5)) {
            std::cerr << "Compact/reference strength mismatch\n"; return 1;
        }
        ++counts[score >> 20]; scores.insert(score);
    }
    const std::array<uint64_t, 9> expected = {
        1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40
    };
    if (counts != expected || scores.size() != 7462) {
        std::cerr << "Exhaustive category/score check failed\n"; return 1;
    }
    std::cout << "Verified all 2,598,960 five-card hands; 7,462 distinct strengths.\n";
}
